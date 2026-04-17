/**
 * Appel unique `/api/armas/test-pricing` + résultat métier structuré.
 *
 * Implémentation strictement alignée sur les fichiers Armas fournis :
 * - lecture directe des montants WSDL `precioEntidad` / `precioIdaEntidad` / `precioVtaEntidad`
 * - aucune majoration HT/TTC implicite côté client
 * - pour un AR combiné, le total affiché reste le forfait WSDL (`combined`) ;
 *   la ventilation aller / retour n'est utilisée que si elle est démontrée cohérente
 */
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  type ArmasTarificacionLegMode,
  describeTarificacionPrecioBlocksPresence,
  extractTarificacionAmountCandidates,
  getNasaTarificacionesReturnNode,
  getTarificacionRawLinesFromSoapResult,
  resolveArmasRoundTripPriceBreakdown,
  resolveArmasTarificacionLegMode,
  sumPrecioBlocksFromNasaTarificacionesResult,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";
import { applyConsumerTtcToEuros } from "@/lib/armas/consumer-ttc-multiplier";
import { isArmasRtPricingDebugEnabled } from "@/lib/armas/rt-pricing-debug";
import type { NormalizedPrimaryVehicle } from "@/lib/vehicle/normalize";

function formatMoneyEuros(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function closeTo(a: number, b: number, eps = 0.03): boolean {
  return Math.abs(a - b) <= eps;
}

export type FetchTransportPricingOptions = {
  requestId?: string;
  tripType?: "one_way" | "round_trip";
  armasLeg?: "outbound" | "inbound";
  selectedOutboundSegment?: {
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
    barco?: string;
    serviceCode?: string;
    serviceType?: string;
    segmentKey?: string;
  };
  selectedInboundSegment?: {
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
    barco?: string;
    serviceCode?: string;
    serviceType?: string;
    segmentKey?: string;
  };
  debugSelectionContext?: {
    accommodationOrServiceLabel?: string;
    serviceCode?: string;
    serviceType?: string;
  };
  returnSegment?: TarificacionRequestBody["returnSegment"];
};

function firstTarificacionPrecioSnapshot(soapData: unknown): unknown {
  const lines = getTarificacionRawLinesFromSoapResult(soapData);
  const first = lines[0] as Record<string, unknown> | undefined;
  if (!first) return null;
  return {
    precioEntidad: first.precioEntidad,
    precioIdaEntidad: first.precioIdaEntidad,
    precioVtaEntidad: first.precioVtaEntidad,
  };
}

function resolveDisplayedAmountChosenPath(
  candidates: Array<{ path: string; parsedValue: number | null }>,
  amount: number,
  legMode: ArmasTarificacionLegMode
): string | null {
  const exact = candidates.filter(
    (candidate) =>
      candidate.parsedValue != null && closeTo(candidate.parsedValue, amount)
  );

  if (legMode === "ida_leg") {
    return (
      exact.find((candidate) => candidate.path.includes("precioIdaEntidad"))
        ?.path ??
      exact[0]?.path ??
      null
    );
  }

  if (legMode === "vta_leg") {
    return (
      exact.find((candidate) => candidate.path.includes("precioVtaEntidad"))
        ?.path ??
      exact[0]?.path ??
      null
    );
  }

  return (
    exact.find((candidate) => candidate.path.includes("precioEntidad"))?.path ??
    exact[0]?.path ??
    null
  );
}

function buildPricingRtDebugPayload(
  options?: FetchTransportPricingOptions
):
  | {
      requestId?: string;
      tripType: "one_way" | "round_trip";
      armasLeg?: "outbound" | "inbound";
      selectedOutboundSegment?: FetchTransportPricingOptions["selectedOutboundSegment"];
      selectedInboundSegment?: FetchTransportPricingOptions["selectedInboundSegment"];
    }
  | undefined {
  if (!options?.tripType) return undefined;
  return {
    requestId: options.requestId,
    tripType: options.tripType,
    ...(options.armasLeg ? { armasLeg: options.armasLeg } : {}),
    ...(options.selectedOutboundSegment
      ? { selectedOutboundSegment: options.selectedOutboundSegment }
      : {}),
    ...(options.selectedInboundSegment
      ? { selectedInboundSegment: options.selectedInboundSegment }
      : {}),
  };
}

export type TransportPricingClientSuccess = {
  ok: true;
  totalEuros: number | null;
  totalFormatted: string;
  outboundEuros?: number | null;
  returnEuros?: number | null;
  roundTripTotalEuros?: number | null;
  segmentVentilationReliable?: boolean;
  armasTarificacionLegMode: ArmasTarificacionLegMode;
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
  soapData: unknown;
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
  xrPricingTrace?: unknown;
};

export async function fetchTransportPricing(
  body: TarificacionRequestBody,
  normalizedVehicleUsed: NormalizedPrimaryVehicle | null,
  options?: FetchTransportPricingOptions
): Promise<TransportPricingClientResult> {
  const pricingRtDebug = buildPricingRtDebugPayload(options);

  let response: Response;
  try {
    response = await fetch("/api/armas/test-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        ...(options?.returnSegment
          ? { returnSegment: options.returnSegment }
          : {}),
        ...(pricingRtDebug ? { pricingRtDebug } : {}),
      }),
      cache: "no-store",
    });
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Réseau indisponible.",
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
      error: json.error || json.message || "Tarification indisponible.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  const soapData = json.data;
  const retMeta = getNasaTarificacionesReturnNode(soapData);
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

  const legMode = resolveArmasTarificacionLegMode(
    options?.tripType,
    options?.armasLeg
  );
  const isRoundTripCombinedSoap =
    options?.tripType === "round_trip" && Boolean(options?.returnSegment);

  const blockSums = sumPrecioBlocksFromNasaTarificacionesResult(soapData);
  const precioPresence = describeTarificacionPrecioBlocksPresence(soapData);
  const idaSegment = sumPrecioTotalFromNasaTarificacionesResult(
    soapData,
    "ida_leg"
  );
  const vtaSegment = sumPrecioTotalFromNasaTarificacionesResult(
    soapData,
    "vta_leg"
  );
  const combinedSegment = sumPrecioTotalFromNasaTarificacionesResult(
    soapData,
    "combined"
  );
  const rtBreakdown = isRoundTripCombinedSoap
    ? resolveArmasRoundTripPriceBreakdown(soapData)
    : null;

  let displayedTotal = sumPrecioTotalFromNasaTarificacionesResult(
    soapData,
    legMode
  );
  let outboundEuros: number | null = idaSegment;
  let returnEuros: number | null = vtaSegment;
  let roundTripTotalEuros: number | null = combinedSegment;
  let segmentVentilationReliable = false;

  if (isRoundTripCombinedSoap) {
    if (rtBreakdown?.bundleTotalEuros != null) {
      displayedTotal = rtBreakdown.bundleTotalEuros;
      roundTripTotalEuros = rtBreakdown.bundleTotalEuros;
      segmentVentilationReliable = rtBreakdown.segmentVentilationReliable;
      if (segmentVentilationReliable) {
        outboundEuros = rtBreakdown.idaSubtotalEuros;
        returnEuros = rtBreakdown.vtaSubtotalEuros;
      } else {
        outboundEuros = null;
        returnEuros = null;
      }
    }
  } else {
    roundTripTotalEuros =
      idaSegment !== null && vtaSegment !== null
        ? idaSegment + vtaSegment
        : combinedSegment;
    if (
      idaSegment !== null &&
      vtaSegment !== null &&
      combinedSegment !== null &&
      closeTo(idaSegment + vtaSegment, combinedSegment, 0.02)
    ) {
      segmentVentilationReliable = true;
    }
  }

  if (displayedTotal === null) {
    return {
      ok: false,
      error: "Aucun montant total retourné par Armas.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  const totalEuros = applyConsumerTtcToEuros(displayedTotal);
  const armasIdaSubtotalEuros = applyConsumerTtcToEuros(blockSums.idaSum);
  const armasVtaSubtotalEuros = applyConsumerTtcToEuros(blockSums.vtaSum);
  const armasPrecioEntidadSubtotalEuros = applyConsumerTtcToEuros(blockSums.peSum);
  outboundEuros = applyConsumerTtcToEuros(outboundEuros);
  returnEuros = applyConsumerTtcToEuros(returnEuros);
  roundTripTotalEuros = applyConsumerTtcToEuros(roundTripTotalEuros);

  if (totalEuros === null) {
    return {
      ok: false,
      error: "Aucun montant total retourné par Armas.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  if (isArmasRtPricingDebugEnabled()) {
    const candidates = extractTarificacionAmountCandidates(soapData);
    const chosenDisplayedAmountPath = resolveDisplayedAmountChosenPath(
      candidates,
      totalEuros,
      legMode
    );
    const matchesChosen = candidates.filter(
      (candidate) =>
        candidate.parsedValue != null &&
        closeTo(candidate.parsedValue, totalEuros)
    );
    console.info(
      "[SOLAIR_ARMAS_RT_PRICING_DEBUG] fetchTransportPricing",
      JSON.stringify(
        {
          tripType: options?.tripType ?? null,
          armasLeg: options?.armasLeg ?? null,
          armasTarificacionLegMode: legMode,
          isRoundTripCombinedSoap,
          segmentVentilationReliable,
          rtBreakdown,
          precioBlocksPresence: precioPresence,
          firstLinePrecio: firstTarificacionPrecioSnapshot(soapData),
          blockSums,
          idaSegment,
          vtaSegment,
          combinedSegment,
          displayedTotalEuros: totalEuros,
          displayedTotalFormatted: formatMoneyEuros(totalEuros),
          pricingInputContext: {
            requestId: options?.requestId ?? null,
            outboundSegment: options?.selectedOutboundSegment ?? null,
            inboundSegment: options?.selectedInboundSegment ?? null,
            passengers: {
              cantidad: body.cantidad,
              passengerTipos: body.passengerTipos ?? null,
              tipoPasajero: body.tipoPasajero,
            },
            residentBonificationCode: body.bonificacion,
            vehicle: {
              hasVehicle:
                Boolean(body.vehicle && body.vehicle !== "none") ||
                Boolean(body.vehicleCategory && body.vehicleCategory !== "none"),
              vehicle: body.vehicle ?? null,
              vehicleCategory: body.vehicleCategory ?? null,
              companionServicioVenta: body.companionServicioVenta ?? null,
              vehicleData: body.vehicleData ?? null,
            },
            selectedService: {
              serviceCode:
                options?.debugSelectionContext?.serviceCode ??
                body.codigoServicioVenta,
              serviceType:
                options?.debugSelectionContext?.serviceType ??
                body.tipoServicioVenta,
              accommodationOrServiceLabel:
                options?.debugSelectionContext?.accommodationOrServiceLabel ??
                null,
            },
          },
          displayedAmountChosenPath: chosenDisplayedAmountPath,
          amountCandidatesMatchingChosen: matchesChosen,
        },
        null,
        0
      )
    );
  }

  const companion = body.companionServicioVenta;
  return {
    ok: true,
    totalEuros,
    totalFormatted: formatMoneyEuros(totalEuros),
    outboundEuros,
    returnEuros,
    roundTripTotalEuros,
    segmentVentilationReliable: isRoundTripCombinedSoap
      ? segmentVentilationReliable
      : undefined,
    armasTarificacionLegMode: legMode,
    armasIdaSubtotalEuros,
    armasVtaSubtotalEuros,
    armasPrecioEntidadSubtotalEuros,
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
    soapData,
    xrPricingTrace: json.xrPricingTrace,
  };
}
