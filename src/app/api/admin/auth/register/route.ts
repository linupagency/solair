import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      message:
        "L'inscription libre est désactivée. Utilisez l'invitation admin uniquement.",
    },
    { status: 403 }
  );
}
