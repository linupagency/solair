import { NextRequest, NextResponse } from "next/server";
import { finalizeBookingAfterPayment } from "@/lib/booking-after-payment";

type CreateAfterPaymentBody = {
  draftId: string;
  capturedAmount?: string;
};

type CreateAfterPaymentResultBody = {
  ok?: boolean;
  message?: string;
  error?: string;
  draftId?: string;
  businessCode?: string | null;
  businessText?: string | null;
  codigoLocata?: string;
  capturedAmount?: string;
  armasReservationAmount?: string;
  reservation?: {
    codigoLocata?: string;
  };
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  let body: CreateAfterPaymentBody;

  try {
    body = (await request.json()) as CreateAfterPaymentBody;
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

  const result = await finalizeBookingAfterPayment({
    draftId,
    capturedAmount: normalizeString(body.capturedAmount),
  });

  const resultBody = result.body as CreateAfterPaymentResultBody;

  if (!result.ok || !resultBody?.ok) {
    console.error(
      "[BOOKING_AFTER_PAYMENT_FAILED]",
      JSON.stringify({
        draftId,
        status: result.status,
        message: resultBody?.message || "",
        error: resultBody?.error || "",
        businessCode: resultBody?.businessCode || null,
        businessText: resultBody?.businessText || null,
        codigoLocata:
          resultBody?.reservation?.codigoLocata ||
          resultBody?.codigoLocata ||
          "",
        capturedAmount: resultBody?.capturedAmount || "",
        armasReservationAmount: resultBody?.armasReservationAmount || "",
      })
    );
  } else {
    console.info(
      "[BOOKING_AFTER_PAYMENT_SUCCESS]",
      JSON.stringify({
        draftId,
        status: result.status,
        codigoLocata: resultBody?.reservation?.codigoLocata || "",
      })
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
