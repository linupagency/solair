import { NextRequest, NextResponse } from "next/server";
import { finalizeBookingAfterPayment } from "@/lib/booking-after-payment";

type CreateAfterPaymentBody = {
  draftId: string;
  capturedAmount?: string;
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

  return NextResponse.json(result.body, { status: result.status });
}
