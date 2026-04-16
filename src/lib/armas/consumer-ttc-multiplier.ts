/**
 * Ajustement optionnel des montants issus de `nasaTarificaciones` pour les aligner
 * sur les totaux « grand public » (ex. API JSON armastrasmediterranea.com).
 *
 * Le WSDL `PrecioEntidad` ne précise pas si `total` est net ou TTC. Sur des cas réels
 * observés (passager + véhicule, AR), les totaux publics coïncident avec
 * `PrecioEntidad.total × 1,21` (TVA ES 21 %). À valider sur votre environnement
 * (`nasaReservas`, `nasaPagos`, montant PayPal) avant activation en production.
 */

function parsePositiveFiniteNumber(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Multiplicateur appliqué aux montants euros renvoyés par `fetchTransportPricing`.
 * Exemple site public TTC depuis SOAP HT : `1.21`.
 * Désactivé si absent ou invalide (comportement = 1).
 */
export function getConsumerTtcMultiplier(): number {
  if (typeof process === "undefined") return 1;
  const raw =
    process.env.NEXT_PUBLIC_SOLAIR_ARMAS_CONSUMER_TTC_MULTIPLIER ||
    process.env.SOLAIR_ARMAS_CONSUMER_TTC_MULTIPLIER ||
    "";
  const m = parsePositiveFiniteNumber(raw);
  return m ?? 1;
}

export function roundMoneyEuros(value: number): number {
  return Math.round(value * 100) / 100;
}

export function applyConsumerTtcToEuros(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return value;
  const m = getConsumerTtcMultiplier();
  if (m === 1) return roundMoneyEuros(value);
  return roundMoneyEuros(value * m);
}
