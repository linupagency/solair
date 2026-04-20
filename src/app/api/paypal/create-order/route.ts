import { NextRequest, NextResponse } from "next/server";
import {
  getBookingDraft,
  patchBookingDraftReservation,
} from "@/lib/booking-draft-store";
import {
  getPayPalAccessToken,
  getPayPalBaseUrl,
} from "@/lib/paypal-server";

export const dynamic = "force-dynamic";

type CreateOrderBody = {
  amount?: string;
  currency?: string;
  draftId: string;
  description?: string;
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

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

function getApproveUrl(links?: Array<{ href?: string; rel?: string }>) {
  if (!Array.isArray(links)) return "";
  return (
    links.find((link) => link.rel === "payer-action")?.href ||
    links.find((link) => link.rel === "approve")?.href ||
    ""
  );
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

    await patchBookingDraftReservation(draftId, {
      paypalOrderId: data.id,
      paypalOrderStatus: data.status || "CREATED",
      paypalAmount: Number(authoritativeAmount).toFixed(2),
      paypalCurrency: currency,
      paymentStatus: "created",
      paymentUpdatedAt: new Date().toISOString(),
      paymentLastError: "",
    });

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
