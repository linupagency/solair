import {
  buildNasaTarificacionesSoapArgs,
  extractNasaTarificacionesReturnMeta,
  getFirstSalidaSoapEntity,
  nasaTarificacionesRequestWithSoapArgs,
} from "../src/lib/armas/client.ts";
import { sumPrecioTotalFromNasaTarificacionesResult } from "../src/lib/armas/tarificacion-normalize.ts";

type Scenario = {
  code: string;
  type: string;
  quantity: number;
  label: string;
};

const PASSENGER_TYPES = ["A", "A", "N", "N", "B"];
const TOTAL_PASSENGERS = PASSENGER_TYPES.length;

const BASE_PARAMS = {
  origen: "LEI",
  destino: "NDR",
  fechaSalida: "20260419",
  horaSalida: "2200",
  cantidad: TOTAL_PASSENGERS,
  codigoServicioVenta: "BY",
  tipoServicioVenta: "P",
  tipoPasajero: "A",
  passengerTipos: PASSENGER_TYPES,
  bonificacion: "G",
  vehicle: "car",
  vehicleCategory: "large_tourism_car_trailer",
  companionServicioVenta: {
    codigoServicioVenta: "XR",
    tipoServicioVenta: "V",
    cantidad: 1,
  },
} as const;

const SCENARIOS: Scenario[] = [
  { code: "BP", type: "P", quantity: 1, label: "Butaca preferente" },
  { code: "D", type: "P", quantity: 2, label: "Cabine double complete" },
  { code: "P", type: "P", quantity: 2, label: "Camarote doble preferente" },
  { code: "Q", type: "P", quantity: 4, label: "Cabine pour quatre complete" },
  { code: "C", type: "P", quantity: 4, label: "Camarote quadruple preferente" },
];

function buildMixedSoapArgs(option: Scenario) {
  const args = buildNasaTarificacionesSoapArgs(BASE_PARAMS);
  const salida = getFirstSalidaSoapEntity(args.salidasEntidad.salidaEntidad);
  if (!salida) {
    throw new Error("Salida SOAP introuvable.");
  }

  const remainingBasePassengers = TOTAL_PASSENGERS - option.quantity;
  if (remainingBasePassengers < 0) {
    throw new Error(`Quantite invalide pour ${option.code}.`);
  }

  const mixedServices: Array<{
    cantidad: number;
    codigoServicioVenta: string;
    tipoServicioVenta: string;
  }> = [];

  if (remainingBasePassengers > 0) {
    mixedServices.push({
      cantidad: remainingBasePassengers,
      codigoServicioVenta: "BY",
      tipoServicioVenta: "P",
    });
  }

  mixedServices.push({
    cantidad: option.quantity,
    codigoServicioVenta: option.code,
    tipoServicioVenta: option.type,
  });

  mixedServices.push({
    cantidad: 1,
    codigoServicioVenta: "XR",
    tipoServicioVenta: "V",
  });

  salida.serviciosVentasEntidad = {
    servicioVentaEntidad: mixedServices,
  };

  return args;
}

async function run() {
  const baseArgs = buildNasaTarificacionesSoapArgs(BASE_PARAMS);
  const baseResult = await nasaTarificacionesRequestWithSoapArgs(baseArgs, {
    pricingSoapTrace: false,
  });
  const baseTotal = sumPrecioTotalFromNasaTarificacionesResult(baseResult, "combined");
  const baseMeta = extractNasaTarificacionesReturnMeta(baseResult);

  console.log("Base BY + XR");
  console.log(JSON.stringify({ baseTotal, meta: baseMeta }, null, 2));

  for (const scenario of SCENARIOS) {
    const soapArgs = buildMixedSoapArgs(scenario);
    const rawResult = await nasaTarificacionesRequestWithSoapArgs(soapArgs, {
      pricingSoapTrace: false,
    });
    const total = sumPrecioTotalFromNasaTarificacionesResult(rawResult, "combined");
    const supplement =
      total != null && baseTotal != null ? Math.round((total - baseTotal) * 100) / 100 : null;
    const meta = extractNasaTarificacionesReturnMeta(rawResult);

    console.log(`\n${scenario.label} (${scenario.code}|${scenario.type}, qty ${scenario.quantity})`);
    console.log(JSON.stringify({ total, supplement, meta }, null, 2));
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
