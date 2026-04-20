import { NextRequest, NextResponse } from "next/server";
import {
  getBookingDraft,
  patchBookingDraftReservation,
} from "@/lib/booking-draft-store";
import { finalizeBookingAfterPayment } from "@/lib/booking-after-payment";
import { capturePayPalOrder } from "@/lib/paypal-server";

type ReconcileBody = {
  draftId: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  let body: ReconcileBody;

  try {
    body = (await request.json()) as ReconcileBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const draftId = normalizeString(body.draftId);

  if (!draftId) {
    return NextResponse.json(
      {
        ok: false,
        message: "draftId est obligatoire.",
      },
      { status: 400 }
    );
  }

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

  if (draft.status === "reserved" && draft.reservation?.codigoLocata) {
    return NextResponse.json({
      ok: true,
      message: "Réservation déjà finalisée.",
      alreadyReserved: true,
      reservation: draft.reservation,
    });
  }

  const orderID = normalizeString(draft.reservation?.paypalOrderId);

  if (!orderID) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Aucune référence PayPal enregistrée sur ce dossier pour lancer la réconciliation.",
      },
      { status: 409 }
    );
  }

  const captureResult = await capturePayPalOrder(orderID);

  if (!captureResult.ok) {
    await patchBookingDraftReservation(draftId, {
      paymentStatus: "failed",
      paymentUpdatedAt: new Date().toISOString(),
      paymentLastError:
        "Échec de réconciliation PayPal avant finalisation de la réservation.",
    });

    return NextResponse.json(
      {
        ok: false,
        message: "Impossible de confirmer le paiement PayPal pour ce dossier.",
        paypalStatus: captureResult.paypalStatus,
        paypalResponse: captureResult.paypalResponse,
      },
      { status: 502 }
    );
  }

  await patchBookingDraftReservation(draftId, {
    paypalOrderId: orderID,
    paypalOrderStatus: captureResult.orderStatus || "",
    paypalCaptureId: captureResult.captureID || "",
    paypalCaptureStatus: captureResult.captureStatus || "",
    paypalAmount: captureResult.amount || "",
    paypalCurrency: captureResult.currency || "",
    paymentStatus: "captured",
    paymentUpdatedAt: new Date().toISOString(),
    paymentCapturedAt: new Date().toISOString(),
    paymentLastError: "",
  });

  const result = await finalizeBookingAfterPayment({
    draftId,
    capturedAmount: captureResult.amount || "",
  });

  return NextResponse.json(result.body, { status: result.status });
}
