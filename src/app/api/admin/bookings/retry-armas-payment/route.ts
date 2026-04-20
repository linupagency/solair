import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/lib/supabase/route";
import { isAdminEmail } from "@/lib/supabase/config";
import { retryBookingPaymentFinalization } from "@/lib/booking-after-payment";

type RetryArmasPaymentBody = {
  draftId?: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseRouteClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !isAdminEmail(user.email)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Accès refusé.",
      },
      { status: 403 }
    );
  }

  let body: RetryArmasPaymentBody;

  try {
    body = (await request.json()) as RetryArmasPaymentBody;
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

  const result = await retryBookingPaymentFinalization({ draftId });
  return NextResponse.json(result.body, { status: result.status });
}
