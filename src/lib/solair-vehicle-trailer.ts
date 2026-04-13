/**
 * Règles remorque : plafonds longueur + dimensions défaut — alignées sur `@/lib/vehicle/armas-catalog`.
 */
export {
  CAR_WITH_TRAILER_MAX_LENGTH_M,
  type TrailerCategoryId,
} from "@/lib/vehicle/armas-catalog";
import {
  CAR_WITH_TRAILER_MAX_LENGTH_M,
  defaultVehiculoDimensions,
  baseLargoMForTrailerSplit,
  type TrailerCategoryId,
} from "@/lib/vehicle/armas-catalog";

export type CarTrailerCategory = TrailerCategoryId;

export type CarTrailerCommercialTier = "small" | "medium" | "large";

const TIER_TO_CATEGORY: Record<CarTrailerCommercialTier, CarTrailerCategory> =
  {
    small: "small_tourism_car_trailer",
    medium: "medium_tourism_car_trailer",
    large: "large_tourism_car_trailer",
  };

const CATEGORY_TO_TIER: Record<string, CarTrailerCommercialTier> = {
  small_tourism_car_trailer: "small",
  medium_tourism_car_trailer: "medium",
  large_tourism_car_trailer: "large",
};

export function categoryForCarTrailerTier(
  tier: CarTrailerCommercialTier
): CarTrailerCategory {
  return TIER_TO_CATEGORY[tier];
}

export function tierFromCarTrailerCategory(
  category: string
): CarTrailerCommercialTier | null {
  return CATEGORY_TO_TIER[category] ?? null;
}

export function isCarWithTrailerCategory(category: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    CAR_WITH_TRAILER_MAX_LENGTH_M,
    category
  );
}

export function maxTotalLengthMForTrailerCategory(
  category: string
): number | null {
  if (!isCarWithTrailerCategory(category)) return null;
  return CAR_WITH_TRAILER_MAX_LENGTH_M[category as CarTrailerCategory];
}

export function clampTrailerTotalLengthM(
  meters: number,
  category: CarTrailerCategory
): number {
  const max = CAR_WITH_TRAILER_MAX_LENGTH_M[category];
  if (!Number.isFinite(meters) || meters <= 0) return max;
  return Math.min(max, meters);
}

export function armasDefaultDimensionsForTrailerCategory(
  category: CarTrailerCategory
): { alto: number; ancho: number; largo: number } {
  return defaultVehiculoDimensions(category);
}

export function baseCarLargoMForTrailerCategory(
  category: CarTrailerCategory
): number {
  return baseLargoMForTrailerSplit(category);
}

export function minBillableTotalLengthMForTrailerCategory(
  category: CarTrailerCategory
): number {
  return baseCarLargoMForTrailerCategory(category) + 0.05;
}
