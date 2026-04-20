"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { HomeMaritimeHeader } from "@/components/home";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
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

type TrayectosApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  destinos?: Port[];
};

type AvailableDatesApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  availableDates?: string[];
};

async function fetchAvailableDatesWindow(args: {
  origen: string;
  destino: string;
  startDate: string;
  days: number;
}) {
  const response = await fetch(
    `/api/armas/test-available-dates?origen=${encodeURIComponent(
      args.origen
    )}&destino=${encodeURIComponent(
      args.destino
    )}&startDate=${args.startDate}&days=${args.days}&concurrency=8`,
    { cache: "no-store" }
  );

  const json: AvailableDatesApiResponse = await response.json();

  if (!response.ok || !json.ok) {
    throw new Error(
      json.error || json.message || "Impossible de charger les dates disponibles."
    );
  }

  return (json.availableDates || []).map(toInputDateFromApi).filter(Boolean);
}

type DiscountOption = {
  code: string;
  shortLabel: string;
  longLabel: string;
};

type HomeHeaderLink = {
  label: string;
  href: string;
};

type DiscountsApiResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  discounts?: DiscountOption[];
};

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

/**
 * Header d'accueil éditable rapidement.
 * Tu peux modifier ici les libellés et les liens visibles en haut du site.
 */
const HOME_HEADER_LINKS: HomeHeaderLink[] = [
  { label: "Accueil", href: "https://solair-voyages.com" },
  { label: "Réserver", href: "#reservation-form" },
  { label: "Nous contacter", href: "https://solair-voyages.com/contact/" },
];

const HOME_HEADER_TOP_LINKS: HomeHeaderLink[] = [
  { label: "Actualités", href: "#" },
  { label: "FAQ", href: "#" },
  { label: "Besoin d’aide ?", href: "#" },
  { label: "Français", href: "#" },
];

/**
 * Image de fond d'accueil.
 * Dépose simplement ta photo dans `public/hero-solair-home.jpg`
 * puis remplace ce chemin si besoin.
 */
const HOME_HERO_BACKGROUND_IMAGE = "/hero-solair-home.jpg";
const AVAILABLE_DATES_LOOKAHEAD_DAYS = 210;
const AVAILABLE_DATES_INITIAL_WINDOW_DAYS = 75;

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

function toInputDateFromApi(yyyymmdd: string) {
  if (!/^\d{8}$/.test(yyyymmdd)) return "";
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function formatDisplayDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function parseInputDate(value?: string) {
  if (!value) return undefined;
  const [yyyy, mm, dd] = value.split("-").map(Number);
  if (!yyyy || !mm || !dd) return undefined;
  return new Date(yyyy, mm - 1, dd);
}

function toInputDate(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function DateAvailabilityPicker({
  value,
  onChange,
  disabled,
  loading,
  availableDates,
  placeholder,
  minDate,
  variant = "default",
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  loading?: boolean;
  availableDates: string[];
  placeholder: string;
  minDate?: string;
  variant?: "default" | "desktop" | "desktopWide";
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = parseInputDate(value);
  const isOpen = open && !disabled;

  const allowedSet = useMemo(() => {
    const filtered = minDate
      ? availableDates.filter((d) => d >= minDate)
      : availableDates;
    return new Set(filtered);
  }, [availableDates, minDate]);

  const firstAllowed = useMemo(() => {
    const first = Array.from(allowedSet).sort()[0];
    return first ? parseInputDate(first) : undefined;
  }, [allowedSet]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        className={`w-full border border-slate-200 bg-white text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 ${
          variant === "desktopWide"
            ? "min-h-[76px] rounded-[24px] px-6 py-4 text-[15px] font-medium shadow-sm"
            : variant === "desktop"
              ? "min-h-[52px] rounded-lg px-3.5 py-2.5 text-sm font-medium"
              : "min-h-[48px] rounded-lg px-4 py-3 text-base"
        }`}
      >
        {loading
          ? "Chargement des dates disponibles..."
          : value
            ? formatDisplayDate(value)
            : placeholder}
      </button>

      {isOpen ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-40 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
          <DayPicker
            mode="single"
            selected={selectedDate}
            defaultMonth={selectedDate || firstAllowed}
            onSelect={(date) => {
              if (!date) return;
              const next = toInputDate(date);
              if (!allowedSet.has(next)) return;
              onChange(next);
              setOpen(false);
            }}
            disabled={(date) => !allowedSet.has(toInputDate(date))}
            showOutsideDays
            classNames={{
              months: "flex flex-col",
              month: "space-y-3",
              caption: "flex items-center justify-between px-2",
              caption_label: "text-lg font-semibold text-slate-800",
              nav_button:
                "h-8 w-8 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50",
              table: "w-full border-collapse",
              head_row: "flex",
              head_cell:
                "w-10 text-center text-xs font-semibold uppercase text-slate-500",
              row: "mt-1 flex w-full",
              cell: "h-10 w-10 text-center text-sm p-0 relative",
              day: "h-10 w-10 rounded-full font-medium text-slate-700 hover:bg-slate-100",
              day_today: "text-[#163B6D] font-bold",
              day_selected:
                "bg-[#163B6D] text-white hover:bg-[#163B6D] focus:bg-[#163B6D]",
              day_disabled: "text-slate-300 opacity-100 cursor-not-allowed",
              day_outside: "text-slate-300",
            }}
          />
        </div>
      ) : null}
    </div>
  );
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
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F0F5FA] text-[#163B6D] [&_svg]:h-5 [&_svg]:w-5">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm font-medium text-slate-800">
              {subtitle}
            </p>
          ) : null}
          <div className="mt-2.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SelectionButton({
  label,
  onClick,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "desktop" | "desktopWide";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full border border-slate-200 bg-white text-left text-sm font-medium text-slate-800 transition hover:border-slate-300 hover:bg-slate-50 ${
        variant === "desktopWide"
          ? "min-h-[76px] rounded-[24px] px-6 py-4 text-[15px] shadow-sm"
          : variant === "desktop"
            ? "min-h-[52px] rounded-lg px-3.5 py-2.5"
            : "min-h-[48px] rounded-lg px-3.5 py-2.5"
      }`}
    >
      <span
        className={
          variant === "desktopWide"
            ? "block leading-tight"
            : variant === "desktop"
              ? "block truncate"
              : "block"
        }
      >
        {label}
      </span>
    </button>
  );
}

function DesktopSearchField({
  icon,
  title,
  subtitle,
  children,
  layout = "card",
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  layout?: "card" | "panel" | "heroCard";
}) {
  if (layout === "panel") {
    return (
      <div className="flex min-h-full min-w-0 flex-col p-3 sm:p-4">
        <div className="mb-2 flex items-start gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F0F5FA] text-[#163B6D] [&_svg]:h-[18px] [&_svg]:w-[18px]">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {title}
            </p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-auto min-w-0">{children}</div>
      </div>
    );
  }

  if (layout === "heroCard") {
    return (
      <div className="flex min-h-[224px] min-w-0 flex-col rounded-[32px] bg-[#F3F5F8] px-7 py-7">
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-[#163B6D] shadow-sm [&_svg]:h-6 [&_svg]:w-6">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-[#223556]">{title}</p>
            {subtitle ? (
              <p className="mt-1 text-[14px] text-slate-500">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="mt-auto min-w-0">{children}</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-3">
      <div className="mb-2 flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F0F5FA] text-[#163B6D] [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {title}
          </p>
          {subtitle ? (
            <p className="truncate text-sm font-medium text-slate-800">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {children}
    </div>
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
        <div className="relative w-full rounded-t-[28px] bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl md:max-w-2xl md:rounded-[28px] md:p-6">
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

          <div className="max-h-[78vh] overflow-y-auto pr-1">{children}</div>
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
    <div className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm">
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
    <div className="flex items-center gap-3 rounded-[22px] border border-slate-200 bg-white px-3 py-3 shadow-sm sm:gap-4 sm:px-4">
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
  variant = "dark",
  buttonOrder = "one_way_first",
}: {
  value: BookingTripType;
  onChange: (next: BookingTripType) => void;
  variant?: "dark" | "light";
  buttonOrder?: "one_way_first" | "round_trip_first";
}) {
  const isLight = variant === "light";
  const wrap = `inline-flex w-full max-w-full rounded-lg p-0.5 sm:w-auto ${
    isLight ? "bg-slate-100" : "bg-white/10"
  }`;
  const inactive = isLight
    ? "text-slate-600 hover:bg-white/70"
    : "text-white hover:bg-white/10";
  const active = "bg-white text-[#163B6D] shadow-sm";

  const btnRt = (
    <button
      type="button"
      onClick={() => onChange("round_trip")}
      className={`flex-1 rounded-md px-3 py-2.5 text-sm font-semibold transition sm:px-4 ${
        value === "round_trip" ? active : inactive
      }`}
    >
      Aller-retour
    </button>
  );
  const btnOw = (
    <button
      type="button"
      onClick={() => onChange("one_way")}
      className={`flex-1 rounded-md px-3 py-2.5 text-sm font-semibold transition sm:px-4 ${
        value === "one_way" ? active : inactive
      }`}
    >
      Aller simple
    </button>
  );

  return (
    <div className={wrap} role="group" aria-label="Type de trajet">
      {buttonOrder === "round_trip_first" ? (
        <>
          {btnRt}
          {btnOw}
        </>
      ) : (
        <>
          {btnOw}
          {btnRt}
        </>
      )}
    </div>
  );
}

const DEFAULT_DISCOUNT_OPTION: DiscountOption = {
  code: "G",
  shortLabel: "Tarif général",
  longLabel: "Aucune réduction particulière",
};

function fallbackDiscountLabel(code?: string) {
  const normalized = String(code || "").trim().toUpperCase();
  switch (normalized) {
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
      return normalized || DEFAULT_DISCOUNT_OPTION.shortLabel;
  }
}

function getDiscountLabel(
  discountCode: string,
  options?: DiscountOption[],
  persistedLabel?: string
) {
  const normalized = String(discountCode || "").trim().toUpperCase();
  const matched = options?.find((option) => option.code === normalized);
  if (matched?.shortLabel) return matched.shortLabel;
  if (persistedLabel?.trim()) return persistedLabel.trim();
  return fallbackDiscountLabel(normalized);
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
  const [availableDestinationsByOrigin, setAvailableDestinationsByOrigin] =
    useState<Port[]>([]);
  const [loadingDestinations, setLoadingDestinations] = useState(false);
  const [availableOutboundDates, setAvailableOutboundDates] = useState<string[]>(
    []
  );
  const [availableInboundDates, setAvailableInboundDates] = useState<string[]>([]);
  const [loadingOutboundDates, setLoadingOutboundDates] = useState(false);
  const [loadingInboundDates, setLoadingInboundDates] = useState(false);
  const [availableDiscounts, setAvailableDiscounts] = useState<DiscountOption[]>([
    DEFAULT_DISCOUNT_OPTION,
  ]);
  const [loadingDiscounts, setLoadingDiscounts] = useState(false);

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

  const [discountMode, setDiscountMode] = useState("G");
  const [discountModeLabel, setDiscountModeLabel] = useState(
    DEFAULT_DISCOUNT_OPTION.shortLabel
  );

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
    setDiscountMode((flow.search.bonificacion || "G").trim().toUpperCase());
    setDiscountModeLabel(
      flow.search.bonificacionLabel?.trim() || DEFAULT_DISCOUNT_OPTION.shortLabel
    );
  }, []);

  useEffect(() => {
    if (!origen || !destino) {
      setAvailableDiscounts([DEFAULT_DISCOUNT_OPTION]);
      setLoadingDiscounts(false);
      return;
    }

    let cancelled = false;
    setLoadingDiscounts(true);

    void (async () => {
      try {
        const response = await fetch(
          `/api/armas/test-discounts?origen=${encodeURIComponent(
            origen
          )}&destino=${encodeURIComponent(destino)}`,
          { cache: "no-store" }
        );
        const json: DiscountsApiResponse = await response.json();
        if (cancelled) return;

        const nextOptions =
          response.ok && json.ok && Array.isArray(json.discounts) && json.discounts.length > 0
            ? json.discounts
            : [DEFAULT_DISCOUNT_OPTION];

        setAvailableDiscounts(nextOptions);

        const normalizedCurrent = discountMode.trim().toUpperCase();
        const current =
          nextOptions.find((option) => option.code === normalizedCurrent) ??
          nextOptions.find((option) => option.code === "G") ??
          nextOptions[0];

        if (!current) return;

        if (current.code !== normalizedCurrent) {
          setDiscountMode(current.code);
        }
        setDiscountModeLabel(current.shortLabel || fallbackDiscountLabel(current.code));
      } catch {
        if (!cancelled) {
          setAvailableDiscounts([DEFAULT_DISCOUNT_OPTION]);
          if (discountMode.trim().toUpperCase() === "G") {
            setDiscountModeLabel(DEFAULT_DISCOUNT_OPTION.shortLabel);
          }
        }
      } finally {
        if (!cancelled) {
          setLoadingDiscounts(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [origen, destino, discountMode]);

  useEffect(() => {
    setDateIda((prev) => prev || getTodayInputDate());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAvailableDestinations() {
      if (!origen) {
        setAvailableDestinationsByOrigin([]);
        return;
      }

      try {
        setLoadingDestinations(true);
        const response = await fetch(
          `/api/armas/test-trayectos?origen=${encodeURIComponent(origen)}`,
          { cache: "no-store" }
        );
        const json: TrayectosApiResponse = await response.json();
        if (!response.ok || !json.ok) {
          throw new Error(
            json.error ||
              json.message ||
              "Impossible de charger les destinations disponibles."
          );
        }
        if (!cancelled) {
          setAvailableDestinationsByOrigin(
            (json.destinos || []).sort((a, b) =>
              a.textoCorto.localeCompare(b.textoCorto)
            )
          );
        }
      } catch {
        if (!cancelled) {
          setAvailableDestinationsByOrigin([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingDestinations(false);
        }
      }
    }

    loadAvailableDestinations();
    return () => {
      cancelled = true;
    };
  }, [origen]);

  useEffect(() => {
    if (!destino) return;
    const isStillValid = availableDestinationsByOrigin.some(
      (port) => port.codigoPuerto === destino
    );
    if (!isStillValid) {
      setDestino("");
      setDateIda("");
      setDateVuelta("");
    }
  }, [availableDestinationsByOrigin, destino]);

  useEffect(() => {
    let cancelled = false;

    async function loadOutboundDates() {
      if (!origen || !destino) {
        setAvailableOutboundDates([]);
        return;
      }

      const start = toApiDate(getTodayInputDate());
      setLoadingOutboundDates(true);

      try {
        const initialDays = Math.min(
          AVAILABLE_DATES_INITIAL_WINDOW_DAYS,
          AVAILABLE_DATES_LOOKAHEAD_DAYS
        );
        const initialDates = await fetchAvailableDatesWindow({
          origen,
          destino,
          startDate: start,
          days: initialDays,
        });

        if (!cancelled) {
          setAvailableOutboundDates(initialDates);
          setLoadingOutboundDates(false);
        }

        if (AVAILABLE_DATES_LOOKAHEAD_DAYS > initialDays) {
          const fullDates = await fetchAvailableDatesWindow({
            origen,
            destino,
            startDate: start,
            days: AVAILABLE_DATES_LOOKAHEAD_DAYS,
          });

          if (!cancelled) {
            setAvailableOutboundDates(fullDates);
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableOutboundDates([]);
          setLoadingOutboundDates(false);
        }
      }
    }

    loadOutboundDates();
    return () => {
      cancelled = true;
    };
  }, [origen, destino]);

  useEffect(() => {
    let cancelled = false;

    async function loadInboundDates() {
      if (
        tripType !== "round_trip" ||
        !origen ||
        !destino ||
        !dateIda
      ) {
        setAvailableInboundDates([]);
        setLoadingInboundDates(false);
        return;
      }

      const start = toApiDate(dateIda);
      setLoadingInboundDates(true);

      try {
        const initialDays = Math.min(
          AVAILABLE_DATES_INITIAL_WINDOW_DAYS,
          AVAILABLE_DATES_LOOKAHEAD_DAYS
        );
        const initialDates = await fetchAvailableDatesWindow({
          origen: destino,
          destino: origen,
          startDate: start,
          days: initialDays,
        });

        if (!cancelled) {
          setAvailableInboundDates(initialDates);
          setLoadingInboundDates(false);
        }

        if (AVAILABLE_DATES_LOOKAHEAD_DAYS > initialDays) {
          const fullDates = await fetchAvailableDatesWindow({
            origen: destino,
            destino: origen,
            startDate: start,
            days: AVAILABLE_DATES_LOOKAHEAD_DAYS,
          });

          if (!cancelled) {
            setAvailableInboundDates(fullDates);
          }
        }
      } catch {
        if (!cancelled) {
          setAvailableInboundDates([]);
          setLoadingInboundDates(false);
        }
      }
    }

    loadInboundDates();
    return () => {
      cancelled = true;
    };
  }, [tripType, origen, destino, dateIda]);

  useEffect(() => {
    if (!dateIda) return;
    if (!availableOutboundDates.includes(dateIda)) {
      setDateIda("");
    }
  }, [availableOutboundDates, dateIda]);

  useEffect(() => {
    if (!dateVuelta) return;
    if (!availableInboundDates.includes(dateVuelta)) {
      setDateVuelta("");
    }
  }, [availableInboundDates, dateVuelta]);

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
    const source = origen ? availableDestinationsByOrigin : [];
    const base = source.filter((port) => port.codigoPuerto !== origen);

    if (!search) return base;

    return base.filter((port) => {
      const label = `${port.textoCorto} ${port.codigoPuerto} ${
        port.textoLargo || ""
      }`.toLowerCase();
      return label.includes(search);
    });
  }, [availableDestinationsByOrigin, destinationSearch, origen]);

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

  const inboundDateOptions = useMemo(() => {
    if (!dateIda) return availableInboundDates;
    return availableInboundDates.filter((d) => d >= dateIda);
  }, [availableInboundDates, dateIda]);

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
      bonificacionLabel: discountModeLabel,
      passengers,
      animals,
      vehicles: vehiclesForFlow,
    };
    nextFlow.contact = previous.contact;

    setBookingFlow(nextFlow);
    router.push("/resultats");
  }

  return (
    <main className="bg-[#E5EAEF] text-slate-900">
      <HomeMaritimeHeader
        topLinks={HOME_HEADER_TOP_LINKS}
        mainLinks={HOME_HEADER_LINKS}
        reservationHref="/retrouver-ma-reservation"
      />

      <section
        className="relative isolate w-full overflow-x-hidden bg-[#0a2348]"
        aria-label="Réserver une traversée"
      >
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat"
          style={{ backgroundImage: `url('${HOME_HERO_BACKGROUND_IMAGE}')` }}
        />

        <div className="relative z-[1] mx-auto max-w-7xl px-3 pb-24 pt-7 sm:px-5 sm:pb-28 sm:pt-9 lg:px-8 lg:pb-32 lg:pt-11">
          <p className="text-center text-[14px] font-semibold uppercase tracking-[0.2em] text-[#163B6D]">
            Traversées maritimes — Solair Voyages
          </p>
          <h1 className="mx-auto mt-2 max-w-3xl text-center text-2xl font-bold leading-tight text-[#ca0202] sm:text-3xl lg:text-[2rem] lg:leading-snug">
            Réservez votre traversée au meilleur prix 
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-[#163B6D]">
          Compagnie Armas Trasmediterranea
          </p>

          <div
            id="reservation-form"
            className="relative z-[2] mx-auto mt-6 w-full max-w-[1520px] sm:mt-8 sm:-translate-y-1 lg:mt-10 lg:-translate-y-2"
          >
            <div className="overflow-visible rounded-lg border border-white/45 bg-white/95 shadow-md backdrop-blur-[2px]">
              <form
                onSubmit={handleSubmit}
                className="space-y-4 p-4 sm:p-5 lg:p-6"
              >
                {loadingPorts && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Chargement des ports...
                  </div>
                )}

                {!loadingPorts && portsError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {portsError}
                  </div>
                )}

                {!loadingPorts && !portsError && (
                  <>
                    {/* Desktop large — version 2 plus large */}
                    <div className="hidden rounded-[36px] bg-white p-8 shadow-[0_20px_60px_rgba(15,23,42,0.12)] xl:block">
                      <div className="flex items-end justify-between gap-8">
                        <div>
                          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                            Options de billets
                          </p>
                          <div className="mt-3">
                            <TripTypeToggle
                              value={tripType}
                              onChange={handleTripTypeChange}
                              variant="light"
                              buttonOrder="round_trip_first"
                            />
                          </div>
                        </div>
                        <p className="max-w-xl text-right text-sm leading-relaxed text-slate-500">
                          Choisissez facilement vos dates, vos ports et vos
                          options de voyage selon les disponibilités du moment.
                        </p>
                      </div>

                      <div className="mt-7 grid gap-5 xl:grid-cols-4">
                        <DesktopSearchField
                          layout="heroCard"
                          icon={<ShipIcon />}
                          title="Origine"
                          subtitle={
                            selectedOrigin?.textoCorto || "Choisissez un port"
                          }
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={
                              selectedOrigin
                                ? `${selectedOrigin.textoCorto} (${selectedOrigin.codigoPuerto})`
                                : "Choisir un port de départ"
                            }
                            onClick={() => setSheet("origin")}
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
                          icon={<ShipIcon />}
                          title="Destination"
                          subtitle={
                            selectedDestination?.textoCorto ||
                            "Choisissez une destination"
                          }
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={
                              selectedDestination
                                ? `${selectedDestination.textoCorto} (${selectedDestination.codigoPuerto})`
                                : "Choisir une destination"
                            }
                            onClick={() => setSheet("destination")}
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
                          icon={<CalendarIcon />}
                          title="Date aller"
                          subtitle={
                            dateIda
                              ? formatDisplayDate(dateIda)
                              : "Choisissez une date"
                          }
                        >
                          <DateAvailabilityPicker
                            value={dateIda}
                            onChange={setDateIda}
                            disabled={
                              !origen || !destino || loadingOutboundDates
                            }
                            loading={loadingOutboundDates}
                            availableDates={availableOutboundDates}
                            placeholder="Choisissez une date"
                            variant="desktopWide"
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
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
                          <DateAvailabilityPicker
                            value={dateVuelta}
                            onChange={setDateVuelta}
                            disabled={
                              tripType !== "round_trip" ||
                              !origen ||
                              !destino ||
                              !dateIda ||
                              loadingInboundDates
                            }
                            loading={loadingInboundDates}
                            availableDates={inboundDateOptions}
                            placeholder="Choisissez une date"
                            minDate={dateIda || undefined}
                            variant="desktopWide"
                          />
                        </DesktopSearchField>
                      </div>

                      <div className="mt-5 grid gap-5 xl:grid-cols-4">
                        <DesktopSearchField
                          layout="heroCard"
                          icon={<UserIcon />}
                          title="Passagers"
                          subtitle={getPassengerSummary(passengers)}
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={`${totalPassengers} passager${totalPassengers > 1 ? "s" : ""}`}
                            onClick={() => setSheet("passengers")}
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
                          icon={<PawIcon />}
                          title="Animaux"
                          subtitle={getAnimalsSummary(animals)}
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={getAnimalsSummary(animals)}
                            onClick={() => setSheet("animals")}
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
                          icon={<CarIcon />}
                          title="Véhicules"
                          subtitle={getVehicleSummary(vehicleSelections)}
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={getVehicleSummary(vehicleSelections)}
                            onClick={openVehicleSheet}
                          />
                        </DesktopSearchField>

                        <DesktopSearchField
                          layout="heroCard"
                          icon={<TagIcon />}
                          title="Réduction"
                          subtitle={getDiscountLabel(
                            discountMode,
                            availableDiscounts,
                            discountModeLabel
                          )}
                        >
                          <SelectionButton
                            variant="desktopWide"
                            label={getDiscountLabel(
                              discountMode,
                              availableDiscounts,
                              discountModeLabel
                            )}
                            onClick={() => setSheet("discount")}
                          />
                        </DesktopSearchField>
                      </div>

                      <div className="mt-7 flex items-end justify-between gap-8">
                        <p className="max-w-3xl text-sm leading-relaxed text-slate-500">
                          Sélectionnez votre traversée parmi les départs, dates
                          et options actuellement disponibles.
                        </p>
                        <button
                          type="submit"
                          disabled={!canSearch}
                          className="inline-flex min-h-[76px] min-w-[420px] items-center justify-center rounded-[28px] bg-[#F2993A] px-8 py-5 text-center text-[1.05rem] font-bold text-white shadow-[0_14px_30px_rgba(242,153,58,0.28)] transition hover:bg-[#eb8a22] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#F2993A]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400 disabled:shadow-none"
                        >
                          Voir les traversées et prix
                        </button>
                      </div>
                    </div>

                    {/* Tablette — entre lg et xl */}
                    <div className="hidden space-y-4 lg:block xl:hidden">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                        <p className="text-xs font-bold uppercase text-slate-500">
                          Options de billets
                        </p>
                        <div className="mt-2 max-w-md">
                          <TripTypeToggle
                            value={tripType}
                            onChange={handleTripTypeChange}
                            variant="light"
                            buttonOrder="round_trip_first"
                          />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <DesktopSearchField
                          icon={<ShipIcon />}
                          title="Origine"
                          subtitle={
                            selectedOrigin?.textoCorto || "Choisissez un port"
                          }
                        >
                          <SelectionButton
                            variant="desktop"
                            label={
                              selectedOrigin
                                ? `${selectedOrigin.textoCorto} (${selectedOrigin.codigoPuerto})`
                                : "Choisir un port de départ"
                            }
                            onClick={() => setSheet("origin")}
                          />
                        </DesktopSearchField>
                        <DesktopSearchField
                          icon={<ShipIcon />}
                          title="Destination"
                          subtitle={
                            selectedDestination?.textoCorto ||
                            "Choisissez une destination"
                          }
                        >
                          <SelectionButton
                            variant="desktop"
                            label={
                              selectedDestination
                                ? `${selectedDestination.textoCorto} (${selectedDestination.codigoPuerto})`
                                : "Choisir une destination"
                            }
                            onClick={() => setSheet("destination")}
                          />
                        </DesktopSearchField>
                        <DesktopSearchField
                          icon={<CalendarIcon />}
                          title="Date aller"
                          subtitle={
                            dateIda
                              ? formatDisplayDate(dateIda)
                              : "Choisissez une date"
                          }
                        >
                          <DateAvailabilityPicker
                            value={dateIda}
                            onChange={setDateIda}
                            disabled={
                              !origen || !destino || loadingOutboundDates
                            }
                            loading={loadingOutboundDates}
                            availableDates={availableOutboundDates}
                            placeholder="Choisissez une date"
                            variant="desktop"
                          />
                        </DesktopSearchField>
                        <DesktopSearchField
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
                          <DateAvailabilityPicker
                            value={dateVuelta}
                            onChange={setDateVuelta}
                            disabled={
                              tripType !== "round_trip" ||
                              !origen ||
                              !destino ||
                              !dateIda ||
                              loadingInboundDates
                            }
                            loading={loadingInboundDates}
                            availableDates={inboundDateOptions}
                            placeholder="Choisissez une date"
                            minDate={dateIda || undefined}
                            variant="desktop"
                          />
                        </DesktopSearchField>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <DesktopSearchField
                          icon={<UserIcon />}
                          title="Passagers"
                          subtitle={getPassengerSummary(passengers)}
                        >
                          <SelectionButton
                            variant="desktop"
                            label={`${totalPassengers} passager${totalPassengers > 1 ? "s" : ""}`}
                            onClick={() => setSheet("passengers")}
                          />
                        </DesktopSearchField>
                        <DesktopSearchField
                          icon={<CarIcon />}
                          title="Transport véhicule"
                          subtitle={getVehicleSummary(vehicleSelections)}
                        >
                          <SelectionButton
                            variant="desktop"
                            label={getVehicleSummary(vehicleSelections)}
                            onClick={openVehicleSheet}
                          />
                        </DesktopSearchField>
                      </div>
                      <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-3">
                        <button
                          type="button"
                          onClick={() => setSheet("animals")}
                          className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#163B6D] transition hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2"
                        >
                          Animaux : {getAnimalsSummary(animals)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheet("discount")}
                          className="min-h-[44px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#163B6D] transition hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2"
                        >
                          Réduction
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={!canSearch}
                        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-md bg-[#163B6D] px-5 py-4 text-base font-bold text-white shadow-sm transition hover:bg-[#0f2d55] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        Rechercher
                      </button>
                    </div>

                    {/* Mobile & petites largeurs */}
                    <div className="space-y-3 lg:hidden">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-bold uppercase text-slate-500">
                          Options de billets
                        </p>
                        <div className="mt-2">
                          <TripTypeToggle
                            value={tripType}
                            onChange={handleTripTypeChange}
                            variant="light"
                            buttonOrder="round_trip_first"
                          />
                        </div>
                      </div>

                      <SearchCard
                        icon={<ShipIcon />}
                        title="Origine"
                        subtitle={
                          selectedOrigin?.textoCorto || "Choisissez un port"
                        }
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
                          dateIda
                            ? formatDisplayDate(dateIda)
                            : "Choisissez une date"
                        }
                      >
                        <DateAvailabilityPicker
                          value={dateIda}
                          onChange={setDateIda}
                          disabled={!origen || !destino || loadingOutboundDates}
                          loading={loadingOutboundDates}
                          availableDates={availableOutboundDates}
                          placeholder="Choisissez une date"
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
                        <DateAvailabilityPicker
                          value={dateVuelta}
                          onChange={setDateVuelta}
                          disabled={
                            tripType !== "round_trip" ||
                            !origen ||
                            !destino ||
                            !dateIda ||
                            loadingInboundDates
                          }
                          loading={loadingInboundDates}
                          availableDates={inboundDateOptions}
                          placeholder="Choisissez une date"
                          minDate={dateIda || undefined}
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
                        icon={<CarIcon />}
                        title="Transport véhicule"
                        subtitle={getVehicleSummary(vehicleSelections)}
                      >
                        <SelectionButton
                          label={getVehicleSummary(vehicleSelections)}
                          onClick={openVehicleSheet}
                        />
                      </SearchCard>

                      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:gap-3">
                        <button
                          type="button"
                          onClick={() => setSheet("animals")}
                          className="min-h-[48px] flex-1 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-[#163B6D] transition hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2"
                        >
                          Animaux — {getAnimalsSummary(animals)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSheet("discount")}
                          className="min-h-[48px] flex-1 rounded-md border border-slate-200 bg-white px-3 py-2.5 text-left text-sm font-semibold text-[#163B6D] transition hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/35 focus-visible:ring-offset-2"
                        >
                          Réduction —{" "}
                          {getDiscountLabel(
                            discountMode,
                            availableDiscounts,
                            discountModeLabel
                          )}
                        </button>
                      </div>

                      <button
                        type="submit"
                        disabled={!canSearch}
                        className="inline-flex min-h-[52px] w-full max-w-full items-center justify-center rounded-md bg-[#163B6D] px-5 py-4 text-base font-bold text-white shadow-sm transition hover:bg-[#0f2d55] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/45 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-400"
                      >
                        Rechercher
                      </button>
                    </div>
                  </>
                )}
              </form>
            </div>
            <p className="mx-auto mt-3 max-w-2xl px-2 text-center text-xs leading-relaxed text-white/90">
              Consultez les disponibilités du moment et choisissez les dates
              qui vous conviennent le mieux.
            </p>
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
            {origen && loadingDestinations ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Chargement des destinations disponibles...
              </div>
            ) : null}
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
              Les réductions éventuellement applicables seront précisées à
              l&apos;étape suivante, avec le détail de chaque voyageur.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setSheet(null)}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-[#163B6D] px-5 py-3 text-base font-bold text-white shadow-sm transition hover:bg-[#0f2d55] focus-visible:outline focus-visible:ring-2 focus-visible:ring-[#163B6D]/40 focus-visible:ring-offset-2"
          >
            Valider
          </button>
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
          {loadingDiscounts ? (
            <p className="text-sm text-slate-600">
              Chargement des réductions disponibles…
            </p>
          ) : (
            availableDiscounts.map((option) => (
              <PickerOption
                key={option.code}
                active={discountMode === option.code}
                title={option.shortLabel || fallbackDiscountLabel(option.code)}
                description={option.longLabel || option.shortLabel || option.code}
                onClick={() => {
                  setDiscountMode(option.code);
                  setDiscountModeLabel(
                    option.shortLabel || fallbackDiscountLabel(option.code)
                  );
                  setSheet(null);
                }}
              />
            ))
          )}
        </div>
      </ResponsivePicker>
    </main>
  );
}
