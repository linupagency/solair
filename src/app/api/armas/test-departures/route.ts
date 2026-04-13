import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaSalidasRequest } from "@/lib/armas/client";

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
  const origen = searchParams.get("origen");
  const destino = searchParams.get("destino");
  const fecha = searchParams.get("fecha");

  if (!origen || !destino || !fecha) {
    return NextResponse.json(
      {
        ok: false,
        message: "Les paramètres 'origen', 'destino' et 'fecha' sont obligatoires.",
        example:
          "/api/armas/test-departures?origen=MOT&destino=MLN&fecha=20260410",
      },
      { status: 400 }
    );
  }

  if (!/^\d{8}$/.test(fecha)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Le paramètre 'fecha' doit être au format yyyymmdd.",
      },
      { status: 400 }
    );
  }

  try {
    const result = await nasaSalidasRequest(origen, destino, fecha);

    return NextResponse.json({
      ok: true,
      message: `Appel SOAP nasaSalidas exécuté pour ${origen} -> ${destino} à la date ${fecha}.`,
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaSalidas.",
        error: message,
      },
      { status: 500 }
    );
  }
}