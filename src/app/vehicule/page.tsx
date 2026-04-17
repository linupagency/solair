"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  cloneBookingFlow,
  type BookingVehicleSelection,
} from "@/lib/booking-flow";
import {
  getBookingFlow,
  updateBookingFlow,
} from "@/lib/booking-flow-storage";
import { vehicleLineQuantity } from "@/lib/armas/pricing-combined-flow";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import { buildTransportPricingRequestFromFlow } from "@/lib/armas/build-transport-pricing-request";
import { fetchTransportPricing } from "@/lib/armas/transport-pricing-client";
import { explicitVehicleRefForCategory } from "@/lib/armas/vehicle-line-explicit";
import { isPrimaryServiceEligibleForVehicleCompanionPricing } from "@/lib/armas/pricing-combined-primary";
import {
  getTarificacionRawLinesFromSoapResult,
  pickPrecioTotalFromTarificacionRaw,
} from "@/lib/armas/tarificacion-normalize";
import {
  armasTipoVehiculoForCategory,
  armasVehicleLineForCategory,
  isBookingVehicleCategoryId,
} from "@/lib/vehicle/armas-catalog";
import {
  armasDefaultDimensionsForTrailerCategory,
  isCarWithTrailerCategory,
  maxTotalLengthMForTrailerCategory,
  minBillableTotalLengthMForTrailerCategory,
  type CarTrailerCategory,
} from "@/lib/solair-vehicle-trailer";
import {
  OTHER_OPTION_VALUE,
  VEHICLE_BRAND_MODELS,
  VEHICLE_BRAND_OPTIONS,
} from "@/lib/ui/vehicle-brand-models";

type PricingLine = {
  servicioVentaEntidad?: {
    codigoServicioVenta?: string;
    tipoServicioVenta?: string;
  };
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

/** Champs alignés sur `VehEntidad` du WSDL Ventas (marca = marque + modèle côté SOAP). */
type WsdlVehicleFormState = {
  marque: string;
  modele: string;
  matricula: string;
  tipoVehiculo: string;
  alto: string;
  ancho: string;
  largo: string;
  tara: string;
  seguro: string;
};

/** Codes `tipoVehiculo` proposés : évite un <select> à une seule valeur `V` (régression paliers VR/XR/…). */
const TIPO_VEHICULO_SELECT_CODES = [
  "V",
  "Y",
  "X",
  "VR",
  "YR",
  "XR",
  "AC",
  "MT",
  "BI",
  "BR",
] as const;

const VEHICLE_CATEGORY_OPTIONS: { value: string; label: string }[] = [
  { value: "small_tourism_car", label: "Compacte (V|V)" },
  { value: "large_tourism_car", label: "Grande (X|V)" },
  {
    value: "small_tourism_car_trailer",
    label: "Compacte + remorque ≤ 8 m (VR|V)",
  },
  {
    value: "large_tourism_car_trailer",
    label: "Grande + remorque ≤ 14 m (XR|V)",
  },
  {
    value: "bus_with_trailer",
    label: "Autobus + remorque ≤ 14 m (BR|V)",
  },
];

const CAR_ONLY_CATEGORY_OPTIONS = VEHICLE_CATEGORY_OPTIONS.filter(
  (o) => !isCarWithTrailerCategory(o.value)
);
const TRAILER_CATEGORY_OPTIONS = VEHICLE_CATEGORY_OPTIONS.filter((o) =>
  isCarWithTrailerCategory(o.value)
);

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function formatApiDate(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function serviceLabel(code?: string) {
  switch (code) {
    case "BY":
      return "Option passager BY";
    case "BP":
      return "Option passager BP";
    case "P":
      return "Option duo P";
    case "Q":
      return "Option famille Q";
    default:
      return code ? `Service ${code}` : "Service passager";
  }
}

function passengerTypeLabel(code?: string) {
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

function discountLabel(code?: string, apiLabel?: string) {
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

function categoryLabel(category: string) {
  return (
    VEHICLE_CATEGORY_OPTIONS.find((o) => o.value === category)?.label ||
    category
  );
}

function defaultWsdlFormForCategory(category: string): WsdlVehicleFormState {
  const tipoDefault = isBookingVehicleCategoryId(category)
    ? armasTipoVehiculoForCategory(category)
    : "V";
  if (isCarWithTrailerCategory(category)) {
    const d = armasDefaultDimensionsForTrailerCategory(
      category as CarTrailerCategory
    );
    return {
      marque: "",
      modele: "",
      matricula: "",
      tipoVehiculo: tipoDefault,
      alto: String(d.alto),
      ancho: String(d.ancho),
      largo: String(d.largo),
      tara: "",
      seguro: "",
    };
  }
  return {
    marque: "",
    modele: "",
    matricula: "",
    tipoVehiculo: tipoDefault,
    alto: "1.80",
    ancho: "1.80",
    largo: "4.50",
    tara: "",
    seguro: "",
  };
}

function normalizeNumberInput(value: string) {
  return value.replace(",", ".").trim();
}

function legacyVehicleParamFromCategory(category: string): TarificacionRequestBody["vehicle"] {
  if (category === "camper") return "camper";
  if (category === "moto") return "moto";
  if (category === "bike" || category === "bicycle") return "moto";
  return "car";
}

function isPositiveNumberString(value: string) {
  const normalized = normalizeNumberInput(value);
  if (!normalized) return false;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0;
}

function parseOptionalInt(value: string): number | undefined {
  const s = value.trim();
  if (!s) return undefined;
  const n = Math.floor(Number(normalizeNumberInput(s)));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function normalizeBrandOrModelSelection(value: string): string {
  const v = value.trim().toUpperCase();
  if (!v) return OTHER_OPTION_VALUE;
  return v;
}

function formatEuroFromPrecioTotal(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value.toFixed(2).replace(".", ",")} €`;
  }
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(n)) {
      return `${n.toFixed(2).replace(".", ",")} €`;
    }
  }
  return "—";
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-semibold text-slate-700">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-2 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function InputBase(
  props: React.InputHTMLAttributes<HTMLInputElement> & {
    hasError?: boolean;
  }
) {
  const { hasError, className = "", ...rest } = props;

  return (
    <input
      {...rest}
      className={`w-full rounded-2xl border bg-white px-4 py-3 text-base outline-none transition placeholder:text-slate-400 focus:border-[#163B6D] ${
        hasError ? "border-red-300" : "border-slate-300"
      } ${className}`}
    />
  );
}

function SelectBase(
  props: React.SelectHTMLAttributes<HTMLSelectElement> & {
    hasError?: boolean;
  }
) {
  const { hasError, className = "", ...rest } = props;

  return (
    <select
      {...rest}
      className={`w-full rounded-2xl border bg-white px-4 py-3 text-base outline-none transition focus:border-[#163B6D] ${
        hasError ? "border-red-300" : "border-slate-300"
      } ${className}`}
    />
  );
}

type TrailerEncoding = "total" | "split";

function VehiculePageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const origen = searchParams.get("origen") || "";
  const destino = searchParams.get("destino") || "";
  const fechaSalida = searchParams.get("fechaSalida") || "";
  const horaSalida = searchParams.get("horaSalida") || "";
  const codigoServicioVenta = searchParams.get("codigoServicioVenta") || "";
  const tipoServicioVenta = searchParams.get("tipoServicioVenta") || "";
  const passengers = searchParams.get("passengers") || "1";
  const vehicle = searchParams.get("vehicle") || "none";
  const vehicleCategoryParam = searchParams.get("vehicleCategory")?.trim() || "";
  const tipoPasajero = searchParams.get("tipoPasajero") || "A";
  const bonificacion = searchParams.get("bonificacion") || "G";

  const [selectedVehicleCategory, setSelectedVehicleCategory] = useState<string>(
    () => vehicleCategoryParam || "small_tourism_car"
  );

  const [vehicleData, setVehicleData] = useState<WsdlVehicleFormState>(() =>
    defaultWsdlFormForCategory(vehicleCategoryParam || "small_tourism_car")
  );
  const [brandSelection, setBrandSelection] = useState<string>(OTHER_OPTION_VALUE);
  const [modelSelection, setModelSelection] = useState<string>(OTHER_OPTION_VALUE);
  const [trailerEncoding, setTrailerEncoding] =
    useState<TrailerEncoding>("total");
  const [submitted, setSubmitted] = useState(false);

  const [loadingPrice, setLoadingPrice] = useState(false);
  const [priceError, setPriceError] = useState("");
  const [pricingLines, setPricingLines] = useState<PricingLine[]>([]);
  const [pricingTotalSum, setPricingTotalSum] = useState<number | null>(null);

  useEffect(() => {
    if (vehicleCategoryParam) {
      setSelectedVehicleCategory(vehicleCategoryParam);
      return;
    }
    const f = getBookingFlow();
    const c = f.search.vehicles.find((v) => vehicleLineQuantity(v) > 0)
      ?.category;
    if (c) setSelectedVehicleCategory(c);
  }, [vehicleCategoryParam]);

  useEffect(() => {
    setVehicleData(defaultWsdlFormForCategory(selectedVehicleCategory));
    setBrandSelection(OTHER_OPTION_VALUE);
    setModelSelection(OTHER_OPTION_VALUE);
    setTrailerEncoding("total");
  }, [selectedVehicleCategory]);

  const selectedBrandModels = useMemo(() => {
    if (
      !brandSelection ||
      brandSelection === OTHER_OPTION_VALUE ||
      !VEHICLE_BRAND_MODELS[brandSelection]
    ) {
      return [] as readonly string[];
    }
    return VEHICLE_BRAND_MODELS[brandSelection];
  }, [brandSelection]);

  useEffect(() => {
    const normalizedBrand = normalizeBrandOrModelSelection(vehicleData.marque);
    if (
      brandSelection === OTHER_OPTION_VALUE &&
      normalizedBrand !== OTHER_OPTION_VALUE &&
      VEHICLE_BRAND_MODELS[normalizedBrand]
    ) {
      setBrandSelection(normalizedBrand);
    }
  }, [brandSelection, vehicleData.marque]);

  useEffect(() => {
    if (!selectedBrandModels.length) return;
    const normalizedModel = normalizeBrandOrModelSelection(vehicleData.modele);
    if (
      modelSelection === OTHER_OPTION_VALUE &&
      normalizedModel !== OTHER_OPTION_VALUE &&
      selectedBrandModels.includes(normalizedModel)
    ) {
      setModelSelection(normalizedModel);
    }
  }, [modelSelection, selectedBrandModels, vehicleData.modele]);

  const unsupportedFlow =
    vehicle === "none" ||
    (vehicle !== "car" && !isCarWithTrailerCategory(selectedVehicleCategory));

  const isTrailerFlow = isCarWithTrailerCategory(selectedVehicleCategory);
  const trailerMaxM = maxTotalLengthMForTrailerCategory(selectedVehicleCategory);
  const trailerMinTotalM = isTrailerFlow
    ? minBillableTotalLengthMForTrailerCategory(
        selectedVehicleCategory as CarTrailerCategory
      )
    : 0;

  const trailerArmasCompanionLabel = useMemo(() => {
    if (!isTrailerFlow) return "";
    const r = explicitVehicleRefForCategory(selectedVehicleCategory);
    return r ? `${r.codigoServicioVenta}|${r.tipoServicioVenta}` : "—";
  }, [isTrailerFlow, selectedVehicleCategory]);

  const nasaSecondVehicleServiceLabel = useMemo(() => {
    if (!isBookingVehicleCategoryId(selectedVehicleCategory)) return "—";
    const r = armasVehicleLineForCategory(selectedVehicleCategory);
    return `${r.codigoServicioVenta}|${r.tipoServicioVenta}`;
  }, [selectedVehicleCategory]);

  const primaryOkForCombined = useMemo(
    () =>
      isPrimaryServiceEligibleForVehicleCompanionPricing({
        codigoServicioVenta,
        tipoServicioVenta,
      }),
    [codigoServicioVenta, tipoServicioVenta]
  );

  function handleCategoryChange(next: string) {
    setSelectedVehicleCategory(next);
    const p = new URLSearchParams(searchParams.toString());
    p.set("vehicleCategory", next);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  function updateVehicleField(field: keyof WsdlVehicleFormState, value: string) {
    setVehicleData((prev) => ({
      ...prev,
      [field]: value,
    }));
  }

  const largoNum = Number(normalizeNumberInput(vehicleData.largo));

  const vehicleErrors = useMemo(() => {
    const trailerLargoOutOfRange =
      isTrailerFlow &&
      trailerMaxM != null &&
      (!Number.isFinite(largoNum) ||
        largoNum <= trailerMinTotalM ||
        largoNum > trailerMaxM);

    return {
      marque: !vehicleData.marque.trim(),
      modele: !vehicleData.modele.trim(),
      matricula: !vehicleData.matricula.trim(),
      tipoVehiculo: !vehicleData.tipoVehiculo.trim(),
      alto: !isPositiveNumberString(vehicleData.alto),
      ancho: !isPositiveNumberString(vehicleData.ancho),
      largo: !isPositiveNumberString(vehicleData.largo) || trailerLargoOutOfRange,
    };
  }, [vehicleData, isTrailerFlow, trailerMaxM, trailerMinTotalM, largoNum]);

  const vehicleValid = useMemo(() => {
    return !Object.values(vehicleErrors).some(Boolean);
  }, [vehicleErrors]);

  useEffect(() => {
    async function loadPricing() {
      if (unsupportedFlow) return;

      if (!vehicleValid) {
        setPricingLines([]);
        setPricingTotalSum(null);
        setPriceError("");
        return;
      }

      if (
        !origen ||
        !destino ||
        !fechaSalida ||
        !horaSalida ||
        !codigoServicioVenta ||
        !tipoServicioVenta ||
        !tipoPasajero ||
        !bonificacion ||
        !passengers
      ) {
        setPricingLines([]);
        setPricingTotalSum(null);
        setPriceError("Paramètres insuffisants pour recalculer le prix.");
        return;
      }

      try {
        setLoadingPrice(true);
        setPriceError("");

        const paxCount = Math.max(1, Math.floor(Number(passengers) || 1));
        const passengerTiposList = Array.from(
          { length: paxCount },
          () => tipoPasajero
        );
        const taraParsed = parseOptionalInt(vehicleData.tara);
        const altoN = Number(normalizeNumberInput(vehicleData.alto));
        const anchoN = Number(normalizeNumberInput(vehicleData.ancho));
        const largoN = Number(normalizeNumberInput(vehicleData.largo));

        const pricingFlow = cloneBookingFlow(getBookingFlow());
        pricingFlow.search.bonificacion = bonificacion;
        const row: BookingVehicleSelection = {
          category: selectedVehicleCategory,
          quantity: 1,
          label: categoryLabel(selectedVehicleCategory),
          marque: vehicleData.marque.trim(),
          modele: vehicleData.modele.trim(),
          immatriculation: vehicleData.matricula.trim(),
          dimensions: { alto: altoN, ancho: anchoN, largo: largoN },
          tipoVehiculo: vehicleData.tipoVehiculo.trim().toUpperCase(),
          ...(taraParsed != null ? { taraKg: taraParsed } : {}),
          ...(vehicleData.seguro.trim()
            ? { seguro: vehicleData.seguro.trim() }
            : {}),
          ...(isTrailerFlow
            ? { rawTrailerLength: trailerEncoding === "total" }
            : {}),
        };
        pricingFlow.search.vehicles = [row];

        const built = buildTransportPricingRequestFromFlow(
          pricingFlow,
          { origen, destino, fechaSalida, horaSalida },
          {
            cantidad: paxCount,
            codigoServicioVenta,
            tipoServicioVenta,
            tipoPasajero,
            passengerTipos: passengerTiposList,
          },
          undefined
        );
        if (!built.ok) {
          throw new Error(built.error);
        }

        const priced = await fetchTransportPricing(
          built.body,
          built.normalizedVehicle
        );
        if (!priced.ok) {
          throw new Error(priced.error);
        }

        const lines = normalizeArray(
          getTarificacionRawLinesFromSoapResult(priced.soapData) as PricingLine[]
        );
        if (lines.length === 0) {
          throw new Error("Aucune tarification retournée.");
        }
        if (priced.totalEuros == null) {
          throw new Error("Aucun montant total retourné.");
        }

        setPricingLines(lines);
        setPricingTotalSum(priced.totalEuros);
      } catch (err) {
        setPricingLines([]);
        setPricingTotalSum(null);
        setPriceError(
          err instanceof Error ? err.message : "Erreur inconnue."
        );
      } finally {
        setLoadingPrice(false);
      }
    }

    loadPricing();
  }, [
    unsupportedFlow,
    vehicleValid,
    origen,
    destino,
    fechaSalida,
    horaSalida,
    codigoServicioVenta,
    tipoServicioVenta,
    tipoPasajero,
    bonificacion,
    passengers,
    vehicleData,
    selectedVehicleCategory,
    isTrailerFlow,
    trailerEncoding,
  ]);

  const total = useMemo(() => {
    if (pricingTotalSum == null) return "-";
    return `${pricingTotalSum.toFixed(2).replace(".", ",")} €`;
  }, [pricingTotalSum]);

  const primaryPricingLine = pricingLines[0];
  const bonificationText = discountLabel(
    bonificacion,
    primaryPricingLine?.bonificacionEntidad?.textoCorto
  );

  const allLinesHaveTarifaCodigo = useMemo(
    () =>
      pricingLines.length > 0 &&
      pricingLines.every((l) =>
        String(l.tarifaEntidad?.codigoTarifa ?? "").trim()
      ),
    [pricingLines]
  );

  const canContinue =
    !unsupportedFlow &&
    vehicleValid &&
    pricingTotalSum != null &&
    pricingTotalSum > 0 &&
    allLinesHaveTarifaCodigo &&
    !loadingPrice &&
    !priceError;

  function handleContinue() {
    setSubmitted(true);

    if (!canContinue) return;

    const altoN = Number(normalizeNumberInput(vehicleData.alto));
    const anchoN = Number(normalizeNumberInput(vehicleData.ancho));
    const largoN = Number(normalizeNumberInput(vehicleData.largo));
    const taraKg = parseOptionalInt(vehicleData.tara);

    updateBookingFlow((current) => {
      const next = cloneBookingFlow(current);
      const idx = next.search.vehicles.findIndex(
        (v) => vehicleLineQuantity(v) > 0
      );
      if (idx < 0) return next;
      const prev = next.search.vehicles[idx];
      next.search.vehicles[idx] = {
        ...prev,
        category: selectedVehicleCategory,
        label: categoryLabel(selectedVehicleCategory),
        marque: vehicleData.marque.trim().toUpperCase(),
        modele: vehicleData.modele.trim().toUpperCase(),
        immatriculation: vehicleData.matricula.trim().toUpperCase(),
        dimensions: {
          alto: altoN,
          ancho: anchoN,
          largo: largoN,
        },
        tipoVehiculo: vehicleData.tipoVehiculo.trim().toUpperCase() || undefined,
        taraKg,
        seguro: vehicleData.seguro.trim() || undefined,
        rawTrailerLength: isTrailerFlow
          ? trailerEncoding === "total"
          : undefined,
      };
      return next;
    });

    const params = new URLSearchParams({
      origen,
      destino,
      fechaSalida,
      horaSalida,
      codigoServicioVenta,
      tipoServicioVenta,
      passengers,
      vehicle,
      tipoPasajero,
      bonificacion,
      vehicleData: JSON.stringify({
        kind: "car",
        tipoVehiculo:
          vehicleData.tipoVehiculo.trim().toUpperCase() ||
          (isBookingVehicleCategoryId(selectedVehicleCategory)
            ? armasTipoVehiculoForCategory(selectedVehicleCategory)
            : "V"),
        matricula: vehicleData.matricula.trim().toUpperCase(),
        marque: vehicleData.marque.trim().toUpperCase(),
        modele: vehicleData.modele.trim().toUpperCase(),
        alto: normalizeNumberInput(vehicleData.alto),
        ancho: normalizeNumberInput(vehicleData.ancho),
        largo: normalizeNumberInput(vehicleData.largo),
        tara: vehicleData.tara.trim(),
        seguro: vehicleData.seguro.trim(),
        ...(isTrailerFlow
          ? { rawTrailerLength: trailerEncoding === "total" }
          : {}),
      }),
    });
    params.set("vehicleCategory", selectedVehicleCategory);

    router.push(`/passagers?${params.toString()}`);
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
              3. Véhicule
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
                Véhicule (NASA / WSDL)
              </h1>
              <p className="mt-2 text-sm text-white/85">
                Saisie structurée comme l’entité SOAP{" "}
                <span className="font-mono text-white">VehEntidad</span> : géométrie,
                immatriculation, type véhicule ; remorque : longueur totale ou{" "}
                <span className="font-mono text-white">metrosExtra</span>.
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

      <section className="-mt-4 pb-24 lg:pb-10">
        <div className="mx-auto max-w-7xl px-4">
          {unsupportedFlow && (
            <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
              Cette page est prévue pour une voiture (standard ou avec remorque).
              Revenez aux résultats et choisissez une offre compatible.
            </div>
          )}

          {!unsupportedFlow && (
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-6">
                <SectionCard
                  title="Traversée sélectionnée"
                  subtitle="Contexte pour la tarification passager + véhicule."
                >
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Trajet
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {origen} → {destino}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Départ
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {formatApiDate(fechaSalida)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {formatApiTime(horaSalida)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Service
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {serviceLabel(codigoServicioVenta)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Profil
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {passengerTypeLabel(tipoPasajero)}
                      </p>
                      <p className="text-sm text-slate-600">
                        {passengers} voyageur
                        {Number(passengers) > 1 ? "s" : ""}
                      </p>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard
                  title="Catégorie commerciale"
                  subtitle="Détermine les dimensions par défaut, le plafond de longueur remorque et la ligne véhicule companion (ex. VR|V) pour le combiné."
                >
                  <Field
                    label="Type de véhicule réservé"
                    hint="Vous pouvez corriger la catégorie si le parcours ne l’a pas encore fixée dans l’URL."
                  >
                    <SelectBase
                      value={selectedVehicleCategory}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                    >
                      <optgroup label="Sans remorque — 2ᵉ service NASA V|V ou X|V">
                        {CAR_ONLY_CATEGORY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Avec remorque — 2ᵉ service NASA VR|V, XR|V ou BR|V">
                        {TRAILER_CATEGORY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </optgroup>
                    </SelectBase>
                  </Field>
                </SectionCard>

                {!primaryOkForCombined ? (
                  <div className="rounded-[28px] border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950 shadow-sm">
                    <p className="font-semibold">
                      Tarif passager sans combiné véhicule NASA
                    </p>
                    <p className="mt-2 text-amber-900/90">
                      Pour tarifer <strong>siège + véhicule (+ remorque)</strong> en un
                      appel, Armas attend un service passager en{" "}
                      <span className="font-mono">tipoServicioVenta = P</span> (ex.
                      BY, BP, P, Q…). Le service sélectionné sur la traversée (
                      <span className="font-mono">
                        {codigoServicioVenta}|{tipoServicioVenta}
                      </span>
                      ) n’entre pas dans ce cas : le montant affiché peut ne pas
                      correspondre à une remorque.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950 shadow-sm">
                    <p className="font-semibold">Tarification NASA (combiné)</p>
                    <p className="mt-2 text-sky-900/90">
                      Appel avec deux services :{" "}
                      <span className="font-mono">
                        {codigoServicioVenta}|{tipoServicioVenta}
                      </span>{" "}
                      +{" "}
                      <span className="font-mono">{nasaSecondVehicleServiceLabel}</span>
                      {isTrailerFlow ? (
                        <>
                          {" "}
                          (remorque : la 2ᵉ ligne doit être VR|V, XR|V ou BR|V, pas
                          V|V).
                        </>
                      ) : null}
                    </p>
                  </div>
                )}

                <SectionCard
                  title="Entité SOAP VehEntidad"
                  subtitle="Séquence WSDL : alto, ancho, largo, marca, matricula, metrosExtra (remorque, mode découpé), seguro, tara, tipoVehiculo."
                >
                  <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <p className="font-semibold text-slate-800">
                      Envoi vers Armas
                    </p>
                    <p className="mt-2">
                      <span className="font-mono">marca</span> = marque + espace
                      + modèle.{" "}
                      {isTrailerFlow ? (
                        <>
                          Companion tarifaire :{" "}
                          <span className="font-mono">
                            {trailerArmasCompanionLabel}
                          </span>
                          .
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field
                      label="tipoVehiculo"
                      hint="Ex. V (véhicule) — tel que dans le manuel NASA."
                    >
                      <SelectBase
                        value={vehicleData.tipoVehiculo}
                        onChange={(e) =>
                          updateVehicleField("tipoVehiculo", e.target.value)
                        }
                        hasError={submitted && vehicleErrors.tipoVehiculo}
                      >
                        {(() => {
                          const cur = vehicleData.tipoVehiculo.trim().toUpperCase();
                          const codes = new Set<string>([
                            ...TIPO_VEHICULO_SELECT_CODES,
                          ]);
                          if (cur) codes.add(cur);
                          return [...codes].sort().map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ));
                        })()}
                      </SelectBase>
                    </Field>

                    <Field
                      label="matricula"
                      hint="Immatriculation (obligatoire)."
                    >
                      <InputBase
                        autoComplete="off"
                        spellCheck={false}
                        value={vehicleData.matricula}
                        onChange={(e) =>
                          updateVehicleField(
                            "matricula",
                            e.target.value.toUpperCase()
                          )
                        }
                        placeholder="Ex. AB123CD"
                        hasError={submitted && vehicleErrors.matricula}
                      />
                    </Field>

                    <Field
                      label="marca (marque)"
                      hint="Obligatoire. Choisir une marque ou Autre."
                    >
                      <div className="space-y-2">
                        <SelectBase
                          value={brandSelection}
                          onChange={(e) => {
                            const next = e.target.value;
                            setBrandSelection(next);
                            setModelSelection(OTHER_OPTION_VALUE);
                            if (next !== OTHER_OPTION_VALUE) {
                              updateVehicleField("marque", next);
                              updateVehicleField("modele", "");
                            } else {
                              updateVehicleField("marque", "");
                              updateVehicleField("modele", "");
                            }
                          }}
                          hasError={submitted && vehicleErrors.marque}
                        >
                          {VEHICLE_BRAND_OPTIONS.map((brand) => (
                            <option key={brand} value={brand}>
                              {brand === OTHER_OPTION_VALUE ? "AUTRE" : brand}
                            </option>
                          ))}
                        </SelectBase>
                        {brandSelection === OTHER_OPTION_VALUE ? (
                          <InputBase
                            autoComplete="off"
                            spellCheck={false}
                            value={vehicleData.marque}
                            onChange={(e) =>
                              updateVehicleField(
                                "marque",
                                e.target.value.toUpperCase()
                              )
                            }
                            placeholder="Ex. RENAULT"
                            hasError={submitted && vehicleErrors.marque}
                          />
                        ) : null}
                      </div>
                    </Field>

                    <Field
                      label="marca (modèle)"
                      hint="Obligatoire. Liste filtrée selon la marque."
                    >
                      <div className="space-y-2">
                        <SelectBase
                          value={modelSelection}
                          onChange={(e) => {
                            const next = e.target.value;
                            setModelSelection(next);
                            if (next !== OTHER_OPTION_VALUE) {
                              updateVehicleField("modele", next);
                            } else {
                              updateVehicleField("modele", "");
                            }
                          }}
                          disabled={brandSelection === OTHER_OPTION_VALUE}
                          hasError={submitted && vehicleErrors.modele}
                        >
                          {selectedBrandModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                          <option value={OTHER_OPTION_VALUE}>AUTRE</option>
                        </SelectBase>
                        {brandSelection === OTHER_OPTION_VALUE ||
                        modelSelection === OTHER_OPTION_VALUE ? (
                          <InputBase
                            autoComplete="off"
                            spellCheck={false}
                            value={vehicleData.modele}
                            onChange={(e) =>
                              updateVehicleField(
                                "modele",
                                e.target.value.toUpperCase()
                              )
                            }
                            placeholder="Ex. CLIO"
                            hasError={submitted && vehicleErrors.modele}
                          />
                        ) : null}
                      </div>
                    </Field>

                    <Field
                      label="alto (m)"
                      hint="Hauteur maximale de l’ensemble roulant."
                    >
                      <InputBase
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={vehicleData.alto}
                        onChange={(e) =>
                          updateVehicleField(
                            "alto",
                            normalizeNumberInput(e.target.value)
                          )
                        }
                        placeholder="Ex. 1,80"
                        hasError={submitted && vehicleErrors.alto}
                      />
                    </Field>

                    <Field label="ancho (m)" hint="Largeur maximale.">
                      <InputBase
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={vehicleData.ancho}
                        onChange={(e) =>
                          updateVehicleField(
                            "ancho",
                            normalizeNumberInput(e.target.value)
                          )
                        }
                        placeholder="Ex. 1,80"
                        hasError={submitted && vehicleErrors.ancho}
                      />
                    </Field>

                    <Field
                      label="largo (m)"
                      hint={
                        isTrailerFlow && trailerMaxM != null
                          ? `Longueur totale ; max. ${trailerMaxM} m pour cette catégorie.`
                          : "Longueur hors tout du véhicule."
                      }
                    >
                      <InputBase
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={vehicleData.largo}
                        onChange={(e) =>
                          updateVehicleField(
                            "largo",
                            normalizeNumberInput(e.target.value)
                          )
                        }
                        placeholder="Ex. 4,50"
                        hasError={submitted && vehicleErrors.largo}
                      />
                    </Field>

                    <Field
                      label="tara (optionnel)"
                      hint="WSDL : entier (souvent masse à vide, kg)."
                    >
                      <InputBase
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                        value={vehicleData.tara}
                        onChange={(e) =>
                          updateVehicleField("tara", e.target.value.trim())
                        }
                        placeholder="Ex. 1200"
                      />
                    </Field>

                    <div className="md:col-span-2">
                      <Field
                        label="seguro (optionnel)"
                        hint="Référence ou libellé assurance si requis par votre agence."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={vehicleData.seguro}
                          onChange={(e) =>
                            updateVehicleField("seguro", e.target.value)
                          }
                          placeholder="Optionnel"
                        />
                      </Field>
                    </div>
                  </div>
                </SectionCard>

                {isTrailerFlow ? (
                  <SectionCard
                    title="Remorque : largo vs metrosExtra"
                    subtitle="Mode « total » : toute la longueur dans largo (défaut Armas). Mode « base + extra » : largo = voiture seule, écart vers metrosExtra."
                  >
                    <div className="space-y-3">
                      <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-[#F9FAFB] p-4">
                        <input
                          type="radio"
                          name="trailerEnc"
                          checked={trailerEncoding === "total"}
                          onChange={() => setTrailerEncoding("total")}
                          className="mt-1"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">
                            Longueur totale dans largo
                          </p>
                          <p className="text-sm text-slate-600">
                            Recommandé — pas de champ{" "}
                            <span className="font-mono">metrosExtra</span> dans
                            l’appel (largo = ensemble complet).
                          </p>
                        </div>
                      </label>
                      <label className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-[#F9FAFB] p-4">
                        <input
                          type="radio"
                          name="trailerEnc"
                          checked={trailerEncoding === "split"}
                          onChange={() => setTrailerEncoding("split")}
                          className="mt-1"
                        />
                        <div>
                          <p className="font-semibold text-slate-900">
                            Découper (largo base + metrosExtra)
                          </p>
                          <p className="text-sm text-slate-600">
                            Saisir la longueur totale ci-dessus : le client
                            envoie la longueur voiture du palier dans{" "}
                            <span className="font-mono">largo</span> et le
                            reliquat dans{" "}
                            <span className="font-mono">metrosExtra</span>.
                          </p>
                        </div>
                      </label>
                    </div>
                  </SectionCard>
                ) : null}
              </div>

              <aside className="space-y-6">
                <SectionCard
                  title="Prix"
                  subtitle={
                    isTrailerFlow
                      ? "Somme des lignes (passager + ligne companion véhicule / remorque)."
                      : "Passager + véhicule si applicable."
                  }
                >
                  {loadingPrice && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      Recalcul du prix en cours...
                    </div>
                  )}

                  {!loadingPrice && priceError && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      {priceError}
                    </div>
                  )}

                  {!loadingPrice && !priceError && pricingLines.length > 0 && (
                    <div className="space-y-4">
                      <div className="rounded-2xl bg-[#FFF7EE] p-5 ring-1 ring-[#F5D1A3]">
                        <p className="text-sm font-semibold text-slate-600">
                          Montant total
                        </p>
                        <p className="mt-2 text-4xl font-bold text-slate-900">
                          {total}
                        </p>
                        {pricingLines.length > 1 ? (
                          <p className="mt-2 text-xs text-slate-600">
                            Somme des montants des lignes ci-dessous (passager +
                            remorque / véhicule lorsque Armas renvoie deux
                            tarifications).
                          </p>
                        ) : null}
                      </div>

                      <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Détail NASA (par service)
                        </p>
                        <div className="mt-3 space-y-3">
                          {pricingLines.map((ln, idx) => {
                            const c =
                              ln.servicioVentaEntidad?.codigoServicioVenta ??
                              "?";
                            const t =
                              ln.servicioVentaEntidad?.tipoServicioVenta ?? "?";
                            const lbl =
                              ln.tarifaEntidad?.textoCorto?.trim() || "—";
                            const cod =
                              ln.tarifaEntidad?.codigoTarifa?.trim() || "—";
                            const lineTotal = formatEuroFromPrecioTotal(
                              pickPrecioTotalFromTarificacionRaw(ln)
                            );
                            return (
                              <div
                                key={idx}
                                className="rounded-xl border border-slate-200 bg-white/90 p-3 text-sm"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-xs font-semibold text-[#163B6D]">
                                    {c}|{t}
                                  </span>
                                  <span className="font-semibold text-slate-900">
                                    {lineTotal}
                                  </span>
                                </div>
                                <p className="mt-1 text-slate-700">{lbl}</p>
                                <p className="text-xs text-slate-500">
                                  Cod. tarif {cod}
                                </p>
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-4 border-t border-slate-200 pt-3">
                          <div className="flex items-start justify-between gap-4">
                            <span className="text-sm text-slate-500">
                              Bonification (réf.)
                            </span>
                            <span className="text-right text-sm font-semibold text-slate-900">
                              {bonificationText}
                            </span>
                          </div>

                          <div className="mt-3 flex items-start justify-between gap-4">
                            <span className="text-sm text-slate-500">
                              Catégorie dossier
                            </span>
                            <span className="text-right text-sm font-semibold text-slate-900">
                              {categoryLabel(selectedVehicleCategory)}
                            </span>
                          </div>
                        </div>
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
                  )}

                  {!loadingPrice && !priceError && pricingLines.length === 0 && (
                    <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                      <p className="text-sm text-slate-600">
                        Complétez le formulaire pour obtenir le prix exact.
                      </p>
                    </div>
                  )}
                </SectionCard>

                <div className="rounded-2xl border border-dashed border-slate-300 bg-white/80 p-4 text-xs text-slate-500">
                  Réf. WSDL{" "}
                  <code className="text-slate-700">Ventas20171009.wsdl</code> —
                  type <span className="font-mono">VehEntidad</span> :{" "}
                  <span className="font-mono">
                    alto, ancho, largo, marca, matricula, metrosExtra, seguro,
                    tara, tipoVehiculo
                  </span>
                  .
                </div>
              </aside>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default function VehiculePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Chargement…
        </main>
      }
    >
      <VehiculePageContent />
    </Suspense>
  );
}
