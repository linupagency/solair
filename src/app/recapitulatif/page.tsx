"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getBookingFlow } from "@/lib/booking-flow-storage";
import type {
  BookingDraftPayload,
  BookingDraftSelectedDeparture,
} from "@/lib/booking-draft-store";
import {
  expandPassengerTipoList,
  getPrimaryPassengerType,
  getTipoPasajeroForPassengerIndex,
  type BookingFlow,
  type BookingTraveler,
  type BookingVehicleSelection,
} from "@/lib/booking-flow";
import {
  tryBuildTarificacionPostBodyFromFlow,
  type TarificacionCompanionCatalog,
} from "@/lib/armas/tarificacion-post-body";
import { fetchTransportPricing } from "@/lib/armas/transport-pricing-client";
import { isArmasRtPricingDebugEnabled } from "@/lib/armas/rt-pricing-debug";
import { getTarificacionRawLinesFromSoapResult } from "@/lib/armas/tarificacion-normalize";
import { getLegacyVehicleForPricingParam } from "@/lib/solair-legacy-vehicle-pricing";
import { getCommercialLabel } from "@/lib/ui/armas-commercial";

type PricingLine = {
  bonificacionEntidad?: {
    codigoBonificacion?: string;
    textoCorto?: string;
  };
  precioEntidad?: {
    total?: number | string;
  };
  tarifaEntidad?: {
    codigoTarifa?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
};

type DraftCreateResponse = {
  ok: boolean;
  message?: string;
  draftId?: string;
  missingFields?: string[];
  error?: string;
};

type PayPalCreateOrderResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  orderID?: string;
  approveUrl?: string;
};

type SegmentPricingState = {
  status: "idle" | "loading" | "success" | "error";
  totalValue?: number;
  totalDisplay?: string;
  codigoTarifa?: string;
  tarifaLabel?: string;
  bonificationLabel?: string;
  errorMessage?: string;
  roundTripBundleCombined?: boolean;
};

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeMoneyToNumber(value?: string | number | null): number | null {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  const raw = String(value)
    .replace("€", "")
    .replace(/\s/g, "")
    .replace(",", ".");

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatMoney(value?: string | number | null) {
  const parsed = normalizeMoneyToNumber(value);
  if (parsed === null) return "-";
  return `${parsed.toFixed(2).replace(".", ",")} €`;
}

function isSuccessPricing(state: SegmentPricingState) {
  return state.status === "success" && typeof state.totalValue === "number";
}

function formatApiDate(value?: string) {
  if (!value) return "-";

  if (value.length === 8 && /^\d{8}$/.test(value)) {
    return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
  }

  if (value.length === 10 && value.includes("-")) {
    const [yyyy, mm, dd] = value.split("-");
    if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
  }

  return value;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function serviceLabel(code?: string) {
  return getCommercialLabel({ codigoServicioVenta: code, tipoServicioVenta: "P" });
}

function passengerTypeLabel(code: string) {
  switch (code) {
    case "A":
      return "Adulte";
    case "J":
      return "Jeune";
    case "M":
      return "Senior";
    case "N":
      return "Enfant";
    case "B":
      return "Bébé";
    default:
      return code || "-";
  }
}

function documentTypeLabel(code: string) {
  switch (code) {
    case "P":
      return "Passeport";
    case "D":
      return "Document d'identité";
    case "T":
      return "Titre de résidence";
    default:
      return code || "-";
  }
}

function discountLabel(code: string, apiLabel?: string) {
  if (apiLabel) return apiLabel;

  switch (code) {
    case "G":
      return "Tarif général";
    case "R":
      return "Résident";
    case "R1":
      return "Résident + famille nombreuse générale";
    case "R2":
      return "Résident + famille nombreuse spéciale";
    case "F1":
      return "Famille nombreuse";
    case "F2":
      return "Famille nombreuse spéciale";
    default:
      return code || "-";
  }
}

function genderLabel(code: string) {
  switch (code) {
    case "M":
      return "Femme";
    case "H":
      return "Homme";
    default:
      return code || "-";
  }
}

function vehicleLabel(code: string) {
  switch (code) {
    case "small_tourism_car":
      return "Petite voiture de tourisme";
    case "large_tourism_car":
      return "Grande voiture de tourisme";
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
      return "Camping-car";
    case "moto":
      return "Moto";
    case "bike":
    case "bicycle":
      return "Vélo";
    case "none":
      return "Sans véhicule";
    case "car":
      return "Voiture";
    default:
      return code || "-";
  }
}

function normalizeTravelerBirthDate(value: string) {
  if (/^\d{8}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.replaceAll("-", "");
  return value.trim();
}

function getPassengerCount(flow: BookingFlow) {
  const counts = flow.search.passengers;
  return (
    counts.adults +
    counts.youth +
    counts.seniors +
    counts.children +
    counts.babies
  );
}

function getPrimaryVehicle(flow: BookingFlow): BookingVehicleSelection | undefined {
  return flow.search.vehicles.find((item) => item.quantity > 0);
}

function buildVehicleDataForDraft(vehicle?: BookingVehicleSelection) {
  if (!vehicle) return undefined;

  return {
    marque: vehicle.marque || "",
    modele: vehicle.modele || "",
    immatriculation: vehicle.immatriculation || "",
    conducteurIndex:
      typeof vehicle.driverPassengerIndex === "number"
        ? vehicle.driverPassengerIndex
        : 0,
  };
}

function normalizeArmasYYYYMMDD(value?: string | null): string {
  if (value == null) return "";
  const v = String(value).trim();
  if (/^\d{8}$/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.replaceAll("-", "");
  return v;
}

function buildInboundSelectedDepartureForDraft(
  flow: BookingFlow
): BookingDraftSelectedDeparture | null {
  const dep = flow.inbound?.selectedDeparture;
  if (!dep) return null;

  const origen = dep.origen?.trim() ?? "";
  const destino = dep.destino?.trim() ?? "";
  const fechaSalida = dep.fechaSalida?.trim() ?? "";
  const horaSalida = dep.horaSalida?.trim() ?? "";
  const codigoServicioVenta = dep.codigoServicioVenta?.trim() ?? "";
  const tipoServicioVenta = dep.tipoServicioVenta?.trim() ?? "";

  if (
    !origen ||
    !destino ||
    !fechaSalida ||
    !horaSalida ||
    !codigoServicioVenta ||
    !tipoServicioVenta
  ) {
    return null;
  }

  const row: BookingDraftSelectedDeparture = {
    origen,
    destino,
    fechaSalida,
    horaSalida,
    sentidoSalida: 2,
    codigoServicioVenta,
    tipoServicioVenta,
  };

  const barco = dep.barco?.trim();
  if (barco) row.barco = barco;
  const transportPrice = dep.transportPrice?.trim();
  if (transportPrice) row.transportPrice = transportPrice;

  return row;
}

function vehicleLineDataForDraft(v: BookingVehicleSelection) {
  return {
    marque: (v.marque || "").trim() || "NON RENSEIGNE",
    modele: (v.modele || "").trim() || "NON RENSEIGNE",
    immatriculation: (v.immatriculation || "").trim() || "NON RENSEIGNE",
    conducteurIndex:
      typeof v.driverPassengerIndex === "number" ? v.driverPassengerIndex : 0,
  };
}

function areTravelersComplete(
  travelers: BookingTraveler[],
  expectedCount: number
) {
  if (travelers.length !== expectedCount) return false;

  return travelers.every(
    (traveler) =>
      traveler.nombre.trim() &&
      traveler.apellido1.trim() &&
      traveler.fechaNacimiento.trim() &&
      traveler.codigoPais.trim() &&
      traveler.sexo.trim() &&
      traveler.tipoDocumento.trim() &&
      traveler.codigoDocumento.trim()
  );
}

function SectionCard({
  title,
  subtitle,
  children,
  variant = "panel",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  variant?: "panel" | "plain";
}) {
  return (
    <section
      className={
        variant === "panel" ? "solair-panel p-5 sm:p-6" : "px-1 py-1"
      }
    >
      <div className="mb-5">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}

const REAL_BOOKING_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_REAL_BOOKING === "true";

export default function RecapitulatifPage() {
  const router = useRouter();

  const [flow, setFlow] = useState<BookingFlow | null>(null);
  const [loadingFlow, setLoadingFlow] = useState(true);

  const [outboundPricing, setOutboundPricing] = useState<SegmentPricingState>({
    status: "idle",
  });
  const [inboundPricing, setInboundPricing] = useState<SegmentPricingState>({
    status: "idle",
  });

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState("");

  useEffect(() => {
    const currentFlow = getBookingFlow();
    setFlow(currentFlow);
    setLoadingFlow(false);
  }, []);

  useEffect(() => {
    async function loadSegmentPricing() {
      const currentFlow = flow;
      if (!currentFlow?.outbound.selectedDeparture) return;

      const safeFlow = currentFlow as BookingFlow;
      const outboundDeparture = safeFlow.outbound.selectedDeparture!;
      const selectedRtPricing = safeFlow.totals.selectedRoundTripPricing;
      if (
        safeFlow.tripType === "round_trip" &&
        safeFlow.inbound?.selectedDeparture &&
        selectedRtPricing &&
        selectedRtPricing.totalEuros > 0 &&
        selectedRtPricing.outboundSegment.origen === outboundDeparture.origen &&
        selectedRtPricing.outboundSegment.destino === outboundDeparture.destino &&
        selectedRtPricing.outboundSegment.fechaSalida === outboundDeparture.fechaSalida &&
        selectedRtPricing.outboundSegment.horaSalida === outboundDeparture.horaSalida &&
        selectedRtPricing.inboundSegment.origen ===
          safeFlow.inbound.selectedDeparture.origen &&
        selectedRtPricing.inboundSegment.destino ===
          safeFlow.inbound.selectedDeparture.destino &&
        selectedRtPricing.inboundSegment.fechaSalida ===
          safeFlow.inbound.selectedDeparture.fechaSalida &&
        selectedRtPricing.inboundSegment.horaSalida ===
          safeFlow.inbound.selectedDeparture.horaSalida
      ) {
        const hasLegSplit =
          selectedRtPricing.outboundEuros != null &&
          selectedRtPricing.inboundEuros != null &&
          Number.isFinite(selectedRtPricing.outboundEuros) &&
          Number.isFinite(selectedRtPricing.inboundEuros);
        const commonPricingMeta = {
          codigoTarifa: String(selectedRtPricing.codigoTarifa || "").trim(),
          tarifaLabel: String(selectedRtPricing.tarifaLabel || "").trim() || "-",
          bonificationLabel: String(
            selectedRtPricing.bonificationLabel || ""
          ).trim(),
        };
        if (hasLegSplit) {
          setOutboundPricing({
            status: "success",
            totalValue: selectedRtPricing.outboundEuros!,
            totalDisplay: formatMoney(selectedRtPricing.outboundEuros!),
            ...commonPricingMeta,
          });
          setInboundPricing({
            status: "success",
            totalValue: selectedRtPricing.inboundEuros!,
            totalDisplay: formatMoney(selectedRtPricing.inboundEuros!),
            ...commonPricingMeta,
          });
        } else {
          setOutboundPricing({
            status: "success",
            totalValue: selectedRtPricing.totalEuros,
            totalDisplay: formatMoney(selectedRtPricing.totalEuros),
            ...commonPricingMeta,
            roundTripBundleCombined: true,
          });
          setInboundPricing({
            status: "success",
            ...commonPricingMeta,
            roundTripBundleCombined: true,
          });
        }
        return;
      }

      const passengerCount = getPassengerCount(safeFlow);
      const primaryPassengerType = getPrimaryPassengerType(
        safeFlow.search.passengers
      );
      const passengerTipos = expandPassengerTipoList(safeFlow.search.passengers);

      async function fetchOneSegment(
        args: {
          origen: string;
          destino: string;
          fechaSalida: string;
          horaSalida: string;
          codigoServicioVenta: string;
          tipoServicioVenta: string;
        },
        catalog: TarificacionCompanionCatalog | undefined,
        armasLeg: "outbound" | "inbound"
      ): Promise<SegmentPricingState> {
        try {
          const built = tryBuildTarificacionPostBodyFromFlow(
            safeFlow,
            {
              origen: args.origen,
              destino: args.destino,
              fechaSalida: args.fechaSalida,
              horaSalida: args.horaSalida,
            },
            {
              cantidad: passengerCount,
              codigoServicioVenta: args.codigoServicioVenta,
              tipoServicioVenta: args.tipoServicioVenta,
              tipoPasajero: primaryPassengerType,
              passengerTipos,
            },
            catalog
          );

          if (!built.ok) {
            throw new Error(built.error);
          }

          const priced = await fetchTransportPricing(
            built.body,
            built.normalizedVehicle,
            safeFlow.tripType === "round_trip"
              ? { tripType: "round_trip", armasLeg }
              : undefined
          );

          if (!priced.ok) {
            throw new Error(priced.error);
          }

          const totalValue = priced.totalEuros;
          if (totalValue === null) {
            throw new Error("Aucune tarification retournée.");
          }

          const lines = normalizeArray(
            getTarificacionRawLinesFromSoapResult(priced.soapData) as PricingLine[]
          );
          const first = lines[0];

          return {
            status: "success",
            totalValue,
            totalDisplay: formatMoney(totalValue),
            codigoTarifa: first?.tarifaEntidad?.codigoTarifa || "",
            tarifaLabel: first?.tarifaEntidad?.textoCorto || "-",
            bonificationLabel: first?.bonificacionEntidad?.textoCorto || "",
          };
        } catch (error) {
          return {
            status: "error",
            errorMessage:
              error instanceof Error ? error.message : "Erreur inconnue.",
          };
        }
      }

      async function fetchRoundTripSegments(
        outboundCatalog?: TarificacionCompanionCatalog,
        inboundCatalog?: TarificacionCompanionCatalog
      ): Promise<{
        outbound: SegmentPricingState;
        inbound: SegmentPricingState;
      }> {
        if (
          safeFlow.tripType !== "round_trip" ||
          !safeFlow.outbound.selectedDeparture ||
          !safeFlow.inbound?.selectedDeparture
        ) {
          throw new Error("Dossier aller-retour incomplet.");
        }

        const outboundDep = safeFlow.outbound.selectedDeparture!;
        const inboundDep = safeFlow.inbound.selectedDeparture!;

        const outBuilt = tryBuildTarificacionPostBodyFromFlow(
          safeFlow,
          {
            origen: outboundDep.origen,
            destino: outboundDep.destino,
            fechaSalida: outboundDep.fechaSalida,
            horaSalida: outboundDep.horaSalida,
          },
          {
            cantidad: passengerCount,
            codigoServicioVenta: outboundDep.codigoServicioVenta,
            tipoServicioVenta: outboundDep.tipoServicioVenta,
            tipoPasajero: primaryPassengerType,
            passengerTipos,
          },
          outboundCatalog
        );
        if (!outBuilt.ok) {
          throw new Error(outBuilt.error);
        }

        const inBuilt = tryBuildTarificacionPostBodyFromFlow(
          safeFlow,
          {
            origen: inboundDep.origen,
            destino: inboundDep.destino,
            fechaSalida: inboundDep.fechaSalida,
            horaSalida: inboundDep.horaSalida,
          },
          {
            cantidad: passengerCount,
            codigoServicioVenta: inboundDep.codigoServicioVenta,
            tipoServicioVenta: inboundDep.tipoServicioVenta,
            tipoPasajero: primaryPassengerType,
            passengerTipos,
          },
          inboundCatalog
        );
        if (!inBuilt.ok) {
          throw new Error(inBuilt.error);
        }

        const priced = await fetchTransportPricing(
          outBuilt.body,
          outBuilt.normalizedVehicle,
          {
            tripType: "round_trip",
            armasLeg: "outbound",
            returnSegment: {
              origen: inBuilt.body.origen,
              destino: inBuilt.body.destino,
              fechaSalida: inBuilt.body.fechaSalida,
              horaSalida: inBuilt.body.horaSalida,
              codigoServicioVenta: inBuilt.body.codigoServicioVenta,
              tipoServicioVenta: inBuilt.body.tipoServicioVenta,
              sentidoSalida: 2,
            },
          }
        );

        if (!priced.ok) {
          throw new Error(priced.error);
        }

        const bundle = priced.roundTripTotalEuros ?? priced.totalEuros ?? null;
        if (bundle === null || !Number.isFinite(bundle) || bundle <= 0) {
          throw new Error("Aucun total aller-retour exploitable.");
        }

        const lines = normalizeArray(
          getTarificacionRawLinesFromSoapResult(priced.soapData) as PricingLine[]
        );
        const first = lines[0];
        const common = {
          codigoTarifa: first?.tarifaEntidad?.codigoTarifa || "",
          tarifaLabel: first?.tarifaEntidad?.textoCorto || "-",
          bonificationLabel: first?.bonificacionEntidad?.textoCorto || "",
        };

        const segmentVentilationReliable =
          priced.segmentVentilationReliable === true;

        if (segmentVentilationReliable) {
          const outboundTotal = priced.outboundEuros;
          const inboundTotal = priced.returnEuros;

          if (
            outboundTotal === null ||
            inboundTotal === null ||
            !Number.isFinite(outboundTotal) ||
            !Number.isFinite(inboundTotal)
          ) {
            throw new Error("Aucune ventilation AR ida/vta exploitable.");
          }

          return {
            outbound: {
              status: "success",
              totalValue: outboundTotal,
              totalDisplay: formatMoney(outboundTotal),
              ...common,
            },
            inbound: {
              status: "success",
              totalValue: inboundTotal,
              totalDisplay: formatMoney(inboundTotal),
              ...common,
            },
          };
        }

        return {
          outbound: {
            status: "success",
            totalValue: bundle,
            totalDisplay: formatMoney(bundle),
            ...common,
            roundTripBundleCombined: true,
          },
          inbound: {
            status: "success",
            totalValue: undefined,
            totalDisplay: undefined,
            ...common,
            roundTripBundleCombined: true,
          },
        };
      }

      setOutboundPricing({ status: "loading" });
      setInboundPricing(
        safeFlow.tripType === "round_trip"
          ? { status: "loading" }
          : { status: "idle" }
      );

      if (
        safeFlow.tripType === "round_trip" &&
        safeFlow.inbound?.selectedDeparture
      ) {
        try {
          const both = await fetchRoundTripSegments(
            safeFlow.outbound.availableServices?.length
              ? { serviciosVentas: safeFlow.outbound.availableServices }
              : undefined,
            safeFlow.inbound?.availableServices?.length
              ? { serviciosVentas: safeFlow.inbound.availableServices }
              : undefined
          );

          setOutboundPricing(both.outbound);
          setInboundPricing(both.inbound);
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Erreur de tarification AR.";
          setOutboundPricing({ status: "error", errorMessage: msg });
          setInboundPricing({ status: "error", errorMessage: msg });
        }
        return;
      }

      const outbound = await fetchOneSegment(
        {
          origen: outboundDeparture.origen,
          destino: outboundDeparture.destino,
          fechaSalida: outboundDeparture.fechaSalida,
          horaSalida: outboundDeparture.horaSalida,
          codigoServicioVenta: outboundDeparture.codigoServicioVenta,
          tipoServicioVenta: outboundDeparture.tipoServicioVenta,
        },
        safeFlow.outbound.availableServices?.length
          ? { serviciosVentas: safeFlow.outbound.availableServices }
          : undefined,
        "outbound"
      );

      setOutboundPricing(outbound);

      if (safeFlow.tripType === "round_trip" && safeFlow.inbound?.selectedDeparture) {
        const inboundDeparture = safeFlow.inbound.selectedDeparture!;

        const inbound = await fetchOneSegment(
          {
            origen: inboundDeparture.origen,
            destino: inboundDeparture.destino,
            fechaSalida: inboundDeparture.fechaSalida,
            horaSalida: inboundDeparture.horaSalida,
            codigoServicioVenta: inboundDeparture.codigoServicioVenta,
            tipoServicioVenta: inboundDeparture.tipoServicioVenta,
          },
          safeFlow.inbound.availableServices?.length
            ? { serviciosVentas: safeFlow.inbound.availableServices }
            : undefined,
          "inbound"
        );

        setInboundPricing(inbound);
      }
    }

    loadSegmentPricing();
  }, [flow]);

  const passengerCount = useMemo(() => {
    return flow ? getPassengerCount(flow) : 0;
  }, [flow]);

  const travelersComplete = useMemo(() => {
    if (!flow) return false;
    return areTravelersComplete(flow.travelers, passengerCount);
  }, [flow, passengerCount]);

  const outboundAccommodationValue = useMemo(() => {
    return normalizeMoneyToNumber(flow?.outbound.accommodation?.price) ?? 0;
  }, [flow]);

  const inboundAccommodationValue = useMemo(() => {
    return normalizeMoneyToNumber(flow?.inbound?.accommodation?.price) ?? 0;
  }, [flow]);

  const finalTotalFromFlow = useMemo(
    () => normalizeMoneyToNumber(flow?.totals.finalTotal),
    [flow?.totals.finalTotal]
  );

  const hasPricedFlowTotals = useMemo(() => {
    return finalTotalFromFlow !== null && finalTotalFromFlow > 0;
  }, [finalTotalFromFlow]);

  const freshPricingReady = useMemo(() => {
    if (!flow) return false;

    if (flow.tripType === "round_trip") {
      if (
        outboundPricing.status === "success" &&
        outboundPricing.roundTripBundleCombined === true
      ) {
        return true;
      }

      return isSuccessPricing(outboundPricing) && isSuccessPricing(inboundPricing);
    }

    return isSuccessPricing(outboundPricing);
  }, [flow, outboundPricing, inboundPricing]);

  const transportTotal = useMemo(() => {
    if (!flow) return 0;

    if (freshPricingReady) {
      if (
        flow.tripType === "round_trip" &&
        outboundPricing.roundTripBundleCombined === true
      ) {
        return outboundPricing.totalValue ?? 0;
      }

      const outbound = outboundPricing.totalValue ?? 0;
      const inbound =
        flow.tripType === "round_trip" ? inboundPricing.totalValue ?? 0 : 0;

      return flow.tripType === "round_trip" ? outbound + inbound : outbound;
    }

    const canonical = flow.totals.transportPricingCanonical;

    if (canonical && flow.tripType === "round_trip") {
      if (
        canonical.segmentVentilationReliable &&
        canonical.outboundEuros != null &&
        canonical.inboundEuros != null
      ) {
        return canonical.outboundEuros + canonical.inboundEuros;
      }

      return canonical.totalBundleEuros;
    }

    if (canonical && flow.tripType === "one_way") {
      return canonical.totalBundleEuros;
    }

    if (hasPricedFlowTotals) {
      const outbound = normalizeMoneyToNumber(flow.totals.transportOutbound) ?? 0;
      const inbound =
        flow.tripType === "round_trip"
          ? normalizeMoneyToNumber(flow.totals.transportInbound) ?? 0
          : 0;

      return outbound + inbound;
    }

    return 0;
  }, [
    flow,
    freshPricingReady,
    outboundPricing.totalValue,
    outboundPricing.roundTripBundleCombined,
    inboundPricing.totalValue,
    hasPricedFlowTotals,
  ]);

  const roundTripTransportBundleDisplay = useMemo(() => {
    if (!flow || flow.tripType !== "round_trip") return false;

    if (freshPricingReady) {
      return outboundPricing.roundTripBundleCombined === true;
    }

    const canonical = flow.totals.transportPricingCanonical;
    if (canonical) return !canonical.segmentVentilationReliable;

    return false;
  }, [
    flow,
    freshPricingReady,
    outboundPricing.roundTripBundleCombined,
  ]);

  const accommodationTotal = useMemo(() => {
    if (hasPricedFlowTotals) {
      const ob =
        normalizeMoneyToNumber(flow?.totals.accommodationOutbound) ??
        outboundAccommodationValue;
      const ib =
        flow?.tripType === "round_trip"
          ? normalizeMoneyToNumber(flow?.totals.accommodationInbound) ??
            inboundAccommodationValue
          : 0;
      return ob + ib;
    }
    return outboundAccommodationValue + inboundAccommodationValue;
  }, [
    hasPricedFlowTotals,
    flow?.totals.accommodationOutbound,
    flow?.totals.accommodationInbound,
    flow?.tripType,
    outboundAccommodationValue,
    inboundAccommodationValue,
  ]);

  const finalTotal = useMemo(() => {
    if (freshPricingReady) {
      return transportTotal + accommodationTotal;
    }

    if (hasPricedFlowTotals && finalTotalFromFlow !== null) {
      return finalTotalFromFlow;
    }

    return transportTotal + accommodationTotal;
  }, [
    freshPricingReady,
    hasPricedFlowTotals,
    finalTotalFromFlow,
    transportTotal,
    accommodationTotal,
  ]);

  useEffect(() => {
    if (!isArmasRtPricingDebugEnabled()) return;
    if (!flow) return;
    if (outboundPricing.status !== "success") return;
    if (
      flow.tripType === "round_trip" &&
      inboundPricing.status !== "success" &&
      outboundPricing.roundTripBundleCombined !== true
    ) {
      return;
    }

    console.info(
      "[SOLAIR_ARMAS_RT_PRICING_DEBUG] recap.displayAndPayment",
      JSON.stringify(
        {
          tripType: flow.tripType,
          transportOutboundEuros: outboundPricing.totalValue ?? null,
          transportInboundEuros:
            flow.tripType === "round_trip"
              ? inboundPricing.totalValue ?? null
              : null,
          transportSumEuros: transportTotal,
          accommodationSumEuros: accommodationTotal,
          finalTotalDisplayedEuros: finalTotal,
          paypalAndDraftAmountString: finalTotal.toFixed(2),
        },
        null,
        0
      )
    );
  }, [
    flow,
    outboundPricing.status,
    outboundPricing.totalValue,
    outboundPricing.roundTripBundleCombined,
    inboundPricing.status,
    inboundPricing.totalValue,
    transportTotal,
    accommodationTotal,
    finalTotal,
  ]);

  const paymentSupported = useMemo(() => {
    if (!flow || !travelersComplete) return false;
    if (!Number.isFinite(finalTotal) || finalTotal <= 0) return false;

    if (outboundPricing.status !== "success" || !outboundPricing.codigoTarifa) {
      return false;
    }

    if (flow.tripType === "round_trip") {
      if (roundTripTransportBundleDisplay) {
        return true;
      }

      if (inboundPricing.status !== "success" || !inboundPricing.codigoTarifa) {
        return false;
      }
    }

    return true;
  }, [
    flow,
    travelersComplete,
    finalTotal,
    outboundPricing.status,
    outboundPricing.codigoTarifa,
    inboundPricing.status,
    inboundPricing.codigoTarifa,
    roundTripTransportBundleDisplay,
  ]);

  async function handleProceedToPayment() {
    const currentFlow = flow;

    if (!currentFlow?.outbound.selectedDeparture) return;
    if (!paymentSupported) return;

    const safeFlow = currentFlow as BookingFlow;
    const outboundSelectedDeparture = safeFlow.outbound.selectedDeparture!;

    const firstTraveler = safeFlow.travelers[0];
    if (!firstTraveler) {
      setPaymentError("Aucun voyageur exploitable pour le paiement.");
      return;
    }

    if (!Number.isFinite(finalTotal) || finalTotal <= 0) {
      setPaymentError("Montant total invalide pour le paiement.");
      return;
    }

    try {
      setPaymentLoading(true);
      setPaymentError("");

      const primaryVehicle = getPrimaryVehicle(safeFlow);
      const legacyVehicle = getLegacyVehicleForPricingParam(safeFlow);
      const vehicleData = buildVehicleDataForDraft(primaryVehicle);

      const vehiclesList: BookingDraftPayload["vehiclesList"] =
        safeFlow.search.vehicles.some((v) => v.quantity > 0)
          ? safeFlow.search.vehicles
              .filter((v) => v.quantity > 0)
              .map((v) => ({
                vehicle:
                  v.category === "camper"
                    ? "camper"
                    : v.category === "moto" ||
                        v.category === "bike" ||
                        v.category === "bicycle"
                      ? "moto"
                      : "car",
                vehicleCategory: v.category,
                vehicleData: vehicleLineDataForDraft(v),
              }))
          : undefined;

      const rootTipoPasajero =
        (firstTraveler.tipoPasajero || "").trim() ||
        getPrimaryPassengerType(safeFlow.search.passengers) ||
        "A";

      const passengersData = safeFlow.travelers.map((traveler, index) => ({
        nombre: traveler.nombre.trim(),
        apellido1: traveler.apellido1.trim(),
        apellido2: (traveler.apellido2 ?? "").trim(),
        fechaNacimiento: normalizeTravelerBirthDate(traveler.fechaNacimiento),
        codigoPais: traveler.codigoPais.trim(),
        sexo: traveler.sexo.trim(),
        tipoDocumento: traveler.tipoDocumento.trim(),
        codigoDocumento: traveler.codigoDocumento.trim(),
        tipoPasajero:
          (traveler.tipoPasajero || "").trim() ||
          getTipoPasajeroForPassengerIndex(
            safeFlow.search.passengers,
            index
          ) ||
          "A",
      }));

      const outboundHebergementSupplement =
        normalizeMoneyToNumber(safeFlow.totals.accommodationOutbound) ??
        outboundAccommodationValue;

      const inboundHebergementSupplement =
        normalizeMoneyToNumber(safeFlow.totals.accommodationInbound) ??
        inboundAccommodationValue;

      const inboundDepartureDraft = buildInboundSelectedDepartureForDraft(
        safeFlow
      );

      const fechaVueltaDraft =
        safeFlow.tripType === "round_trip"
          ? normalizeArmasYYYYMMDD(
              safeFlow.inbound?.selectedDeparture?.fechaSalida ||
                safeFlow.search.fechaVuelta
            )
          : "";

      const draftBody: BookingDraftPayload = {
        origen: outboundSelectedDeparture.origen.trim(),
        destino: outboundSelectedDeparture.destino.trim(),
        fechaSalida: outboundSelectedDeparture.fechaSalida.trim(),
        horaSalida: outboundSelectedDeparture.horaSalida.trim(),
        codigoServicioVenta:
          outboundSelectedDeparture.codigoServicioVenta.trim(),
        tipoServicioVenta: outboundSelectedDeparture.tipoServicioVenta.trim(),
        passengers: String(passengerCount),
        vehicle: legacyVehicle,
        nombre: firstTraveler.nombre.trim(),
        apellido1: firstTraveler.apellido1.trim(),
        apellido2: (firstTraveler.apellido2 ?? "").trim(),
        fechaNacimiento: normalizeTravelerBirthDate(
          firstTraveler.fechaNacimiento
        ),
        codigoPais: firstTraveler.codigoPais.trim(),
        sexo: firstTraveler.sexo.trim(),
        codigoDocumento: firstTraveler.codigoDocumento.trim(),
        tipoPasajero: rootTipoPasajero,
        bonificacion: (safeFlow.search.bonificacion || "").trim() || "G",
        tipoDocumento: firstTraveler.tipoDocumento.trim(),
        mail: safeFlow.contact.mail.trim(),
        telefono: safeFlow.contact.telefono.trim(),
        total: finalTotal.toFixed(2),
        codigoTarifa: (outboundPricing.codigoTarifa || "").trim(),
        passengersData,
        hebergementType: (safeFlow.outbound.accommodation?.code || "").trim(),
        hebergementLabel: (safeFlow.outbound.accommodation?.label || "").trim(),
        hebergementPrice: outboundHebergementSupplement.toFixed(2),
        tripType: safeFlow.tripType,
        fechaVuelta: fechaVueltaDraft,
        animalsCount: String(
          safeFlow.search.animals.enabled ? safeFlow.search.animals.count : 0
        ),
        inboundSelectedDeparture: inboundDepartureDraft,
        inboundAccommodation:
          safeFlow.tripType === "round_trip" && safeFlow.inbound?.accommodation
            ? {
                code: safeFlow.inbound.accommodation.code.trim(),
                label: safeFlow.inbound.accommodation.label.trim(),
                price: inboundHebergementSupplement.toFixed(2),
                ...(safeFlow.inbound.accommodation.details?.trim()
                  ? {
                      details: safeFlow.inbound.accommodation.details.trim(),
                    }
                  : {}),
              }
            : null,
        inboundCodigoTarifa:
          safeFlow.tripType === "round_trip"
            ? (inboundPricing.codigoTarifa || "").trim()
            : "",
        vehicleCategory:
          legacyVehicle !== "none"
            ? primaryVehicle?.category ||
              vehiclesList?.[0]?.vehicleCategory ||
              "small_tourism_car"
            : undefined,
        vehicleData:
          legacyVehicle !== "none" &&
          (!vehiclesList || vehiclesList.length === 0)
            ? vehicleData
            : undefined,
        vehiclesList,
      };

      if (isArmasRtPricingDebugEnabled()) {
        console.info(
          "[AR_SENTIDO_CHECK] recap.draftPayload",
          JSON.stringify(
            {
              tripType: draftBody.tripType,
              outboundSentidoSalida: 1,
              inboundSentidoSalida:
                draftBody.tripType === "round_trip"
                  ? draftBody.inboundSelectedDeparture?.sentidoSalida ?? null
                  : null,
              outbound: {
                origen: draftBody.origen,
                destino: draftBody.destino,
                fechaSalida: draftBody.fechaSalida,
                horaSalida: draftBody.horaSalida,
              },
              inbound:
                draftBody.tripType === "round_trip"
                  ? draftBody.inboundSelectedDeparture
                  : null,
            },
            null,
            0
          )
        );
      }

      const draftResponse = await fetch("/api/booking/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draftBody),
      });

      const draftJson: DraftCreateResponse = await draftResponse.json();

      if (!draftResponse.ok || !draftJson.ok || !draftJson.draftId) {
        const missing = draftJson.missingFields;
        if (Array.isArray(missing) && missing.length > 0) {
          throw new Error(`Paramètres manquants : ${missing.join(", ")}`);
        }
        throw new Error(
          draftJson.error ||
            draftJson.message ||
            "Impossible de créer le draft de réservation."
        );
      }

      const paypalResponse = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: String(finalTotal.toFixed(2)),
          currency: "EUR",
          draftId: draftJson.draftId,
          description: `Traversée ${outboundSelectedDeparture.origen} → ${outboundSelectedDeparture.destino}`,
        }),
      });

      const paypalJson: PayPalCreateOrderResponse = await paypalResponse.json();

      if (!paypalResponse.ok || !paypalJson.ok || !paypalJson.approveUrl) {
        throw new Error(
          paypalJson.error ||
            paypalJson.message ||
            "Impossible de créer la commande PayPal."
        );
      }

      window.location.href = paypalJson.approveUrl;
    } catch (error) {
      setPaymentError(
        error instanceof Error
          ? error.message
          : "Erreur inconnue pendant l’initialisation du paiement."
      );
      setPaymentLoading(false);
    }
  }

  if (loadingFlow) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            Chargement du récapitulatif...
          </div>
        </section>
      </main>
    );
  }

  if (!flow?.outbound.selectedDeparture) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
            Dossier incomplet. Merci de revenir au début du parcours.
          </div>
        </section>
      </main>
    );
  }

  const bookingFlow = flow as BookingFlow;
  const outboundSelectedDeparture = bookingFlow.outbound.selectedDeparture!;
  const inboundSelectedDeparture = bookingFlow.inbound?.selectedDeparture ?? null;

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_10%_16%,rgb(44_166_164/0.24),transparent_17rem),radial-gradient(circle_at_88%_8%,rgb(242_140_40/0.3),transparent_18rem),radial-gradient(circle_at_78%_0%,rgb(217_74_58/0.2),transparent_14rem),linear-gradient(135deg,#102D54_0%,#163B6D_56%,#235392_100%)] pb-8 pt-5">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-5 flex gap-2.5 overflow-x-auto pb-[0.35rem] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              1. Recherche
            </span>
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              2. Traversées et prix
            </span>
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              3. Hébergement
            </span>
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              4. Passager
            </span>
            <span className="flex-none rounded-full bg-[linear-gradient(135deg,#F28C28,#F7A744)] px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white shadow-[0_12px_28px_rgba(242,140,40,0.34)]">
              5. Récapitulatif
            </span>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
                Solair Voyages
              </p>
              <h1 className="mt-2 text-3xl font-bold text-white">
                Récapitulatif de votre traversée
              </h1>
              <p className="mt-2 text-sm text-white/85">
                Vérifiez les voyageurs, les véhicules et le prix avant paiement.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="inline-flex justify-center rounded-2xl border border-white/25 bg-white/12 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-px hover:bg-white/18"
            >
              Retour
            </button>
          </div>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-7xl px-4">
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-6">
              <SectionCard
                title="Traversée"
                subtitle="Résumé des segments sélectionnés."
                variant="plain"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Aller
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {outboundSelectedDeparture.origen} → {outboundSelectedDeparture.destino}
                    </p>
                    <p className="text-sm text-slate-600">
                      {formatApiDate(outboundSelectedDeparture.fechaSalida)} •{" "}
                      {formatApiTime(outboundSelectedDeparture.horaSalida)}
                    </p>
                    <p className="text-sm text-slate-600">
                      {serviceLabel(outboundSelectedDeparture.codigoServicioVenta)}
                    </p>
                    <p className="text-sm text-slate-600">
                      Hébergement : {bookingFlow.outbound.accommodation?.label || "-"}
                    </p>
                  </div>

                  {bookingFlow.tripType === "round_trip" && inboundSelectedDeparture ? (
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Retour
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {inboundSelectedDeparture.origen} → {inboundSelectedDeparture.destino}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatApiDate(inboundSelectedDeparture.fechaSalida)} •{" "}
                        {formatApiTime(inboundSelectedDeparture.horaSalida)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {serviceLabel(inboundSelectedDeparture.codigoServicioVenta)}
                      </p>
                      <p className="text-sm text-slate-600">
                        Hébergement : {bookingFlow.inbound?.accommodation?.label || "-"}
                      </p>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              <SectionCard
                title="Voyageurs"
                subtitle="Identités utilisées pour la réservation."
                variant="plain"
              >
                <div className="space-y-4">
                  {bookingFlow.travelers.map((traveler, index) => {
                    const fullName = [
                      traveler.nombre,
                      traveler.apellido1,
                      traveler.apellido2,
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <div
                        key={index}
                        className="rounded-2xl bg-[#F3F6F7] p-4"
                      >
                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Voyageur {index + 1}
                            </p>
                            <p className="mt-2 text-lg font-bold text-slate-900">
                              {fullName || "-"}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              {passengerTypeLabel(
                                traveler.tipoPasajero ||
                                  getTipoPasajeroForPassengerIndex(
                                    bookingFlow.search.passengers,
                                    index
                                  ) ||
                                  getPrimaryPassengerType(bookingFlow.search.passengers)
                              )}
                            </p>
                          </div>

                          <div className="md:text-right">
                            <p className="text-sm font-semibold text-slate-900">
                              {documentTypeLabel(traveler.tipoDocumento)}
                            </p>
                            <p className="mt-1 break-all text-sm text-slate-600">
                              {traveler.codigoDocumento || "-"}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">
                              {formatApiDate(traveler.fechaNacimiento)} •{" "}
                              {genderLabel(traveler.sexo)} • {traveler.codigoPais || "-"}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              {bookingFlow.search.vehicles.length > 0 && (
                <SectionCard
                  title="Véhicules"
                  subtitle="Informations associées au dossier."
                  variant="plain"
                >
                  <div className="space-y-4">
                    {bookingFlow.search.vehicles.map((vehicle, index) => (
                      <div
                        key={`${vehicle.category}-${index}`}
                        className="rounded-2xl bg-[#F3F6F7] p-4"
                      >
                        <div className="grid gap-4 md:grid-cols-4">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Catégorie
                            </p>
                            <p className="mt-2 text-base font-bold text-slate-900">
                              {vehicle.label || vehicleLabel(vehicle.category)}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Marque
                            </p>
                            <p className="mt-2 text-base font-bold text-slate-900">
                              {vehicle.marque || "-"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Modèle
                            </p>
                            <p className="mt-2 text-base font-bold text-slate-900">
                              {vehicle.modele || "-"}
                            </p>
                          </div>

                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                              Immatriculation
                            </p>
                            <p className="mt-2 text-base font-bold text-slate-900">
                              {vehicle.immatriculation || "-"}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              )}

              <SectionCard
                title="Contact principal"
                subtitle="Coordonnées utilisées pour le suivi."
                variant="plain"
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </p>
                    <p className="mt-2 break-all text-lg font-bold text-slate-900">
                      {bookingFlow.contact.mail || "-"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Téléphone
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {bookingFlow.contact.telefono || "-"}
                    </p>
                  </div>
                </div>
              </SectionCard>
            </div>

            <aside className="space-y-6">
              <SectionCard
                title="Prix"
                subtitle="Recalculé avant paiement."
              >
                <div className="space-y-4">
                  {outboundPricing.status === "loading" && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      Recalcul du prix en cours...
                    </div>
                  )}

                  {outboundPricing.status === "error" && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {outboundPricing.errorMessage || "Erreur de tarification aller."}
                    </div>
                  )}

                  {bookingFlow.tripType === "round_trip" &&
                    inboundPricing.status === "error" && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                        {inboundPricing.errorMessage || "Erreur de tarification retour."}
                      </div>
                    )}

                  <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                    {bookingFlow.tripType === "round_trip" &&
                    roundTripTransportBundleDisplay ? (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-sm text-slate-500">
                            Forfait transport aller-retour
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">
                            {formatMoney(
                              bookingFlow.totals.transportPricingCanonical
                                ?.totalBundleEuros ??
                                outboundPricing.totalValue ??
                                transportTotal
                            )}
                          </span>
                        </div>

                        <div className="mt-3 flex items-start justify-between gap-4">
                          <span className="text-sm text-slate-500">
                            Supplément hébergement aller
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">
                            {hasPricedFlowTotals
                              ? bookingFlow.totals.accommodationOutbound ||
                                formatMoney(outboundAccommodationValue)
                              : formatMoney(outboundAccommodationValue)}
                          </span>
                        </div>

                        <div className="mt-3 flex items-start justify-between gap-4">
                          <span className="text-sm text-slate-500">
                            Supplément hébergement retour
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">
                            {hasPricedFlowTotals
                              ? bookingFlow.totals.accommodationInbound ||
                                formatMoney(inboundAccommodationValue)
                              : formatMoney(inboundAccommodationValue)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-sm text-slate-500">
                            Transport aller
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">
                            {bookingFlow.totals.transportPricingCanonical &&
                            bookingFlow.tripType === "round_trip" &&
                            bookingFlow.totals.transportPricingCanonical
                              .segmentVentilationReliable &&
                            bookingFlow.totals.transportPricingCanonical
                              .outboundEuros != null
                              ? formatMoney(
                                  bookingFlow.totals.transportPricingCanonical
                                    .outboundEuros
                                )
                              : bookingFlow.totals.transportPricingCanonical &&
                                  bookingFlow.tripType === "one_way"
                                ? formatMoney(
                                    bookingFlow.totals.transportPricingCanonical
                                      .totalBundleEuros
                                  )
                                : hasPricedFlowTotals
                                  ? bookingFlow.totals.transportOutbound || "-"
                                  : outboundPricing.totalDisplay ||
                                    bookingFlow.totals.transportOutbound ||
                                    "-"}
                          </span>
                        </div>

                        <div className="mt-3 flex items-start justify-between gap-4">
                          <span className="text-sm text-slate-500">
                            Supplément hébergement aller
                          </span>
                          <span className="text-right text-sm font-semibold text-slate-900">
                            {hasPricedFlowTotals
                              ? bookingFlow.totals.accommodationOutbound ||
                                formatMoney(outboundAccommodationValue)
                              : formatMoney(outboundAccommodationValue)}
                          </span>
                        </div>

                        {bookingFlow.tripType === "round_trip" && (
                          <>
                            <div className="mt-3 flex items-start justify-between gap-4">
                              <span className="text-sm text-slate-500">
                                Transport retour
                              </span>
                              <span className="text-right text-sm font-semibold text-slate-900">
                                {bookingFlow.totals.transportPricingCanonical &&
                                bookingFlow.totals.transportPricingCanonical
                                  .segmentVentilationReliable &&
                                bookingFlow.totals.transportPricingCanonical
                                  .inboundEuros != null
                                  ? formatMoney(
                                      bookingFlow.totals.transportPricingCanonical
                                        .inboundEuros
                                    )
                                  : hasPricedFlowTotals
                                    ? bookingFlow.totals.transportInbound || "-"
                                    : inboundPricing.totalDisplay ||
                                      bookingFlow.totals.transportInbound ||
                                      "-"}
                              </span>
                            </div>

                            <div className="mt-3 flex items-start justify-between gap-4 border-t border-[#CDE4F7] pt-3">
                              <span className="text-sm font-semibold text-slate-700">
                                Total transport (aller + retour)
                              </span>
                              <span className="text-right text-sm font-bold text-slate-900">
                                {formatMoney(transportTotal)}
                              </span>
                            </div>

                            <div className="mt-3 flex items-start justify-between gap-4">
                              <span className="text-sm text-slate-500">
                                Supplément hébergement retour
                              </span>
                              <span className="text-right text-sm font-semibold text-slate-900">
                                {hasPricedFlowTotals
                                  ? bookingFlow.totals.accommodationInbound ||
                                    formatMoney(inboundAccommodationValue)
                                  : formatMoney(inboundAccommodationValue)}
                              </span>
                            </div>
                          </>
                        )}
                      </>
                    )}

                    <div className="mt-3 flex items-start justify-between gap-4">
                      <span className="text-sm text-slate-500">Bonification</span>
                      <span className="text-right text-sm font-semibold text-slate-900">
                        {discountLabel(
                          bookingFlow.search.bonificacion,
                          outboundPricing.bonificationLabel ||
                            bookingFlow.search.bonificacionLabel
                        )}
                      </span>
                    </div>

                    <div className="mt-3 flex items-start justify-between gap-4">
                      <span className="text-sm text-slate-500">Tarif</span>
                      <span className="text-right text-sm font-semibold text-slate-900">
                        {outboundPricing.tarifaLabel || "-"}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-[#FFF7EE] p-5 ring-1 ring-[#F5D1A3]">
                    <p className="text-sm font-semibold text-slate-600">
                      Montant total
                    </p>
                    <p className="mt-2 text-4xl font-bold text-slate-900">
                      {formatMoney(finalTotal)}
                    </p>
                  </div>

                  {!travelersComplete && (
                    <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                      <p className="text-sm font-semibold text-[#1F2F46]">
                        Dossier incomplet
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Les informations voyageurs sont incomplètes.
                      </p>
                    </div>
                  )}

                  {!REAL_BOOKING_ENABLED && (
                    <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                      <p className="text-sm font-semibold text-[#1F2F46]">
                        Mode test actif
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Le paiement PayPal peut être testé normalement. En
                        revanche, la création réelle de la réservation reste
                        bloquée tant que le mode production n’est pas activé.
                      </p>
                    </div>
                  )}

                  {paymentError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {paymentError}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={handleProceedToPayment}
                    disabled={
                      !paymentSupported ||
                      paymentLoading ||
                      outboundPricing.status === "loading" ||
                      (bookingFlow.tripType === "round_trip" &&
                        inboundPricing.status === "loading")
                    }
                    className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {paymentLoading ? "Redirection vers PayPal..." : "Payer"}
                  </button>

                  <p className="text-center text-sm text-slate-500">
                    Paiement sécurisé via PayPal
                  </p>
                </div>
              </SectionCard>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}
