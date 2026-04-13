import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  createEmptyBookingFlow,
  expandPassengerTipoList,
  type BookingFlow,
} from "@/lib/booking-flow";
import { buildTransportPricingRequestFromFlow } from "@/lib/armas/build-transport-pricing-request";
import { prepareNasaPricingCall } from "@/lib/armas/prepare-nasa-pricing-call";
import {
  buildNasaTarificacionesSoapArgs,
  extractNasaTarificacionesReturnMeta,
  extractPricingVehiculoEntidad,
  nasaTarificacionesRequest,
} from "@/lib/armas/client";
import { sumPrecioTotalFromNasaTarificacionesResult } from "@/lib/armas/tarificacion-normalize";
import { defaultVehiculoDimensions } from "@/lib/vehicle/armas-catalog";
import { normalizePrimaryVehicleFromFlow } from "@/lib/vehicle/normalize";

function normalizeString(value: string | null | undefined) {
  return value?.trim() || "";
}

type ScenarioId =
  | "none"
  | "small_tourism_car"
  | "small_tourism_car_trailer"
  | "large_tourism_car_trailer"
  | "bus_with_trailer"
  | "moto";

function flowForScenario(
  scenario: ScenarioId,
  bonificacion: string
): BookingFlow {
  const flow = createEmptyBookingFlow();
  flow.search.bonificacion = bonificacion;
  flow.search.passengers = { adults: 1, youth: 0, seniors: 0, children: 0, babies: 0 };
  if (scenario === "none") {
    return flow;
  }
  const dims = defaultVehiculoDimensions(scenario);
  flow.search.vehicles = [
    {
      category: scenario,
      quantity: 1,
      label: scenario,
      dimensions: { alto: dims.alto, ancho: dims.ancho, largo: dims.largo },
    },
  ];
  return flow;
}

/**
 * Étape B : même traversée, scénarios véhicule figés — activé si `SOLAIR_VEHICLE_PRICING_LAB=1`.
 * GET /api/armas/vehicle-pricing-lab?origen=ALG&destino=PTM&fechaSalida=20260413&horaSalida=2130
 */
export async function GET(request: NextRequest) {
  if (normalizeString(process.env.SOLAIR_VEHICLE_PRICING_LAB) !== "1") {
    return NextResponse.json({ ok: false, message: "Lab désactivé." }, { status: 403 });
  }

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
  const fechaSalida = normalizeString(searchParams.get("fechaSalida"));
  const horaSalida = normalizeString(searchParams.get("horaSalida"));
  const bonificacion = normalizeString(searchParams.get("bonificacion")) || "G";

  if (!origen || !destino || !fechaSalida || !horaSalida) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Query obligatoires: origen, destino, fechaSalida, horaSalida (optionnel bonificacion).",
      },
      { status: 400 }
    );
  }

  const salida = { origen, destino, fechaSalida, horaSalida };
  const scenarios: ScenarioId[] = [
    "none",
    "small_tourism_car",
    "small_tourism_car_trailer",
    "large_tourism_car_trailer",
    "bus_with_trailer",
    "moto",
  ];

  const primary = {
    cantidad: 1,
    codigoServicioVenta: "BY",
    tipoServicioVenta: "P",
    tipoPasajero: "A" as const,
    passengerTipos: expandPassengerTipoList({
      adults: 1,
      youth: 0,
      seniors: 0,
      children: 0,
      babies: 0,
    }),
  };

  const rows: Record<string, unknown>[] = [];

  for (const scenario of scenarios) {
    const flow = flowForScenario(scenario, bonificacion);
    const norm = normalizePrimaryVehicleFromFlow(flow);
    const built = buildTransportPricingRequestFromFlow(flow, salida, primary, undefined);
    if (!built.ok) {
      rows.push({
        scenario,
        error: built.error,
        normalizedVehicle: null,
        requestBody: null,
      });
      continue;
    }
    const postBody = built.body;
    const nasaParams = prepareNasaPricingCall(postBody);
    const soapArgs = buildNasaTarificacionesSoapArgs(nasaParams);
    const veh = extractPricingVehiculoEntidad(soapArgs) ?? null;

    let armasCodigo = "";
    let armasTexto = "";
    let total: number | null = null;
    let tariffError: string | undefined;
    try {
      const result = await nasaTarificacionesRequest(nasaParams);
      const meta = extractNasaTarificacionesReturnMeta(result);
      armasCodigo = meta.codigo != null ? String(meta.codigo).trim() : "";
      armasTexto = meta.texto != null ? String(meta.texto).trim() : "";
      total = sumPrecioTotalFromNasaTarificacionesResult(result);
    } catch (e) {
      tariffError = e instanceof Error ? e.message : String(e);
    }

    rows.push({
      scenario,
      normalizedOk: norm.ok,
      normalizedPresence: norm.ok ? norm.presence : null,
      normalizedVehicleJson:
        norm.ok && norm.presence === "vehicle" ? norm.vehicle : null,
      requestBody: postBody,
      serviciosVentasSoap:
        soapArgs.salidasEntidad?.salidaEntidad?.serviciosVentasEntidad,
      vehiculoEntidad: veh,
      armasCodigo,
      armasTexto,
      total,
      tariffError: tariffError ?? null,
    });
  }

  return NextResponse.json({
    ok: true,
    salida,
    primaryPassengerService: { codigoServicioVenta: "BY", tipoServicioVenta: "P" },
    scenarios: rows,
  });
}
