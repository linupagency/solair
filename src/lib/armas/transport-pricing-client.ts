/**
 * Appel unique `/api/armas/test-pricing` + résultat métier structuré (tunnel client).
 */
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  type ArmasTarificacionLegMode,
  getNasaTarificacionesReturnNode,
  getTarificacionRawLinesFromSoapResult,
  sumPrecioBlocksFromNasaTarificacionesResult,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";
import type { NormalizedPrimaryVehicle } from "@/lib/vehicle/normalize";

function formatMoneyEuros(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export type FetchTransportPricingOptions = {
  tripType?: "one_way" | "round_trip";
  /** Avec `tripType: round_trip`, sélectionne le bloc WSDL lu par appel (aller vs retour). */
  armasLeg?: "outbound" | "inbound";
};

function resolveArmasLegMode(
  tripType: FetchTransportPricingOptions["tripType"],
  armasLeg: FetchTransportPricingOptions["armasLeg"]
): ArmasTarificacionLegMode {
  if (tripType === "round_trip" && armasLeg === "outbound") return "ida_leg";
  if (tripType === "round_trip" && armasLeg === "inbound") return "vta_leg";
  return "combined";
}

function rtPricingDebugEnabled(): boolean {
  return process.env.SOLAIR_ARMAS_RT_PRICING_DEBUG === "1";
}

function firstTarificacionPrecioSnapshot(soapData: unknown): unknown {
  const lines = getTarificacionRawLinesFromSoapResult(soapData);
  const first = lines[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  const pick = (k: string) => first[k];
  return {
    precioEntidad: pick("precioEntidad"),
    precioIdaEntidad: pick("precioIdaEntidad"),
    precioVtaEntidad: pick("precioVtaEntidad"),
  };
}

export type TransportPricingClientSuccess = {
  ok: true;
  totalEuros: number | null;
  totalFormatted: string;
  /** Mode effectif de lecture des blocs `precioIdaEntidad` / `precioVtaEntidad`. */
  armasTarificacionLegMode: ArmasTarificacionLegMode;
  /** Sommes des `total` WSDL par bloc (toutes lignes tarifaires). */
  armasIdaSubtotalEuros: number | null;
  armasVtaSubtotalEuros: number | null;
  armasPrecioEntidadSubtotalEuros: number | null;
  armasCodigo: string;
  armasTexto: string;
  primaryService: {
    codigoServicioVenta: string;
    tipoServicioVenta: string;
  };
  vehicleCompanion: {
    codigoServicioVenta: string;
    tipoServicioVenta: string;
  } | null;
  normalizedVehicleUsed: NormalizedPrimaryVehicle | null;
  requestBody: TarificacionRequestBody;
  /** Nœud SOAP brut `data` de `/api/armas/test-pricing` (lignes tarifaires, etc.). */
  soapData: unknown;
  /** Copie serveur du trace XR (debug). */
  xrPricingTrace?: unknown;
};

export type TransportPricingClientFailure = {
  ok: false;
  error: string;
  requestBody: TarificacionRequestBody;
  httpStatus?: number;
};

export type TransportPricingClientResult =
  | TransportPricingClientSuccess
  | TransportPricingClientFailure;

type PricingApiJson = {
  ok?: boolean;
  message?: string;
  error?: string;
  data?: unknown;
  /** Présent si `NEXT_PUBLIC_SOLAIR_XR_PRICING_TRACE=1` et catégorie grande remorque. */
  xrPricingTrace?: unknown;
};

export async function fetchTransportPricing(
  body: TarificacionRequestBody,
  normalizedVehicleUsed: NormalizedPrimaryVehicle | null,
  options?: FetchTransportPricingOptions
): Promise<TransportPricingClientResult> {
  let response: Response;
  try {
    response = await fetch("/api/armas/test-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Réseau indisponible.",
      requestBody: body,
    };
  }

  let json: PricingApiJson;
  try {
    json = (await response.json()) as PricingApiJson;
  } catch {
    return {
      ok: false,
      error: "Réponse JSON invalide.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  if (!response.ok || !json.ok) {
    return {
      ok: false,
      error:
        json.error ||
        json.message ||
        "Tarification indisponible.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  const retMeta = getNasaTarificacionesReturnNode(json.data);
  const armasCodigo =
    retMeta?.codigo != null ? String(retMeta.codigo).trim() : "";
  const armasTexto =
    retMeta?.texto != null ? String(retMeta.texto).trim() : "";

  if (armasCodigo && /^TF/i.test(armasCodigo)) {
    return {
      ok: false,
      error: armasTexto || armasCodigo,
      requestBody: body,
      httpStatus: response.status,
    };
  }

  const legMode = resolveArmasLegMode(options?.tripType, options?.armasLeg);
  const blockSums = sumPrecioBlocksFromNasaTarificacionesResult(json.data);
  const sumTotal = sumPrecioTotalFromNasaTarificacionesResult(json.data, legMode);
  if (sumTotal === null) {
    return {
      ok: false,
      error: "Aucun montant total retourné par Armas.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  if (rtPricingDebugEnabled()) {
    console.info(
      "[SOLAIR_ARMAS_RT_PRICING_DEBUG]",
      JSON.stringify(
        {
          tripType: options?.tripType ?? null,
          armasLeg: options?.armasLeg ?? null,
          armasTarificacionLegMode: legMode,
          firstLinePrecio: firstTarificacionPrecioSnapshot(json.data),
          blockSums,
          totalEurosRetained: sumTotal,
          totalFormatted: formatMoneyEuros(sumTotal),
        },
        null,
        0
      )
    );
  }

  const companion = body.companionServicioVenta;
  return {
    ok: true,
    totalEuros: sumTotal,
    totalFormatted: formatMoneyEuros(sumTotal),
    armasTarificacionLegMode: legMode,
    armasIdaSubtotalEuros: blockSums.idaSum,
    armasVtaSubtotalEuros: blockSums.vtaSum,
    armasPrecioEntidadSubtotalEuros: blockSums.peSum,
    armasCodigo,
    armasTexto,
    primaryService: {
      codigoServicioVenta: body.codigoServicioVenta,
      tipoServicioVenta: body.tipoServicioVenta,
    },
    vehicleCompanion: companion
      ? {
          codigoServicioVenta: companion.codigoServicioVenta,
          tipoServicioVenta: companion.tipoServicioVenta,
        }
      : null,
    normalizedVehicleUsed,
    requestBody: body,
    soapData: json.data,
    xrPricingTrace: json.xrPricingTrace,
  };
}
