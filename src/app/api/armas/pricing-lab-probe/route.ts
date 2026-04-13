import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  nasaTarificacionesRequest,
  nasaTarificacionesRequestWithSoapArgs,
} from "@/lib/armas/client";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import {
  PRICING_LAB_PROBE_SPEC_VERSION,
  buildProbeOutcome,
  coerceNasaParamsFromProbeBody,
  mergeProbeSoapOverrides,
  parseStrictSoapOverrides,
  runModeAFlow,
} from "@/lib/armas/pricing-lab-probe";
import { buildNasaTarificacionesSoapArgs } from "@/lib/armas/client";
import { buildPricingSoapTraceEcho } from "@/lib/armas/pricing-soap-trace-echo";

function normalizeString(value: string | null | undefined) {
  return value?.trim() || "";
}

function labProbeEnabled() {
  return normalizeString(process.env.SOLAIR_ARMAS_PRICING_PROBE) === "1";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateModeABody(
  body: unknown
): { ok: true; body: TarificacionRequestBody } | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: "body doit être un objet (mode A)." };
  }
  const b = body as Record<string, unknown>;
  const origen = normalizeString(b.origen as string);
  const destino = normalizeString(b.destino as string);
  const fechaSalida = normalizeString(b.fechaSalida as string);
  const horaSalida = normalizeString(b.horaSalida as string);
  const cantidad = b.cantidad;
  const codigoServicioVenta = normalizeString(b.codigoServicioVenta as string);
  const tipoServicioVenta = normalizeString(b.tipoServicioVenta as string);
  const bonificacion = normalizeString(b.bonificacion as string);

  if (
    !origen ||
    !destino ||
    !fechaSalida ||
    !horaSalida ||
    typeof cantidad !== "number" ||
    !Number.isFinite(cantidad) ||
    cantidad <= 0 ||
    !codigoServicioVenta ||
    !tipoServicioVenta ||
    !bonificacion
  ) {
    return {
      ok: false,
      error:
        "body : champs obligatoires origen, destino, fechaSalida, horaSalida, cantidad (>0), codigoServicioVenta, tipoServicioVenta, bonificacion.",
    };
  }

  return { ok: true, body: body as TarificacionRequestBody };
}

/**
 * POST /api/armas/pricing-lab-probe
 * Activé uniquement si SOLAIR_ARMAS_PRICING_PROBE=1.
 */
export async function POST(request: NextRequest) {
  if (!labProbeEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
        inputEcho: { probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION },
        soapArgs: null,
        armasReturn: { codigo: null, texto: null },
        rawResult: null,
        normalizedLines: [],
        total: null,
        verdict: {
          status: "INVALID_INPUT",
          code: "LAB_DISABLED",
          message:
            "Probe désactivé : définir SOLAIR_ARMAS_PRICING_PROBE=1 dans l’environnement.",
        },
        transportAccepted: false,
        pricingUsable: false,
      },
      { status: 403 }
    );
  }

  const validation = validateArmasBasicConfig();
  if (!validation.isValid) {
    return NextResponse.json(
      {
        ok: false,
        probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
        inputEcho: {},
        soapArgs: null,
        armasReturn: { codigo: null, texto: null },
        rawResult: null,
        normalizedLines: [],
        total: null,
        verdict: {
          status: "PROBE_ERROR",
          code: "ARMAS_CONFIG",
          message: "Configuration Armas incomplète.",
        },
        transportAccepted: false,
        pricingUsable: false,
        missingEnv: validation.missing,
      },
      { status: 500 }
    );
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "A",
        scenarioId: "",
        label: null,
        inputEcho: {},
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: "Corps JSON invalide.",
      }),
      { status: 400 }
    );
  }

  if (!isPlainObject(json)) {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "A",
        scenarioId: "",
        label: null,
        inputEcho: {},
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: "Le corps doit être un objet JSON.",
      }),
      { status: 400 }
    );
  }

  const spec = json.probeSpecVersion;
  if (spec !== PRICING_LAB_PROBE_SPEC_VERSION) {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "A",
        scenarioId: String(json.scenarioId ?? ""),
        label: typeof json.label === "string" ? json.label : null,
        inputEcho: { ...json },
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: `probeSpecVersion obligatoire : « ${PRICING_LAB_PROBE_SPEC_VERSION} » (reçu : ${JSON.stringify(spec)}).`,
      }),
      { status: 400 }
    );
  }

  const mode = json.mode;
  if (mode !== "A" && mode !== "B") {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "A",
        scenarioId: String(json.scenarioId ?? ""),
        label: typeof json.label === "string" ? json.label : null,
        inputEcho: { ...json },
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: 'mode doit être « A » ou « B ».',
      }),
      { status: 400 }
    );
  }

  const scenarioId =
    typeof json.scenarioId === "string" && json.scenarioId.trim()
      ? json.scenarioId.trim()
      : "";
  if (!scenarioId) {
    return NextResponse.json(
      buildProbeOutcome({
        mode,
        scenarioId: "",
        label: typeof json.label === "string" ? json.label : null,
        inputEcho: { ...json },
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: "scenarioId obligatoire (chaîne non vide).",
      }),
      { status: 400 }
    );
  }

  const label =
    typeof json.label === "string" && json.label.trim() ? json.label.trim() : null;

  const inputEcho: Record<string, unknown> = {
    probeSpecVersion: PRICING_LAB_PROBE_SPEC_VERSION,
    mode,
    scenarioId,
    label,
  };

  if (mode === "A") {
    const validated = validateModeABody(json.body);
    if (!validated.ok) {
      inputEcho.body = json.body;
      return NextResponse.json(
        buildProbeOutcome({
          mode: "A",
          scenarioId,
          label,
          inputEcho,
          soapArgs: null,
          rawResult: null,
          errorBeforeSoap: validated.error,
        }),
        { status: 400 }
      );
    }
    inputEcho.body = validated.body;

    let params: ReturnType<typeof runModeAFlow>["params"];
    let soapArgs: ReturnType<typeof buildNasaTarificacionesSoapArgs>;
    try {
      const built = runModeAFlow(validated.body);
      params = built.params;
      soapArgs = built.soapArgs;
    } catch (e) {
      return NextResponse.json(
        buildProbeOutcome({
          mode: "A",
          scenarioId,
          label,
          inputEcho,
          soapArgs: null,
          rawResult: null,
          errorBeforeSoap:
            e instanceof Error ? e.message : "Erreur construction SOAP (mode A).",
        }),
        { status: 400 }
      );
    }

    try {
      const rawResult = await nasaTarificacionesRequest(params);
      const outcome = buildProbeOutcome({
        mode: "A",
        scenarioId,
        label,
        inputEcho,
        soapArgs,
        rawResult,
      });
      const payload: Record<string, unknown> = { ...outcome };
      /* TEMP — comparaison avec test-pricing */
      if (validated.body.pricingSoapTrace === true) {
        payload.pricingSoapTraceEcho = buildPricingSoapTraceEcho({
          postBody: validated.body,
          nasaParams: params,
          soapArgs,
          rawResult,
        });
      }
      return NextResponse.json(payload);
    } catch (e) {
      return NextResponse.json(
        buildProbeOutcome({
          mode: "A",
          scenarioId,
          label,
          inputEcho,
          soapArgs,
          rawResult: null,
          soapExceptionMessage:
            e instanceof Error ? e.message : "Erreur SOAP inconnue.",
        }),
        { status: 500 }
      );
    }
  }

  /* mode B */
  const coerced = coerceNasaParamsFromProbeBody(json.params);
  if (!coerced.ok) {
    inputEcho.params = json.params;
    inputEcho.soapOverrides = json.soapOverrides ?? null;
    return NextResponse.json(
      buildProbeOutcome({
        mode: "B",
        scenarioId,
        label,
        inputEcho,
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: coerced.error,
      }),
      { status: 400 }
    );
  }

  const soapParsed = parseStrictSoapOverrides(json.soapOverrides);
  if (!soapParsed.ok) {
    inputEcho.params = json.params;
    inputEcho.soapOverrides = json.soapOverrides ?? null;
    return NextResponse.json(
      buildProbeOutcome({
        mode: "B",
        scenarioId,
        label,
        inputEcho,
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap: soapParsed.error,
      }),
      { status: 400 }
    );
  }

  inputEcho.params = json.params;
  inputEcho.soapOverrides = soapParsed.value;

  let baseSoap: ReturnType<typeof buildNasaTarificacionesSoapArgs>;
  try {
    baseSoap = buildNasaTarificacionesSoapArgs(coerced.params);
  } catch (e) {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "B",
        scenarioId,
        label,
        inputEcho,
        soapArgs: null,
        rawResult: null,
        errorBeforeSoap:
          e instanceof Error ? e.message : "Erreur construction SOAP (mode B).",
      }),
      { status: 400 }
    );
  }

  const soapArgs = mergeProbeSoapOverrides(baseSoap, soapParsed.value);

  try {
    const rawResult = await nasaTarificacionesRequestWithSoapArgs(soapArgs, {
      pricingSoapTrace: coerced.params.pricingSoapTrace === true,
    });
    const outcome = buildProbeOutcome({
      mode: "B",
      scenarioId,
      label,
      inputEcho,
      soapArgs,
      rawResult,
    });
    const payload: Record<string, unknown> = { ...outcome };
    /* TEMP — comparaison avec test-pricing (mode B : pas de TarificacionRequestBody) */
    if (coerced.params.pricingSoapTrace === true) {
      payload.pricingSoapTraceEcho = buildPricingSoapTraceEcho({
        postBody: null,
        nasaParams: coerced.params,
        soapArgs,
        rawResult,
      });
    }
    return NextResponse.json(payload);
  } catch (e) {
    return NextResponse.json(
      buildProbeOutcome({
        mode: "B",
        scenarioId,
        label,
        inputEcho,
        soapArgs,
        rawResult: null,
        soapExceptionMessage:
          e instanceof Error ? e.message : "Erreur SOAP inconnue.",
      }),
      { status: 500 }
    );
  }
}
