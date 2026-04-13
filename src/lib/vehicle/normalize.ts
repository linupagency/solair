/**
 * Normalise la sélection véhicule du dossier : une seule ligne active, catégorie stricte, pas de conversion implicite.
 */
import type { BookingFlow, BookingVehicleSelection } from "@/lib/booking-flow";
import {
  type BookingVehicleCategoryId,
  armasTipoVehiculoForCategory,
  armasVehicleLineForCategory,
  defaultVehiculoDimensions,
  isBookingVehicleCategoryId,
} from "@/lib/vehicle/armas-catalog";
import { isCarWithTrailerCategory } from "@/lib/solair-vehicle-trailer";

function lineQuantity(v: BookingVehicleSelection): number {
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

export type NormalizedPrimaryVehicle = {
  category: BookingVehicleCategoryId;
  quantity: number;
  label: string;
  driverPassengerIndex?: number;
  marque: string;
  modele: string;
  immatriculation: string;
  alto: number;
  ancho: number;
  largo: number;
  tipoVehiculo: string;
  taraKg?: number;
  seguro?: string;
  /** Remorque : encodage SOAP (voir `BookingVehicleSelection.rawTrailerLength`). */
  rawTrailerLength: boolean;
  /** Ligne NASA companion pour ce véhicule (preuve métier V/VR/…). */
  armasCompanion: ReturnType<typeof armasVehicleLineForCategory>;
};

export type NormalizePrimaryVehicleResult =
  | { ok: true; presence: "none" }
  | { ok: true; presence: "vehicle"; vehicle: NormalizedPrimaryVehicle }
  | { ok: false; error: string };

function mergeDimension(
  user: number | undefined,
  fallback: number | undefined
): number {
  if (typeof user === "number" && Number.isFinite(user)) return user;
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
}

/**
 * Véhicule principal du dossier : premier `vehicles[]` avec quantité > 0.
 * Catégorie inconnue → erreur explicite (aucun fallback vers `small_tourism_car`).
 */
export function normalizePrimaryVehicleFromFlow(
  flow: BookingFlow
): NormalizePrimaryVehicleResult {
  const row = flow.search.vehicles.find((v) => lineQuantity(v) > 0);
  if (!row) {
    return { ok: true, presence: "none" };
  }

  const cat = (row.category || "").trim();
  if (!cat || !isBookingVehicleCategoryId(cat)) {
    return {
      ok: false,
      error: `Catégorie véhicule inconnue ou vide : « ${cat || "(vide)"} ».`,
    };
  }

  const defs = defaultVehiculoDimensions(cat);
  const dims = row.dimensions ?? {};

  const alto = mergeDimension(dims.alto, defs.alto);
  const ancho = mergeDimension(dims.ancho, defs.ancho);
  const largo = mergeDimension(dims.largo, defs.largo);

  if (alto <= 0 || ancho <= 0 || largo <= 0) {
    return {
      ok: false,
      error: `Dimensions véhicule invalides pour la catégorie « ${cat} » (alto/ancho/largo > 0 requis).`,
    };
  }

  let rawTrailerLength = false;
  if (isCarWithTrailerCategory(cat)) {
    /**
     * XR : défaut en longueur brute (largo total) pour coller au scénario Armas validé
     * `tipoVehiculo=XR` + `largo=14` + `alto=5`.
     * Les autres catégories remorque gardent le défaut historique (`split`) sauf override explicite.
     */
    if (typeof row.rawTrailerLength === "boolean") {
      rawTrailerLength = row.rawTrailerLength;
    } else {
      rawTrailerLength = cat === "large_tourism_car_trailer";
    }
  }

  return {
    ok: true,
    presence: "vehicle",
    vehicle: {
      category: cat,
      quantity: lineQuantity(row),
      label: row.label || cat,
      driverPassengerIndex: row.driverPassengerIndex,
      marque: (row.marque || "").trim() || "VEHICULE STANDARD",
      modele: (row.modele || "").trim() || "MODELE",
      immatriculation: (row.immatriculation || "").trim() || "TEMP123",
      alto,
      ancho,
      largo,
      tipoVehiculo: (
        row.tipoVehiculo?.trim() || armasTipoVehiculoForCategory(cat)
      ).toUpperCase(),
      taraKg:
        typeof row.taraKg === "number" && Number.isFinite(row.taraKg) && row.taraKg >= 0
          ? Math.floor(row.taraKg)
          : undefined,
      seguro: row.seguro?.trim() || undefined,
      rawTrailerLength,
      armasCompanion: armasVehicleLineForCategory(cat),
    },
  };
}
