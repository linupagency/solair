export type BookingTripType = "one_way" | "round_trip";

export type BookingPassengerCounts = {
  adults: number;
  youth: number;
  seniors: number;
  children: number;
  babies: number;
};

export type BookingAnimals = {
  enabled: boolean;
  count: number;
};

export type BookingVehicleDimensions = {
  alto?: number;
  ancho?: number;
  largo?: number;
};

export type BookingVehicleSelection = {
  category: string;
  quantity: number;
  label: string;
  driverPassengerIndex?: number;
  marque?: string;
  modele?: string;
  immatriculation?: string;
  dimensions?: BookingVehicleDimensions;
  /** WSDL `VehEntidad.tipoVehiculo` (ex. V). */
  tipoVehiculo?: string;
  /** WSDL `VehEntidad.tara`. */
  taraKg?: number;
  /** WSDL `VehEntidad.seguro`. */
  seguro?: string;
  /**
   * Remorque : `false` → largo base + metrosExtra ; `true` ou omis → largo total (défaut client).
   */
  rawTrailerLength?: boolean;
};

export type BookingSelectedDeparture = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  barco?: string;
  transportPrice?: string;
  pricingRaw?: unknown;
};

/** Service transport figé à l’étape 2 (base tarifaire avant upgrade confort). */
export type BookingTransportServiceRef = {
  codigoServicioVenta: string;
  tipoServicioVenta: string;
};

/** Offre commerciale sur une salida (passager, cabine, etc.) — source Armas */
export type BookingSalidaServiceOffer = {
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  /** Nombre d’unités vendables sur cette salida (si communiqué par Armas). */
  disponibles?: number;
  textoCorto?: string;
  textoLargo?: string;
};

export type BookingAccommodationSelection = {
  code: string;
  label: string;
  /** Montant du supplément confort / hébergement (0 si formule incluse). */
  price: string;
  details?: string;
  codigoServicioVenta?: string;
  tipoServicioVenta?: string;
  /** True = pas d’upgrade ; tarif transport de base uniquement. */
  isBaseIncluded?: boolean;
};

export type BookingJourneySegment = {
  selectedDeparture?: BookingSelectedDeparture;
  /** Service transport choisi en étape 2 — ne change pas lors d’un upgrade cabine. */
  transportBaseService?: BookingTransportServiceRef;
  /**
   * Ligne véhicule Armas (codigo|tipo) alignée sur le mapping explicite et la salida.
   */
  transportVehicleService?: BookingTransportServiceRef;
  accommodation?: BookingAccommodationSelection;
  /** Services disponibles sur la traversée choisie (pour hébergement / confort) */
  availableServices?: BookingSalidaServiceOffer[];
};

export type BookingTraveler = {
  nombre: string;
  apellido1: string;
  apellido2?: string;
  fechaNacimiento: string;
  codigoPais: string;
  sexo: string;
  tipoDocumento: string;
  codigoDocumento: string;
  /** Champs UI complémentaires (non utilisés par la tarification transport). */
  documentValidUntil?: string;
  specialAssistance?: string;
  /** Code Armas A / J / M / N / B — dérivé du dossier passagers */
  tipoPasajero?: string;
};

export type BookingContact = {
  mail: string;
  telefono: string;
};

/**
 * Prix transport figé après l’étape résultats (ou hébergement) — préférer ce bloc aux chaînes `transportOutbound` / `transportInbound` pour la logique métier.
 */
export type BookingTransportPricingCanonical = {
  pricingMode: "one_way" | "round_trip_bundle" | "round_trip_per_leg";
  totalBundleEuros: number;
  outboundEuros: number | null;
  inboundEuros: number | null;
  segmentVentilationReliable: boolean;
};

export type BookingRoundTripSelectedPricing = {
  outboundSegment: BookingSelectedDeparture;
  inboundSegment: BookingSelectedDeparture;
  outboundEuros: number | null;
  inboundEuros: number | null;
  totalEuros: number;
  serviceCode: string;
  serviceType: string;
  codigoTarifa?: string;
  tarifaLabel?: string;
  bonificationLabel?: string;
  rawPricingResponse?: unknown;
};

export type BookingTotals = {
  transportOutbound?: string;
  transportInbound?: string;
  accommodationOutbound?: string;
  accommodationInbound?: string;
  finalTotal?: string;
  transportPricingCanonical?: BookingTransportPricingCanonical;
  selectedRoundTripPricing?: BookingRoundTripSelectedPricing;
};

export type BookingSearch = {
  origen: string;
  destino: string;
  fechaIda: string;
  fechaVuelta?: string;
  bonificacion: string;
  bonificacionLabel?: string;
  passengers: BookingPassengerCounts;
  animals: BookingAnimals;
  vehicles: BookingVehicleSelection[];
};

export type BookingFlow = {
  tripType: BookingTripType;
  search: BookingSearch;
  outbound: BookingJourneySegment;
  inbound?: BookingJourneySegment;
  travelers: BookingTraveler[];
  contact: BookingContact;
  totals: BookingTotals;
};

export const DEFAULT_PASSENGER_COUNTS: BookingPassengerCounts = {
  adults: 1,
  youth: 0,
  seniors: 0,
  children: 0,
  babies: 0,
};

export const DEFAULT_ANIMALS: BookingAnimals = {
  enabled: false,
  count: 0,
};

export const DEFAULT_CONTACT: BookingContact = {
  mail: "",
  telefono: "",
};

export const DEFAULT_TOTALS: BookingTotals = {
  transportOutbound: "",
  transportInbound: "",
  accommodationOutbound: "",
  accommodationInbound: "",
  finalTotal: "",
};

export function createEmptyBookingFlow(): BookingFlow {
  return {
    tripType: "one_way",
    search: {
      origen: "",
      destino: "",
      fechaIda: "",
      fechaVuelta: "",
      bonificacion: "G",
      bonificacionLabel: "Tarif général",
      passengers: { ...DEFAULT_PASSENGER_COUNTS },
      animals: { ...DEFAULT_ANIMALS },
      vehicles: [],
    },
    outbound: {},
    inbound: undefined,
    travelers: [],
    contact: { ...DEFAULT_CONTACT },
    totals: { ...DEFAULT_TOTALS },
  };
}

export function getTotalPassengersFromCounts(
  counts: BookingPassengerCounts
): number {
  return (
    counts.adults +
    counts.youth +
    counts.seniors +
    counts.children +
    counts.babies
  );
}

export function getPrimaryPassengerType(
  counts: BookingPassengerCounts
): "A" | "J" | "M" | "N" | "B" {
  if (counts.adults > 0) return "A";
  if (counts.youth > 0) return "J";
  if (counts.seniors > 0) return "M";
  if (counts.children > 0) return "N";
  return "B";
}

export function expandPassengerTipoList(
  counts: BookingPassengerCounts
): Array<"A" | "J" | "M" | "N" | "B"> {
  const list: Array<"A" | "J" | "M" | "N" | "B"> = [];
  const add = (tipo: "A" | "J" | "M" | "N" | "B", n: number) => {
    for (let i = 0; i < n; i += 1) list.push(tipo);
  };
  add("A", counts.adults);
  add("J", counts.youth);
  add("M", counts.seniors);
  add("N", counts.children);
  add("B", counts.babies);
  return list;
}

export function getTipoPasajeroForPassengerIndex(
  counts: BookingPassengerCounts,
  index: number
): "A" | "J" | "M" | "N" | "B" {
  const list = expandPassengerTipoList(counts);
  return list[index] ?? getPrimaryPassengerType(counts);
}

export function bookingFlowHasReturn(flow: BookingFlow): boolean {
  return flow.tripType === "round_trip";
}

export function cloneBookingFlow(flow: BookingFlow): BookingFlow {
  return JSON.parse(JSON.stringify(flow)) as BookingFlow;
}
