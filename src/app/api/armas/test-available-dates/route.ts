import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaSalidasRequest } from "@/lib/armas/client";

type RawSalida = {
  fechaSalida?: string;
};

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function addDays(yyyymmdd: string, days: number) {
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

function extractSalidas(raw: unknown): RawSalida[] {
  const top = (raw as { return?: unknown })?.return as
    | { salidasEntidad?: { salidaEntidad?: RawSalida[] | RawSalida } }
    | undefined;

  if (top?.salidasEntidad?.salidaEntidad) {
    return normalizeArray(top.salidasEntidad.salidaEntidad);
  }

  const alt = (raw as {
    salidasEntidad?: { salidaEntidad?: RawSalida[] | RawSalida };
  })?.salidasEntidad;

  if (alt?.salidaEntidad) {
    return normalizeArray(alt.salidaEntidad);
  }

  return [];
}

function normalizeArmasDate(value?: string) {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(0, 8) : digits;
}

type AvailableDatesResponseBody = {
  ok: true;
  origen: string;
  destino: string;
  startDate: string;
  days: number;
  concurrency: number;
  availableDates: string[];
  warnings: string[];
};

type AvailableDatesCacheEntry = {
  expiresAt: number;
  data: AvailableDatesResponseBody;
};

const AVAILABLE_DATES_CACHE_TTL_MS = 5 * 60 * 1000;
const availableDatesCache = new Map<string, AvailableDatesCacheEntry>();
const availableDatesInFlight = new Map<string, Promise<AvailableDatesResponseBody>>();

export async function GET(request: NextRequest) {
  const validation = validateArmasBasicConfig();
  if (!validation.isValid) {
    return NextResponse.json(
      {
        ok: false,
        message: "Configuration Armas incomplète.",
        missingEnv: validation.missing,
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const origen = (searchParams.get("origen") || "").trim();
  const destino = (searchParams.get("destino") || "").trim();
  const startDate = (searchParams.get("startDate") || "").trim();
  const daysRaw = Number(searchParams.get("days") || "45");
  const days = Number.isFinite(daysRaw)
    ? Math.min(365, Math.max(1, Math.floor(daysRaw)))
    : 45;
  const concurrencyRaw = Number(searchParams.get("concurrency") || "8");
  const concurrency = Number.isFinite(concurrencyRaw)
    ? Math.min(12, Math.max(1, Math.floor(concurrencyRaw)))
    : 8;
  const cacheKey = [origen, destino, startDate, days, concurrency].join("|");

  if (!origen || !destino || !startDate) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Les paramètres 'origen', 'destino' et 'startDate' sont obligatoires.",
      },
      { status: 400 }
    );
  }

  if (!/^\d{8}$/.test(startDate)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Le paramètre 'startDate' doit être au format yyyymmdd.",
      },
      { status: 400 }
    );
  }

  const now = Date.now();
  const cached = availableDatesCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.data);
  }

  const inFlight = availableDatesInFlight.get(cacheKey);
  if (inFlight) {
    const data = await inFlight;
    return NextResponse.json(data);
  }

  const computePromise = (async () => {
    const availableDatesSet = new Set<string>();
    const warnings: string[] = [];
    const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));
    let cursor = 0;

    async function worker() {
      while (cursor < dates.length) {
        const index = cursor;
        cursor += 1;
        const currentDate = dates[index];
        try {
          const result = await nasaSalidasRequest(origen, destino, currentDate);
          const salidas = extractSalidas(result);
          const hasStrictMatch = salidas.some(
            (salida) => normalizeArmasDate(salida?.fechaSalida) === currentDate
          );
          if (hasStrictMatch) {
            availableDatesSet.add(currentDate);
          }
        } catch (error) {
          warnings.push(
            `${currentDate}: ${error instanceof Error ? error.message : "Erreur inconnue"}`
          );
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const data: AvailableDatesResponseBody = {
      ok: true,
      origen,
      destino,
      startDate,
      days,
      concurrency,
      availableDates: Array.from(availableDatesSet).sort(),
      warnings,
    };

    availableDatesCache.set(cacheKey, {
      expiresAt: Date.now() + AVAILABLE_DATES_CACHE_TTL_MS,
      data,
    });

    return data;
  })();

  availableDatesInFlight.set(cacheKey, computePromise);

  try {
    const data = await computePromise;
    return NextResponse.json(data);
  } finally {
    availableDatesInFlight.delete(cacheKey);
  }
}
