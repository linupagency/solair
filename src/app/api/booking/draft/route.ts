import { NextRequest, NextResponse } from "next/server";
import {
  createBookingDraft,
  getBookingDraft,
  type BookingDraftAccommodation,
  type BookingDraftPayload,
  type BookingDraftSelectedDeparture,
  type BookingDraftTraveler,
  type BookingDraftVehicleData,
  type BookingDraftVehicleLine,
} from "@/lib/booking-draft-store";

export const dynamic = "force-dynamic";

type CreateDraftBody = BookingDraftPayload;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumberString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    return value.trim();
  }

  return "";
}

function isNonEmptyString(value: unknown) {
  return normalizeString(value).length > 0;
}

function isTravelerArray(value: unknown): value is BookingDraftTraveler[] {
  return Array.isArray(value);
}

function isVehicleData(value: unknown): value is BookingDraftVehicleData {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.marque === "string" &&
    typeof candidate.modele === "string" &&
    typeof candidate.immatriculation === "string" &&
    typeof candidate.conducteurIndex === "number"
  );
}

function isVehicleLine(value: unknown): value is BookingDraftVehicleLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.vehicle === "string" &&
    typeof row.vehicleCategory === "string" &&
    isVehicleData(row.vehicleData)
  );
}

function isSelectedDeparture(
  value: unknown
): value is BookingDraftSelectedDeparture {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.origen === "string" &&
    typeof candidate.destino === "string" &&
    typeof candidate.fechaSalida === "string" &&
    typeof candidate.horaSalida === "string" &&
    (typeof candidate.sentidoSalida === "undefined" ||
      typeof candidate.sentidoSalida === "number") &&
    typeof candidate.codigoServicioVenta === "string" &&
    typeof candidate.tipoServicioVenta === "string"
  );
}

function isAccommodationSelection(
  value: unknown
): value is BookingDraftAccommodation {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.code === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.price === "string"
  );
}

function buildNormalizedBody(
  body: Partial<CreateDraftBody>
): Partial<CreateDraftBody> {
  const travelers = isTravelerArray(body.passengersData)
    ? body.passengersData.map((t) => ({
        ...t,
        tipoPasajero:
          normalizeString(t.tipoPasajero) ||
          normalizeString(body.tipoPasajero) ||
          "A",
      }))
    : undefined;

  const firstTraveler = travelers?.[0];

  return {
    ...body,
    origen: normalizeString(body.origen),
    destino: normalizeString(body.destino),
    fechaSalida: normalizeString(body.fechaSalida),
    horaSalida: normalizeString(body.horaSalida),
    codigoServicioVenta: normalizeString(body.codigoServicioVenta),
    tipoServicioVenta: normalizeString(body.tipoServicioVenta),
    passengers: normalizeNumberString(body.passengers),
    vehicle: normalizeString(body.vehicle),

    nombre: normalizeString(body.nombre || firstTraveler?.nombre),
    apellido1: normalizeString(body.apellido1 || firstTraveler?.apellido1),
    apellido2: normalizeString(body.apellido2 || firstTraveler?.apellido2),
    fechaNacimiento: normalizeString(
      body.fechaNacimiento || firstTraveler?.fechaNacimiento
    ),
    codigoPais: normalizeString(body.codigoPais || firstTraveler?.codigoPais),
    sexo: normalizeString(body.sexo || firstTraveler?.sexo),
    codigoDocumento: normalizeString(
      body.codigoDocumento || firstTraveler?.codigoDocumento
    ),
    tipoDocumento: normalizeString(
      body.tipoDocumento || firstTraveler?.tipoDocumento
    ),

    tipoPasajero: normalizeString(body.tipoPasajero),
    bonificacion: normalizeString(body.bonificacion),
    mail: normalizeString(body.mail),
    telefono: normalizeString(body.telefono),
    total: normalizeNumberString(body.total),
    codigoTarifa: normalizeString(body.codigoTarifa),
    inboundCodigoTarifa: normalizeString(body.inboundCodigoTarifa),

    vehicleCategory: normalizeString(body.vehicleCategory),
    hebergementType: normalizeString(body.hebergementType),
    hebergementLabel: normalizeString(body.hebergementLabel),
    hebergementPrice: normalizeNumberString(body.hebergementPrice),

    tripType:
      body.tripType === "round_trip" || body.tripType === "one_way"
        ? body.tripType
        : "one_way",
    fechaVuelta: normalizeString(body.fechaVuelta),
    animalsCount: normalizeNumberString(body.animalsCount),

    passengersData: travelers,
    vehicleData: isVehicleData(body.vehicleData) ? body.vehicleData : undefined,
    vehiclesList: Array.isArray(body.vehiclesList)
      ? body.vehiclesList.filter(isVehicleLine)
      : undefined,
    inboundSelectedDeparture: isSelectedDeparture(body.inboundSelectedDeparture)
      ? body.inboundSelectedDeparture
      : null,
    inboundAccommodation: isAccommodationSelection(body.inboundAccommodation)
      ? body.inboundAccommodation
      : null,
  };
}

function validateDraftPayload(body: Partial<CreateDraftBody>) {
  const requiredFields: Array<keyof CreateDraftBody> = [
    "origen",
    "destino",
    "fechaSalida",
    "horaSalida",
    "codigoServicioVenta",
    "tipoServicioVenta",
    "passengers",
    "vehicle",
    "nombre",
    "apellido1",
    "fechaNacimiento",
    "codigoPais",
    "sexo",
    "codigoDocumento",
    "tipoPasajero",
    "bonificacion",
    "tipoDocumento",
    "mail",
    "telefono",
    "total",
    "codigoTarifa",
  ];

  const missingFields = requiredFields.filter((field) => {
    return !isNonEmptyString(body[field]);
  });

  const passengersCount = Number(body.passengers || "0");

  if (
    typeof body.passengersData !== "undefined" &&
    !isTravelerArray(body.passengersData)
  ) {
    missingFields.push("passengersData");
  }

  if (
    isTravelerArray(body.passengersData) &&
    passengersCount > 1 &&
    body.passengersData.length !== passengersCount
  ) {
    missingFields.push("passengersData");
  }

  if (isTravelerArray(body.passengersData)) {
    body.passengersData.forEach((traveler, index) => {
      const requiredTravelerFields: Array<keyof BookingDraftTraveler> = [
        "nombre",
        "apellido1",
        "fechaNacimiento",
        "codigoPais",
        "sexo",
        "tipoDocumento",
        "codigoDocumento",
        "tipoPasajero",
      ];

      requiredTravelerFields.forEach((field) => {
        if (!isNonEmptyString(traveler[field])) {
          missingFields.push(`passengersData[${index}].${field}` as never);
        }
      });
    });
  }

  if (body.vehicle !== "none") {
    const useList =
      Array.isArray(body.vehiclesList) && body.vehiclesList.length > 0;

    if (useList) {
      body.vehiclesList!.forEach((line, index) => {
        if (!isVehicleLine(line)) {
          missingFields.push(`vehiclesList[${index}]` as never);
          return;
        }
        if (!isNonEmptyString(line.vehicleData.marque)) {
          missingFields.push(`vehiclesList[${index}].vehicleData.marque` as never);
        }
        if (!isNonEmptyString(line.vehicleData.modele)) {
          missingFields.push(`vehiclesList[${index}].vehicleData.modele` as never);
        }
        if (!isNonEmptyString(line.vehicleData.immatriculation)) {
          missingFields.push(
            `vehiclesList[${index}].vehicleData.immatriculation` as never
          );
        }
      });
    } else {
      if (!isNonEmptyString(body.vehicleCategory)) {
        missingFields.push("vehicleCategory" as never);
      }

      if (!isVehicleData(body.vehicleData)) {
        missingFields.push("vehicleData" as never);
      } else {
        if (!isNonEmptyString(body.vehicleData.marque)) {
          missingFields.push("vehicleData.marque" as never);
        }
        if (!isNonEmptyString(body.vehicleData.modele)) {
          missingFields.push("vehicleData.modele" as never);
        }
        if (!isNonEmptyString(body.vehicleData.immatriculation)) {
          missingFields.push("vehicleData.immatriculation" as never);
        }
      }
    }
  }

  if (body.tripType === "round_trip") {
    if (!isNonEmptyString(body.fechaVuelta)) {
      missingFields.push("fechaVuelta" as never);
    }

    if (!isSelectedDeparture(body.inboundSelectedDeparture)) {
      missingFields.push("inboundSelectedDeparture" as never);
    }

    if (!isNonEmptyString(body.inboundCodigoTarifa)) {
      missingFields.push("inboundCodigoTarifa" as never);
    }

    if (
      typeof body.inboundAccommodation !== "undefined" &&
      body.inboundAccommodation !== null &&
      !isAccommodationSelection(body.inboundAccommodation)
    ) {
      missingFields.push("inboundAccommodation" as never);
    }
  }

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

function sanitizeTraveler(traveler: BookingDraftTraveler): BookingDraftTraveler {
  return {
    nombre: normalizeString(traveler.nombre),
    apellido1: normalizeString(traveler.apellido1),
    apellido2: normalizeString(traveler.apellido2),
    fechaNacimiento: normalizeString(traveler.fechaNacimiento),
    codigoPais: normalizeString(traveler.codigoPais),
    sexo: normalizeString(traveler.sexo),
    tipoDocumento: normalizeString(traveler.tipoDocumento),
    codigoDocumento: normalizeString(traveler.codigoDocumento),
    tipoPasajero: normalizeString(traveler.tipoPasajero),
  };
}

function sanitizeVehicleData(
  vehicleData?: BookingDraftVehicleData
): BookingDraftVehicleData | undefined {
  if (!vehicleData) return undefined;

  return {
    marque: normalizeString(vehicleData.marque),
    modele: normalizeString(vehicleData.modele),
    immatriculation: normalizeString(vehicleData.immatriculation),
    conducteurIndex: Number(vehicleData.conducteurIndex || 0),
  };
}

function sanitizeSelectedDeparture(
  departure?: BookingDraftSelectedDeparture | null
): BookingDraftSelectedDeparture | null {
  if (!departure) return null;

  return {
    origen: normalizeString(departure.origen),
    destino: normalizeString(departure.destino),
    fechaSalida: normalizeString(departure.fechaSalida),
    horaSalida: normalizeString(departure.horaSalida),
    // Sécurisation côté parsing serveur: en AR, l’inbound est toujours sentido=2.
    sentidoSalida: 2,
    codigoServicioVenta: normalizeString(departure.codigoServicioVenta),
    tipoServicioVenta: normalizeString(departure.tipoServicioVenta),
    barco: normalizeString(departure.barco),
    transportPrice: normalizeString(departure.transportPrice),
  };
}

function sanitizeAccommodation(
  accommodation?: BookingDraftAccommodation | null
): BookingDraftAccommodation | null {
  if (!accommodation) return null;

  return {
    code: normalizeString(accommodation.code),
    label: normalizeString(accommodation.label),
    price: normalizeNumberString(accommodation.price),
    details: normalizeString(accommodation.details),
  };
}

function sanitizeVehicleLine(line: BookingDraftVehicleLine): BookingDraftVehicleLine {
  return {
    vehicle: normalizeString(line.vehicle),
    vehicleCategory: normalizeString(line.vehicleCategory),
    vehicleData: sanitizeVehicleData(line.vehicleData)!,
  };
}

function sanitizePayload(body: Partial<CreateDraftBody>): CreateDraftBody {
  const normalized = buildNormalizedBody(body);

  return {
    origen: normalizeString(normalized.origen),
    destino: normalizeString(normalized.destino),
    fechaSalida: normalizeString(normalized.fechaSalida),
    horaSalida: normalizeString(normalized.horaSalida),
    codigoServicioVenta: normalizeString(normalized.codigoServicioVenta),
    tipoServicioVenta: normalizeString(normalized.tipoServicioVenta),
    passengers: normalizeNumberString(normalized.passengers),
    vehicle: normalizeString(normalized.vehicle),

    nombre: normalizeString(normalized.nombre),
    apellido1: normalizeString(normalized.apellido1),
    apellido2: normalizeString(normalized.apellido2),
    fechaNacimiento: normalizeString(normalized.fechaNacimiento),
    codigoPais: normalizeString(normalized.codigoPais),
    sexo: normalizeString(normalized.sexo),
    codigoDocumento: normalizeString(normalized.codigoDocumento),
    tipoPasajero: normalizeString(normalized.tipoPasajero),
    bonificacion: normalizeString(normalized.bonificacion),
    tipoDocumento: normalizeString(normalized.tipoDocumento),

    mail: normalizeString(normalized.mail),
    telefono: normalizeString(normalized.telefono),
    total: normalizeNumberString(normalized.total),
    codigoTarifa: normalizeString(normalized.codigoTarifa),
    inboundCodigoTarifa: normalizeString(normalized.inboundCodigoTarifa),

    passengersData: isTravelerArray(normalized.passengersData)
      ? normalized.passengersData.map(sanitizeTraveler)
      : undefined,

    vehicleCategory: normalizeString(normalized.vehicleCategory),
    vehicleData: sanitizeVehicleData(normalized.vehicleData),
    vehiclesList:
      Array.isArray(normalized.vehiclesList) && normalized.vehiclesList.length > 0
        ? normalized.vehiclesList.filter(isVehicleLine).map(sanitizeVehicleLine)
        : undefined,

    hebergementType: normalizeString(normalized.hebergementType),
    hebergementLabel: normalizeString(normalized.hebergementLabel),
    hebergementPrice: normalizeNumberString(normalized.hebergementPrice),

    tripType:
      normalized.tripType === "round_trip" ? "round_trip" : "one_way",
    fechaVuelta: normalizeString(normalized.fechaVuelta),
    animalsCount: normalizeNumberString(normalized.animalsCount),

    inboundSelectedDeparture: sanitizeSelectedDeparture(
      normalized.inboundSelectedDeparture
    ),
    inboundAccommodation: sanitizeAccommodation(
      normalized.inboundAccommodation
    ),
  };
}

export async function POST(request: NextRequest) {
  let rawBody: Partial<CreateDraftBody>;

  try {
    rawBody = (await request.json()) as Partial<CreateDraftBody>;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const normalizedBody = buildNormalizedBody(rawBody);
  const validation = validateDraftPayload(normalizedBody);

  if (!validation.isValid) {
    return NextResponse.json(
      {
        ok: false,
        message: "Paramètres manquants pour créer le draft.",
        missingFields: validation.missingFields,
      },
      { status: 400 }
    );
  }

  try {
    const draft = await createBookingDraft(sanitizePayload(normalizedBody));

    return NextResponse.json({
      ok: true,
      message: "Draft de réservation créé.",
      draftId: draft.id,
      createdAt: draft.createdAt,
      data: draft,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue.";

    return NextResponse.json(
      {
        ok: false,
        message: "Impossible de créer le draft.",
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const draftId = searchParams.get("draftId")?.trim();

  if (!draftId) {
    return NextResponse.json(
      {
        ok: false,
        message: "Le paramètre 'draftId' est obligatoire.",
      },
      { status: 400 }
    );
  }

  try {
    const draft = await getBookingDraft(draftId);

    if (!draft) {
      return NextResponse.json(
        {
          ok: false,
          message: "Draft introuvable.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Draft de réservation récupéré.",
      data: draft,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue.";

    return NextResponse.json(
      {
        ok: false,
        message: "Impossible de récupérer le draft.",
        error: message,
      },
      { status: 500 }
    );
  }
}