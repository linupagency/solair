import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaTrayectosRequest } from "@/lib/armas/client";

type RawTrayecto = {
  puertoDestinoEntidad?: {
    codigoPuerto?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
};

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractTrayectos(raw: unknown): RawTrayecto[] {
  const top = (raw as { return?: unknown })?.return as
    | { trayectosEntidad?: { trayectoEntidad?: RawTrayecto[] | RawTrayecto } }
    | undefined;

  if (top?.trayectosEntidad?.trayectoEntidad) {
    return normalizeArray(top.trayectosEntidad.trayectoEntidad);
  }

  const alt = (raw as {
    trayectosEntidad?: { trayectoEntidad?: RawTrayecto[] | RawTrayecto };
  })?.trayectosEntidad;

  if (alt?.trayectoEntidad) {
    return normalizeArray(alt.trayectoEntidad);
  }

  return [];
}

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
  if (!origen) {
    return NextResponse.json(
      {
        ok: false,
        message: "Le paramètre 'origen' est obligatoire.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await nasaTrayectosRequest(origen);
    const trayectos = extractTrayectos(result);
    const destinos = trayectos
      .map((t) => ({
        codigoPuerto: (t.puertoDestinoEntidad?.codigoPuerto || "").trim(),
        textoCorto: (t.puertoDestinoEntidad?.textoCorto || "").trim(),
        textoLargo: (t.puertoDestinoEntidad?.textoLargo || "").trim(),
      }))
      .filter((d) => d.codigoPuerto);

    const dedup = Array.from(
      new Map(destinos.map((d) => [d.codigoPuerto, d])).values()
    );

    return NextResponse.json({
      ok: true,
      origen,
      destinos: dedup,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaTrayectos.",
        error: error instanceof Error ? error.message : "Erreur inconnue",
      },
      { status: 500 }
    );
  }
}
