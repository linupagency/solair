import type { BookingTransportServiceRef } from "@/lib/booking-flow";
import {
  ARMAS_VEHICLE_LINE_BY_CATEGORY,
  armasVehicleLineForCategory,
  isBookingVehicleCategoryId,
} from "@/lib/vehicle/armas-catalog";

/**
 * Correspondance métier : catégorie dossier → couple Armas (preuves site / NASA).
 * Source unique : `@/lib/vehicle/armas-catalog`.
 */
export const EXPLICIT_ARMAS_VEHICLE_REF_BY_CATEGORY: Record<
  string,
  BookingTransportServiceRef
> = ARMAS_VEHICLE_LINE_BY_CATEGORY as Record<string, BookingTransportServiceRef>;

export function explicitVehicleRefForCategory(
  category: string
): BookingTransportServiceRef | null {
  if (!isBookingVehicleCategoryId(category)) return null;
  return armasVehicleLineForCategory(category);
}

export function normCodigoTipo(codigo?: string, tipo?: string) {
  return {
    c: (codigo || "").trim().toUpperCase(),
    t: (tipo || "").trim().toUpperCase(),
  };
}

export function serviceMatchesExplicitRef(
  service: { codigoServicioVenta?: string; tipoServicioVenta?: string },
  ref: BookingTransportServiceRef
): boolean {
  const a = normCodigoTipo(service.codigoServicioVenta, service.tipoServicioVenta);
  const b = normCodigoTipo(ref.codigoServicioVenta, ref.tipoServicioVenta);
  return a.c === b.c && a.t === b.t;
}

export type ExplicitVehicleSalidaStatus<
  T extends {
    codigoServicioVenta?: string;
    tipoServicioVenta?: string;
    disponibilidad?: boolean | null;
  },
> =
  | { status: "ok"; service: T }
  | { status: "unavailable"; service: T }
  | { status: "not_in_catalog" }
  | { status: "unknown_category" };

/**
 * Cherche la ligne exacte sur la salida (y compris `disponibilidad === false`).
 */
export function resolveExplicitVehicleOnSalidaServices<
  T extends {
    codigoServicioVenta?: string;
    tipoServicioVenta?: string;
    disponibilidad?: boolean | null;
  },
>(flowVehicleCategory: string, allSalidaServices: readonly T[]): ExplicitVehicleSalidaStatus<T> {
  const ref = explicitVehicleRefForCategory(flowVehicleCategory);
  if (!ref) return { status: "unknown_category" };
  const { c: rc, t: rt } = normCodigoTipo(
    ref.codigoServicioVenta,
    ref.tipoServicioVenta
  );
  const hit = allSalidaServices.find((s) => {
    const { c, t } = normCodigoTipo(s.codigoServicioVenta, s.tipoServicioVenta);
    return c === rc && t === rt;
  });
  if (!hit) return { status: "not_in_catalog" };
  if (hit.disponibilidad === false) return { status: "unavailable", service: hit };
  return { status: "ok", service: hit };
}
