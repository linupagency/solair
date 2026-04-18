"use client";

import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import {
  getBookingFlow,
  setBookingFlow,
} from "@/lib/booking-flow-storage";
import {
  createEmptyBookingFlow,
  expandPassengerTipoList,
  getPrimaryPassengerType,
  type BookingFlow,
  type BookingSalidaServiceOffer,
  type BookingSelectedDeparture,
  type BookingTransportPricingCanonical,
  type BookingVehicleSelection,
} from "@/lib/booking-flow";
import {
  resolveExplicitVehicleOnSalidaServices,
} from "@/lib/armas/vehicle-line-explicit";
import {
  totalVehiclesBooked,
  vehicleLineQuantity,
} from "@/lib/armas/pricing-combined-flow";
import { tryBuildTarificacionPostBodyFromFlow } from "@/lib/armas/tarificacion-post-body";
import { fetchTransportPricing } from "@/lib/armas/transport-pricing-client";
import { isArmasRtPricingDebugEnabled } from "@/lib/armas/rt-pricing-debug";
import {
  isXrTraceTargetCategory,
  xrPricingTraceEnabled,
} from "@/lib/armas/xr-pricing-trace.public";
import {
  isPrimaryServiceEligibleForVehicleCompanionPricing,
  isTransportPricingBlockedCodigo,
} from "@/lib/armas/pricing-combined-primary";
import { getTarificacionRawLinesFromSoapResult } from "@/lib/armas/tarificacion-normalize";
import {
  eurosFromDisplay,
  getCommercialKind,
  getCommercialLabel,
  type CommercialOfferKind,
} from "@/lib/ui/armas-commercial";

type JourneyDirection = "outbound" | "inbound";

type ServiceVente = {
  codigoServicioVenta?: string;
  disponibilidad?: boolean;
  disponibles?: number;
  textoCorto?: string;
  textoLargo?: string;
  tipoServicioVenta?: string;
};

type Salida = {
  fechaSalida?: string;
  fechaLlegada?: string;
  horaSalida?: string;
  horaLlegada?: string;
  codigoNaviera?: string;
  estadoSalida?: string;
  tipoSalida?: string;
  barcoEntidad?: {
    codigoBarco?: string;
    textoCorto?: string;
    tipoBarco?: string;
  };
  trayectoEntidad?: {
    puertoOrigenEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
    puertoDestinoEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
  };
  serviciosVentasEntidad?: {
    servicioVentaEntidad?: ServiceVente[] | ServiceVente;
  };
};

type DeparturesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  data?: {
    return?: {
      salidasEntidad?: {
        salidaEntidad?: Salida[] | Salida;
      };
    };
  };
};

type AvailableDatesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  availableDates?: string[];
};

type PricingLine = {
  bonificacionEntidad?: {
    codigoBonificacion?: string;
    textoCorto?: string;
  };
  precioEntidad?: {
    total?: number | string;
  };
  precioIdaEntidad?: {
    total?: number | string;
  };
  precioVtaEntidad?: {
    total?: number | string;
  };
  tarifaEntidad?: {
    codigoTarifa?: string;
    textoCorto?: string;
  };
};

type PricingState = {
  status: "idle" | "loading" | "success" | "error" | "unsupported";
  total?: string;
  note?: string;
  tarifa?: string;
  raw?: unknown;
};

type SelectedChoice = {
  direction: JourneyDirection;
  salida: Salida;
  service: ServiceVente;
};

type SelectedRoundTripTotalsState = {
  outbound: number | null;
  inbound: number | null;
  bundleTotal: number;
  segmentVentilationReliable: boolean;
  codigoTarifa: string;
  tarifaLabel: string;
  bonificationLabel: string;
  outboundMatchKey: string;
  inboundMatchKey: string;
  outboundMatchParts: PricingMatchParts;
  inboundMatchParts: PricingMatchParts;
  rawPricingResponse?: unknown;
};

type PricingMatchParts = {
  direction: string;
  fechaSalida: string;
  horaSalida: string;
  horaLlegada: string;
  barcoCodigo: string;
  barcoNombre: string;
  salidaSegment: string;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  vehicleSegment: string;
};

type PricingRawParts = {
  direction: string;
  fechaSalida: string;
  horaSalida: string;
  horaLlegada: string;
  barcoCodigo: string;
  barcoNombre: string;
  salidaSegment: string;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  vehicleSegment: string;
};

const ROUND_TRIP_CARD_NEUTRAL_PRICE_LABEL =
  "Tarif calculé après sélection de l'aller et du retour";
const DATE_SUGGESTION_LOOKAROUND_DAYS = 21;
const DATE_SUGGESTION_CARD_COUNT = 3;
const MOROCCO_PORT_CODES = new Set([
  "PTM",
  "TNG",
  "TNGM",
  "NDR",
  "NAD",
  "AHU",
  "HOC",
  "CAS",
]);

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/** Compare `fechaSalida` Armas à `fechaIda` / `fechaVuelta` du dossier (YYYYMMDD). */
function normalizeSearchDate(value?: string): string {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : digits;
}

function formatApiDate(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

function formatApiDateLongFr(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (!year || !month || !day) return formatApiDate(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function shiftApiDate(value: string, days: number) {
  const digits = normalizeSearchDate(value);
  if (!/^\d{8}$/.test(digits)) return digits;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function formatMoney(value?: string | number) {
  if (typeof value === "number") {
    return `${value.toFixed(2).replace(".", ",")} €`;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed)) {
      return `${parsed.toFixed(2).replace(".", ",")} €`;
    }
    return value.includes("€") ? value : `${value} €`;
  }

  return "-";
}

function serviceLabel(service?: ServiceVente) {
  if (!service) return "-";
  return getCommercialLabel(service);
}

function parseTimeToMinutes(value?: string): number | null {
  if (!value || value.length !== 4) return null;
  const hh = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatDurationFromTimes(horaSalida?: string, horaLlegada?: string) {
  const s = parseTimeToMinutes(horaSalida);
  const a = parseTimeToMinutes(horaLlegada);
  if (s === null || a === null) return "-";
  let diff = a - s;
  if (diff < 0) diff += 24 * 60;
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h <= 0 && m <= 0) return "-";
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

function getPortTimeZone(port?: {
  codigoPuerto?: string;
  textoCorto?: string;
  textoLargo?: string;
}) {
  const code = String(port?.codigoPuerto || "").trim().toUpperCase();
  const text = `${String(port?.textoCorto || "")} ${String(port?.textoLargo || "")}`
    .trim()
    .toUpperCase();

  if (
    MOROCCO_PORT_CODES.has(code) ||
    /TANGER|TÁNGER|NADOR|AL HOCEIMA|MAROC|MARRUECOS|CASABLANCA/.test(text)
  ) {
    return "Africa/Casablanca";
  }

  return "Europe/Madrid";
}

function getTimeZoneOffsetMinutes(timeZone: string, date: Date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(lookup.year || "0");
  const month = Number(lookup.month || "0");
  const day = Number(lookup.day || "0");
  const hour = Number(lookup.hour || "0");
  const minute = Number(lookup.minute || "0");
  const second = Number(lookup.second || "0");

  return (
    (Date.UTC(year, month - 1, day, hour, minute, second) - date.getTime()) /
    60000
  );
}

function zonedDateTimeToUtcMs(
  dateValue: string,
  timeValue: string,
  timeZone: string
) {
  const dateDigits = normalizeSearchDate(dateValue);
  if (!/^\d{8}$/.test(dateDigits) || !/^\d{4}$/.test(timeValue)) return null;

  const year = Number(dateDigits.slice(0, 4));
  const month = Number(dateDigits.slice(4, 6));
  const day = Number(dateDigits.slice(6, 8));
  const hour = Number(timeValue.slice(0, 2));
  const minute = Number(timeValue.slice(2, 4));

  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const offset = getTimeZoneOffsetMinutes(timeZone, new Date(utcGuess));
    const nextGuess = Date.UTC(year, month - 1, day, hour, minute, 0) - offset * 60000;
    if (nextGuess === utcGuess) break;
    utcGuess = nextGuess;
  }

  return utcGuess;
}

function formatDurationForSalida(salida: Salida) {
  const fallback = formatDurationFromTimes(salida.horaSalida, salida.horaLlegada);
  const departureDate = normalizeSearchDate(salida.fechaSalida);
  const arrivalDate =
    normalizeSearchDate(salida.fechaLlegada) || departureDate;
  const departureTime = String(salida.horaSalida || "").trim();
  const arrivalTime = String(salida.horaLlegada || "").trim();

  if (!departureDate || !departureTime || !arrivalTime) return fallback;

  const departureZone = getPortTimeZone(salida.trayectoEntidad?.puertoOrigenEntidad);
  const arrivalZone = getPortTimeZone(salida.trayectoEntidad?.puertoDestinoEntidad);
  const departureUtc = zonedDateTimeToUtcMs(
    departureDate,
    departureTime,
    departureZone
  );
  let arrivalUtc = zonedDateTimeToUtcMs(arrivalDate, arrivalTime, arrivalZone);

  if (departureUtc === null || arrivalUtc === null) return fallback;
  if (arrivalUtc <= departureUtc) {
    arrivalUtc = zonedDateTimeToUtcMs(
      shiftApiDate(arrivalDate, 1),
      arrivalTime,
      arrivalZone
    );
    if (arrivalUtc === null) return fallback;
  }

  const diff = Math.round((arrivalUtc - departureUtc) / 60000);
  if (!Number.isFinite(diff) || diff <= 0) return fallback;

  const hours = Math.floor(diff / 60);
  const minutes = diff % 60;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
}

function pickSuggestedDates(
  availableDates: string[],
  selectedDate: string,
  maxCards = DATE_SUGGESTION_CARD_COUNT
) {
  const normalized = Array.from(
    new Set(availableDates.map((value) => normalizeSearchDate(value)).filter(Boolean))
  ).sort();
  if (normalized.length <= maxCards) return normalized;

  const target = normalizeSearchDate(selectedDate);
  const selectedIndex = normalized.indexOf(target);

  if (selectedIndex >= 0) {
    let start = Math.max(0, selectedIndex - Math.floor(maxCards / 2));
    let end = start + maxCards;
    if (end > normalized.length) {
      end = normalized.length;
      start = Math.max(0, end - maxCards);
    }
    return normalized.slice(start, end);
  }

  const future = normalized.filter((date) => date >= target);
  if (future.length >= maxCards) return future.slice(0, maxCards);
  return normalized.slice(Math.max(0, normalized.length - maxCards));
}

function discountLabel(code: string, apiLabel?: string) {
  if (apiLabel?.trim()) return apiLabel.trim();

  switch (code) {
    case "G":
      return "Tarif général";
    case "R":
      return "Résident";
    case "F1":
      return "Famille nombreuse";
    default:
      return code || "-";
  }
}

function getPassengerSummary(flow: BookingFlow) {
  const counts = flow.search.passengers;
  const parts: string[] = [];

  if (counts.adults > 0) {
    parts.push(`${counts.adults} adulte${counts.adults > 1 ? "s" : ""}`);
  }
  if (counts.youth > 0) {
    parts.push(`${counts.youth} jeune${counts.youth > 1 ? "s" : ""}`);
  }
  if (counts.seniors > 0) {
    parts.push(`${counts.seniors} senior${counts.seniors > 1 ? "s" : ""}`);
  }
  if (counts.children > 0) {
    parts.push(`${counts.children} enfant${counts.children > 1 ? "s" : ""}`);
  }
  if (counts.babies > 0) {
    parts.push(`${counts.babies} bébé${counts.babies > 1 ? "s" : ""}`);
  }

  return parts.join(" • ") || "Aucun passager";
}

function getAnimalsSummary(flow: BookingFlow) {
  const animals = flow.search.animals;
  if (!animals.enabled || animals.count <= 0) return "Sans animal";
  return `${animals.count} animal${animals.count > 1 ? "ux" : ""}`;
}

function getVehiclesSummary(flow: BookingFlow) {
  if (!flow.search.vehicles.length) return "Sans véhicule";

  return flow.search.vehicles
    .filter((vehicle) => vehicleLineQuantity(vehicle) > 0)
    .map((vehicle) => `${vehicle.quantity} ${vehicle.label.toLowerCase()}`)
    .join(" • ");
}

function getDirectionTitle(direction: JourneyDirection, flow: BookingFlow) {
  if (flow.tripType === "one_way") return "Traversées disponibles";
  return direction === "outbound" ? "Aller" : "Retour";
}

function getDirectionSubtitle(direction: JourneyDirection, flow: BookingFlow) {
  if (direction === "outbound") {
    return `${flow.search.origen} → ${flow.search.destino}`;
  }
  return `${flow.search.destino} → ${flow.search.origen}`;
}

function getSalidaOrigenCode(salida: Salida): string {
  return String(salida.trayectoEntidad?.puertoOrigenEntidad?.codigoPuerto || "").trim();
}

function getSalidaDestinoCode(salida: Salida): string {
  return String(salida.trayectoEntidad?.puertoDestinoEntidad?.codigoPuerto || "").trim();
}

/** Suffixe de clé tarif : distingue VR / XR / … sur la même salida et le même service passager. */
function pricingMapVehicleSegment(flow: BookingFlow): string {
  if (!dossierHasVehicle(flow)) return "";
  return (getPrimaryVehicle(flow)?.category || "").trim();
}

/**
 * Discrimine deux salidas avec même date/heure (ex. deux navires) — évite une clé `pricingMap` partagée.
 * Les `|` sont neutralisés pour ne pas casser le découpage futur de la clé.
 */
function pricingSalidaInstanceSegment(salida: Salida): string {
  const codigoBarco = String(salida.barcoEntidad?.codigoBarco || "").trim();
  if (codigoBarco) return codigoBarco.replace(/\|/g, "_");
  const nombreBarco = String(salida.barcoEntidad?.textoCorto || "").trim();
  return nombreBarco ? nombreBarco.replace(/\|/g, "_") : "";
}

function normalizePricingField(value: string): string {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function buildDebugSegmentKey(input: {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  barco?: string;
  serviceCode?: string;
  serviceType?: string;
}) {
  return [
    normalizePricingField(input.origen),
    normalizePricingField(input.destino),
    normalizePricingField(input.fechaSalida),
    normalizePricingField(input.horaSalida),
    "",
    normalizePricingField(input.serviceCode || ""),
    normalizePricingField(input.serviceType || ""),
  ].join("|");
}

function buildPricingMatchParts(
  direction: JourneyDirection,
  salida: Salida,
  service: ServiceVente,
  flow: BookingFlow
): PricingMatchParts {
  return {
    direction: normalizePricingField(direction),
    fechaSalida: normalizePricingField(String(salida.fechaSalida || "")),
    horaSalida: normalizePricingField(String(salida.horaSalida || "")),
    horaLlegada: normalizePricingField(String(salida.horaLlegada || "")),
    barcoCodigo: normalizePricingField(String(salida.barcoEntidad?.codigoBarco || "")),
    barcoNombre: normalizePricingField(String(salida.barcoEntidad?.textoCorto || "")),
    salidaSegment: normalizePricingField(pricingSalidaInstanceSegment(salida)),
    codigoServicioVenta: normalizePricingField(
      String(service.codigoServicioVenta || "")
    ),
    tipoServicioVenta: normalizePricingField(String(service.tipoServicioVenta || "")),
    vehicleSegment: normalizePricingField(pricingMapVehicleSegment(flow)),
  };
}

function buildPricingRawParts(
  direction: JourneyDirection,
  salida: Salida,
  service: ServiceVente,
  flow: BookingFlow
): PricingRawParts {
  return {
    direction: String(direction || ""),
    fechaSalida: String(salida.fechaSalida || ""),
    horaSalida: String(salida.horaSalida || ""),
    horaLlegada: String(salida.horaLlegada || ""),
    barcoCodigo: String(salida.barcoEntidad?.codigoBarco || ""),
    barcoNombre: String(salida.barcoEntidad?.textoCorto || ""),
    salidaSegment: pricingSalidaInstanceSegment(salida),
    codigoServicioVenta: String(service.codigoServicioVenta || ""),
    tipoServicioVenta: String(service.tipoServicioVenta || ""),
    vehicleSegment: pricingMapVehicleSegment(flow),
  };
}

function pricingPartsToKey(parts: PricingMatchParts): string {
  return [
    parts.direction,
    parts.fechaSalida,
    parts.horaSalida,
    parts.salidaSegment,
    parts.codigoServicioVenta,
    parts.tipoServicioVenta,
    parts.vehicleSegment,
  ].join("|");
}

function diffPricingParts(expected: PricingMatchParts, actual: PricingMatchParts) {
  const fields = Object.keys(expected) as Array<keyof PricingMatchParts>;
  return fields
    .filter((f) => expected[f] !== actual[f])
    .map((f) => ({
      field: f,
      expected: expected[f],
      actual: actual[f],
    }));
}

function isRobustPricingPartsMatch(
  expected: PricingMatchParts,
  actual: PricingMatchParts
): boolean {
  const baseEqual =
    expected.direction === actual.direction &&
    expected.fechaSalida === actual.fechaSalida &&
    expected.horaSalida === actual.horaSalida &&
    expected.codigoServicioVenta === actual.codigoServicioVenta &&
    expected.tipoServicioVenta === actual.tipoServicioVenta &&
    expected.vehicleSegment === actual.vehicleSegment;
  if (!baseEqual) return false;
  // Bateau: si code dispo des deux côtés -> code strict, sinon fallback nom.
  if (expected.barcoCodigo && actual.barcoCodigo) {
    return expected.barcoCodigo === actual.barcoCodigo;
  }
  return !!expected.barcoNombre && expected.barcoNombre === actual.barcoNombre;
}

function getPricingKey(
  direction: JourneyDirection,
  salida: Salida,
  service: ServiceVente,
  flow: BookingFlow
) {
  return pricingPartsToKey(buildPricingMatchParts(direction, salida, service, flow));
}

const PASSENGER_TRANSPORT_CODES = new Set(["BY", "BP", "P", "Q"]);

/** Codes / types « véhicule » côté Armas (hors transport passager). */
const VEHICLE_SERVICE_CODES = new Set([
  "V",
  "X",
  "Y",
  "VR",
  "XR",
  "YR",
  "BR",
  "AC",
  "MT",
  "BI",
]);

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function combinedServiceLabelUpper(service: ServiceVente): string {
  const raw = `${service.textoCorto || ""} ${service.textoLargo || ""}`;
  return stripAccents(raw).toUpperCase();
}

/**
 * Service lié au transport / enregistrement véhicule (à masquer si dossier sans véhicule).
 */
function isVehicleService(service: ServiceVente): boolean {
  const codigo = (service.codigoServicioVenta || "").trim().toUpperCase();
  if (PASSENGER_TRANSPORT_CODES.has(codigo)) return false;

  const tipo = (service.tipoServicioVenta || "").trim();
  const tipoU = tipo.toUpperCase();
  /** Même logique que `isVehicleService` (armas-commercial) : P = passager, pas ligne catalogue véhicule. */
  if (tipoU === "P") return false;
  if (tipoU === "V") return true;
  if (VEHICLE_SERVICE_CODES.has(codigo)) return true;

  const label = combinedServiceLabelUpper(service);
  if (label.includes("VEHICULE") || label.includes("REMORQUE")) return true;
  if (label.includes("CAMPING-CAR") || label.includes("CAMPING CAR")) return true;
  if (/\bMOTO\b/.test(label)) return true;

  return false;
}

/**
 * Service lié aux animaux (à masquer si dossier sans animal).
 */
function isAnimalService(service: ServiceVente): boolean {
  const codigo = (service.codigoServicioVenta || "").toUpperCase();
  const label = combinedServiceLabelUpper(service);

  if (label.includes("MASCOTA") || label.includes("MASCOTAS")) return true;
  if (label.includes("ANIMAL")) return true;
  if (/\bPET\b/.test(label)) return true;
  if (codigo.includes("MASCOTA")) return true;

  const cabinish =
    label.includes("CAMAROTE") ||
    label.includes("CABINA") ||
    label.includes("CABINE");
  if (
    cabinish &&
    (label.includes("MASCOTA") ||
      label.includes("MASCOTAS") ||
      label.includes("ANIMAL") ||
      /\bPET\b/.test(label))
  ) {
    return true;
  }

  return false;
}

function dossierHasAnimals(flow: BookingFlow): boolean {
  return Boolean(flow.search.animals.enabled && flow.search.animals.count > 0);
}

/** Au moins un véhicule avec quantité > 0. */
function dossierHasVehicle(flow: BookingFlow): boolean {
  return flow.search.vehicles.some((v) => vehicleLineQuantity(v) > 0);
}

/**
 * Appels `test-pricing` pour alimenter les cartes Fauteuil / Cabine uniquement.
 * Exclut tipo `X`, codes annexes (MCA, …), lignes « pet », et les véhicules catalogue
 * lorsqu’un véhicule est déjà dans le dossier (déjà géré ailleurs).
 *
 * Avec véhicule + ligne véhicule explicite OK sur la salida : seuls les primaires P
 * éligibles au combiné (BY, BP, …) sont tarifés pour une place type siège — aligné
 * sur l’appel `P + companion V` (ex. BY|P + VR|V).
 */
function shouldRequestPricingForTransportCommercialCards(
  flow: BookingFlow,
  salida: Salida,
  service: ServiceVente
): boolean {
  if (!isServiceCompatibleWithDossier(flow, service)) return false;
  if (dossierHasVehicle(flow) && getCommercialKind(service) === "vehicle") {
    return false;
  }
  const tipo = (service.tipoServicioVenta || "").trim().toUpperCase();
  const codigo = (service.codigoServicioVenta || "").trim().toUpperCase();
  if (tipo === "X") return false;
  if (isTransportPricingBlockedCodigo(codigo)) return false;
  if (getCommercialKind(service) === "pet") return false;
  if (tipo !== "P") return false;

  const kind = getCommercialKind(service);
  if (kind === "cabin") return true;

  if (kind === "seat") {
    if (!dossierHasVehicle(flow)) return true;
    const vehOk = explicitVehicleSalidaStatus(flow, salida).status === "ok";
    if (!vehOk) return true;
    return isPrimaryServiceEligibleForVehicleCompanionPricing(service);
  }

  if (kind === "unknown") {
    if (!dossierHasVehicle(flow)) {
      return isPrimaryServiceEligibleForVehicleCompanionPricing(service);
    }
    const vehOk = explicitVehicleSalidaStatus(flow, salida).status === "ok";
    if (!vehOk) return true;
    return isPrimaryServiceEligibleForVehicleCompanionPricing(service);
  }

  return false;
}

/**
 * Service présent dans le catalogue Armas mais compatible avec le dossier (avant pricing).
 */
function isServiceCompatibleWithDossier(
  flow: BookingFlow,
  service: ServiceVente
): boolean {
  if (isVehicleService(service) && !dossierHasVehicle(flow)) return false;
  if (isAnimalService(service) && !dossierHasAnimals(flow)) return false;
  return true;
}

function getCompatibleServicesForSalida(
  flow: BookingFlow,
  salida: Salida
): ServiceVente[] {
  return normalizeArray(
    salida.serviciosVentasEntidad?.servicioVentaEntidad
  ).filter(
    (service) =>
      service.disponibilidad !== false &&
      !!service.codigoServicioVenta &&
      !!service.tipoServicioVenta &&
      isServiceCompatibleWithDossier(flow, service)
  );
}

/** Toutes les lignes catalogue sur la salida (y compris indisponibles) pour résolution explicite. */
function getAllSalidaServiciosWithCodes(salida: Salida): ServiceVente[] {
  return normalizeArray(
    salida.serviciosVentasEntidad?.servicioVentaEntidad
  ).filter(
    (service) =>
      !!service.codigoServicioVenta && !!service.tipoServicioVenta
  );
}

function explicitVehicleSalidaStatus(
  flow: BookingFlow,
  salida: Salida
): ReturnType<typeof resolveExplicitVehicleOnSalidaServices<ServiceVente>> {
  const primary = getPrimaryVehicle(flow);
  if (!primary?.category) return { status: "unknown_category" };
  return resolveExplicitVehicleOnSalidaServices(
    primary.category,
    getAllSalidaServiciosWithCodes(salida)
  );
}

function getCombinedTransportTotalString(
  flow: BookingFlow,
  direction: JourneyDirection,
  choice: SelectedChoice,
  pricingMap: Record<string, PricingState>
): string | undefined {
  const seatKey = getPricingKey(direction, choice.salida, choice.service, flow);
  const seatState = pricingMap[seatKey];
  if (seatState?.status !== "success" || !seatState.total) return undefined;
  return seatState.total;
}

function vehicleAddonPricingRequiredAndMissing(
  flow: BookingFlow,
  _direction: JourneyDirection,
  salida: Salida,
  _pricingMap: Record<string, PricingState>
): boolean {
  if (!dossierHasVehicle(flow)) return false;
  const st = explicitVehicleSalidaStatus(flow, salida);
  if (st.status === "unknown_category" || st.status === "not_in_catalog") {
    return true;
  }
  if (st.status === "unavailable") return true;
  return false;
}

function mergeSeatAndVehiclePricingState(
  _flow: BookingFlow,
  _direction: JourneyDirection,
  _choice: SelectedChoice,
  seatState: PricingState | undefined,
  _pricingMap: Record<string, PricingState>
): PricingState | undefined {
  return seatState;
}

function parsePricingTotalEuros(total?: string): number | null {
  if (!total?.trim()) return null;
  const n = Number(
    total.replace("€", "").replace(/\s/g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? n : null;
}

function roundEuros(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseSoapPriceTotal(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const n = Number(value.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isSameChoice(
  selected: SelectedChoice | null,
  direction: JourneyDirection,
  salida: Salida,
  service: ServiceVente
) {
  if (!selected) return false;

  return (
    selected.direction === direction &&
    selected.salida.fechaSalida === salida.fechaSalida &&
    selected.salida.horaSalida === salida.horaSalida &&
    selected.service.codigoServicioVenta === service.codigoServicioVenta &&
    selected.service.tipoServicioVenta === service.tipoServicioVenta
  );
}

function getTotalPassengers(flow: BookingFlow) {
  const counts = flow.search.passengers;
  return (
    counts.adults +
    counts.youth +
    counts.seniors +
    counts.children +
    counts.babies
  );
}

function getPrimaryVehicle(flow: BookingFlow) {
  return flow.search.vehicles.find((vehicle) => vehicleLineQuantity(vehicle) > 0);
}

function shouldLogXrClientTrace(flow: BookingFlow): boolean {
  if (!xrPricingTraceEnabled()) return false;
  return isXrTraceTargetCategory(getPrimaryVehicle(flow)?.category);
}

function getVehicleFallbackDimensions(category: string) {
  switch (category) {
    case "small_tourism_car":
    case "car":
      return { alto: 1.8, ancho: 1.8, largo: 4.5 };
    case "large_tourism_car":
      return { alto: 2.01, ancho: 2.0, largo: 6.0 };
    case "medium_tourism_car":
      return { alto: 1.93, ancho: 1.9, largo: 4.93 };
    case "small_tourism_car_trailer":
      return { alto: 1.85, ancho: 1.8, largo: 8.0 };
    case "medium_tourism_car_trailer":
      return { alto: 2, ancho: 2, largo: 10.0 };
    case "large_tourism_car_trailer":
      return { alto: 5, ancho: 2, largo: 14.0 };
    case "bus_with_trailer":
      return { alto: 4.0, ancho: 2.55, largo: 14.0 };
    case "camper":
      return { alto: 3.0, ancho: 2.3, largo: 12.0 };
    case "moto":
      return { alto: 1.4, ancho: 0.9, largo: 2.2 };
    case "bike":
    case "bicycle":
      return { alto: 1.2, ancho: 0.6, largo: 1.8 };
    default:
      return {};
  }
}

function extractOffersFromSalida(salida: Salida): BookingSalidaServiceOffer[] {
  return normalizeArray(
    salida.serviciosVentasEntidad?.servicioVentaEntidad
  )
    .filter(
      (service) =>
        service.disponibilidad !== false &&
        !!service.codigoServicioVenta &&
        !!service.tipoServicioVenta
    )
    .map((service) => ({
      codigoServicioVenta: service.codigoServicioVenta || "",
      tipoServicioVenta: service.tipoServicioVenta || "",
      disponibles:
        typeof service.disponibles === "number" &&
        Number.isFinite(service.disponibles)
          ? Math.floor(service.disponibles)
          : undefined,
      textoCorto: service.textoCorto,
      textoLargo: service.textoLargo,
    }));
}

/** Offres catalogue compatibles dossier (véhicule / animal), pour BookingFlow.availableServices. */
function extractEligibleOffersFromSalida(
  flow: BookingFlow,
  salida: Salida
): BookingSalidaServiceOffer[] {
  return normalizeArray(
    salida.serviciosVentasEntidad?.servicioVentaEntidad
  )
    .filter(
      (service) =>
        service.disponibilidad !== false &&
        !!service.codigoServicioVenta &&
        !!service.tipoServicioVenta
    )
    .filter((service) => isServiceCompatibleWithDossier(flow, service))
    .map((service) => ({
      codigoServicioVenta: service.codigoServicioVenta || "",
      tipoServicioVenta: service.tipoServicioVenta || "",
      disponibles:
        typeof service.disponibles === "number" &&
        Number.isFinite(service.disponibles)
          ? Math.floor(service.disponibles)
          : undefined,
      textoCorto: service.textoCorto,
      textoLargo: service.textoLargo,
    }));
}

function mapChoiceToBookingSelectedDeparture(
  choice: SelectedChoice,
  pricingState?: PricingState
): BookingSelectedDeparture {
  const origen =
    choice.salida.trayectoEntidad?.puertoOrigenEntidad?.codigoPuerto || "";
  const destino =
    choice.salida.trayectoEntidad?.puertoDestinoEntidad?.codigoPuerto || "";

  return {
    origen,
    destino,
    fechaSalida: choice.salida.fechaSalida || "",
    horaSalida: choice.salida.horaSalida || "",
    codigoServicioVenta: choice.service.codigoServicioVenta || "",
    tipoServicioVenta: choice.service.tipoServicioVenta || "",
    barco: choice.salida.barcoEntidad?.textoCorto,
    transportPrice: pricingState?.total || "",
    pricingRaw: pricingState?.raw,
  };
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="solair-panel p-5 sm:p-6">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle ? (
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function RoundTripMobileStepHeading({
  step,
  label,
}: {
  step: 1 | 2;
  label: string;
}) {
  return (
    <div
      className={`mb-4 rounded-2xl border-2 border-[#163B6D] bg-white px-4 py-3 shadow-sm lg:hidden ${
        step === 2 ? "mt-10 border-t-[6px] border-t-[#F28C28]" : ""
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#163B6D]">
        Étape {step}
      </p>
      <p className="mt-1 text-lg font-bold text-slate-900">{label}</p>
    </div>
  );
}

function getVehicleLabelFromCategory(category: string) {
  switch (category) {
    case "small_tourism_car":
      return "Petite Voiture de Tourisme";
    case "large_tourism_car":
      return "Grande Voiture de Tourisme";
    case "medium_tourism_car":
      return "Voiture de tourisme moyenne";
    case "small_tourism_car_trailer":
      return "Petite voiture + remorque (max. 8 m)";
    case "medium_tourism_car_trailer":
      return "Voiture moyenne + remorque (max. 10 m)";
    case "large_tourism_car_trailer":
      return "Grande voiture + remorque (max. 14 m)";
    case "bus_with_trailer":
      return "Autobus + remorque (max. 14 m)";
    case "camper":
      return "Camping-Car";
    case "moto":
      return "Moto";
    case "bike":
    case "bicycle":
      return "Bicyclette";
    default:
      return "Véhicule";
  }
}

function getVehicleDimensionsFromCategory(category: string) {
  if (category === "small_tourism_car") {
    return { largo: 4.5, alto: 1.8, ancho: 1.8 };
  }
  const d = getVehicleFallbackDimensions(category);
  if (typeof d.largo === "number") {
    return d;
  }
  return undefined;
}

function buildFallbackVehiclesFromParams(
  searchParams: ReadonlyURLSearchParams
): BookingVehicleSelection[] {
  const vehiclesCount = Number(searchParams.get("vehiclesCount") || "0");
  const vehicleCategoryParam = searchParams.get("vehicleCategory") || "";
  const legacyVehicle = searchParams.get("vehicle") || "none";

  let category = vehicleCategoryParam;

  if (!category || category === "none") {
    if (legacyVehicle === "camper") category = "camper";
    else if (legacyVehicle === "moto") category = "moto";
    else if (legacyVehicle === "car") category = "small_tourism_car";
    else category = "none";
  }

  if (category === "none") return [];

  return [
    {
      category,
      quantity: vehiclesCount > 0 ? vehiclesCount : 1,
      label: getVehicleLabelFromCategory(category),
      dimensions: getVehicleDimensionsFromCategory(category),
    },
  ];
}

function buildFallbackFlowFromParams(
  searchParams: ReadonlyURLSearchParams
): BookingFlow {
  const flow = createEmptyBookingFlow();

  const tripType =
    searchParams.get("tripType") === "round_trip" ? "round_trip" : "one_way";

  const adults = Number(searchParams.get("adults") || "0");
  const youth = Number(searchParams.get("youth") || "0");
  const seniors = Number(searchParams.get("seniors") || "0");
  const children = Number(searchParams.get("children") || "0");
  const babies = Number(searchParams.get("babies") || "0");
  const animalsCount = Number(searchParams.get("animals") || "0");

  flow.tripType = tripType;
  flow.search = {
    origen: searchParams.get("origen") || "",
    destino: searchParams.get("destino") || "",
    fechaIda: searchParams.get("fechaIda") || searchParams.get("fecha") || "",
    fechaVuelta: searchParams.get("fechaVuelta") || "",
    bonificacion: searchParams.get("bonificacion") || "G",
    passengers: {
      adults,
      youth,
      seniors,
      children,
      babies,
    },
    animals: {
      enabled: animalsCount > 0,
      count: animalsCount,
    },
    vehicles: buildFallbackVehiclesFromParams(searchParams),
  };

  return flow;
}

function hasUsableSearch(flow: BookingFlow | null | undefined) {
  if (!flow) return false;

  if (
    !flow.search.origen ||
    !flow.search.destino ||
    !flow.search.fechaIda ||
    getTotalPassengers(flow) <= 0
  ) {
    return false;
  }

  if (flow.tripType === "round_trip" && !String(flow.search.fechaVuelta || "").trim()) {
    return false;
  }

  return true;
}

function ResultatsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [flow, setFlowState] = useState<BookingFlow | null>(null);
  const [loadingFlow, setLoadingFlow] = useState(true);

  const [loadingDepartures, setLoadingDepartures] = useState(false);
  const [error, setError] = useState("");

  const [outboundDepartures, setOutboundDepartures] = useState<Salida[]>([]);
  const [inboundDepartures, setInboundDepartures] = useState<Salida[]>([]);
  const [availableOutboundDateSuggestions, setAvailableOutboundDateSuggestions] =
    useState<string[]>([]);
  const [availableInboundDateSuggestions, setAvailableInboundDateSuggestions] =
    useState<string[]>([]);
  const [loadingOutboundDateSuggestions, setLoadingOutboundDateSuggestions] =
    useState(false);
  const [loadingInboundDateSuggestions, setLoadingInboundDateSuggestions] =
    useState(false);

  const [selectedOutbound, setSelectedOutbound] = useState<SelectedChoice | null>(
    null
  );
  const [selectedInbound, setSelectedInbound] = useState<SelectedChoice | null>(
    null
  );
  const [selectedRoundTripTotals, setSelectedRoundTripTotals] =
    useState<SelectedRoundTripTotalsState | null>(null);
  const selectedRoundTripRequestSeq = useRef(0);

  const [pricingMap, setPricingMap] = useState<Record<string, PricingState>>({});

  const outboundDeparturesFiltered = useMemo(() => {
    if (!flow?.search.fechaIda) return [];
    const target = normalizeSearchDate(flow.search.fechaIda);
    return outboundDepartures.filter(
      (s) => normalizeSearchDate(s.fechaSalida) === target
    );
  }, [flow?.search.fechaIda, outboundDepartures]);

  const inboundDeparturesFiltered = useMemo(() => {
    if (!flow) return inboundDepartures;
    if (
      flow.tripType !== "round_trip" ||
      !String(flow.search.fechaVuelta || "").trim()
    ) {
      return inboundDepartures;
    }
    const target = normalizeSearchDate(flow.search.fechaVuelta);
    return inboundDepartures.filter(
      (s) => normalizeSearchDate(s.fechaSalida) === target
    );
  }, [flow, inboundDepartures]);

  useEffect(() => {
    const storedFlow = getBookingFlow();

    if (hasUsableSearch(storedFlow)) {
      setFlowState(storedFlow);
      setLoadingFlow(false);
      return;
    }

    const fallbackFlow = buildFallbackFlowFromParams(searchParams);

    if (hasUsableSearch(fallbackFlow)) {
      const normalized = setBookingFlow(fallbackFlow);
      setFlowState(normalized);
      setLoadingFlow(false);
      return;
    }

    setFlowState(storedFlow);
    setLoadingFlow(false);
  }, [searchParams]);

  useEffect(() => {
    if (!flow) return;

    if (flow.outbound.selectedDeparture && !selectedOutbound) {
      const previous = flow.outbound.selectedDeparture;
      setSelectedOutbound({
        direction: "outbound",
        salida: {
          fechaSalida: previous.fechaSalida,
          horaSalida: previous.horaSalida,
          barcoEntidad: {
            textoCorto: previous.barco,
          },
          trayectoEntidad: {
            puertoOrigenEntidad: { codigoPuerto: previous.origen },
            puertoDestinoEntidad: { codigoPuerto: previous.destino },
          },
        },
        service: {
          codigoServicioVenta: previous.codigoServicioVenta,
          tipoServicioVenta: previous.tipoServicioVenta,
        },
      });
    }

    if (
      flow.tripType === "round_trip" &&
      flow.inbound?.selectedDeparture &&
      !selectedInbound
    ) {
      const previous = flow.inbound.selectedDeparture;
      setSelectedInbound({
        direction: "inbound",
        salida: {
          fechaSalida: previous.fechaSalida,
          horaSalida: previous.horaSalida,
          barcoEntidad: {
            textoCorto: previous.barco,
          },
          trayectoEntidad: {
            puertoOrigenEntidad: { codigoPuerto: previous.origen },
            puertoDestinoEntidad: { codigoPuerto: previous.destino },
          },
        },
        service: {
          codigoServicioVenta: previous.codigoServicioVenta,
          tipoServicioVenta: previous.tipoServicioVenta,
        },
      });
    }
  }, [flow, selectedInbound, selectedOutbound]);

  useEffect(() => {
    let cancelled = false;

    async function fetchAvailableDateSuggestions(
      origen: string,
      destino: string,
      selectedDate: string
    ) {
      const normalizedDate = normalizeSearchDate(selectedDate);
      if (!origen || !destino || !normalizedDate) return [];

      const startDate = shiftApiDate(normalizedDate, -7);
      const response = await fetch(
        `/api/armas/test-available-dates?origen=${encodeURIComponent(
          origen
        )}&destino=${encodeURIComponent(
          destino
        )}&startDate=${encodeURIComponent(
          startDate
        )}&days=${DATE_SUGGESTION_LOOKAROUND_DAYS}&concurrency=8`,
        { cache: "no-store" }
      );

      const json: AvailableDatesApiResponse = await response.json();
      if (!response.ok || !json.ok) {
        throw new Error(
          json.error ||
            json.message ||
            "Impossible de charger les dates disponibles."
        );
      }

      return pickSuggestedDates(json.availableDates || [], normalizedDate);
    }

    async function loadDateSuggestions() {
      if (!flow?.search.origen || !flow.search.destino || !flow.search.fechaIda) {
        setAvailableOutboundDateSuggestions([]);
        setAvailableInboundDateSuggestions([]);
        return;
      }

      setLoadingOutboundDateSuggestions(true);
      setLoadingInboundDateSuggestions(flow.tripType === "round_trip");

      try {
        const outboundPromise = fetchAvailableDateSuggestions(
          flow.search.origen,
          flow.search.destino,
          flow.search.fechaIda
        );

        const inboundPromise =
          flow.tripType === "round_trip" && flow.search.fechaVuelta
            ? fetchAvailableDateSuggestions(
                flow.search.destino,
                flow.search.origen,
                flow.search.fechaVuelta
              )
            : Promise.resolve<string[]>([]);

        const [outboundDates, inboundDates] = await Promise.all([
          outboundPromise,
          inboundPromise,
        ]);

        if (cancelled) return;
        setAvailableOutboundDateSuggestions(outboundDates);
        setAvailableInboundDateSuggestions(inboundDates);
      } catch {
        if (cancelled) return;
        setAvailableOutboundDateSuggestions([]);
        setAvailableInboundDateSuggestions([]);
      } finally {
        if (cancelled) return;
        setLoadingOutboundDateSuggestions(false);
        setLoadingInboundDateSuggestions(false);
      }
    }

    void loadDateSuggestions();

    return () => {
      cancelled = true;
    };
  }, [
    flow?.tripType,
    flow?.search.origen,
    flow?.search.destino,
    flow?.search.fechaIda,
    flow?.search.fechaVuelta,
  ]);

  useEffect(() => {
    async function loadDepartures() {
      if (!flow) return;

      if (!flow.search.origen || !flow.search.destino || !flow.search.fechaIda) {
        setError("Le dossier de recherche est incomplet.");
        return;
      }

      try {
        setLoadingDepartures(true);
        setError("");

        const outboundResponse = await fetch(
          `/api/armas/test-departures?origen=${encodeURIComponent(
            flow.search.origen
          )}&destino=${encodeURIComponent(
            flow.search.destino
          )}&fecha=${encodeURIComponent(flow.search.fechaIda)}`,
          { cache: "no-store" }
        );

        const outboundJson: DeparturesApiResponse =
          await outboundResponse.json();

        if (!outboundResponse.ok || !outboundJson.ok) {
          throw new Error(
            outboundJson.error ||
              outboundJson.message ||
              "Impossible de charger les départs aller."
          );
        }

        const outboundList = normalizeArray(
          outboundJson.data?.return?.salidasEntidad?.salidaEntidad
        );

        setOutboundDepartures(outboundList);

        if (flow.tripType === "round_trip" && flow.search.fechaVuelta) {
          const inboundResponse = await fetch(
            `/api/armas/test-departures?origen=${encodeURIComponent(
              flow.search.destino
            )}&destino=${encodeURIComponent(
              flow.search.origen
            )}&fecha=${encodeURIComponent(flow.search.fechaVuelta)}`,
            { cache: "no-store" }
          );

          const inboundJson: DeparturesApiResponse =
            await inboundResponse.json();

          if (!inboundResponse.ok || !inboundJson.ok) {
            throw new Error(
              inboundJson.error ||
                inboundJson.message ||
                "Impossible de charger les départs retour."
            );
          }

          const inboundList = normalizeArray(
            inboundJson.data?.return?.salidasEntidad?.salidaEntidad
          );

          setInboundDepartures(inboundList);
        } else {
          setInboundDepartures([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur inconnue.");
      } finally {
        setLoadingDepartures(false);
      }
    }

    loadDepartures();
  }, [flow]);

  useEffect(() => {
    /**
     * Clés `pricingMap` : direction + salida + service passager + segment catégorie véhicule
     * (voir `pricingMapVehicleSegment`) pour ne pas mélanger VR / XR sur la même ligne.
     */
    let cancelled = false;

    async function loadPricing() {
      if (!flow) return;
      if (loadingDepartures || error) return;

      const totalPassengers = getTotalPassengers(flow);
      if (totalPassengers <= 0) return;

      const nextMap: Record<string, PricingState> = {};

      const pricingJobs: Array<{
        key: string;
        direction: JourneyDirection;
        salida: Salida;
        service: ServiceVente;
      }> = [];

      const datasets: Array<{
        direction: JourneyDirection;
        departures: Salida[];
      }> = [{ direction: "outbound", departures: outboundDeparturesFiltered }];

      if (flow.tripType === "round_trip") {
        datasets.push({
          direction: "inbound",
          departures: inboundDeparturesFiltered,
        });
      }

      for (const dataset of datasets) {
        for (const salida of dataset.departures) {
          const services = normalizeArray(
            salida.serviciosVentasEntidad?.servicioVentaEntidad
          ).filter(
            (service) =>
              service.disponibilidad !== false &&
              !!service.codigoServicioVenta &&
              !!service.tipoServicioVenta
          );

          for (const service of services) {
            if (!shouldRequestPricingForTransportCommercialCards(flow, salida, service)) {
              continue;
            }
            const key = getPricingKey(
              dataset.direction,
              salida,
              service,
              flow
            );
            nextMap[key] = { status: "loading" };
            pricingJobs.push({
              key,
              direction: dataset.direction,
              salida,
              service,
            });
          }
        }
      }

      setPricingMap(nextMap);

      const totalVehicles = totalVehiclesBooked(flow);
      const primaryPassengerType = getPrimaryPassengerType(flow.search.passengers);
      const tiposList = expandPassengerTipoList(flow.search.passengers);

      const inboundPartnerOk =
        flow.tripType === "round_trip" && selectedInbound
          ? tryBuildTarificacionPostBodyFromFlow(
              flow,
              {
                origen: flow.search.destino,
                destino: flow.search.origen,
                fechaSalida: String(
                  selectedInbound.salida.fechaSalida || ""
                ).trim(),
                horaSalida: String(
                  selectedInbound.salida.horaSalida || ""
                ).trim(),
              },
              {
                cantidad: totalPassengers,
                codigoServicioVenta: String(
                  selectedInbound.service.codigoServicioVenta || ""
                ).trim(),
                tipoServicioVenta: String(
                  selectedInbound.service.tipoServicioVenta || ""
                ).trim(),
                tipoPasajero: primaryPassengerType,
                passengerTipos: tiposList,
              },
              {
                serviciosVentas: getAllSalidaServiciosWithCodes(
                  selectedInbound.salida
                ),
              }
            )
          : null;
      const inboundPartner =
        inboundPartnerOk && inboundPartnerOk.ok ? inboundPartnerOk : null;

      const results = await Promise.all(
        pricingJobs.map(async ({ key, direction, salida, service }) => {
          const codigoServicioVenta = String(
            service.codigoServicioVenta || ""
          ).trim();
          const tipoServicioVenta = String(
            service.tipoServicioVenta || ""
          ).trim();

          const origen =
            direction === "outbound" ? flow.search.origen : flow.search.destino;
          const destino =
            direction === "outbound" ? flow.search.destino : flow.search.origen;

          try {
            const built = tryBuildTarificacionPostBodyFromFlow(
              flow,
              {
                origen,
                destino,
                fechaSalida: String(salida.fechaSalida || "").trim(),
                horaSalida: String(salida.horaSalida || "").trim(),
              },
              {
                cantidad: totalPassengers,
                codigoServicioVenta,
                tipoServicioVenta,
                tipoPasajero: primaryPassengerType,
                passengerTipos: tiposList,
              },
              { serviciosVentas: getAllSalidaServiciosWithCodes(salida) }
            );
            if (!built.ok) {
              return [
                key,
                {
                  status: "error",
                  note: built.error,
                } satisfies PricingState,
              ] as const;
            }

            const pricingBody = built.body;
            const pricingVehicle = built.normalizedVehicle;
            let fetchOpts:
              | {
                  requestId?: string;
                  tripType: "round_trip";
                  armasLeg: "outbound" | "inbound";
                  selectedOutboundSegment?: {
                    origen: string;
                    destino: string;
                    fechaSalida: string;
                    horaSalida: string;
                    barco?: string;
                    serviceCode?: string;
                    serviceType?: string;
                    segmentKey?: string;
                  };
                  selectedInboundSegment?: {
                    origen: string;
                    destino: string;
                    fechaSalida: string;
                    horaSalida: string;
                    barco?: string;
                    serviceCode?: string;
                    serviceType?: string;
                    segmentKey?: string;
                  };
                  returnSegment?: {
                    origen: string;
                    destino: string;
                    fechaSalida: string;
                    horaSalida: string;
                    codigoServicioVenta: string;
                    tipoServicioVenta: string;
                    sentidoSalida: 2;
                  };
                }
              | undefined =
              flow.tripType === "round_trip"
                ? {
                    requestId: `rt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    tripType: "round_trip",
                    armasLeg: direction === "outbound" ? "outbound" : "inbound",
                    selectedOutboundSegment: selectedOutbound
                      ? {
                          origen: getSalidaOrigenCode(selectedOutbound.salida),
                          destino: getSalidaDestinoCode(selectedOutbound.salida),
                          fechaSalida: String(
                            selectedOutbound.salida.fechaSalida || ""
                          ).trim(),
                          horaSalida: String(
                            selectedOutbound.salida.horaSalida || ""
                          ).trim(),
                          barco: String(
                            selectedOutbound.salida.barcoEntidad?.codigoBarco ||
                              selectedOutbound.salida.barcoEntidad?.textoCorto ||
                              ""
                          ).trim(),
                          serviceCode: String(
                            selectedOutbound.service.codigoServicioVenta || ""
                          ).trim(),
                          serviceType: String(
                            selectedOutbound.service.tipoServicioVenta || ""
                          ).trim(),
                          segmentKey: buildDebugSegmentKey({
                            origen: getSalidaOrigenCode(selectedOutbound.salida),
                            destino: getSalidaDestinoCode(selectedOutbound.salida),
                            fechaSalida: String(
                              selectedOutbound.salida.fechaSalida || ""
                            ).trim(),
                            horaSalida: String(
                              selectedOutbound.salida.horaSalida || ""
                            ).trim(),
                            barco: String(
                              selectedOutbound.salida.barcoEntidad?.codigoBarco ||
                                selectedOutbound.salida.barcoEntidad?.textoCorto ||
                                ""
                            ).trim(),
                            serviceCode: String(
                              selectedOutbound.service.codigoServicioVenta || ""
                            ).trim(),
                            serviceType: String(
                              selectedOutbound.service.tipoServicioVenta || ""
                            ).trim(),
                          }),
                        }
                      : undefined,
                    selectedInboundSegment: selectedInbound
                      ? {
                          origen: getSalidaOrigenCode(selectedInbound.salida),
                          destino: getSalidaDestinoCode(selectedInbound.salida),
                          fechaSalida: String(
                            selectedInbound.salida.fechaSalida || ""
                          ).trim(),
                          horaSalida: String(
                            selectedInbound.salida.horaSalida || ""
                          ).trim(),
                          barco: String(
                            selectedInbound.salida.barcoEntidad?.codigoBarco ||
                              selectedInbound.salida.barcoEntidad?.textoCorto ||
                              ""
                          ).trim(),
                          serviceCode: String(
                            selectedInbound.service.codigoServicioVenta || ""
                          ).trim(),
                          serviceType: String(
                            selectedInbound.service.tipoServicioVenta || ""
                          ).trim(),
                          segmentKey: buildDebugSegmentKey({
                            origen: getSalidaOrigenCode(selectedInbound.salida),
                            destino: getSalidaDestinoCode(selectedInbound.salida),
                            fechaSalida: String(
                              selectedInbound.salida.fechaSalida || ""
                            ).trim(),
                            horaSalida: String(
                              selectedInbound.salida.horaSalida || ""
                            ).trim(),
                            barco: String(
                              selectedInbound.salida.barcoEntidad?.codigoBarco ||
                                selectedInbound.salida.barcoEntidad?.textoCorto ||
                                ""
                            ).trim(),
                            serviceCode: String(
                              selectedInbound.service.codigoServicioVenta || ""
                            ).trim(),
                            serviceType: String(
                              selectedInbound.service.tipoServicioVenta || ""
                            ).trim(),
                          }),
                        }
                      : undefined,
                  }
                : undefined;

            if (flow.tripType === "round_trip") {
              if (direction === "outbound" && inboundPartner) {
                fetchOpts = {
                  ...(fetchOpts ?? {
                    tripType: "round_trip" as const,
                    armasLeg: "outbound" as const,
                  }),
                  armasLeg: "outbound",
                  returnSegment: {
                    origen: inboundPartner.body.origen,
                    destino: inboundPartner.body.destino,
                    fechaSalida: inboundPartner.body.fechaSalida,
                    horaSalida: inboundPartner.body.horaSalida,
                    codigoServicioVenta: inboundPartner.body.codigoServicioVenta,
                    tipoServicioVenta: inboundPartner.body.tipoServicioVenta,
                    sentidoSalida: 2,
                  },
                };
              }
            }

            if (shouldLogXrClientTrace(flow)) {
              const primaryVehicleLine = getPrimaryVehicle(flow);
              console.info(
                "[SOLAIR_XR_TRACE] client:beforeFetch\n" +
                  JSON.stringify(
                    {
                      stage: "client:beforeFetch",
                      pricingKey: key,
                      direction,
                      uiOptionSelected: {
                        label: primaryVehicleLine?.label,
                        category: primaryVehicleLine?.category,
                        quantity: primaryVehicleLine?.quantity,
                        rawTrailerLength: primaryVehicleLine?.rawTrailerLength,
                        tipoVehiculo: primaryVehicleLine?.tipoVehiculo,
                        dimensions: primaryVehicleLine?.dimensions,
                      },
                      vehicles: flow.search.vehicles,
                      builtBody: built.body,
                    },
                    null,
                    2
                  )
              );
            }

            const priced = await fetchTransportPricing(
              pricingBody,
              pricingVehicle,
              {
                ...fetchOpts,
                debugSelectionContext: {
                  serviceCode: codigoServicioVenta,
                  serviceType: tipoServicioVenta,
                  accommodationOrServiceLabel:
                    String(service.textoCorto || service.textoLargo || "").trim() ||
                    undefined,
                },
              }
            );
            if (!priced.ok) {
              return [
                key,
                {
                  status: "error",
                  note: priced.error,
                } satisfies PricingState,
              ] as const;
            }

            const strictRoundTripPairSelected =
              flow.tripType === "round_trip" &&
              !!selectedOutbound &&
              !!selectedInbound;

            let totalForCard = priced.totalFormatted;
            let pricingNote =
              totalVehicles > 0 || flow.search.animals.count > 0
                ? "Prix recalculé sur la base du dossier courant."
                : "Prix recalculé sur la base des passagers.";
            if (fetchOpts?.returnSegment) {
              if (priced.segmentVentilationReliable === true) {
                const legEuros =
                  direction === "outbound"
                    ? priced.outboundEuros
                    : priced.returnEuros;
                if (
                  legEuros == null ||
                  !Number.isFinite(legEuros) ||
                  legEuros <= 0
                ) {
                  return [
                    key,
                    {
                      status: "error",
                      note:
                        "Tarif momentanément indisponible pour cette traversée.",
                    } satisfies PricingState,
                  ] as const;
                }
                totalForCard = `${legEuros.toFixed(2).replace(".", ",")} €`;
              } else {
                pricingNote =
                  "Prix aller-retour calculé pour l’ensemble de votre voyage.";
              }
            }

            if (
              strictRoundTripPairSelected &&
              priced.segmentVentilationReliable === true &&
              (priced.armasVtaSubtotalEuros == null ||
                priced.armasIdaSubtotalEuros == null)
            ) {
              return [
                key,
                {
                  status: "error",
                  note:
                    "Le détail aller et retour n’est pas encore disponible pour cette offre.",
                } satisfies PricingState,
              ] as const;
            }

            if (shouldLogXrClientTrace(flow)) {
              console.info(
                "[SOLAIR_XR_TRACE] client:afterFetch\n" +
                  JSON.stringify(
                    {
                      stage: "client:afterFetch",
                      pricingKey: key,
                      uiDisplayedTotalFormatted: priced.totalFormatted,
                      uiDisplayedTotalEuros: priced.totalEuros,
                      armasCodigo: priced.armasCodigo,
                      armasTexto: priced.armasTexto,
                      xrPricingTraceFromServer: priced.xrPricingTrace,
                    },
                    null,
                    2
                  )
              );
            }

            const lines = normalizeArray(
              getTarificacionRawLinesFromSoapResult(priced.soapData) as PricingLine[]
            );
            const first = lines[0];

            return [
              key,
              {
                status: "success",
                total: totalForCard,
                tarifa: first?.tarifaEntidad?.textoCorto || undefined,
                note: pricingNote,
                raw: first,
              } satisfies PricingState,
            ] as const;
          } catch (err) {
            return [
              key,
              {
                status: "error",
                note:
                  err instanceof Error
                    ? err.message
                    : "Erreur inconnue de tarification.",
              } satisfies PricingState,
            ] as const;
          }
        })
      );

      if (cancelled) return;

      setPricingMap((prev) => {
        const updated = { ...prev };
        for (const [key, value] of results) {
          updated[key] = value;
        }
        return updated;
      });
    }

    loadPricing();
    return () => {
      cancelled = true;
    };
  }, [
    flow,
    loadingDepartures,
    error,
    outboundDeparturesFiltered,
    inboundDeparturesFiltered,
    selectedOutbound,
    selectedInbound,
  ]);

  async function fetchSelectedRoundTripTotalsForChoices(
    outboundChoice: SelectedChoice,
    inboundChoice: SelectedChoice
  ): Promise<SelectedRoundTripTotalsState | null> {
    if (!flow || flow.tripType !== "round_trip") return null;

    const totalPassengers = getTotalPassengers(flow);
    if (totalPassengers <= 0) return null;

    const primaryPassengerType = getPrimaryPassengerType(flow.search.passengers);
    const tiposList = expandPassengerTipoList(flow.search.passengers);

    const outBuilt = tryBuildTarificacionPostBodyFromFlow(
      flow,
      {
        origen: flow.search.origen,
        destino: flow.search.destino,
        fechaSalida: String(outboundChoice.salida.fechaSalida || "").trim(),
        horaSalida: String(outboundChoice.salida.horaSalida || "").trim(),
      },
      {
        cantidad: totalPassengers,
        codigoServicioVenta: String(
          outboundChoice.service.codigoServicioVenta || ""
        ).trim(),
        tipoServicioVenta: String(
          outboundChoice.service.tipoServicioVenta || ""
        ).trim(),
        tipoPasajero: primaryPassengerType,
        passengerTipos: tiposList,
      },
      { serviciosVentas: getAllSalidaServiciosWithCodes(outboundChoice.salida) }
    );
    if (!outBuilt.ok) return null;

    const inBuilt = tryBuildTarificacionPostBodyFromFlow(
      flow,
      {
        origen: flow.search.destino,
        destino: flow.search.origen,
        fechaSalida: String(inboundChoice.salida.fechaSalida || "").trim(),
        horaSalida: String(inboundChoice.salida.horaSalida || "").trim(),
      },
      {
        cantidad: totalPassengers,
        codigoServicioVenta: String(
          inboundChoice.service.codigoServicioVenta || ""
        ).trim(),
        tipoServicioVenta: String(
          inboundChoice.service.tipoServicioVenta || ""
        ).trim(),
        tipoPasajero: primaryPassengerType,
        passengerTipos: tiposList,
      },
      { serviciosVentas: getAllSalidaServiciosWithCodes(inboundChoice.salida) }
    );
    if (!inBuilt.ok) return null;

    const priced = await fetchTransportPricing(
      outBuilt.body,
      outBuilt.normalizedVehicle,
      {
        requestId: `rt-selected-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 10)}`,
        tripType: "round_trip",
        armasLeg: "outbound",
        selectedOutboundSegment: {
          origen: outBuilt.body.origen,
          destino: outBuilt.body.destino,
          fechaSalida: outBuilt.body.fechaSalida,
          horaSalida: outBuilt.body.horaSalida,
          barco: String(
            outboundChoice.salida.barcoEntidad?.codigoBarco ||
              outboundChoice.salida.barcoEntidad?.textoCorto ||
              ""
          ).trim(),
          serviceCode: outBuilt.body.codigoServicioVenta,
          serviceType: outBuilt.body.tipoServicioVenta,
          segmentKey: buildDebugSegmentKey({
            origen: outBuilt.body.origen,
            destino: outBuilt.body.destino,
            fechaSalida: outBuilt.body.fechaSalida,
            horaSalida: outBuilt.body.horaSalida,
            barco: String(
              outboundChoice.salida.barcoEntidad?.codigoBarco ||
                outboundChoice.salida.barcoEntidad?.textoCorto ||
                ""
            ).trim(),
            serviceCode: outBuilt.body.codigoServicioVenta,
            serviceType: outBuilt.body.tipoServicioVenta,
          }),
        },
        selectedInboundSegment: {
          origen: inBuilt.body.origen,
          destino: inBuilt.body.destino,
          fechaSalida: inBuilt.body.fechaSalida,
          horaSalida: inBuilt.body.horaSalida,
          barco: String(
            inboundChoice.salida.barcoEntidad?.codigoBarco ||
              inboundChoice.salida.barcoEntidad?.textoCorto ||
              ""
          ).trim(),
          serviceCode: inBuilt.body.codigoServicioVenta,
          serviceType: inBuilt.body.tipoServicioVenta,
          segmentKey: buildDebugSegmentKey({
            origen: inBuilt.body.origen,
            destino: inBuilt.body.destino,
            fechaSalida: inBuilt.body.fechaSalida,
            horaSalida: inBuilt.body.horaSalida,
            barco: String(
              inboundChoice.salida.barcoEntidad?.codigoBarco ||
                inboundChoice.salida.barcoEntidad?.textoCorto ||
                ""
            ).trim(),
            serviceCode: inBuilt.body.codigoServicioVenta,
            serviceType: inBuilt.body.tipoServicioVenta,
          }),
        },
        returnSegment: {
          origen: inBuilt.body.origen,
          destino: inBuilt.body.destino,
          fechaSalida: inBuilt.body.fechaSalida,
          horaSalida: inBuilt.body.horaSalida,
          codigoServicioVenta: inBuilt.body.codigoServicioVenta,
          tipoServicioVenta: inBuilt.body.tipoServicioVenta,
          sentidoSalida: 2,
        },
        debugSelectionContext: {
          serviceCode: outBuilt.body.codigoServicioVenta,
          serviceType: outBuilt.body.tipoServicioVenta,
          accommodationOrServiceLabel: "selected_round_trip_pair",
        },
      }
    );
    if (!priced.ok) return null;

    const bundleRaw = priced.roundTripTotalEuros ?? priced.totalEuros;
    if (bundleRaw == null || !Number.isFinite(bundleRaw) || bundleRaw <= 0) {
      return null;
    }

    const lines = normalizeArray(
      getTarificacionRawLinesFromSoapResult(priced.soapData) as PricingLine[]
    );
    const first = lines[0];
    const codigoTarifa = String(first?.tarifaEntidad?.codigoTarifa || "").trim();
    const tarifaLabel = String(first?.tarifaEntidad?.textoCorto || "").trim();
    const bonificationLabel = String(
      first?.bonificacionEntidad?.textoCorto || ""
    ).trim();
    if (!codigoTarifa) {
      return null;
    }

    const segmentVentilationReliable = priced.segmentVentilationReliable === true;
    if (segmentVentilationReliable) {
      const o = priced.outboundEuros;
      const i = priced.returnEuros;
      if (
        o == null ||
        i == null ||
        !Number.isFinite(o) ||
        !Number.isFinite(i) ||
        o <= 0 ||
        i <= 0
      ) {
        return null;
      }
    }

    const outboundMatchParts = buildPricingMatchParts(
      "outbound",
      outboundChoice.salida,
      outboundChoice.service,
      flow
    );
    const inboundMatchParts = buildPricingMatchParts(
      "inbound",
      inboundChoice.salida,
      inboundChoice.service,
      flow
    );
    const outboundMatchKey = pricingPartsToKey(outboundMatchParts);
    const inboundMatchKey = pricingPartsToKey(inboundMatchParts);

    if (isArmasRtPricingDebugEnabled()) {
      const outboundRawParts = buildPricingRawParts(
        "outbound",
        outboundChoice.salida,
        outboundChoice.service,
        flow
      );
      const inboundRawParts = buildPricingRawParts(
        "inbound",
        inboundChoice.salida,
        inboundChoice.service,
        flow
      );
      console.info(
        "[SOLAIR_ARMAS_RT_PRICING_DEBUG] resultats.selectedRoundTripTotals.keys",
        JSON.stringify(
          {
            outboundMatchKey,
            inboundMatchKey,
            outboundRawParts,
            inboundRawParts,
            outboundMatchParts,
            inboundMatchParts,
          },
          null,
          0
        )
      );
    }

    return {
      outbound: segmentVentilationReliable ? priced.outboundEuros! : null,
      inbound: segmentVentilationReliable ? priced.returnEuros! : null,
      bundleTotal: bundleRaw,
      segmentVentilationReliable,
      codigoTarifa,
      tarifaLabel,
      bonificationLabel,
      outboundMatchKey,
      inboundMatchKey,
      outboundMatchParts,
      inboundMatchParts,
      rawPricingResponse: priced.soapData,
    };
  }

  useEffect(() => {
    let cancelled = false;

    async function loadSelectedRoundTripTotals() {
      if (!flow || flow.tripType !== "round_trip") {
        setSelectedRoundTripTotals(null);
        return;
      }
      if (!selectedOutbound || !selectedInbound) {
        setSelectedRoundTripTotals(null);
        return;
      }

      const requestSeq = ++selectedRoundTripRequestSeq.current;
      const totals = await fetchSelectedRoundTripTotalsForChoices(
        selectedOutbound,
        selectedInbound
      );
      if (cancelled || requestSeq !== selectedRoundTripRequestSeq.current) return;
      setSelectedRoundTripTotals(totals);
    }

    void loadSelectedRoundTripTotals();
    return () => {
      cancelled = true;
    };
  }, [flow, selectedOutbound, selectedInbound]);

  const selectedRoundTripTotalsFallback = useMemo(() => {
    if (!flow || flow.tripType !== "round_trip") return null;
    if (!selectedOutbound || !selectedInbound) return null;

    const outboundKey = getPricingKey(
      "outbound",
      selectedOutbound.salida,
      selectedOutbound.service,
      flow
    );
    const outboundState = pricingMap[outboundKey];
    const inboundKey = getPricingKey(
      "inbound",
      selectedInbound.salida,
      selectedInbound.service,
      flow
    );
    const inboundState = pricingMap[inboundKey];

    const outboundMatchParts = buildPricingMatchParts(
      "outbound",
      selectedOutbound.salida,
      selectedOutbound.service,
      flow
    );
    const inboundMatchParts = buildPricingMatchParts(
      "inbound",
      selectedInbound.salida,
      selectedInbound.service,
      flow
    );

    if (outboundState?.status === "success" && outboundState.raw) {
      const rawLine = outboundState.raw as PricingLine | undefined;
      const bundleTotal = parseSoapPriceTotal(rawLine?.precioEntidad?.total);

      if (
        bundleTotal != null &&
        Number.isFinite(bundleTotal) &&
        bundleTotal > 0
      ) {
        const idaTotal = parseSoapPriceTotal(rawLine?.precioIdaEntidad?.total);
        const vtaTotal = parseSoapPriceTotal(rawLine?.precioVtaEntidad?.total);
        const segmentVentilationReliable =
          idaTotal != null &&
          vtaTotal != null &&
          Math.abs(idaTotal + vtaTotal - bundleTotal) <= 0.03;
        const codigoTarifa = String(
          rawLine?.tarifaEntidad?.codigoTarifa || ""
        ).trim();
        if (!codigoTarifa) {
          return null;
        }

        return {
          outbound: segmentVentilationReliable ? idaTotal : null,
          inbound: segmentVentilationReliable ? vtaTotal : null,
          bundleTotal,
          segmentVentilationReliable,
          codigoTarifa,
          tarifaLabel: String(rawLine?.tarifaEntidad?.textoCorto || "").trim(),
          bonificationLabel: String(
            rawLine?.bonificacionEntidad?.textoCorto || ""
          ).trim(),
          outboundMatchKey: pricingPartsToKey(outboundMatchParts),
          inboundMatchKey: pricingPartsToKey(inboundMatchParts),
          outboundMatchParts,
          inboundMatchParts,
          rawPricingResponse: rawLine,
        } satisfies SelectedRoundTripTotalsState;
      }
    }

    const outboundEuros =
      outboundState?.status === "success"
        ? parsePricingTotalEuros(outboundState.total)
        : null;
    const inboundEuros =
      inboundState?.status === "success"
        ? parsePricingTotalEuros(inboundState.total)
        : null;

    if (
      outboundEuros == null ||
      inboundEuros == null ||
      !Number.isFinite(outboundEuros) ||
      !Number.isFinite(inboundEuros) ||
      outboundEuros <= 0 ||
      inboundEuros <= 0
    ) {
      return null;
    }

    const fallbackCodigoTarifa = String(
      (outboundState?.raw as PricingLine | undefined)?.tarifaEntidad
        ?.codigoTarifa || ""
    ).trim();
    if (!fallbackCodigoTarifa) {
      return null;
    }

    return {
      outbound: outboundEuros,
      inbound: inboundEuros,
      bundleTotal: roundEuros(outboundEuros + inboundEuros),
      segmentVentilationReliable: true,
      codigoTarifa: fallbackCodigoTarifa,
      tarifaLabel: String(
        (outboundState?.raw as PricingLine | undefined)?.tarifaEntidad
          ?.textoCorto || ""
      ).trim(),
      bonificationLabel: String(
        (outboundState?.raw as PricingLine | undefined)?.bonificacionEntidad
          ?.textoCorto || ""
      ).trim(),
      outboundMatchKey: pricingPartsToKey(outboundMatchParts),
      inboundMatchKey: pricingPartsToKey(inboundMatchParts),
      outboundMatchParts,
      inboundMatchParts,
      rawPricingResponse: {
        outboundPricingState: outboundState,
        inboundPricingState: inboundState,
      },
    } satisfies SelectedRoundTripTotalsState;
  }, [flow, pricingMap, selectedInbound, selectedOutbound]);

  const effectiveSelectedRoundTripTotals =
    selectedRoundTripTotals ?? selectedRoundTripTotalsFallback;

  const canContinue = useMemo(() => {
    if (!flow) return false;
    if (!selectedOutbound) return false;

    if (
      vehicleAddonPricingRequiredAndMissing(
        flow,
        "outbound",
        selectedOutbound.salida,
        pricingMap
      )
    ) {
      return false;
    }

    if (flow.tripType === "round_trip") {
      if (!selectedInbound) return false;
      if (!effectiveSelectedRoundTripTotals) return false;
      if (effectiveSelectedRoundTripTotals.bundleTotal <= 0) return false;
      if (effectiveSelectedRoundTripTotals.segmentVentilationReliable) {
        const o = effectiveSelectedRoundTripTotals.outbound;
        const i = effectiveSelectedRoundTripTotals.inbound;
        if (o == null || i == null || o <= 0 || i <= 0) return false;
      }
      if (
        vehicleAddonPricingRequiredAndMissing(
          flow,
          "inbound",
          selectedInbound.salida,
          pricingMap
        )
        ) {
          return false;
        }
      return true;
    }

    const obCombined = getCombinedTransportTotalString(
      flow,
      "outbound",
      selectedOutbound,
      pricingMap
    );
    const obAmount = parsePricingTotalEuros(obCombined);
    if (obAmount === null || obAmount <= 0) return false;

    return true;
  }, [
    effectiveSelectedRoundTripTotals,
    flow,
    selectedOutbound,
    selectedInbound,
    pricingMap,
  ]);

  const outboundTariffOk = useMemo(() => {
    if (!flow || !selectedOutbound) return false;
    if (flow.tripType === "round_trip") {
      return (
        !!effectiveSelectedRoundTripTotals &&
        effectiveSelectedRoundTripTotals.bundleTotal > 0
      );
    }
    if (
      vehicleAddonPricingRequiredAndMissing(
        flow,
        "outbound",
        selectedOutbound.salida,
        pricingMap
      )
    ) {
      return false;
    }
    const combined = getCombinedTransportTotalString(
      flow,
      "outbound",
      selectedOutbound,
      pricingMap
    );
    const n = parsePricingTotalEuros(combined);
    return n !== null && n > 0;
  }, [effectiveSelectedRoundTripTotals, flow, selectedOutbound, pricingMap]);

  const inboundTariffOk = useMemo(() => {
    if (!flow || !selectedInbound) return false;
    if (flow.tripType === "round_trip" && effectiveSelectedRoundTripTotals) {
      return effectiveSelectedRoundTripTotals.bundleTotal > 0;
    }
    if (
      vehicleAddonPricingRequiredAndMissing(
        flow,
        "inbound",
        selectedInbound.salida,
        pricingMap
      )
    ) {
      return false;
    }
    const combined = getCombinedTransportTotalString(
      flow,
      "inbound",
      selectedInbound,
      pricingMap
    );
    const n = parsePricingTotalEuros(combined);
    return n !== null && n > 0;
  }, [effectiveSelectedRoundTripTotals, flow, selectedInbound, pricingMap]);

  const roundTripSelectionHint = useMemo(() => {
    if (!flow || flow.tripType !== "round_trip") return "";
    if (!selectedOutbound) {
      return "Commencez par choisir votre traversée aller pour découvrir les options disponibles.";
    }
    if (!outboundTariffOk) {
      return "Le tarif de cette traversée est en cours de mise à jour. Merci de patienter un instant.";
    }
    if (!selectedInbound) {
      return "Parfait. Choisissez maintenant votre traversée retour pour finaliser votre sélection.";
    }
    if (!inboundTariffOk) {
      return "Le tarif du retour est en cours de mise à jour. Merci de patienter un instant.";
    }
    if (canContinue) {
      return "Vos traversées aller et retour sont prêtes. Vous pouvez continuer vers l’hébergement.";
    }
    return "Vérifiez votre sélection pour continuer sereinement.";
  }, [
    flow,
    selectedOutbound,
    selectedInbound,
    outboundTariffOk,
    inboundTariffOk,
    canContinue,
  ]);

  const roundTripTransportAmounts = useMemo(() => {
    if (!flow || flow.tripType !== "round_trip") return null;
    if (!selectedOutbound || !selectedInbound) return null;
    if (effectiveSelectedRoundTripTotals) {
      return {
        outbound: effectiveSelectedRoundTripTotals.outbound,
        inbound: effectiveSelectedRoundTripTotals.inbound,
        total: effectiveSelectedRoundTripTotals.bundleTotal,
        segmentVentilationReliable:
          effectiveSelectedRoundTripTotals.segmentVentilationReliable,
      };
    }
    return null;
  }, [effectiveSelectedRoundTripTotals, flow, selectedOutbound, selectedInbound]);

  function handleSelectChoice(
    direction: JourneyDirection,
    salida: Salida,
    service: ServiceVente
  ) {
    const choice: SelectedChoice = {
      direction,
      salida,
      service,
    };

    if (direction === "outbound") {
      setSelectedOutbound(choice);
      if (flow?.tripType === "round_trip") {
        if (selectedInbound) {
          const requestSeq = ++selectedRoundTripRequestSeq.current;
          void fetchSelectedRoundTripTotalsForChoices(choice, selectedInbound).then(
            (totals) => {
              if (requestSeq !== selectedRoundTripRequestSeq.current) return;
              setSelectedRoundTripTotals(totals);
            }
          );
        } else {
          setSelectedRoundTripTotals(null);
        }
      }
      return;
    }

    setSelectedInbound(choice);
    if (flow?.tripType === "round_trip") {
      if (selectedOutbound) {
        const requestSeq = ++selectedRoundTripRequestSeq.current;
        void fetchSelectedRoundTripTotalsForChoices(selectedOutbound, choice).then(
          (totals) => {
            if (requestSeq !== selectedRoundTripRequestSeq.current) return;
            setSelectedRoundTripTotals(totals);
          }
        );
      } else {
        setSelectedRoundTripTotals(null);
      }
    }
  }

  function handleContinue() {
    if (!flow || !selectedOutbound) return;
    if (flow.tripType === "round_trip" && !selectedInbound) return;

    const outboundKey = getPricingKey(
      "outbound",
      selectedOutbound.salida,
      selectedOutbound.service,
      flow
    );
    const outboundPricingState = mergeSeatAndVehiclePricingState(
      flow,
      "outbound",
      selectedOutbound,
      pricingMap[outboundKey],
      pricingMap
    );

    const inboundKey =
      flow.tripType === "round_trip" && selectedInbound
        ? getPricingKey(
            "inbound",
            selectedInbound.salida,
            selectedInbound.service,
            flow
          )
        : "";
    const inboundPricingState =
      flow.tripType === "round_trip" && selectedInbound
        ? mergeSeatAndVehiclePricingState(
            flow,
            "inbound",
            selectedInbound,
            pricingMap[inboundKey],
            pricingMap
          )
        : undefined;

    const outboundOffers = extractEligibleOffersFromSalida(
      flow,
      selectedOutbound.salida
    );
    const inboundOffers =
      flow.tripType === "round_trip" && selectedInbound
        ? extractEligibleOffersFromSalida(flow, selectedInbound.salida)
        : [];

    const outboundExplicitVeh = explicitVehicleSalidaStatus(
      flow,
      selectedOutbound.salida
    );
    const inboundExplicitVeh =
      flow.tripType === "round_trip" && selectedInbound
        ? explicitVehicleSalidaStatus(flow, selectedInbound.salida)
        : null;

    const outboundTransportVehicle =
      dossierHasVehicle(flow) && outboundExplicitVeh.status === "ok"
        ? {
            codigoServicioVenta:
              outboundExplicitVeh.service.codigoServicioVenta || "",
            tipoServicioVenta:
              outboundExplicitVeh.service.tipoServicioVenta || "",
          }
        : undefined;

    const inboundTransportVehicle =
      dossierHasVehicle(flow) &&
      inboundExplicitVeh?.status === "ok" &&
      selectedInbound
        ? {
            codigoServicioVenta:
              inboundExplicitVeh.service.codigoServicioVenta || "",
            tipoServicioVenta:
              inboundExplicitVeh.service.tipoServicioVenta || "",
          }
        : undefined;

    let transportPricingCanonical: BookingTransportPricingCanonical | undefined;
    if (flow.tripType === "round_trip" && roundTripTransportAmounts) {
      transportPricingCanonical = {
        pricingMode: roundTripTransportAmounts.segmentVentilationReliable
          ? "round_trip_per_leg"
          : "round_trip_bundle",
        totalBundleEuros: roundTripTransportAmounts.total,
        outboundEuros: roundTripTransportAmounts.segmentVentilationReliable
          ? roundTripTransportAmounts.outbound
          : null,
        inboundEuros: roundTripTransportAmounts.segmentVentilationReliable
          ? roundTripTransportAmounts.inbound
          : null,
        segmentVentilationReliable:
          roundTripTransportAmounts.segmentVentilationReliable,
      };
    } else if (flow.tripType === "one_way") {
      const n = parsePricingTotalEuros(outboundPricingState?.total);
      if (n !== null && n > 0) {
        transportPricingCanonical = {
          pricingMode: "one_way",
          totalBundleEuros: n,
          outboundEuros: n,
          inboundEuros: null,
          segmentVentilationReliable: true,
        };
      }
    }

    const nextFlow = {
      ...flow,
      outbound: {
        ...flow.outbound,
        availableServices:
          outboundOffers.length > 0 ? outboundOffers : flow.outbound.availableServices,
        selectedDeparture: mapChoiceToBookingSelectedDeparture(
          selectedOutbound,
          outboundPricingState
        ),
        transportBaseService: {
          codigoServicioVenta:
            selectedOutbound.service.codigoServicioVenta || "",
          tipoServicioVenta: selectedOutbound.service.tipoServicioVenta || "",
        },
        transportVehicleService: outboundTransportVehicle,
      },
      inbound:
        flow.tripType === "round_trip" && selectedInbound
          ? {
              ...(flow.inbound || {}),
              availableServices:
                inboundOffers.length > 0
                  ? inboundOffers
                  : flow.inbound?.availableServices,
              selectedDeparture: mapChoiceToBookingSelectedDeparture(
                selectedInbound,
                inboundPricingState
              ),
              transportBaseService: {
                codigoServicioVenta:
                  selectedInbound.service.codigoServicioVenta || "",
                tipoServicioVenta: selectedInbound.service.tipoServicioVenta || "",
              },
              transportVehicleService: inboundTransportVehicle,
            }
          : undefined,
      totals: {
        ...flow.totals,
        transportPricingCanonical,
        transportOutbound:
          flow.tripType === "round_trip" && roundTripTransportAmounts
            ? roundTripTransportAmounts.segmentVentilationReliable &&
              roundTripTransportAmounts.outbound != null
              ? formatMoney(roundTripTransportAmounts.outbound)
              : ""
            : outboundPricingState?.total || "",
        transportInbound:
          flow.tripType === "round_trip" && selectedInbound
            ? roundTripTransportAmounts
              ? roundTripTransportAmounts.segmentVentilationReliable &&
                  roundTripTransportAmounts.inbound != null
                ? formatMoney(roundTripTransportAmounts.inbound)
                : ""
              : inboundPricingState?.total || ""
            : "",
        selectedRoundTripPricing:
          flow.tripType === "round_trip" &&
          selectedInbound &&
          effectiveSelectedRoundTripTotals
            ? {
                outboundSegment: mapChoiceToBookingSelectedDeparture(
                  selectedOutbound,
                  outboundPricingState
                ),
                inboundSegment: mapChoiceToBookingSelectedDeparture(
                  selectedInbound,
                  inboundPricingState
                ),
                outboundEuros: effectiveSelectedRoundTripTotals.outbound,
                inboundEuros: effectiveSelectedRoundTripTotals.inbound,
                totalEuros: effectiveSelectedRoundTripTotals.bundleTotal,
                serviceCode:
                  String(selectedOutbound.service.codigoServicioVenta || "").trim(),
                serviceType:
                  String(selectedOutbound.service.tipoServicioVenta || "").trim(),
                codigoTarifa: effectiveSelectedRoundTripTotals.codigoTarifa,
                tarifaLabel: effectiveSelectedRoundTripTotals.tarifaLabel,
                bonificationLabel:
                  effectiveSelectedRoundTripTotals.bonificationLabel,
                rawPricingResponse: effectiveSelectedRoundTripTotals.rawPricingResponse,
              }
            : undefined,
      },
    } satisfies BookingFlow;

    const normalized = setBookingFlow(nextFlow);
    setFlowState(normalized);
    router.push("/hebergement");
  }

  function handleSelectAlternativeDate(
    direction: JourneyDirection,
    nextDate: string
  ) {
    if (!flow) return;

    const normalizedDate = normalizeSearchDate(nextDate);
    if (!normalizedDate) return;

    const currentDate =
      direction === "outbound"
        ? normalizeSearchDate(flow.search.fechaIda)
        : normalizeSearchDate(flow.search.fechaVuelta || flow.search.fechaIda);

    if (normalizedDate === currentDate) return;

    if (direction === "outbound") {
      setSelectedOutbound(null);
    } else {
      setSelectedInbound(null);
    }
    setSelectedRoundTripTotals(null);

    const nextFlow: BookingFlow = {
      ...flow,
      search: {
        ...flow.search,
        fechaIda:
          direction === "outbound" ? normalizedDate : flow.search.fechaIda,
        fechaVuelta:
          direction === "inbound"
            ? normalizedDate
            : flow.search.fechaVuelta || "",
      },
      outbound: direction === "outbound" ? {} : flow.outbound,
      inbound: direction === "inbound" ? {} : flow.inbound,
      totals: {},
    };

    const normalized = setBookingFlow(nextFlow);
    setFlowState(normalized);
  }

  const headerTitle = useMemo(() => {
    if (!flow) return "Résultats";
    if (flow.tripType === "round_trip") {
      return `${flow.search.origen} ⇄ ${flow.search.destino}`;
    }
    return `${flow.search.origen} → ${flow.search.destino}`;
  }, [flow]);

  const headerSubtitle = useMemo(() => {
    if (!flow) return "";

    const ida = formatApiDate(flow.search.fechaIda);
    const vuelta =
      flow.tripType === "round_trip" && flow.search.fechaVuelta
        ? formatApiDate(flow.search.fechaVuelta)
        : "";

    return flow.tripType === "round_trip"
      ? `Aller ${ida} • Retour ${vuelta}`
      : ida;
  }, [flow]);

  function renderDeparturesBlock(
    direction: JourneyDirection,
    departures: Salida[]
  ) {
    if (!flow) return null;

    const bookingFlow = flow;
    const sectionSearchDate =
      direction === "outbound"
        ? normalizeSearchDate(bookingFlow.search.fechaIda)
        : normalizeSearchDate(
            bookingFlow.search.fechaVuelta || bookingFlow.search.fechaIda
          );
    const sectionDateSuggestions =
      direction === "outbound"
        ? availableOutboundDateSuggestions
        : availableInboundDateSuggestions;
    const loadingDateSuggestions =
      direction === "outbound"
        ? loadingOutboundDateSuggestions
        : loadingInboundDateSuggestions;
    const sectionMinPrice = (() => {
      let min: number | null = null;

      for (const salida of departures) {
        const services = normalizeArray(
          salida.serviciosVentasEntidad?.servicioVentaEntidad
        ).filter(
          (service) =>
            service.disponibilidad !== false &&
            !!service.codigoServicioVenta &&
            !!service.tipoServicioVenta &&
            shouldRequestPricingForTransportCommercialCards(
              bookingFlow,
              salida,
              service
            )
        );

        for (const service of services) {
          const state =
            pricingMap[getPricingKey(direction, salida, service, bookingFlow)];
          if (state?.status !== "success") continue;
          const amount = eurosFromDisplay(state.total || "");
          if (amount === null || amount <= 0) continue;
          if (min === null || amount < min) {
            min = amount;
          }
        }
      }

      return min;
    })();

    return (
      <SectionCard
        title={getDirectionTitle(direction, bookingFlow)}
        subtitle={getDirectionSubtitle(direction, bookingFlow)}
      >
        <div className="mb-6 overflow-hidden rounded-[26px] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 text-slate-700">
            <span className="text-lg">⛴</span>
            <p className="text-sm font-semibold sm:text-base">
              {direction === "outbound" ? "Aller" : "Retour"} {getDirectionSubtitle(direction, bookingFlow)}
            </p>
          </div>
          <div className="grid gap-px bg-slate-200 md:grid-cols-3">
            {(sectionDateSuggestions.length > 0
              ? sectionDateSuggestions
              : [sectionSearchDate]
            ).map((date) => {
              const isSelected = date === sectionSearchDate;
              return (
                <button
                  key={`${direction}-date-${date}`}
                  type="button"
                  onClick={() => handleSelectAlternativeDate(direction, date)}
                  disabled={loadingDepartures || loadingDateSuggestions || isSelected}
                  className={`relative min-h-[8.2rem] bg-white px-5 py-5 text-center transition ${
                    isSelected
                      ? "shadow-[inset_0_-4px_0_0_#F28C28]"
                      : "hover:bg-slate-50"
                  } disabled:cursor-default`}
                >
                  <p className="text-[1.15rem] font-bold text-slate-700 sm:text-[1.35rem]">
                    {formatApiDateLongFr(date)}
                  </p>
                  <p
                    className={`mt-3 text-base font-semibold ${
                      isSelected && sectionMinPrice !== null
                        ? "text-[#D94A3A]"
                        : "text-slate-500"
                    }`}
                  >
                    {isSelected
                      ? sectionMinPrice !== null
                        ? `De ${formatMoney(sectionMinPrice)}`
                        : "Date sélectionnée"
                      : "Disponibilité confirmée"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {departures.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Aucune traversée disponible pour la date sélectionnée.
          </div>
        ) : (
          <div className="space-y-5">
            {departures.map((salida, index) => {
              const services = normalizeArray(
                salida.serviciosVentasEntidad?.servicioVentaEntidad
              ).filter(
                (service) =>
                  service.disponibilidad !== false &&
                  !!service.codigoServicioVenta &&
                  !!service.tipoServicioVenta
              );

              const compatibleServices = services.filter((service) => {
                if (
                  !shouldRequestPricingForTransportCommercialCards(
                    bookingFlow,
                    salida,
                    service
                  )
                ) {
                  return false;
                }
                const key = getPricingKey(direction, salida, service, bookingFlow);
                const state = pricingMap[key];
                return (
                  state == null ||
                  state.status === "loading" ||
                  state.status === "success" ||
                  state.status === "error" ||
                  state.status === "unsupported"
                );
              });

              const hasRequestableTransportOffer = services.some((service) =>
                shouldRequestPricingForTransportCommercialCards(
                  bookingFlow,
                  salida,
                  service
                )
              );

              const hasLoadingCompatible = compatibleServices.some((service) => {
                const key = getPricingKey(direction, salida, service, bookingFlow);
                const st = pricingMap[key];
                return st == null || st.status === "loading";
              });

              const durationSummary = formatDurationForSalida(salida);
              const boatName = String(salida.barcoEntidad?.textoCorto || "").trim();
              const boatType = String(salida.barcoEntidad?.tipoBarco || "").trim();
              const originLabel = String(
                salida.trayectoEntidad?.puertoOrigenEntidad?.textoCorto ||
                  getSalidaOrigenCode(salida) ||
                  ""
              ).trim();
              const destinationLabel = String(
                salida.trayectoEntidad?.puertoDestinoEntidad?.textoCorto ||
                  getSalidaDestinoCode(salida) ||
                  ""
              ).trim();
              const departureStatus = String(salida.estadoSalida || "").trim();
              const showStatusAlert =
                departureStatus.length > 0 &&
                departureStatus.toUpperCase() !== "A";

              return (
                <article
                  key={`${direction}-${salida.fechaSalida}-${salida.horaSalida}-${index}`}
                  className="rounded-[28px] border border-slate-200 bg-white px-4 py-4 shadow-[0_8px_18px_rgba(15,23,42,0.04)] md:px-6 md:py-5"
                >
                  <div className="pb-1 md:-mx-2 md:overflow-x-auto md:px-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                    <div className="min-w-0 md:min-w-[52rem]">
                      <div className="grid gap-4 md:gap-5">
                        <div className="grid gap-3 sm:grid-cols-2 md:flex md:items-center md:gap-8">
                          <div className="min-w-0 md:min-w-[7rem]">
                            <p className="text-[2.15rem] font-bold leading-none text-slate-900 md:text-[2.6rem]">
                              {formatApiTime(salida.horaSalida)}
                            </p>
                            <p className="mt-1 text-base uppercase text-slate-700 md:text-lg">
                              {originLabel || getSalidaOrigenCode(salida)}
                            </p>
                          </div>

                          <div className="min-w-0 text-slate-400 sm:text-right md:min-w-[10rem] md:text-center">
                            <div className="hidden items-center gap-3 md:flex">
                              <span className="h-px flex-1 bg-slate-300" />
                              <span className="text-base">◷</span>
                              <span className="h-px flex-1 bg-slate-300" />
                            </div>
                            <p className="text-sm font-medium text-slate-500 md:mt-2 md:text-[1.05rem]">
                              Durée {durationSummary}
                            </p>
                          </div>

                          <div className="min-w-0 md:min-w-[7rem]">
                            <p className="text-[2.15rem] font-bold leading-none text-slate-900 md:text-[2.6rem]">
                              {formatApiTime(salida.horaLlegada)}
                            </p>
                            <p className="mt-1 text-base uppercase text-slate-700 md:text-lg">
                              {destinationLabel || getSalidaDestinoCode(salida)}
                            </p>
                          </div>

                          <div className="min-w-0 sm:col-span-2 md:flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-600 md:gap-x-3 md:text-base">
                              {boatType ? <span>{boatType}</span> : null}
                              {boatName ? (
                                <span className="font-medium text-[#3E8DA3]">
                                  {boatName}
                                </span>
                              ) : null}
                              {showStatusAlert ? (
                                <span className="rounded-full bg-[#FBE9E7] px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-[#C9483C] ring-1 ring-[#E9B8B2]">
                                  Statut {departureStatus}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 border-t border-slate-100 pt-5">
                      {services.length === 0 && (
                        <span className="text-sm text-slate-500">
                          Aucun service passager disponible.
                        </span>
                      )}

                      {compatibleServices.length > 0 ? (
                        (() => {
                          function bestForKind(kind: CommercialOfferKind) {
                            type CardBestSource =
                              | "selected_roundtrip_reuse_exact_match"
                              | "selected_roundtrip_bundle_exact_match"
                              | "fallback_catalog_price"
                              | "neutral_round_trip_quote";

                            let best:
                              | {
                                  service: ServiceVente;
                                  total: string;
                                  source: CardBestSource;
                                  matchedPricingKey?: string;
                                }
                              | null = null;

                            const pairReady =
                              bookingFlow.tripType === "round_trip" &&
                              !!selectedOutbound &&
                              !!selectedInbound &&
                              !!effectiveSelectedRoundTripTotals;

                            for (const service of compatibleServices) {
                              const commercialKind = getCommercialKind(service);
                              const isKindMatch =
                                commercialKind === kind ||
                                (kind === "seat" &&
                                  commercialKind === "unknown" &&
                                  isPrimaryServiceEligibleForVehicleCompanionPricing(
                                    service
                                  ));
                              if (!isKindMatch) continue;
                              const key = getPricingKey(
                                direction,
                                salida,
                                service,
                                bookingFlow
                              );
                              const cardMatchParts = buildPricingMatchParts(
                                direction,
                                salida,
                                service,
                                bookingFlow
                              );
                              const cardRawParts = buildPricingRawParts(
                                direction,
                                salida,
                                service,
                                bookingFlow
                              );
                              const st = pricingMap[key];
                              const expectedParts =
                                bookingFlow.tripType === "round_trip" &&
                                effectiveSelectedRoundTripTotals
                                  ? direction === "outbound"
                                    ? effectiveSelectedRoundTripTotals.outboundMatchParts
                                    : effectiveSelectedRoundTripTotals.inboundMatchParts
                                  : null;
                              const expectedKey = expectedParts
                                ? pricingPartsToKey(expectedParts)
                                : null;
                              const partsMatch =
                                expectedParts &&
                                isRobustPricingPartsMatch(expectedParts, cardMatchParts);
                              const realSegmentEuros =
                                bookingFlow.tripType === "round_trip" &&
                                effectiveSelectedRoundTripTotals &&
                                partsMatch
                                  ? direction === "outbound"
                                    ? effectiveSelectedRoundTripTotals.outbound
                                    : effectiveSelectedRoundTripTotals.inbound
                                  : null;
                              const roundTripBundleEuros =
                                bookingFlow.tripType === "round_trip" &&
                                effectiveSelectedRoundTripTotals &&
                                partsMatch &&
                                effectiveSelectedRoundTripTotals.bundleTotal > 0
                                  ? effectiveSelectedRoundTripTotals.bundleTotal
                                  : null;
                              const hasRealSegment =
                                typeof realSegmentEuros === "number" &&
                                Number.isFinite(realSegmentEuros) &&
                                realSegmentEuros > 0;

                              if (isArmasRtPricingDebugEnabled()) {
                                console.info(
                                  "[SOLAIR_ARMAS_RT_PRICING_DEBUG] resultats.cardMatchAudit",
                                  JSON.stringify(
                                    {
                                      segment: direction,
                                      expectedKey,
                                      cardPricingKey: key,
                                      matched: !!partsMatch,
                                      diffFields:
                                        expectedParts && cardMatchParts
                                          ? diffPricingParts(
                                              expectedParts,
                                              cardMatchParts
                                            )
                                          : [],
                                      expectedParts,
                                      expectedRawParts:
                                        direction === "outbound"
                                          ? buildPricingRawParts(
                                              "outbound",
                                              selectedOutbound?.salida || salida,
                                              selectedOutbound?.service || service,
                                              bookingFlow
                                            )
                                          : buildPricingRawParts(
                                              "inbound",
                                              selectedInbound?.salida || salida,
                                              selectedInbound?.service || service,
                                              bookingFlow
                                            ),
                                      cardRawParts,
                                      cardParts: cardMatchParts,
                                    },
                                    null,
                                    0
                                  )
                                );
                              }

                              if (bookingFlow.tripType === "round_trip") {
                                if (!pairReady) {
                                  if (!best) {
                                    best = {
                                      service,
                                      total: ROUND_TRIP_CARD_NEUTRAL_PRICE_LABEL,
                                      source: "neutral_round_trip_quote",
                                    };
                                  }
                                  continue;
                                }
                                if (hasRealSegment) {
                                  const displayTotal = formatMoney(realSegmentEuros);
                                  const n = realSegmentEuros;
                                  if (
                                    !best ||
                                    best.source === "neutral_round_trip_quote"
                                  ) {
                                    best = {
                                      service,
                                      total: displayTotal,
                                      source: "selected_roundtrip_reuse_exact_match",
                                      matchedPricingKey: key,
                                    };
                                  } else if (
                                    best.source ===
                                    "selected_roundtrip_reuse_exact_match"
                                  ) {
                                    const current = eurosFromDisplay(best.total);
                                    if (current === null || n < current) {
                                      best = {
                                        service,
                                        total: displayTotal,
                                        source: "selected_roundtrip_reuse_exact_match",
                                        matchedPricingKey: key,
                                      };
                                    }
                                  }
                                  continue;
                                }
                                if (
                                  roundTripBundleEuros != null &&
                                  Number.isFinite(roundTripBundleEuros) &&
                                  roundTripBundleEuros > 0
                                ) {
                                  best = {
                                    service,
                                    total: formatMoney(roundTripBundleEuros),
                                    source: "selected_roundtrip_bundle_exact_match",
                                    matchedPricingKey: key,
                                  };
                                  continue;
                                }
                                if (
                                  !best ||
                                  best.source === "neutral_round_trip_quote"
                                ) {
                                  if (!best) {
                                    best = {
                                      service,
                                      total: ROUND_TRIP_CARD_NEUTRAL_PRICE_LABEL,
                                      source: "neutral_round_trip_quote",
                                    };
                                  }
                                }
                                continue;
                              }

                              if (st?.status !== "success") continue;
                              const displayTotal = st?.total || "";
                              const n = eurosFromDisplay(displayTotal);
                              if (n === null || n <= 0) continue;
                              if (!best) {
                                best = {
                                  service,
                                  total: displayTotal,
                                  source: "fallback_catalog_price",
                                };
                                continue;
                              }
                              const current = eurosFromDisplay(best.total);
                              if (current === null || n < current) {
                                best = {
                                  service,
                                  total: displayTotal,
                                  source: "fallback_catalog_price",
                                };
                              }
                            }
                            return best;
                          }

                          const bestSeat = bestForKind("seat");
                          const bestCabin = bestForKind("cabin");

                          const seatSelected = bestSeat
                            ? isSameChoice(
                                direction === "outbound"
                                  ? selectedOutbound
                                  : selectedInbound,
                                direction,
                                salida,
                                bestSeat.service
                              )
                            : false;
                          const cabinSelected = bestCabin
                            ? isSameChoice(
                                direction === "outbound"
                                  ? selectedOutbound
                                  : selectedInbound,
                                direction,
                                salida,
                                bestCabin.service
                              )
                            : false;

                          const duration = formatDurationForSalida(salida);

                          if (isArmasRtPricingDebugEnabled()) {
                            const boatCode = String(
                              salida.barcoEntidad?.codigoBarco || ""
                            ).trim();
                            const boatName = String(
                              salida.barcoEntidad?.textoCorto || ""
                            ).trim();
                            if (bestSeat) {
                              console.info(
                                "[SOLAIR_ARMAS_RT_PRICING_DEBUG] resultats.cardPrice",
                                JSON.stringify(
                                  {
                                    segment: direction,
                                    fechaSalida: salida.fechaSalida || "",
                                    horaSalida: salida.horaSalida || "",
                                    horaLlegada: salida.horaLlegada || "",
                                    barco: boatName || null,
                                    barcoCodigo: boatCode || null,
                                    cardKind: "seat",
                                    cardPricingKey: getPricingKey(direction, salida, bestSeat.service, bookingFlow),
                                    priceSource: bestSeat.source,
                                    displayedAmount: bestSeat.total,
                                    matchedArmasOfferKey:
                                      bestSeat.matchedPricingKey || null,
                                  },
                                  null,
                                  0
                                )
                              );
                            }
                            if (bestCabin) {
                              console.info(
                                "[SOLAIR_ARMAS_RT_PRICING_DEBUG] resultats.cardPrice",
                                JSON.stringify(
                                  {
                                    segment: direction,
                                    fechaSalida: salida.fechaSalida || "",
                                    horaSalida: salida.horaSalida || "",
                                    horaLlegada: salida.horaLlegada || "",
                                    barco: boatName || null,
                                    barcoCodigo: boatCode || null,
                                    cardKind: "cabin",
                                    cardPricingKey: getPricingKey(direction, salida, bestCabin.service, bookingFlow),
                                    priceSource: bestCabin.source,
                                    displayedAmount: bestCabin.total,
                                    matchedArmasOfferKey:
                                      bestCabin.matchedPricingKey || null,
                                  },
                                  null,
                                  0
                                )
                              );
                            }
                          }

                          const categoryCards: ReactNode[] = [];

                          if (bestSeat) {
                            categoryCards.push(
                              <button
                                key="seat"
                                type="button"
                                onClick={() =>
                                  handleSelectChoice(direction, salida, bestSeat.service)
                                }
                                className={`rounded-[22px] border px-4 py-4 text-left text-white shadow-[0_14px_30px_rgba(16,45,84,0.18)] transition hover:-translate-y-px md:rounded-[26px] md:px-6 md:py-5 ${
                                  seatSelected
                                    ? "border-[#F7C948] bg-[#163B6D] ring-2 ring-[#F7C948]"
                                    : "border-[#163B6D] bg-[#163B6D] hover:bg-[#1B447A]"
                                }`}
                              >
                                <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_18rem] md:items-center md:gap-6">
                                  <div className="min-w-0">
                                    <p className="text-[1.05rem] font-bold leading-none text-white md:text-[1.35rem]">
                                      Fauteuil
                                    </p>
                                  </div>

                                  <div className="text-[0.9rem] leading-relaxed text-white/85 md:text-sm">
                                    <p>
                                      {bestSeat.source ===
                                      "selected_roundtrip_reuse_exact_match"
                                        ? "Tarif confirmé pour votre dossier."
                                        : bestSeat.source ===
                                            "selected_roundtrip_bundle_exact_match"
                                          ? "Tarif aller-retour confirmé pour ce voyage."
                                          : bestSeat.source ===
                                              "neutral_round_trip_quote"
                                            ? ROUND_TRIP_CARD_NEUTRAL_PRICE_LABEL
                                            : `Tarif disponible pour cette traversée • ${duration}`}
                                    </p>
                                  </div>

                                  <div className="flex justify-start md:justify-end">
                                    <span className="inline-flex min-h-[2.9rem] shrink-0 items-center justify-center rounded-[12px] bg-[#FFC928] px-4 text-[0.72rem] font-extrabold uppercase tracking-[0.05em] text-[#163B6D] shadow-[0_10px_24px_rgba(255,201,40,0.26)] md:min-h-[3.65rem] md:rounded-[14px] md:px-5 md:text-sm">
                                      {seatSelected ? "Sélectionné" : "Sélectionner"}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          if (bestCabin) {
                            categoryCards.push(
                              <button
                                key="cabin"
                                type="button"
                                onClick={() =>
                                  handleSelectChoice(direction, salida, bestCabin.service)
                                }
                                className={`rounded-[22px] border px-4 py-4 text-left text-white shadow-[0_14px_30px_rgba(16,45,84,0.18)] transition hover:-translate-y-px md:rounded-[26px] md:px-6 md:py-5 ${
                                  cabinSelected
                                    ? "border-[#F7C948] bg-[#163B6D] ring-2 ring-[#F7C948]"
                                    : "border-[#163B6D] bg-[#163B6D] hover:bg-[#1B447A]"
                                }`}
                              >
                                <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_18rem] md:items-center md:gap-6">
                                  <div className="min-w-0">
                                    <p className="text-[1.05rem] font-bold leading-none text-white md:text-[1.35rem]">
                                      Cabine
                                    </p>
                                  </div>

                                  <div className="text-[0.9rem] leading-relaxed text-white/85 md:text-sm">
                                    <p>
                                      {bestCabin.source ===
                                      "selected_roundtrip_reuse_exact_match"
                                        ? "Tarif confirmé pour votre dossier."
                                        : bestCabin.source ===
                                            "selected_roundtrip_bundle_exact_match"
                                          ? "Tarif aller-retour confirmé pour ce voyage."
                                          : bestCabin.source ===
                                              "neutral_round_trip_quote"
                                            ? ROUND_TRIP_CARD_NEUTRAL_PRICE_LABEL
                                            : `Tarif disponible pour cette traversée • ${duration}`}
                                    </p>
                                  </div>

                                  <div className="flex justify-start md:justify-end">
                                    <span className="inline-flex min-h-[2.9rem] shrink-0 items-center justify-center rounded-[12px] bg-[#FFC928] px-4 text-[0.72rem] font-extrabold uppercase tracking-[0.05em] text-[#163B6D] shadow-[0_10px_24px_rgba(255,201,40,0.26)] md:min-h-[3.65rem] md:rounded-[14px] md:px-5 md:text-sm">
                                      {cabinSelected ? "Sélectionné" : "Sélectionner"}
                                    </span>
                                  </div>
                                </div>
                              </button>
                            );
                          }

                          if (categoryCards.length === 0) {
                            if (hasLoadingCompatible) {
                              return (
                                <span className="text-sm text-slate-500">
                                  Tarification en cours pour cette traversée.
                                </span>
                              );
                            }
                            const states = compatibleServices.map((s) =>
                              pricingMap[
                                getPricingKey(direction, salida, s, bookingFlow)
                              ]
                            );
                            const allError =
                              states.length > 0 &&
                              states.every((st) => st?.status === "error");
                            const allUnsupported =
                              states.length > 0 &&
                              states.every((st) => st?.status === "unsupported");
                            const firstErrorNote = states.find(
                              (st) => st?.status === "error" && st.note?.trim()
                            )?.note;
                            const firstUnsupportedNote = states.find(
                              (st) =>
                                st?.status === "unsupported" && st.note?.trim()
                            )?.note;
                            if (allUnsupported && firstUnsupportedNote) {
                              return (
                                <span className="text-sm text-slate-600">
                                  {firstUnsupportedNote}
                                </span>
                              );
                            }
                            if (allError && firstErrorNote) {
                              return (
                                <span className="text-sm text-amber-900">
                                  Tarification indisponible : {firstErrorNote}
                                </span>
                              );
                            }
                            return (
                              <span className="text-sm text-slate-600">
                                Traversée disponible, mais aucun montant valide pour
                                fauteuil ou cabine n’a pu être calculé.
                              </span>
                            );
                          }

                          return (
                            <div className="grid gap-3">
                              {categoryCards}
                            </div>
                          );
                        })()
                      ) : services.length > 0 ? (
                        hasRequestableTransportOffer ? (
                          <span className="text-sm text-slate-600">
                            Traversée disponible, mais la tarification automatique n’a
                            pas encore pu démarrer pour cette date.
                          </span>
                        ) : (
                          <span className="text-sm text-slate-600">
                            Traversée disponible, mais aucune offre siège / cabine de
                            cette liste ne correspond à votre dossier (véhicule,
                            animaux, type de place).
                          </span>
                        )
                      ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </SectionCard>
    );
  }

  if (loadingFlow) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            Chargement du dossier de réservation...
          </div>
        </section>
      </main>
    );
  }

  if (!flow || !hasUsableSearch(flow)) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
            Impossible de charger correctement le dossier de recherche.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_10%_16%,rgb(44_166_164/0.24),transparent_17rem),radial-gradient(circle_at_88%_8%,rgb(242_140_40/0.3),transparent_18rem),radial-gradient(circle_at_78%_0%,rgb(217_74_58/0.2),transparent_14rem),linear-gradient(135deg,#102D54_0%,#163B6D_56%,#235392_100%)] pb-8 pt-5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-5 flex gap-2.5 overflow-x-auto pb-[0.35rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              1. Recherche
            </span>
            <span className="flex-none rounded-full bg-[linear-gradient(135deg,#F28C28,#F7A744)] px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white shadow-[0_12px_28px_rgba(242,140,40,0.34)]">
              2. Traversées et prix
            </span>
            <span className="flex-none rounded-full border border-white/15 bg-white/12 px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white/95">
              3. Hébergement
            </span>
            <span className="flex-none rounded-full border border-white/15 bg-white/12 px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white/95">
              4. Passager
            </span>
            <span className="flex-none rounded-full border border-white/15 bg-white/12 px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white/95">
              5. Récapitulatif
            </span>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
                Solair Voyages
              </p>
              <h1 className="mt-2 text-3xl font-bold text-white">
                {headerTitle}
              </h1>
              <p className="mt-2 text-sm text-white/85">{headerSubtitle}</p>
            </div>

            <button
              type="button"
              onClick={() => router.push("/")}
              className="inline-flex justify-center rounded-2xl border border-white/25 bg-white/12 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-px hover:bg-white/18"
            >
              Nouvelle recherche
            </button>
          </div>
        </div>
      </section>

      <section
        className={
          flow.tripType === "round_trip" ? "-mt-4 pb-32 lg:pb-10" : "-mt-4 pb-10"
        }
      >
        <div className="mx-auto max-w-7xl px-4">
          {flow.tripType === "round_trip" ? (
            <>
              <div className="mb-6">
                <SectionCard
                  title="Votre recherche"
                  subtitle="Retrouvez ici les détails de votre voyage."
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Passagers
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getPassengerSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Animaux
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getAnimalsSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Véhicules
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getVehiclesSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Réduction
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {discountLabel(
                          flow.search.bonificacion,
                          flow.search.bonificacionLabel
                        )}
                      </p>
                    </div>
                  </div>
                </SectionCard>
              </div>

              {loadingDepartures && (
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  Chargement des traversées...
                </div>
              )}

              {!loadingDepartures && error && (
                <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
                  {error}
                </div>
              )}

              {!loadingDepartures && !error && (
                <>
                  <div className="sticky top-2 z-30 mb-5 hidden rounded-[24px] border border-slate-200 bg-white/95 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.12)] backdrop-blur-md lg:block">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#163B6D]">
                      Votre sélection aller-retour
                    </p>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div
                        className={`rounded-2xl p-4 ring-1 ${
                          outboundTariffOk
                            ? "bg-[#F4FAFF] ring-[#CDE4F7]"
                            : selectedOutbound
                              ? "bg-amber-50 ring-amber-200"
                              : "bg-slate-50 ring-slate-200"
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Aller sélectionné
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {!selectedOutbound
                            ? "Non"
                            : outboundTariffOk
                              ? "Oui, tarif confirmé"
                              : "Sélectionné — confirmation du tarif en cours"}
                        </p>
                        {selectedOutbound ? (
                          <p className="mt-2 text-xs text-slate-600">
                            {formatApiDate(selectedOutbound.salida.fechaSalida)} •{" "}
                            {formatApiTime(selectedOutbound.salida.horaSalida)} •{" "}
                            {serviceLabel(selectedOutbound.service)}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            Sélectionnez l’aller qui vous convient.
                          </p>
                        )}
                      </div>
                      <div
                        className={`rounded-2xl p-4 ring-1 ${
                          inboundTariffOk
                            ? "bg-[#FFF7EE] ring-[#F5D1A3]"
                            : selectedInbound
                              ? "bg-amber-50 ring-amber-200"
                              : "bg-slate-50 ring-slate-200"
                        }`}
                      >
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Retour sélectionné
                        </p>
                        <p className="mt-1 text-sm font-bold text-slate-900">
                          {!selectedInbound
                            ? "Non"
                            : inboundTariffOk
                              ? "Oui, tarif confirmé"
                              : "Sélectionné — confirmation du tarif en cours"}
                        </p>
                        {selectedInbound ? (
                          <p className="mt-2 text-xs text-slate-600">
                            {formatApiDate(selectedInbound.salida.fechaSalida)} •{" "}
                            {formatApiTime(selectedInbound.salida.horaSalida)} •{" "}
                            {serviceLabel(selectedInbound.service)}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            Sélectionnez ensuite le retour qui vous convient.
                          </p>
                        )}
                      </div>
                    </div>
                    <p className="mt-4 text-sm font-medium text-slate-800">
                      {roundTripSelectionHint}
                    </p>
                    {roundTripTransportAmounts ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Transport sélectionné
                        </p>
                        <div className="mt-2 space-y-1">
                          {roundTripTransportAmounts.segmentVentilationReliable &&
                          roundTripTransportAmounts.outbound != null &&
                          roundTripTransportAmounts.inbound != null ? (
                            <>
                              <div className="flex justify-between gap-3">
                                <span>Aller</span>
                                <span className="font-semibold text-slate-900">
                                  {formatMoney(roundTripTransportAmounts.outbound)}
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span>Retour</span>
                                <span className="font-semibold text-slate-900">
                                  {formatMoney(roundTripTransportAmounts.inbound)}
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="flex justify-between gap-3 font-bold text-slate-900">
                              <span>Total aller-retour</span>
                              <span>{formatMoney(roundTripTransportAmounts.total)}</span>
                            </div>
                          )}
                          {roundTripTransportAmounts.segmentVentilationReliable &&
                          roundTripTransportAmounts.outbound != null &&
                          roundTripTransportAmounts.inbound != null ? (
                            <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold text-slate-900">
                              <span>Total</span>
                              <span>{formatMoney(roundTripTransportAmounts.total)}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {!canContinue ? (
                      <p className="mt-2 text-xs text-amber-900">
                        Le bouton s’active dès que vos traversées aller et retour
                        sont confirmées.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className="mt-4 w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Continuer vers l’hébergement
                    </button>
                  </div>

                  <div className="mb-4 rounded-[20px] border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm lg:hidden">
                    <p className="text-xs font-bold uppercase tracking-wide text-[#163B6D]">
                      Votre sélection
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="font-semibold text-slate-600">
                          Aller :{" "}
                        </span>
                        <span className="text-slate-900">
                          {!selectedOutbound
                            ? "non"
                            : outboundTariffOk
                              ? "oui"
                              : "en cours"}
                        </span>
                      </div>
                      <div>
                        <span className="font-semibold text-slate-600">
                          Retour :{" "}
                        </span>
                        <span className="text-slate-900">
                          {!selectedInbound
                            ? "non"
                            : inboundTariffOk
                              ? "oui"
                              : "en cours"}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-700">
                      {roundTripSelectionHint}
                    </p>
                  </div>

                  <div className="space-y-10">
                    <div className="min-w-0">
                      <div className="mb-3 hidden items-center gap-3 lg:flex">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#163B6D] text-sm font-bold text-white">
                          1
                        </span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-[#163B6D]">
                            Aller
                          </p>
                          <p className="text-sm text-slate-600">
                            {getDirectionSubtitle("outbound", flow)}
                          </p>
                        </div>
                      </div>
                      <RoundTripMobileStepHeading
                        step={1}
                        label="Choisissez l’aller"
                      />
                      {renderDeparturesBlock(
                        "outbound",
                        outboundDeparturesFiltered
                      )}
                    </div>
                    <div className="min-w-0 border-t border-slate-200 pt-8">
                      <div className="mb-3 hidden items-center gap-3 lg:flex">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F28C28] text-sm font-bold text-white">
                          2
                        </span>
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-[#F28C28]">
                            Retour
                          </p>
                          <p className="text-sm text-slate-600">
                            {getDirectionSubtitle("inbound", flow)}
                          </p>
                        </div>
                      </div>
                      <RoundTripMobileStepHeading
                        step={2}
                        label="Choisissez le retour"
                      />
                      {renderDeparturesBlock(
                        "inbound",
                        inboundDeparturesFiltered
                      )}
                    </div>
                  </div>

                  <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_24px_rgba(15,23,42,0.12)] backdrop-blur-md lg:hidden">
                    {roundTripTransportAmounts ? (
                      <p className="mb-2 text-center text-[11px] font-semibold text-slate-800">
                        {roundTripTransportAmounts.segmentVentilationReliable &&
                        roundTripTransportAmounts.outbound != null &&
                        roundTripTransportAmounts.inbound != null ? (
                          <>
                            Aller {formatMoney(roundTripTransportAmounts.outbound)} ·
                            Retour {formatMoney(roundTripTransportAmounts.inbound)} ·
                            Total {formatMoney(roundTripTransportAmounts.total)}
                          </>
                        ) : (
                          <>Total aller-retour {formatMoney(roundTripTransportAmounts.total)}</>
                        )}
                      </p>
                    ) : null}
                    <p className="mb-2 line-clamp-2 text-center text-[11px] leading-snug text-slate-700">
                      {roundTripSelectionHint}
                    </p>
                    {!canContinue ? (
                      <p className="mb-2 text-center text-[10px] text-amber-900">
                        Le bouton s’active dès que vos traversées sont prêtes.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className="w-full rounded-[20px] bg-[#F28C28] px-4 py-3.5 text-sm font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Continuer vers l’hébergement
                    </button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_1fr]">
                <SectionCard
                  title="Votre recherche"
                  subtitle="Retrouvez ici les détails de votre voyage."
                >
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Passagers
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getPassengerSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Animaux
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getAnimalsSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Véhicules
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {getVehiclesSummary(flow)}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Réduction
                      </p>
                      <p className="mt-2 text-sm font-semibold text-slate-900">
                        {discountLabel(
                          flow.search.bonificacion,
                          flow.search.bonificacionLabel
                        )}
                      </p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Sélection du transport"
                  subtitle="Choisissez votre traversée puis continuez."
                >
                  <div className="space-y-4">
                    {selectedOutbound && (
                      <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                        <p className="text-sm font-semibold text-[#1F2F46]">
                          Traversée sélectionnée
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatApiDate(selectedOutbound.salida.fechaSalida)} •{" "}
                          {formatApiTime(selectedOutbound.salida.horaSalida)} •{" "}
                          {serviceLabel(selectedOutbound.service)}
                        </p>
                      </div>
                    )}

                    <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                      <p className="text-sm font-semibold text-[#1F2F46]">
                        Étape suivante
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Après validation du transport, vous pourrez affiner le
                        service (hébergement / confort).
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Continuer vers l’hébergement
                    </button>
                    {!canContinue ? (
                      <p className="text-center text-xs text-slate-500">
                        Choisissez une offre tarifée ci-dessous pour activer le
                        bouton.
                      </p>
                    ) : null}
                  </div>
                </SectionCard>
              </div>

              {loadingDepartures && (
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
                  Chargement des traversées...
                </div>
              )}

              {!loadingDepartures && error && (
                <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
                  {error}
                </div>
              )}

              {!loadingDepartures && !error && (
                <div className="space-y-6">
                  {renderDeparturesBlock(
                    "outbound",
                    outboundDeparturesFiltered
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

export default function ResultatsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Chargement des résultats…
        </main>
      }
    >
      <ResultatsPageContent />
    </Suspense>
  );
}
