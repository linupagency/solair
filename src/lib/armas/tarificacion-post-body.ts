/**
 * Corps JSON pour POST `/api/armas/test-pricing` — délègue au builder transport unique.
 */
import type { BookingFlow } from "@/lib/booking-flow";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  buildTransportPricingRequestFromFlow,
  type SalidaServiciosCatalog,
  type TransportPricingSalidaContext,
} from "@/lib/armas/build-transport-pricing-request";

export type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";

/** @deprecated utiliser `SalidaServiciosCatalog`. */
export type TarificacionCompanionCatalog = SalidaServiciosCatalog;

export type TarificacionSalidaContext = TransportPricingSalidaContext;

/** @deprecated préférer `defaultVehiculoDimensions` depuis `@/lib/vehicle/armas-catalog`. */
export { getVehicleFallbackDimensionsForPricing } from "@/lib/vehicle/tarificacion-dimensions-fallback";

export function tryBuildTarificacionPostBodyFromFlow(
  flow: BookingFlow,
  salida: TransportPricingSalidaContext,
  input: {
    cantidad: number;
    codigoServicioVenta: string;
    tipoServicioVenta: string;
    tipoPasajero: string;
    passengerTipos: string[];
  },
  catalog?: SalidaServiciosCatalog
) {
  return buildTransportPricingRequestFromFlow(
    flow,
    salida,
    {
      cantidad: input.cantidad,
      codigoServicioVenta: input.codigoServicioVenta,
      tipoServicioVenta: input.tipoServicioVenta,
      tipoPasajero: input.tipoPasajero,
      passengerTipos: input.passengerTipos,
    },
    catalog
  );
}

export function buildTarificacionPostBodyFromFlow(
  flow: BookingFlow,
  salida: TransportPricingSalidaContext,
  input: {
    cantidad: number;
    codigoServicioVenta: string;
    tipoServicioVenta: string;
    tipoPasajero: string;
    passengerTipos: string[];
  },
  catalog?: SalidaServiciosCatalog
): TarificacionRequestBody {
  const built = tryBuildTarificacionPostBodyFromFlow(
    flow,
    salida,
    input,
    catalog
  );
  if (!built.ok) {
    throw new Error(built.error);
  }
  return built.body;
}

export async function postTarificacionRequest(
  body: TarificacionRequestBody
): Promise<Response> {
  return fetch("/api/armas/test-pricing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}
