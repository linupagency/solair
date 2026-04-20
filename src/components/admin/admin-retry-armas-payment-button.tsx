"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type AdminRetryArmasPaymentButtonProps = {
  draftId: string;
  codigoLocata: string;
};

export function AdminRetryArmasPaymentButton({
  draftId,
  codigoLocata,
}: AdminRetryArmasPaymentButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function handleRetry() {
    setMessage("");
    setError("");

    startTransition(async () => {
      try {
        const response = await fetch("/api/admin/bookings/retry-armas-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ draftId }),
        });

        const json = (await response.json()) as {
          ok?: boolean;
          message?: string;
        };

        if (!response.ok || !json.ok) {
          throw new Error(
            json.message || "Impossible de relancer la finalisation Armas."
          );
        }

        setMessage(
          json.message ||
            `La finalisation Armas a été relancée pour ${codigoLocata}.`
        );
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Erreur inconnue pendant la relance Armas."
        );
      }
    });
  }

  return (
    <div className="rounded-[22px] border border-[#eadfd3] bg-[#fcfaf7] px-4 py-4">
      <p className="text-sm font-medium text-[#8d7764]">
        Relance de la finalisation Armas
      </p>
      <p className="mt-2 text-sm text-[#6f5e50]">
        La réservation {codigoLocata} existe déjà chez Armas. Cette action
        relance uniquement `nasaPagos` pour éviter tout doublon.
      </p>

      <button
        type="button"
        onClick={handleRetry}
        disabled={pending}
        className="mt-4 rounded-2xl bg-[#163B6D] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#123157] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Relance en cours..." : "Relancer la finalisation"}
      </button>

      {message ? (
        <p className="mt-3 rounded-2xl border border-[#cfe4d9] bg-[#eef9f0] px-4 py-3 text-sm text-[#2f6b44]">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-2xl border border-[#f3d5cc] bg-[#fff1ed] px-4 py-3 text-sm text-[#9d4b38]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
