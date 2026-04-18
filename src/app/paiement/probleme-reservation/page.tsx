"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function formatApiDate(value?: string) {
  if (!value || value.length !== 8) return value || "-";
  return `${value.slice(6, 8)}/${value.slice(4, 6)}/${value.slice(0, 4)}`;
}

function formatApiTime(value?: string) {
  if (!value || value.length !== 4) return value || "-";
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl bg-[#F3F6F7] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 break-all text-lg font-bold text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-sm text-slate-600">{hint}</p> : null}
    </div>
  );
}

function ProblemeReservationContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const orderID = searchParams.get("orderID") || "-";
  const captureID = searchParams.get("captureID") || "-";
  const amount = searchParams.get("amount") || "-";
  const currency = searchParams.get("currency") || "EUR";
  const testMode = searchParams.get("testMode") === "1";
  const testEmailsSent = searchParams.get("testEmailsSent") === "1";
  const testEmailError = searchParams.get("testEmailError") || "";

  const origen = searchParams.get("origen") || "-";
  const destino = searchParams.get("destino") || "-";
  const fechaSalida = searchParams.get("fechaSalida") || "-";
  const horaSalida = searchParams.get("horaSalida") || "-";
  const nombre = searchParams.get("nombre") || "";
  const apellido1 = searchParams.get("apellido1") || "";

  const fullName = [nombre, apellido1].filter(Boolean).join(" ") || "-";

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-6xl px-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
            Solair Voyages
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            {testMode
              ? "Paiement test reçu, réservation réelle non envoyée"
              : "Paiement reçu, réservation en attente"}
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-white/85">
            {testMode
              ? "Le paiement PayPal sandbox a bien été capturé. Le retour de paiement a donc été testé correctement, mais aucune réservation réelle n’a été envoyée au transporteur tant que le mode production reste désactivé."
              : "Le paiement a bien été capturé, mais la réservation n’a pas encore été finalisée automatiquement côté transporteur. Le dossier doit être vérifié avant confirmation définitive."}
          </p>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:p-6">
              <div className="rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                <p className="text-sm font-semibold text-[#1F2F46]">
                  {testMode ? "Mode test confirmé" : "Action requise"}
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {testMode
                    ? "Le paiement est bien validé et le parcours de retour fonctionne. Cette page confirme simplement que la réservation réelle reste volontairement bloquée pendant les tests."
                    : "Le paiement est validé, mais la réservation n’a pas encore été créée automatiquement. Cette page sert à traiter proprement ce cas sensible, sans afficher une fausse confirmation au client."}
                </p>
              </div>

              {testMode && (
                <div
                  className={`mt-4 rounded-2xl p-4 ring-1 ${
                    testEmailsSent
                      ? "bg-[#EEF9F0] ring-[#B9E3C1]"
                      : "bg-[#FFF7ED] ring-[#F5D1A3]"
                  }`}
                >
                  <p className="text-sm font-semibold text-[#1F2F46]">
                    Emails de test
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    {testEmailsSent
                      ? "Les deux emails de test ont bien été envoyés : un au client et un à Solair Voyages."
                      : "Le retour de paiement est validé, mais l’envoi des emails de test n’a pas encore abouti."}
                  </p>
                  {!testEmailsSent && testEmailError ? (
                    <p className="mt-2 break-words text-sm text-[#9A3412]">
                      Détail : {testEmailError}
                    </p>
                  ) : null}
                </div>
              )}

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoCard
                  label="Voyageur"
                  value={fullName}
                  hint="Identité saisie au moment de la réservation."
                />
                <InfoCard
                  label="Trajet"
                  value={`${origen} → ${destino}`}
                  hint={`${formatApiDate(fechaSalida)} • ${formatApiTime(horaSalida)}`}
                />
                <InfoCard
                  label="Order ID PayPal"
                  value={orderID}
                  hint="Référence de la commande PayPal."
                />
                <InfoCard
                  label="Capture ID"
                  value={captureID}
                  hint="Référence de capture du paiement."
                />
              </div>

              <div className="mt-6 rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                <p className="text-sm font-semibold text-[#1F2F46]">
                  Recommandation de traitement
                </p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {testMode ? (
                    <>
                      <li>Vérifier que le retour PayPal sandbox affiche bien les bonnes informations.</li>
                      <li>Confirmer ensuite l’activation du mode production seulement quand vous voudrez ouvrir les ventes réelles.</li>
                      <li>Tant que le mode test reste actif, aucune réservation réelle ne partira côté transporteur.</li>
                    </>
                  ) : (
                    <>
                      <li>Vérifier manuellement la disponibilité et l’état de la réservation.</li>
                      <li>Créer la réservation transporteur uniquement après contrôle.</li>
                      <li>Si la réservation est impossible, traiter le dossier selon la procédure de remboursement ou de support.</li>
                    </>
                  )}
                </ul>
              </div>
            </section>

            <aside className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)] sm:p-6">
              <h2 className="text-xl font-bold text-slate-900">Paiement</h2>

              <div className="mt-5 rounded-2xl bg-[#FFF7EE] p-5 ring-1 ring-[#F5D1A3]">
                <p className="text-sm font-semibold text-slate-600">
                  Montant capturé
                </p>
                <p className="mt-2 text-4xl font-bold text-slate-900">
                  {amount} {currency}
                </p>
              </div>

              <div className="mt-5 rounded-2xl bg-[#F3F6F7] p-4">
                <p className="text-sm font-semibold text-slate-700">
                  Statut actuel
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  {testMode
                    ? "Paiement PayPal sandbox confirmé, réservation réelle volontairement non envoyée."
                    : "Paiement PayPal confirmé, réservation transporteur non finalisée automatiquement."}
                </p>
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => router.push("/")}
                  className="w-full rounded-[22px] bg-[#F28C28] px-5 py-4 text-base font-bold text-white transition hover:bg-[#E57C12]"
                >
                  Retour à l’accueil
                </button>

                <button
                  type="button"
                  onClick={() => router.back()}
                  className="w-full rounded-[22px] border border-slate-300 px-5 py-4 text-base font-bold text-slate-900 transition hover:bg-slate-50"
                >
                  Retour à l’étape précédente
                </button>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function ProblemeReservationPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Chargement…
        </main>
      }
    >
      <ProblemeReservationContent />
    </Suspense>
  );
}
