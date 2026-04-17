/**
 * Traces aller-retour côté client (navigateur) ou serveur (API).
 * En client Next, préférer `NEXT_PUBLIC_SOLAIR_ARMAS_RT_PRICING_DEBUG=1`
 * pour que la variable soit injectée au build.
 */

export function isArmasRtPricingDebugEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  return (
    process.env.SOLAIR_ARMAS_RT_PRICING_DEBUG === "1" ||
    process.env.NEXT_PUBLIC_SOLAIR_ARMAS_RT_PRICING_DEBUG === "1"
  );
}
