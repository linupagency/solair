/**
 * Utilitaires trace XR sans dépendance Node — sûrs pour Client Components (`"use client"`).
 * La construction de trace SOAP : `@/lib/armas/xr-pricing-trace` (server-only).
 */
export const XR_TRACE_TARGET_VEHICLE_CATEGORY = "large_tourism_car_trailer" as const;

export function xrPricingTraceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SOLAIR_XR_PRICING_TRACE === "1";
}

export function isXrTraceTargetCategory(
  vehicleCategory: string | undefined
): boolean {
  return (vehicleCategory || "").trim() === XR_TRACE_TARGET_VEHICLE_CATEGORY;
}
