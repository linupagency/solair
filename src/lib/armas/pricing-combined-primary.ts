/**
 * Service « principal » autorisé pour un appel `nasaTarificaciones` **combiné**
 * passager (type P) + véhicule (companion type V).
 * Les annexes / animaux / extras (ex. MCA|X) ne doivent pas être le primaire.
 */

const COMBINED_PRIMARY_BLOCKED_CODIGOS = new Set([
  "MCA",
  "MAD",
  "WF",
  "LOP",
  "SIA",
  "POM",
]);

/**
 * Codigos paliers « véhicule » Armas réutilisés côté catalogue.
 * En `tipoServicioVenta === "P"`, ce ne sont pas des fauteuils/sièges à combiner
 * avec un companion VR|V (ex. Y|P = passager, pas « voiture moyenne » seule).
 */
const VEHICLE_CATALOG_CODIGOS = new Set([
  "V",
  "X",
  "Y",
  "VR",
  "XR",
  "YR",
  "AC",
  "MT",
  "BI",
]);

export type PricingPrimaryServiceLike = {
  codigoServicioVenta?: string;
  tipoServicioVenta?: string;
};

/** Codes passager à ne pas tarifer pour les cartes transport (annexes / animaux / etc.). */
export function isTransportPricingBlockedCodigo(codigo: string): boolean {
  return COMBINED_PRIMARY_BLOCKED_CODIGOS.has(codigo.trim().toUpperCase());
}

export function isPrimaryServiceEligibleForVehicleCompanionPricing(
  service: PricingPrimaryServiceLike
): boolean {
  const c = (service.codigoServicioVenta || "").trim().toUpperCase();
  const t = (service.tipoServicioVenta || "").trim().toUpperCase();
  if (!c || !t) return false;
  if (COMBINED_PRIMARY_BLOCKED_CODIGOS.has(c)) return false;
  if (t === "X") return false;
  if (t !== "P") return false;
  if (VEHICLE_CATALOG_CODIGOS.has(c)) return false;
  return true;
}
