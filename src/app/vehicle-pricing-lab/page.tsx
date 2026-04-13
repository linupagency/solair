"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

/**
 * UI de test pour `/api/armas/vehicle-pricing-lab`.
 * Activer côté serveur : `SOLAIR_VEHICLE_PRICING_LAB=1` dans `.env.local`.
 */
export default function VehiclePricingLabPage() {
  const [origen, setOrigen] = useState("ALG");
  const [destino, setDestino] = useState("PTM");
  const [fechaSalida, setFechaSalida] = useState("20260413");
  const [horaSalida, setHoraSalida] = useState("2130");
  const [bonificacion, setBonificacion] = useState("G");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [jsonText, setJsonText] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setJsonText("");
    const q = new URLSearchParams({
      origen: origen.trim(),
      destino: destino.trim(),
      fechaSalida: fechaSalida.trim(),
      horaSalida: horaSalida.trim(),
      bonificacion: bonificacion.trim() || "G",
    });
    try {
      const res = await fetch(`/api/armas/vehicle-pricing-lab?${q}`);
      const data = await res.json().catch(() => ({}));
      setJsonText(JSON.stringify(data, null, 2));
      if (res.status === 403) {
        setError(
          "Lab désactivé : définir SOLAIR_VEHICLE_PRICING_LAB=1 dans .env.local puis redémarrer le serveur."
        );
      } else if (!res.ok) {
        setError(
          typeof data.message === "string"
            ? data.message
            : `HTTP ${res.status}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6fb] px-4 py-10 text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Lab tarification véhicule (Armas)
          </h1>
          <Link
            href="/"
            className="text-sm font-medium text-sky-700 underline-offset-4 hover:underline"
          >
            Accueil
          </Link>
        </div>
        <p className="text-sm text-slate-600">
          Appelle l’API de scénarios figés (sans véhicule, compacte, compacte +
          remorque, moto, vélo) pour une salida donnée. Nécessite la config Armas
          complète et{" "}
          <code className="rounded bg-slate-200/80 px-1 py-0.5 text-xs">
            SOLAIR_VEHICLE_PRICING_LAB=1
          </code>
          .
        </p>

        <form
          onSubmit={onSubmit}
          className="grid gap-4 rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm sm:grid-cols-2 lg:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">origen</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={origen}
              onChange={(e) => setOrigen(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">destino</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">fechaSalida</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder="YYYYMMDD"
              value={fechaSalida}
              onChange={(e) => setFechaSalida(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">horaSalida</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              placeholder="HHmm"
              value={horaSalida}
              onChange={(e) => setHoraSalida(e.target.value)}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">bonificacion</span>
            <input
              className="rounded-lg border border-slate-200 px-3 py-2"
              value={bonificacion}
              onChange={(e) => setBonificacion(e.target.value)}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Appel…" : "Lancer les scénarios"}
            </button>
          </div>
        </form>

        {error ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            {error}
          </div>
        ) : null}

        {jsonText ? (
          <pre className="max-h-[70vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-950/95 p-4 text-xs leading-relaxed text-emerald-100">
            {jsonText}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
