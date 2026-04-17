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

/**
 * Mapping manuel des libellés commerciaux visibles en front.
 * Clé = `${codigoServicioVenta}|${tipoServicioVenta}` (en MAJUSCULES).
 *
 * Tu peux éditer ces valeurs directement selon les libellés validés métier.
 */
export const FRONT_COMMERCIAL_LABELS_BY_SERVICE_CODE: Record<string, string> = {
  "BY|P": "Fauteuil standard",
  "BP|P": "Fauteuil premium",
  "D|P": "Cabine double privative",
  "P|P": "Cabine double premium",
  "Q|P": "Cabine quadruple privative",
  "C|P": "Cabine quadruple premium",
  "V|V": "Véhicule standard",
  "Y|V": "Véhicule intermédiaire",
  "X|V": "Grand véhicule",
  "VR|V": "Véhicule + remorque (VR)",
  "XR|V": "Véhicule + remorque (XR)",
  "YR|V": "Véhicule + remorque (YR)",
  "AC|V": "Camping-car",
  "MT|V": "Moto",
  "BI|V": "Vélo",
  "BR|V": "Autobus + remorque",
};

export const FRONT_COMMERCIAL_DESCRIPTIONS_BY_SERVICE_CODE: Record<
  string,
  string
> = {
  "BY|P":
    "Place assise standard à bord pour voyager pendant la traversée.",
  "BP|P":
    "Siège plus confortable, généralement situé dans un salon dédié. Le niveau de service peut varier selon le navire.",
  "D|P":
    "Cabine privative pour 2 passagers, avec climatisation et rangements selon le navire.",
  "P|P":
    "Cabine premium pour 2 passagers, avec un niveau de confort supérieur selon le navire et la traversée.",
  "Q|P":
    "Cabine privative pour 4 passagers, avec climatisation et rangements selon le navire.",
  "C|P":
    "Cabine premium pour 4 passagers, avec un niveau de confort supérieur selon le navire et la traversée.",
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "");
}

function upper(value: string): string {
  return stripAccents(value).toUpperCase();
}

function prettifyCommercialText(raw: string): string {
  const cleaned = cleanupCommercialLabel(raw);
  if (!cleaned) return "";

  const isMostlyUppercase =
    cleaned === cleaned.toUpperCase() && /[A-Z]/.test(stripAccents(cleaned));
  if (!isMostlyUppercase) return cleaned;

  const lower = cleaned.toLocaleLowerCase("fr-FR");
  return lower.replace(
    /(^|[\s/+(])(\p{L})/gu,
    (match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`
  );
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

function serviceKey(service: ArmasLikeService): string {
  const codigo = (service.codigoServicioVenta || "").trim().toUpperCase();
  const tipo = (service.tipoServicioVenta || "").trim().toUpperCase();
  return `${codigo}|${tipo}`;
}

type CommercialCopy = {
  label: string;
  description: string;
};

function inferCommercialCopyFromLabel(
  service: ArmasLikeService
): CommercialCopy | null {
  const labelUpper = combinedServiceLabelUpper(service);
  if (!labelUpper) return null;

  const isSeat =
    labelUpper.includes("BUTACA") ||
    labelUpper.includes("FAUTEUIL") ||
    labelUpper.includes("ASIENTO") ||
    labelUpper.includes("POLTRONA");
  const isCabin =
    labelUpper.includes("CAMAROTE") ||
    labelUpper.includes("CABINA") ||
    labelUpper.includes("CABINE") ||
    /\bCABIN\b/.test(labelUpper);
  const isPremium =
    labelUpper.includes("PREFERENTE") ||
    labelUpper.includes("PREMIUM") ||
    labelUpper.includes("VIP") ||
    labelUpper.includes("PRIORITAIRE") ||
    labelUpper.includes("PRIORITARIO");
  const isDouble =
    labelUpper.includes("DOBLE") ||
    labelUpper.includes("DOUBLE") ||
    /\b2\b/.test(labelUpper);
  const isQuad =
    labelUpper.includes("CUADRUPLE") ||
    labelUpper.includes("QUADRUPLE") ||
    labelUpper.includes("CUATRO") ||
    /\b4\b/.test(labelUpper);

  if (isSeat && isPremium) {
    return {
      label: "Fauteuil premium",
      description:
        "Siège premium situé dans un salon dédié ou exclusif selon le navire. Un service de restauration peut être proposé selon la traversée.",
    };
  }

  if (isSeat) {
    return {
      label: "Fauteuil standard",
      description:
        "Place assise standard à bord pour voyager pendant la traversée.",
    };
  }

  if (isCabin && isDouble && isPremium) {
    return {
      label: "Cabine double premium",
      description:
        "Cabine privative premium pour 2 passagers, avec un niveau de confort supérieur selon le navire et la traversée.",
    };
  }

  if (isCabin && isDouble) {
    return {
      label: "Cabine double privative",
      description:
        "Cabine privative pour 2 passagers, avec climatisation et rangements selon le navire.",
    };
  }

  if (isCabin && isQuad && isPremium) {
    return {
      label: "Cabine quadruple premium",
      description:
        "Cabine privative premium pour 4 passagers, avec un niveau de confort supérieur selon le navire et la traversée.",
    };
  }

  if (isCabin && isQuad) {
    return {
      label: "Cabine quadruple privative",
      description:
        "Cabine privative pour 4 passagers, avec climatisation et rangements selon le navire.",
    };
  }

  return null;
}

export function getCommercialLabel(service: ArmasLikeService): string {
  const exactKey = serviceKey(service);
  if (FRONT_COMMERCIAL_LABELS_BY_SERVICE_CODE[exactKey]) {
    return FRONT_COMMERCIAL_LABELS_BY_SERVICE_CODE[exactKey];
  }

  const inferred = inferCommercialCopyFromLabel(service);
  if (inferred?.label) return inferred.label;

  const raw = service.textoCorto || service.textoLargo || "";
  const cleaned = prettifyCommercialText(raw);
  if (cleaned) return cleaned;

  // Fallback safe (ne montre pas le code).
  const kind = getCommercialKind(service);
  if (kind === "cabin") return "Cabine";
  if (kind === "seat") return "Fauteuil";
  if (kind === "pet") return "Animal";
  if (kind === "vehicle") return "Véhicule";
  return "Option";
}

export function getCommercialDescription(service: ArmasLikeService): string {
  const exactKey = serviceKey(service);
  if (FRONT_COMMERCIAL_DESCRIPTIONS_BY_SERVICE_CODE[exactKey]) {
    return FRONT_COMMERCIAL_DESCRIPTIONS_BY_SERVICE_CODE[exactKey];
  }

  const inferred = inferCommercialCopyFromLabel(service);
  if (inferred?.description) return inferred.description;

  const rawLong = prettifyCommercialText(service.textoLargo || "");
  const rawShort = prettifyCommercialText(service.textoCorto || "");
  if (rawLong && rawLong !== rawShort) return rawLong;

  const kind = getCommercialKind(service);
  if (kind === "cabin") {
    return "Cabine privative proposée sur cette traversée.";
  }
  if (kind === "seat") {
    return "Place assise proposée sur cette traversée.";
  }
  if (kind === "pet") {
    return "Option liée au transport d’animal.";
  }
  return "Service proposé sur cette traversée.";
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
