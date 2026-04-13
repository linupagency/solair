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

type DocumentType = {
  tipoDocumento?: string;
  textoCorto?: string;
  textoLargo?: string;
};

type DocumentTypesResponse = {
  tiposDocumentosEntidad?: {
    tipoDocumentoEntidad?: DocumentType[] | DocumentType;
  };
};

type ApiEnvelope<T> = {
  ok: boolean;
  message?: string;
  error?: string;
  data?: {
    return?: T;
  };
};

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

function passengerTypeLabelWithAge(code?: string) {
  switch (code) {
    case "M":
      return "Senior (A partir de 60 ans)";
    case "A":
      return "Adulte (De 27 a 59 ans)";
    case "J":
      return "Jeune (De 12 a 26 ans)";
    case "N":
      return "Enfant (De 4 a 11 ans)";
    case "B":
      return "Bebe (De 0 a 3 ans)";
    default:
      return code || "-";
  }
}

function discountLabel(code?: string) {
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

function createEmptyTraveler(defaultDocument = "P"): TravelerForm {
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
        tipoDocumento: existing.tipoDocumento || defaultDocument,
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

  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
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

        const response = await fetch(
          `/api/armas/test-document-types?origen=${encodeURIComponent(
            currentFlow.search.origen
          )}&destino=${encodeURIComponent(currentFlow.search.destino)}`,
          { cache: "no-store" }
        );

        const json: ApiEnvelope<DocumentTypesResponse> = await response.json();

        if (!response.ok || !json.ok) {
          throw new Error(
            json.error ||
              json.message ||
              "Impossible de charger les types de documents."
          );
        }

        const docs = normalizeArray(
          json.data?.return?.tiposDocumentosEntidad?.tipoDocumentoEntidad
        );

        setDocumentTypes(docs);

        const defaultDocument =
          docs.find((item) => item.tipoDocumento === "P")?.tipoDocumento ||
          docs[0]?.tipoDocumento ||
          "P";

        setTravelers(buildTravelersFromFlow(currentFlow, defaultDocument));
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
        apellido2: traveler.apellido2.trim(),
        fechaNacimiento: birthDateToApi(traveler.fechaNacimiento),
        documentValidUntil: dateIsoToApi(traveler.documentValidUntil),
        specialAssistance: traveler.specialAssistance.trim(),
        codigoPais: traveler.codigoPais.trim(),
        sexo: traveler.sexo,
        tipoDocumento: traveler.tipoDocumento,
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
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-7xl px-4">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#163B6D]">
              1. Recherche
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#163B6D]">
              2. Traversées et prix
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#163B6D]">
              3. Hébergement
            </span>
            <span className="rounded-full bg-[#F28C28] px-3 py-1 text-xs font-semibold text-white">
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
                Informations voyageurs
              </h1>
              <p className="mt-2 text-sm text-white/85">
                Saisissez maintenant l’identité des voyageurs et les informations des véhicules du dossier.
              </p>
            </div>

            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
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
                title="Segments sélectionnés"
                subtitle="Résumé du transport et de l’hébergement"
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
                        Informations d'identite
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Renseignez les donnees du document comme sur le formulaire
                        Armas.
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
                          placeholder="Ex. DUPONT"
                          hasError={submitted && !!errors?.apellido1}
                        />
                      </Field>

                      <Field
                        label="Premier nom"
                        hint="Premier prenom tel qu'il apparait sur le document."
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
                          placeholder="Ex. SAMIA"
                          hasError={submitted && !!errors?.nombre}
                        />
                      </Field>

                      <Field
                        label="Deuxieme nom / second prenom"
                        hint="Facultatif."
                      >
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.apellido2}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "apellido2",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Optionnel"
                        />
                      </Field>

                      <Field label="Type de document">
                        <SelectBase
                          value={traveler.tipoDocumento}
                          onChange={(e) =>
                            updateTraveler(index, "tipoDocumento", e.target.value)
                          }
                          hasError={submitted && !!errors?.tipoDocumento}
                        >
                          {documentTypes.map((item, docIndex) => (
                            <option
                              key={`${item.tipoDocumento || "DOC"}-${docIndex}`}
                              value={item.tipoDocumento || ""}
                            >
                              {item.textoCorto || item.tipoDocumento || "Document"} (
                              {item.tipoDocumento || "-"})
                            </option>
                          ))}
                        </SelectBase>
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
                              normalizeBirthDateInput(e.target.value)
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
                              normalizeBirthDateInput(e.target.value)
                            )
                          }
                          placeholder="JJ/MM/AAAA"
                          hasError={submitted && !!errors?.fechaNacimiento}
                        />
                      </Field>

                      <Field label="Nationalite">
                        <InputBase
                          autoComplete="off"
                          spellCheck={false}
                          value={traveler.codigoPais}
                          onChange={(e) =>
                            updateTraveler(
                              index,
                              "codigoPais",
                              e.target.value.toUpperCase()
                            )
                          }
                          placeholder="Ex. FR"
                          hasError={submitted && !!errors?.codigoPais}
                        />
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
                title="Vérification"
                subtitle="Contrôle avant le récapitulatif."
              >
                <div className="space-y-4">
                  <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                    <p className="text-sm font-semibold text-[#1F2F46]">
                      Dossier
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      {flow.tripType === "round_trip" ? "Aller-retour" : "Aller simple"} •{" "}
                      {discountLabel(flow.search.bonificacion)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {animalsSummary(flow)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                    <p className="text-sm text-slate-700">
                      Selon la nouvelle réglementation des Bonifications pour les
                      résidents non-péninsulaires et les familles nombreuses,
                      adoptée dans la Loi de Finances Générale pour 2021, la
                      réduction pour résidents sera indiquée et appliquée lors de
                      la dernière étape du processus d'achat, en même temps que
                      les données de chaque passager.
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