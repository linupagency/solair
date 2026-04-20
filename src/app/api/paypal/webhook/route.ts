import { NextRequest, NextResponse } from "next/server";
import {
  findBookingDraftByPayPalOrderId,
  patchBookingDraftReservation,
} from "@/lib/booking-draft-store";
import { verifyPayPalWebhookSignature } from "@/lib/paypal-server";

type PayPalWebhookEvent = {
  id?: string;
  event_type?: string;
  summary?: string;
  create_time?: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: {
      value?: string;
      currency_code?: string;
    };
    supplementary_data?: {
      related_ids?: {
        order_id?: string;
      };
    };
  };
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getHeader(request: NextRequest, name: string) {
  return normalizeString(request.headers.get(name));
}

function extractOrderId(event: PayPalWebhookEvent) {
  const relatedOrderId = normalizeString(
    event.resource?.supplementary_data?.related_ids?.order_id
  );

  if (relatedOrderId) {
    return relatedOrderId;
  }

  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    return normalizeString(event.resource?.id);
  }

  return "";
}

function getPaymentStatus(eventType: string) {
  switch (eventType) {
    case "CHECKOUT.ORDER.APPROVED":
      return "created";
    case "PAYMENT.CAPTURE.COMPLETED":
      return "captured";
    case "PAYMENT.CAPTURE.DENIED":
      return "denied";
    case "CHECKOUT.PAYMENT-APPROVAL.REVERSED":
      return "reversed";
    default:
      return "";
  }
}

export async function POST(request: NextRequest) {
  const event = (await request.json()) as PayPalWebhookEvent;

  const verified = await verifyPayPalWebhookSignature(event, {
    authAlgo: getHeader(request, "paypal-auth-algo"),
    certUrl: getHeader(request, "paypal-cert-url"),
    transmissionId: getHeader(request, "paypal-transmission-id"),
    transmissionSig: getHeader(request, "paypal-transmission-sig"),
    transmissionTime: getHeader(request, "paypal-transmission-time"),
  });

  if (!verified) {
    return NextResponse.json(
      {
        ok: false,
        message: "Signature webhook PayPal invalide.",
      },
      { status: 401 }
    );
  }

  const eventType = normalizeString(event.event_type);
  const interestingEvents = new Set([
    "CHECKOUT.ORDER.APPROVED",
    "PAYMENT.CAPTURE.COMPLETED",
    "PAYMENT.CAPTURE.DENIED",
    "CHECKOUT.PAYMENT-APPROVAL.REVERSED",
  ]);

  if (!interestingEvents.has(eventType)) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      eventType,
    });
  }

  const orderId = extractOrderId(event);

  if (!orderId) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      eventType,
      reason: "order_id introuvable dans le webhook",
    });
  }

  const draft = await findBookingDraftByPayPalOrderId(orderId);

  if (!draft) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      eventType,
      reason: "draft introuvable pour cet order_id",
    });
  }

  await patchBookingDraftReservation(draft.id, {
    paypalOrderId: orderId,
    paypalOrderStatus:
      eventType === "CHECKOUT.ORDER.APPROVED"
        ? normalizeString(event.resource?.status) || "APPROVED"
        : normalizeString(draft.reservation?.paypalOrderStatus),
    paypalCaptureId:
      eventType === "PAYMENT.CAPTURE.COMPLETED" ||
      eventType === "PAYMENT.CAPTURE.DENIED"
        ? normalizeString(event.resource?.id)
        : normalizeString(draft.reservation?.paypalCaptureId),
    paypalCaptureStatus:
      eventType === "PAYMENT.CAPTURE.COMPLETED" ||
      eventType === "PAYMENT.CAPTURE.DENIED"
        ? normalizeString(event.resource?.status)
        : normalizeString(draft.reservation?.paypalCaptureStatus),
    paypalAmount:
      normalizeString(event.resource?.amount?.value) ||
      normalizeString(draft.reservation?.paypalAmount),
    paypalCurrency:
      normalizeString(event.resource?.amount?.currency_code) ||
      normalizeString(draft.reservation?.paypalCurrency),
    paymentStatus: getPaymentStatus(eventType) as
      | "created"
      | "captured"
      | "denied"
      | "reversed",
    paymentUpdatedAt: new Date().toISOString(),
    paymentCapturedAt:
      eventType === "PAYMENT.CAPTURE.COMPLETED"
        ? normalizeString(event.create_time) || new Date().toISOString()
        : normalizeString(draft.reservation?.paymentCapturedAt),
    paymentLastError:
      eventType === "PAYMENT.CAPTURE.DENIED" ||
      eventType === "CHECKOUT.PAYMENT-APPROVAL.REVERSED"
        ? normalizeString(event.summary) || "Paiement PayPal non confirmé."
        : "",
  });

  return NextResponse.json({
    ok: true,
    eventType,
    draftId: draft.id,
  });
}
