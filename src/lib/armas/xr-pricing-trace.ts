/**
 * Trace runtime XR — **serveur uniquement** (`soap`, `client.ts`, etc.).
 * Ne jamais importer ce module depuis un composant `"use client"`.
 *
 * Client : utiliser `@/lib/armas/xr-pricing-trace.public` (flags uniquement).
 *
 * Activer la trace dans la réponse : `NEXT_PUBLIC_SOLAIR_XR_PRICING_TRACE=1` et/ou
 * `pricingSoapTrace: true` sur le POST (catégorie grande remorque).
 */
import "server-only";

import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  buildNasaTarificacionesSoapArgs,
  extractNasaTarificacionesReturnMeta,
  extractPricingVehiculoEntidad,
  type NasaTarificacionesRequestParams,
  type NasaTarificacionesSoapArgs,
} from "@/lib/armas/client";
import {
  getNasaTarificacionesReturnNode,
  getTarificacionRawLinesFromSoapResult,
  normalizeNasaTarificacionesLines,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "@/lib/armas/tarificacion-normalize";
import type {
  XrPricingTraceRecord,
  XrRuntimeExplicit,
} from "@/lib/armas/xr-pricing-trace.types";

export { isXrTraceTargetCategory, xrPricingTraceEnabled } from "@/lib/armas/xr-pricing-trace.public";

function buildXrRuntimeExplicit(
  postBody: TarificacionRequestBody,
  soapArgs: NasaTarificacionesSoapArgs,
  rawSoapResult: unknown
): XrRuntimeExplicit {
  const ret = getNasaTarificacionesReturnNode(rawSoapResult);
  const rawLines = getTarificacionRawLinesFromSoapResult(rawSoapResult);
  const vd = postBody.vehicleData;
  const veh = extractPricingVehiculoEntidad(soapArgs);
  return {
    category: postBody.vehicleCategory,
    vehicleCategory: postBody.vehicleCategory,
    companionServicioVentaCodigoServicioVenta:
      postBody.companionServicioVenta?.codigoServicioVenta,
    vehicleDataTipoVehiculo: vd?.tipoVehiculo,
    vehicleDataLargo: vd?.largo,
    vehicleDataAlto: vd?.alto,
    soapVehiculoTipoVehiculo: veh?.tipoVehiculo,
    soapVehiculoLargo: veh?.largo,
    soapVehiculoAlto: veh?.alto,
    rawTrailerLength: postBody.rawTrailerLength,
    rawResultReturnCodigo: ret?.codigo,
    rawResultReturnTexto: ret?.texto,
    tarificacionLinePrecioEntidadTotals: rawLines.map((line, index) => {
      const L = line as Record<string, unknown>;
      const pe = L.precioEntidad as Record<string, unknown> | undefined;
      return { index, precioEntidadTotal: pe?.total };
    }),
  };
}

export function buildXrPricingTraceRecord(
  postBody: TarificacionRequestBody,
  nasaParams: NasaTarificacionesRequestParams,
  soapArgs: NasaTarificacionesSoapArgs,
  rawSoapResult: unknown
): XrPricingTraceRecord {
  const ret = getNasaTarificacionesReturnNode(rawSoapResult);
  const rawReturnKeys =
    ret && typeof ret === "object"
      ? Object.keys(ret as Record<string, unknown>)
      : [];

  return {
    label: "SOLAIR_XR_TRACE",
    stage: "server",
    at: new Date().toISOString(),
    postBody: {
      origen: postBody.origen,
      destino: postBody.destino,
      fechaSalida: postBody.fechaSalida,
      horaSalida: postBody.horaSalida,
      codigoServicioVenta: postBody.codigoServicioVenta,
      tipoServicioVenta: postBody.tipoServicioVenta,
      vehicle: postBody.vehicle,
      vehicleCategory: postBody.vehicleCategory,
      vehicleData: postBody.vehicleData,
      companionServicioVenta: postBody.companionServicioVenta,
      rawTrailerLength: postBody.rawTrailerLength,
    },
    nasaParams: {
      vehicle: nasaParams.vehicle,
      vehicleCategory: nasaParams.vehicleCategory,
      vehicleData: nasaParams.vehicleData,
      companionServicioVenta: nasaParams.companionServicioVenta,
      rawTrailerLength: nasaParams.rawTrailerLength,
    },
    vehiculoEntidad: extractPricingVehiculoEntidad(soapArgs),
    servicioVentaEntidad:
      soapArgs.salidasEntidad?.salidaEntidad?.serviciosVentasEntidad
        ?.servicioVentaEntidad,
    armasReturn: extractNasaTarificacionesReturnMeta(rawSoapResult),
    normalizedLines: normalizeNasaTarificacionesLines(rawSoapResult),
    sumPrecioParsed: sumPrecioTotalFromNasaTarificacionesResult(rawSoapResult),
    rawReturnKeys,
    soapArgs,
    rawResult: rawSoapResult,
    xrRuntimeExplicit: buildXrRuntimeExplicit(
      postBody,
      soapArgs,
      rawSoapResult
    ),
  };
}

export function logXrPricingTraceServer(record: XrPricingTraceRecord): void {
  console.info("[SOLAIR_XR_TRACE] server\n" + JSON.stringify(record, null, 2));
}
