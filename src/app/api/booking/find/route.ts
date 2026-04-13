import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  BookingDraftPayload,
  BookingDraftReservation,
  BookingDraftTraveler,
} from "@/lib/booking-draft-store";

export const dynamic = "force-dynamic";

type FindBookingBody = {
  codigoLocata: string;
  mail: string;
};

type BookingDraftRow = {
  id: string;
  status: "draft" | "reserved";
  payload: BookingDraftPayload;
  reservation: BookingDraftReservation | null;
  created_at: string;
  updated_at: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildTravelers(payload: BookingDraftPayload): BookingDraftTraveler[] {
  if (payload.passengersData && payload.passengersData.length > 0) {
    return payload.passengersData;
  }

  return [
    {
      nombre: payload.nombre,
      apellido1: payload.apellido1,
      apellido2: payload.apellido2 || "",
      fechaNacimiento: payload.fechaNacimiento,
      codigoPais: payload.codigoPais,
      sexo: payload.sexo,
      tipoDocumento: payload.tipoDocumento,
      codigoDocumento: payload.codigoDocumento,
      tipoPasajero: payload.tipoPasajero,
    },
  ];
}

export async function POST(request: NextRequest) {
  let body: FindBookingBody;

  try {
    body = (await request.json()) as FindBookingBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const codigoLocata = normalizeString(body.codigoLocata);
  const mail = normalizeString(body.mail).toLowerCase();

  if (!codigoLocata || !mail) {
    return NextResponse.json(
      {
        ok: false,
        message: "La référence et l’email sont obligatoires.",
      },
      { status: 400 }
    );
  }

  try {
    const { data, error } = await getSupabaseAdmin()
      .from("booking_drafts")
      .select("id, status, payload, reservation, created_at, updated_at")
      .eq("status", "reserved")
      .filter("reservation->>codigoLocata", "eq", codigoLocata)
      .filter("payload->>mail", "ilike", mail)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          message: error.message,
          details: error,
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          ok: false,
          message: "Aucune réservation trouvée avec ces informations.",
        },
        { status: 404 }
      );
    }

    const row = data as BookingDraftRow;
    const travelers = buildTravelers(row.payload);

    return NextResponse.json({
      ok: true,
      message: "Réservation trouvée.",
      data: {
        id: row.id,
        codigoLocata: row.reservation?.codigoLocata || "",
        total: row.reservation?.total || row.payload.total || "",
        fechaValidezReserva: row.reservation?.fechaValidezReserva || "",
        businessCode: row.reservation?.businessCode || "",
        origen: row.payload.origen,
        destino: row.payload.destino,
        fechaSalida: row.payload.fechaSalida,
        horaSalida: row.payload.horaSalida,
        mail: row.payload.mail,
        telefono: row.payload.telefono,
        travelers,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue.";

    return NextResponse.json(
      {
        ok: false,
        message: "Impossible de retrouver la réservation.",
        error: message,
      },
      { status: 500 }
    );
  }
}