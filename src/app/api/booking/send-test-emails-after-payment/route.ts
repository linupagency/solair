import { NextRequest, NextResponse } from "next/server";
import { getBookingDraft } from "@/lib/booking-draft-store";
import { sendBookingConfirmationEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      draftId?: string;
      capturedAmount?: string;
    };

    const draftId = normalizeString(body?.draftId);
    const capturedAmount = normalizeString(body?.capturedAmount);

    if (!draftId) {
      return NextResponse.json(
        { ok: false, message: "draftId manquant." },
        { status: 400 }
      );
    }

    const draft = await getBookingDraft(draftId);

    if (!draft) {
      return NextResponse.json(
        { ok: false, message: "Draft introuvable." },
        { status: 404 }
      );
    }

    const payload = draft.payload;
    const travelersForEmail =
      payload.passengersData && payload.passengersData.length > 0
        ? payload.passengersData
        : [
            {
              nombre: payload.nombre,
              apellido1: payload.apellido1,
              apellido2: payload.apellido2 || "",
              fechaNacimiento: payload.fechaNacimiento,
              codigoPais: payload.codigoPais,
              sexo: payload.sexo,
              tipoDocumento: payload.tipoDocumento,
              codigoDocumento: payload.codigoDocumento,
            },
          ];

    const testReference = `TEST-${draftId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
    const inboundLeg =
      payload.tripType === "round_trip" && payload.inboundSelectedDeparture
        ? {
            codigoLocata: `${testReference}-R`,
            origen: payload.inboundSelectedDeparture.origen,
            destino: payload.inboundSelectedDeparture.destino,
            fechaSalida: payload.inboundSelectedDeparture.fechaSalida,
            horaSalida: payload.inboundSelectedDeparture.horaSalida,
          }
        : undefined;

    const total = capturedAmount || payload.total || "";

    await sendBookingConfirmationEmail({
      to: payload.mail,
      codigoLocata: testReference,
      total,
      origen: payload.origen,
      destino: payload.destino,
      fechaSalida: payload.fechaSalida,
      horaSalida: payload.horaSalida,
      travelers: travelersForEmail,
      inboundLeg,
      mode: "test",
    });

    await sendBookingConfirmationEmail({
      to: "reservations@solair-voyages.com",
      codigoLocata: testReference,
      total,
      origen: payload.origen,
      destino: payload.destino,
      fechaSalida: payload.fechaSalida,
      horaSalida: payload.horaSalida,
      travelers: travelersForEmail,
      inboundLeg,
      mode: "test",
    });

    return NextResponse.json({
      ok: true,
      message: "Emails de test envoyés.",
      testReference,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Erreur inconnue pendant l’envoi des emails de test.",
      },
      { status: 500 }
    );
  }
}
