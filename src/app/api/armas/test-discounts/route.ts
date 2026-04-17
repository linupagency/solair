import { NextRequest, NextResponse } from "next/server";

import { nasaBonificacionesRequest } from "@/lib/armas/client";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import type { ArmasDiscount } from "@/types/armas";

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArray<T>(value?: T[] | T): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeDiscount(item: ArmasDiscount) {
  const code = normalizeString(item.codigoBonificacion).toUpperCase();
  const shortLabel = normalizeString(item.textoCorto);
  const longLabel = normalizeString(item.textoLargo);
  if (!code) return null;

  return {
    code,
    shortLabel: shortLabel || code,
    longLabel: longLabel || shortLabel || code,
  };
}

export async function GET(request: NextRequest) {
  const validation = validateArmasBasicConfig();

  if (!validation.isValid) {
    return NextResponse.json(
      {
        ok: false,
        message: "Configuration Armas incomplete.",
        missingEnv: validation.missing,
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const origen = normalizeString(searchParams.get("origen"));
  const destino = normalizeString(searchParams.get("destino"));

  if (!origen || !destino) {
    return NextResponse.json(
      {
        ok: false,
        message: "Les paramètres 'origen' et 'destino' sont obligatoires.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await nasaBonificacionesRequest(origen, destino);
    const discounts = normalizeArray(
      result?.return?.bonificacionesEntidad?.bonificacionEntidad
    )
      .map(normalizeDiscount)
      .filter(
        (
          item
        ): item is {
          code: string;
          shortLabel: string;
          longLabel: string;
        } => item !== null
      );

    return NextResponse.json({
      ok: true,
      message: `Bonifications Armas chargées pour ${origen} -> ${destino}.`,
      discounts,
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaBonificaciones.",
        error: message,
      },
      { status: 500 }
    );
  }
}
