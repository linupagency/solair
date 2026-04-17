import { NextRequest, NextResponse } from "next/server";
import { getBookingDraft } from "@/lib/booking-draft-store";

export const dynamic = "force-dynamic";

type CreateOrderBody = {
  amount?: string;
  currency?: string;
  draftId: string;
  description?: string;
};

type PayPalTokenSuccess = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type PayPalCreateOrderResponse = {
  id?: string;
  status?: string;
  links?: Array<{
    href?: string;
    rel?: string;
    method?: string;
  }>;
  [key: string]: unknown;
};

function getPayPalBaseUrl() {
  return process.env.PAYPAL_ENV === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function getRequiredEnv() {
  return {
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || "",
    env: process.env.PAYPAL_ENV || "sandbox",
  };
}

function getApproveUrl(links?: Array<{ href?: string; rel?: string }>) {
  if (!Array.isArray(links)) return "";
  return (
    links.find((link) => link.rel === "payer-action")?.href ||
    links.find((link) => link.rel === "approve")?.href ||
    ""
  );
}

async function getPayPalAccessToken() {
  const { clientId, clientSecret, env } = getRequiredEnv();

  if (!clientId || !clientSecret) {
    throw new Error(
      "Configuration PayPal incomplète. Vérifiez PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET."
    );
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const url = `${getPayPalBaseUrl()}/v1/oauth2/token`;

  const response = await fetch(url, {
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

  let data: PayPalTokenSuccess | Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText) as PayPalTokenSuccess | Record<string, unknown>;
  } catch {
    data = { rawText };
  }

  if (
    !response.ok ||
    !("access_token" in data) ||
    typeof data.access_token !== "string"
  ) {
    const paypalError =
      typeof (data as Record<string, unknown>)?.error_description === "string"
        ? String((data as Record<string, unknown>).error_description)
        : typeof (data as Record<string, unknown>)?.error === "string"
        ? String((data as Record<string, unknown>).error)
        : rawText || "Réponse inconnue PayPal.";

    throw new Error(
      `Impossible d’obtenir le token PayPal. HTTP ${response.status}. ENV=${env}. Détail: ${paypalError}`
    );
  }

  return data.access_token;
}

export async function POST(request: NextRequest) {
  let body: CreateOrderBody;

  try {
    body = (await request.json()) as CreateOrderBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const amount = String(body.amount || "").trim();
  const currency = (body.currency || "EUR").trim().toUpperCase();
  const description = (
    body.description || "Réservation Solair Voyages"
  ).trim();
  const draftId = String(body.draftId || "").trim();

  if (!draftId) {
    return NextResponse.json(
      {
        ok: false,
        message: "draftId est obligatoire.",
      },
      { status: 400 }
    );
  }

  try {
    const draft = await getBookingDraft(draftId);
    if (!draft) {
      return NextResponse.json(
        {
          ok: false,
          message: "Draft introuvable.",
        },
        { status: 404 }
      );
    }
    const authoritativeAmount = String(draft.payload.total || "").trim();
    if (
      !authoritativeAmount ||
      Number.isNaN(Number(authoritativeAmount)) ||
      Number(authoritativeAmount) <= 0
    ) {
      return NextResponse.json(
        {
          ok: false,
          message: "Montant autoritaire draft invalide.",
        },
        { status: 400 }
      );
    }
    if (amount && Number(amount).toFixed(2) !== Number(authoritativeAmount).toFixed(2)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Le montant fourni par le client ne correspond pas au montant autoritaire du draft.",
          draftAmount: Number(authoritativeAmount).toFixed(2),
          requestedAmount: Number(amount).toFixed(2),
        },
        { status: 409 }
      );
    }

    const accessToken = await getPayPalAccessToken();

    const appUrl = getAppUrl();

    const returnUrl = new URL(`${appUrl}/paiement/succes`);
    returnUrl.searchParams.set("draftId", draftId);

    const cancelUrl = new URL(`${appUrl}/paiement/annule`);
    cancelUrl.searchParams.set("draftId", draftId);

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          description,
          custom_id: draftId,
          amount: {
            currency_code: currency,
            value: Number(authoritativeAmount).toFixed(2),
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Solair Voyages",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            return_url: returnUrl.toString(),
            cancel_url: cancelUrl.toString(),
          },
        },
      },
    };

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(orderPayload),
      cache: "no-store",
    });

    const rawText = await response.text();

    let data: PayPalCreateOrderResponse = {};
    try {
      data = JSON.parse(rawText) as PayPalCreateOrderResponse;
    } catch {
      data = { rawText };
    }

    if (!response.ok || !data.id) {
      return NextResponse.json(
        {
          ok: false,
          message: "Impossible de créer la commande PayPal.",
          paypalStatus: response.status,
          paypalResponse: data,
          envState: {
            PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
            hasClientId: Boolean(process.env.PAYPAL_CLIENT_ID),
            hasClientSecret: Boolean(process.env.PAYPAL_CLIENT_SECRET),
            NEXT_PUBLIC_APP_URL:
              process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          },
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      orderID: data.id,
      status: data.status || null,
      approveUrl: getApproveUrl(data.links),
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de création de commande PayPal.",
        error: message,
        envState: {
          PAYPAL_ENV: process.env.PAYPAL_ENV || "sandbox",
          hasClientId: Boolean(process.env.PAYPAL_CLIENT_ID),
          hasClientSecret: Boolean(process.env.PAYPAL_CLIENT_SECRET),
          NEXT_PUBLIC_APP_URL:
            process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
        },
      },
      { status: 500 }
    );
  }
}