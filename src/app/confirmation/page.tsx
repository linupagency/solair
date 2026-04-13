"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

function parseTravelers(
  passengersData: string | null,
  fallback: {
    nombre: string;
    apellido1: string;
  }
): Traveler[] {
  if (passengersData) {
    try {
      const parsed = JSON.parse(passengersData) as Traveler[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // rien
    }
  }

  if (fallback.nombre || fallback.apellido1) {
    return [
      {
        nombre: fallback.nombre,
        apellido1: fallback.apellido1,
      },
    ];
  }

  return [];
}

function getTravelerFullName(traveler: Traveler) {
  return [traveler.nombre, traveler.apellido1, traveler.apellido2]
    .filter(Boolean)
    .join(" ");
}

function ConfirmationContent() {
  const searchParams = useSearchParams();

  const codigoLocata = searchParams.get("codigoLocata") || "-";
  const total = searchParams.get("total") || "-";
  const origen = searchParams.get("origen") || "-";
  const destino = searchParams.get("destino") || "-";
  const fechaSalida = searchParams.get("fechaSalida") || "-";
  const horaSalida = searchParams.get("horaSalida") || "-";
  const nombre = searchParams.get("nombre") || "";
  const apellido1 = searchParams.get("apellido1") || "";
  const passengersData = searchParams.get("passengersData");

  const [copyRefSuccess, setCopyRefSuccess] = useState(false);
  const [copySummarySuccess, setCopySummarySuccess] = useState(false);

  const travelers = useMemo(
    () =>
      parseTravelers(passengersData, {
        nombre,
        apellido1,
      }),
    [passengersData, nombre, apellido1]
  );

  const summaryText = useMemo(() => {
    const travelersText =
      travelers.length > 0
        ? travelers
            .map((traveler, index) => {
              return [
                `Voyageur ${index + 1}`,
                `Nom : ${getTravelerFullName(traveler) || "-"}`,
                `Date de naissance : ${formatApiDate(traveler.fechaNacimiento)}`,
                `Document : ${documentLabel(traveler.tipoDocumento)} ${
                  traveler.codigoDocumento || "-"
                }`,
                `Sexe : ${genderLabel(traveler.sexo)}`,
                `Pays : ${traveler.codigoPais || "-"}`,
              ].join("\n");
            })
            .join("\n\n")
        : "Aucun voyageur transmis";

    return [
      "Solair Voyages",
      "Réservation confirmée",
      `Référence : ${codigoLocata}`,
      `Montant : ${formatAmount(total)}`,
      `Trajet : ${origen} → ${destino}`,
      `Départ : ${formatApiDate(fechaSalida)} • ${formatApiTime(horaSalida)}`,
      "",
      travelersText,
    ].join("\n");
  }, [codigoLocata, total, origen, destino, fechaSalida, horaSalida, travelers]);

  async function handleCopyReference() {
    try {
      await navigator.clipboard.writeText(codigoLocata);
      setCopyRefSuccess(true);
      window.setTimeout(() => setCopyRefSuccess(false), 2000);
    } catch {
      setCopyRefSuccess(false);
    }
  }

  async function handleCopySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopySummarySuccess(true);
      window.setTimeout(() => setCopySummarySuccess(false), 2000);
    } catch {
      setCopySummarySuccess(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900 print:bg-white">
      <section className="bg-[#163B6D] pb-8 pt-5 print:bg-white print:pb-4 print:pt-0">
        <div className="mx-auto max-w-5xl px-4 print:px-0">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80 print:text-slate-500">
            Solair Voyages
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white print:text-slate-900">
            Réservation confirmée
          </h1>
          <p className="mt-2 text-sm text-white/85 print:text-slate-600">
            Votre réservation a bien été confirmée.
          </p>
        </div>
      </section>

      <section className="-mt-4 pb-10 print:mt-0 print:pb-0">
        <div className="mx-auto max-w-5xl px-4 print:px-0">
          <div className="mb-4 flex flex-wrap gap-3 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex rounded-[22px] bg-[#F28C28] px-5 py-3 text-base font-bold text-white transition hover:bg-[#E57C12]"
            >
              Imprimer
            </button>

            <button
              type="button"
              onClick={handleCopyReference}
              className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
            >
              Copier la référence
            </button>

            <button
              type="button"
              onClick={handleCopySummary}
              className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
            >
              Copier le récapitulatif
            </button>

            <a
              href="/retrouver-ma-reservation"
              className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
            >
              Retrouver ma réservation
            </a>

            <a
              href="/"
              className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
            >
              Retour à l’accueil
            </a>
          </div>

          {(copyRefSuccess || copySummarySuccess) && (
            <div className="mb-4 rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7] print:hidden">
              <p className="text-sm font-semibold text-slate-900">
                {copyRefSuccess
                  ? "Référence copiée."
                  : "Récapitulatif copié."}
              </p>
            </div>
          )}

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.05)] print:rounded-none print:border print:border-slate-300 print:p-6 print:shadow-none">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7] print:bg-white print:ring-0 print:border print:border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Référence
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {codigoLocata}
                </p>
              </div>

              <div className="rounded-2xl bg-[#FFF7EE] p-4 ring-1 ring-[#F5D1A3] print:bg-white print:ring-0 print:border print:border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Montant
                </p>
                <p className="mt-2 text-2xl font-bold text-slate-900">
                  {formatAmount(total)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#F3F6F7] p-4 print:bg-white print:border print:border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Trajet
                </p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {origen} → {destino}
                </p>
              </div>

              <div className="rounded-2xl bg-[#F3F6F7] p-4 print:bg-white print:border print:border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Départ
                </p>
                <p className="mt-2 text-lg font-bold text-slate-900">
                  {formatApiDate(fechaSalida)} • {formatApiTime(horaSalida)}
                </p>
              </div>

              <div className="rounded-2xl bg-[#F3F6F7] p-4 md:col-span-2 print:bg-white print:border print:border-slate-200">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Voyageurs
                </p>

                {travelers.length > 0 ? (
                  <div className="mt-3 space-y-3">
                    {travelers.map((traveler, index) => {
                      const fullName = getTravelerFullName(traveler);

                      return (
                        <div
                          key={index}
                          className="rounded-2xl bg-white p-4 ring-1 ring-slate-200 print:rounded-xl"
                        >
                          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                Voyageur {index + 1}
                              </p>
                              <p className="mt-2 text-lg font-bold text-slate-900">
                                {fullName || "-"}
                              </p>
                            </div>

                            {(traveler.codigoDocumento ||
                              traveler.tipoDocumento ||
                              traveler.fechaNacimiento ||
                              traveler.sexo ||
                              traveler.codigoPais) && (
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
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-lg font-bold text-slate-900">-</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ConfirmationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Chargement de la confirmation…
        </main>
      }
    >
      <ConfirmationContent />
    </Suspense>
  );
}