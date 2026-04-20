import { NextRequest, NextResponse } from "next/server";
import { patchBookingDraftReservation } from "@/lib/booking-draft-store";
import { capturePayPalOrder } from "@/lib/paypal-server";

export const dynamic = "force-dynamic";

type CaptureOrderBody = {
  orderID: string;
  draftId?: string;
};

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
  const draftId = String(body.draftId || "").trim();

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
    const captureResult = await capturePayPalOrder(orderID);

    if (!captureResult.ok) {
      if (draftId) {
        await patchBookingDraftReservation(draftId, {
          paypalOrderId: orderID,
          paymentStatus: "failed",
          paymentUpdatedAt: new Date().toISOString(),
          paymentLastError: "Impossible de capturer la commande PayPal.",
        });
      }
      return NextResponse.json(
        {
          ok: false,
          message: "Impossible de capturer la commande PayPal.",
          paypalStatus: captureResult.paypalStatus,
          paypalResponse: captureResult.paypalResponse,
        },
        { status: 502 }
      );
    }
    if (draftId) {
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
    }

    return NextResponse.json({
      ok: true,
      message: captureResult.alreadyCaptured
        ? "Paiement PayPal déjà capturé."
        : "Paiement PayPal capturé.",
      orderID,
      orderStatus: captureResult.orderStatus || null,
      captureID: captureResult.captureID || null,
      captureStatus: captureResult.captureStatus || null,
      amount: captureResult.amount || null,
      currency: captureResult.currency || null,
      data: captureResult.data,
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
