/**
 * TEMP — instrumentation comparaison probe vs test-pricing (`pricingSoapTrace=true`).
 * Retirer ou désactiver une fois les écarts documentés.
 */
import type {
  NasaTarificacionesRequestParams,
  NasaTarificacionesSoapArgs,
} from "@/lib/armas/client";
import { getNasaTarificacionesReturnNode } from "@/lib/armas/tarificacion-normalize";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";

export type PricingSoapTraceEcho = {
  postBody: TarificacionRequestBody | null;
  nasaParams: NasaTarificacionesRequestParams;
  soapArgs: NasaTarificacionesSoapArgs;
  rawResult: unknown;
  returnNodeComparison: {
    /** `rawResult.return` tel que renvoyé par le client SOAP (équivalent `data` côté test-pricing). */
    dataReturn: unknown;
    /** Nœud utilisé par `extractNasaTarificacionesReturnMeta` / lignes tarif. */
    getNasaTarificacionesReturnNode: ReturnType<
      typeof getNasaTarificacionesReturnNode
    >;
    sameObjectReference: boolean;
    jsonStringEqual: boolean;
  };
};

export function buildPricingSoapTraceEcho(args: {
  postBody: TarificacionRequestBody | null;
  nasaParams: NasaTarificacionesRequestParams;
  soapArgs: NasaTarificacionesSoapArgs;
  rawResult: unknown;
}): PricingSoapTraceEcho {
  const dataReturn =
    args.rawResult &&
    typeof args.rawResult === "object" &&
    args.rawResult !== null &&
    "return" in args.rawResult
      ? (args.rawResult as { return: unknown }).return
      : undefined;
  const resolved = getNasaTarificacionesReturnNode(args.rawResult);
  return {
    postBody: args.postBody,
    nasaParams: args.nasaParams,
    soapArgs: args.soapArgs,
    rawResult: args.rawResult,
    returnNodeComparison: {
      dataReturn,
      getNasaTarificacionesReturnNode: resolved,
      sameObjectReference: dataReturn !== undefined && dataReturn === resolved,
      jsonStringEqual:
        dataReturn !== undefined &&
        resolved !== undefined &&
        JSON.stringify(dataReturn) === JSON.stringify(resolved),
    },
  };
}
