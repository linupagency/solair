/**
 * Repli dimensions pour anciens appelants ; préférer `defaultVehiculoDimensions` du catalogue.
 */
import {
  defaultVehiculoDimensions,
  isBookingVehicleCategoryId,
} from "@/lib/vehicle/armas-catalog";

export function getVehicleFallbackDimensionsForPricing(category: string): {
  alto?: number;
  ancho?: number;
  largo?: number;
} {
  const c = category.trim();
  if (c === "car") {
    const d = defaultVehiculoDimensions("small_tourism_car");
    return { alto: d.alto, ancho: d.ancho, largo: d.largo };
  }
  if (isBookingVehicleCategoryId(c)) {
    const d = defaultVehiculoDimensions(c);
    return { alto: d.alto, ancho: d.ancho, largo: d.largo };
  }
  return {};
}
