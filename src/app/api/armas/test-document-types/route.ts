import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaTiposDocumentosRequest } from "@/lib/armas/client";

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

  if (!origen || !destino) {
    return NextResponse.json(
      {
        ok: false,
        message: "Les paramètres 'origen' et 'destino' sont obligatoires.",
        example: "/api/armas/test-document-types?origen=MOT&destino=MLN",
      },
      { status: 400 }
    );
  }

  try {
    const result = await nasaTiposDocumentosRequest(origen, destino);

    return NextResponse.json({
      ok: true,
      message: `Appel SOAP nasaTiposDocumentos exécuté pour ${origen} -> ${destino}.`,
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de l'appel SOAP nasaTiposDocumentos.",
        error: message,
      },
      { status: 500 }
    );
  }
}