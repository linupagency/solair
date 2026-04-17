import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  buildNasaTarificacionesSoapArgs,
  extractPricingVehiculoEntidad,
  extractNasaTarificacionesReturnMeta,
  getSalidaSoapEntityAt,
  nasaTarificacionesRequestWithSoapArgs,
  trailerVehiculoEntidadModeFromFlag,
} from "@/lib/armas/client";
import {
  describeTarificacionPrecioBlocksPresence,
  extractTarificacionAmountCandidates,
  normalizeNasaTarificacionesLines,
  resolveArmasTarificacionLegMode,
  sumPrecioBlocksFromNasaTarificacionesResult,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";
import type {
  TarificacionRequestBody,
  TarificacionServiceLine,
} from "@/lib/armas/tarificacion-request-types";
import { prepareNasaPricingCall } from "@/lib/armas/prepare-nasa-pricing-call";
import { buildPricingSoapTraceEcho } from "@/lib/armas/pricing-soap-trace-echo";
import {
  buildXrPricingTraceRecord,
  isXrTraceTargetCategory,
  logXrPricingTraceServer,
  xrPricingTraceEnabled,
} from "@/lib/armas/xr-pricing-trace";

export type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";

function normalizeString(value: string | null | undefined) {
  return value?.trim() || "";
}

function parseQueryFlag(
  raw: string | null | undefined
): boolean | undefined {
  if (raw == null) return undefined;
  const s = normalizeString(raw).toLowerCase();
  if (!s) return undefined;
  if (s === "1" || s === "true" || s === "yes") return true;
  if (s === "0" || s === "false" || s === "no") return false;
  return undefined;
}

function coerceRawTrailerLength(v: unknown): boolean | undefined {
  if (v === true || v === false) return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  if (typeof v === "string") return parseQueryFlag(v);
  return undefined;
}

function segmentMatches(
  expected:
    | {
        origen: string;
        destino: string;
        fechaSalida: string;
        horaSalida: string;
      }
    | undefined,
  actual: {
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
  }
) {
  if (!expected) return true;
  return (
    normalizeString(expected.origen) === actual.origen &&
    normalizeString(expected.destino) === actual.destino &&
    normalizeString(expected.fechaSalida) === actual.fechaSalida &&
    normalizeString(expected.horaSalida) === actual.horaSalida
  );
}

function buildSegmentKey(input: {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  barco?: string;
  serviceCode?: string;
  serviceType?: string;
}) {
  const n = (v: unknown) => normalizeString(String(v ?? "")).toUpperCase();
  return [
    n(input.origen),
    n(input.destino),
    n(input.fechaSalida),
    n(input.horaSalida),
    n(input.barco),
    n(input.serviceCode),
    n(input.serviceType),
  ].join("|");
}

function resolveDisplayedAmountChosenPath(
  candidates: Array<{ path: string; parsedValue: number | null }>,
  chosen: number | null,
  legMode: "combined" | "ida_leg" | "vta_leg"
) {
  if (chosen == null) return null;
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.03;
  const exact = candidates.filter(
    (c) => c.parsedValue != null && close(c.parsedValue, chosen)
  );
  const byMode =
    legMode === "ida_leg"
      ? exact.find((c) => c.path.includes("precioIdaEntidad"))
      : legMode === "vta_leg"
        ? exact.find((c) => c.path.includes("precioVtaEntidad"))
        : exact.find((c) => c.path.includes("precioEntidad"));
  return byMode?.path ?? exact[0]?.path ?? null;
}

function parsePassengerTipos(raw: string | null | undefined): string[] | undefined {
  const s = normalizeString(raw ?? null);
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((x) => String(x).trim()).filter(Boolean);
    }
  } catch {
    /* ignore */
  }
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

async function runTarificacion(input: TarificacionRequestBody) {
  const plan = buildTarificacionExecutionPlan(input);
  return nasaTarificacionesRequestWithSoapArgs(plan.soapArgs, {
    pricingSoapTrace: plan.nasaParams.pricingSoapTrace === true,
  });
}

function normalizeServiceLines(
  raw: unknown
): TarificacionServiceLine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const lines = raw
    .map((item) => {
      const row =
        item && typeof item === "object"
          ? (item as Record<string, unknown>)
          : null;
      if (!row) return null;

      const cantidadRaw = row.cantidad;
      const cantidad =
        typeof cantidadRaw === "number" && Number.isFinite(cantidadRaw)
          ? Math.floor(cantidadRaw)
          : typeof cantidadRaw === "string" && cantidadRaw.trim()
            ? Math.floor(Number(cantidadRaw.trim().replace(",", ".")))
            : 0;

      const codigoServicioVenta = normalizeString(
        typeof row.codigoServicioVenta === "string"
          ? row.codigoServicioVenta
          : null
      );
      const tipoServicioVenta = normalizeString(
        typeof row.tipoServicioVenta === "string"
          ? row.tipoServicioVenta
          : null
      );

      if (cantidad <= 0 || !codigoServicioVenta || !tipoServicioVenta) {
        return null;
      }

      return {
        cantidad,
        codigoServicioVenta,
        tipoServicioVenta,
      };
    })
    .filter((line): line is TarificacionServiceLine => line !== null);

  return lines.length > 0 ? lines : undefined;
}

function buildTarificacionExecutionPlan(input: TarificacionRequestBody) {
  const nasaParams = prepareNasaPricingCall(input);
  const soapArgs = buildNasaTarificacionesSoapArgs(nasaParams);

  const primaryServiceLines = normalizeServiceLines(input.serviceLines);
  const returnServiceLines = normalizeServiceLines(input.returnServiceLines);
  const salidaRaw = soapArgs.salidasEntidad.salidaEntidad;
  const outboundSalida = getSalidaSoapEntityAt(salidaRaw, 0);
  const inboundSalida = getSalidaSoapEntityAt(salidaRaw, 1);

  if (primaryServiceLines?.length) {
    if (outboundSalida) {
      outboundSalida.serviciosVentasEntidad = {
        servicioVentaEntidad: primaryServiceLines,
      };
    }
  }

  if (returnServiceLines?.length && inboundSalida) {
    inboundSalida.serviciosVentasEntidad = {
      servicioVentaEntidad: returnServiceLines,
    };
  }

  return {
    nasaParams,
    soapArgs,
  };
}

function armaDebugResponseAllowed(request: NextRequest) {
  return (
    process.env.SOLAIR_ARMAS_PRICING_DEBUG === "1" &&
    normalizeString(new URL(request.url).searchParams.get("armaDebug")) === "1"
  );
}

function pricingSoapTraceFromGet(searchParams: URLSearchParams) {
  if (parseQueryFlag(searchParams.get("pricingTrace")) === true) return true;
  return searchParams.has("rawTrailerLength");
}

function pricingSoapTraceFromPostBody(body: Partial<TarificacionRequestBody>) {
  return body.pricingSoapTrace === true || body.pricingTrace === true;
}

export async function POST(request: NextRequest) {
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

  let body: Partial<TarificacionRequestBody>;

  try {
    body = (await request.json()) as Partial<TarificacionRequestBody>;
  } catch {
    return NextResponse.json(
      { ok: false, message: "Body JSON invalide." },
      { status: 400 }
    );
  }

  const origen = normalizeString(body.origen);
  const destino = normalizeString(body.destino);
  const fechaSalida = normalizeString(body.fechaSalida);
  const horaSalida = normalizeString(body.horaSalida);
  const cantidad = body.cantidad;
  const codigoServicioVenta = normalizeString(body.codigoServicioVenta);
  const tipoServicioVenta = normalizeString(body.tipoServicioVenta);
  const tipoPasajero = normalizeString(body.tipoPasajero) || "A";
  const bonificacion = normalizeString(body.bonificacion);

  if (
    !origen ||
    !destino ||
    !fechaSalida ||
    !horaSalida ||
    typeof cantidad !== "number" ||
    !Number.isFinite(cantidad) ||
    cantidad <= 0 ||
    !codigoServicioVenta ||
    !tipoServicioVenta ||
    !bonificacion
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Champs obligatoires: origen, destino, fechaSalida, horaSalida, cantidad (>0), codigoServicioVenta, tipoServicioVenta, bonificacion.",
      },
      { status: 400 }
    );
  }

  const pricingRtDebug = body.pricingRtDebug;

  const postBody: TarificacionRequestBody = {
    origen,
    destino,
    fechaSalida,
    horaSalida,
    cantidad,
    codigoServicioVenta,
    tipoServicioVenta,
    tipoPasajero,
    passengerTipos: body.passengerTipos,
    bonificacion,
    sentidoSalida: body.sentidoSalida,
    animalsCount: body.animalsCount,
    vehicle: body.vehicle,
    vehicleCategory: body.vehicleCategory,
    vehiclePassengerIndex: body.vehiclePassengerIndex,
    vehicleData: body.vehicleData,
    companionServicioVenta: body.companionServicioVenta,
    serviceLines: normalizeServiceLines(body.serviceLines),
    returnSegment: body.returnSegment,
    returnServiceLines: normalizeServiceLines(body.returnServiceLines),
    rawTrailerLength: coerceRawTrailerLength(body.rawTrailerLength),
    pricingSoapTrace: pricingSoapTraceFromPostBody(body) ? true : undefined,
  };

  const selectedOutboundSegment = pricingRtDebug?.selectedOutboundSegment;
  const selectedInboundSegment = pricingRtDebug?.selectedInboundSegment;
  if (pricingRtDebug?.armasLeg === "inbound") {
    const actualInbound = {
      origen: postBody.origen,
      destino: postBody.destino,
      fechaSalida: postBody.fechaSalida,
      horaSalida: postBody.horaSalida,
    };
    const actualInboundSegmentKey = buildSegmentKey({
      ...actualInbound,
      serviceCode: postBody.codigoServicioVenta,
      serviceType: postBody.tipoServicioVenta,
    });
    if (
      !segmentMatches(selectedInboundSegment, actualInbound) ||
      (normalizeString(selectedInboundSegment?.serviceCode) &&
        normalizeString(selectedInboundSegment?.serviceCode) !==
          postBody.codigoServicioVenta) ||
      (normalizeString(selectedInboundSegment?.serviceType) &&
        normalizeString(selectedInboundSegment?.serviceType) !==
          postBody.tipoServicioVenta) ||
      (normalizeString(selectedInboundSegment?.segmentKey) &&
        normalizeString(selectedInboundSegment?.segmentKey).toUpperCase() !==
          actualInboundSegmentKey)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Tarification inbound invalide: segment visible client != segment envoyé SOAP.",
        },
        { status: 409 }
      );
    }
  }
  if (pricingRtDebug?.armasLeg === "outbound") {
    const actualOutbound = {
      origen: postBody.origen,
      destino: postBody.destino,
      fechaSalida: postBody.fechaSalida,
      horaSalida: postBody.horaSalida,
    };
    const actualOutboundSegmentKey = buildSegmentKey({
      ...actualOutbound,
      serviceCode: postBody.codigoServicioVenta,
      serviceType: postBody.tipoServicioVenta,
    });
    if (
      !segmentMatches(selectedOutboundSegment, actualOutbound) ||
      (normalizeString(selectedOutboundSegment?.serviceCode) &&
        normalizeString(selectedOutboundSegment?.serviceCode) !==
          postBody.codigoServicioVenta) ||
      (normalizeString(selectedOutboundSegment?.serviceType) &&
        normalizeString(selectedOutboundSegment?.serviceType) !==
          postBody.tipoServicioVenta) ||
      (normalizeString(selectedOutboundSegment?.segmentKey) &&
        normalizeString(selectedOutboundSegment?.segmentKey).toUpperCase() !==
          actualOutboundSegmentKey)
    ) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Tarification outbound invalide: segment visible client != segment envoyé SOAP.",
        },
        { status: 409 }
      );
    }
  }
  if (process.env.SOLAIR_ARMAS_RT_PRICING_DEBUG === "1") {
    const sentSegmentKey = buildSegmentKey({
      origen: postBody.origen,
      destino: postBody.destino,
      fechaSalida: postBody.fechaSalida,
      horaSalida: postBody.horaSalida,
      serviceCode: postBody.codigoServicioVenta,
      serviceType: postBody.tipoServicioVenta,
    });
    console.error(
      "[SOLAIR_ARMAS_RT_PRICING_DEBUG] api/armas/test-pricing.pre-soap.segments",
      JSON.stringify(
        {
          requestId: pricingRtDebug?.requestId ?? null,
          armasLeg: pricingRtDebug?.armasLeg ?? null,
          clientVisibleOutboundSegment: selectedOutboundSegment ?? null,
          clientVisibleInboundSegment: selectedInboundSegment ?? null,
          soapPrimarySegment: {
            origen: postBody.origen,
            destino: postBody.destino,
            fechaSalida: postBody.fechaSalida,
            horaSalida: postBody.horaSalida,
            serviceCode: postBody.codigoServicioVenta,
            serviceType: postBody.tipoServicioVenta,
            segmentKey: sentSegmentKey,
          },
          soapReturnSegment: postBody.returnSegment
            ? {
                ...postBody.returnSegment,
                segmentKey: buildSegmentKey({
                  origen: postBody.returnSegment.origen,
                  destino: postBody.returnSegment.destino,
                  fechaSalida: postBody.returnSegment.fechaSalida,
                  horaSalida: postBody.returnSegment.horaSalida,
                  serviceCode: postBody.returnSegment.codigoServicioVenta,
                  serviceType: postBody.returnSegment.tipoServicioVenta,
                }),
              }
            : null,
        },
        null,
        0
      )
    );
  }

  try {
    const result = await runTarificacion(postBody);

    if (process.env.SOLAIR_ARMAS_RT_PRICING_DEBUG === "1") {
      const legMode = resolveArmasTarificacionLegMode(
        pricingRtDebug?.tripType,
        pricingRtDebug?.armasLeg
      );
      const segmentTotal = sumPrecioTotalFromNasaTarificacionesResult(
        result,
        legMode
      );
      const blockSums = sumPrecioBlocksFromNasaTarificacionesResult(result);
      const precioPresence = describeTarificacionPrecioBlocksPresence(result);
      const amountCandidates = extractTarificacionAmountCandidates(result);
      console.error(
        "[SOLAIR_ARMAS_RT_PRICING_DEBUG] api/armas/test-pricing POST",
        JSON.stringify(
          {
            tripType: pricingRtDebug?.tripType ?? null,
            requestId: pricingRtDebug?.requestId ?? null,
            armasLeg: pricingRtDebug?.armasLeg ?? null,
            armasTarificacionLegMode: legMode,
            precioBlocksPresence: precioPresence,
            blockSums,
            segmentTotalEurosRetained: segmentTotal,
            origen,
            destino,
            fechaSalida,
            horaSalida,
            codigoServicioVenta,
            tipoServicioVenta,
            outboundSegment: pricingRtDebug?.selectedOutboundSegment ?? null,
            inboundSegment: pricingRtDebug?.selectedInboundSegment ?? null,
            passengers: {
              cantidad,
              passengerTipos: body.passengerTipos ?? null,
              tipoPasajero,
            },
            residentBonificationCode: bonificacion,
            vehicle: {
              hasVehicle:
                Boolean(postBody.vehicle && postBody.vehicle !== "none") ||
                Boolean(
                  postBody.vehicleCategory && postBody.vehicleCategory !== "none"
                ),
              vehicle: postBody.vehicle ?? null,
              vehicleCategory: postBody.vehicleCategory ?? null,
              companionServicioVenta: postBody.companionServicioVenta ?? null,
              vehicleData: postBody.vehicleData ?? null,
            },
            selectedService: {
              serviceCode: codigoServicioVenta,
              serviceType: tipoServicioVenta,
            },
            displayedAmountChosen: segmentTotal,
            displayedAmountChosenPath: resolveDisplayedAmountChosenPath(
              amountCandidates,
              segmentTotal,
              legMode
            ),
            amountCandidates,
            amountCandidatesAround175: amountCandidates.filter(
              (c) =>
                c.parsedValue != null &&
                c.parsedValue >= 174.5 &&
                c.parsedValue <= 175.5
            ),
            amountCandidatesAround25_95: amountCandidates.filter(
              (c) =>
                c.parsedValue != null && Math.abs(c.parsedValue - 25.95) <= 0.03
            ),
            amountCandidatesAround30_00: amountCandidates.filter(
              (c) => c.parsedValue != null && Math.abs(c.parsedValue - 30) <= 0.03
            ),
          },
          null,
          0
        )
      );
    }

    const json: Record<string, unknown> = {
      ok: true,
      message: "Appel SOAP nasaTarificaciones exécuté.",
      data: result,
    };

    const wantXrPricingTrace =
      isXrTraceTargetCategory(postBody.vehicleCategory) &&
      (xrPricingTraceEnabled() || postBody.pricingSoapTrace === true);

    if (wantXrPricingTrace) {
      const { nasaParams, soapArgs } = buildTarificacionExecutionPlan(postBody);
      const xrRecord = buildXrPricingTraceRecord(
        postBody,
        nasaParams,
        soapArgs,
        result
      );
      logXrPricingTraceServer(xrRecord);
      json.xrPricingTrace = xrRecord;
    }

    const postDebug =
      process.env.SOLAIR_ARMAS_PRICING_DEBUG === "1" &&
      normalizeString(request.headers.get("x-solair-arma-debug")) === "1";

    if (postDebug) {
      const { nasaParams, soapArgs } = buildTarificacionExecutionPlan(postBody);
      json.armaDebug = {
        debugLabel: "POST",
        bodyEcho: postBody,
        trailerVehiculoEntidadMode:
          trailerVehiculoEntidadModeFromFlag(nasaParams.rawTrailerLength) ??
          "split",
        rawTrailerLength: nasaParams.rawTrailerLength,
        nasaTarificacionesRequestParams: nasaParams,
        vehiculoEntidad: extractPricingVehiculoEntidad(soapArgs) ?? null,
        soapArgs,
        armasReturn: extractNasaTarificacionesReturnMeta(result),
        tarificacionesNormalized: normalizeNasaTarificacionesLines(result),
      };
    }

    /* Trace top-level : tout véhicule si `pricingSoapTrace` / `pricingTrace` dans le body. */
    if (postBody.pricingSoapTrace === true) {
      const { nasaParams, soapArgs } = buildTarificacionExecutionPlan(postBody);
      json.pricingSoapTraceEcho = buildPricingSoapTraceEcho({
        postBody,
        nasaParams,
        soapArgs,
        rawResult: result,
      });
    }

    return NextResponse.json(json);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaTarificaciones.",
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
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

  const { searchParams } = new URL(request.url);

  const origen = normalizeString(searchParams.get("origen"));
  const destino = normalizeString(searchParams.get("destino"));
  const fechaSalida = normalizeString(searchParams.get("fechaSalida"));
  const horaSalida = normalizeString(searchParams.get("horaSalida"));
  const cantidad = normalizeString(searchParams.get("cantidad"));
  const codigoServicioVenta = normalizeString(
    searchParams.get("codigoServicioVenta")
  );
  const tipoServicioVenta = normalizeString(
    searchParams.get("tipoServicioVenta")
  );
  const tipoPasajero = normalizeString(searchParams.get("tipoPasajero"));
  const bonificacion = normalizeString(searchParams.get("bonificacion"));
  const sentidoSalida = normalizeString(searchParams.get("sentidoSalida"));

  const vehicle = normalizeString(searchParams.get("vehicle"));
  const vehicleCategory = normalizeString(searchParams.get("vehicleCategory"));
  const marca = normalizeString(searchParams.get("marca"));
  const modele = normalizeString(searchParams.get("modele"));
  const matricula = normalizeString(searchParams.get("matricula"));
  const alto = normalizeString(searchParams.get("alto"));
  const ancho = normalizeString(searchParams.get("ancho"));
  const largo = normalizeString(searchParams.get("largo"));
  const tipoVehiculo = normalizeString(searchParams.get("tipoVehiculo"));
  const tara = normalizeString(searchParams.get("tara"));
  const seguro = normalizeString(searchParams.get("seguro"));

  const animalsCountRaw = normalizeString(searchParams.get("animalsCount"));
  const animalsCount = animalsCountRaw
    ? Math.max(0, Math.floor(Number(animalsCountRaw)))
    : undefined;

  const conductorRaw = normalizeString(searchParams.get("conductorIndex"));
  const vehiclePassengerIndex = conductorRaw
    ? Math.max(0, Math.floor(Number(conductorRaw)))
    : undefined;

  const companionCodigo = normalizeString(
    searchParams.get("companionCodigoServicioVenta")
  );
  const companionTipo = normalizeString(
    searchParams.get("companionTipoServicioVenta")
  );
  const companionCantidadRaw = normalizeString(
    searchParams.get("companionCantidad")
  );
  const companionCantidad = companionCantidadRaw
    ? Math.max(1, Math.floor(Number(companionCantidadRaw)))
    : undefined;

  const passengerTipos = parsePassengerTipos(
    searchParams.get("passengerTipos")
  );

  if (
    !origen ||
    !destino ||
    !fechaSalida ||
    !horaSalida ||
    !cantidad ||
    !codigoServicioVenta ||
    !tipoServicioVenta ||
    !tipoPasajero ||
    !bonificacion
  ) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Les paramètres origen, destino, fechaSalida, horaSalida, cantidad, codigoServicioVenta, tipoServicioVenta, tipoPasajero et bonificacion sont obligatoires.",
        example:
          "/api/armas/test-pricing?origen=MOT&destino=MLN&fechaSalida=20260410&horaSalida=2330&cantidad=1&codigoServicioVenta=BY&tipoServicioVenta=P&tipoPasajero=A&bonificacion=G&sentidoSalida=1",
      },
      { status: 400 }
    );
  }

  const tarificacionBody: TarificacionRequestBody = {
    origen,
    destino,
    fechaSalida,
    horaSalida,
    cantidad: Number(cantidad),
    codigoServicioVenta,
    tipoServicioVenta,
    tipoPasajero,
    passengerTipos,
    bonificacion,
    sentidoSalida: sentidoSalida ? Number(sentidoSalida) : 1,
    animalsCount,
    vehicle: vehicle || undefined,
    vehicleCategory: vehicleCategory || undefined,
    vehiclePassengerIndex,
    vehicleData:
      (vehicle && vehicle !== "none") || (vehicleCategory && vehicleCategory !== "none")
        ? {
            marque: marca,
            modele,
            immatriculation: matricula,
            alto: alto || undefined,
            ancho: ancho || undefined,
            largo: largo || undefined,
            tipoVehiculo: tipoVehiculo || undefined,
            tara: tara || undefined,
            seguro: seguro || undefined,
          }
        : undefined,
    companionServicioVenta:
      companionCodigo && companionTipo
        ? {
            codigoServicioVenta: companionCodigo,
            tipoServicioVenta: companionTipo,
            cantidad: companionCantidad,
          }
        : undefined,
    rawTrailerLength: parseQueryFlag(searchParams.get("rawTrailerLength")),
    pricingSoapTrace: pricingSoapTraceFromGet(searchParams) ? true : undefined,
  };

  try {
    const result = await runTarificacion(tarificacionBody);

    const payload: Record<string, unknown> = {
      ok: true,
      message: "Appel SOAP nasaTarificaciones exécuté.",
      data: result,
    };

    if (armaDebugResponseAllowed(request)) {
      const nasaParams = prepareNasaPricingCall(tarificacionBody);
      const soapArgs = buildNasaTarificacionesSoapArgs(nasaParams);
      payload.armaDebug = {
        debugLabel: normalizeString(
          new URL(request.url).searchParams.get("debugLabel")
        ),
        queryEcho: {
          vehicle,
          vehicleCategory,
          largo,
          alto,
          ancho,
          marca,
          modele,
          matricula,
          codigoServicioVenta,
          tipoServicioVenta,
          cantidad,
          passengerTipos,
          animalsCount: animalsCount ?? 0,
          tipoVehiculo,
          tara,
          seguro,
          rawTrailerLength: parseQueryFlag(searchParams.get("rawTrailerLength")),
          pricingTrace: parseQueryFlag(searchParams.get("pricingTrace")),
        },
        trailerVehiculoEntidadMode:
          trailerVehiculoEntidadModeFromFlag(nasaParams.rawTrailerLength) ??
          "split",
        rawTrailerLength: nasaParams.rawTrailerLength,
        nasaTarificacionesRequestParams: nasaParams,
        vehiculoEntidad: extractPricingVehiculoEntidad(soapArgs) ?? null,
        soapArgs,
        armasReturn: extractNasaTarificacionesReturnMeta(result),
        tarificacionesNormalized: normalizeNasaTarificacionesLines(result),
      };
    }

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaTarificaciones.",
        error: message,
      },
      { status: 500 }
    );
  }
}
