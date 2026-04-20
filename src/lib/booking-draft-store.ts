import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type BookingDraftTraveler = {
  nombre: string;
  apellido1: string;
  apellido2?: string;
  fechaNacimiento: string;
  codigoPais: string;
  sexo: string;
  tipoDocumento: string;
  codigoDocumento: string;
  tipoPasajero: string;
};

export type BookingDraftVehicleData = {
  marque: string;
  modele: string;
  immatriculation: string;
  conducteurIndex: number;
};

export type BookingDraftVehicleLine = {
  vehicle: string;
  vehicleCategory: string;
  vehicleData: BookingDraftVehicleData;
};

export type BookingDraftSelectedDeparture = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  /** En aller-retour Armas, la traversée retour doit être `sentidoSalida=2`. */
  sentidoSalida?: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  barco?: string;
  transportPrice?: string;
};

export type BookingDraftAccommodation = {
  code: string;
  label: string;
  price: string;
  details?: string;
};

export type BookingDraftPayload = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  passengers: string;
  vehicle: string;

  nombre: string;
  apellido1: string;
  apellido2?: string;
  fechaNacimiento: string;
  codigoPais: string;
  sexo: string;
  codigoDocumento: string;
  tipoPasajero: string;
  bonificacion: string;
  tipoDocumento: string;

  mail: string;
  telefono: string;
  total: string;
  codigoTarifa: string;
  /** Tarif retour (aller-retour, second appel nasaReservas) */
  inboundCodigoTarifa?: string;

  passengersData?: BookingDraftTraveler[];

  vehicleCategory?: string;
  vehicleData?: BookingDraftVehicleData;
  /** Tous les véhicules du dossier (conducteur par passager) */
  vehiclesList?: BookingDraftVehicleLine[];

  hebergementType?: string;
  hebergementLabel?: string;
  hebergementPrice?: string;

  tripType?: "one_way" | "round_trip";
  fechaVuelta?: string;
  animalsCount?: string;

  inboundSelectedDeparture?: BookingDraftSelectedDeparture | null;
  inboundAccommodation?: BookingDraftAccommodation | null;
};

export type BookingDraftReservation = {
  codigoLocata: string;
  /** Second appel nasaReservas (aller-retour) */
  inboundCodigoLocata?: string;
  total: string;
  fechaValidezReserva?: string;
  businessCode?: string;
  paypalOrderId?: string;
  paypalOrderStatus?: string;
  paypalCaptureId?: string;
  paypalCaptureStatus?: string;
  paypalAmount?: string;
  paypalCurrency?: string;
  paymentStatus?:
    | "created"
    | "captured"
    | "reservation_pending"
    | "reserved"
    | "failed"
    | "denied"
    | "reversed"
    | "test_mode";
  paymentUpdatedAt?: string;
  paymentCapturedAt?: string;
  paymentLastError?: string;
  emailStatus?: "pending" | "sent" | "failed";
  emailSentAt?: string;
  emailError?: string;
};

export type BookingDraft = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "draft" | "reserved";
  payload: BookingDraftPayload;
  reservation?: BookingDraftReservation;
};

type BookingDraftRow = {
  id: string;
  status: "draft" | "reserved";
  payload: BookingDraftPayload;
  reservation: BookingDraftReservation | null;
  created_at: string;
  updated_at: string;
};

function mapRowToDraft(row: BookingDraftRow): BookingDraft {
  return {
    id: row.id,
    status: row.status,
    payload: row.payload,
    reservation: row.reservation || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createBookingDraft(payload: BookingDraftPayload) {
  const draftId = crypto.randomUUID();

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .insert({
      id: draftId,
      status: "draft",
      payload,
      reservation: null,
    })
    .select("id, status, payload, reservation, created_at, updated_at")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Impossible de créer le draft.");
  }

  return mapRowToDraft(data as BookingDraftRow);
}

export async function getBookingDraft(draftId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .select("id, status, payload, reservation, created_at, updated_at")
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapRowToDraft(data as BookingDraftRow);
}

export async function markBookingDraftReserved(
  draftId: string,
  reservation: BookingDraftReservation
) {
  const existingDraft = await getBookingDraft(draftId);
  const mergedReservation = {
    ...(existingDraft?.reservation || {}),
    ...reservation,
  };

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .update({
      status: "reserved",
      reservation: mergedReservation,
    })
    .eq("id", draftId)
    .select("id, status, payload, reservation, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapRowToDraft(data as BookingDraftRow);
}

export async function patchBookingDraftReservation(
  draftId: string,
  reservationPatch: Partial<BookingDraftReservation>
) {
  const existingDraft = await getBookingDraft(draftId);

  if (!existingDraft) {
    return null;
  }

  const nextReservation = {
    ...(existingDraft.reservation || {}),
    ...reservationPatch,
  };

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .update({
      reservation: nextReservation,
    })
    .eq("id", draftId)
    .select("id, status, payload, reservation, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapRowToDraft(data as BookingDraftRow);
}

export async function findBookingDraftByPayPalOrderId(orderId: string) {
  const normalizedOrderId = orderId.trim();

  if (!normalizedOrderId) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .select("id, status, payload, reservation, created_at, updated_at")
    .filter("reservation->>paypalOrderId", "eq", normalizedOrderId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapRowToDraft(data as BookingDraftRow);
}
