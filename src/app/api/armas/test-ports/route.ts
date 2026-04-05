import { NextResponse } from "next/server";
import { armasConfig, validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaPuertosRequest } from "@/lib/armas/client";

export async function GET() {
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

  try {
    const result = await nasaPuertosRequest();

    return NextResponse.json({
      ok: true,
      message: "Appel SOAP nasaPuertos execute.",
      wsdlUrl: armasConfig.wsdlUrl,
      data: result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Echec de l'appel SOAP nasaPuertos.",
        error: message,
      },
      { status: 500 }
    );
  }
}