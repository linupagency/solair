import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import {
  buildNasaTarificacionesSoapArgs,
  extractPricingVehiculoEntidad,
  nasaSalidasRequest,
  nasaServiciosVentasRequest,
} from "@/lib/armas/client";
import {
  combinedServiceLabelUpper,
  getCommercialKind,
  isVehicleService,
} from "@/lib/ui/armas-commercial";

import {
  explicitVehicleRefForCategory,
  resolveExplicitVehicleOnSalidaServices,
} from "@/lib/armas/vehicle-line-explicit";

function normalizeArray<T>(value?: T[] | T | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function unwrapReturn(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  if (r.return && typeof r.return === "object") {
    return r.return as Record<string, unknown>;
  }
  return r;
}

function trailerHintInLabel(labelUpper: string): boolean {
  return /REMORQUE|REMOLQUE|REMOLQ|CARAVAN|CARAVANE|CON\s+REMOLQUE|CON\s+REMORQUE|AVEC\s+REMORQUE|VEHICULO\s*\+\s*REM|VEHÍCULO\s*\+\s*REM|\+.*REM|\+\s*REMORQUE|\+\s*REMOLQUE/i.test(
    labelUpper
  );
}

type ServicioRow = {
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  textoCorto: string;
  textoLargo: string;
  disponibilidad: boolean | null;
  disponibles: number | string | null;
  solairIsVehicleCatalog: boolean;
  solairCommercialKind: string;
  solairTrailerHintInLabel: boolean;
};

function mapServicio(raw: Record<string, unknown>): ServicioRow {
  const obj = {
    codigoServicioVenta: String(raw.codigoServicioVenta ?? ""),
    tipoServicioVenta: String(raw.tipoServicioVenta ?? ""),
    textoCorto: String(raw.textoCorto ?? ""),
    textoLargo: String(raw.textoLargo ?? ""),
  };
  const labelUpper = combinedServiceLabelUpper(obj);
  const disp = raw.disponibilidad;
  const disponibilidad =
    typeof disp === "boolean"
      ? disp
      : disp === "true" || disp === 1
        ? true
        : disp === "false" || disp === 0
          ? false
          : null;

  let disponibles: number | string | null = null;
  if (raw.disponibles != null && raw.disponibles !== "") {
    disponibles =
      typeof raw.disponibles === "number"
        ? raw.disponibles
        : String(raw.disponibles);
  }

  return {
    ...obj,
    disponibilidad,
    disponibles,
    solairIsVehicleCatalog: isVehicleService(obj),
    solairCommercialKind: getCommercialKind(obj),
    solairTrailerHintInLabel: trailerHintInLabel(labelUpper),
  };
}

function extractSalidasFromNasaResult(raw: unknown): Record<string, unknown>[] {
  const ret = unwrapReturn(raw);
  const salidas = ret.salidasEntidad as Record<string, unknown> | undefined;
  return normalizeArray(
    salidas?.salidaEntidad as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined
  );
}

function extractServiciosFromSalida(
  salida: Record<string, unknown>
): ServicioRow[] {
  const wrap = salida.serviciosVentasEntidad as
    | Record<string, unknown>
    | undefined;
  const rawList = normalizeArray(
    wrap?.servicioVentaEntidad as Record<string, unknown> | undefined
  );
  return rawList.map((x) => mapServicio(x as Record<string, unknown>));
}

function extractRouteCatalog(raw: unknown): ServicioRow[] {
  const ret = unwrapReturn(raw);
  const wrap = ret.serviciosVentasEntidad as Record<string, unknown> | undefined;
  const rawList = normalizeArray(
    wrap?.servicioVentaEntidad as Record<string, unknown> | undefined
  );
  return rawList.map((x) => mapServicio(x as Record<string, unknown>));
}

function lineKey(r: ServicioRow): string {
  return `${r.codigoServicioVenta.trim()}|${r.tipoServicioVenta.trim()}`;
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
  const origen = searchParams.get("origen")?.trim() || "";
  const destino = searchParams.get("destino")?.trim() || "";
  const fecha = searchParams.get("fecha")?.trim() || "";
  const horaSalida = searchParams.get("horaSalida")?.trim() || "";
  const withRouteCatalog = searchParams.get("withRouteCatalog") === "1";

  if (!origen || !destino || !fecha) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Paramètres obligatoires: origen, destino, fecha (yyyymmdd). Optionnel: horaSalida (HHMM), withRouteCatalog=1.",
        example:
          "/api/armas/debug-catalog-releve?origen=MOT&destino=MLN&fecha=20260410&horaSalida=0800&withRouteCatalog=1",
      },
      { status: 400 }
    );
  }

  if (!/^\d{8}$/.test(fecha)) {
    return NextResponse.json(
      { ok: false, message: "fecha doit être yyyymmdd." },
      { status: 400 }
    );
  }

  if (horaSalida && !/^\d{4}$/.test(horaSalida)) {
    return NextResponse.json(
      { ok: false, message: "horaSalida doit être HHMM (4 chiffres)." },
      { status: 400 }
    );
  }

  try {
    const salidasResult = await nasaSalidasRequest(origen, destino, fecha);
    let routeCatalog: ServicioRow[] | undefined;
    if (withRouteCatalog) {
      const svcResult = await nasaServiciosVentasRequest(origen, destino);
      routeCatalog = extractRouteCatalog(svcResult);
    }

    const allSalidas = extractSalidasFromNasaResult(salidasResult);
    const normHora = (h: unknown) => String(h ?? "").replace(/\D/g, "").slice(-4).padStart(4, "0");

    const matched =
      horaSalida.length === 4
        ? allSalidas.filter((s) => normHora(s.horaSalida) === horaSalida)
        : allSalidas;

    const effectiveHora =
      horaSalida.length === 4
        ? horaSalida
        : matched[0]
          ? normHora(matched[0].horaSalida)
          : "0900";

    const vehiculoSamples = {
      small_tourism_car: extractPricingVehiculoEntidad(
        buildNasaTarificacionesSoapArgs({
          origen,
          destino,
          fechaSalida: fecha,
          horaSalida: effectiveHora,
          cantidad: 1,
          codigoServicioVenta: "BY",
          tipoServicioVenta: "P",
          tipoPasajero: "A",
          bonificacion: "G",
          vehicle: "car",
          vehicleCategory: "small_tourism_car",
          vehicleData: { largo: 4.5, alto: 1.8, ancho: 1.8 },
        })
      ),
      small_tourism_car_trailer: extractPricingVehiculoEntidad(
        buildNasaTarificacionesSoapArgs({
          origen,
          destino,
          fechaSalida: fecha,
          horaSalida: effectiveHora,
          cantidad: 1,
          codigoServicioVenta: "BY",
          tipoServicioVenta: "P",
          tipoPasajero: "A",
          bonificacion: "G",
          vehicle: "car",
          vehicleCategory: "small_tourism_car_trailer",
          vehicleData: { largo: 8, alto: 1.85, ancho: 1.8 },
        })
      ),
      medium_tourism_car_trailer: extractPricingVehiculoEntidad(
        buildNasaTarificacionesSoapArgs({
          origen,
          destino,
          fechaSalida: fecha,
          horaSalida: effectiveHora,
          cantidad: 1,
          codigoServicioVenta: "BY",
          tipoServicioVenta: "P",
          tipoPasajero: "A",
          bonificacion: "G",
          vehicle: "car",
          vehicleCategory: "medium_tourism_car_trailer",
          vehicleData: { largo: 10, alto: 2, ancho: 2 },
        })
      ),
      large_tourism_car_trailer: extractPricingVehiculoEntidad(
        buildNasaTarificacionesSoapArgs({
          origen,
          destino,
          fechaSalida: fecha,
          horaSalida: effectiveHora,
          cantidad: 1,
          codigoServicioVenta: "BY",
          tipoServicioVenta: "P",
          tipoPasajero: "A",
          bonificacion: "G",
          vehicle: "car",
          vehicleCategory: "large_tourism_car_trailer",
          vehicleData: { largo: 14, alto: 5, ancho: 2 },
        })
      ),
      camper: extractPricingVehiculoEntidad(
        buildNasaTarificacionesSoapArgs({
          origen,
          destino,
          fechaSalida: fecha,
          horaSalida: effectiveHora,
          cantidad: 1,
          codigoServicioVenta: "BY",
          tipoServicioVenta: "P",
          tipoPasajero: "A",
          bonificacion: "G",
          vehicle: "camper",
          vehicleCategory: "camper",
          vehicleData: { largo: 12, alto: 3.0, ancho: 2.3 },
        })
      ),
    };

    const routeVehicleKeys = new Set(
      (routeCatalog ?? [])
        .filter((r) => r.solairIsVehicleCatalog)
        .map(lineKey)
    );
    const salidaReports = matched.map((salida) => {
      const rows = extractServiciosFromSalida(salida);
      const vehicleRows = rows.filter((r) => r.solairIsVehicleCatalog);
      const trailerHintRows = rows.filter((r) => r.solairTrailerHintInLabel);

      const salidaVehicleKeys = new Set(vehicleRows.map(lineKey));

      const solairExplicitResolveByCategory: Record<
        string,
        {
          expectedRef: ReturnType<typeof explicitVehicleRefForCategory>;
          resolved: ReturnType<
            typeof resolveExplicitVehicleOnSalidaServices<ServicioRow>
          >;
        }
      > = {};
      const previewCats = [
        "small_tourism_car",
        "medium_tourism_car",
        "large_tourism_car",
        "small_tourism_car_trailer",
        "medium_tourism_car_trailer",
        "large_tourism_car_trailer",
        "camper",
        "moto",
        "bike",
      ];
      for (const cat of previewCats) {
        solairExplicitResolveByCategory[cat] = {
          expectedRef: explicitVehicleRefForCategory(cat),
          resolved: resolveExplicitVehicleOnSalidaServices(cat, rows),
        };
      }

      const onlyOnRoute =
        withRouteCatalog && routeCatalog
          ? [...routeVehicleKeys].filter((k) => !salidaVehicleKeys.has(k))
          : [];
      const onlyOnSalida =
        withRouteCatalog && routeCatalog
          ? [...salidaVehicleKeys].filter((k) => !routeVehicleKeys.has(k))
          : [];

      return {
        crossing: {
          fechaSalida: salida.fechaSalida ?? null,
          horaSalida: salida.horaSalida ?? null,
          horaLlegada: salida.horaLlegada ?? null,
          estadoSalida: salida.estadoSalida ?? null,
          barcoTextoCorto:
            (salida.barcoEntidad as Record<string, unknown> | undefined)
              ?.textoCorto ?? null,
        },
        servicioVentaEntidadAllLines: rows,
        vehicleLinesOnly: vehicleRows,
        linesWithTrailerHintInLabel: trailerHintRows,
        solairExplicitResolveByCategory,
        diffVehicleLineKeysRouteVsThisSalida:
          withRouteCatalog && routeCatalog
            ? { onlyOnRoute, onlyOnSalida }
            : undefined,
      };
    });

    return NextResponse.json({
      ok: true,
      message:
        "Relevé factuel nasaSalidas (+ option nasaServiciosVentas). Données brutes et comparaisons descriptives seulement.",
      query: {
        origen,
        destino,
        fecha,
        horaSalida: horaSalida || null,
        withRouteCatalog,
      },
      warnings: [
        ...(horaSalida.length === 4 && matched.length === 0
          ? [
              `Aucune salida avec horaSalida=${horaSalida} — relevé vide pour les traversées. Vérifiez l'heure ou retirez horaSalida pour lister toute la journée.`,
            ]
          : []),
      ],
      salidasMatchedCount: matched.length,
      salidasTotalCount: allSalidas.length,
      nasaServiciosVentasRouteCatalog: routeCatalog,
      salidas: salidaReports,
      nasaTarificacionesVehiculoEntidadSamples: {
        note:
          "Objet `vehiculoEntidad` que notre code construit pour nasaTarificaciones (dimensions / metrosExtra remorque). Indépendant de la liste servicioVenta sur la salida.",
        byCategory: vehiculoSamples,
      },
      interpretationGuide: {
        trailerHint:
          "solairTrailerHintInLabel est une regex sur les textes — pas une vérité métier Armas.",
        solairExplicit:
          "solairExplicitResolveByCategory : ref attendue (codigo|tipo) + statut sur cette salida (ok / unavailable / not_in_catalog).",
        routeVsSalida:
          "Avec withRouteCatalog=1, diffVehicleLineKeysRouteVsThisSalida compare les clés codigo|tipo véhicule entre le catalogue trajet et cette salida.",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    return NextResponse.json(
      { ok: false, message: "Échec relevé catalogue.", error: message },
      { status: 500 }
    );
  }
}
