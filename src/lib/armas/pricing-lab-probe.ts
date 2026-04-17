/**
 * Phase 1 — laboratoire `pricing-lab-probe` (spécification probe, pas le tunnel réservation).
 */
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  buildNasaTarificacionesSoapArgs,
  extractNasaTarificacionesReturnMeta,
  type NasaTarificacionesRequestParams,
  type NasaTarificacionesSoapArgs,
} from "@/lib/armas/client";
import { prepareNasaPricingCall } from "@/lib/armas/prepare-nasa-pricing-call";
import {
  normalizeNasaTarificacionesLines,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";

export const PRICING_LAB_PROBE_SPEC_VERSION = "1" as const;

export type ProbeVerdictStatus =
  | "OK"
  | "ARMAS_ERROR"
  | "PROBE_ERROR"
  | "INVALID_INPUT";

export type ProbeVerdict = {
  status: ProbeVerdictStatus;
  code: string;
  message: string;
};

/** Overrides autorisés : uniquement ces deux sous-arbres. */
export type PricingLabSoapOverrides = {
  serviciosVentasEntidad?: {
    servicioVentaEntidad: unknown;
  };
  paxsVehsEntidad?: {
    paxVehEntidad: unknown;
  };
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Valide `soapOverrides` : clés top-level uniquement `serviciosVentasEntidad` | `paxsVehsEntidad`,
 * et sous-clés strictes `servicioVentaEntidad` / `paxVehEntidad`.
 */
export function parseStrictSoapOverrides(
  raw: unknown
): { ok: true; value: PricingLabSoapOverrides | null } | { ok: false; error: string } {
  if (raw == null) return { ok: true, value: null };
  if (!isPlainObject(raw)) {
    return { ok: false, error: "soapOverrides doit être un objet ou null." };
  }
  const keys = Object.keys(raw);
  const allowedTop = new Set(["serviciosVentasEntidad", "paxsVehsEntidad"]);
  for (const k of keys) {
    if (!allowedTop.has(k)) {
      return {
        ok: false,
        error: `soapOverrides : clé interdite « ${k} » (autorisé : serviciosVentasEntidad, paxsVehsEntidad).`,
      };
    }
  }
  const out: PricingLabSoapOverrides = {};
  if (raw.serviciosVentasEntidad !== undefined && raw.serviciosVentasEntidad !== null) {
    if (!isPlainObject(raw.serviciosVentasEntidad)) {
      return { ok: false, error: "serviciosVentasEntidad doit être un objet." };
    }
    const sk = Object.keys(raw.serviciosVentasEntidad);
    if (sk.length !== 1 || sk[0] !== "servicioVentaEntidad") {
      return {
        ok: false,
        error:
          "serviciosVentasEntidad ne doit contenir que la clé servicioVentaEntidad.",
      };
    }
    out.serviciosVentasEntidad = {
      servicioVentaEntidad: raw.serviciosVentasEntidad.servicioVentaEntidad,
    };
  }
  if (raw.paxsVehsEntidad !== undefined && raw.paxsVehsEntidad !== null) {
    if (!isPlainObject(raw.paxsVehsEntidad)) {
      return { ok: false, error: "paxsVehsEntidad doit être un objet." };
    }
    const pk = Object.keys(raw.paxsVehsEntidad);
    if (pk.length !== 1 || pk[0] !== "paxVehEntidad") {
      return {
        ok: false,
        error: "paxsVehsEntidad ne doit contenir que la clé paxVehEntidad.",
      };
    }
    out.paxsVehsEntidad = {
      paxVehEntidad: raw.paxsVehsEntidad.paxVehEntidad,
    };
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

export function mergeProbeSoapOverrides(
  base: NasaTarificacionesSoapArgs,
  overrides: PricingLabSoapOverrides | null
): NasaTarificacionesSoapArgs {
  const merged = JSON.parse(JSON.stringify(base)) as NasaTarificacionesSoapArgs;
  if (!overrides) return merged;

  if (overrides.serviciosVentasEntidad) {
    const salidaEntidadRaw = merged.salidasEntidad?.salidaEntidad;
    const salidaEntidad = Array.isArray(salidaEntidadRaw)
      ? salidaEntidadRaw[0]
      : salidaEntidadRaw;

      if (salidaEntidad) {
        salidaEntidad.serviciosVentasEntidad = {
          servicioVentaEntidad:
            overrides.serviciosVentasEntidad.servicioVentaEntidad as any,
        };
      }
  }

  if (overrides.paxsVehsEntidad) {
    merged.paxsVehsEntidad = {
      ...merged.paxsVehsEntidad,
      paxVehEntidad:
        overrides.paxsVehsEntidad.paxVehEntidad as NasaTarificacionesSoapArgs["paxsVehsEntidad"]["paxVehEntidad"],
    };
  }

  return merged;
}
  

function normalizeString(v: unknown, field: string): string | { error: string } {
  if (v == null || v === "") return { error: `${field} requis.` };
  if (typeof v !== "string") return { error: `${field} doit être une chaîne.` };
  const t = v.trim();
  if (!t) return { error: `${field} requis.` };
  return t;
}

function normalizeNumber(v: unknown, field: string): number | { error: string } {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { error: `${field} doit être un nombre fini.` };
  }
  return v;
}

/**
 * Construit les paramètres `nasaTarificaciones` pour le mode B à partir du JSON brut.
 */
export function coerceNasaParamsFromProbeBody(
  raw: unknown
): { ok: true; params: NasaTarificacionesRequestParams } | { ok: false; error: string } {
  if (!isPlainObject(raw)) {
    return { ok: false, error: "params doit être un objet." };
  }
  const o = raw;
  const origen = normalizeString(o.origen, "origen");
  if (typeof origen === "object") return { ok: false, error: origen.error };
  const destino = normalizeString(o.destino, "destino");
  if (typeof destino === "object") return { ok: false, error: destino.error };
  const fechaSalida = normalizeString(o.fechaSalida, "fechaSalida");
  if (typeof fechaSalida === "object") return { ok: false, error: fechaSalida.error };
  const horaSalida = normalizeString(o.horaSalida, "horaSalida");
  if (typeof horaSalida === "object") return { ok: false, error: horaSalida.error };
  const cantidad = normalizeNumber(o.cantidad, "cantidad");
  if (typeof cantidad === "object") return { ok: false, error: cantidad.error };
  if (cantidad <= 0 || !Number.isInteger(cantidad)) {
    return { ok: false, error: "cantidad doit être un entier > 0." };
  }
  const codigoServicioVenta = normalizeString(
    o.codigoServicioVenta,
    "codigoServicioVenta"
  );
  if (typeof codigoServicioVenta === "object") {
    return { ok: false, error: codigoServicioVenta.error };
  }
  const tipoServicioVenta = normalizeString(
    o.tipoServicioVenta,
    "tipoServicioVenta"
  );
  if (typeof tipoServicioVenta === "object") {
    return { ok: false, error: tipoServicioVenta.error };
  }
  const tipoPasajero =
    typeof o.tipoPasajero === "string" && o.tipoPasajero.trim()
      ? o.tipoPasajero.trim()
      : "A";
  const bonificacion = normalizeString(o.bonificacion, "bonificacion");
  if (typeof bonificacion === "object") return { ok: false, error: bonificacion.error };

  const params: NasaTarificacionesRequestParams = {
    origen,
    destino,
    fechaSalida,
    horaSalida,
    cantidad,
    codigoServicioVenta,
    tipoServicioVenta,
    tipoPasajero,
    passengerTipos: Array.isArray(o.passengerTipos)
      ? o.passengerTipos.map((x) => String(x).trim()).filter(Boolean)
      : undefined,
    animalsCount:
      typeof o.animalsCount === "number" && Number.isFinite(o.animalsCount)
        ? Math.max(0, Math.floor(o.animalsCount))
        : undefined,
    bonificacion,
    sentidoSalida:
      typeof o.sentidoSalida === "number" && Number.isFinite(o.sentidoSalida)
        ? o.sentidoSalida
        : 1,
    vehicle:
      typeof o.vehicle === "string" && o.vehicle.trim()
        ? o.vehicle.trim()
        : undefined,
    vehicleCategory:
      typeof o.vehicleCategory === "string" && o.vehicleCategory.trim()
        ? o.vehicleCategory.trim()
        : undefined,
    vehiclePassengerIndex:
      typeof o.vehiclePassengerIndex === "number" &&
      Number.isFinite(o.vehiclePassengerIndex)
        ? Math.floor(o.vehiclePassengerIndex)
        : undefined,
    vehicleData: isPlainObject(o.vehicleData) ? (o.vehicleData as TarificacionRequestBody["vehicleData"]) : undefined,
    companionServicioVenta: isPlainObject(o.companionServicioVenta)
      ? {
          codigoServicioVenta: String(
            o.companionServicioVenta.codigoServicioVenta ?? ""
          ).trim(),
          tipoServicioVenta: String(
            o.companionServicioVenta.tipoServicioVenta ?? ""
          ).trim(),
          cantidad:
            typeof o.companionServicioVenta.cantidad === "number"
              ? o.companionServicioVenta.cantidad
              : undefined,
        }
      : undefined,
    rawTrailerLength:
      o.rawTrailerLength === true
        ? true
        : o.rawTrailerLength === false
          ? false
          : undefined,
    pricingSoapTrace: o.pricingSoapTrace === true,
  };

  if (
    !params.companionServicioVenta?.codigoServicioVenta ||
    !params.companionServicioVenta?.tipoServicioVenta
  ) {
    params.companionServicioVenta = undefined;
  }

  return { ok: true, params };
}

function isTfArmasCodigo(codigo: string | null | undefined): boolean {
  const c = (codigo ?? "").trim();
  return c.length > 0 && /^TF/i.test(c);
}

export type ProbeResponsePayload = {
  ok: boolean;
  probeSpecVersion: typeof PRICING_LAB_PROBE_SPEC_VERSION;
  mode?: "A" | "B";
  scenarioId?: string;
  label?: string | null;
  inputEcho: Record<string, unknown>;
  soapArgs: NasaTarificacionesSoapArgs | null;
  armasReturn: { codigo: string | null; texto: string | null };
  rawResult: unknown;
  normalizedLines: ReturnType<typeof normalizeNasaTarificacionesLines>;
  total: number | null;
  verdict: ProbeVerdict;
  transportAccepted: boolean;
  pricingUsable: boolean;
};

export function buildProbeOutcome(args: {
  mode: "A" | "B";
  scenarioId: string;
  label: string | null;
  inputEcho: Record<string, unknown>;
  soapArgs: NasaTarificacionesSoapArgs | null;
  rawResult: unknown;
  errorBeforeSoap?: string;
  soapExceptionMessage?: string;
}): ProbeResponsePayload {
  const baseEcho = { ...args.inputEcho, probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION };
  const emptyLines = [] as ReturnType<typeof normalizeNasaTarificacionesLines>;

  if (args.errorBeforeSoap) {
    return {
      ok: false,
      probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
      mode: args.mode,
      scenarioId: args.scenarioId,
      label: args.label,
      inputEcho: baseEcho,
      soapArgs: args.soapArgs,
      armasReturn: { codigo: null, texto: null },
      rawResult: null,
      normalizedLines: emptyLines,
      total: null,
      verdict: {
        status: "INVALID_INPUT",
        code: "INVALID_INPUT",
        message: args.errorBeforeSoap,
      },
      transportAccepted: false,
      pricingUsable: false,
    };
  }

  if (args.soapExceptionMessage) {
    return {
      ok: false,
      probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
      mode: args.mode,
      scenarioId: args.scenarioId,
      label: args.label,
      inputEcho: baseEcho,
      soapArgs: args.soapArgs,
      armasReturn: { codigo: null, texto: null },
      rawResult: null,
      normalizedLines: emptyLines,
      total: null,
      verdict: {
        status: "PROBE_ERROR",
        code: "SOAP_CALL_FAILED",
        message: args.soapExceptionMessage,
      },
      transportAccepted: false,
      pricingUsable: false,
    };
  }

  const rawResult = args.rawResult;
  const meta = extractNasaTarificacionesReturnMeta(rawResult);
  const codigo = meta.codigo != null ? String(meta.codigo).trim() : null;
  const texto = meta.texto != null ? String(meta.texto).trim() : null;
  const normalizedLines = normalizeNasaTarificacionesLines(rawResult);
  const total = sumPrecioTotalFromNasaTarificacionesResult(rawResult);
  const tf = isTfArmasCodigo(codigo);
  const transportAccepted = !tf;
  const pricingUsable =
    total !== null && normalizedLines.length > 0;

  let verdict: ProbeVerdict;
  if (tf) {
    verdict = {
      status: "ARMAS_ERROR",
      code: "ARMAS_TF",
      message: texto || codigo || "Rejet tarifaire Armas (TF*).",
    };
  } else if (total === null) {
    verdict = {
      status: "OK",
      code: "TOTAL_MISSING",
      message:
        "Appel SOAP terminé sans code TF bloquant ; total non extrait des tarifications.",
    };
  } else {
    verdict = {
      status: "OK",
      code: "SUCCESS",
      message: "Réponse Armas analysée ; total extrait.",
    };
  }

  return {
    ok: !tf,
    probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
    mode: args.mode,
    scenarioId: args.scenarioId,
    label: args.label,
    inputEcho: baseEcho,
    soapArgs: args.soapArgs!,
    armasReturn: { codigo, texto },
    rawResult,
    normalizedLines,
    total,
    verdict,
    transportAccepted,
    pricingUsable,
  };
}

export function runModeAFlow(body: TarificacionRequestBody): {
  params: NasaTarificacionesRequestParams;
  soapArgs: NasaTarificacionesSoapArgs;
} {
  const params = prepareNasaPricingCall(body);
  const soapArgs = buildNasaTarificacionesSoapArgs(params);
  return { params, soapArgs };
}
