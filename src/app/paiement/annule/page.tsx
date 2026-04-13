"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Traveler = {
  nombre: string;
  apellido1: string;
  apellido2?: string;
  fechaNacimiento: string;
  codigoPais: string;
  sexo: string;
  tipoDocumento: string;
  codigoDocumento: string;
};

type DraftPayload = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  passengers: string;
  vehicle: string;
  nombre: string;
  apellido1: string;
  apellido2?: string;
  fechaNacimiento: string;
  codigoPais: string;
  sexo: string;
  codigoDocumento: string;
  tipoPasajero: string;
  bonificacion: string;
  tipoDocumento: string;
  mail: string;
  telefono: string;
  total: string;
  codigoTarifa: string;
  passengersData?: Traveler[];
};

type DraftResponse = {
  ok: boolean;
  message?: string;
  data?: {
    id: string;
    payload: DraftPayload;
  };
};

function formatApiDate(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
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

function PaiementAnnuleContent() {
  const searchParams = useSearchParams();
  const draftId = searchParams.get("draftId") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draftPayload, setDraftPayload] = useState<DraftPayload | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDraft() {
      if (!draftId.trim()) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(
          `/api/booking/draft?draftId=${encodeURIComponent(draftId)}`,
          { cache: "no-store" }
        );

        const json: DraftResponse = await response.json();

        if (!response.ok || !json.ok || !json.data?.payload) {
          throw new Error(json.message || "Impossible de récupérer le draft.");
        }

        if (!cancelled) {
          setDraftPayload(json.data.payload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Erreur inconnue."
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadDraft();

    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const recapUrl = useMemo(() => {
    if (!draftPayload) return "";

    const params = new URLSearchParams({
      origen: draftPayload.origen,
      destino: draftPayload.destino,
      fechaSalida: draftPayload.fechaSalida,
      horaSalida: draftPayload.horaSalida,
      codigoServicioVenta: draftPayload.codigoServicioVenta,
      tipoServicioVenta: draftPayload.tipoServicioVenta,
      passengers: draftPayload.passengers,
      vehicle: draftPayload.vehicle,
      nombre: draftPayload.nombre,
      apellido1: draftPayload.apellido1,
      apellido2: draftPayload.apellido2 || "",
      fechaNacimiento: draftPayload.fechaNacimiento,
      codigoPais: draftPayload.codigoPais,
      sexo: draftPayload.sexo,
      codigoDocumento: draftPayload.codigoDocumento,
      tipoPasajero: draftPayload.tipoPasajero,
      bonificacion: draftPayload.bonificacion,
      tipoDocumento: draftPayload.tipoDocumento,
      mail: draftPayload.mail,
      telefono: draftPayload.telefono,
    });

    if (
      draftPayload.passengersData &&
      draftPayload.passengersData.length > 0
    ) {
      params.set("passengersData", JSON.stringify(draftPayload.passengersData));
    }

    return `/recapitulatif?${params.toString()}`;
  }, [draftPayload]);

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-5xl px-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
            Solair Voyages
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            Paiement annulé
          </h1>
          <p className="mt-2 text-sm text-white/85">
            Le paiement n’a pas été finalisé. Aucune réservation ne doit être créée automatiquement.
          </p>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
            <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
              <h2 className="text-xl font-bold text-slate-900">
                Paiement interrompu
              </h2>
              <p className="mt-3 text-slate-600">
                Le client a quitté ou annulé le paiement. Aucun ordre de confirmation ne doit être affiché.
              </p>
            </div>

            {loading && (
              <div className="mt-6 rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                <p className="text-sm text-slate-600">
                  Chargement du dossier en cours...
                </p>
              </div>
            )}

            {!loading && error && (
              <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {!loading && draftPayload && (
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl bg-[#F3F6F7] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Trajet
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {draftPayload.origen} → {draftPayload.destino}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#F3F6F7] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Départ
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {formatApiDate(draftPayload.fechaSalida)} •{" "}
                    {formatApiTime(draftPayload.horaSalida)}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#F3F6F7] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Voyageurs
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {draftPayload.passengers}
                  </p>
                </div>

                <div className="rounded-2xl bg-[#F3F6F7] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Montant prévu
                  </p>
                  <p className="mt-2 text-lg font-bold text-slate-900">
                    {formatAmount(draftPayload.total)}
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              {recapUrl ? (
                <a
                  href={recapUrl}
                  className="inline-flex rounded-[22px] bg-[#F28C28] px-5 py-3 text-base font-bold text-white transition hover:bg-[#E57C12]"
                >
                  Retour au récapitulatif
                </a>
              ) : null}

              <a
                href="/"
                className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
              >
                Retour à l’accueil
              </a>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function PaiementAnnulePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Chargement…
        </main>
      }
    >
      <PaiementAnnuleContent />
    </Suspense>
  );
}