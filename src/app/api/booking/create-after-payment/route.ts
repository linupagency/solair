import { NextRequest, NextResponse } from "next/server";
import { validateArmasBasicConfig } from "@/lib/armas/config";
import { nasaReservasRequest } from "@/lib/armas/client";
import {
  getBookingDraft,
  markBookingDraftReserved,
  type BookingDraftTraveler,
  type BookingDraftVehicleData,
} from "@/lib/booking-draft-store";
import { sendBookingConfirmationEmail } from "@/lib/email";

type CreateAfterPaymentBody = {
  draftId: string;
};

type ReservationResponse = {
  return?: {
    codigo?: string;
    texto?: string;
    reservasEntidad?: {
      reservaEntidad?:
        | {
            fechaValidezReserva?: string;
            locataEntidad?: {
              codigoLocata?: string;
            };
            precioEntidad?: {
              total?: number | string;
            };
          }
        | Array<{
            fechaValidezReserva?: string;
            locataEntidad?: {
              codigoLocata?: string;
            };
            precioEntidad?: {
              total?: number | string;
            };
          }>;
    };
  };
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isBusinessSuccess(code: string) {
  return code === "000000" || code === "000001" || code === "000002";
}

function getFirstReservation(result: ReservationResponse) {
  const raw = result?.return?.reservasEntidad?.reservaEntidad;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function normalizeTraveler(traveler: BookingDraftTraveler) {
  return {
    nombre: traveler.nombre.trim(),
    apellido1: traveler.apellido1.trim(),
    apellido2: traveler.apellido2?.trim() || "",
    codigoDocumento: traveler.codigoDocumento.trim(),
    codigoPais: traveler.codigoPais.trim(),
    fechaNacimiento: traveler.fechaNacimiento.trim(),
    sexo: traveler.sexo.trim(),
    tipoDocumento: traveler.tipoDocumento.trim(),
    tipoPasajero: traveler.tipoPasajero.trim(),
  };
}

function normalizeVehicleData(
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

export async function POST(request: NextRequest) {
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

  let body: CreateAfterPaymentBody;

  try {
    body = (await request.json()) as CreateAfterPaymentBody;
  } catch {
    return NextResponse.json(
      {
        ok: false,
        message: "Body JSON invalide.",
      },
      { status: 400 }
    );
  }

  const draftId = normalizeString(body.draftId);

  if (!draftId) {
    return NextResponse.json(
      {
        ok: false,
        message: "draftId est obligatoire.",
      },
      { status: 400 }
    );
  }

  let draft;
  try {
    draft = await getBookingDraft(draftId);
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

  if (!draft) {
    return NextResponse.json(
      {
        ok: false,
        message: "Draft introuvable.",
      },
      { status: 404 }
    );
  }

  if (draft.status === "reserved" && draft.reservation?.codigoLocata) {
    return NextResponse.json({
      ok: true,
      message: "Réservation déjà créée pour ce draft.",
      draftId,
      alreadyReserved: true,
      reservation: draft.reservation,
    });
  }

  try {
    const payload = draft.payload;

    const passengersData =
      payload.passengersData && payload.passengersData.length > 0
        ? payload.passengersData.map((traveler) => ({
            ...normalizeTraveler(traveler),
            tipoPasajero:
              normalizeString(traveler.tipoPasajero) || payload.tipoPasajero,
          }))
        : undefined;

    const vehicleData = normalizeVehicleData(payload.vehicleData);

    const animalsCount = Math.max(
      0,
      Math.floor(Number(payload.animalsCount || 0))
    );

    function buildVehicleAssignments() {
      const list = payload.vehiclesList;
      if (list && list.length > 0) {
        return list.map((row) => ({
          passengerIndex: row.vehicleData.conducteurIndex,
          vehicle: row.vehicle,
          vehicleCategory: row.vehicleCategory,
          vehicleData: {
            marque: row.vehicleData.marque,
            modele: row.vehicleData.modele,
            immatriculation: row.vehicleData.immatriculation,
          },
        }));
      }
      if (payload.vehicle !== "none" && vehicleData) {
        return [
          {
            passengerIndex: vehicleData.conducteurIndex,
            vehicle: payload.vehicle,
            vehicleCategory: normalizeString(payload.vehicleCategory),
            vehicleData: {
              marque: vehicleData.marque,
              modele: vehicleData.modele,
              immatriculation: vehicleData.immatriculation,
            },
          },
        ];
      }
      return undefined;
    }

    const vehicleAssignments = buildVehicleAssignments();

    async function bookOneLeg(args: {
      origen: string;
      destino: string;
      fechaSalida: string;
      horaSalida: string;
      codigoServicioVenta: string;
      tipoServicioVenta: string;
      codigoTarifa: string;
    }) {
      return (await nasaReservasRequest({
        origen: args.origen,
        destino: args.destino,
        fechaSalida: args.fechaSalida,
        horaSalida: args.horaSalida,
        cantidad: Number(payload.passengers),
        codigoServicioVenta: args.codigoServicioVenta,
        tipoServicioVenta: args.tipoServicioVenta,
        nombre: payload.nombre,
        apellido1: payload.apellido1,
        apellido2: payload.apellido2 || "",
        codigoDocumento: payload.codigoDocumento,
        codigoPais: payload.codigoPais,
        fechaNacimiento: payload.fechaNacimiento,
        sexo: payload.sexo,
        tipoDocumento: payload.tipoDocumento,
        tipoPasajero: payload.tipoPasajero,
        codigoTarifa: args.codigoTarifa,
        bonificacion: payload.bonificacion,
        mail: payload.mail,
        telefono: payload.telefono,
        observaciones: "",
        sentidoSalida: 1,
        passengersData,
        animalsCount,
        vehicle: payload.vehicle,
        vehicleCategory: payload.vehicleCategory || undefined,
        vehicleData: vehicleData
          ? {
              marque: vehicleData.marque,
              modele: vehicleData.modele,
              immatriculation: vehicleData.immatriculation,
            }
          : undefined,
        vehicleAssignments,
      })) as ReservationResponse;
    }

    const outboundResult = await bookOneLeg({
      origen: payload.origen,
      destino: payload.destino,
      fechaSalida: payload.fechaSalida,
      horaSalida: payload.horaSalida,
      codigoServicioVenta: payload.codigoServicioVenta,
      tipoServicioVenta: payload.tipoServicioVenta,
      codigoTarifa: payload.codigoTarifa,
    });

    const outboundCode = normalizeString(outboundResult?.return?.codigo);
    const outboundText = normalizeString(outboundResult?.return?.texto);

    if (!isBusinessSuccess(outboundCode)) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Paiement validé, mais succès métier de réservation aller non confirmé.",
          businessCode: outboundCode || null,
          businessText: outboundText || null,
          draftId,
          data: outboundResult,
        },
        { status: 409 }
      );
    }

    const outboundReservation = getFirstReservation(outboundResult);
    const codigoLocata = normalizeString(
      outboundReservation?.locataEntidad?.codigoLocata
    );

    if (!codigoLocata) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Réservation aller répondue, mais la référence est introuvable.",
          businessCode: outboundCode || null,
          businessText: outboundText || null,
          draftId,
          data: outboundResult,
        },
        { status: 502 }
      );
    }

    let inboundCodigoLocata = "";
    let inboundResult: ReservationResponse | null = null;

    if (
      payload.tripType === "round_trip" &&
      payload.inboundSelectedDeparture
    ) {
      const inb = payload.inboundSelectedDeparture;
      inboundResult = await bookOneLeg({
        origen: inb.origen,
        destino: inb.destino,
        fechaSalida: inb.fechaSalida,
        horaSalida: inb.horaSalida,
        codigoServicioVenta: inb.codigoServicioVenta,
        tipoServicioVenta: inb.tipoServicioVenta,
        codigoTarifa: normalizeString(payload.inboundCodigoTarifa),
      });

      const inbBiz = normalizeString(inboundResult?.return?.codigo);
      if (!isBusinessSuccess(inbBiz)) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Aller réservé, mais la réservation retour a échoué. Contactez l’agence avec la référence aller.",
            outboundCodigoLocata: codigoLocata,
            businessCode: inbBiz || null,
            businessText: normalizeString(inboundResult?.return?.texto) || null,
            draftId,
            data: inboundResult,
          },
          { status: 409 }
        );
      }

      const inbRes = getFirstReservation(inboundResult);
      inboundCodigoLocata = normalizeString(
        inbRes?.locataEntidad?.codigoLocata
      );

      if (!inboundCodigoLocata) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "Aller réservé, mais référence retour introuvable. Contactez l’agence.",
            outboundCodigoLocata: codigoLocata,
            draftId,
            data: inboundResult,
          },
          { status: 502 }
        );
      }
    }

    const total = String(
      payload.total ||
        outboundReservation?.precioEntidad?.total ||
        ""
    );
    const fechaValidezReserva = normalizeString(
      outboundReservation?.fechaValidezReserva
    );

    const updatedDraft = await markBookingDraftReserved(draftId, {
      codigoLocata,
      inboundCodigoLocata: inboundCodigoLocata || undefined,
      total,
      fechaValidezReserva,
      businessCode: outboundCode,
    });

    let emailSent = false;
    let emailError: string | null = null;

    try {
      const travelersForEmail =
        payload.passengersData && payload.passengersData.length > 0
          ? payload.passengersData
          : [
              {
                nombre: payload.nombre,
                apellido1: payload.apellido1,
                apellido2: payload.apellido2 || "",
                fechaNacimiento: payload.fechaNacimiento,
                codigoPais: payload.codigoPais,
                sexo: payload.sexo,
                tipoDocumento: payload.tipoDocumento,
                codigoDocumento: payload.codigoDocumento,
              },
            ];

      const inboundLeg =
        inboundCodigoLocata && payload.inboundSelectedDeparture
          ? {
              codigoLocata: inboundCodigoLocata,
              origen: payload.inboundSelectedDeparture.origen,
              destino: payload.inboundSelectedDeparture.destino,
              fechaSalida: payload.inboundSelectedDeparture.fechaSalida,
              horaSalida: payload.inboundSelectedDeparture.horaSalida,
            }
          : undefined;

      await sendBookingConfirmationEmail({
        to: payload.mail,
        codigoLocata,
        total,
        origen: payload.origen,
        destino: payload.destino,
        fechaSalida: payload.fechaSalida,
        horaSalida: payload.horaSalida,
        travelers: travelersForEmail,
        inboundLeg,
      });

      await sendBookingConfirmationEmail({
        to: "reservations@solairvoyages.com",
        codigoLocata,
        total,
        origen: payload.origen,
        destino: payload.destino,
        fechaSalida: payload.fechaSalida,
        horaSalida: payload.horaSalida,
        travelers: travelersForEmail,
        inboundLeg,
      });

      emailSent = true;
    } catch (err) {
      emailError =
        err instanceof Error ? err.message : "Erreur inconnue d’envoi email.";
    }

    return NextResponse.json({
      ok: true,
      message: "Réservation créée après paiement.",
      draftId,
      businessCode: outboundCode,
      businessText: outboundText || null,
      reservation: updatedDraft?.reservation || {
        codigoLocata,
        inboundCodigoLocata: inboundCodigoLocata || undefined,
        total,
        fechaValidezReserva,
        businessCode: outboundCode,
      },
      emailSent,
      emailError,
      data: { outbound: outboundResult, inbound: inboundResult },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Erreur inconnue";

    return NextResponse.json(
      {
        ok: false,
        message: "Échec de création de réservation après paiement.",
        error: message,
      },
      { status: 500 }
    );
  }
}