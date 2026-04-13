import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaReservasRequest } from "@/lib/armas/client";

type BookingPayload = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  nombre: string;
  apellido1: string;
  apellido2?: string;
  codigoDocumento: string;
  codigoPais: string;
  fechaNacimiento: string;
  sexo: string;
  tipoDocumento: string;
  tipoPasajero: string;
  codigoTarifa: string;
  bonificacion: string;
  mail: string;
  telefono: string;
  observaciones?: string;
  sentidoSalida?: number;
};

function isRealBookingEnabled() {
  return (
    process.env.ENABLE_REAL_BOOKING === "true" ||
    process.env.NEXT_PUBLIC_ENABLE_REAL_BOOKING === "true"
  );
}

function validatePayload(payload: Partial<BookingPayload>) {
  const requiredFields: Array<keyof BookingPayload> = [
    "origen",
    "destino",
    "fechaSalida",
    "horaSalida",
    "cantidad",
    "codigoServicioVenta",
    "tipoServicioVenta",
    "nombre",
    "apellido1",
    "codigoDocumento",
    "codigoPais",
    "fechaNacimiento",
    "sexo",
    "tipoDocumento",
    "tipoPasajero",
    "codigoTarifa",
    "bonificacion",
    "mail",
    "telefono",
  ];

  const missing = requiredFields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || value === "";
  });

  return {
    isValid: missing.length === 0,
    missing,
  };
}

export async function POST(request: NextRequest) {
  if (!isRealBookingEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "La réservation réelle est désactivée. Active ENABLE_REAL_BOOKING=true pour autoriser l'appel.",
      },
      { status: 403 }
    );
  }

  const validation = validateArmasBasicConfig();

  if (!validation.isValid) {
    return NextResponse.json(
      {
        ok: false,
        message: "Configuration Armas incomplete.",
        missingEnv: validation.missing,
      },
      { status: 500 }
    );
  }

  let body: Partial<BookingPayload>;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const payloadCheck = validatePayload(body);

  if (!payloadCheck.isValid) {
    return NextResponse.json(
      {
        ok: false,
        message: "Paramètres obligatoires manquants pour la réservation.",
        missingFields: payloadCheck.missing,
      },
      { status: 400 }
    );
  }

  try {
    const result = await nasaReservasRequest({
      origen: body.origen as string,
      destino: body.destino as string,
      fechaSalida: body.fechaSalida as string,
      horaSalida: body.horaSalida as string,
      cantidad: Number(body.cantidad),
      codigoServicioVenta: body.codigoServicioVenta as string,
      tipoServicioVenta: body.tipoServicioVenta as string,
      nombre: body.nombre as string,
      apellido1: body.apellido1 as string,
      apellido2: body.apellido2 || "",
      codigoDocumento: body.codigoDocumento as string,
      codigoPais: body.codigoPais as string,
      fechaNacimiento: body.fechaNacimiento as string,
      sexo: body.sexo as string,
      tipoDocumento: body.tipoDocumento as string,
      tipoPasajero: body.tipoPasajero as string,
      codigoTarifa: body.codigoTarifa as string,
      bonificacion: body.bonificacion as string,
      mail: body.mail as string,
      telefono: body.telefono as string,
      observaciones: body.observaciones || "",
      sentidoSalida:
        typeof body.sentidoSalida === "number" ? body.sentidoSalida : 1,
    });

    return NextResponse.json({
      ok: true,
      message: "Réservation réelle créée.",
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de la réservation réelle.",
        error: message,
      },
      { status: 500 }
    );
  }
}