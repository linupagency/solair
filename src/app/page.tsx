"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createEmptyBookingFlow,
  type BookingFlow,
  type BookingPassengerCounts,
  type BookingTripType,
  type BookingVehicleSelection,
} from "@/lib/booking-flow";
import {
  getBookingFlow,
  setBookingFlow,
} from "@/lib/booking-flow-storage";
import {
  armasDefaultDimensionsForTrailerCategory,
  CAR_WITH_TRAILER_MAX_LENGTH_M,
  clampTrailerTotalLengthM,
  isCarWithTrailerCategory,
  minBillableTotalLengthMForTrailerCategory,
  type CarTrailerCategory,
} from "@/lib/solair-vehicle-trailer";
import { defaultVehiculoDimensions } from "@/lib/vehicle/armas-catalog";

type Port = {
  codigoPuerto: string;
  textoCorto: string;
  textoLargo?: string;
};

type PortsApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  data?: {
    return?: {
      puertosEntidad?: {
        puertoEntidad?: Port[] | Port;
      };
    };
  };
};

type DiscountMode = "G" | "R" | "F1";

type AnimalState = {
  enabled: boolean;
  count: number;
};

/** Clés = catégories proposées sur la fiche véhicule d’accueil. */
type VehicleUiRowKey =
  | "small_tourism_car"
  | "large_tourism_car"
  | "small_tourism_car_trailer"
  | "large_tourism_car_trailer"
  | "bus_with_trailer"
  | "camper"
  | "moto";

type VehicleSelectionMap = Partial<Record<VehicleUiRowKey, number>>;

type VehicleUiRow = {
  key: VehicleUiRowKey;
  commercialLabel: string;
  description: string;
  icon: "sans" | "car" | "camper" | "moto";
};

const VEHICLE_UI_ROWS: VehicleUiRow[] = [
  {
    key: "small_tourism_car",
    commercialLabel: "Petite voiture de tourisme",
    description:
      "Véhicule de moins de 4,85 m de long et moins de 1,85 m de haut.",
    icon: "car",
  },
  {
    key: "large_tourism_car",
    commercialLabel: "Grande voiture de tourisme",
    description:
      "Véhicule de plus de 5,01 m de long et/ou plus de 2,01 m de haut, et jusqu’à 6 m de long.",
    icon: "car",
  },
  {
    key: "small_tourism_car_trailer",
    commercialLabel: "Petite voiture de tourisme + remorque",
    description:
      "Longueur totale véhicule + remorque maximum 8 m.",
    icon: "car",
  },
  {
    key: "large_tourism_car_trailer",
    commercialLabel: "Grande voiture de tourisme + remorque",
    description:
      "Longueur totale véhicule + remorque maximum 14 m.",
    icon: "car",
  },
  {
    key: "camper",
    commercialLabel: "Camping-car",
    description: "Camping-car.",
    icon: "camper",
  },
  {
    key: "moto",
    commercialLabel: "Moto",
    description: "Moto.",
    icon: "moto",
  },
  {
    key: "bus_with_trailer",
    commercialLabel: "Autobus + remorque",
    description:
      "Longueur totale autobus + remorque maximum 14 m (même plafond que grande voiture + remorque).",
    icon: "car",
  },
];

type VehicleTrailerRowKey = Extract<
  VehicleUiRowKey,
  "small_tourism_car_trailer" | "large_tourism_car_trailer" | "bus_with_trailer"
>;

function isTrailerRowKey(key: VehicleUiRowKey): key is VehicleTrailerRowKey {
  return (
    key === "small_tourism_car_trailer" ||
    key === "large_tourism_car_trailer" ||
    key === "bus_with_trailer"
  );
}

type VehicleSheetDraft = {
  vehicleSelections: VehicleSelectionMap;
  trailerLengthByCategory: Record<CarTrailerCategory, string>;
  carBrand: string;
  carModel: string;
  carRoofLuggage: "yes" | "no";
  carRoofRange: "1.9-2.8" | "2.8-4.2";
  carBikeRack: "yes" | "no";
};

function snapshotVehicleSheetDraft(
  selections: VehicleSelectionMap,
  trailer: Record<CarTrailerCategory, string>,
  brand: string,
  model: string,
  roof: "yes" | "no",
  roofRange: "1.9-2.8" | "2.8-4.2",
  rack: "yes" | "no"
): VehicleSheetDraft {
  return {
    vehicleSelections: { ...selections },
    trailerLengthByCategory: { ...trailer },
    carBrand: brand,
    carModel: model,
    carRoofLuggage: roof,
    carRoofRange: roofRange,
    carBikeRack: rack,
  };
}

function applyDraftVehicleAdjust(
  draft: VehicleSheetDraft,
  key: "sans" | VehicleUiRowKey,
  delta: 1 | -1
): VehicleSheetDraft {
  if (key === "sans") {
    if (delta >= 0) return { ...draft, vehicleSelections: {} };
    return draft;
  }
  if (delta < 0) return { ...draft, vehicleSelections: {} };
  return { ...draft, vehicleSelections: { [key]: 1 } };
}

function defaultTrailerLengths(): Record<CarTrailerCategory, string> {
  return {
    small_tourism_car_trailer: String(
      CAR_WITH_TRAILER_MAX_LENGTH_M.small_tourism_car_trailer
    ),
    medium_tourism_car_trailer: String(
      CAR_WITH_TRAILER_MAX_LENGTH_M.medium_tourism_car_trailer
    ),
    large_tourism_car_trailer: String(
      CAR_WITH_TRAILER_MAX_LENGTH_M.large_tourism_car_trailer
    ),
    bus_with_trailer: String(CAR_WITH_TRAILER_MAX_LENGTH_M.bus_with_trailer),
  };
}

function validateTrailerLengthInput(
  active: CarTrailerCategory,
  trailerMap: Record<CarTrailerCategory, string>
): string | null {
  const raw = trailerMap[active];
  const n = Number(String(raw).replace(",", ".").trim());
  const max = CAR_WITH_TRAILER_MAX_LENGTH_M[active];
  const minTotal = minBillableTotalLengthMForTrailerCategory(active);
  if (!Number.isFinite(n) || n <= minTotal || n > max) {
    return `Indiquez une longueur totale entre ${minTotal.toFixed(2).replace(".", ",")} m et ${max} m (strictement au-delà de la longueur « voiture seule » du palier).`;
  }
  return null;
}

function SansVehicleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-8 w-8 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l8 8M16 8l-8 8" />
    </svg>
  );
}

function CamperIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-8 w-8 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <rect x="3" y="10" width="14" height="7" rx="1.5" />
      <path d="M17 12h3l2 3v2h-5" />
      <circle cx="8" cy="19" r="1.3" />
      <circle cx="15" cy="19" r="1.3" />
    </svg>
  );
}

function MotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-8 w-8 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden
    >
      <circle cx="7" cy="17" r="2.5" />
      <circle cx="17" cy="17" r="2.5" />
      <path d="M9.5 17 12 9l3 8M15 9l-2 4" />
    </svg>
  );
}

function VehicleRowIcon({ kind }: { kind: VehicleUiRow["icon"] }) {
  const cls = "text-[#163B6D]";
  switch (kind) {
    case "sans":
      return (
        <span className={cls}>
          <SansVehicleIcon />
        </span>
      );
    case "car":
      return (
        <span className={cls}>
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden
          >
            <path d="M5 16l1.5-5h11L19 16" />
            <rect x="3" y="12" width="18" height="6" rx="2" />
            <circle cx="7" cy="18" r="1.2" />
            <circle cx="17" cy="18" r="1.2" />
          </svg>
        </span>
      );
    case "camper":
      return (
        <span className={cls}>
          <CamperIcon />
        </span>
      );
    case "moto":
      return (
        <span className={cls}>
          <MotoIcon />
        </span>
      );
    default:
      return null;
  }
}

function normalizePorts(value?: Port[] | Port): Port[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toApiDate(date: string) {
  return date.replaceAll("-", "");
}

function fromApiDate(date?: string) {
  if (!date || date.length !== 8) return "";
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
}

function getTodayInputDate() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDisplayDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function ShipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3 16c2 2 4 2 6 0 2 2 4 2 6 0 2 2 4 2 6 0" />
      <path d="M6 13.5V8l6-3 6 3v5.5" />
      <path d="M6 8h12" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.8-4 13.2-4 16 0" />
    </svg>
  );
}

function CarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M5 16l1.5-5h11L19 16" />
      <rect x="3" y="12" width="18" height="6" rx="2" />
      <circle cx="7" cy="18" r="1.2" />
      <circle cx="17" cy="18" r="1.2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M20 13l-7 7-9-9V4h7l9 9Z" />
      <circle cx="8.5" cy="8.5" r="1.2" />
    </svg>
  );
}

function PawIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-7 w-7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="6" cy="10" r="1.8" />
      <circle cx="10" cy="6.5" r="1.8" />
      <circle cx="14" cy="6.5" r="1.8" />
      <circle cx="18" cy="10" r="1.8" />
      <path d="M8 16c0-2.2 1.9-4 4-4s4 1.8 4 4c0 1.7-1.2 3-3 3H11c-1.8 0-3-1.3-3-3Z" />
    </svg>
  );
}

function SearchCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[126px] rounded-[24px] bg-[#F3F6F7] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-[#163B6D]">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-[#1F2F46]">{title}</p>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          ) : null}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SelectionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-left text-base text-slate-700 transition hover:bg-slate-50"
    >
      {label}
    </button>
  );
}

function ResponsivePicker({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-label="Fermer"
      />

      <div className="absolute inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center md:p-6">
        <div className="relative w-full rounded-t-[28px] bg-white p-5 shadow-2xl md:max-w-2xl md:rounded-[28px] md:p-6">
          <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-300 md:hidden" />

          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Fermer
            </button>
          </div>

          <div className="max-h-[72vh] overflow-y-auto pr-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PickerOption({
  active,
  title,
  description,
  onClick,
}: {
  active?: boolean;
  title: string;
  description: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";

  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`w-full rounded-2xl border px-4 py-4 text-left ${
        active
          ? "border-[#163B6D] bg-[#EEF4FB]"
          : "border-slate-200 bg-white"
      } ${onClick ? "transition hover:bg-slate-50" : "opacity-70"}`}
    >
      <div className="text-base font-semibold text-slate-900">{title}</div>
      <div className="mt-1 text-sm text-slate-500">{description}</div>
    </Tag>
  );
}

function CounterRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-4">
      <div className="pr-4">
        <p className="text-base font-semibold text-slate-900">{label}</p>
        <p className="mt-1 text-sm text-slate-500">{hint}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(Math.max(0, value - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-900 transition hover:bg-slate-50"
        >
          −
        </button>

        <span className="min-w-[28px] text-center text-base font-bold text-slate-900">
          {value}
        </span>

        <button
          type="button"
          onClick={() => onChange(value + 1)}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-900 transition hover:bg-slate-50"
        >
          +
        </button>
      </div>
    </div>
  );
}

function VehiclePickerLine({
  icon,
  title,
  description,
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled?: boolean;
  incrementDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3 sm:gap-4 sm:px-4">
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1 pr-1">
        <p className="text-[15px] font-semibold leading-snug text-slate-900">
          {title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500 sm:text-sm">
          {description}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          onClick={onDecrement}
          disabled={decrementDisabled}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
        >
          −
        </button>
        <span className="min-w-[26px] text-center text-base font-bold tabular-nums text-slate-900 sm:min-w-[28px]">
          {value}
        </span>
        <button
          type="button"
          onClick={onIncrement}
          disabled={incrementDisabled}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 text-lg font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
        >
          +
        </button>
      </div>
    </div>
  );
}

function TripTypeToggle({
  value,
  onChange,
}: {
  value: BookingTripType;
  onChange: (next: BookingTripType) => void;
}) {
  return (
    <div className="inline-flex rounded-2xl bg-white/10 p-1">
      <button
        type="button"
        onClick={() => onChange("one_way")}
        className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
          value === "one_way"
            ? "bg-white text-[#163B6D]"
            : "text-white hover:bg-white/10"
        }`}
      >
        Aller simple
      </button>
      <button
        type="button"
        onClick={() => onChange("round_trip")}
        className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
          value === "round_trip"
            ? "bg-white text-[#163B6D]"
            : "text-white hover:bg-white/10"
        }`}
      >
        Aller-retour
      </button>
    </div>
  );
}

function getDiscountLabel(discount: DiscountMode) {
  switch (discount) {
    case "G":
      return "Tarif général";
    case "R":
      return "Résident";
    case "F1":
      return "Famille nombreuse";
    default:
      return "Tarif général";
  }
}

function getPassengerSummary(passengers: BookingPassengerCounts) {
  const total =
    passengers.adults +
    passengers.youth +
    passengers.seniors +
    passengers.children +
    passengers.babies;

  if (total === 0) return "Aucun passager";

  const parts: string[] = [];

  if (passengers.adults > 0) {
    parts.push(`${passengers.adults} adulte${passengers.adults > 1 ? "s" : ""}`);
  }
  if (passengers.youth > 0) {
    parts.push(`${passengers.youth} jeune${passengers.youth > 1 ? "s" : ""}`);
  }
  if (passengers.seniors > 0) {
    parts.push(`${passengers.seniors} senior${passengers.seniors > 1 ? "s" : ""}`);
  }
  if (passengers.children > 0) {
    parts.push(`${passengers.children} enfant${passengers.children > 1 ? "s" : ""}`);
  }
  if (passengers.babies > 0) {
    parts.push(`${passengers.babies} bébé${passengers.babies > 1 ? "s" : ""}`);
  }

  return parts.join(" • ");
}

function getAnimalsSummary(animals: AnimalState) {
  if (!animals.enabled || animals.count === 0) return "Sans animal";
  return `${animals.count} animal${animals.count > 1 ? "ux" : ""}`;
}

function getVehicleSelectionMapFromFlow(
  vehicles: BookingVehicleSelection[]
): VehicleSelectionMap {
  const v = vehicles.find((x) => (x.quantity || 0) > 0);
  if (!v?.category) return {};

  if (v.category === "bike" || v.category === "bicycle") {
    return { moto: 1 };
  }

  if (v.category === "moto") {
    return { moto: 1 };
  }

  const key = v.category as VehicleUiRowKey;
  const valid = VEHICLE_UI_ROWS.some((r) => r.key === key);
  if (!valid) return {};
  return { [key]: 1 };
}

function rowMeta(key: VehicleUiRowKey) {
  return VEHICLE_UI_ROWS.find((r) => r.key === key);
}

function buildVehiclesForFlow(
  selections: VehicleSelectionMap,
  opts: {
    trailerLengthByCategory: Record<CarTrailerCategory, string>;
    carBrand: string;
    carModel: string;
    carRoofLuggage: "yes" | "no";
    carRoofRange: "1.9-2.8" | "2.8-4.2";
    carBikeRack: "yes" | "no";
  }
): BookingVehicleSelection[] {
  const active = Object.entries(selections).find(
    ([, q]) => (q || 0) > 0
  ) as [VehicleUiRowKey, number] | undefined;
  if (!active) return [];

  const [key] = active;
  const meta = rowMeta(key);
  if (!meta) return [];

  if (isTrailerRowKey(key)) {
    const parsed = Number(
      String(opts.trailerLengthByCategory[key]).replace(",", ".")
    );
    const largo = clampTrailerTotalLengthM(
      Number.isFinite(parsed) ? parsed : CAR_WITH_TRAILER_MAX_LENGTH_M[key],
      key
    );
    const def = armasDefaultDimensionsForTrailerCategory(key);
    return [
      {
        category: key,
        quantity: 1,
        label: meta.commercialLabel,
        marque: opts.carBrand.trim(),
        modele: opts.carModel.trim(),
        dimensions: {
          alto: def.alto,
          ancho: def.ancho,
          largo,
        },
      },
    ];
  }

  if (
    key === "small_tourism_car" ||
    key === "large_tourism_car"
  ) {
    const base = defaultVehiculoDimensions(key);
    let alto = base.alto;
    if (opts.carRoofLuggage === "yes") {
      alto = opts.carRoofRange === "2.8-4.2" ? 3.2 : 2.3;
    }
    const largo = opts.carBikeRack === "yes" ? 5.2 : base.largo;
    return [
      {
        category: key,
        quantity: 1,
        label: meta.commercialLabel,
        marque: opts.carBrand.trim(),
        modele: opts.carModel.trim(),
        dimensions: {
          alto,
          ancho: base.ancho,
          largo,
        },
      },
    ];
  }

  if (key === "camper") {
    const d = defaultVehiculoDimensions("camper");
    return [
      {
        category: "camper",
        quantity: 1,
        label: meta.commercialLabel,
        dimensions: { alto: d.alto, ancho: d.ancho, largo: d.largo },
      },
    ];
  }

  if (key === "moto") {
    const d = defaultVehiculoDimensions("moto");
    return [
      {
        category: "moto",
        quantity: 1,
        label: meta.commercialLabel,
        dimensions: { alto: d.alto, ancho: d.ancho, largo: d.largo },
      },
    ];
  }

  return [];
}

function getVehicleSummary(selections: VehicleSelectionMap) {
  const active = Object.entries(selections).find(([, q]) => (q || 0) > 0);
  if (!active) return "Sans véhicule";

  const [rowKey] = active as [VehicleUiRowKey, number];
  const meta = rowMeta(rowKey);
  return meta ? meta.commercialLabel : "Véhicule";
}

function selectedVehicleRowKey(
  selections: VehicleSelectionMap
): VehicleUiRowKey | null {
  const active = Object.entries(selections).find(([, q]) => (q || 0) > 0);
  if (!active) return null;
  return active[0] as VehicleUiRowKey;
}

export default function HomePage() {
  const router = useRouter();

  const [ports, setPorts] = useState<Port[]>([]);
  const [loadingPorts, setLoadingPorts] = useState(true);
  const [portsError, setPortsError] = useState("");

  const [tripType, setTripType] = useState<BookingTripType>("one_way");
  const [origen, setOrigen] = useState("");
  const [destino, setDestino] = useState("");
  const [dateIda, setDateIda] = useState("");
  const [dateVuelta, setDateVuelta] = useState("");

  const [sheet, setSheet] = useState<
    | null
    | "origin"
    | "destination"
    | "passengers"
    | "animals"
    | "vehicles"
    | "discount"
  >(null);

  const [originSearch, setOriginSearch] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");

  const [passengers, setPassengers] = useState<BookingPassengerCounts>({
    adults: 1,
    youth: 0,
    seniors: 0,
    children: 0,
    babies: 0,
  });

  const [animals, setAnimals] = useState<AnimalState>({
    enabled: false,
    count: 0,
  });

  const [vehicleSelections, setVehicleSelections] = useState<VehicleSelectionMap>(
    {}
  );
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carRoofLuggage, setCarRoofLuggage] = useState<"yes" | "no">("no");
  const [carRoofRange, setCarRoofRange] = useState<"1.9-2.8" | "2.8-4.2">(
    "1.9-2.8"
  );
  const [carBikeRack, setCarBikeRack] = useState<"yes" | "no">("no");
  const [trailerLengthByCategory, setTrailerLengthByCategory] = useState<
    Record<CarTrailerCategory, string>
  >(() => defaultTrailerLengths());

  const [vehicleSheetDraft, setVehicleSheetDraft] =
    useState<VehicleSheetDraft | null>(null);
  const [vehicleSheetError, setVehicleSheetError] = useState("");

  const [discountMode, setDiscountMode] = useState<DiscountMode>("G");

  useEffect(() => {
    const flow = getBookingFlow();

    setTripType(flow.tripType);
    setOrigen(flow.search.origen || "");
    setDestino(flow.search.destino || "");
    setDateIda(fromApiDate(flow.search.fechaIda) || getTodayInputDate());
    setDateVuelta(fromApiDate(flow.search.fechaVuelta) || "");
    setPassengers(flow.search.passengers);
    setAnimals(flow.search.animals);
    setVehicleSelections(getVehicleSelectionMapFromFlow(flow.search.vehicles));
    setTrailerLengthByCategory(() => {
      const next = defaultTrailerLengths();
      const firstVehicle = flow.search.vehicles[0];
      if (
        firstVehicle &&
        isCarWithTrailerCategory(firstVehicle.category) &&
        typeof firstVehicle.dimensions?.largo === "number"
      ) {
        const cat = firstVehicle.category as CarTrailerCategory;
        next[cat] = String(
          clampTrailerTotalLengthM(firstVehicle.dimensions.largo, cat)
        );
      }
      return next;
    });
    const firstVehicle = flow.search.vehicles[0];
    if (firstVehicle) {
      setCarBrand(firstVehicle.marque || "");
      setCarModel(firstVehicle.modele || "");
      setCarRoofLuggage(
        typeof firstVehicle.dimensions?.alto === "number" &&
          firstVehicle.dimensions.alto > 1.9
          ? "yes"
          : "no"
      );
      setCarRoofRange(
        typeof firstVehicle.dimensions?.alto === "number" &&
          firstVehicle.dimensions.alto >= 2.8
          ? "2.8-4.2"
          : "1.9-2.8"
      );
    }
    setDiscountMode((flow.search.bonificacion as DiscountMode) || "G");
  }, []);

  useEffect(() => {
    if (!dateIda) {
      setDateIda(getTodayInputDate());
    }
  }, [dateIda]);

  useEffect(() => {
    async function loadPorts() {
      try {
        setLoadingPorts(true);
        setPortsError("");

        const response = await fetch("/api/armas/test-ports", {
          cache: "no-store",
        });

        const json: PortsApiResponse = await response.json();

        if (!response.ok || !json.ok) {
          throw new Error(
            json.error || json.message || "Impossible de charger les ports."
          );
        }

        const list = normalizePorts(
          json.data?.return?.puertosEntidad?.puertoEntidad
        ).sort((a, b) => a.textoCorto.localeCompare(b.textoCorto));

        setPorts(list);
      } catch (err) {
        setPortsError(err instanceof Error ? err.message : "Erreur inconnue.");
      } finally {
        setLoadingPorts(false);
      }
    }

    loadPorts();
  }, []);

  const selectedOrigin = useMemo(() => {
    return ports.find((port) => port.codigoPuerto === origen);
  }, [ports, origen]);

  const selectedDestination = useMemo(() => {
    return ports.find((port) => port.codigoPuerto === destino);
  }, [ports, destino]);

  const filteredOriginOptions = useMemo(() => {
    const search = originSearch.trim().toLowerCase();
    if (!search) return ports;

    return ports.filter((port) => {
      const label = `${port.textoCorto} ${port.codigoPuerto} ${
        port.textoLargo || ""
      }`.toLowerCase();
      return label.includes(search);
    });
  }, [ports, originSearch]);

  const filteredDestinationOptions = useMemo(() => {
    const search = destinationSearch.trim().toLowerCase();
    const base = ports.filter((port) => port.codigoPuerto !== origen);

    if (!search) return base;

    return base.filter((port) => {
      const label = `${port.textoCorto} ${port.codigoPuerto} ${
        port.textoLargo || ""
      }`.toLowerCase();
      return label.includes(search);
    });
  }, [ports, destinationSearch, origen]);

  const totalPassengers = useMemo(() => {
    return (
      passengers.adults +
      passengers.youth +
      passengers.seniors +
      passengers.children +
      passengers.babies
    );
  }, [passengers]);

  const totalVehicles = useMemo(() => {
    return Object.values(vehicleSelections).reduce(
      (sum, qty) => sum + (qty || 0),
      0
    );
  }, [vehicleSelections]);

  const canSearch =
    !!origen &&
    !!destino &&
    !!dateIda &&
    (tripType === "one_way" || !!dateVuelta) &&
    totalPassengers > 0 &&
    !loadingPorts &&
    !portsError;

  function resetVehicles() {
    setVehicleSelections({});
    setTrailerLengthByCategory(defaultTrailerLengths());
  }

  function setSansVehicle() {
    setVehicleSelections({});
  }

  function setSingleVehicleRow(key: VehicleUiRowKey) {
    setVehicleSelections({ [key]: 1 });
  }

  function adjustVehicleQuantity(
    key: "sans" | VehicleUiRowKey,
    delta: 1 | -1
  ) {
    if (key === "sans") {
      if (delta >= 0) setSansVehicle();
      return;
    }
    if (delta < 0) {
      setSansVehicle();
      return;
    }
    setSingleVehicleRow(key);
  }

  function openVehicleSheet() {
    setVehicleSheetError("");
    setVehicleSheetDraft(
      snapshotVehicleSheetDraft(
        vehicleSelections,
        trailerLengthByCategory,
        carBrand,
        carModel,
        carRoofLuggage,
        carRoofRange,
        carBikeRack
      )
    );
    setSheet("vehicles");
  }

  function closeVehicleSheet() {
    setVehicleSheetError("");
    setVehicleSheetDraft(null);
    setSheet(null);
  }

  function commitVehicleSheet() {
    if (!vehicleSheetDraft) return;
    const active = selectedVehicleRowKey(vehicleSheetDraft.vehicleSelections);
    if (active && isTrailerRowKey(active)) {
      const err = validateTrailerLengthInput(
        active,
        vehicleSheetDraft.trailerLengthByCategory
      );
      if (err) {
        setVehicleSheetError(err);
        return;
      }
    }
    setVehicleSelections(vehicleSheetDraft.vehicleSelections);
    setTrailerLengthByCategory(vehicleSheetDraft.trailerLengthByCategory);
    setCarBrand(vehicleSheetDraft.carBrand);
    setCarModel(vehicleSheetDraft.carModel);
    setCarRoofLuggage(vehicleSheetDraft.carRoofLuggage);
    setCarRoofRange(vehicleSheetDraft.carRoofRange);
    setCarBikeRack(vehicleSheetDraft.carBikeRack);
    setVehicleSheetError("");
    setVehicleSheetDraft(null);
    setSheet(null);
  }

  const activeVehicleKey = useMemo(
    () => selectedVehicleRowKey(vehicleSelections),
    [vehicleSelections]
  );

  const draftVehicleTotal = useMemo(() => {
    if (!vehicleSheetDraft) return 0;
    return Object.values(vehicleSheetDraft.vehicleSelections).reduce(
      (sum, qty) => sum + (qty || 0),
      0
    );
  }, [vehicleSheetDraft]);

  const draftActiveVehicleKey = useMemo(
    () =>
      vehicleSheetDraft
        ? selectedVehicleRowKey(vehicleSheetDraft.vehicleSelections)
        : null,
    [vehicleSheetDraft]
  );

  function handleTripTypeChange(next: BookingTripType) {
    setTripType(next);
    if (next === "one_way") {
      setDateVuelta("");
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSearch) return;

    /**
     * Si la modale véhicule est ouverte, le choix réel est dans `vehicleSheetDraft`.
     * Sans cette prise en compte, la recherche utilisait encore l’ancien
     * `vehicleSelections` (souvent « petite voiture ») → même tarif Armas pour toutes les sélections.
     */
    const usingVehicleDraft = sheet === "vehicles" && vehicleSheetDraft != null;
    const effSelections = usingVehicleDraft
      ? vehicleSheetDraft.vehicleSelections
      : vehicleSelections;
    const effTrailer = usingVehicleDraft
      ? vehicleSheetDraft.trailerLengthByCategory
      : trailerLengthByCategory;
    const effBrand = usingVehicleDraft ? vehicleSheetDraft.carBrand : carBrand;
    const effModel = usingVehicleDraft ? vehicleSheetDraft.carModel : carModel;
    const effRoof = usingVehicleDraft
      ? vehicleSheetDraft.carRoofLuggage
      : carRoofLuggage;
    const effRoofRange = usingVehicleDraft
      ? vehicleSheetDraft.carRoofRange
      : carRoofRange;
    const effBikeRack = usingVehicleDraft
      ? vehicleSheetDraft.carBikeRack
      : carBikeRack;

    const submitActiveKey = selectedVehicleRowKey(effSelections);
    if (submitActiveKey && isTrailerRowKey(submitActiveKey)) {
      const trailerErr = validateTrailerLengthInput(
        submitActiveKey,
        effTrailer
      );
      if (trailerErr) {
        setVehicleSheetError(trailerErr);
        if (!usingVehicleDraft) {
          setVehicleSheetDraft(
            snapshotVehicleSheetDraft(
              vehicleSelections,
              trailerLengthByCategory,
              carBrand,
              carModel,
              carRoofLuggage,
              carRoofRange,
              carBikeRack
            )
          );
          setSheet("vehicles");
        }
        return;
      }
    }

    if (usingVehicleDraft && vehicleSheetDraft) {
      setVehicleSelections(vehicleSheetDraft.vehicleSelections);
      setTrailerLengthByCategory(vehicleSheetDraft.trailerLengthByCategory);
      setCarBrand(vehicleSheetDraft.carBrand);
      setCarModel(vehicleSheetDraft.carModel);
      setCarRoofLuggage(vehicleSheetDraft.carRoofLuggage);
      setCarRoofRange(vehicleSheetDraft.carRoofRange);
      setCarBikeRack(vehicleSheetDraft.carBikeRack);
      setVehicleSheetError("");
      setVehicleSheetDraft(null);
      setSheet(null);
    }

    const vehiclesForFlow = buildVehiclesForFlow(effSelections, {
      trailerLengthByCategory: effTrailer,
      carBrand: effBrand,
      carModel: effModel,
      carRoofLuggage: effRoof,
      carRoofRange: effRoofRange,
      carBikeRack: effBikeRack,
    });
    const previous = getBookingFlow();
    const nextFlow: BookingFlow = createEmptyBookingFlow();

    nextFlow.tripType = tripType;
    nextFlow.search = {
      origen,
      destino,
      fechaIda: toApiDate(dateIda),
      fechaVuelta: tripType === "round_trip" && dateVuelta ? toApiDate(dateVuelta) : "",
      bonificacion: discountMode,
      passengers,
      animals,
      vehicles: vehiclesForFlow,
    };
    nextFlow.contact = previous.contact;

    setBookingFlow(nextFlow);
    router.push("/resultats");
  }

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="bg-[#163B6D]">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4 text-white/95">
            <div className="flex flex-wrap items-center gap-4">
              <TripTypeToggle value={tripType} onChange={handleTripTypeChange} />
              <button type="button" className="text-sm font-semibold">
                Je dispose d&apos;un code promotionnel
              </button>
              <button type="button" className="text-sm font-semibold">
                Euros
              </button>
            </div>

            <a
              href="/retrouver-ma-reservation"
              className="inline-flex rounded-[18px] border border-white/25 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/20"
            >
              Retrouver ma réservation
            </a>
          </div>
        </div>
      </section>

      <section className="bg-[#163B6D] pb-12 pt-3">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-6 flex items-center justify-center">
            <div className="rounded-2xl bg-white/95 px-4 py-3 shadow-sm">
              <img
                src="/logo-solair-voyages.png"
                alt="Solair Voyages"
                className="h-auto w-[180px] sm:w-[240px]"
              />
            </div>
          </div>

          <div className="rounded-[28px] bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.12)] sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {loadingPorts && (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Chargement des ports...
                </div>
              )}

              {!loadingPorts && portsError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {portsError}
                </div>
              )}

              {!loadingPorts && !portsError && (
                <>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <SearchCard
                      icon={<ShipIcon />}
                      title="Origine"
                      subtitle={selectedOrigin?.textoCorto || "Choisissez un port"}
                    >
                      <SelectionButton
                        label={
                          selectedOrigin
                            ? `${selectedOrigin.textoCorto} (${selectedOrigin.codigoPuerto})`
                            : "Choisir un port de départ"
                        }
                        onClick={() => setSheet("origin")}
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<ShipIcon />}
                      title="Destination"
                      subtitle={
                        selectedDestination?.textoCorto ||
                        "Choisissez une destination"
                      }
                    >
                      <SelectionButton
                        label={
                          selectedDestination
                            ? `${selectedDestination.textoCorto} (${selectedDestination.codigoPuerto})`
                            : "Choisir une destination"
                        }
                        onClick={() => setSheet("destination")}
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<CalendarIcon />}
                      title="Date aller"
                      subtitle={
                        dateIda ? formatDisplayDate(dateIda) : "Choisissez une date"
                      }
                    >
                      <input
                        type="date"
                        value={dateIda}
                        onChange={(e) => setDateIda(e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-[#163B6D]"
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<CalendarIcon />}
                      title="Date retour"
                      subtitle={
                        tripType === "round_trip"
                          ? dateVuelta
                            ? formatDisplayDate(dateVuelta)
                            : "Choisissez une date"
                          : "Non applicable"
                      }
                    >
                      <input
                        type="date"
                        value={dateVuelta}
                        disabled={tripType !== "round_trip"}
                        onChange={(e) => setDateVuelta(e.target.value)}
                        className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-[#163B6D] disabled:cursor-not-allowed disabled:bg-slate-100"
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<UserIcon />}
                      title="Passagers"
                      subtitle={getPassengerSummary(passengers)}
                    >
                      <SelectionButton
                        label={`${totalPassengers} passager${totalPassengers > 1 ? "s" : ""}`}
                        onClick={() => setSheet("passengers")}
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<PawIcon />}
                      title="Animaux"
                      subtitle={getAnimalsSummary(animals)}
                    >
                      <SelectionButton
                        label={getAnimalsSummary(animals)}
                        onClick={() => setSheet("animals")}
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<CarIcon />}
                      title="Véhicules"
                      subtitle={getVehicleSummary(vehicleSelections)}
                    >
                      <SelectionButton
                        label={getVehicleSummary(vehicleSelections)}
                        onClick={openVehicleSheet}
                      />
                    </SearchCard>

                    <SearchCard
                      icon={<TagIcon />}
                      title="Réduction"
                      subtitle={getDiscountLabel(discountMode)}
                    >
                      <SelectionButton
                        label={getDiscountLabel(discountMode)}
                        onClick={() => setSheet("discount")}
                      />
                    </SearchCard>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={!canSearch}
                      className="rounded-[24px] bg-[#F28C28] px-8 py-5 text-lg font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Voir les traversées et prix
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                      <p className="text-sm font-semibold text-[#1F2F46]">
                        Tarification
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Les tarifs sont calculés après le choix de la traversée,
                        selon les passagers, animaux, véhicules et réductions
                        indiqués dans votre dossier.
                      </p>
                    </div>

                    <div className="rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
                      <p className="text-sm font-semibold text-[#1F2F46]">
                        Suivi de réservation
                      </p>
                      <p className="mt-2 text-sm text-slate-600">
                        Une fois confirmée, retrouvez votre réservation avec la
                        référence et votre adresse email.
                      </p>
                      <a
                        href="/retrouver-ma-reservation"
                        className="mt-3 inline-flex text-sm font-bold text-[#163B6D] underline underline-offset-4"
                      >
                        Accéder au suivi
                      </a>
                    </div>
                  </div>
                </>
              )}
            </form>
          </div>
        </div>
      </section>

      <ResponsivePicker
        open={sheet === "origin"}
        title="Choisir le port de départ"
        onClose={() => setSheet(null)}
      >
        <div className="space-y-4">
          <input
            type="text"
            value={originSearch}
            onChange={(e) => setOriginSearch(e.target.value)}
            placeholder="Rechercher un port"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-[#163B6D]"
          />

          <div className="space-y-3">
            {filteredOriginOptions.map((port) => (
              <PickerOption
                key={port.codigoPuerto}
                active={origen === port.codigoPuerto}
                title={`${port.textoCorto} (${port.codigoPuerto})`}
                description={port.textoLargo || "Port disponible"}
                onClick={() => {
                  setOrigen(port.codigoPuerto);
                  if (port.codigoPuerto === destino) {
                    setDestino("");
                  }
                  setSheet(null);
                }}
              />
            ))}
          </div>
        </div>
      </ResponsivePicker>

      <ResponsivePicker
        open={sheet === "destination"}
        title="Choisir la destination"
        onClose={() => setSheet(null)}
      >
        <div className="space-y-4">
          <input
            type="text"
            value={destinationSearch}
            onChange={(e) => setDestinationSearch(e.target.value)}
            placeholder="Rechercher une destination"
            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-[#163B6D]"
          />

          <div className="space-y-3">
            {filteredDestinationOptions.map((port) => (
              <PickerOption
                key={port.codigoPuerto}
                active={destino === port.codigoPuerto}
                title={`${port.textoCorto} (${port.codigoPuerto})`}
                description={port.textoLargo || "Destination disponible"}
                onClick={() => {
                  setDestino(port.codigoPuerto);
                  setSheet(null);
                }}
              />
            ))}
          </div>
        </div>
      </ResponsivePicker>

      <ResponsivePicker
        open={sheet === "passengers"}
        title="Passagers"
        onClose={() => setSheet(null)}
      >
        <div className="space-y-3">
          <CounterRow
            label="Adultes"
            hint="De 27 à 59 ans"
            value={passengers.adults}
            onChange={(next) =>
              setPassengers((prev) => ({ ...prev, adults: next }))
            }
          />

          <CounterRow
            label="Jeune"
            hint="De 12 à 26 ans"
            value={passengers.youth}
            onChange={(next) =>
              setPassengers((prev) => ({ ...prev, youth: next }))
            }
          />

          <CounterRow
            label="Seniors"
            hint="À partir de 60 ans"
            value={passengers.seniors}
            onChange={(next) =>
              setPassengers((prev) => ({ ...prev, seniors: next }))
            }
          />

          <CounterRow
            label="Enfants"
            hint="De 4 à 11 ans"
            value={passengers.children}
            onChange={(next) =>
              setPassengers((prev) => ({ ...prev, children: next }))
            }
          />

          <CounterRow
            label="Bébés"
            hint="De 0 à 3 ans"
            value={passengers.babies}
            onChange={(next) =>
              setPassengers((prev) => ({ ...prev, babies: next }))
            }
          />

          <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
            <p className="text-sm font-semibold text-[#1F2F46]">Résumé</p>
            <p className="mt-2 text-sm text-slate-600">
              {getPassengerSummary(passengers)}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
            <p className="text-sm text-slate-700">
              Selon la nouvelle réglementation des Bonifications pour les
              résidents non-péninsulaires et les familles nombreuses, adoptée
              dans la Loi de Finances Générale pour 2021, la réduction pour
              résidents sera indiquée et appliquée lors de la dernière étape du
              processus d'achat, en même temps que les données de chaque
              passager.
            </p>
          </div>
        </div>
      </ResponsivePicker>

      <ResponsivePicker
        open={sheet === "animals"}
        title="Animaux"
        onClose={() => setSheet(null)}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-base font-semibold text-slate-900">
                  Voyager avec un animal
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Active le comptage des animaux dans le dossier.
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setAnimals((prev) => ({
                    enabled: !prev.enabled,
                    count: !prev.enabled ? Math.max(1, prev.count) : 0,
                  }))
                }
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  animals.enabled
                    ? "bg-[#163B6D] text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {animals.enabled ? "Activé" : "Désactivé"}
              </button>
            </div>
          </div>

          <CounterRow
            label="Nombre d’animaux"
            hint="Compteur global du dossier"
            value={animals.enabled ? animals.count : 0}
            onChange={(next) =>
              setAnimals({
                enabled: next > 0,
                count: next,
              })
            }
          />

          <div className="rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
            <p className="text-sm font-semibold text-[#1F2F46]">Résumé</p>
            <p className="mt-2 text-sm text-slate-600">
              {getAnimalsSummary(animals)}
            </p>
          </div>
        </div>
      </ResponsivePicker>

      <ResponsivePicker
        open={sheet === "vehicles"}
        title="Véhicules"
        onClose={closeVehicleSheet}
      >
        {vehicleSheetDraft ? (
          <div className="space-y-3">
            <VehiclePickerLine
              icon={<VehicleRowIcon kind="sans" />}
              title="Sans véhicule"
              description="Je ne transporte pas de véhicule."
              value={draftVehicleTotal === 0 ? 1 : 0}
              onDecrement={() =>
                setVehicleSheetDraft((d) =>
                  d ? applyDraftVehicleAdjust(d, "sans", -1) : d
                )
              }
              onIncrement={() =>
                setVehicleSheetDraft((d) =>
                  d ? applyDraftVehicleAdjust(d, "sans", 1) : d
                )
              }
              decrementDisabled={draftVehicleTotal === 0}
              incrementDisabled={draftVehicleTotal === 0}
            />

            {VEHICLE_UI_ROWS.map((row) => {
              const qty = vehicleSheetDraft.vehicleSelections[row.key] || 0;
              return (
                <div key={row.key} className="space-y-2">
                  <VehiclePickerLine
                    icon={<VehicleRowIcon kind={row.icon} />}
                    title={row.commercialLabel}
                    description={row.description}
                    value={qty}
                    onDecrement={() =>
                      setVehicleSheetDraft((d) =>
                        d ? applyDraftVehicleAdjust(d, row.key, -1) : d
                      )
                    }
                    onIncrement={() =>
                      setVehicleSheetDraft((d) =>
                        d ? applyDraftVehicleAdjust(d, row.key, 1) : d
                      )
                    }
                    decrementDisabled={qty === 0}
                    incrementDisabled={false}
                  />
                  {qty > 0 && isTrailerRowKey(row.key) ? (
                    <div className="ml-0 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3 sm:ml-11">
                      <label className="block text-xs font-medium text-slate-700">
                        Longueur totale véhicule + remorque (m)
                        <input
                          type="number"
                          inputMode="decimal"
                          min={minBillableTotalLengthMForTrailerCategory(row.key)}
                          max={CAR_WITH_TRAILER_MAX_LENGTH_M[row.key]}
                          step={0.1}
                          value={
                            vehicleSheetDraft.trailerLengthByCategory[row.key]
                          }
                          onChange={(e) =>
                            setVehicleSheetDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    trailerLengthByCategory: {
                                      ...d.trailerLengthByCategory,
                                      [row.key]: e.target.value,
                                    },
                                  }
                                : d
                            )
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#163B6D]"
                        />
                        <span className="mt-1 block text-[11px] text-slate-500">
                          Maximum autorisé pour ce tarif :{" "}
                          {CAR_WITH_TRAILER_MAX_LENGTH_M[row.key]} m
                        </span>
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {draftActiveVehicleKey &&
            (draftActiveVehicleKey === "small_tourism_car" ||
              draftActiveVehicleKey === "large_tourism_car" ||
              isTrailerRowKey(draftActiveVehicleKey)) ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-[#1F2F46]">
                  Détails du véhicule
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={vehicleSheetDraft.carBrand}
                    onChange={(e) =>
                      setVehicleSheetDraft((d) =>
                        d ? { ...d, carBrand: e.target.value } : d
                      )
                    }
                    placeholder="Marque"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#163B6D]"
                  />
                  <input
                    type="text"
                    value={vehicleSheetDraft.carModel}
                    onChange={(e) =>
                      setVehicleSheetDraft((d) =>
                        d ? { ...d, carModel: e.target.value } : d
                      )
                    }
                    placeholder="Modèle"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-[#163B6D]"
                  />
                </div>

                {draftActiveVehicleKey === "small_tourism_car" ||
                draftActiveVehicleKey === "large_tourism_car" ? (
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="font-medium text-slate-900">
                        Bagages sur le toit
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setVehicleSheetDraft((d) =>
                              d ? { ...d, carRoofLuggage: "no" } : d
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 ${
                            vehicleSheetDraft.carRoofLuggage === "no"
                              ? "bg-[#163B6D] text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          Non
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setVehicleSheetDraft((d) =>
                              d ? { ...d, carRoofLuggage: "yes" } : d
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 ${
                            vehicleSheetDraft.carRoofLuggage === "yes"
                              ? "bg-[#163B6D] text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          Oui
                        </button>
                      </div>
                      {vehicleSheetDraft.carRoofLuggage === "yes" ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setVehicleSheetDraft((d) =>
                                d ? { ...d, carRoofRange: "1.9-2.8" } : d
                              )
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs sm:text-sm ${
                              vehicleSheetDraft.carRoofRange === "1.9-2.8"
                                ? "bg-[#F28C28] text-white"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            entre 1,9 et 2,8 m
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setVehicleSheetDraft((d) =>
                                d ? { ...d, carRoofRange: "2.8-4.2" } : d
                              )
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs sm:text-sm ${
                              vehicleSheetDraft.carRoofRange === "2.8-4.2"
                                ? "bg-[#F28C28] text-white"
                                : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            entre 2,8 et 4,2 m
                          </button>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-slate-200 p-3">
                      <p className="font-medium text-slate-900">
                        Porte-vélos dépassant la longueur
                      </p>
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setVehicleSheetDraft((d) =>
                              d ? { ...d, carBikeRack: "no" } : d
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 ${
                            vehicleSheetDraft.carBikeRack === "no"
                              ? "bg-[#163B6D] text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          Non
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setVehicleSheetDraft((d) =>
                              d ? { ...d, carBikeRack: "yes" } : d
                            )
                          }
                          className={`rounded-lg px-3 py-1.5 ${
                            vehicleSheetDraft.carBikeRack === "yes"
                              ? "bg-[#163B6D] text-white"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          Oui
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {vehicleSheetError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {vehicleSheetError}
              </div>
            ) : null}

            <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
              <p className="text-sm font-semibold text-[#1F2F46]">Aperçu</p>
              <p className="mt-2 text-sm text-slate-600">
                {getVehicleSummary(vehicleSheetDraft.vehicleSelections)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Validez pour appliquer ce choix au résumé de recherche.
              </p>
            </div>

            <button
              type="button"
              onClick={commitVehicleSheet}
              className="w-full rounded-[22px] bg-[#F28C28] px-5 py-3.5 text-base font-bold text-white transition hover:bg-[#E57C12]"
            >
              Valider le véhicule
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-600">Chargement…</p>
        )}
      </ResponsivePicker>

      <ResponsivePicker
        open={sheet === "discount"}
        title="Réduction"
        onClose={() => setSheet(null)}
      >
        <div className="space-y-3">
          <PickerOption
            active={discountMode === "G"}
            title="Tarif général"
            description="Aucune réduction particulière"
            onClick={() => {
              setDiscountMode("G");
              setSheet(null);
            }}
          />

          <PickerOption
            active={discountMode === "R"}
            title="Résident"
            description="Réduction résident"
            onClick={() => {
              setDiscountMode("R");
              setSheet(null);
            }}
          />

          <PickerOption
            active={discountMode === "F1"}
            title="Famille nombreuse"
            description="Réduction famille nombreuse"
            onClick={() => {
              setDiscountMode("F1");
              setSheet(null);
            }}
          />
        </div>
      </ResponsivePicker>
    </main>
  );
}