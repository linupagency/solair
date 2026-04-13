/**
 * Normalisation des réponses nasaTarificaciones pour debug / comparaison A vs B.
 * Structure défensive (Armas peut renvoyer un objet ou un tableau).
 */

export type NormalizedTarificacionLine = {
  index: number;
  codigoServicioVenta?: string;
  tipoServicioVenta?: string;
  tarifaTextoCorto?: string;
  tarifaTextoLargo?: string;
  precioTotal?: string | number;
  bonificacionCodigo?: string;
  /** Ligne telle que renvoyée par le client SOAP (référence brute). */
  raw: unknown;
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function pickString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function parsePrecioTotalValue(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/\s/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function precioBlockHasTotal(total: unknown): boolean {
  if (total === undefined || total === null || total === "") return false;
  if (typeof total === "number" && Number.isFinite(total)) return true;
  if (typeof total === "string" && total.trim()) return true;
  return false;
}

/**
 * WSDL `TarificacionEntidad` : precioEntidad, precioIdaEntidad, precioVtaEntidad.
 * Armas place souvent le montant d’une ligne dans `precioIdaEntidad` (aller) plutôt que `precioEntidad`.
 */
function firstTotalInPrecioBlock(
  block: Record<string, unknown> | undefined
): string | number | undefined {
  if (!block) return undefined;
  const keys = ["total", "importe", "importeTotal", "precio", "valor"] as const;
  for (const k of keys) {
    const v = block[k];
    if (precioBlockHasTotal(v)) return v as string | number;
  }
  return undefined;
}

function pickLinePrecioTotal(
  line: Record<string, unknown>
): string | number | undefined {
  const pe = line.precioEntidad as Record<string, unknown> | undefined;
  const peTotal = firstTotalInPrecioBlock(pe);
  if (peTotal !== undefined) return peTotal;

  const pi = line.precioIdaEntidad as Record<string, unknown> | undefined;
  const pv = line.precioVtaEntidad as Record<string, unknown> | undefined;
  const ti = firstTotalInPrecioBlock(pi);
  const tv = firstTotalInPrecioBlock(pv);
  if (precioBlockHasTotal(ti) && precioBlockHasTotal(tv)) {
    const ni = parsePrecioTotalValue(ti);
    const nv = parsePrecioTotalValue(tv);
    if (ni !== null && nv !== null) return ni + nv;
  }
  if (precioBlockHasTotal(ti)) return ti as string | number;
  if (precioBlockHasTotal(tv)) return tv as string | number;

  return undefined;
}

/** Pour l’UI : montant affichable d’une `tarificacionEntidad` brute SOAP. */
export function pickPrecioTotalFromTarificacionRaw(
  line: unknown
): string | number | undefined {
  if (!line || typeof line !== "object") return undefined;
  return pickLinePrecioTotal(line as Record<string, unknown>);
}

/**
 * Montant affiché : pour chaque `tarificacionEntidad`, total issu de
 * `precioEntidad` puis repli `precioIdaEntidad` / `precioVtaEntidad` (WSDL NASA).
 */
export function sumPrecioTotalFromNasaTarificacionesResult(
  soapResult: unknown
): number | null {
  const lines = normalizeNasaTarificacionesLines(soapResult);
  if (lines.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const L of lines) {
    const n = parsePrecioTotalValue(L.precioTotal);
    if (n !== null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Nœud métier NASA sous `return` (parfois `return.return` selon le client SOAP).
 */
export function getNasaTarificacionesReturnNode(
  soapResult: unknown
): Record<string, unknown> | undefined {
  const root = soapResult as Record<string, unknown> | null | undefined;
  if (!root) return undefined;
  const r1 = root.return as Record<string, unknown> | undefined;
  if (r1?.tarificacionesEntidad != null) return r1;
  if (r1?.return && typeof r1.return === "object") {
    const r2 = r1.return as Record<string, unknown>;
    if (r2.tarificacionesEntidad != null) return r2;
  }
  if (root.tarificacionesEntidad != null) return root;
  return r1;
}

/** Liste brute des `tarificacionEntidad` pour debug / parsing. */
export function getTarificacionRawLinesFromSoapResult(
  soapResult: unknown
): unknown[] {
  const ret = getNasaTarificacionesReturnNode(soapResult);
  if (!ret) return [];
  const tEnt = ret.tarificacionesEntidad as Record<string, unknown> | undefined;
  return asArray(tEnt?.tarificacionEntidad);
}

/**
 * Extrait les lignes tarifaires depuis la valeur de retour SOAP `nasaTarificaciones`.
 */
export function normalizeNasaTarificacionesLines(
  soapResult: unknown
): NormalizedTarificacionLine[] {
  const rawLines = getTarificacionRawLinesFromSoapResult(soapResult);

  return rawLines.map((line, index) => {
    const L = line as Record<string, unknown>;

    const serv = L.servicioVentaEntidad as Record<string, unknown> | undefined;
    const tar = L.tarifaEntidad as Record<string, unknown> | undefined;
    const bon = L.bonificacionEntidad as Record<string, unknown> | undefined;

    return {
      index,
      codigoServicioVenta: pickString(serv?.codigoServicioVenta),
      tipoServicioVenta: pickString(serv?.tipoServicioVenta),
      tarifaTextoCorto: pickString(tar?.textoCorto),
      tarifaTextoLargo: pickString(tar?.textoLargo),
      precioTotal: pickLinePrecioTotal(L),
      bonificacionCodigo: pickString(bon?.codigoBonificacion),
      raw: line,
    };
  });
}
