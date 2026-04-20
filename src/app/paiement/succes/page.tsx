"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    status: "draft" | "reserved";
    payload: DraftPayload;
    reservation?: {
      codigoLocata?: string;
      total?: string;
      fechaValidezReserva?: string;
      businessCode?: string;
    };
  };
};

type CaptureResponse = {
  ok: boolean;
  message?: string;
  error?: string;
  orderID?: string | null;
  orderStatus?: string | null;
  captureID?: string | null;
  captureStatus?: string | null;
  amount?: string | null;
  currency?: string | null;
};

type BookingResponse = {
  ok: boolean;
  message?: string;
  businessCode?: string | null;
  businessText?: string | null;
  alreadyReserved?: boolean;
  reservation?: {
    codigoLocata?: string;
    total?: string;
    fechaValidezReserva?: string;
    businessCode?: string;
  };
};

const REAL_BOOKING_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_REAL_BOOKING === "true";

function buildConfirmationUrl(params: {
  codigoLocata: string;
  total: string;
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  nombre: string;
  apellido1: string;
  passengersData?: Traveler[];
}) {
  const query = new URLSearchParams({
    codigoLocata: params.codigoLocata || "",
    total: params.total || "",
    origen: params.origen,
    destino: params.destino,
    fechaSalida: params.fechaSalida,
    horaSalida: params.horaSalida,
    nombre: params.nombre,
    apellido1: params.apellido1,
  });

  if (params.passengersData && params.passengersData.length > 0) {
    query.set("passengersData", JSON.stringify(params.passengersData));
  }

  return `/confirmation?${query.toString()}`;
}

function buildProblemReservationUrl(params: {
  orderID: string;
  captureID: string;
  amount: string;
  currency: string;
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  nombre: string;
  apellido1: string;
  passengersData?: Traveler[];
  testMode?: boolean;
  testEmailsSent?: boolean;
  testEmailError?: string;
}) {
  const query = new URLSearchParams({
    orderID: params.orderID,
    captureID: params.captureID,
    amount: params.amount,
    currency: params.currency,
    origen: params.origen,
    destino: params.destino,
    fechaSalida: params.fechaSalida,
    horaSalida: params.horaSalida,
    nombre: params.nombre,
    apellido1: params.apellido1,
  });

  if (params.passengersData && params.passengersData.length > 0) {
    query.set("passengersData", JSON.stringify(params.passengersData));
  }

  if (params.testMode) {
    query.set("testMode", "1");
  }

  if (typeof params.testEmailsSent === "boolean") {
    query.set("testEmailsSent", params.testEmailsSent ? "1" : "0");
  }

  if (params.testEmailError) {
    query.set("testEmailError", params.testEmailError);
  }

  return `/paiement/probleme-reservation?${query.toString()}`;
}

function PaiementSuccesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const token = searchParams.get("token") || "";
  const payerId = searchParams.get("PayerID") || "";
  const draftId = searchParams.get("draftId") || "";

  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("Initialisation...");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function finalizeAfterPayment() {
      if (!token.trim()) {
        setError("Aucun token PayPal n’a été reçu dans l’URL de retour.");
        setLoading(false);
        return;
      }

      if (!draftId.trim()) {
        setError("Aucun draftId n’a été reçu dans l’URL de retour.");
        setLoading(false);
        return;
      }

      try {
        setStep("Récupération du draft de réservation...");

        const draftResponse = await fetch(
          `/api/booking/draft?draftId=${encodeURIComponent(draftId)}`,
          { cache: "no-store" }
        );

        const draftJson: DraftResponse = await draftResponse.json();

        if (!draftResponse.ok || !draftJson.ok || !draftJson.data?.payload) {
          throw new Error(
            draftJson.message || "Impossible de récupérer le draft."
          );
        }

        const draft = draftJson.data;
        const draftPayload = draft.payload;

        // Idempotence : si déjà réservé, on renvoie directement vers la confirmation
        if (draft.status === "reserved" && draft.reservation?.codigoLocata) {
          router.replace(
            buildConfirmationUrl({
              codigoLocata: draft.reservation.codigoLocata || "",
              total: draft.reservation.total || draftPayload.total || "",
              origen: draftPayload.origen,
              destino: draftPayload.destino,
              fechaSalida: draftPayload.fechaSalida,
              horaSalida: draftPayload.horaSalida,
              nombre: draftPayload.nombre,
              apellido1: draftPayload.apellido1,
              passengersData: draftPayload.passengersData,
            })
          );
          return;
        }

        setStep("Capture du paiement PayPal...");

        const captureResponse = await fetch("/api/paypal/capture-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            orderID: token,
            draftId,
          }),
        });

        const captureJson: CaptureResponse = await captureResponse.json();

        if (!captureResponse.ok || !captureJson.ok) {
          throw new Error(
            captureJson.error ||
              captureJson.message ||
              "Impossible de capturer le paiement PayPal."
          );
        }

        const draftTotalNum = Number(String(draftPayload.total || "").trim());
        const capturedAmountNum = Number(String(captureJson.amount || "").trim());
        if (
          Number.isFinite(draftTotalNum) &&
          Number.isFinite(capturedAmountNum) &&
          Math.abs(draftTotalNum - capturedAmountNum) > 0.01
        ) {
          throw new Error(
            `Montant capturé PayPal (${capturedAmountNum.toFixed(2)}) différent du montant autoritaire du draft (${draftTotalNum.toFixed(2)}).`
          );
        }

        if (!REAL_BOOKING_ENABLED) {
          setStep("Retour de paiement validé en mode test...");

          let testEmailsSent = false;
          let testEmailError = "";

          try {
            const testEmailResponse = await fetch(
              "/api/booking/send-test-emails-after-payment",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  draftId,
                  capturedAmount: captureJson.amount || draftPayload.total || "",
                }),
              }
            );

            const testEmailJson = (await testEmailResponse.json()) as {
              ok?: boolean;
              message?: string;
            };

            testEmailsSent = Boolean(testEmailResponse.ok && testEmailJson.ok);
            testEmailError =
              !testEmailsSent && typeof testEmailJson.message === "string"
                ? testEmailJson.message
                : "";
          } catch (err) {
            testEmailError =
              err instanceof Error
                ? err.message
                : "Erreur inconnue pendant l’envoi des emails de test.";
          }

          router.replace(
            buildProblemReservationUrl({
              orderID: captureJson.orderID || token,
              captureID: captureJson.captureID || "",
              amount: captureJson.amount || draftPayload.total || "",
              currency: captureJson.currency || "EUR",
              origen: draftPayload.origen,
              destino: draftPayload.destino,
              fechaSalida: draftPayload.fechaSalida,
              horaSalida: draftPayload.horaSalida,
              nombre: draftPayload.nombre,
              apellido1: draftPayload.apellido1,
              passengersData: draftPayload.passengersData,
              testMode: true,
              testEmailsSent,
              testEmailError,
            })
          );
          return;
        }

        setStep("Création de la réservation transporteur...");

        const bookingResponse = await fetch(
          "/api/booking/create-after-payment",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              draftId,
              capturedAmount: captureJson.amount || "",
            }),
          }
        );

        const bookingJson: BookingResponse = await bookingResponse.json();

        if (
          !bookingResponse.ok ||
          !bookingJson.ok ||
          !bookingJson.reservation?.codigoLocata
        ) {
          router.replace(
            buildProblemReservationUrl({
              orderID: captureJson.orderID || token,
              captureID: captureJson.captureID || "",
              amount: captureJson.amount || draftPayload.total || "",
              currency: captureJson.currency || "EUR",
              origen: draftPayload.origen,
              destino: draftPayload.destino,
              fechaSalida: draftPayload.fechaSalida,
              horaSalida: draftPayload.horaSalida,
              nombre: draftPayload.nombre,
              apellido1: draftPayload.apellido1,
              passengersData: draftPayload.passengersData,
              testMode: false,
            })
          );
          return;
        }

        const reservation = bookingJson.reservation;

        router.replace(
          buildConfirmationUrl({
            codigoLocata: reservation.codigoLocata || "",
            total: reservation.total || draftPayload.total || "",
            origen: draftPayload.origen,
            destino: draftPayload.destino,
            fechaSalida: draftPayload.fechaSalida,
            horaSalida: draftPayload.horaSalida,
            nombre: draftPayload.nombre,
            apellido1: draftPayload.apellido1,
            passengersData: draftPayload.passengersData,
          })
        );
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Erreur inconnue pendant la finalisation du paiement."
          );
          setLoading(false);
        }
      }
    }

    finalizeAfterPayment();

    return () => {
      cancelled = true;
    };
  }, [draftId, payerId, router, token]);

  return (
    <main className="min-h-screen bg-[#F7F5F2] text-slate-900">
      <section className="bg-[#163B6D] pb-8 pt-5">
        <div className="mx-auto max-w-5xl px-4">
          <p className="text-sm font-medium uppercase tracking-[0.16em] text-white/80">
            Solair Voyages
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">
            Paiement validé
          </h1>
          <p className="mt-2 text-sm text-white/85">
            Finalisation de votre réservation en cours.
          </p>
        </div>
      </section>

      <section className="-mt-4 pb-10">
        <div className="mx-auto max-w-5xl px-4">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
            {loading && !error && (
              <>
                <h2 className="text-xl font-bold text-slate-900">
                  Traitement en cours
                </h2>
                <p className="mt-3 text-slate-600">{step}</p>

                <div className="mt-6 rounded-2xl bg-[#F4FAFF] p-4 ring-1 ring-[#CDE4F7]">
                  <p className="text-sm text-slate-600 break-all">
                    token: {token || "absent"}
                    {payerId ? ` • PayerID: ${payerId}` : ""}
                    {draftId ? ` • draftId: ${draftId}` : ""}
                  </p>
                </div>
              </>
            )}

            {!loading && error && (
              <>
                <h2 className="text-xl font-bold text-slate-900">
                  Finalisation impossible
                </h2>
                <p className="mt-3 text-slate-600">{error}</p>

                <div className="mt-6 rounded-2xl bg-[#FBE9E7] p-4 ring-1 ring-[#E9B8B2]">
                  <p className="text-sm font-semibold text-[#1F2F46]">
                    Détail utile
                  </p>
                  <p className="mt-2 text-sm text-slate-600 break-all">
                    token: {token || "absent"}
                    {payerId ? ` • PayerID: ${payerId}` : ""}
                    {draftId ? ` • draftId: ${draftId}` : ""}
                  </p>
                </div>

                <div className="mt-6">
                  <Link
                    href="/"
                    className="inline-flex rounded-[22px] border border-slate-300 px-5 py-3 text-base font-bold text-slate-900 transition hover:bg-slate-50"
                  >
                    Retour à l’accueil
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default function PaiementSuccesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#F7F5F2] p-10 text-slate-600">
          Finalisation du paiement…
        </main>
      }
    >
      <PaiementSuccesContent />
    </Suspense>
  );
}
