import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isAdminEmail,
  getAdminAllowedEmails,
} from "@/lib/supabase/config";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

const bodySchema = z.object({
  email: z.email(),
});

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function POST(request: NextRequest) {
  try {
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

    const body = bodySchema.parse(await request.json());
    const email = body.email.trim().toLowerCase();
    const allowedEmails = getAdminAllowedEmails();

    if (!isAdminEmail(email)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            allowedEmails.length > 0
              ? "Cet email n'est pas autorisé pour l'espace admin."
              : "Cet email n'est pas autorisé.",
        },
        { status: 403 }
      );
    }

    const redirectTo = new URL("/admin/auth/callback", getAppUrl());
    redirectTo.searchParams.set("next", "/admin/set-password");

    const { error } = await getSupabaseAdmin().auth.admin.inviteUserByEmail(
      email,
      {
        redirectTo: redirectTo.toString(),
        data: {
          role: "admin",
        },
      }
    );

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message:
        "Invitation envoyée. Le nouvel administrateur va recevoir un email.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Erreur inconnue.",
      },
      { status: 400 }
    );
  }
}
