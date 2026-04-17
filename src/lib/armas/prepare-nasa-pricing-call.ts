import { isPrimaryServiceEligibleForVehicleCompanionPricing } from "@/lib/armas/pricing-combined-primary";
import { explicitVehicleRefForCategory } from "@/lib/armas/vehicle-line-explicit";
import type { TarificacionRequestBody } from "@/lib/armas/tarificacion-request-types";
import type { NasaTarificacionesRequestParams } from "@/lib/armas/client";

function normalizeString(value: string | null | undefined) {
  return value?.trim() || "";
}

/**
 * Transforme le corps HTTP en paramètres `nasaTarificacionesRequest` (hors client SOAP).
 * Si `companionServicioVenta` est déjà fourni par le builder transport, il est conservé tel quel.
 */
export function prepareNasaPricingCall(
  input: TarificacionRequestBody
): NasaTarificacionesRequestParams {
  const hasVehicle =
    normalizeString(input.vehicle) &&
    normalizeString(input.vehicle) !== "none";

  const hasCategory =
    normalizeString(input.vehicleCategory) &&
    normalizeString(input.vehicleCategory) !== "none";

  const vehicleForSoap = hasVehicle
    ? normalizeString(input.vehicle)
    : hasCategory
      ? "car"
      : "none";

  const primary = {
    codigoServicioVenta: normalizeString(input.codigoServicioVenta),
    tipoServicioVenta: normalizeString(input.tipoServicioVenta),
  };
  const primaryEligible =
    isPrimaryServiceEligibleForVehicleCompanionPricing(primary);

  const companionServicioVenta = (() => {
    if (!primaryEligible) {
      return undefined;
    }

    const fromBody =
      input.companionServicioVenta &&
      normalizeString(input.companionServicioVenta.codigoServicioVenta) &&
      normalizeString(input.companionServicioVenta.tipoServicioVenta)
        ? {
            codigoServicioVenta: normalizeString(
              input.companionServicioVenta.codigoServicioVenta
            ),
            tipoServicioVenta: normalizeString(
              input.companionServicioVenta.tipoServicioVenta
            ),
            cantidad: input.companionServicioVenta.cantidad,
          }
        : undefined;

    if (fromBody) {
      return fromBody;
    }

    const cat = normalizeString(input.vehicleCategory);
    const refFromCategory =
      cat && cat !== "none" ? explicitVehicleRefForCategory(cat) : null;
    if (
      refFromCategory?.codigoServicioVenta &&
      refFromCategory?.tipoServicioVenta
    ) {
      return {
        codigoServicioVenta: refFromCategory.codigoServicioVenta,
        tipoServicioVenta: refFromCategory.tipoServicioVenta,
        cantidad: input.companionServicioVenta?.cantidad ?? 1,
      };
    }

    return undefined;
  })();

  return {
    requestId: input.pricingRtDebug?.requestId,
    origen: normalizeString(input.origen),
    destino: normalizeString(input.destino),
    fechaSalida: normalizeString(input.fechaSalida),
    horaSalida: normalizeString(input.horaSalida),
    cantidad: input.cantidad,
    codigoServicioVenta: primary.codigoServicioVenta,
    tipoServicioVenta: primary.tipoServicioVenta,
    tipoPasajero: normalizeString(input.tipoPasajero),
    passengerTipos: input.passengerTipos,
    animalsCount: input.animalsCount,
    bonificacion: normalizeString(input.bonificacion),
    sentidoSalida: input.sentidoSalida ?? 1,
    vehicle: vehicleForSoap,
    vehicleCategory: hasCategory
      ? normalizeString(input.vehicleCategory)
      : undefined,
    vehiclePassengerIndex: input.vehiclePassengerIndex,
    vehicleData:
      hasVehicle || hasCategory
        ? {
            marque: normalizeString(input.vehicleData?.marque),
            modele: normalizeString(input.vehicleData?.modele),
            immatriculation: normalizeString(input.vehicleData?.immatriculation),
            alto: input.vehicleData?.alto,
            ancho: input.vehicleData?.ancho,
            largo: input.vehicleData?.largo,
            tipoVehiculo: normalizeString(input.vehicleData?.tipoVehiculo),
            tara: input.vehicleData?.tara,
            seguro: normalizeString(input.vehicleData?.seguro),
          }
        : undefined,
    companionServicioVenta,
    returnSegment: input.returnSegment
      ? {
          origen: normalizeString(input.returnSegment.origen),
          destino: normalizeString(input.returnSegment.destino),
          fechaSalida: normalizeString(input.returnSegment.fechaSalida),
          horaSalida: normalizeString(input.returnSegment.horaSalida),
          codigoServicioVenta: normalizeString(
            input.returnSegment.codigoServicioVenta
          ),
          tipoServicioVenta: normalizeString(input.returnSegment.tipoServicioVenta),
          sentidoSalida: input.returnSegment.sentidoSalida,
        }
      : undefined,
    rawTrailerLength: input.rawTrailerLength,
    pricingSoapTrace: input.pricingSoapTrace === true,
  };
}
