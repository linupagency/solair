import type { NormalizedTarificacionLine } from "@/lib/armas/tarificacion-normalize";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";

/** Champs plats demandés pour comparaison runtime (XR / grande remorque). */
export type XrRuntimeExplicit = {
  /**
   * Catégorie dans le JSON POST (`vehicleCategory`) — alignée flow côté client si le build est cohérent.
   * Comparer avec `uiOptionSelected.category` dans les logs navigateur.
   */
  category: string | undefined;
  vehicleCategory: string | undefined;
  companionServicioVentaCodigoServicioVenta: string | undefined;
  vehicleDataTipoVehiculo: string | number | undefined;
  vehicleDataLargo: string | number | undefined;
  vehicleDataAlto: string | number | undefined;
  /** Dimensions réellement sérialisées dans `paxVehEntidad.vehiculoEntidad` (SOAP). */
  soapVehiculoTipoVehiculo: string | number | undefined;
  soapVehiculoLargo: number | undefined;
  soapVehiculoAlto: number | undefined;
  rawTrailerLength: boolean | undefined;
  rawResultReturnCodigo: unknown;
  rawResultReturnTexto: unknown;
  tarificacionLinePrecioEntidadTotals: Array<{
    index: number;
    precioEntidadTotal: unknown;
  }>;
};

export type XrPricingTracePostBodySlice = Pick<
  TarificacionRequestBody,
  | "vehicle"
  | "vehicleCategory"
  | "vehicleData"
  | "companionServicioVenta"
  | "rawTrailerLength"
  | "origen"
  | "destino"
  | "fechaSalida"
  | "horaSalida"
  | "codigoServicioVenta"
  | "tipoServicioVenta"
>;

/** Sous-ensemble des champs véhicule / remorque alignés sur `prepareNasaPricingCall`. */
export type XrPricingTraceNasaParamsSlice = Pick<
  TarificacionRequestBody,
  | "vehicle"
  | "vehicleCategory"
  | "vehicleData"
  | "companionServicioVenta"
  | "rawTrailerLength"
>;

export type XrPricingTraceArmasReturn = {
  codigo?: string;
  texto?: string;
};

export type XrPricingTraceRecord = {
  label: "SOLAIR_XR_TRACE";
  stage: "server";
  at: string;
  postBody: XrPricingTracePostBodySlice;
  nasaParams: XrPricingTraceNasaParamsSlice;
  vehiculoEntidad: unknown;
  servicioVentaEntidad: unknown;
  armasReturn: XrPricingTraceArmasReturn;
  normalizedLines: NormalizedTarificacionLine[];
  sumPrecioParsed: number | null;
  rawReturnKeys: string[];
  soapArgs: unknown;
  rawResult: unknown;
  xrRuntimeExplicit: XrRuntimeExplicit;
};
