/**
 * Appel unique `/api/armas/test-pricing` + résultat métier structuré (tunnel client).
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
import { isArmasRtPricingDebugEnabled } from "@/lib/armas/rt-pricing-debug";
import {
  applyConsumerTtcToEuros,
  getConsumerTtcMultiplier,
} from "@/lib/armas/consumer-ttc-multiplier";
import type { NormalizedPrimaryVehicle } from "@/lib/vehicle/normalize";

function formatMoneyEuros(n: number): string {
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export type FetchTransportPricingOptions = {
  requestId?: string;
  tripType?: "one_way" | "round_trip";
  /** Avec `tripType: round_trip`, sélectionne le bloc WSDL lu par appel (aller vs retour). */
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
  /** Segment retour envoyé dans la même requête SOAP pour une vraie tarification AR. */
  returnSegment?: TarificacionRequestBody["returnSegment"];
};

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

function closeTo(a: number, b: number, eps = 0.03) {
  return Math.abs(a - b) <= eps;
}

function resolveDisplayedAmountChosenPath(
  candidates: Array<{ path: string; parsedValue: number | null }>,
  amount: number,
  legMode: ArmasTarificacionLegMode
): string | null {
  const exact = candidates.filter(
    (c) => c.parsedValue != null && closeTo(c.parsedValue, amount)
  );
  const byMode =
    legMode === "ida_leg"
      ? exact.find((c) => c.path.includes("precioIdaEntidad"))
      : legMode === "vta_leg"
        ? exact.find((c) => c.path.includes("precioVtaEntidad"))
        : exact.find((c) => c.path.includes("precioEntidad"));
  return byMode?.path ?? exact[0]?.path ?? null;
}

export type TransportPricingClientSuccess = {
  ok: true;
  totalEuros: number | null;
  totalFormatted: string;
  outboundEuros?: number | null;
  returnEuros?: number | null;
  roundTripTotalEuros?: number | null;
  /**
   * True si les sous-totaux ida/vta (somme des lignes) coïncident avec le total « combined »
   * (forfait WSDL). Sinon le total à payer / afficher reste `roundTripTotalEuros`, sans ventilation fiable.
   */
  segmentVentilationReliable?: boolean;
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
  const pricingRtDebug =
    options?.tripType && options.armasLeg
      ? {
          requestId: options.requestId,
          tripType: options.tripType,
          armasLeg: options.armasLeg,
          selectedOutboundSegment: options.selectedOutboundSegment,
          selectedInboundSegment: options.selectedInboundSegment,
        }
      : options?.tripType
        ? {
            requestId: options.requestId,
            tripType: options.tripType,
            selectedOutboundSegment: options.selectedOutboundSegment,
            selectedInboundSegment: options.selectedInboundSegment,
          }
        : undefined;

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

  const legMode = resolveArmasTarificacionLegMode(
    options?.tripType,
    options?.armasLeg
  );
  const blockSums = sumPrecioBlocksFromNasaTarificacionesResult(json.data);
  const precioPresence = describeTarificacionPrecioBlocksPresence(json.data);
  const idaSegment = sumPrecioTotalFromNasaTarificacionesResult(json.data, "ida_leg");
  const vtaSegment = sumPrecioTotalFromNasaTarificacionesResult(json.data, "vta_leg");
  const combinedSegment = sumPrecioTotalFromNasaTarificacionesResult(
    json.data,
    "combined"
  );
  const isRoundTripCombinedSoap =
    options?.tripType === "round_trip" && Boolean(options?.returnSegment);
  const rtBreakdown = isRoundTripCombinedSoap
    ? resolveArmasRoundTripPriceBreakdown(json.data)
    : null;

  let sumTotal = sumPrecioTotalFromNasaTarificacionesResult(json.data, legMode);
  let outboundEuros: number | null = idaSegment;
  let returnEuros: number | null = vtaSegment;
  let roundTripTotalEuros: number | null = combinedSegment;
  let segmentVentilationReliable = false;

  if (isRoundTripCombinedSoap && rtBreakdown?.bundleTotalEuros != null) {
    roundTripTotalEuros = rtBreakdown.bundleTotalEuros;
    sumTotal = rtBreakdown.bundleTotalEuros;
    segmentVentilationReliable = rtBreakdown.segmentVentilationReliable;
    if (rtBreakdown.segmentVentilationReliable) {
      outboundEuros = rtBreakdown.idaSubtotalEuros;
      returnEuros = rtBreakdown.vtaSubtotalEuros;
    } else {
      outboundEuros = null;
      returnEuros = null;
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
      Math.abs(idaSegment + vtaSegment - combinedSegment) <= 0.02
    ) {
      segmentVentilationReliable = true;
    }
  }

  if (sumTotal === null) {
    return {
      ok: false,
      error: "Aucun montant total retourné par Armas.",
      requestBody: body,
      httpStatus: response.status,
    };
  }

  const consumerTtcMultiplier = getConsumerTtcMultiplier();
  const sumTotalSoapNet = sumTotal;
  sumTotal = applyConsumerTtcToEuros(sumTotal)!;
  outboundEuros = applyConsumerTtcToEuros(outboundEuros);
  returnEuros = applyConsumerTtcToEuros(returnEuros);
  roundTripTotalEuros = applyConsumerTtcToEuros(roundTripTotalEuros);
  const armasIdaSubtotalEuros = applyConsumerTtcToEuros(blockSums.idaSum);
  const armasVtaSubtotalEuros = applyConsumerTtcToEuros(blockSums.vtaSum);
  const armasPrecioEntidadSubtotalEuros = applyConsumerTtcToEuros(blockSums.peSum);

  if (isArmasRtPricingDebugEnabled()) {
    const candidates = extractTarificacionAmountCandidates(json.data);
    const chosenDisplayedAmount = sumTotal;
    const chosenDisplayedAmountPath = resolveDisplayedAmountChosenPath(
      candidates,
      chosenDisplayedAmount,
      legMode
    );
    const matchesChosen = candidates.filter(
      (c) => c.parsedValue != null && closeTo(c.parsedValue, chosenDisplayedAmount)
    );
    const around175 = candidates.filter(
      (c) => c.parsedValue != null && c.parsedValue >= 174.5 && c.parsedValue <= 175.5
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
          consumerTtcMultiplier,
          soapNetEurosRetained: sumTotalSoapNet,
          precioBlocksPresence: precioPresence,
          firstLinePrecio: firstTarificacionPrecioSnapshot(json.data),
          blockSums,
          idaSegment,
          vtaSegment,
          combinedSegment,
          segmentTotalEurosRetained: sumTotal,
          segmentTotalFormatted: formatMoneyEuros(sumTotal),
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
                options?.debugSelectionContext?.accommodationOrServiceLabel ?? null,
            },
          },
          displayedAmountChosen: chosenDisplayedAmount,
          displayedAmountChosenPath: chosenDisplayedAmountPath,
          amountCandidates: candidates,
          amountCandidatesMatchingChosen: matchesChosen,
          amountCandidatesAround175: around175,
          amountCandidatesAround25_95: candidates.filter(
            (c) => c.parsedValue != null && closeTo(c.parsedValue, 25.95)
          ),
          amountCandidatesAround30_00: candidates.filter(
            (c) => c.parsedValue != null && closeTo(c.parsedValue, 30)
          ),
          partialAmountHypothesis: {
            looksLikePartialWhen175Exists:
              around175.length > 0 && matchesChosen.length > 0
                ? !closeTo(chosenDisplayedAmount, around175[0].parsedValue ?? 0)
                : false,
          },
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
    soapData: json.data,
    xrPricingTrace: json.xrPricingTrace,
  };
}
