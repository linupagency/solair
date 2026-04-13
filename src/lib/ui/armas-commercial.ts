export type CommercialOfferKind =
  | "seat"
  | "cabin"
  | "pet"
  | "vehicle"
  | "unknown";

export type ArmasLikeService = {
  codigoServicioVenta?: string;
  tipoServicioVenta?: string;
  textoCorto?: string;
  textoLargo?: string;
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function upper(value: string): string {
  return stripAccents(value).toUpperCase();
}

export function combinedServiceLabel(service: ArmasLikeService): string {
  return `${service.textoCorto || ""} ${service.textoLargo || ""}`.trim();
}

export function combinedServiceLabelUpper(service: ArmasLikeService): string {
  return upper(combinedServiceLabel(service));
}

export function isVehicleService(service: ArmasLikeService): boolean {
  const codigo = (service.codigoServicioVenta || "").trim().toUpperCase();
  const tipo = (service.tipoServicioVenta || "").trim().toUpperCase();

  /**
   * WSDL / NASA : `tipoServicioVenta` « P » = vente passager (siège, duo, etc.).
   * Ne pas confondre avec un code `codigo` qui réutilise une lettre palier véhicule (ex. Y|V vs Y|P).
   * Sans ce garde-fou, un passager Y|P pouvait être classé « véhicule » → exclu du pricing
   * ou mélangé aux lignes catalogue véhicule, et le total affiché ne suivait plus la catégorie choisie.
   */
  if (tipo === "P") return false;

  // Armas: tipo "V" correspond classiquement à des lignes véhicule.
  if (tipo === "V") return true;

  // Codes observés (UX Solair): véhicule / remorque / moto (hors tipo P, filtré ci-dessus).
  if (["V", "X", "Y", "VR", "XR", "YR", "BR", "AC", "MT", "BI"].includes(codigo))
    return true;

  const label = combinedServiceLabelUpper(service);
  if (label.includes("VEHICULE") || label.includes("REMORQUE")) return true;
  if (label.includes("CAMPING-CAR") || label.includes("CAMPING CAR")) return true;
  if (/\bMOTO\b/.test(label)) return true;

  return false;
}

export function isAnimalService(service: ArmasLikeService): boolean {
  const codigo = (service.codigoServicioVenta || "").toUpperCase();
  const label = combinedServiceLabelUpper(service);

  if (label.includes("MASCOTA") || label.includes("MASCOTAS")) return true;
  if (label.includes("ANIMAL")) return true;
  if (/\bPET\b/.test(label)) return true;
  if (codigo.includes("MASCOTA")) return true;

  const cabinish =
    label.includes("CAMAROTE") ||
    label.includes("CABINA") ||
    label.includes("CABINE");
  if (
    cabinish &&
    (label.includes("MASCOTA") ||
      label.includes("MASCOTAS") ||
      label.includes("ANIMAL") ||
      /\bPET\b/.test(label))
  ) {
    return true;
  }

  return false;
}

export function getCommercialKind(service: ArmasLikeService): CommercialOfferKind {
  if (isVehicleService(service)) return "vehicle";
  if (isAnimalService(service)) return "pet";

  const label = combinedServiceLabelUpper(service);

  // Cabines.
  if (
    label.includes("CAMAROTE") ||
    label.includes("CABINA") ||
    label.includes("CABINE") ||
    /\bCABIN\b/.test(label)
  ) {
    return "cabin";
  }

  // Fauteuil / siège.
  if (
    label.includes("BUTACA") ||
    label.includes("FAUTEUIL") ||
    label.includes("ASIENTO") ||
    label.includes("POLTRONA") ||
    /\bSEAT\b/.test(label)
  ) {
    return "seat";
  }

  return "unknown";
}

function cleanupCommercialLabel(raw: string): string {
  const s = raw.trim();
  if (!s) return "";

  // Supprime des fragments trop techniques fréquents.
  return s
    .replace(/\s+/g, " ")
    .replace(/\b(COD|CODE)\b\s*[:\-]?\s*\w+/gi, "")
    .replace(/\(\s*[\w\-]{1,10}\s*\)/g, "")
    .trim();
}

export function getCommercialLabel(service: ArmasLikeService): string {
  const raw = service.textoCorto || service.textoLargo || "";
  const cleaned = cleanupCommercialLabel(raw);
  if (cleaned) return cleaned;

  // Fallback safe (ne montre pas le code).
  const kind = getCommercialKind(service);
  if (kind === "cabin") return "Cabine";
  if (kind === "seat") return "Fauteuil";
  if (kind === "pet") return "Animal";
  if (kind === "vehicle") return "Véhicule";
  return "Option";
}

export function getCommercialCTA(kind: CommercialOfferKind): string {
  if (kind === "cabin") return "Cabine";
  if (kind === "seat") return "Fauteuil";
  return "Choisir";
}

export function eurosFromDisplay(display?: string): number | null {
  if (!display?.trim()) return null;
  const n = Number(
    display.replace("€", "").replace(/\s/g, "").replace(",", ".").trim()
  );
  return Number.isFinite(n) ? n : null;
}

/** Somme de deux montants déjà formatés pour l’UI (ex. « 12,50 € »). */
export function sumDisplayedEuros(a: string, b: string): string {
  const na = eurosFromDisplay(a);
  const nb = eurosFromDisplay(b);
  if (na === null) return b;
  if (nb === null) return a;
  const sum = na + nb;
  return `${sum.toFixed(2).replace(".", ",")} €`;
}


