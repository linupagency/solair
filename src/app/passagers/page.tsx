"use client";

import {
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
  getTipoPasajeroForPassengerIndex,
  type BookingFlow,
  type BookingTraveler,
  type BookingVehicleSelection,
} from "@/lib/booking-flow";
import { getCommercialLabel } from "@/lib/ui/armas-commercial";

type TravelerForm = {
  nombre: string;
  apellido1: string;
  apellido2: string;
  fechaNacimiento: string;
  documentValidUntil: string;
  specialAssistance: string;
  codigoPais: string;
  sexo: string;
  tipoDocumento: string;
  codigoDocumento: string;
};

type VehicleForm = BookingVehicleSelection & {
  id: string;
};

const NATIONALITY_OPTIONS = [
  { value: "FR", label: "France" },
  { value: "ES", label: "Espagne" },
  { value: "MA", label: "Maroc" },
  { value: "DZ", label: "Algérie" },
  { value: "TN", label: "Tunisie" },
  { value: "BE", label: "Belgique" },
  { value: "CH", label: "Suisse" },
  { value: "LU", label: "Luxembourg" },
  { value: "MC", label: "Monaco" },
  { value: "AD", label: "Andorre" },
  { value: "IT", label: "Italie" },
  { value: "DE", label: "Allemagne" },
  { value: "PT", label: "Portugal" },
  { value: "NL", label: "Pays-Bas" },
  { value: "GB", label: "Royaume-Uni" },
  { value: "IE", label: "Irlande" },
  { value: "AT", label: "Autriche" },
  { value: "SE", label: "Suède" },
  { value: "NO", label: "Norvège" },
  { value: "DK", label: "Danemark" },
  { value: "FI", label: "Finlande" },
  { value: "PL", label: "Pologne" },
  { value: "CZ", label: "République tchèque" },
  { value: "SK", label: "Slovaquie" },
  { value: "HU", label: "Hongrie" },
  { value: "RO", label: "Roumanie" },
  { value: "BG", label: "Bulgarie" },
  { value: "GR", label: "Grèce" },
  { value: "TR", label: "Turquie" },
  { value: "US", label: "États-Unis" },
  { value: "CA", label: "Canada" },
  { value: "BR", label: "Brésil" },
  { value: "SN", label: "Sénégal" },
  { value: "CI", label: "Côte d’Ivoire" },
  { value: "CM", label: "Cameroun" },
  { value: "ML", label: "Mali" },
];

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const PASSPORT_DOCUMENT_CODE = "P";

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
    const parsed = Number(
      value.replace("€", "").replace(/\s/g, "").replace(",", ".")
    );

    if (Number.isFinite(parsed)) {
      return `${parsed.toFixed(2).replace(".", ",")} €`;
    }

    return value.includes("€") ? value : `${value} €`;
  }

  return "-";
}

function serviceLabel(code?: string) {
  return getCommercialLabel({ codigoServicioVenta: code, tipoServicioVenta: "P" });
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

function passengerTypeLabelWithAge(code?: string) {
  switch (code) {
    case "M":
      return "Senior (A partir de 60 ans)";
    case "A":
      return "Adulte (De 27 a 59 ans)";
    case "J":
      return "Jeune (De 14 a 26 ans)";
    case "N":
      return "Enfant (De 4 a 13 ans)";
    case "B":
      return "Bebe (De 0 a 3 ans)";
    default:
      return code || "-";
  }
}

function discountLabel(code?: string, apiLabel?: string) {
  if (apiLabel?.trim()) return apiLabel.trim();

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

function normalizeBirthDateInput(value: string) {
  const v = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  const fr = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (fr) {
    return `${fr[3]}-${fr[2]}-${fr[1]}`;
  }

  return v;
}

function formatPartialDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 2) return digits;
  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function normalizeDateFieldInput(value: string) {
  const v = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  const digits = v.replace(/\D/g, "").slice(0, 8);

  if (digits.length === 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    return `${yyyy}-${mm}-${dd}`;
  }

  return formatPartialDateInput(v);
}

function formatBirthDateForDisplay(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yyyy, mm, dd] = value.split("-");
    return `${dd}/${mm}/${yyyy}`;
  }
  return value;
}

function isValidBirthDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizeBirthDateInput(value));
}

function birthDateToApi(value: string) {
  const normalized = normalizeBirthDateInput(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized.replaceAll("-", "");
  }
  return "";
}

function dateIsoToApi(value: string) {
  const normalized = normalizeBirthDateInput(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized.replaceAll("-", "");
  }
  return "";
}

function createEmptyTraveler(defaultDocument = PASSPORT_DOCUMENT_CODE): TravelerForm {
  return {
    nombre: "",
    apellido1: "",
    apellido2: "",
    fechaNacimiento: "",
    documentValidUntil: "",
    specialAssistance: "",
    codigoPais: "FR",
    sexo: "H",
    tipoDocumento: defaultDocument,
    codigoDocumento: "",
  };
}

function buildTravelersFromFlow(
  flow: BookingFlow,
  defaultDocument: string
): TravelerForm[] {
  const passengerCount =
    flow.search.passengers.adults +
    flow.search.passengers.youth +
    flow.search.passengers.seniors +
    flow.search.passengers.children +
    flow.search.passengers.babies;

  return Array.from({ length: passengerCount }, (_, index) => {
    const existing = flow.travelers[index];

    if (existing) {
      return {
        nombre: existing.nombre || "",
        apellido1: existing.apellido1 || "",
        apellido2: existing.apellido2 || "",
        fechaNacimiento:
          /^\d{8}$/.test(existing.fechaNacimiento)
            ? `${existing.fechaNacimiento.slice(0, 4)}-${existing.fechaNacimiento.slice(
                4,
                6
              )}-${existing.fechaNacimiento.slice(6, 8)}`
            : existing.fechaNacimiento || "",
        documentValidUntil:
          existing.documentValidUntil && /^\d{8}$/.test(existing.documentValidUntil)
            ? `${existing.documentValidUntil.slice(
                0,
                4
              )}-${existing.documentValidUntil.slice(
                4,
                6
              )}-${existing.documentValidUntil.slice(6, 8)}`
            : existing.documentValidUntil || "",
        specialAssistance: existing.specialAssistance || "",
        codigoPais: existing.codigoPais || "FR",
        sexo: existing.sexo || "H",
        tipoDocumento: defaultDocument,
        codigoDocumento: existing.codigoDocumento || "",
      };
    }

    return createEmptyTraveler(defaultDocument);
  });
}

function buildVehicleInstances(vehicles: BookingVehicleSelection[]): VehicleForm[] {
  const expanded: VehicleForm[] = [];

  vehicles.forEach((vehicle, vehicleIndex) => {
    const quantity = vehicle.quantity > 0 ? vehicle.quantity : 1;

    for (let i = 0; i < quantity; i += 1) {
      expanded.push({
        ...vehicle,
        quantity: 1,
        id: `${vehicle.category}-${vehicleIndex}-${i}`,
        marque: vehicle.marque || "",
        modele: vehicle.modele || "",
        immatriculation: vehicle.immatriculation || "",
        driverPassengerIndex:
          typeof vehicle.driverPassengerIndex === "number"
            ? vehicle.driverPassengerIndex
            : 0,
      });
    }
  });

  return expanded;
}

function vehicleSummary(vehicles: VehicleForm[]) {
  if (vehicles.length === 0) return "Sans véhicule";

  return vehicles
    .map((vehicle) => vehicle.label)
    .join(" • ");
}

function animalsSummary(flow: BookingFlow) {
  const animals = flow.search.animals;
  if (!animals.enabled || animals.count <= 0) return "Sans animal";
  return `${animals.count} animal${animals.count > 1 ? "ux" : ""}`;
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

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
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

export default function PassagersPage() {
  const router = useRouter();

  const [flow, setFlowState] = useState<BookingFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [travelers, setTravelers] = useState<TravelerForm[]>([]);
  const [vehicles, setVehicles] = useState<VehicleForm[]>([]);
  const [mail, setMail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    async function loadData() {
      const currentFlow = getBookingFlow();

      if (
        !currentFlow.search.origen ||
        !currentFlow.search.destino ||
        !currentFlow.outbound.selectedDeparture
      ) {
        setError("Le dossier est incomplet. Merci de revenir au début.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        setFlowState(currentFlow);
        setTravelers(
          buildTravelersFromFlow(currentFlow, PASSPORT_DOCUMENT_CODE)
        );
        setVehicles(buildVehicleInstances(currentFlow.search.vehicles));
        setMail(currentFlow.contact.mail || "");
        setTelefono(currentFlow.contact.telefono || "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur inconnue.");
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const passengerCount = travelers.length;

  function updateTraveler(
    index: number,
    field: keyof TravelerForm,
    value: string
  ) {
    setTravelers((prev) =>
      prev.map((traveler, i) =>
        i === index ? { ...traveler, [field]: value } : traveler
      )
    );
  }

  function updateVehicle(
    id: string,
    field: keyof VehicleForm,
    value: string | number
  ) {
    setVehicles((prev) =>
      prev.map((vehicle) =>
        vehicle.id === id ? { ...vehicle, [field]: value } : vehicle
      )
    );
  }

  const travelerErrors = useMemo(() => {
    return travelers.map((traveler) => ({
      nombre: !traveler.nombre.trim(),
      apellido1: !traveler.apellido1.trim(),
      fechaNacimiento: !isValidBirthDate(traveler.fechaNacimiento),
      codigoPais: !traveler.codigoPais.trim(),
      sexo: !traveler.sexo,
      tipoDocumento: !traveler.tipoDocumento,
      codigoDocumento: !traveler.codigoDocumento.trim(),
    }));
  }, [travelers]);

  const vehicleErrors = useMemo(() => {
    return vehicles.map((vehicle) => ({
      marque: !String(vehicle.marque || "").trim(),
      modele: !String(vehicle.modele || "").trim(),
      immatriculation: !String(vehicle.immatriculation || "").trim(),
      driverPassengerIndex:
        typeof vehicle.driverPassengerIndex !== "number" ||
        vehicle.driverPassengerIndex < 0 ||
        vehicle.driverPassengerIndex >= passengerCount,
    }));
  }, [vehicles, passengerCount]);

  const contactErrors = useMemo(() => {
    return {
      mail: !mail.trim(),
      telefono: !telefono.trim(),
    };
  }, [mail, telefono]);

  const canSubmit = useMemo(() => {
    if (!flow) return false;
    if (!travelers.length) return false;

    const travelerHasErrors = travelerErrors.some((errors) =>
      Object.values(errors).some(Boolean)
    );

    const vehicleHasErrors = vehicleErrors.some((errors) =>
      Object.values(errors).some(Boolean)
    );

    return (
      !travelerHasErrors &&
      !vehicleHasErrors &&
      !Object.values(contactErrors).some(Boolean)
    );
  }, [flow, travelers.length, travelerErrors, vehicleErrors, contactErrors]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);

    if (!flow || !canSubmit) return;

    const normalizedTravelers: BookingTraveler[] = travelers.map(
      (traveler, index) => ({
        nombre: traveler.nombre.trim(),
        apellido1: traveler.apellido1.trim(),
        apellido2: "",
        fechaNacimiento: birthDateToApi(traveler.fechaNacimiento),
        documentValidUntil: dateIsoToApi(traveler.documentValidUntil),
        specialAssistance: traveler.specialAssistance.trim(),
        codigoPais: traveler.codigoPais.trim(),
        sexo: traveler.sexo,
        tipoDocumento: PASSPORT_DOCUMENT_CODE,
        codigoDocumento: traveler.codigoDocumento.trim(),
        tipoPasajero: getTipoPasajeroForPassengerIndex(
          flow.search.passengers,
          index
        ),
      })
    );

    const normalizedVehicles: BookingVehicleSelection[] = vehicles.map(
      (vehicle) => ({
        category: vehicle.category,
        quantity: 1,
        label: vehicle.label,
        driverPassengerIndex:
          typeof vehicle.driverPassengerIndex === "number"
            ? vehicle.driverPassengerIndex
            : 0,
        marque: String(vehicle.marque || "").trim().toUpperCase(),
        modele: String(vehicle.modele || "").trim().toUpperCase(),
        immatriculation: String(vehicle.immatriculation || "")
          .trim()
          .toUpperCase(),
        dimensions: vehicle.dimensions,
      })
    );

    const nextFlow: BookingFlow = {
      ...flow,
      travelers: normalizedTravelers,
      contact: {
        mail: mail.trim(),
        telefono: telefono.trim(),
      },
      search: {
        ...flow.search,
        vehicles: normalizedVehicles,
      },
    };

    setBookingFlow(nextFlow);
    router.push("/recapitulatif");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            Chargement des informations voyageurs...
          </div>
        </section>
      </main>
    );
  }

  if (error || !flow) {
    return (
      <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
        <section className="mx-auto max-w-7xl px-4 py-10">
          <div className="rounded-[28px] border border-red-200 bg-red-50 p-6 text-red-700 shadow-sm">
            {error || "Impossible de charger le dossier."}
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
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              2. Traversées et prix
            </span>
            <span className="flex-none rounded-full bg-white px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-[#163B6D] shadow-[0_6px_20px_rgba(12,36,67,0.12)]">
              3. Hébergement
            </span>
            <span className="flex-none rounded-full bg-[linear-gradient(135deg,#F28C28,#F7A744)] px-[0.95rem] py-[0.58rem] text-xs font-bold leading-none tracking-[0.01em] text-white shadow-[0_12px_28px_rgba(242,140,40,0.34)]">
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
                Informations voyageurs
              </h1>
              <p className="mt-2 text-sm text-white/85">
                Saisissez maintenant l’identité des voyageurs et les informations des véhicules du dossier.
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

      <section className="-mt-4 pb-24 lg:pb-10">
        <div className="mx-auto max-w-7xl px-4">
          <form
            onSubmit={handleSubmit}
            autoComplete="off"
            className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]"
          >
            <div className="space-y-6">
              <SectionCard
                title="Votre voyage sélectionné"
                subtitle="Retrouvez ici le résumé de votre traversée."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Aller
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {flow.outbound.selectedDeparture?.origen} →{" "}
                      {flow.outbound.selectedDeparture?.destino}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatApiDate(flow.outbound.selectedDeparture?.fechaSalida)} •{" "}
                      {formatApiTime(flow.outbound.selectedDeparture?.horaSalida)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {serviceLabel(flow.outbound.selectedDeparture?.codigoServicioVenta)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      Hébergement : {flow.outbound.accommodation?.label || "-"}
                    </p>
                  </div>

                  {flow.tripType === "round_trip" && flow.inbound?.selectedDeparture ? (
                    <div className="rounded-2xl bg-[#F3F6F7] p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Retour
                      </p>
                      <p className="mt-2 text-lg font-bold text-slate-900">
                        {flow.inbound.selectedDeparture.origen} →{" "}
                        {flow.inbound.selectedDeparture.destino}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {formatApiDate(flow.inbound.selectedDeparture.fechaSalida)} •{" "}
                        {formatApiTime(flow.inbound.selectedDeparture.horaSalida)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {serviceLabel(flow.inbound.selectedDeparture.codigoServicioVenta)}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Hébergement : {flow.inbound.accommodation?.label || "-"}
                      </p>
                    </div>
                  ) : null}
                </div>
              </SectionCard>

              {travelers.map((traveler, index) => {
                const errors = travelerErrors[index];
                const tipoPasajero = getTipoPasajeroForPassengerIndex(
                  flow.search.passengers,
                  index
                );
                const nationalityOptions = NATIONALITY_OPTIONS.some(
                  (option) => option.value === traveler.codigoPais
                )
                  ? NATIONALITY_OPTIONS
                  : traveler.codigoPais.trim()
                    ? [
                        {
                          value: traveler.codigoPais.trim(),
                          label: traveler.codigoPais.trim(),
                        },
                        ...NATIONALITY_OPTIONS,
                      ]
                    : NATIONALITY_OPTIONS;

                return (
                  <SectionCard
                    key={index}
                    title={`Passager ${index + 1} · ${passengerTypeLabel(
                      tipoPasajero
                    )}${index === 0 ? " · Titulaire de la réservation" : ""}`}
                    subtitle={passengerTypeLabelWithAge(tipoPasajero)}
                  >
                    <div className="mb-4 rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#163B6D]">
                        Informations d&apos;identite
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Renseignez les informations exactement comme sur votre
                        pièce d’identité.
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Genre du passager">
                        <SelectBase
                          value={traveler.sexo}
                          onChange={(e) =>
                            updateTraveler(index, "sexo", e.target.value)
                          }
                          hasError={submitted && !!errors?.sexo}
                        >
                          <option value="H">Homme</option>
                          <option value="M">Femme</option>
                        </SelectBase>
                      </Field>

                      <Field
                        label="Nom"
                        hint="Tel qu'il apparait sur le document."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.apellido1}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "apellido1",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. beni"
                          hasError={submitted && !!errors?.apellido1}
                        />
                      </Field>

                      <Field
                        label="Prénom"
                        hint="Prenom tel qu'il apparait sur le document."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.nombre}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "nombre",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. ali"
                          hasError={submitted && !!errors?.nombre}
                        />
                      </Field>

                      <Field label="Type de document">
                        <InputBase value="Passeport" readOnly />
                      </Field>

                      <Field
                        label="Numero du document"
                        hint="Sans espace inutile."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.codigoDocumento}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "codigoDocumento",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. PA1234567"
                          hasError={submitted && !!errors?.codigoDocumento}
                        />
                      </Field>

                      <Field label="Date de validite du document">
                        <InputBase
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={formatBirthDateForDisplay(
                            traveler.documentValidUntil
                          )}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "documentValidUntil",
                              normalizeDateFieldInput(e.target.value)
                            )
                          }
                          placeholder="JJ/MM/AAAA"
                        />
                      </Field>

                      <Field label="Date de naissance" hint="Format JJ/MM/AAAA">
                        <InputBase
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          value={formatBirthDateForDisplay(traveler.fechaNacimiento)}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "fechaNacimiento",
                              normalizeDateFieldInput(e.target.value)
                            )
                          }
                          placeholder="JJ/MM/AAAA"
                          hasError={submitted && !!errors?.fechaNacimiento}
                        />
                      </Field>

                      <Field label="Nationalite">
                        <SelectBase
                          value={traveler.codigoPais}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "codigoPais",
                              e.target.value
                            )
                          }
                          hasError={submitted && !!errors?.codigoPais}
                        >
                          <option value="">Choisir une nationalité</option>
                          {nationalityOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.value})
                            </option>
                          ))}
                        </SelectBase>
                      </Field>

                      <Field
                        label="Assistance speciale / besoin particulier"
                        hint="Facultatif."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.specialAssistance}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "specialAssistance",
                              e.target.value
                            )
                          }
                          placeholder="Ex. Mobilite reduite, accompagnement..."
                        />
                      </Field>
                    </div>
                  </SectionCard>
                );
              })}

              {vehicles.map((vehicle, index) => {
                const errors = vehicleErrors[index];

                return (
                  <SectionCard
                    key={vehicle.id}
                    title={`Véhicule ${index + 1}`}
                    subtitle={vehicle.label}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Marque">
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={String(vehicle.marque || "")}
                          onChange={(e) =>
                            updateVehicle(
                              vehicle.id,
                              "marque",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. RENAULT"
                          hasError={submitted && !!errors?.marque}
                        />
                      </Field>

                      <Field label="Modèle">
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={String(vehicle.modele || "")}
                          onChange={(e) =>
                            updateVehicle(
                              vehicle.id,
                              "modele",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. CLIO"
                          hasError={submitted && !!errors?.modele}
                        />
                      </Field>

                      <Field label="Immatriculation">
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={String(vehicle.immatriculation || "")}
                          onChange={(e) =>
                            updateVehicle(
                              vehicle.id,
                              "immatriculation",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. AB-123-CD"
                          hasError={submitted && !!errors?.immatriculation}
                        />
                      </Field>

                      <Field label="Conducteur du véhicule">
                        <SelectBase
                          value={String(
                            typeof vehicle.driverPassengerIndex === "number"
                              ? vehicle.driverPassengerIndex
                              : 0
                          )}
                          onChange={(e) =>
                            updateVehicle(
                              vehicle.id,
                              "driverPassengerIndex",
                              Number(e.target.value)
                            )
                          }
                          hasError={submitted && !!errors?.driverPassengerIndex}
                        >
                          {travelers.map((traveler, travelerIndex) => {
                            const name =
                              [traveler.nombre, traveler.apellido1]
                                .filter(Boolean)
                                .join(" ")
                                .trim() || `Voyageur ${travelerIndex + 1}`;

                            return (
                              <option
                                key={`${vehicle.id}-${travelerIndex}`}
                                value={travelerIndex}
                              >
                                {name}
                              </option>
                            );
                          })}
                        </SelectBase>
                      </Field>
                    </div>
                  </SectionCard>
                );
              })}

              <SectionCard
                title="Contact principal"
                subtitle="Utilisé pour le suivi du dossier et les emails."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Email">
                    <InputBase
                      type="email"
                      autoComplete="off"
                      spellCheck={false}
                      value={mail}
                      onChange={(e) => setMail(e.target.value)}
                      placeholder="Ex. test@test.fr"
                      hasError={submitted && contactErrors.mail}
                    />
                  </Field>

                  <Field label="Téléphone">
                    <InputBase
                      type="tel"
                      autoComplete="off"
                      spellCheck={false}
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      placeholder="Ex. 0612345678"
                      hasError={submitted && contactErrors.telefono}
                    />
                  </Field>
                </div>
              </SectionCard>
            </div>

            <aside className="space-y-6">
              <SectionCard
                title="Avant de continuer"
                subtitle="Vérifiez les informations essentielles de votre dossier."
              >
                <div className="space-y-4">
                  <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                    <p className="text-sm font-semibold text-[#1F2F46]">
                      Dossier
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {flow.tripType === "round_trip" ? "Aller-retour" : "Aller simple"} •{" "}
                      {discountLabel(
                        flow.search.bonificacion,
                        flow.search.bonificacionLabel
                      )}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {animalsSummary(flow)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-sm text-slate-700">
                      Les réductions éventuellement applicables seront précisées
                      à l&apos;étape suivante, avec le détail de chaque voyageur.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-sm font-semibold text-slate-700">
                      Hébergement
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Aller : {flow.outbound.accommodation?.label || "-"}
                    </p>
                    {flow.tripType === "round_trip" ? (
                      <p className="mt-1 text-sm text-slate-600">
                        Retour : {flow.inbound?.accommodation?.label || "-"}
                      </p>
                    ) : null}
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-sm font-semibold text-slate-700">
                      Véhicules
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {vehicleSummary(vehicles)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
                    <p className="text-sm font-semibold text-[#1F2F46]">
                      Total provisoire
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {formatMoney(flow.totals.finalTotal)}
                    </p>
                    {flow.totals.finalTotal?.trim() ? (
                      <div className="mt-2 space-y-1 text-sm text-slate-600">
                        <p>
                          Transport (base) :{" "}
                          {flow.totals.transportOutbound || "-"}
                          {flow.tripType === "round_trip" &&
                          flow.totals.transportInbound
                            ? ` · retour ${flow.totals.transportInbound}`
                            : ""}
                        </p>
                        <p>
                          Supplément confort :{" "}
                          {flow.totals.accommodationOutbound || "0,00 €"}
                          {flow.tripType === "round_trip" &&
                          flow.totals.accommodationInbound
                            ? ` · retour ${flow.totals.accommodationInbound}`
                            : ""}
                        </p>
                      </div>
                    ) : null}
                  </div>

                  {submitted && !canSubmit && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                      Merci de compléter tous les champs obligatoires.
                    </div>
                  )}

                  <div className="hidden lg:block">
                    <button
                      type="submit"
                      disabled={!canSubmit}
                      className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Continuer vers le récapitulatif
                    </button>
                  </div>
                </div>
              </SectionCard>
            </aside>

            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Continuer vers le récapitulatif
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
