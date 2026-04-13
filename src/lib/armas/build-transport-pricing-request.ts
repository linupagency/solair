/**
 * Builder unique : `BookingFlow` + contexte salida + service passager primaire → corps `test-pricing` / SOAP.
 * WSDL Ventas20171009 — `nasaTarificaciones` : salidasEntidad + paxsVehsEntidad + bonificacionEntidad.
 */
import type { BookingFlow, BookingTransportServiceRef } from "@/lib/booking-flow";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import { isPrimaryServiceEligibleForVehicleCompanionPricing } from "@/lib/armas/pricing-combined-primary";
import { resolveExplicitVehicleOnSalidaServices } from "@/lib/armas/vehicle-line-explicit";
import { getLegacyVehicleForPricingParam } from "@/lib/solair-legacy-vehicle-pricing";
import { isCarWithTrailerCategory } from "@/lib/solair-vehicle-trailer";
import {
  type BookingVehicleCategoryId,
  armasVehicleLineForCategory,
} from "@/lib/vehicle/armas-catalog";
import {
  normalizePrimaryVehicleFromFlow,
  type NormalizedPrimaryVehicle,
} from "@/lib/vehicle/normalize";
import { totalVehiclesBooked } from "@/lib/armas/pricing-combined-flow";

export type TransportPricingSalidaContext = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
};

export type TransportPricingPrimaryInput = {
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  tipoPasajero: string;
  passengerTipos: string[];
};

export type SalidaServiciosCatalog = {
  serviciosVentas?: ReadonlyArray<{
    codigoServicioVenta?: string;
    tipoServicioVenta?: string;
    disponibilidad?: boolean | null;
  }>;
};

/**
 * Résout le couple exact sur la salida si présent ; sinon le couple statique du catalogue métier (même catégorie, jamais d’autre palier).
 */
export function resolveVehicleCompanionForSalida(
  category: BookingVehicleCategoryId,
  catalog?: SalidaServiciosCatalog
): BookingTransportServiceRef {
  const staticRef = armasVehicleLineForCategory(category);
  const list = catalog?.serviciosVentas;
  if (list && list.length > 0) {
    const st = resolveExplicitVehicleOnSalidaServices(category, list);
    if (
      st.status === "ok" &&
      st.service.codigoServicioVenta?.trim() &&
      st.service.tipoServicioVenta?.trim()
    ) {
      return {
        codigoServicioVenta: st.service.codigoServicioVenta.trim(),
        tipoServicioVenta: st.service.tipoServicioVenta.trim(),
      };
    }
  }
  return staticRef;
}

export type BuildTransportPricingRequestResult =
  | {
      ok: true;
      body: TarificacionRequestBody;
      normalizedVehicle: NormalizedPrimaryVehicle | null;
    }
  | { ok: false; error: string };

export function buildTransportPricingRequestFromFlow(
  flow: BookingFlow,
  salida: TransportPricingSalidaContext,
  primary: TransportPricingPrimaryInput,
  catalog?: SalidaServiciosCatalog
): BuildTransportPricingRequestResult {
  const norm = normalizePrimaryVehicleFromFlow(flow);
  if (!norm.ok) {
    return { ok: false, error: norm.error };
  }

  const base: TarificacionRequestBody = {
    origen: salida.origen,
    destino: salida.destino,
    fechaSalida: salida.fechaSalida,
    horaSalida: salida.horaSalida,
    cantidad: primary.cantidad,
    codigoServicioVenta: primary.codigoServicioVenta,
    tipoServicioVenta: primary.tipoServicioVenta,
    tipoPasajero: primary.tipoPasajero,
    passengerTipos: primary.passengerTipos,
    bonificacion: flow.search.bonificacion,
    sentidoSalida: 1,
    animalsCount: flow.search.animals.enabled ? flow.search.animals.count : 0,
  };

  if (norm.presence === "none") {
    return {
      ok: true,
      body: {
        ...base,
        vehicle: "none",
      },
      normalizedVehicle: null,
    };
  }

  const v = norm.vehicle;
  const primaryOk = isPrimaryServiceEligibleForVehicleCompanionPricing({
    codigoServicioVenta: primary.codigoServicioVenta,
    tipoServicioVenta: primary.tipoServicioVenta,
  });
  const totalVeh = totalVehiclesBooked(flow);

  const companion =
    primaryOk && totalVeh > 0
      ? resolveVehicleCompanionForSalida(v.category, catalog)
      : null;

  const body: TarificacionRequestBody = {
    ...base,
    vehicle: getLegacyVehicleForPricingParam(flow),
    vehicleCategory: v.category,
    vehiclePassengerIndex:
      typeof v.driverPassengerIndex === "number"
        ? v.driverPassengerIndex
        : undefined,
    vehicleData: {
      marque: v.marque,
      modele: v.modele,
      immatriculation: v.immatriculation,
      alto: v.alto,
      ancho: v.ancho,
      largo: v.largo,
      tipoVehiculo: v.tipoVehiculo,
      ...(v.taraKg != null ? { tara: v.taraKg } : {}),
      ...(v.seguro ? { seguro: v.seguro } : {}),
    },
    ...(companion
      ? {
          companionServicioVenta: {
            codigoServicioVenta: companion.codigoServicioVenta,
            tipoServicioVenta: companion.tipoServicioVenta,
            cantidad: Math.max(1, totalVeh),
          },
        }
      : {}),
    ...(isCarWithTrailerCategory(v.category)
      ? { rawTrailerLength: v.rawTrailerLength === true }
      : {}),
  };

  return { ok: true, body, normalizedVehicle: v };
}
