"use client";

import { FormEvent, useMemo, useState } from "react";

type Traveler = {
  nombre?: string;
  apellido1?: string;
  apellido2?: string;
  fechaNacimiento?: string;
  codigoPais?: string;
  sexo?: string;
  tipoDocumento?: string;
  codigoDocumento?: string;
};

type FindBookingResponse = {
  ok: boolean;
  message?: string;
  data?: {
    id: string;
    codigoLocata: string;
    total: string;
    fechaValidezReserva?: string;
    businessCode?: string;
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
    mail: string;
    telefono: string;
    travelers: Traveler[];
    createdAt: string;
    updatedAt: string;
  };
};

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

function formatAmount(value?: string) {
  const v = (value || "").trim();
  if (!v) return "-";
  if (v.includes("€") || v.toUpperCase().includes("EUR")) return v;
  return `${v} €`;
}

function genderLabel(value?: string) {
  switch ((value || "").trim()) {
    case "H":
      return "Homme";
    case "M":
      return "Femme";
    default:
      return value || "-";
  }
}

function documentLabel(value?: string) {
  switch ((value || "").trim()) {
    case "P":
      return "Passeport";
    case "D":
      return "Document d'identité";
    case "T":
      return "Titre de séjour";
    default:
      return value || "-";
  }
}

function travelerFullName(traveler: Traveler) {
  return [traveler.nombre, traveler.apellido1, traveler.apellido2]
    .filter(Boolean)
    .join(" ");
}

export default function RetrouverReservationPage() {
  const [codigoLocata, setCodigoLocata] = useState("");
  const [mail, setMail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [booking, setBooking] = useState<FindBookingResponse["data"]>();

  const canSubmit = useMemo(() => {
    return codigoLocata.trim().length > 0 && mail.trim().length > 0;
  }, [codigoLocata, mail]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!canSubmit) return;

    setLoading(true);
    setError("");
    setBooking(undefined);

    try {
      const response = await fetch("/api/booking/find", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          codigoLocata: codigoLocata.trim(),
          mail: mail.trim(),
        }),
      });

      const json = (await response.json()) as FindBookingResponse;

      if (!response.ok || !json.ok || !json.data) {
        throw new Error(
          json.message || "Impossible de retrouver la réservation."
        );
      }

      setBooking(json.data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Erreur inconnue."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-5xl px-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
            Solair Voyages
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            Retrouver ma réservation
          </h1>
          <p className="mt-2 text-sm text-white/85">
            Saisissez votre référence et l’email utilisé lors de la réservation.
          </p>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
            <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Référence de réservation
                </label>
                <input
                  value={codigoLocata}
                  onChange={(e) => setCodigoLocata(e.target.value)}
                  placeholder="Ex. 21769690"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-[#163B6D]"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">
                  Email
                </label>
                <input
                  type="email"
                  value={mail}
                  onChange={(e) => setMail(e.target.value)}
                  placeholder="Ex. client@email.fr"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base outline-none transition focus:border-[#163B6D]"
                />
              </div>

              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={!canSubmit || loading}
                  className="inline-flex rounded-[22px] bg-[#F28C28] px-5 py-3 text-base font-bold text-white transition hover:bg-[#E57C12] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {loading ? "Recherche en cours..." : "Retrouver ma réservation"}
                </button>
              </div>
            </form>

            {error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {booking && (
              <div className="mt-6 rounded-[28px] border border-slate-200 bg-white p-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Référence
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {booking.codigoLocata}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3]">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Montant
                    </p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">
                      {formatAmount(booking.total)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Trajet
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {booking.origen} → {booking.destino}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Départ
                    </p>
                    <p className="mt-2 text-lg font-bold text-slate-900">
                      {formatApiDate(booking.fechaSalida)} •{" "}
                      {formatApiTime(booking.horaSalida)}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Email
                    </p>
                    <p className="mt-2 text-base font-bold text-slate-900">
                      {booking.mail}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Téléphone
                    </p>
                    <p className="mt-2 text-base font-bold text-slate-900">
                      {booking.telefono || "-"}
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#F3F6F7] p-4 md:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Voyageurs
                    </p>

                    <div className="mt-3 space-y-3">
                      {booking.travelers.map((traveler, index) => (
                        <div
                          key={index}
                          className="rounded-2xl bg-white p-4 ring-1 ring-slate-200"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Voyageur {index + 1}
                              </p>
                              <p className="mt-2 text-lg font-bold text-slate-900">
                                {travelerFullName(traveler) || "-"}
                              </p>
                            </div>

                            <div className="md:text-right">
                              <p className="text-sm font-semibold text-slate-900">
                                {documentLabel(traveler.tipoDocumento)}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">
                                {traveler.codigoDocumento || "-"}
                              </p>
                              <p className="mt-1 text-sm text-slate-600">
                                {formatApiDate(traveler.fechaNacimiento)} •{" "}
                                {genderLabel(traveler.sexo)} •{" "}
                                {traveler.codigoPais || "-"}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}