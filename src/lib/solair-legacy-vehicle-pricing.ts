import type { BookingFlow } from "@/lib/booking-flow";
import { vehicleLineQuantity } from "@/lib/armas/pricing-combined-flow";

export function getPrimaryVehicleFromSearch(flow: BookingFlow) {
  return flow.search.vehicles.find((v) => vehicleLineQuantity(v) > 0);
}

/**
 * Paramètre `vehicle` des appels `/api/armas/test-pricing` (famille SOAP passagers + véhicule).
 * La granularité commerciale et le companion viennent de `vehicleCategory` + mapping explicite Armas.
 */
export function getLegacyVehicleForPricingParam(
  flow: BookingFlow
): "none" | "car" | "moto" | "camper" {
  const v = getPrimaryVehicleFromSearch(flow);
  if (!v) return "none";
  if (v.category === "camper") return "camper";
  if (v.category === "moto") return "moto";
  if (v.category === "bike" || v.category === "bicycle") return "moto";
  return "car";
}
