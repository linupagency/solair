import https from "https";
import soap from "soap";
import {
  armasConfig,
  getArmasCertBuffer,
  getResolvedArmasWsdlUrl,
} from "@/lib/armas/config";
import { isCarWithTrailerCategory, type CarTrailerCategory } from "@/lib/solair-vehicle-trailer";
import {
  armasTipoVehiculoForCategory,
  baseLargoMForTrailerSplit,
  defaultVehiculoDimensions,
  isBookingVehicleCategoryId,
} from "@/lib/vehicle/armas-catalog";
import type { ArmasContext } from "@/types/armas";
import { isPrimaryServiceEligibleForVehicleCompanionPricing } from "@/lib/armas/pricing-combined-primary";
import {
  getNasaTarificacionesReturnNode,
  normalizeNasaTarificacionesLines,
} from "@/lib/armas/tarificacion-normalize";

type ReservationPassengerInput = {
  nombre: string;
  apellido1: string;
  apellido2?: string;
  codigoDocumento: string;
  codigoPais: string;
  fechaNacimiento: string;
  sexo: string;
  tipoDocumento: string;
  tipoPasajero: string;
};

type ReservationVehicleInput = {
  vehicle?: string;
  vehicleCategory?: string;
  vehicleData?: {
    marque?: string;
    modele?: string;
    immatriculation?: string;
    alto?: string | number;
    ancho?: string | number;
    largo?: string | number;
    /** WSDL `VehEntidad.tipoVehiculo` */
    tipoVehiculo?: string;
    /** WSDL `VehEntidad.tara` (entier) */
    tara?: string | number;
    /** WSDL `VehEntidad.seguro` */
    seguro?: string;
  };
};

type PricingPassengerSoapEntity = {
  tipoPasajeroEntidad: {
    tipoPasajero: string;
  };
  numeroBebes?: number;
  numeroMascotas?: number;
};

type ReservationPassengerSoapEntity = {
  apellido1: string;
  apellido2: string;
  codigoDocumento: string;
  codigoPais: string;
  fechaNacimiento: string;
  nombre: string;
  numeroBebes: number;
  numeroMascotas?: number;
  sexo: string;
  tipoDocumentoEntidad: {
    tipoDocumento: string;
  };
  tipoPasajeroEntidad: {
    tipoPasajero: string;
  };
};

type VehicleSoapEntity = {
  tipoVehiculo: string;
  marca: string;
  matricula: string;
  alto?: number;
  ancho?: number;
  largo?: number;
  /** WSDL `VehEntidad.metrosExtra` — mètres au-delà de la longueur voiture de base (remorque). */
  metrosExtra?: number;
  /** WSDL `VehEntidad.seguro` */
  seguro?: string;
  /** WSDL `VehEntidad.tara` */
  tara?: number;
};

type PaxVehSoapItem = {
  pasajeroEntidad: PricingPassengerSoapEntity | ReservationPassengerSoapEntity;
  vehiculoEntidad?: VehicleSoapEntity;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(
      value.trim().replace(/\s/g, "").replace(",", ".")
    );
    if (Number.isFinite(parsed)) return parsed;
  }

  return undefined;
}

function getVehicleDefaults(category: string, legacyVehicle: string) {
  const key = (category || legacyVehicle).trim();
  const resolved =
    key === "car"
      ? "small_tourism_car"
      : isBookingVehicleCategoryId(key)
        ? key
        : "";
  if (resolved) {
    const d = defaultVehiculoDimensions(resolved);
    return {
      tipoVehiculo: armasTipoVehiculoForCategory(resolved),
      alto: d.alto,
      ancho: d.ancho,
      largo: d.largo,
    };
  }
  return {
    tipoVehiculo: "V",
  };
}

function getVehicleFallbackLabel(category: string, legacyVehicle: string) {
  switch (category || legacyVehicle) {
    case "small_tourism_car":
      return "PETITE VOITURE";
    case "large_tourism_car":
      return "GRANDE VOITURE";
    case "medium_tourism_car":
      return "VOITURE MOYENNE";
    case "small_tourism_car_trailer":
      return "PETITE VOITURE REMORQUE";
    case "medium_tourism_car_trailer":
      return "VOITURE MOYENNE REMORQUE";
    case "large_tourism_car_trailer":
      return "GRANDE VOITURE REMORQUE";
    case "bus_with_trailer":
      return "AUTOBUS REMORQUE";
    case "camper":
      return "CAMPING CAR";
    case "moto":
      return "MOTO";
    case "bike":
    case "bicycle":
      return "BICICLETA";
    case "car":
      return "VOITURE";
    default:
      return "VEHICULE";
  }
}

export function buildArmasContext(): ArmasContext {
  return {
    codigoAgencia: armasConfig.agencyCode,
    codigoIdioma: armasConfig.language,
    codigoUsuario: armasConfig.userCode,
    versionXml: armasConfig.xmlVersion,
  };
}

function buildHttpsAgent() {
  const pfxBuffer = getArmasCertBuffer();
  if (!pfxBuffer) return undefined;

  return new https.Agent({
    pfx: pfxBuffer,
    passphrase: armasConfig.certPassphrase || undefined,
    rejectUnauthorized: true,
  });
}

export async function createArmasSoapClient() {
  const httpsAgent = buildHttpsAgent();
  const pfxBuffer = getArmasCertBuffer();
  const wsdlUrl = getResolvedArmasWsdlUrl();

  const client = await soap.createClientAsync(wsdlUrl, {
    endpoint: armasConfig.endpoint || undefined,
    wsdl_options: httpsAgent ? { httpsAgent } : undefined,
  });

  if (pfxBuffer) {
    client.setSecurity(
      new soap.ClientSSLSecurityPFX(
        pfxBuffer,
        armasConfig.certPassphrase || ""
      )
    );
  }

  return client;
}

export async function nasaPuertosRequest() {
  const client = await createArmasSoapClient();
  const args = { contextoEntidad: buildArmasContext() };
  const [result] = await client.nasaPuertosAsync(args);
  return result;
}

export async function nasaTrayectosRequest(codigoPuerto: string) {
  const client = await createArmasSoapClient();
  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto },
  };
  const [result] = await client.nasaTrayectosAsync(args);
  return result;
}

export async function nasaSalidasRequest(
  origen: string,
  destino: string,
  fecha: string
) {
  const client = await createArmasSoapClient();
  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
    fecha,
  };
  const [result] = await client.nasaSalidasAsync(args);
  return result;
}

export async function nasaServiciosVentasRequest(origen: string, destino: string) {
  const client = await createArmasSoapClient();
  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
  };
  const [result] = await client.nasaServiciosVentasAsync(args);
  return result;
}

/**
 * Remorque : `split` = largo longueur voiture seule + metrosExtra (WSDL).
 * `raw` = largo = longueur totale (8/10/14 m ou saisie), sans metrosExtra.
 * Défaut côté `buildVehicleEntity` (remorque) : `split` si absent — meilleure adéquation
 * nasaTarificaciones. `rawTrailerLength=true` force le mode `raw`.
 */
export type TrailerVehiculoEntidadMode = "split" | "raw";

export function trailerVehiculoEntidadModeFromFlag(
  rawTrailerLength?: boolean
): TrailerVehiculoEntidadMode | undefined {
  if (rawTrailerLength === true) return "raw";
  if (rawTrailerLength === false) return "split";
  return undefined;
}

function applyWsdlVehicleExtras(
  input: ReservationVehicleInput | undefined,
  entity: VehicleSoapEntity
): VehicleSoapEntity {
  const out: VehicleSoapEntity = { ...entity };
  const tv = normalizeString(input?.vehicleData?.tipoVehiculo);
  if (tv) out.tipoVehiculo = tv;
  const taraRaw = input?.vehicleData?.tara;
  if (taraRaw !== undefined && taraRaw !== "") {
    const ti =
      typeof taraRaw === "number"
        ? Math.floor(taraRaw)
        : Math.floor(Number(String(taraRaw).trim().replace(",", ".")));
    if (Number.isFinite(ti) && ti >= 0) out.tara = ti;
  }
  const seg = normalizeString(input?.vehicleData?.seguro);
  if (seg) out.seguro = seg;
  return out;
}

function buildVehicleEntity(
  input?: ReservationVehicleInput,
  trailerMode?: TrailerVehiculoEntidadMode
): VehicleSoapEntity | undefined {
  const vehicle = normalizeString(input?.vehicle);
  const vehicleCategory = normalizeString(input?.vehicleCategory);

  if (
    vehicle === "none" ||
    (!vehicle && !vehicleCategory) ||
    vehicleCategory === "none"
  ) {
    return undefined;
  }

  const defaults = getVehicleDefaults(vehicleCategory, vehicle);

  const marque = normalizeString(input?.vehicleData?.marque);
  const modele = normalizeString(input?.vehicleData?.modele);
  const immatriculation = normalizeString(input?.vehicleData?.immatriculation);

  const alto =
    toOptionalNumber(input?.vehicleData?.alto) ?? defaults.alto;
  const ancho =
    toOptionalNumber(input?.vehicleData?.ancho) ?? defaults.ancho;
  const largo =
    toOptionalNumber(input?.vehicleData?.largo) ?? defaults.largo;

  const marca =
    [marque, modele].filter(Boolean).join(" ").trim() ||
    getVehicleFallbackLabel(vehicleCategory, vehicle);

  if (vehicleCategory && isCarWithTrailerCategory(vehicleCategory)) {
    const cat = vehicleCategory as CarTrailerCategory;
    const baseLargoM = baseLargoMForTrailerSplit(cat);
    const totalMeters = Number.isFinite(largo)
      ? (largo as number)
      : defaultVehiculoDimensions(cat).largo;
    /**
     * Défaut **split** (largo voiture + metrosExtra) : sur nasaTarificaciones, un
     * seul `largo` total sans `metrosExtra` peut être interprété comme voiture
     * courte → tarif VR / remorque sous-évalué (ex. total affiché = siège seul).
     * `rawTrailerLength === true` force toujours le mode « longueur totale ».
     */
    const mode = trailerMode ?? "split";
    if (mode === "raw") {
      return applyWsdlVehicleExtras(input, {
        tipoVehiculo: defaults.tipoVehiculo,
        marca,
        matricula: immatriculation || "TEMP123",
        alto,
        ancho,
        largo: totalMeters,
      });
    }
    const metrosExtra = Math.max(0, totalMeters - baseLargoM);
    return applyWsdlVehicleExtras(input, {
      tipoVehiculo: defaults.tipoVehiculo,
      marca,
      matricula: immatriculation || "TEMP123",
      alto,
      ancho,
      largo: baseLargoM,
      metrosExtra,
    });
  }

  return applyWsdlVehicleExtras(input, {
    tipoVehiculo: defaults.tipoVehiculo,
    marca,
    matricula: immatriculation || "TEMP123",
    alto,
    ancho,
    largo,
  });
}

function buildPricingPaxsVehsEntidad(params: {
  tiposPasajero: string[];
  numeroBebesByPax?: number[];
  animalsCount?: number;
  vehicle?: string;
  vehicleCategory?: string;
  vehiclePassengerIndex?: number;
  vehicleData?: ReservationVehicleInput["vehicleData"];
  trailerVehiculoEntidadMode?: TrailerVehiculoEntidadMode;
}) {
  const animals = Math.max(0, Math.floor(params.animalsCount ?? 0));
  const paxVehItems: PaxVehSoapItem[] = params.tiposPasajero.map(
    (tipoPasajero, index) => ({
      pasajeroEntidad: {
        tipoPasajeroEntidad: {
          tipoPasajero,
        },
        ...(typeof params.numeroBebesByPax?.[index] === "number" &&
        (params.numeroBebesByPax?.[index] ?? 0) > 0
          ? { numeroBebes: params.numeroBebesByPax?.[index] }
          : {}),
        ...(index === 0 && animals > 0 ? { numeroMascotas: animals } : {}),
      },
    })
  );

  const vehicleEntity = buildVehicleEntity(
    {
      vehicle: params.vehicle,
      vehicleCategory: params.vehicleCategory,
      vehicleData: params.vehicleData,
    },
    params.trailerVehiculoEntidadMode
  );

  const vIndex = Math.min(
    Math.max(0, params.vehiclePassengerIndex ?? 0),
    Math.max(0, paxVehItems.length - 1)
  );

  if (vehicleEntity && paxVehItems.length > 0) {
    paxVehItems[vIndex] = {
      ...paxVehItems[vIndex],
      vehiculoEntidad: vehicleEntity,
    };
  }

  return {
    paxVehEntidad: paxVehItems.length === 1 ? paxVehItems[0] : paxVehItems,
  };
}

function buildPricingPassengerPlan(params: {
  passengerTipos?: string[];
  cantidad: number;
  tipoPasajero: string;
}) {
  const tiposBase =
    params.passengerTipos &&
    params.passengerTipos.length === params.cantidad &&
    params.cantidad > 0
      ? params.passengerTipos
      : Array.from({ length: Math.max(1, params.cantidad) }, () => params.tipoPasajero);

  const babies = tiposBase.filter((t) => t === "B").length;
  const tiposSansBebe = tiposBase.filter((t) => t !== "B");

  if (babies <= 0 || tiposSansBebe.length === 0) {
    return {
      tiposPasajero: tiposBase,
      numeroBebesByPax: Array.from({ length: tiposBase.length }, () => 0),
      cantidadServicioVenta: tiposBase.length,
    };
  }

  const numeroBebesByPax = Array.from({ length: tiposSansBebe.length }, () => 0);
  const firstAdultIndex = tiposSansBebe.findIndex((t) => t === "A");
  const attachIndex = firstAdultIndex >= 0 ? firstAdultIndex : 0;
  numeroBebesByPax[attachIndex] = babies;

  return {
    tiposPasajero: tiposSansBebe,
    numeroBebesByPax,
    cantidadServicioVenta: tiposSansBebe.length,
  };
}

function buildPassengerEntity(
  passenger: ReservationPassengerInput,
  extras?: { numeroMascotas?: number }
): ReservationPassengerSoapEntity {
  return {
    apellido1: passenger.apellido1,
    apellido2: passenger.apellido2 || "",
    codigoDocumento: passenger.codigoDocumento,
    codigoPais: passenger.codigoPais,
    fechaNacimiento: passenger.fechaNacimiento,
    nombre: passenger.nombre,
    numeroBebes: 0,
    ...(typeof extras?.numeroMascotas === "number" && extras.numeroMascotas > 0
      ? { numeroMascotas: extras.numeroMascotas }
      : {}),
    sexo: passenger.sexo,
    tipoDocumentoEntidad: {
      tipoDocumento: passenger.tipoDocumento,
    },
    tipoPasajeroEntidad: {
      tipoPasajero: passenger.tipoPasajero,
    },
  };
}

function buildReservationPaxsVehsEntidad(
  passengers: ReservationPassengerInput[],
  options?: {
    animalsCount?: number;
    vehicleInputs?: Array<{
      passengerIndex: number;
      input: ReservationVehicleInput;
    }>;
    fallbackVehicle?: ReservationVehicleInput;
  }
) {
  const animals = Math.max(0, Math.floor(options?.animalsCount ?? 0));

  const paxVehItems: PaxVehSoapItem[] = passengers.map((passenger, index) => ({
    pasajeroEntidad: buildPassengerEntity(
      passenger,
      index === 0 && animals > 0 ? { numeroMascotas: animals } : undefined
    ),
  }));

  const assignments = options?.vehicleInputs?.length
    ? options.vehicleInputs
    : options?.fallbackVehicle
      ? [{ passengerIndex: 0, input: options.fallbackVehicle }]
      : [];

  for (const assignment of assignments) {
    const idx = Math.min(
      Math.max(0, assignment.passengerIndex),
      Math.max(0, paxVehItems.length - 1)
    );
    const vehicleEntity = buildVehicleEntity(assignment.input);
    if (vehicleEntity && paxVehItems[idx]) {
      paxVehItems[idx] = {
        ...paxVehItems[idx],
        vehiculoEntidad: vehicleEntity,
      };
    }
  }

  return {
    paxVehEntidad: paxVehItems.length === 1 ? paxVehItems[0] : paxVehItems,
  };
}

export type NasaTarificacionesRequestParams = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  tipoPasajero: string;
  passengerTipos?: string[];
  animalsCount?: number;
  bonificacion: string;
  sentidoSalida?: number;
  vehicle?: string;
  vehicleCategory?: string;
  vehiclePassengerIndex?: number;
  vehicleData?: ReservationVehicleInput["vehicleData"];
  companionServicioVenta?: {
    codigoServicioVenta: string;
    tipoServicioVenta: string;
    cantidad?: number;
  };
  /**
   * Remorque : `true` → `raw` (largo = longueur totale, sans metrosExtra). `false` ou omis →
   * `split` (largo base palier + metrosExtra). Ignoré si la catégorie n’est pas `*_trailer`.
   */
  rawTrailerLength?: boolean;
  /** Log console détaillé pour cet appel (soapArgs, vehiculoEntidad, codigo/texto Armas, tarificacionesNormalized). */
  pricingSoapTrace?: boolean;
};

/** Arguments exacts passés à `nasaTarificacionesAsync` (hors client SOAP). */
export function buildNasaTarificacionesSoapArgs(
  params: NasaTarificacionesRequestParams
) {
  const passengerPlan = buildPricingPassengerPlan({
    passengerTipos: params.passengerTipos,
    cantidad: params.cantidad,
    tipoPasajero: params.tipoPasajero,
  });

  const primaryServicio = {
    cantidad: passengerPlan.cantidadServicioVenta,
    codigoServicioVenta: params.codigoServicioVenta,
    tipoServicioVenta: params.tipoServicioVenta,
  };
  let companion = params.companionServicioVenta;
  if (
    companion &&
    !isPrimaryServiceEligibleForVehicleCompanionPricing({
      codigoServicioVenta: params.codigoServicioVenta,
      tipoServicioVenta: params.tipoServicioVenta,
    })
  ) {
    companion = undefined;
  }
  /**
   * Toujours **passager (primaire) puis companion véhicule** (V, VR, …).
   * Mettre **VR|V avant BY|P** + longueur totale dans `largo` provoque **TF0004** sur
   * les lignes testées (ALG–PTM). L’ordre **V|V** en tête idem.
   */
  const servicioVentaEntidad =
    companion &&
    companion.codigoServicioVenta?.trim() &&
    companion.tipoServicioVenta?.trim()
      ? [
          primaryServicio,
          {
            cantidad: companion.cantidad ?? 1,
            codigoServicioVenta: companion.codigoServicioVenta.trim(),
            tipoServicioVenta: companion.tipoServicioVenta.trim(),
          },
        ]
      : primaryServicio;

  /** Ne pas forcer `raw` ici : `buildVehicleEntity` applique le défaut remorque (split). */
  const trailerMode = trailerVehiculoEntidadModeFromFlag(params.rawTrailerLength);

  return {
    contextoEntidad: buildArmasContext(),
    salidasEntidad: {
      salidaEntidad: {
        fechaSalida: params.fechaSalida,
        horaSalida: params.horaSalida,
        sentidoSalida: params.sentidoSalida ?? 1,
        serviciosVentasEntidad: {
          servicioVentaEntidad,
        },
        trayectoEntidad: {
          puertoDestinoEntidad: { codigoPuerto: params.destino },
          puertoOrigenEntidad: { codigoPuerto: params.origen },
        },
      },
    },
    paxsVehsEntidad: buildPricingPaxsVehsEntidad({
      tiposPasajero: passengerPlan.tiposPasajero,
      numeroBebesByPax: passengerPlan.numeroBebesByPax,
      animalsCount: params.animalsCount,
      vehicle: params.vehicle,
      vehicleCategory: params.vehicleCategory,
      vehiclePassengerIndex: params.vehiclePassengerIndex,
      vehicleData: params.vehicleData,
      trailerVehiculoEntidadMode: trailerMode,
    }),
    bonificacionEntidad: {
      codigoBonificacion: params.bonificacion,
    },
  };
}

/** `vehiculoEntidad` attaché au premier passager tarifé (pricing). */
export function extractPricingVehiculoEntidad(
  args: ReturnType<typeof buildNasaTarificacionesSoapArgs>
): VehicleSoapEntity | undefined {
  const raw = args.paxsVehsEntidad.paxVehEntidad as
    | PaxVehSoapItem
    | PaxVehSoapItem[]
    | undefined;
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
  for (const item of list) {
    if (item?.vehiculoEntidad) return item.vehiculoEntidad;
  }
  return undefined;
}

function armasPricingDebugEnabled() {
  return normalizeString(process.env.SOLAIR_ARMAS_PRICING_DEBUG) === "1";
}

function shouldLogNasaTarificacionesPricing(
  params: NasaTarificacionesRequestParams
) {
  return armasPricingDebugEnabled() || params.pricingSoapTrace === true;
}

export function extractNasaTarificacionesReturnMeta(result: unknown): {
  codigo?: string;
  texto?: string;
} {
  const ret = getNasaTarificacionesReturnNode(result);
  if (!ret) return {};
  return {
    codigo: ret.codigo != null ? String(ret.codigo) : undefined,
    texto: ret.texto != null ? String(ret.texto) : undefined,
  };
}

export async function nasaTarificacionesRequest(
  params: NasaTarificacionesRequestParams
) {
  const client = await createArmasSoapClient();
  const args = buildNasaTarificacionesSoapArgs(params);

  if (shouldLogNasaTarificacionesPricing(params)) {
    const veh = extractPricingVehiculoEntidad(args);
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] soapArgs=",
      JSON.stringify(args, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] vehiculoEntidad=",
      JSON.stringify(veh ?? null, null, 2)
    );
  }

  const [result] = await client.nasaTarificacionesAsync(args);

  if (shouldLogNasaTarificacionesPricing(params)) {
    const { codigo, texto } = extractNasaTarificacionesReturnMeta(result);
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] armasReturn=",
      JSON.stringify({ codigo, texto }, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] soapResult=",
      JSON.stringify(result, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] tarificacionesNormalized=",
      JSON.stringify(normalizeNasaTarificacionesLines(result), null, 2)
    );
  }

  return result;
}

export type NasaTarificacionesSoapArgs = ReturnType<
  typeof buildNasaTarificacionesSoapArgs
>;

/**
 * Appel `nasaTarificaciones` avec des arguments SOAP déjà construits (lab / probe uniquement).
 */
export async function nasaTarificacionesRequestWithSoapArgs(
  soapArgs: NasaTarificacionesSoapArgs,
  logContext?: { pricingSoapTrace?: boolean }
): Promise<unknown> {
  const client = await createArmasSoapClient();
  const trace =
    armasPricingDebugEnabled() || logContext?.pricingSoapTrace === true;

  if (trace) {
    const veh = extractPricingVehiculoEntidad(soapArgs);
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] soapArgs=",
      JSON.stringify(soapArgs, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] vehiculoEntidad=",
      JSON.stringify(veh ?? null, null, 2)
    );
  }

  const [result] = await client.nasaTarificacionesAsync(soapArgs);

  if (trace) {
    const { codigo, texto } = extractNasaTarificacionesReturnMeta(result);
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] armasReturn=",
      JSON.stringify({ codigo, texto }, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] soapResult=",
      JSON.stringify(result, null, 2)
    );
    console.error(
      "[SOLAIR_ARMAS_PRICING_DEBUG] tarificacionesNormalized=",
      JSON.stringify(normalizeNasaTarificacionesLines(result), null, 2)
    );
  }

  return result;
}

export async function nasaTiposPasajerosRequest(
  origen: string,
  destino: string
) {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
  };

  const [result] = await client.nasaTiposPasjerosAsync(args);
  return result;
}

export async function nasaBonificacionesRequest(
  origen: string,
  destino: string
) {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
  };

  const [result] = await client.nasaBonificacionesAsync(args);
  return result;
}

export async function nasaTiposDocumentosRequest(
  origen: string,
  destino: string
) {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
  };

  const [result] = await client.nasaTiposDocumentosAsync(args);
  return result;
}

export async function nasaTarifasRequest(origen: string, destino: string) {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
    puertoOrigenEntidad: { codigoPuerto: origen },
    puertoDestinoEntidad: { codigoPuerto: destino },
  };

  const [result] = await client.nasaTarifasAsync(args);
  return result;
}

export async function nasaReservasRequest(params: {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  nombre: string;
  apellido1: string;
  apellido2?: string;
  codigoDocumento: string;
  codigoPais: string;
  fechaNacimiento: string;
  sexo: string;
  tipoDocumento: string;
  tipoPasajero: string;
  codigoTarifa: string;
  bonificacion: string;
  mail: string;
  telefono: string;
  observaciones?: string;
  sentidoSalida?: number;
  passengersData?: ReservationPassengerInput[];
  animalsCount?: number;
  vehicle?: string;
  vehicleCategory?: string;
  vehicleData?: ReservationVehicleInput["vehicleData"];
  /** Un véhicule par entrée, rattaché au passager d’indice `passengerIndex` */
  vehicleAssignments?: Array<{
    passengerIndex: number;
    vehicle?: string;
    vehicleCategory?: string;
    vehicleData?: ReservationVehicleInput["vehicleData"];
  }>;
}) {
  const client = await createArmasSoapClient();

  const passengers =
    params.passengersData && params.passengersData.length > 0
      ? params.passengersData
      : [
          {
            nombre: params.nombre,
            apellido1: params.apellido1,
            apellido2: params.apellido2 || "",
            codigoDocumento: params.codigoDocumento,
            codigoPais: params.codigoPais,
            fechaNacimiento: params.fechaNacimiento,
            sexo: params.sexo,
            tipoDocumento: params.tipoDocumento,
            tipoPasajero: params.tipoPasajero,
          },
        ];

  const vehicleInputs =
    params.vehicleAssignments?.map((row) => ({
      passengerIndex: row.passengerIndex,
      input: {
        vehicle: row.vehicle,
        vehicleCategory: row.vehicleCategory,
        vehicleData: row.vehicleData,
      },
    })) ?? [];

  const args = {
    contextoEntidad: buildArmasContext(),
    salidasEntidad: {
      salidaEntidad: {
        fechaSalida: params.fechaSalida,
        horaSalida: params.horaSalida,
        sentidoSalida: params.sentidoSalida ?? 1,
        serviciosVentasEntidad: {
          servicioVentaEntidad: {
            cantidad: params.cantidad,
            codigoServicioVenta: params.codigoServicioVenta,
            tipoServicioVenta: params.tipoServicioVenta,
          },
        },
        trayectoEntidad: {
          puertoDestinoEntidad: { codigoPuerto: params.destino },
          puertoOrigenEntidad: { codigoPuerto: params.origen },
        },
      },
    },
    paxsVehsEntidad: buildReservationPaxsVehsEntidad(passengers, {
      animalsCount: params.animalsCount,
      vehicleInputs: vehicleInputs.length > 0 ? vehicleInputs : undefined,
      fallbackVehicle:
        vehicleInputs.length === 0
          ? {
              vehicle: params.vehicle,
              vehicleCategory: params.vehicleCategory,
              vehicleData: params.vehicleData,
            }
          : undefined,
    }),
    tarifaEntidad: {
      codigoTarifa: params.codigoTarifa,
    },
    bonificacionEntidad: {
      codigoBonificacion: params.bonificacion,
    },
    datosExtraEntidad: {
      mail: params.mail,
      observaciones: params.observaciones || "",
      telefono: params.telefono,
    },
  };

  const [result] = await client.nasaReservasAsync(args);
  return result;
}

export async function nasaCancelaReservaRequest(codigoLocata: string) {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
    locataEntidad: {
      codigoLocata,
    },
  };

  const [result] = await client.nasaCancelaReservaAsync(args);
  return result;
}