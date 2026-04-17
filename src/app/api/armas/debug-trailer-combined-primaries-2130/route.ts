import { NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  buildNasaTarificacionesSoapArgs,
  extractPricingVehiculoEntidad,
  extractNasaTarificacionesReturnMeta,
  nasaSalidasRequest,
  nasaTarificacionesRequest,
} from "@/lib/armas/client";
import { isPrimaryServiceEligibleForVehicleCompanionPricing } from "@/lib/armas/pricing-combined-primary";
import {
  normalizeNasaTarificacionesLines,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";

/**
 * Diagnostic figé : ALG → PTM, 20260413, horaSalida 2130, petite voiture + remorque,
 * compagnon VR|V, plusieurs primaires P (jamais X).
 *
 * GET /api/armas/debug-trailer-combined-primaries-2130
 */

function normalizeArray<T>(value?: T[] | T | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function unwrapReturn(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (r.return && typeof r.return === "object") {
    return r.return as Record<string, unknown>;
  }
  return r;
}

function normHora(h: unknown) {
  return String(h ?? "")
    .replace(/\D/g, "")
    .slice(-4)
    .padStart(4, "0");
}

function extractSalidasFromNasaResult(raw: unknown): Record<string, unknown>[] {
  const ret = unwrapReturn(raw);
  const salidas = ret.salidasEntidad as Record<string, unknown> | undefined;
  return normalizeArray(
    salidas?.salidaEntidad as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined
  );
}

type SalidaServicioLine = {
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  disponibilidad: boolean | null;
};

function lineKey(c: string, t: string) {
  return `${c.trim().toUpperCase()}|${t.trim().toUpperCase()}`;
}

function extractServiciosFromSalida(
  salida: Record<string, unknown>
): SalidaServicioLine[] {
  const wrap = salida.serviciosVentasEntidad as
    | Record<string, unknown>
    | undefined;
  const rawList = normalizeArray(
    wrap?.servicioVentaEntidad as Record<string, unknown> | undefined
  );
  return rawList.map((x) => {
    const raw = x as Record<string, unknown>;
    const disp = raw.disponibilidad;
    const disponibilidad =
      typeof disp === "boolean"
        ? disp
        : disp === "true" || disp === 1
          ? true
          : disp === "false" || disp === 0
            ? false
            : null;
    return {
      codigoServicioVenta: String(raw.codigoServicioVenta ?? "").trim(),
      tipoServicioVenta: String(raw.tipoServicioVenta ?? "").trim(),
      disponibilidad,
    };
  });
}

function servicePresent(
  lines: SalidaServicioLine[],
  codigo: string,
  tipo: string
) {
  const k = lineKey(codigo, tipo);
  return lines.some(
    (s) => lineKey(s.codigoServicioVenta, s.tipoServicioVenta) === k
  );
}

function ouiNon(v: boolean) {
  return v ? "oui" : "non";
}

const FIXED_HORA = "2130";

const SCENARIO = {
  origen: "ALG",
  destino: "PTM",
  fechaSalida: "20260413",
  horaSalida: FIXED_HORA,
  cantidad: 1,
  tipoPasajero: "A",
  bonificacion: "G",
  sentidoSalida: 1,
  vehiclesCount: 1,
  vehicle: "car",
  vehicleCategory: "small_tourism_car_trailer",
  vehiclePassengerIndex: 0,
  vehicleData: {
    marque: "VEHICULE STANDARD",
    modele: "MODELE",
    immatriculation: "TEMP123",
    alto: 1.85,
    ancho: 1.8,
    largo: 8,
  },
  companionCodigo: "VR",
  companionTipo: "V",
} as const;

const PRIMARY_PRIMARIES: Array<{ codigoServicioVenta: string; tipoServicioVenta: string }> =
  [
    { codigoServicioVenta: "BY", tipoServicioVenta: "P" },
    { codigoServicioVenta: "P", tipoServicioVenta: "P" },
    { codigoServicioVenta: "BP", tipoServicioVenta: "P" },
    { codigoServicioVenta: "BV", tipoServicioVenta: "P" },
    { codigoServicioVenta: "D", tipoServicioVenta: "P" },
    { codigoServicioVenta: "J", tipoServicioVenta: "P" },
    { codigoServicioVenta: "T", tipoServicioVenta: "P" },
    { codigoServicioVenta: "Q", tipoServicioVenta: "P" },
    { codigoServicioVenta: "I", tipoServicioVenta: "P" },
    { codigoServicioVenta: "SU", tipoServicioVenta: "P" },
  ];

export async function GET() {
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

  try {
    const salidasResult = await nasaSalidasRequest(
      SCENARIO.origen,
      SCENARIO.destino,
      SCENARIO.fechaSalida
    );
    const allSalidas = extractSalidasFromNasaResult(salidasResult);
    const matched = allSalidas.filter((s) => normHora(s.horaSalida) === FIXED_HORA);

    if (matched.length === 0) {
      return NextResponse.json({
        ok: false,
        message: `Aucune salida avec horaSalida=${FIXED_HORA} pour ${SCENARIO.origen}→${SCENARIO.destino} le ${SCENARIO.fechaSalida}.`,
        scenario: SCENARIO,
        salidasCount: allSalidas.length,
        combinations: [],
      });
    }

    const salida = matched[0];
    const salidaServicios = extractServiciosFromSalida(salida);

    const rows: Record<string, unknown>[] = [];

    for (const primary of PRIMARY_PRIMARIES) {
      if (
        !isPrimaryServiceEligibleForVehicleCompanionPricing({
          codigoServicioVenta: primary.codigoServicioVenta,
          tipoServicioVenta: primary.tipoServicioVenta,
        })
      ) {
        rows.push({
          primaryCodigo: primary.codigoServicioVenta,
          primaryTipo: primary.tipoServicioVenta,
          companionCodigo: SCENARIO.companionCodigo,
          companionTipo: SCENARIO.companionTipo,
          skipped: true,
          skipReason: "Primaire non éligible au combiné (ex. tipo X ou code bloqué).",
        });
        continue;
      }

      const params = {
        origen: SCENARIO.origen,
        destino: SCENARIO.destino,
        fechaSalida: SCENARIO.fechaSalida,
        horaSalida: SCENARIO.horaSalida,
        cantidad: SCENARIO.cantidad,
        codigoServicioVenta: primary.codigoServicioVenta,
        tipoServicioVenta: primary.tipoServicioVenta,
        tipoPasajero: SCENARIO.tipoPasajero,
        bonificacion: SCENARIO.bonificacion,
        sentidoSalida: SCENARIO.sentidoSalida,
        vehicle: SCENARIO.vehicle,
        vehicleCategory: SCENARIO.vehicleCategory,
        vehiclePassengerIndex: SCENARIO.vehiclePassengerIndex,
        vehicleData: { ...SCENARIO.vehicleData },
        companionServicioVenta: {
          codigoServicioVenta: SCENARIO.companionCodigo,
          tipoServicioVenta: SCENARIO.companionTipo,
          cantidad: 1,
        },
      };

      const soapArgs = buildNasaTarificacionesSoapArgs(params);
      const vehiculoEntidad = extractPricingVehiculoEntidad(soapArgs) ?? null;

      const primaryPresent = servicePresent(
        salidaServicios,
        primary.codigoServicioVenta,
        primary.tipoServicioVenta
      );
      const companionPresent = servicePresent(
        salidaServicios,
        SCENARIO.companionCodigo,
        SCENARIO.companionTipo
      );
      const presentOnSalida = primaryPresent && companionPresent;

      let result: unknown;
      let armasCodigo: string | undefined;
      let armasTexto: string | undefined;
      let total: number | null = null;
      let tariffError: string | undefined;

      try {
        result = await nasaTarificacionesRequest(params);
        const meta = extractNasaTarificacionesReturnMeta(result);
        armasCodigo = meta.codigo;
        armasTexto = meta.texto;
        total = sumPrecioTotalFromNasaTarificacionesResult(result);
      } catch (e) {
        tariffError = e instanceof Error ? e.message : String(e);
      }

      const linesNorm = result
        ? normalizeNasaTarificacionesLines(result)
        : [];
      const availableOnSalida =
        !tariffError &&
        total != null &&
        linesNorm.length > 0 &&
        !(armasCodigo && /^TF/i.test(armasCodigo.trim()));
        const salidaEntidadRaw = soapArgs.salidasEntidad?.salidaEntidad;
        const salidaEntidad = Array.isArray(salidaEntidadRaw)
          ? salidaEntidadRaw[0]
          : salidaEntidadRaw;
          
      rows.push({
        primaryCodigo: primary.codigoServicioVenta,
        primaryTipo: primary.tipoServicioVenta,
        companionCodigo: SCENARIO.companionCodigo,
        companionTipo: SCENARIO.companionTipo,
        presentOnSalida: ouiNon(presentOnSalida),
        availableOnSalida: ouiNon(!!availableOnSalida),
        armasCodigo: armasCodigo ?? null,
        armasTexto: armasTexto ?? null,
        total,
        tariffError: tariffError ?? null,
        soapArgs,
        const salidaEntidadRaw = soapArgs.salidasEntidad?.salidaEntidad;
const salidaEntidad = Array.isArray(salidaEntidadRaw)
  ? salidaEntidadRaw[0]
  : salidaEntidadRaw;
        vehiculoEntidad,
        tarificacionesNormalized: linesNorm,
      });
    }

    return NextResponse.json({
      ok: true,
      message: `Matrice combiné passager + VR|V pour une seule salida (${FIXED_HORA}).`,
      scenario: SCENARIO,
      salidaMeta: {
        horaSalidaRaw: salida.horaSalida ?? null,
        horaSalidaNorm: normHora(salida.horaSalida),
        serviciosOnSalidaCount: salidaServicios.length,
      },
      combinations: rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue";
    return NextResponse.json(
      {
        ok: false,
        message: "Échec du diagnostic (salidas ou tarificaciones).",
        error: message,
        scenario: SCENARIO,
      },
      { status: 500 }
    );
  }
}
