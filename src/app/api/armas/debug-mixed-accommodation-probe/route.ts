import { NextRequest, NextResponse } from "next/server";

import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  buildNasaTarificacionesSoapArgs,
  extractNasaTarificacionesReturnMeta,
  getFirstSalidaSoapEntity,
  nasaTarificacionesRequestWithSoapArgs,
  type NasaTarificacionesRequestParams,
} from "@/lib/armas/client";
import { sumPrecioTotalFromNasaTarificacionesResult } from "@/lib/armas/tarificacion-normalize";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type DebugServiceLine = {
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
};

export async function POST(request: NextRequest) {
  const validation = validateArmasBasicConfig();
  if (!validation.isValid) {
    return NextResponse.json(
      { ok: false, message: "Configuration Armas incomplete.", missingEnv: validation.missing },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body JSON invalide." },
      { status: 400 }
    );
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const servicesRaw = Array.isArray(raw.services) ? raw.services : [];
  const services: DebugServiceLine[] = servicesRaw
    .map((line) => {
      const row = (line ?? {}) as Record<string, unknown>;
      return {
        cantidad:
          typeof row.cantidad === "number" && Number.isFinite(row.cantidad)
            ? Math.floor(row.cantidad)
            : 0,
        codigoServicioVenta: normalizeString(row.codigoServicioVenta),
        tipoServicioVenta: normalizeString(row.tipoServicioVenta),
      };
    })
    .filter(
      (line) =>
        line.cantidad > 0 && !!line.codigoServicioVenta && !!line.tipoServicioVenta
    );

  if (services.length === 0) {
    return NextResponse.json(
      { ok: false, message: "services doit contenir au moins une ligne valide." },
      { status: 400 }
    );
  }

  const params: NasaTarificacionesRequestParams = {
    origen: normalizeString(raw.origen),
    destino: normalizeString(raw.destino),
    fechaSalida: normalizeString(raw.fechaSalida),
    horaSalida: normalizeString(raw.horaSalida),
    cantidad:
      typeof raw.cantidad === "number" && Number.isFinite(raw.cantidad)
        ? Math.floor(raw.cantidad)
        : 0,
    codigoServicioVenta: normalizeString(raw.codigoServicioVenta),
    tipoServicioVenta: normalizeString(raw.tipoServicioVenta),
    tipoPasajero: normalizeString(raw.tipoPasajero) || "A",
    passengerTipos: Array.isArray(raw.passengerTipos)
      ? raw.passengerTipos.map((value) => String(value).trim()).filter(Boolean)
      : undefined,
    bonificacion: normalizeString(raw.bonificacion),
    vehicle: normalizeString(raw.vehicle) || undefined,
    vehicleCategory: normalizeString(raw.vehicleCategory) || undefined,
    vehiclePassengerIndex:
      typeof raw.vehiclePassengerIndex === "number" &&
      Number.isFinite(raw.vehiclePassengerIndex)
        ? Math.floor(raw.vehiclePassengerIndex)
        : undefined,
    vehicleData:
      raw.vehicleData && typeof raw.vehicleData === "object"
        ? (raw.vehicleData as NasaTarificacionesRequestParams["vehicleData"])
        : undefined,
    companionServicioVenta:
      raw.companionServicioVenta && typeof raw.companionServicioVenta === "object"
        ? {
            codigoServicioVenta: normalizeString(
              (raw.companionServicioVenta as Record<string, unknown>).codigoServicioVenta
            ),
            tipoServicioVenta: normalizeString(
              (raw.companionServicioVenta as Record<string, unknown>).tipoServicioVenta
            ),
            cantidad:
              typeof (raw.companionServicioVenta as Record<string, unknown>).cantidad ===
                "number" &&
              Number.isFinite(
                (raw.companionServicioVenta as Record<string, unknown>).cantidad
              )
                ? Math.floor(
                    (raw.companionServicioVenta as Record<string, unknown>)
                      .cantidad as number
                  )
                : undefined,
          }
        : undefined,
  };

  if (
    !params.origen ||
    !params.destino ||
    !params.fechaSalida ||
    !params.horaSalida ||
    !params.cantidad ||
    !params.codigoServicioVenta ||
    !params.tipoServicioVenta ||
    !params.bonificacion
  ) {
    return NextResponse.json(
      { ok: false, message: "Paramètres Armas de base incomplets." },
      { status: 400 }
    );
  }

  try {
    const soapArgs = buildNasaTarificacionesSoapArgs(params);
    const salida = getFirstSalidaSoapEntity(soapArgs.salidasEntidad.salidaEntidad);
    if (!salida) {
      return NextResponse.json(
        { ok: false, message: "Salida SOAP introuvable." },
        { status: 500 }
      );
    }

    salida.serviciosVentasEntidad = {
      servicioVentaEntidad: services,
    };

    const rawResult = await nasaTarificacionesRequestWithSoapArgs(soapArgs, {
      pricingSoapTrace: false,
    });
    const total = sumPrecioTotalFromNasaTarificacionesResult(rawResult, "combined");

    return NextResponse.json({
      ok: true,
      total,
      meta: extractNasaTarificacionesReturnMeta(rawResult),
      soapServices: services,
      rawResult,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Erreur mix accommodation probe.",
      },
      { status: 500 }
    );
  }
}
