"use client";

import {
  Suspense,
  useEffect,
  useMemo,
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
  getCommercialCTA,
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

type PricingLine = {
  precioEntidad?: {
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

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
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

function discountLabel(code: string) {
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

function getPricingKey(
  direction: JourneyDirection,
  salida: Salida,
  service: ServiceVente,
  flow: BookingFlow
) {
  return [
    direction,
    salida.fechaSalida || "",
    salida.horaSalida || "",
    pricingSalidaInstanceSegment(salida),
    service.codigoServicioVenta || "",
    service.tipoServicioVenta || "",
    pricingMapVehicleSegment(flow),
  ].join("|");
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
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:p-6">
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

  const [selectedOutbound, setSelectedOutbound] = useState<SelectedChoice | null>(
    null
  );
  const [selectedInbound, setSelectedInbound] = useState<SelectedChoice | null>(
    null
  );

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
            const tiposList = expandPassengerTipoList(flow.search.passengers);
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
              built.body,
              built.normalizedVehicle,
              flow.tripType === "round_trip"
                ? {
                    tripType: "round_trip",
                    armasLeg:
                      direction === "outbound" ? "outbound" : "inbound",
                  }
                : undefined
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
                total: priced.totalFormatted,
                tarifa: first?.tarifaEntidad?.textoCorto || undefined,
                note:
                  totalVehicles > 0 || flow.search.animals.count > 0
                    ? "Prix recalculé sur la base du dossier courant."
                    : "Prix recalculé sur la base des passagers.",
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
  ]);

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

    const obCombined = getCombinedTransportTotalString(
      flow,
      "outbound",
      selectedOutbound,
      pricingMap
    );
    const obAmount = parsePricingTotalEuros(obCombined);
    if (obAmount === null || obAmount <= 0) return false;

    if (flow.tripType === "round_trip") {
      if (!selectedInbound) return false;
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
      const inCombined = getCombinedTransportTotalString(
        flow,
        "inbound",
        selectedInbound,
        pricingMap
      );
      const inAmount = parsePricingTotalEuros(inCombined);
      if (inAmount === null || inAmount <= 0) return false;
    }

    return true;
  }, [flow, selectedOutbound, selectedInbound, pricingMap]);

  const outboundTariffOk = useMemo(() => {
    if (!flow || !selectedOutbound) return false;
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
  }, [flow, selectedOutbound, pricingMap]);

  const inboundTariffOk = useMemo(() => {
    if (!flow || !selectedInbound) return false;
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
  }, [flow, selectedInbound, pricingMap]);

  const roundTripSelectionHint = useMemo(() => {
    if (!flow || flow.tripType !== "round_trip") return "";
    if (!selectedOutbound) {
      return "Commencez par choisir votre traversée aller (colonne de gauche sur ordinateur, ou première section sur mobile).";
    }
    if (!outboundTariffOk) {
      return "Le tarif aller est encore en cours de calcul ou n’est pas disponible pour l’option choisie.";
    }
    if (!selectedInbound) {
      return "Choisissez maintenant votre retour pour continuer.";
    }
    if (!inboundTariffOk) {
      return "Le tarif retour est encore en cours de calcul ou n’est pas disponible pour l’option choisie.";
    }
    if (canContinue) {
      return "Aller et retour sont sélectionnés et tarifés — vous pouvez continuer vers l’hébergement.";
    }
    return "Vérifiez vos sélections avant de continuer.";
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
    const obStr = getCombinedTransportTotalString(
      flow,
      "outbound",
      selectedOutbound,
      pricingMap
    );
    const ibStr = getCombinedTransportTotalString(
      flow,
      "inbound",
      selectedInbound,
      pricingMap
    );
    const ob = parsePricingTotalEuros(obStr);
    const ib = parsePricingTotalEuros(ibStr);
    if (ob === null || ib === null) return null;
    return { outbound: ob, inbound: ib, total: ob + ib };
  }, [flow, selectedOutbound, selectedInbound, pricingMap]);

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
      return;
    }

    setSelectedInbound(choice);
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
        transportOutbound: outboundPricingState?.total || "",
        transportInbound:
          flow.tripType === "round_trip" && selectedInbound
            ? inboundPricingState?.total || ""
            : "",
      },
    } satisfies BookingFlow;

    const normalized = setBookingFlow(nextFlow);
    setFlowState(normalized);
    router.push("/hebergement");
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

    return (
      <SectionCard
        title={getDirectionTitle(direction, bookingFlow)}
        subtitle={getDirectionSubtitle(direction, bookingFlow)}
      >
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
                  state.status === "error"
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

              return (
                <article
                  key={`${direction}-${salida.fechaSalida}-${salida.horaSalida}-${index}`}
                  className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_8px_18px_rgba(15,23,42,0.04)]"
                >
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Départ
                      </p>
                      <p className="mt-2 text-xl font-bold text-slate-900">
                        {formatApiTime(salida.horaSalida)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatApiDate(salida.fechaSalida)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Arrivée
                      </p>
                      <p className="mt-2 text-xl font-bold text-slate-900">
                        {formatApiTime(salida.horaLlegada)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatApiDate(salida.fechaLlegada)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Bateau
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {salida.barcoEntidad?.textoCorto || "-"}
                      </p>
                      <p className="text-sm text-slate-600">
                        {salida.barcoEntidad?.tipoBarco || ""}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Statut
                      </p>
                      <p className="mt-2 text-lg font-bold text-[#C9483C]">
                        {salida.estadoSalida || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <p className="text-base font-bold text-slate-900">
                      Offres disponibles
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      Prix transport calculé sur la base du dossier courant.
                    </p>

                    <div className="mt-4 grid gap-3">
                      {services.length === 0 && (
                        <span className="text-sm text-slate-500">
                          Aucun service passager disponible.
                        </span>
                      )}

                      {compatibleServices.length > 0 ? (
                        (() => {
                          function bestForKind(kind: CommercialOfferKind) {
                            let best:
                              | { service: ServiceVente; total: string }
                              | null = null;

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
                              const st = pricingMap[key];
                              if (st?.status !== "success") continue;
                              const displayTotal = st.total || "";
                              const n = eurosFromDisplay(displayTotal);
                              if (n === null || n <= 0) continue;
                              if (!best) {
                                best = { service, total: displayTotal };
                                continue;
                              }
                              const current = eurosFromDisplay(best.total);
                              if (current === null || n < current) {
                                best = { service, total: displayTotal };
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

                          const duration = formatDurationFromTimes(
                            salida.horaSalida,
                            salida.horaLlegada
                          );

                          const categoryCards: ReactNode[] = [];

                          if (bestSeat) {
                            categoryCards.push(
                              <button
                                key="seat"
                                type="button"
                                onClick={() =>
                                  handleSelectChoice(direction, salida, bestSeat.service)
                                }
                                className={`rounded-[24px] border p-5 text-left transition ${
                                  seatSelected
                                    ? "border-[#163B6D] bg-[#163B6D] text-white"
                                    : "border-slate-300 bg-white hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="text-xs font-bold uppercase tracking-wide opacity-80">
                                      {getCommercialCTA("seat")}
                                    </p>
                                    <p className="mt-2 text-lg font-bold">Fauteuil</p>
                                    <p
                                      className={`mt-1 text-sm ${
                                        seatSelected ? "text-white/80" : "text-slate-600"
                                      }`}
                                    >
                                      Départ {formatApiTime(salida.horaSalida)} · Arrivée{" "}
                                      {formatApiTime(salida.horaLlegada)} · Durée{" "}
                                      {duration}
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">
                                      À partir de
                                    </p>
                                    <p className="mt-1 text-2xl font-extrabold">
                                      {bestSeat.total}
                                    </p>
                                  </div>
                                </div>
                                <p
                                  className={`mt-3 text-xs ${
                                    seatSelected ? "text-white/80" : "text-slate-500"
                                  }`}
                                >
                                  {serviceLabel(bestSeat.service)}
                                </p>
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
                                className={`rounded-[24px] border p-5 text-left transition ${
                                  cabinSelected
                                    ? "border-[#F28C28] bg-[#F28C28] text-white"
                                    : "border-slate-300 bg-white hover:bg-slate-50"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-4">
                                  <div>
                                    <p className="text-xs font-bold uppercase tracking-wide opacity-80">
                                      {getCommercialCTA("cabin")}
                                    </p>
                                    <p className="mt-2 text-lg font-bold">Cabine</p>
                                    <p
                                      className={`mt-1 text-sm ${
                                        cabinSelected ? "text-white/80" : "text-slate-600"
                                      }`}
                                    >
                                      Plus de confort pour voyager sereinement.
                                    </p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-semibold uppercase tracking-wide opacity-75">
                                      À partir de
                                    </p>
                                    <p className="mt-1 text-2xl font-extrabold">
                                      {bestCabin.total}
                                    </p>
                                  </div>
                                </div>
                                <p
                                  className={`mt-3 text-xs ${
                                    cabinSelected ? "text-white/80" : "text-slate-500"
                                  }`}
                                >
                                  {serviceLabel(bestCabin.service)}
                                </p>
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
                            const firstErrorNote = states.find(
                              (st) => st?.status === "error" && st.note?.trim()
                            )?.note;
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
                            <div
                              className={`grid gap-3 ${
                                categoryCards.length > 1 ? "md:grid-cols-2" : ""
                              }`}
                            >
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
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#163B6D]">
              1. Recherche
            </span>
            <span className="rounded-full bg-[#F28C28] px-3 py-1 text-xs font-semibold text-white">
              2. Traversées et prix
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              3. Hébergement
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              4. Passager
            </span>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
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
              className="inline-flex rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
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
                  title="Configuration de recherche"
                  subtitle="Données du dossier de réservation."
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
                        {discountLabel(flow.search.bonificacion)}
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
                      Aller-retour — état de la sélection
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
                              : "Choisi — tarif en attente ou indisponible"}
                        </p>
                        {selectedOutbound ? (
                          <p className="mt-2 text-xs text-slate-600">
                            {formatApiDate(selectedOutbound.salida.fechaSalida)} •{" "}
                            {formatApiTime(selectedOutbound.salida.horaSalida)} •{" "}
                            {serviceLabel(selectedOutbound.service)}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            Choisissez une offre dans la colonne « Aller ».
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
                              : "Choisi — tarif en attente ou indisponible"}
                        </p>
                        {selectedInbound ? (
                          <p className="mt-2 text-xs text-slate-600">
                            {formatApiDate(selectedInbound.salida.fechaSalida)} •{" "}
                            {formatApiTime(selectedInbound.salida.horaSalida)} •{" "}
                            {serviceLabel(selectedInbound.service)}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            Choisissez une offre dans la colonne « Retour ».
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
                          <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-bold text-slate-900">
                            <span>Total</span>
                            <span>{formatMoney(roundTripTransportAmounts.total)}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    {!canContinue ? (
                      <p className="mt-2 text-xs text-amber-900">
                        Le bouton reste désactivé tant que l’aller et le retour ne
                        sont pas tous deux choisis avec un tarif valide.
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

                  <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">
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
                    <div className="min-w-0 lg:border-l lg:border-slate-200 lg:pl-8">
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
                        Aller {formatMoney(roundTripTransportAmounts.outbound)} ·
                        Retour {formatMoney(roundTripTransportAmounts.inbound)} ·
                        Total {formatMoney(roundTripTransportAmounts.total)}
                      </p>
                    ) : null}
                    <p className="mb-2 line-clamp-2 text-center text-[11px] leading-snug text-slate-700">
                      {roundTripSelectionHint}
                    </p>
                    {!canContinue ? (
                      <p className="mb-2 text-center text-[10px] text-amber-900">
                        Bouton actif lorsque aller et retour sont tarifés.
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
                  title="Configuration de recherche"
                  subtitle="Données du dossier de réservation."
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
                        {discountLabel(flow.search.bonificacion)}
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