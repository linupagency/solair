type PayPalTokenSuccess = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

export type PayPalErrorResponse = {
  name?: string;
  message?: string;
  error?: string;
  error_description?: string;
  details?: Array<{
    issue?: string;
    description?: string;
  }>;
  [key: string]: unknown;
};

export type PayPalOrderLikeResponse = {
  id?: string;
  status?: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: {
          currency_code?: string;
          value?: string;
        };
      }>;
    };
  }>;
  [key: string]: unknown;
};

export type PayPalCaptureSummary = {
  captureID: string | null;
  captureStatus: string | null;
  amount: string | null;
  currency: string | null;
};

export type CapturePayPalOrderSuccess = PayPalCaptureSummary & {
  ok: true;
  alreadyCaptured: boolean;
  orderStatus: string | null;
  data: PayPalOrderLikeResponse;
};

export type CapturePayPalOrderFailure = {
  ok: false;
  paypalStatus: number;
  paypalResponse: PayPalErrorResponse | PayPalOrderLikeResponse;
};

export type CapturePayPalOrderResult =
  | CapturePayPalOrderSuccess
  | CapturePayPalOrderFailure;

type VerifyWebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getPayPalBaseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function getPayPalRequiredEnv() {
  return {
    clientId: normalizeString(process.env.PAYPAL_CLIENT_ID),
    clientSecret: normalizeString(process.env.PAYPAL_CLIENT_SECRET),
    env: normalizeString(process.env.PAYPAL_ENV) || "sandbox",
  };
}

export async function getPayPalAccessToken() {
  const { clientId, clientSecret, env } = getPayPalRequiredEnv();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Configuration PayPal incomplète. Vérifiez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET."
    );
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "Accept-Language": "fr_FR",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  const rawText = await response.text();

  let data: PayPalTokenSuccess | PayPalErrorResponse = {};
  try {
    data = JSON.parse(rawText) as PayPalTokenSuccess | PayPalErrorResponse;
  } catch {
    data = { error_description: rawText };
  }

  if (
    !response.ok ||
    !("access_token" in data) ||
    typeof data.access_token !== "string"
  ) {
    const errorData = data as PayPalErrorResponse;
    const detail =
      typeof errorData.error_description === "string"
        ? errorData.error_description
        : typeof errorData.error === "string"
          ? errorData.error
          : rawText || "Réponse inconnue PayPal.";

    throw new Error(
      `Impossible d’obtenir le token PayPal. HTTP ${response.status}. ENV=${env}. Détail: ${detail}`
    );
  }

  return data.access_token;
}

export function getCaptureSummary(
  data: PayPalOrderLikeResponse
): PayPalCaptureSummary {
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    captureID: normalizeString(capture?.id) || null,
    captureStatus: normalizeString(capture?.status) || null,
    amount: normalizeString(capture?.amount?.value) || null,
    currency: normalizeString(capture?.amount?.currency_code) || null,
  };
}

export function isPaidState(data: PayPalOrderLikeResponse) {
  const captureSummary = getCaptureSummary(data);
  return (
    data.status === "COMPLETED" || captureSummary.captureStatus === "COMPLETED"
  );
}

export function hasAlreadyCapturedIssue(data: PayPalErrorResponse) {
  return (
    data.name === "UNPROCESSABLE_ENTITY" &&
    Array.isArray(data.details) &&
    data.details.some((detail) => detail.issue === "ORDER_ALREADY_CAPTURED")
  );
}

export async function getPayPalOrderDetails(
  accessToken: string,
  orderID: string
) {
  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderID)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const data = (await response.json()) as PayPalOrderLikeResponse;

  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

export async function capturePayPalOrder(
  orderID: string
): Promise<CapturePayPalOrderResult> {
  const accessToken = await getPayPalAccessToken();

  const existingOrder = await getPayPalOrderDetails(accessToken, orderID);

  if (existingOrder.ok && isPaidState(existingOrder.data)) {
    return {
      ok: true,
      alreadyCaptured: true,
      orderStatus: existingOrder.data.status || null,
      ...getCaptureSummary(existingOrder.data),
      data: existingOrder.data,
    };
  }

  const response = await fetch(
    `${getPayPalBaseUrl()}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: "{}",
      cache: "no-store",
    }
  );

  const data = (await response.json()) as
    | PayPalOrderLikeResponse
    | PayPalErrorResponse;

  if (!response.ok && hasAlreadyCapturedIssue(data as PayPalErrorResponse)) {
    const orderDetails = await getPayPalOrderDetails(accessToken, orderID);

    if (orderDetails.ok && isPaidState(orderDetails.data)) {
      return {
        ok: true,
        alreadyCaptured: true,
        orderStatus: orderDetails.data.status || null,
        ...getCaptureSummary(orderDetails.data),
        data: orderDetails.data,
      };
    }
  }

  if (!response.ok || !(data as PayPalOrderLikeResponse).id) {
    return {
      ok: false,
      paypalStatus: response.status,
      paypalResponse: data,
    };
  }

  const successData = data as PayPalOrderLikeResponse;
  const paid = isPaidState(successData);

  if (!paid) {
    return {
      ok: false,
      paypalStatus: response.status,
      paypalResponse: successData,
    };
  }

  return {
    ok: true,
    alreadyCaptured: false,
    orderStatus: successData.status || null,
    ...getCaptureSummary(successData),
    data: successData,
  };
}

export async function verifyPayPalWebhookSignature(
  event: unknown,
  headers: VerifyWebhookHeaders
) {
  const webhookId = normalizeString(process.env.PAYPAL_WEBHOOK_ID);

  if (!webhookId) {
    throw new Error("PAYPAL_WEBHOOK_ID manquant.");
  }

  const accessToken = await getPayPalAccessToken();

  const response = await fetch(
    `${getPayPalBaseUrl()}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
      cache: "no-store",
    }
  );

  const data = (await response.json()) as {
    verification_status?: string;
  };

  return response.ok && data.verification_status === "SUCCESS";
}
