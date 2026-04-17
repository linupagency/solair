"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  getBookingFlow,
  setBookingFlow,
} from "@/lib/booking-flow-storage";
import {
  expandPassengerTipoList,
  type BookingAccommodationSelection,
  type BookingFlow,
  type BookingSalidaServiceOffer,
  type BookingTransportPricingCanonical,
  type BookingTransportServiceRef,
} from "@/lib/booking-flow";
import {
  getCommercialDescription,
  getCommercialKind,
  getCommercialLabel,
} from "@/lib/ui/armas-commercial";
import {
  tryBuildTarificacionPostBodyFromFlow,
  type TarificacionCompanionCatalog,
} from "@/lib/armas/tarificacion-post-body";
import { fetchTransportPricing } from "@/lib/armas/transport-pricing-client";

type JourneyDirection = "outbound" | "inbound";

type CatalogService = {
  codigoServicioVenta?: string;
  tipoServicioVenta?: string;
  disponibles?: number;
  textoCorto?: string;
  textoLargo?: string;
};

type DepartureService = CatalogService & {
  disponibilidad?: boolean;
};

type DepartureSalida = {
  fechaSalida?: string;
  horaSalida?: string;
  trayectoEntidad?: {
    puertoOrigenEntidad?: {
      codigoPuerto?: string;
    };
    puertoDestinoEntidad?: {
      codigoPuerto?: string;
    };
  };
  serviciosVentasEntidad?: {
    servicioVentaEntidad?: DepartureService[] | DepartureService;
  };
};

type DeparturesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  data?: {
    return?: {
      salidasEntidad?: {
        salidaEntidad?: DepartureSalida[] | DepartureSalida;
      };
    };
  };
};

type PricingServiceLine = {
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
};

type SaleServicesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  data?: {
    return?: {
      serviciosVentasEntidad?: {
        servicioVentaEntidad?: CatalogService[] | CatalogService;
      };
    };
  };
};

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeServiceCode(value?: string) {
  return String(value || "").trim().toUpperCase();
}

function offerKey(
  o: Pick<BookingSalidaServiceOffer, "codigoServicioVenta" | "tipoServicioVenta">
) {
  return `${normalizeServiceCode(o.codigoServicioVenta)}|${normalizeServiceCode(
    o.tipoServicioVenta
  )}`;
}

/** Option explicite : formule transport incluse sans supplément confort. */
const BASE_INCLUDED_KEY = "__SOLAIR_BASE_INCLUDED__";
const ARMAS_ACCOMMODATION_SUPPLEMENT_FACTOR = 0.9;

/** Libellés (texto corto/largo) à exclure — confort / hébergement uniquement à l’étape 3 */
const FORBIDDEN_ACCOMMODATION_LABEL_SNIPPETS = [
  "VEHICULE",
  "REMORQUE",
  "CAMPING-CAR",
  "CAMPING CAR",
  "MOTO",
] as const;

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function combinedOfferLabelUpper(offer: BookingSalidaServiceOffer): string {
  const raw = `${offer.textoCorto || ""} ${offer.textoLargo || ""}`;
  return stripAccents(raw).toUpperCase();
}

/**
 * Vrai service confort / hébergement pour l’étape 3 (exclut transport passager, véhicule, et le couple déjà choisi en étape 2).
 */
function isAccommodationService(
  offer: BookingSalidaServiceOffer,
  selectedTransportServiceKey: string
): boolean {
  const tipo = (offer.tipoServicioVenta || "").trim().toUpperCase();
  const codigo = (offer.codigoServicioVenta || "").trim().toUpperCase();

  if (tipo !== "P") return false;
  if (!codigo || !tipo) return false;

  const label = combinedOfferLabelUpper(offer);
  for (const frag of FORBIDDEN_ACCOMMODATION_LABEL_SNIPPETS) {
    if (label.includes(frag)) return false;
  }

  if (offerKey(offer) === selectedTransportServiceKey) return false;

  return true;
}

function isAnimalRelatedOffer(offer: BookingSalidaServiceOffer): boolean {
  const codigo = (offer.codigoServicioVenta || "").toUpperCase();
  const label = combinedOfferLabelUpper(offer);

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

function filterAccommodationOffers(
  offers: BookingSalidaServiceOffer[],
  selectedTransportServiceKey: string,
  hasAnimals: boolean
): BookingSalidaServiceOffer[] {
  return offers.filter((o) => {
    if (!isAccommodationService(o, selectedTransportServiceKey)) return false;
    if (!hasAnimals && isAnimalRelatedOffer(o)) return false;
    return true;
  });
}

function deriveInitialAccommodationKey(segment: {
  selectedDeparture?: BookingFlow["outbound"]["selectedDeparture"];
  transportBaseService?: BookingTransportServiceRef;
  accommodation?: BookingAccommodationSelection;
}): string {
  const dep = segment.selectedDeparture;
  if (!dep) return BASE_INCLUDED_KEY;

  const baseRef = segment.transportBaseService ?? {
    codigoServicioVenta: dep.codigoServicioVenta,
    tipoServicioVenta: dep.tipoServicioVenta,
  };
  const baseKey = offerKey(baseRef);

  const acc = segment.accommodation;
  if (!acc) return BASE_INCLUDED_KEY;

  if (acc.isBaseIncluded === true || acc.code === "base_included") {
    return BASE_INCLUDED_KEY;
  }

  if (acc.codigoServicioVenta && acc.tipoServicioVenta) {
    const ak = offerKey({
      codigoServicioVenta: acc.codigoServicioVenta,
      tipoServicioVenta: acc.tipoServicioVenta,
    });
    if (ak === baseKey) return BASE_INCLUDED_KEY;
    return ak;
  }

  return BASE_INCLUDED_KEY;
}

function getAccommodationOfferTitle(offer: BookingSalidaServiceOffer): string {
  const commercialFallback = String(getCommercialLabel(offer) || "").trim();
  if (commercialFallback && commercialFallback !== "Option") {
    return commercialFallback;
  }
  const shortLabel = String(offer.textoCorto || "").trim();
  if (shortLabel) return shortLabel;
  const longLabel = String(offer.textoLargo || "").trim();
  if (longLabel) return longLabel;
  const code = String(offer.codigoServicioVenta || "").trim();
  const type = String(offer.tipoServicioVenta || "").trim();
  if (code && type) return `Service ${code} (${type})`;
  if (code) return `Service ${code}`;
  return "Service";
}

function getAccommodationOfferDescription(
  offer: BookingSalidaServiceOffer
): string {
  const frontDescription = String(getCommercialDescription(offer) || "").trim();
  if (frontDescription) return frontDescription;

  const kind = getCommercialKind(offer);
  if (kind === "cabin") {
    return "Cabine à usage exclusif pour votre traversée.";
  }
  if (kind === "seat") {
    return "Option passager proposée sur cette traversée.";
  }
  return "Service proposé sur cette traversée.";
}

function getAccommodationOfferBadge(offer: BookingSalidaServiceOffer): string {
  const kind = getCommercialKind(offer);
  if (kind === "cabin") return "Cabine";
  if (kind === "seat") return "Fauteuil";
  return "Option";
}

function normalizeMoneyToNumber(value?: string | number | null): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(
      value.replace("€", "").replace(/\s/g, "").replace(",", ".")
    );
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function formatMoney(value: number) {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatApiDate(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function getDirectionLabel(direction: JourneyDirection, flow: BookingFlow) {
  if (flow.tripType === "one_way") return "Traversée";
  return direction === "outbound" ? "Aller" : "Retour";
}

function toArmasAccommodationSupplement(
  passengerOnlyBaseTotal: number,
  passengerOnlyOptionTotal: number
) {
  const diff = Math.max(0, passengerOnlyOptionTotal - passengerOnlyBaseTotal);
  return roundMoney(diff * ARMAS_ACCOMMODATION_SUPPLEMENT_FACTOR);
}

function getTotalPassengers(flow: BookingFlow) {
  const c = flow.search.passengers;
  return c.adults + c.youth + c.seniors + c.children + c.babies;
}

function getPricedPassengerCount(flow: BookingFlow) {
  const passengerTipos = expandPassengerTipoList(flow.search.passengers);
  const nonBabies = passengerTipos.filter((tipo) => tipo !== "B");
  if (nonBabies.length > 0) return nonBabies.length;
  return Math.max(1, passengerTipos.length);
}

function buildPricingServiceLine(
  cantidad: number,
  ref: BookingTransportServiceRef
): PricingServiceLine | null {
  const normalizedCantidad = Math.floor(cantidad);
  const codigoServicioVenta = String(ref.codigoServicioVenta || "").trim();
  const tipoServicioVenta = String(ref.tipoServicioVenta || "").trim();
  if (normalizedCantidad <= 0 || !codigoServicioVenta || !tipoServicioVenta) {
    return null;
  }
  return {
    cantidad: normalizedCantidad,
    codigoServicioVenta,
    tipoServicioVenta,
  };
}

function buildAccommodationServiceLines(
  flow: BookingFlow,
  baseServiceRef: BookingTransportServiceRef,
  offer: BookingSalidaServiceOffer | undefined,
  companionServicioVenta:
    | {
        codigoServicioVenta: string;
        tipoServicioVenta: string;
        cantidad?: number;
      }
    | undefined
): PricingServiceLine[] | undefined {
  const pricedPassengerCount = getPricedPassengerCount(flow);
  if (pricedPassengerCount <= 0) return undefined;

  const baseLine = buildPricingServiceLine(pricedPassengerCount, baseServiceRef);
  if (!offer) {
    const lines = baseLine ? [baseLine] : [];
    const companionLine = companionServicioVenta
      ? buildPricingServiceLine(companionServicioVenta.cantidad ?? 1, {
          codigoServicioVenta: companionServicioVenta.codigoServicioVenta,
          tipoServicioVenta: companionServicioVenta.tipoServicioVenta,
        })
      : null;
    if (companionLine) lines.push(companionLine);
    return lines.length > 0 ? lines : undefined;
  }

  const rawSlots =
    typeof offer.disponibles === "number" && Number.isFinite(offer.disponibles)
      ? Math.floor(offer.disponibles)
      : pricedPassengerCount;
  const selectedSlots = Math.max(
    1,
    Math.min(pricedPassengerCount, rawSlots > 0 ? rawSlots : pricedPassengerCount)
  );
  const remainingBaseSlots = Math.max(0, pricedPassengerCount - selectedSlots);

  const lines: PricingServiceLine[] = [];
  const remainingBaseLine = buildPricingServiceLine(
    remainingBaseSlots,
    baseServiceRef
  );
  if (remainingBaseLine) lines.push(remainingBaseLine);

  const selectedOfferLine = buildPricingServiceLine(selectedSlots, {
    codigoServicioVenta: offer.codigoServicioVenta,
    tipoServicioVenta: offer.tipoServicioVenta,
  });
  if (selectedOfferLine) lines.push(selectedOfferLine);

  const companionLine = companionServicioVenta
    ? buildPricingServiceLine(companionServicioVenta.cantidad ?? 1, {
        codigoServicioVenta: companionServicioVenta.codigoServicioVenta,
        tipoServicioVenta: companionServicioVenta.tipoServicioVenta,
      })
    : null;
  if (companionLine) lines.push(companionLine);

  return lines.length > 0 ? lines : undefined;
}

function companionCatalogForSelectedDeparture(
  currentFlow: BookingFlow,
  dep: NonNullable<BookingFlow["outbound"]["selectedDeparture"]>
): TarificacionCompanionCatalog | undefined {
  const ob = currentFlow.outbound.selectedDeparture;
  if (
    ob &&
    ob.fechaSalida === dep.fechaSalida &&
    ob.horaSalida === dep.horaSalida &&
    ob.origen === dep.origen &&
    ob.destino === dep.destino
  ) {
    const s = currentFlow.outbound.availableServices;
    return s?.length ? { serviciosVentas: s } : undefined;
  }
  const ib = currentFlow.inbound?.selectedDeparture;
  if (
    ib &&
    ib.fechaSalida === dep.fechaSalida &&
    ib.horaSalida === dep.horaSalida &&
    ib.origen === dep.origen &&
    ib.destino === dep.destino
  ) {
    const s = currentFlow.inbound?.availableServices;
    return s?.length ? { serviciosVentas: s } : undefined;
  }
  return undefined;
}

function mergeOfferLists(
  primary: BookingSalidaServiceOffer[],
  fallback: BookingSalidaServiceOffer[]
): BookingSalidaServiceOffer[] {
  if (primary.length === 0) {
    return [...fallback];
  }

  const fallbackMap = new Map(
    fallback.map((offer) => [offerKey(offer), offer] as const)
  );

  return primary.map((offer) => {
    const catalogOffer = fallbackMap.get(offerKey(offer));
    if (!catalogOffer) return offer;

    return {
      ...offer,
      disponibles:
        typeof offer.disponibles === "number"
          ? offer.disponibles
          : catalogOffer.disponibles,
      textoCorto: offer.textoCorto || catalogOffer.textoCorto,
      textoLargo: offer.textoLargo || catalogOffer.textoLargo,
    };
  });
}

function catalogToOffers(
  data: SaleServicesApiResponse["data"]
): BookingSalidaServiceOffer[] {
  const raw = normalizeArray(
    data?.return?.serviciosVentasEntidad?.servicioVentaEntidad
  );
  return raw
    .filter((s) => s.codigoServicioVenta && s.tipoServicioVenta)
    .map((s) => ({
      codigoServicioVenta: normalizeServiceCode(s.codigoServicioVenta),
      tipoServicioVenta: normalizeServiceCode(s.tipoServicioVenta),
      disponibles:
        typeof s.disponibles === "number" && Number.isFinite(s.disponibles)
          ? Math.floor(s.disponibles)
          : undefined,
      textoCorto: String(s.textoCorto || "").trim() || undefined,
      textoLargo: String(s.textoLargo || "").trim() || undefined,
    }));
}

function salidaToOffers(salida?: DepartureSalida): BookingSalidaServiceOffer[] {
  const raw = normalizeArray(salida?.serviciosVentasEntidad?.servicioVentaEntidad);
  return raw
    .filter(
      (service) =>
        service.disponibilidad !== false &&
        !!service.codigoServicioVenta &&
        !!service.tipoServicioVenta
    )
    .map((service) => ({
      codigoServicioVenta: normalizeServiceCode(service.codigoServicioVenta),
      tipoServicioVenta: normalizeServiceCode(service.tipoServicioVenta),
      disponibles:
        typeof service.disponibles === "number" &&
        Number.isFinite(service.disponibles)
          ? Math.floor(service.disponibles)
          : undefined,
      textoCorto: String(service.textoCorto || "").trim() || undefined,
      textoLargo: String(service.textoLargo || "").trim() || undefined,
    }));
}

function findSelectedDepartureOffers(
  data: DeparturesApiResponse["data"],
  dep: NonNullable<BookingFlow["outbound"]["selectedDeparture"]>
): BookingSalidaServiceOffer[] {
  const salidas = normalizeArray(data?.return?.salidasEntidad?.salidaEntidad);
  const matched = salidas.find((salida) => {
    const origen =
      salida.trayectoEntidad?.puertoOrigenEntidad?.codigoPuerto || "";
    const destino =
      salida.trayectoEntidad?.puertoDestinoEntidad?.codigoPuerto || "";
    return (
      salida.fechaSalida === dep.fechaSalida &&
      salida.horaSalida === dep.horaSalida &&
      origen === dep.origen &&
      destino === dep.destino
    );
  });
  return salidaToOffers(matched);
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

export default function HebergementPage() {
  const router = useRouter();

  const [flow, setFlowState] = useState<BookingFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [catalogOffers, setCatalogOffers] = useState<BookingSalidaServiceOffer[]>(
    []
  );

  const [outboundOffers, setOutboundOffers] = useState<BookingSalidaServiceOffer[]>(
    []
  );
  const [inboundOffers, setInboundOffers] = useState<BookingSalidaServiceOffer[]>(
    []
  );

  const [selectedOutboundKey, setSelectedOutboundKey] = useState("");
  const [selectedInboundKey, setSelectedInboundKey] = useState("");

  const [outboundBaseNum, setOutboundBaseNum] = useState(0);
  const [inboundBaseNum, setInboundBaseNum] = useState(0);
  /** Si false : forfait AR sans ventilation ida/vta fiable — le total transport est porté sur l’aller. */
  const [rtSegmentVentilationReliable, setRtSegmentVentilationReliable] =
    useState(true);
  const [outboundSegmentNum, setOutboundSegmentNum] = useState(0);
  const [inboundSegmentNum, setInboundSegmentNum] = useState(0);
  const [outboundOptionTotals, setOutboundOptionTotals] = useState<
    Record<string, number>
  >({});
  const [inboundOptionTotals, setInboundOptionTotals] = useState<
    Record<string, number>
  >({});
  const [outboundBaseLoaded, setOutboundBaseLoaded] = useState(false);
  const [inboundBaseLoaded, setInboundBaseLoaded] = useState(false);
  const [outboundPriceError, setOutboundPriceError] = useState("");
  const [inboundPriceError, setInboundPriceError] = useState("");
  const [repricing, setRepricing] = useState(false);

  const fetchPrice = useCallback(
    async (
      currentFlow: BookingFlow,
      dep: NonNullable<BookingFlow["outbound"]["selectedDeparture"]>,
      codigoServicioVenta: string,
      tipoServicioVenta: string,
      armasLeg: "outbound" | "inbound",
      options?: {
        baseServiceRef?: BookingTransportServiceRef;
        accommodationOffer?: BookingSalidaServiceOffer;
      }
    ): Promise<number> => {
      const passengerCount = getTotalPassengers(currentFlow);
      const tipos = expandPassengerTipoList(currentFlow.search.passengers);
      const catalog = companionCatalogForSelectedDeparture(currentFlow, dep);
      const baseServiceRef = options?.baseServiceRef ?? {
        codigoServicioVenta,
        tipoServicioVenta,
      };
      const built = tryBuildTarificacionPostBodyFromFlow(
        currentFlow,
        {
          origen: dep.origen,
          destino: dep.destino,
          fechaSalida: dep.fechaSalida,
          horaSalida: dep.horaSalida,
        },
        {
          cantidad: passengerCount,
          codigoServicioVenta: baseServiceRef.codigoServicioVenta,
          tipoServicioVenta: baseServiceRef.tipoServicioVenta,
          tipoPasajero: tipos[0] || "A",
          passengerTipos: tipos,
        },
        catalog
      );
      if (!built.ok) {
        throw new Error(built.error);
      }
      const serviceLines = options?.accommodationOffer
        ? buildAccommodationServiceLines(
            currentFlow,
            baseServiceRef,
            options.accommodationOffer,
            built.body.companionServicioVenta
          )
        : undefined;
      const priced = await fetchTransportPricing(
        {
          ...built.body,
          ...(serviceLines ? { serviceLines } : {}),
        },
        built.normalizedVehicle,
        currentFlow.tripType === "round_trip"
          ? { tripType: "round_trip", armasLeg }
          : undefined
      );
      if (!priced.ok) {
        throw new Error(priced.error);
      }
      const n = priced.totalEuros;
      if (n === null || !Number.isFinite(n)) {
        throw new Error("Prix non renvoyé par Armas.");
      }
      return n;
    },
    []
  );

  const fetchPassengerOnlyPrice = useCallback(
    async (
      currentFlow: BookingFlow,
      dep: NonNullable<BookingFlow["outbound"]["selectedDeparture"]>,
      codigoServicioVenta: string,
      tipoServicioVenta: string
    ): Promise<number> => {
      const passengerCount = getTotalPassengers(currentFlow);
      const tipos = expandPassengerTipoList(currentFlow.search.passengers);
      const built = tryBuildTarificacionPostBodyFromFlow(
        currentFlow,
        {
          origen: dep.origen,
          destino: dep.destino,
          fechaSalida: dep.fechaSalida,
          horaSalida: dep.horaSalida,
        },
        {
          cantidad: passengerCount,
          codigoServicioVenta,
          tipoServicioVenta,
          tipoPasajero: tipos[0] || "A",
          passengerTipos: tipos,
        }
      );
      if (!built.ok) {
        throw new Error(built.error);
      }

      const priced = await fetchTransportPricing(
        {
          ...built.body,
          vehicle: "none",
          vehicleCategory: undefined,
          vehiclePassengerIndex: undefined,
          vehicleData: undefined,
          companionServicioVenta: undefined,
        },
        null
      );
      if (!priced.ok) {
        throw new Error(priced.error);
      }
      const n = priced.totalEuros;
      if (n === null || !Number.isFinite(n)) {
        throw new Error("Prix passager seul non renvoyé par Armas.");
      }
      return n;
    },
    []
  );

  const fetchRoundTripBaseTotals = useCallback(
    async (
      currentFlow: BookingFlow
    ): Promise<{
      outboundBase: number;
      inboundBase: number;
      segmentVentilationReliable: boolean;
    }> => {
      if (
        currentFlow.tripType !== "round_trip" ||
        !currentFlow.outbound.selectedDeparture ||
        !currentFlow.inbound?.selectedDeparture
      ) {
        throw new Error("Dossier aller-retour incomplet pour tarification AR.");
      }

      const passengerCount = getTotalPassengers(currentFlow);
      const tipos = expandPassengerTipoList(currentFlow.search.passengers);
      const outboundDep = currentFlow.outbound.selectedDeparture;
      const inboundDep = currentFlow.inbound.selectedDeparture;
      const outboundBase = currentFlow.outbound.transportBaseService ?? {
        codigoServicioVenta: outboundDep.codigoServicioVenta,
        tipoServicioVenta: outboundDep.tipoServicioVenta,
      };
      const inboundBase = currentFlow.inbound.transportBaseService ?? {
        codigoServicioVenta: inboundDep.codigoServicioVenta,
        tipoServicioVenta: inboundDep.tipoServicioVenta,
      };

      const outboundBuilt = tryBuildTarificacionPostBodyFromFlow(
        currentFlow,
        {
          origen: outboundDep.origen,
          destino: outboundDep.destino,
          fechaSalida: outboundDep.fechaSalida,
          horaSalida: outboundDep.horaSalida,
        },
        {
          cantidad: passengerCount,
          codigoServicioVenta: outboundBase.codigoServicioVenta,
          tipoServicioVenta: outboundBase.tipoServicioVenta,
          tipoPasajero: tipos[0] || "A",
          passengerTipos: tipos,
        },
        companionCatalogForSelectedDeparture(currentFlow, outboundDep)
      );
      if (!outboundBuilt.ok) {
        throw new Error(outboundBuilt.error);
      }

      const inboundBuilt = tryBuildTarificacionPostBodyFromFlow(
        currentFlow,
        {
          origen: inboundDep.origen,
          destino: inboundDep.destino,
          fechaSalida: inboundDep.fechaSalida,
          horaSalida: inboundDep.horaSalida,
        },
        {
          cantidad: passengerCount,
          codigoServicioVenta: inboundBase.codigoServicioVenta,
          tipoServicioVenta: inboundBase.tipoServicioVenta,
          tipoPasajero: tipos[0] || "A",
          passengerTipos: tipos,
        },
        companionCatalogForSelectedDeparture(currentFlow, inboundDep)
      );
      if (!inboundBuilt.ok) {
        throw new Error(inboundBuilt.error);
      }

      const priced = await fetchTransportPricing(
        outboundBuilt.body,
        outboundBuilt.normalizedVehicle,
        {
          tripType: "round_trip",
          armasLeg: "outbound",
          returnSegment: {
            origen: inboundBuilt.body.origen,
            destino: inboundBuilt.body.destino,
            fechaSalida: inboundBuilt.body.fechaSalida,
            horaSalida: inboundBuilt.body.horaSalida,
            codigoServicioVenta: inboundBuilt.body.codigoServicioVenta,
            tipoServicioVenta: inboundBuilt.body.tipoServicioVenta,
            sentidoSalida: 2,
          },
        }
      );
      if (!priced.ok) {
        throw new Error(priced.error);
      }

      const bundle = priced.roundTripTotalEuros ?? priced.totalEuros;
      if (bundle == null || !Number.isFinite(bundle) || bundle <= 0) {
        throw new Error("Réponse AR sans total aller-retour exploitable.");
      }
      const segmentVentilationReliable = priced.segmentVentilationReliable === true;
      if (segmentVentilationReliable) {
        const outbound = priced.outboundEuros;
        const inbound = priced.returnEuros;
        if (
          outbound == null ||
          inbound == null ||
          !Number.isFinite(outbound) ||
          !Number.isFinite(inbound)
        ) {
          throw new Error("Réponse AR sans ventilation ida/vta exploitable.");
        }
        return {
          outboundBase: outbound,
          inboundBase: inbound,
          segmentVentilationReliable: true,
        };
      }
      return {
        outboundBase: bundle,
        inboundBase: 0,
        segmentVentilationReliable: false,
      };
    },
    []
  );

  useEffect(() => {
    const currentFlow = getBookingFlow();
    setFlowState(currentFlow);

    if (!currentFlow.outbound.selectedDeparture) {
      setLoading(false);
      return;
    }

    const obDep = currentFlow.outbound.selectedDeparture;
    setSelectedOutboundKey(
      deriveInitialAccommodationKey(currentFlow.outbound)
    );

    if (
      currentFlow.tripType === "round_trip" &&
      currentFlow.inbound?.selectedDeparture
    ) {
      setSelectedInboundKey(
        deriveInitialAccommodationKey(currentFlow.inbound)
      );
    } else {
      setInboundBaseLoaded(true);
    }

    async function loadCatalog() {
      try {
        const r = await fetch(
          `/api/armas/test-sale-services?origen=${encodeURIComponent(
            currentFlow.search.origen
          )}&destino=${encodeURIComponent(currentFlow.search.destino)}`,
          { cache: "no-store" }
        );
        const json: SaleServicesApiResponse = await r.json();
        if (r.ok && json.ok) {
          setCatalogOffers(catalogToOffers(json.data));
        }
      } catch {
        /* catalogue optionnel */
      }
    }

    async function loadDepartureOffers(
      dep: NonNullable<BookingFlow["outbound"]["selectedDeparture"]>
    ) {
      try {
        const r = await fetch(
          `/api/armas/test-departures?origen=${encodeURIComponent(
            dep.origen
          )}&destino=${encodeURIComponent(dep.destino)}&fecha=${encodeURIComponent(
            dep.fechaSalida
          )}`,
          { cache: "no-store" }
        );
        const json: DeparturesApiResponse = await r.json();
        if (r.ok && json.ok) {
          return findSelectedDepartureOffers(json.data, dep);
        }
      } catch {
        /* fallback sur le flow persistant */
      }
      return [];
    }

    const obFromSeg = currentFlow.outbound.availableServices || [];
    const inFromSeg = currentFlow.inbound?.availableServices || [];

    void Promise.all([
      loadCatalog(),
      loadDepartureOffers(obDep),
      currentFlow.tripType === "round_trip" &&
      currentFlow.inbound?.selectedDeparture
        ? loadDepartureOffers(currentFlow.inbound.selectedDeparture)
        : Promise.resolve([] as BookingSalidaServiceOffer[]),
    ]).then(([, outboundFreshOffers, inboundFreshOffers]) => {
      setOutboundOffers(
        outboundFreshOffers.length > 0 ? outboundFreshOffers : obFromSeg
      );
      setInboundOffers(
        inboundFreshOffers.length > 0 ? inboundFreshOffers : inFromSeg
      );
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (catalogOffers.length === 0) return;
    setOutboundOffers((prev) => mergeOfferLists(prev, catalogOffers));
    setInboundOffers((prev) => mergeOfferLists(prev, catalogOffers));
  }, [catalogOffers]);

  useEffect(() => {
    if (!flow?.outbound.selectedDeparture || flow.tripType === "round_trip") return;

    const dep = flow.outbound.selectedDeparture;
    const base = flow.outbound.transportBaseService ?? {
      codigoServicioVenta: dep.codigoServicioVenta,
      tipoServicioVenta: dep.tipoServicioVenta,
    };

    let cancelled = false;
    setOutboundBaseLoaded(false);
    setOutboundPriceError("");
    setRepricing(true);
    setRtSegmentVentilationReliable(true);

    void (async () => {
      try {
        const total = await fetchPrice(
          flow,
          dep,
          base.codigoServicioVenta,
          base.tipoServicioVenta,
          "outbound"
        );
        if (!cancelled) {
          setOutboundBaseNum(total);
          setOutboundBaseLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setOutboundPriceError(
            e instanceof Error ? e.message : "Erreur de prix de base aller."
          );
        }
      } finally {
        if (!cancelled) setRepricing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flow, fetchPrice]);

  useEffect(() => {
    if (
      !flow ||
      flow.tripType !== "round_trip" ||
      !flow.inbound?.selectedDeparture
    ) {
      return;
    }

    let cancelled = false;
    setOutboundBaseLoaded(false);
    setInboundBaseLoaded(false);
    setOutboundPriceError("");
    setInboundPriceError("");
    setRepricing(true);

    const selectedRtPricing = flow.totals.selectedRoundTripPricing;
    const selectedOutboundDep = flow.outbound.selectedDeparture;
    const selectedInboundDep = flow.inbound.selectedDeparture;
    if (
      selectedRtPricing &&
      selectedOutboundDep &&
      selectedInboundDep &&
      selectedRtPricing.totalEuros > 0 &&
      selectedRtPricing.outboundSegment.origen === selectedOutboundDep.origen &&
      selectedRtPricing.outboundSegment.destino === selectedOutboundDep.destino &&
      selectedRtPricing.outboundSegment.fechaSalida === selectedOutboundDep.fechaSalida &&
      selectedRtPricing.outboundSegment.horaSalida === selectedOutboundDep.horaSalida &&
      selectedRtPricing.inboundSegment.origen === selectedInboundDep.origen &&
      selectedRtPricing.inboundSegment.destino === selectedInboundDep.destino &&
      selectedRtPricing.inboundSegment.fechaSalida === selectedInboundDep.fechaSalida &&
      selectedRtPricing.inboundSegment.horaSalida === selectedInboundDep.horaSalida
    ) {
      const hasLegSplit =
        selectedRtPricing.outboundEuros != null &&
        selectedRtPricing.inboundEuros != null &&
        Number.isFinite(selectedRtPricing.outboundEuros) &&
        Number.isFinite(selectedRtPricing.inboundEuros);
      setRtSegmentVentilationReliable(hasLegSplit);
      setOutboundBaseNum(
        hasLegSplit ? selectedRtPricing.outboundEuros! : selectedRtPricing.totalEuros
      );
      setInboundBaseNum(hasLegSplit ? selectedRtPricing.inboundEuros! : 0);
      setOutboundBaseLoaded(true);
      setInboundBaseLoaded(true);
      setRepricing(false);
      return;
    }

    void (async () => {
      try {
        const totals = await fetchRoundTripBaseTotals(flow);
        if (!cancelled) {
          setRtSegmentVentilationReliable(totals.segmentVentilationReliable);
          setOutboundBaseNum(totals.outboundBase);
          setInboundBaseNum(totals.inboundBase);
          setOutboundBaseLoaded(true);
          setInboundBaseLoaded(true);
        }
      } catch (e) {
        if (!cancelled) {
          setOutboundPriceError(
            e instanceof Error ? e.message : "Erreur de prix AR."
          );
          setInboundPriceError(
            e instanceof Error ? e.message : "Erreur de prix AR."
          );
        }
      } finally {
        if (!cancelled) setRepricing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [flow, fetchRoundTripBaseTotals]);

  const hasAnimals = useMemo(() => {
    if (!flow) return false;
    return Boolean(flow.search.animals.enabled && flow.search.animals.count > 0);
  }, [flow]);

  const outboundTransportBaseKey = useMemo(() => {
    const dep = flow?.outbound.selectedDeparture;
    if (!dep) return "";
    const ref = flow?.outbound.transportBaseService;
    if (ref?.codigoServicioVenta && ref?.tipoServicioVenta) {
      return offerKey(ref);
    }
    return offerKey({
      codigoServicioVenta: dep.codigoServicioVenta,
      tipoServicioVenta: dep.tipoServicioVenta,
    });
  }, [
    flow?.outbound.selectedDeparture?.codigoServicioVenta,
    flow?.outbound.selectedDeparture?.tipoServicioVenta,
    flow?.outbound.transportBaseService?.codigoServicioVenta,
    flow?.outbound.transportBaseService?.tipoServicioVenta,
  ]);

  const inboundTransportBaseKey = useMemo(() => {
    const dep = flow?.inbound?.selectedDeparture;
    if (!dep) return "";
    const ref = flow?.inbound?.transportBaseService;
    if (ref?.codigoServicioVenta && ref?.tipoServicioVenta) {
      return offerKey(ref);
    }
    return offerKey({
      codigoServicioVenta: dep.codigoServicioVenta,
      tipoServicioVenta: dep.tipoServicioVenta,
    });
  }, [
    flow?.inbound?.selectedDeparture?.codigoServicioVenta,
    flow?.inbound?.selectedDeparture?.tipoServicioVenta,
    flow?.inbound?.transportBaseService?.codigoServicioVenta,
    flow?.inbound?.transportBaseService?.tipoServicioVenta,
  ]);

  const outboundOptions = useMemo(() => {
    if (!outboundTransportBaseKey) return [];
    return filterAccommodationOffers(
      outboundOffers,
      outboundTransportBaseKey,
      hasAnimals
    );
  }, [outboundOffers, outboundTransportBaseKey, hasAnimals]);

  const inboundOptions = useMemo(() => {
    if (!inboundTransportBaseKey) return [];
    return filterAccommodationOffers(
      inboundOffers,
      inboundTransportBaseKey,
      hasAnimals
    );
  }, [inboundOffers, inboundTransportBaseKey, hasAnimals]);

  useEffect(() => {
    if (
      !flow?.outbound.selectedDeparture ||
      !outboundBaseLoaded
    ) {
      return;
    }

    if (outboundOptions.length === 0) {
      setOutboundOptionTotals({});
      return;
    }

    let cancelled = false;
    setRepricing(true);
    const outboundBaseRef = flow.outbound.transportBaseService ?? {
      codigoServicioVenta: flow.outbound.selectedDeparture.codigoServicioVenta,
      tipoServicioVenta: flow.outbound.selectedDeparture.tipoServicioVenta,
    };

    void (async () => {
      const nextTotals: Record<string, number> = {};
      try {
        const outboundPassengerOnlyBase = await fetchPassengerOnlyPrice(
          flow,
          flow.outbound.selectedDeparture!,
          outboundBaseRef.codigoServicioVenta,
          outboundBaseRef.tipoServicioVenta
        );
        await Promise.all(
          outboundOptions.map(async (offer) => {
            const key = offerKey(offer);
            try {
              const passengerOnlyOption = await fetchPassengerOnlyPrice(
                flow,
                flow.outbound.selectedDeparture!,
                offer.codigoServicioVenta,
                offer.tipoServicioVenta
              );
              const supplement = toArmasAccommodationSupplement(
                outboundPassengerOnlyBase,
                passengerOnlyOption
              );
              if (Number.isFinite(supplement) && supplement >= 0) {
                nextTotals[key] = roundMoney(outboundBaseNum + supplement);
              }
            } catch {
              // on conserve les autres tarifs valides
            }
          })
        );
        if (!cancelled) {
          setOutboundOptionTotals(nextTotals);
        }
      } finally {
        if (!cancelled) setRepricing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    flow,
    outboundBaseLoaded,
    outboundOptions,
    fetchPassengerOnlyPrice,
    outboundBaseNum,
  ]);

  useEffect(() => {
    if (
      !flow ||
      flow.tripType !== "round_trip" ||
      !flow.inbound?.selectedDeparture ||
      !inboundBaseLoaded
    ) {
      return;
    }

    if (inboundOptions.length === 0) {
      setInboundOptionTotals({});
      return;
    }

    let cancelled = false;
    setRepricing(true);
    const inboundBaseRef = flow.inbound.transportBaseService ?? {
      codigoServicioVenta: flow.inbound.selectedDeparture.codigoServicioVenta,
      tipoServicioVenta: flow.inbound.selectedDeparture.tipoServicioVenta,
    };

    void (async () => {
      const nextTotals: Record<string, number> = {};
      try {
        const inboundPassengerOnlyBase = await fetchPassengerOnlyPrice(
          flow,
          flow.inbound!.selectedDeparture!,
          inboundBaseRef.codigoServicioVenta,
          inboundBaseRef.tipoServicioVenta
        );
        await Promise.all(
          inboundOptions.map(async (offer) => {
            const key = offerKey(offer);
            try {
              const passengerOnlyOption = await fetchPassengerOnlyPrice(
                flow,
                flow.inbound!.selectedDeparture!,
                offer.codigoServicioVenta,
                offer.tipoServicioVenta
              );
              const supplement = toArmasAccommodationSupplement(
                inboundPassengerOnlyBase,
                passengerOnlyOption
              );
              if (Number.isFinite(supplement) && supplement >= 0) {
                nextTotals[key] = roundMoney(inboundBaseNum + supplement);
              }
            } catch {
              // on conserve les autres tarifs valides
            }
          })
        );
        if (!cancelled) {
          setInboundOptionTotals(nextTotals);
        }
      } finally {
        if (!cancelled) setRepricing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    flow,
    inboundBaseLoaded,
    inboundOptions,
    fetchPassengerOnlyPrice,
    inboundBaseNum,
  ]);

  useEffect(() => {
    if (selectedOutboundKey === BASE_INCLUDED_KEY) return;
    const valid = outboundOptions.some(
      (o) => offerKey(o) === selectedOutboundKey
    );
    const hasPrice =
      typeof outboundOptionTotals[selectedOutboundKey] === "number" &&
      outboundOptionTotals[selectedOutboundKey] > 0;
    if (!valid || !hasPrice) {
      setSelectedOutboundKey(BASE_INCLUDED_KEY);
    }
  }, [outboundOptions, selectedOutboundKey, outboundOptionTotals]);

  useEffect(() => {
    if (selectedInboundKey === BASE_INCLUDED_KEY) return;
    const valid = inboundOptions.some(
      (o) => offerKey(o) === selectedInboundKey
    );
    const hasPrice =
      typeof inboundOptionTotals[selectedInboundKey] === "number" &&
      inboundOptionTotals[selectedInboundKey] > 0;
    if (!valid || !hasPrice) {
      setSelectedInboundKey(BASE_INCLUDED_KEY);
    }
  }, [inboundOptions, selectedInboundKey, inboundOptionTotals]);

  useEffect(() => {
    if (!outboundBaseLoaded) return;
    if (selectedOutboundKey === BASE_INCLUDED_KEY) {
      setOutboundSegmentNum(outboundBaseNum);
      setOutboundPriceError("");
      return;
    }
    const n = outboundOptionTotals[selectedOutboundKey];
    if (typeof n === "number" && n > 0) {
      setOutboundSegmentNum(n);
      setOutboundPriceError("");
      return;
    }
    setOutboundPriceError("Tarif indisponible pour cette option.");
  }, [selectedOutboundKey, outboundBaseLoaded, outboundBaseNum, outboundOptionTotals]);

  useEffect(() => {
    if (flow?.tripType !== "round_trip") return;
    if (!inboundBaseLoaded) return;
    if (selectedInboundKey === BASE_INCLUDED_KEY) {
      setInboundSegmentNum(inboundBaseNum);
      setInboundPriceError("");
      return;
    }
    const n = inboundOptionTotals[selectedInboundKey];
    if (typeof n === "number" && n > 0) {
      setInboundSegmentNum(n);
      setInboundPriceError("");
      return;
    }
    setInboundPriceError("Tarif indisponible pour cette option.");
  }, [
    flow?.tripType,
    selectedInboundKey,
    inboundBaseLoaded,
    inboundBaseNum,
    inboundOptionTotals,
  ]);

  const outboundSupplementNum = useMemo(
    () => Math.max(0, outboundSegmentNum - outboundBaseNum),
    [outboundSegmentNum, outboundBaseNum]
  );
  const inboundSupplementNum = useMemo(
    () => Math.max(0, inboundSegmentNum - inboundBaseNum),
    [inboundSegmentNum, inboundBaseNum]
  );

  const finalTotal = useMemo(() => {
    if (flow?.tripType === "round_trip" && !rtSegmentVentilationReliable) {
      const obSup = Math.max(0, outboundSegmentNum - outboundBaseNum);
      const inSup = Math.max(0, inboundSegmentNum - inboundBaseNum);
      return outboundBaseNum + obSup + inSup;
    }
    let t = outboundSegmentNum;
    if (flow?.tripType === "round_trip") {
      t += inboundSegmentNum;
    }
    return t;
  }, [
    flow?.tripType,
    rtSegmentVentilationReliable,
    outboundSegmentNum,
    inboundSegmentNum,
    outboundBaseNum,
    inboundBaseNum,
  ]);

  const canContinue = useMemo(() => {
    if (!flow) return false;
    if (!flow.outbound.selectedDeparture) return false;
    if (flow.tripType === "round_trip" && !flow.inbound?.selectedDeparture) {
      return false;
    }
    if (!outboundBaseLoaded) return false;
    if (flow.tripType === "round_trip" && !inboundBaseLoaded) return false;
    if (outboundPriceError) return false;
    if (flow.tripType === "round_trip" && inboundPriceError) return false;
    if (outboundSegmentNum <= 0) return false;
    if (flow.tripType === "round_trip" && inboundSegmentNum <= 0) return false;
    return finalTotal > 0;
  }, [
    flow,
    finalTotal,
    outboundPriceError,
    inboundPriceError,
    outboundBaseLoaded,
    inboundBaseLoaded,
    outboundSegmentNum,
    inboundSegmentNum,
  ]);

  function buildAccommodationBase(): BookingAccommodationSelection {
    return {
      code: "base_included",
      label: "Sans supplément hébergement",
      price: formatMoney(0),
      isBaseIncluded: true,
      details:
        "Vous conservez le transport de base déjà sélectionné, sans option d’hébergement supplémentaire.",
    };
  }

  function buildAccommodationUpgrade(
    key: string,
    offer: BookingSalidaServiceOffer,
    supplementNum: number
  ): BookingAccommodationSelection {
    return {
      code: key,
      label: getAccommodationOfferTitle(offer),
      price: formatMoney(supplementNum),
      isBaseIncluded: false,
      details: getAccommodationOfferDescription(offer),
      codigoServicioVenta: offer.codigoServicioVenta,
      tipoServicioVenta: offer.tipoServicioVenta,
    };
  }

  function handleContinue() {
    if (!flow || !canContinue) return;

    const obBase = flow.outbound.transportBaseService ?? {
      codigoServicioVenta: flow.outbound.selectedDeparture!.codigoServicioVenta,
      tipoServicioVenta: flow.outbound.selectedDeparture!.tipoServicioVenta,
    };

    let outboundAccommodation: BookingAccommodationSelection;
    let outboundDepPatch: NonNullable<
      BookingFlow["outbound"]["selectedDeparture"]
    >;

    if (selectedOutboundKey === BASE_INCLUDED_KEY) {
      outboundAccommodation = buildAccommodationBase();
      outboundDepPatch = {
        ...flow.outbound.selectedDeparture!,
        codigoServicioVenta: obBase.codigoServicioVenta,
        tipoServicioVenta: obBase.tipoServicioVenta,
        transportPrice: formatMoney(outboundSegmentNum),
      };
    } else {
      const obParts = selectedOutboundKey.split("|");
      const obCod = obParts[0];
      const obTipo = obParts[1];
      const obOffer =
        outboundOptions.find((o) => offerKey(o) === selectedOutboundKey) ||
        ({
          codigoServicioVenta: obCod,
          tipoServicioVenta: obTipo,
        } as BookingSalidaServiceOffer);
      outboundAccommodation = buildAccommodationUpgrade(
        selectedOutboundKey,
        obOffer,
        outboundSupplementNum
      );
      outboundDepPatch = {
        ...flow.outbound.selectedDeparture!,
        codigoServicioVenta: obCod,
        tipoServicioVenta: obTipo,
        transportPrice: formatMoney(outboundSegmentNum),
      };
    }

    let inboundPatch = flow.inbound;
    if (flow.tripType === "round_trip" && flow.inbound?.selectedDeparture) {
      const inBase = flow.inbound.transportBaseService ?? {
        codigoServicioVenta: flow.inbound.selectedDeparture.codigoServicioVenta,
        tipoServicioVenta: flow.inbound.selectedDeparture.tipoServicioVenta,
      };

      let inboundAccommodation: BookingAccommodationSelection;
      let inboundDepPatch: NonNullable<
        NonNullable<BookingFlow["inbound"]>["selectedDeparture"]
      >;

      if (selectedInboundKey === BASE_INCLUDED_KEY) {
        inboundAccommodation = buildAccommodationBase();
        inboundDepPatch = {
          ...flow.inbound.selectedDeparture,
          codigoServicioVenta: inBase.codigoServicioVenta,
          tipoServicioVenta: inBase.tipoServicioVenta,
          transportPrice: formatMoney(inboundSegmentNum),
        };
      } else {
        const inParts = selectedInboundKey.split("|");
        const inCod = inParts[0];
        const inTipo = inParts[1];
        const inOffer =
          inboundOptions.find((o) => offerKey(o) === selectedInboundKey) ||
          ({
            codigoServicioVenta: inCod,
            tipoServicioVenta: inTipo,
          } as BookingSalidaServiceOffer);
        inboundAccommodation = buildAccommodationUpgrade(
          selectedInboundKey,
          inOffer,
          inboundSupplementNum
        );
        inboundDepPatch = {
          ...flow.inbound.selectedDeparture,
          codigoServicioVenta: inCod,
          tipoServicioVenta: inTipo,
          transportPrice: formatMoney(inboundSegmentNum),
        };
      }

      inboundPatch = {
        ...flow.inbound,
        selectedDeparture: inboundDepPatch,
        accommodation: inboundAccommodation,
      };
    }

    const transportPricingCanonical: BookingTransportPricingCanonical =
      flow.tripType === "round_trip"
        ? {
            pricingMode: rtSegmentVentilationReliable
              ? "round_trip_per_leg"
              : "round_trip_bundle",
            totalBundleEuros: rtSegmentVentilationReliable
              ? outboundBaseNum + inboundBaseNum
              : outboundBaseNum,
            outboundEuros: rtSegmentVentilationReliable ? outboundBaseNum : null,
            inboundEuros: rtSegmentVentilationReliable ? inboundBaseNum : null,
            segmentVentilationReliable: rtSegmentVentilationReliable,
          }
        : {
            pricingMode: "one_way",
            totalBundleEuros: outboundBaseNum,
            outboundEuros: outboundBaseNum,
            inboundEuros: null,
            segmentVentilationReliable: true,
          };

    const nextFlow: BookingFlow = {
      ...flow,
      outbound: {
        ...flow.outbound,
        selectedDeparture: outboundDepPatch,
        accommodation: outboundAccommodation,
      },
      inbound: inboundPatch,
      totals: {
        ...flow.totals,
        transportPricingCanonical,
        transportOutbound:
          flow.tripType === "round_trip"
            ? rtSegmentVentilationReliable
              ? formatMoney(outboundBaseNum)
              : ""
            : formatMoney(outboundBaseNum),
        transportInbound:
          flow.tripType === "round_trip"
            ? rtSegmentVentilationReliable
              ? formatMoney(inboundBaseNum)
              : ""
            : "",
        accommodationOutbound: formatMoney(outboundSupplementNum),
        accommodationInbound:
          flow.tripType === "round_trip"
            ? formatMoney(inboundSupplementNum)
            : "",
        finalTotal: formatMoney(finalTotal),
      },
    };

    setBookingFlow(nextFlow);
    router.push("/passagers");
  }

  function renderOfferSelector(
    direction: JourneyDirection,
    offers: BookingSalidaServiceOffer[],
    selectedKey: string,
    onSelect: (key: string) => void
  ) {
    const totalsByKey =
      direction === "outbound" ? outboundOptionTotals : inboundOptionTotals;
    const baseNum = direction === "outbound" ? outboundBaseNum : inboundBaseNum;
    const pricedOffers = offers.filter((offer) => {
      const n = totalsByKey[offerKey(offer)];
      return typeof n === "number" && n > 0;
    });

    const seats = pricedOffers.filter(
      (offer) => getCommercialKind(offer) === "seat"
    );
    const cabins = pricedOffers.filter(
      (offer) => getCommercialKind(offer) === "cabin"
    );
    const others = pricedOffers.filter((offer) => {
      const kind = getCommercialKind(offer);
      return kind !== "seat" && kind !== "cabin";
    });

    function renderGroup(
      title: string,
      subtitle: string,
      groupOffers: BookingSalidaServiceOffer[],
      badgeClass: string
    ) {
      if (groupOffers.length === 0) return null;
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-900">{title}</p>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}>
              {groupOffers.length} option{groupOffers.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid gap-3">
            {groupOffers.map((offer) => {
              const key = offerKey(offer);
              const isSelected = selectedKey === key;
              const totalNum = totalsByKey[key] ?? 0;
              const supplementNum = Math.max(0, totalNum - baseNum);
              const hasSupplement = supplementNum > 0;
              const priceBlockClass = isSelected
                ? "border-white/40 bg-white/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
                : "border-2 border-[#163B6D]/20 bg-gradient-to-br from-[#FFF7EE] via-white to-white text-slate-900 shadow-sm";
              const priceSubClass = isSelected
                ? "text-white/85"
                : "text-slate-600";
              return (
                <button
                  key={`${direction}-${key}`}
                  type="button"
                  onClick={() => onSelect(key)}
                  className={`w-full rounded-[24px] border p-4 text-left transition ${
                    isSelected
                      ? "border-[#163B6D] bg-[#163B6D] text-white ring-2 ring-[#163B6D]/30"
                      : "border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50/80"
                  }`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-between sm:gap-5">
                    <div className="min-w-0 flex-1">
                      <div
                        className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${
                          isSelected
                            ? "bg-white/15 text-white"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {getAccommodationOfferBadge(offer)}
                      </div>
                      <div className="mt-2 text-base font-bold leading-snug">
                        {getAccommodationOfferTitle(offer)}
                      </div>
                      <div
                        className={`mt-1 text-sm leading-relaxed ${
                          isSelected ? "text-white/85" : "text-slate-500"
                        }`}
                      >
                        {getAccommodationOfferDescription(offer)}
                      </div>
                      <div
                        className={`mt-2 text-xs font-medium ${
                          isSelected ? "text-white/75" : "text-slate-500"
                        }`}
                      >
                        Prix total : {formatMoney(totalNum)}
                      </div>
                    </div>
                    <div
                      className={`flex shrink-0 flex-col items-end justify-center rounded-2xl border px-4 py-3.5 text-right sm:min-w-[156px] ${priceBlockClass}`}
                    >
                      {hasSupplement ? (
                        <>
                          <span className="text-[1.65rem] font-extrabold leading-none tracking-tight">
                            + {formatMoney(supplementNum)}
                          </span>
                          <span
                            className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${priceSubClass}`}
                          >
                            Supplément
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-[1.65rem] font-extrabold leading-none tracking-tight">
                            Inclus
                          </span>
                          <span
                            className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${priceSubClass}`}
                          >
                            Sans supplément
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onSelect(BASE_INCLUDED_KEY)}
          className={`w-full rounded-[24px] border p-4 text-left transition ${
            selectedKey === BASE_INCLUDED_KEY
              ? "border-[#163B6D] bg-[#163B6D] text-white"
              : "border-slate-300 bg-white hover:bg-slate-50"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-base font-bold">
                Sans supplément hébergement
              </div>
              <div
                className={`mt-1 text-sm ${
                  selectedKey === BASE_INCLUDED_KEY
                    ? "text-white/85"
                    : "text-slate-500"
                }`}
              >
                Vous conservez uniquement le transport déjà choisi, sans siège premium ni cabine supplémentaire.
              </div>
              {baseNum > 0 ? (
                <div
                  className={`mt-2 text-xs font-medium ${
                    selectedKey === BASE_INCLUDED_KEY
                      ? "text-white/75"
                      : "text-slate-500"
                  }`}
                >
                  Prix total traversée : {formatMoney(baseNum)}
                </div>
              ) : null}
            </div>
            <div
              className={`flex shrink-0 flex-col items-end justify-center rounded-2xl border px-4 py-3 text-right sm:min-w-[148px] ${
                selectedKey === BASE_INCLUDED_KEY
                  ? "border-white/35 bg-white/10 text-white"
                  : "border-2 border-slate-200 bg-slate-50 text-slate-900"
              }`}
            >
              <span className="text-2xl font-extrabold leading-none tracking-tight">
                Inclus
              </span>
              <span
                className={`mt-2 text-[11px] font-semibold uppercase tracking-wide ${
                  selectedKey === BASE_INCLUDED_KEY
                    ? "text-white/80"
                    : "text-slate-500"
                }`}
              >
                Sans supplément
              </span>
            </div>
          </div>
        </button>

        {offers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Aucun service de confort ou d&apos;hébergement supplémentaire n&apos;est
            disponible pour cette traversée.
          </div>
        ) : pricedOffers.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            Traversée disponible, mais aucun tarif n&apos;a pu être affiché pour les
            options de confort de cette traversée.
          </div>
        ) : (
          <div className="space-y-6">
            {renderGroup(
              "Fauteuils",
              "Places assises disponibles et sièges premium.",
              seats,
              "bg-[#EEF4FB] text-[#163B6D]"
            )}
            {renderGroup(
              "Cabines",
              "Cabines privatives disponibles sur cette traversée.",
              cabins,
              "bg-[#FFF7EE] text-[#B45309]"
            )}
            {renderGroup(
              "Conforts",
              "Autres services compatibles avec votre traversée.",
              others,
              "bg-slate-100 text-slate-700"
            )}
          </div>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            Chargement de l’hébergement...
          </div>
        </section>
      </main>
    );
  }

  if (!flow || !flow.outbound.selectedDeparture) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
            Dossier incomplet. Merci de revenir à la sélection des traversées.
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="solair-hero pb-8 pt-5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="solair-stepbar mb-5">
            <span className="solair-stepchip solair-stepchip--done">
              1. Recherche
            </span>
            <span className="solair-stepchip solair-stepchip--done">
              2. Traversées et prix
            </span>
            <span className="solair-stepchip solair-stepchip--active">
              3. Hébergement
            </span>
            <span className="solair-stepchip solair-stepchip--pending">
              4. Passager
            </span>
            <span className="solair-stepchip solair-stepchip--pending">
              5. Récapitulatif
            </span>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
                Solair Voyages
              </p>
              <h1 className="mt-2 text-3xl font-bold text-white">
                Hébergement
              </h1>
              <p className="mt-2 text-sm text-white/85">
                Choisissez un siège premium ou une cabine uniquement parmi les
                options réellement proposées pour votre traversée. Le transport
                de base déjà sélectionné reste inclus.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="solair-secondary-btn px-4 py-3 text-sm font-semibold"
            >
              Retour
            </button>
          </div>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-7xl px-4">
          {outboundPriceError ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Aller : {outboundPriceError}
            </div>
          ) : null}
          {inboundPriceError ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Retour : {inboundPriceError}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <SectionCard
                title={getDirectionLabel("outbound", flow)}
                subtitle="Choisissez le niveau de confort souhaité pour l’aller"
              >
                <div className="mb-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Trajet
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {flow.outbound.selectedDeparture.origen} →{" "}
                      {flow.outbound.selectedDeparture.destino}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Départ
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {formatApiDate(flow.outbound.selectedDeparture.fechaSalida)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {formatApiTime(flow.outbound.selectedDeparture.horaSalida)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Bateau
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {flow.outbound.selectedDeparture.barco || "-"}
                    </p>
                  </div>

                  <div className="md:col-span-3 rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Transport de base
                        </p>
                        <p className="mt-1 text-lg font-bold text-slate-900">
                          {formatMoney(outboundBaseNum)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Supplément confort
                        </p>
                        <p className="mt-1 text-lg font-bold text-slate-900">
                          {formatMoney(outboundSupplementNum)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Sous-total aller
                        </p>
                        <p className="mt-1 text-lg font-bold text-slate-900">
                          {formatMoney(outboundSegmentNum)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {renderOfferSelector(
                  "outbound",
                  outboundOptions,
                  selectedOutboundKey,
                  setSelectedOutboundKey
                )}
              </SectionCard>

              {flow.tripType === "round_trip" && flow.inbound?.selectedDeparture && (
                <SectionCard
                  title={getDirectionLabel("inbound", flow)}
                  subtitle="Choisissez le niveau de confort souhaité pour le retour"
                >
                  <div className="mb-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Trajet
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {flow.inbound.selectedDeparture.origen} →{" "}
                        {flow.inbound.selectedDeparture.destino}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Départ
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {formatApiDate(flow.inbound.selectedDeparture.fechaSalida)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatApiTime(flow.inbound.selectedDeparture.horaSalida)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Bateau
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {flow.inbound.selectedDeparture.barco || "-"}
                      </p>
                    </div>

                    <div className="md:col-span-3 rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Transport de base
                          </p>
                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {formatMoney(inboundBaseNum)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Supplément confort
                          </p>
                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {formatMoney(inboundSupplementNum)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                            Sous-total retour
                          </p>
                          <p className="mt-1 text-lg font-bold text-slate-900">
                            {formatMoney(inboundSegmentNum)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {renderOfferSelector(
                    "inbound",
                    inboundOptions,
                    selectedInboundKey,
                    setSelectedInboundKey
                  )}
                </SectionCard>
              )}
            </div>

            <aside className="space-y-6">
              <SectionCard title="Synthèse" subtitle="Transport et suppléments confort">
                <div className="space-y-4">
                  <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                    <div className="flex items-start justify-between gap-4">
                      <span className="text-sm text-slate-500">
                        Transport de base (aller
                        {flow.tripType === "round_trip" ? " + retour" : ""})
                      </span>
                      <span className="text-right text-sm font-semibold text-slate-900">
                        {formatMoney(
                          outboundBaseNum +
                            (flow.tripType === "round_trip" ? inboundBaseNum : 0)
                        )}
                      </span>
                    </div>
                    <div className="mt-3 flex items-start justify-between gap-4">
                      <span className="text-sm text-slate-500">
                        Supplément confort (aller
                        {flow.tripType === "round_trip" ? " + retour" : ""})
                      </span>
                      <span className="text-right text-sm font-semibold text-slate-900">
                        {formatMoney(
                          outboundSupplementNum +
                            (flow.tripType === "round_trip"
                              ? inboundSupplementNum
                              : 0)
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#FFF7EE] p-5 ring-1 ring-[#F5D1A3]">
                    <p className="text-sm font-semibold text-slate-600">Total</p>
                    <p className="mt-2 text-4xl font-bold text-slate-900">
                      {formatMoney(finalTotal)}
                    </p>
                    {repricing ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Recalcul du tarif Armas…
                      </p>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={handleContinue}
                    disabled={!canContinue}
                    className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Continuer vers les voyageurs
                  </button>
                </div>
              </SectionCard>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
