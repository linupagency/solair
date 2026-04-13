/**
 * Source de vérité métier : codes NASA véhicule (preuves Armas) + dimensions par défaut (relevés projet).
 * WSDL Ventas20171009 — `VehEntidad` : alto, ancho, largo, metrosExtra, tipoVehiculo, marca, matricula, …
 */
import type { BookingTransportServiceRef } from "@/lib/booking-flow";

/** Catégories véhicule stockées dans `BookingFlow.search.vehicles[].category`. */
export const BOOKING_VEHICLE_CATEGORY_IDS = [
  "small_tourism_car",
  "medium_tourism_car",
  "large_tourism_car",
  "small_tourism_car_trailer",
  "medium_tourism_car_trailer",
  "large_tourism_car_trailer",
  "bus_with_trailer",
  "camper",
  "moto",
  "bike",
  "bicycle",
] as const;

export type BookingVehicleCategoryId = (typeof BOOKING_VEHICLE_CATEGORY_IDS)[number];

export function isBookingVehicleCategoryId(
  value: string
): value is BookingVehicleCategoryId {
  return (BOOKING_VEHICLE_CATEGORY_IDS as readonly string[]).includes(value);
}

/** Couple `codigoServicioVenta` | `tipoServicioVenta` pour la 2ᵉ ligne combiné `nasaTarificaciones`. */
export const ARMAS_VEHICLE_LINE_BY_CATEGORY: Record<
  BookingVehicleCategoryId,
  BookingTransportServiceRef
> = {
  small_tourism_car: { codigoServicioVenta: "V", tipoServicioVenta: "V" },
  medium_tourism_car: { codigoServicioVenta: "Y", tipoServicioVenta: "V" },
  large_tourism_car: { codigoServicioVenta: "X", tipoServicioVenta: "V" },
  small_tourism_car_trailer: { codigoServicioVenta: "VR", tipoServicioVenta: "V" },
  medium_tourism_car_trailer: { codigoServicioVenta: "YR", tipoServicioVenta: "V" },
  large_tourism_car_trailer: { codigoServicioVenta: "XR", tipoServicioVenta: "V" },
  bus_with_trailer: { codigoServicioVenta: "BR", tipoServicioVenta: "V" },
  camper: { codigoServicioVenta: "AC", tipoServicioVenta: "V" },
  moto: { codigoServicioVenta: "MT", tipoServicioVenta: "V" },
  bike: { codigoServicioVenta: "BI", tipoServicioVenta: "V" },
  bicycle: { codigoServicioVenta: "BI", tipoServicioVenta: "V" },
};

export function armasVehicleLineForCategory(
  category: BookingVehicleCategoryId
): BookingTransportServiceRef {
  return { ...ARMAS_VEHICLE_LINE_BY_CATEGORY[category] };
}

/**
 * Phase 1 — `tipoVehiculo` **prouvé** (capture site Armas et/ou test tarifaire / runtime concluant).
 * Toute autre catégorie reste sur le repli {@link ARMAS_TIPO_VEHICULO_PHASE1_UNPROVEN_FALLBACK}
 * jusqu’à validation explicite (ne pas y mélanger des hypothèses « probables »).
 */
export const ARMAS_TIPO_VEHICULO_PHASE1_PROVEN_BY_CATEGORY = {
  small_tourism_car: "V",
  large_tourism_car: "X",
  small_tourism_car_trailer: "VR",
  large_tourism_car_trailer: "XR",
  bus_with_trailer: "BR",
  camper: "AC",
  moto: "MT",
  bike: "BI",
  bicycle: "BI",
} as const satisfies Partial<Record<BookingVehicleCategoryId, string>>;

/** Repli phase 1 : aucune assertion Armas pour ces catégories tant qu’elles ne sont pas dans `PHASE1_PROVEN`. */
export const ARMAS_TIPO_VEHICULO_PHASE1_UNPROVEN_FALLBACK = "V";

function buildArmasTipoVehiculoByCategoryPhase1(): Record<
  BookingVehicleCategoryId,
  string
> {
  const proven = ARMAS_TIPO_VEHICULO_PHASE1_PROVEN_BY_CATEGORY as Partial<
    Record<BookingVehicleCategoryId, string>
  >;
  return Object.fromEntries(
    BOOKING_VEHICLE_CATEGORY_IDS.map((id) => [
      id,
      proven[id] ?? ARMAS_TIPO_VEHICULO_PHASE1_UNPROVEN_FALLBACK,
    ])
  ) as Record<BookingVehicleCategoryId, string>;
}

/**
 * Carte active `category → tipoVehiculo` (phase 1 uniquement).
 * Voir {@link ARMAS_TIPO_VEHICULO_PHASE2_PROBABLE_BY_CATEGORY} pour les hypothèses non branchées.
 */
export const ARMAS_TIPO_VEHICULO_BY_CATEGORY =
  buildArmasTipoVehiculoByCategoryPhase1();

/**
 * Phase 2 — **non utilisée** par {@link armasTipoVehiculoForCategory} ni par `ARMAS_TIPO_VEHICULO_BY_CATEGORY`.
 * Hypothèses alignées sur les codes ligne NASA ; à fusionner dans `PHASE1_PROVEN` (et retirer le repli)
 * **après** preuve indépendante par entrée.
 */
export const ARMAS_TIPO_VEHICULO_PHASE2_PROBABLE_BY_CATEGORY = {
  medium_tourism_car: "Y",
  medium_tourism_car_trailer: "YR",
} as const satisfies Partial<Record<BookingVehicleCategoryId, string>>;

/** Alias code `tipoVehiculo` / ligne NASA pour {@link BookingVehicleCategoryId} `bus_with_trailer`. */
export const ARMAS_TIPO_VEHICULO_BUS_WITH_TRAILER = "BR";

export function armasTipoVehiculoForCategory(
  category: BookingVehicleCategoryId
): string {
  return ARMAS_TIPO_VEHICULO_BY_CATEGORY[category];
}

/** Dimensions par défaut WSDL (`VehEntidad`) avant fusion avec le dossier utilisateur. */
export function defaultVehiculoDimensions(category: BookingVehicleCategoryId): {
  alto: number;
  ancho: number;
  largo: number;
} {
  switch (category) {
    case "small_tourism_car":
      return { alto: 1.85, ancho: 1.85, largo: 4.85 };
    case "medium_tourism_car":
      return { alto: 2, ancho: 2, largo: 5 };
    case "large_tourism_car":
      return { alto: 5, ancho: 2, largo: 6 };
    case "small_tourism_car_trailer":
      return { alto: 1.85, ancho: 1.8, largo: 8 };
    case "medium_tourism_car_trailer":
      return { alto: 2, ancho: 2, largo: 10 };
    case "large_tourism_car_trailer":
      return { alto: 5, ancho: 2, largo: 14 };
    case "bus_with_trailer":
      return { alto: 4.0, ancho: 2.55, largo: 14 };
    case "camper":
      return { alto: 3.0, ancho: 2.3, largo: 12 };
    case "moto":
      return { alto: 1.4, ancho: 0.9, largo: 2.2 };
    case "bike":
    case "bicycle":
      return { alto: 1.2, ancho: 0.6, largo: 1.8 };
  }
}

export type TrailerCategoryId =
  | "small_tourism_car_trailer"
  | "medium_tourism_car_trailer"
  | "large_tourism_car_trailer"
  | "bus_with_trailer";

export function isTrailerCategoryId(
  c: BookingVehicleCategoryId
): c is TrailerCategoryId {
  return (
    c === "small_tourism_car_trailer" ||
    c === "medium_tourism_car_trailer" ||
    c === "large_tourism_car_trailer" ||
    c === "bus_with_trailer"
  );
}

/**
 * Longueur « voiture seule » (m) pour split WSDL : `largo` + `metrosExtra` = longueur totale remorque.
 * Aligné sur les longueurs par défaut « voiture seule » du catalogue (pas de fallback vers une autre catégorie).
 */
export function baseLargoMForTrailerSplit(category: TrailerCategoryId): number {
  switch (category) {
    case "small_tourism_car_trailer":
      return defaultVehiculoDimensions("small_tourism_car").largo;
    case "medium_tourism_car_trailer":
      return defaultVehiculoDimensions("medium_tourism_car").largo;
    case "large_tourism_car_trailer":
      return defaultVehiculoDimensions("large_tourism_car").largo;
    case "bus_with_trailer":
      return defaultVehiculoDimensions("large_tourism_car").largo;
  }
}

export const CAR_WITH_TRAILER_MAX_LENGTH_M: Record<TrailerCategoryId, number> = {
  small_tourism_car_trailer: 8,
  medium_tourism_car_trailer: 10,
  large_tourism_car_trailer: 14,
  bus_with_trailer: 14,
};
