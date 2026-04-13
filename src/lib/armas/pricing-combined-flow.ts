import type { BookingFlow, BookingTransportServiceRef } from "@/lib/booking-flow";
import { explicitVehicleRefForCategory } from "@/lib/armas/vehicle-line-explicit";

export type PricingSalidaLike = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
};

/** @deprecated alias — utiliser `SalidaServiciosCatalog` depuis `build-transport-pricing-request`. */
export type NasaTarificacionCompanionCatalog = {
  serviciosVentas?: ReadonlyArray<{
    codigoServicioVenta?: string;
    tipoServicioVenta?: string;
    disponibilidad?: boolean | null;
  }>;
};

/** Quantité réservée par ligne (tolère anciennes données `quantity` en chaîne). */
export function vehicleLineQuantity(v: { quantity: number }): number {
  const raw = v.quantity as unknown;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim().replace(",", "."));
    if (Number.isFinite(n)) return Math.max(0, Math.floor(n));
  }
  return 0;
}

function primaryVehicle(flow: BookingFlow) {
  return flow.search.vehicles.find((v) => vehicleLineQuantity(v) > 0);
}

export function totalVehiclesBooked(flow: BookingFlow): number {
  return flow.search.vehicles.reduce((s, v) => s + vehicleLineQuantity(v), 0);
}

/**
 * Companion catalogue métier (réservation / affichage) — aligné `armas-catalog`.
 * Pour construire le POST `nasaTarificaciones`, utiliser `buildTransportPricingRequestFromFlow`.
 */
export function resolveVehicleCompanionForPricing(
  flow: BookingFlow,
  _dep: PricingSalidaLike
): BookingTransportServiceRef | null {
  if (!flow.search.vehicles.some((v) => vehicleLineQuantity(v) > 0)) return null;

  const r = explicitVehicleRefForCategory(primaryVehicle(flow)?.category ?? "");
  if (r?.codigoServicioVenta && r?.tipoServicioVenta) {
    return { ...r };
  }
  return null;
}
