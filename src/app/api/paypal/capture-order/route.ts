import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type CaptureOrderBody = {
  orderID: string;
};

type PayPalTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type PayPalErrorResponse = {
  name?: string;
  message?: string;
  details?: Array<{
    issue?: string;
    description?: string;
  }>;
  [key: string]: unknown;
};

type PayPalOrderLikeResponse = {
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

function getPayPalBaseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getRequiredEnv() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
  };
}

async function getPayPalAccessToken() {
  const { clientId, clientSecret } = getRequiredEnv();

  if (!clientId || !clientSecret) {
    throw new Error("Configuration PayPal incomplète.");
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

  const data = (await response.json()) as
    | PayPalTokenResponse
    | Record<string, unknown>;

  if (
    !response.ok ||
    !("access_token" in data) ||
    typeof data.access_token !== "string"
  ) {
    throw new Error("Impossible d’obtenir le token PayPal.");
  }

  return data.access_token;
}

function getCaptureSummary(data: PayPalOrderLikeResponse) {
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];

  return {
    captureID: capture?.id || null,
    captureStatus: capture?.status || null,
    amount: capture?.amount?.value || null,
    currency: capture?.amount?.currency_code || null,
  };
}

function isPaidState(data: PayPalOrderLikeResponse) {
  const captureSummary = getCaptureSummary(data);
  return (
    data.status === "COMPLETED" || captureSummary.captureStatus === "COMPLETED"
  );
}

function hasAlreadyCapturedIssue(data: PayPalErrorResponse) {
  return (
    data.name === "UNPROCESSABLE_ENTITY" &&
    Array.isArray(data.details) &&
    data.details.some((detail) => detail.issue === "ORDER_ALREADY_CAPTURED")
  );
}

async function getOrderDetails(accessToken: string, orderID: string) {
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

export async function POST(request: NextRequest) {
  let body: CaptureOrderBody;

  try {
    body = (await request.json()) as CaptureOrderBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const orderID = String(body.orderID || "").trim();

  if (!orderID) {
    return NextResponse.json(
      {
        ok: false,
        message: "orderID est obligatoire.",
      },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getPayPalAccessToken();

    // 1) Si la commande est déjà capturée, on renvoie un succès idempotent
    const existingOrder = await getOrderDetails(accessToken, orderID);

    if (existingOrder.ok && isPaidState(existingOrder.data)) {
      const captureSummary = getCaptureSummary(existingOrder.data);

      return NextResponse.json({
        ok: true,
        message: "Paiement PayPal déjà capturé.",
        orderID: existingOrder.data.id || orderID,
        orderStatus: existingOrder.data.status || null,
        ...captureSummary,
        data: existingOrder.data,
      });
    }

    // 2) Sinon on tente la capture
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

    // 3) Si PayPal dit "déjà capturé", on recharge l'ordre et on renvoie succès
    if (!response.ok && hasAlreadyCapturedIssue(data as PayPalErrorResponse)) {
      const orderDetails = await getOrderDetails(accessToken, orderID);

      if (orderDetails.ok && isPaidState(orderDetails.data)) {
        const captureSummary = getCaptureSummary(orderDetails.data);

        return NextResponse.json({
          ok: true,
          message: "Paiement PayPal déjà capturé.",
          orderID: orderDetails.data.id || orderID,
          orderStatus: orderDetails.data.status || null,
          ...captureSummary,
          data: orderDetails.data,
        });
      }
    }

    if (!response.ok || !(data as PayPalOrderLikeResponse).id) {
      return NextResponse.json(
        {
          ok: false,
          message: "Impossible de capturer la commande PayPal.",
          paypalStatus: response.status,
          paypalResponse: data,
        },
        { status: 502 }
      );
    }

    const successData = data as PayPalOrderLikeResponse;
    const captureSummary = getCaptureSummary(successData);
    const paid = isPaidState(successData);

    return NextResponse.json({
      ok: paid,
      message: paid
        ? "Paiement PayPal capturé."
        : "Commande PayPal capturée, mais statut à vérifier.",
      orderID: successData.id || null,
      orderStatus: successData.status || null,
      ...captureSummary,
      data: successData,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de capture PayPal.",
        error: message,
      },
      { status: 500 }
    );
  }
}