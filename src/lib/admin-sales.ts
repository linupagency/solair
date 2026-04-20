import type {
  BookingDraftPayload,
  BookingDraftReservation,
  BookingDraftTraveler,
  BookingDraftVehicleLine,
} from "@/lib/booking-draft-store";
import {
  getSupabaseAdmin,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

type BookingDraftRow = {
  id: string;
  status: "draft" | "reserved";
  payload: BookingDraftPayload;
  reservation: BookingDraftReservation | null;
  created_at: string;
  updated_at: string;
};

export type AdminSale = {
  id: string;
  status: "draft" | "reserved";
  createdAt: string;
  updatedAt: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  codigoLocata: string;
  inboundCodigoLocata: string;
  totalAmount: number | null;
  totalDisplay: string;
  businessCode: string;
  paymentStatus: string;
  paypalOrderId: string;
  paypalCaptureId: string;
  paypalAmount: string;
  paypalCurrency: string;
  paypalOrderStatus: string;
  paypalCaptureStatus: string;
  paymentUpdatedAt: string;
  paymentCapturedAt: string;
  paymentLastError: string;
  emailStatus: string;
  emailSentAt: string;
  emailError: string;
  tripType: "one_way" | "round_trip";
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  fechaVuelta: string;
  animalsCount: number;
  passengersCount: number;
  vehiclesCount: number;
  travelers: BookingDraftTraveler[];
  vehicles: BookingDraftVehicleLine[];
  payload: BookingDraftPayload;
  reservation: BookingDraftReservation | null;
};

export type AdminSalesStats = {
  totalReservedSales: number;
  totalDraftSales: number;
  totalCapturedPendingReservation: number;
  totalFailedPayments: number;
  revenueToday: number;
  revenueMonth: number;
  averageBasket: number;
  topRoutes: Array<{
    route: string;
    count: number;
    revenue: number;
  }>;
};

export type AdminSalesResult = {
  sales: AdminSale[];
  stats: AdminSalesStats;
  configError?: string;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseAmount(value?: string | number | null) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (!value) return null;
  const parsed = Number(String(value).replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildTravelers(payload: BookingDraftPayload): BookingDraftTraveler[] {
  if (payload.passengersData && payload.passengersData.length > 0) {
    return payload.passengersData;
  }

  return [
    {
      nombre: payload.nombre,
      apellido1: payload.apellido1,
      apellido2: payload.apellido2 || "",
      fechaNacimiento: payload.fechaNacimiento,
      codigoPais: payload.codigoPais,
      sexo: payload.sexo,
      tipoDocumento: payload.tipoDocumento,
      codigoDocumento: payload.codigoDocumento,
      tipoPasajero: payload.tipoPasajero,
    },
  ].filter((traveler) => normalizeString(traveler.nombre) || normalizeString(traveler.apellido1));
}

function buildVehicles(payload: BookingDraftPayload): BookingDraftVehicleLine[] {
  if (payload.vehiclesList && payload.vehiclesList.length > 0) {
    return payload.vehiclesList;
  }

  if (payload.vehicleData && payload.vehicleCategory) {
    return [
      {
        vehicle: payload.vehicle || payload.vehicleCategory,
        vehicleCategory: payload.vehicleCategory,
        vehicleData: payload.vehicleData,
      },
    ];
  }

  return [];
}

function buildCustomerName(payload: BookingDraftPayload) {
  return [payload.nombre, payload.apellido1, payload.apellido2]
    .map(normalizeString)
    .filter(Boolean)
    .join(" ");
}

function mapRowToAdminSale(row: BookingDraftRow): AdminSale {
  const travelers = buildTravelers(row.payload);
  const vehicles = buildVehicles(row.payload);
  const totalAmount = parseAmount(row.reservation?.total || row.payload.total);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    customerName: buildCustomerName(row.payload) || "Client sans nom",
    customerEmail: normalizeString(row.payload.mail),
    customerPhone: normalizeString(row.payload.telefono),
    codigoLocata: normalizeString(row.reservation?.codigoLocata),
    inboundCodigoLocata: normalizeString(row.reservation?.inboundCodigoLocata),
    totalAmount,
    totalDisplay: normalizeString(row.reservation?.total || row.payload.total),
    businessCode: normalizeString(row.reservation?.businessCode),
    paymentStatus: normalizeString(row.reservation?.paymentStatus),
    paypalOrderId: normalizeString(row.reservation?.paypalOrderId),
    paypalCaptureId: normalizeString(row.reservation?.paypalCaptureId),
    paypalAmount: normalizeString(row.reservation?.paypalAmount),
    paypalCurrency: normalizeString(row.reservation?.paypalCurrency),
    paypalOrderStatus: normalizeString(row.reservation?.paypalOrderStatus),
    paypalCaptureStatus: normalizeString(row.reservation?.paypalCaptureStatus),
    paymentUpdatedAt: normalizeString(row.reservation?.paymentUpdatedAt),
    paymentCapturedAt: normalizeString(row.reservation?.paymentCapturedAt),
    paymentLastError: normalizeString(row.reservation?.paymentLastError),
    emailStatus: normalizeString(row.reservation?.emailStatus),
    emailSentAt: normalizeString(row.reservation?.emailSentAt),
    emailError: normalizeString(row.reservation?.emailError),
    tripType:
      row.payload.tripType === "round_trip" || normalizeString(row.payload.fechaVuelta)
        ? "round_trip"
        : "one_way",
    origen: normalizeString(row.payload.origen),
    destino: normalizeString(row.payload.destino),
    fechaSalida: normalizeString(row.payload.fechaSalida),
    horaSalida: normalizeString(row.payload.horaSalida),
    fechaVuelta: normalizeString(row.payload.fechaVuelta),
    animalsCount: Number(row.payload.animalsCount || "0") || 0,
    passengersCount: travelers.length,
    vehiclesCount: vehicles.length,
    travelers,
    vehicles,
    payload: row.payload,
    reservation: row.reservation,
  };
}

function matchesSearch(sale: AdminSale, search: string) {
  const q = search.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    sale.id,
    sale.customerName,
    sale.customerEmail,
    sale.customerPhone,
    sale.codigoLocata,
    sale.inboundCodigoLocata,
    sale.origen,
    sale.destino,
    sale.businessCode,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

function computeStats(sales: AdminSale[]): AdminSalesStats {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const month = now.getMonth();
  const year = now.getFullYear();

  let totalReservedSales = 0;
  let totalDraftSales = 0;
  let totalCapturedPendingReservation = 0;
  let totalFailedPayments = 0;
  let revenueToday = 0;
  let revenueMonth = 0;
  let reservedRevenue = 0;

  const routes = new Map<string, { count: number; revenue: number }>();

  for (const sale of sales) {
    const createdAt = new Date(sale.createdAt);
    const amount = sale.totalAmount || 0;
    const routeKey = `${sale.origen} -> ${sale.destino}`;

    if (
      sale.status === "draft" &&
      (sale.paymentStatus === "captured" ||
        sale.paymentStatus === "reservation_pending")
    ) {
      totalCapturedPendingReservation += 1;
    }

    if (sale.paymentStatus === "failed" || sale.paymentStatus === "denied") {
      totalFailedPayments += 1;
    }

    if (sale.status === "reserved") {
      totalReservedSales += 1;
      reservedRevenue += amount;

      if (createdAt.toISOString().slice(0, 10) === todayKey) {
        revenueToday += amount;
      }

      if (createdAt.getMonth() === month && createdAt.getFullYear() === year) {
        revenueMonth += amount;
      }

      const current = routes.get(routeKey) || { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += amount;
      routes.set(routeKey, current);
    } else {
      totalDraftSales += 1;
    }
  }

  return {
    totalReservedSales,
    totalDraftSales,
    totalCapturedPendingReservation,
    totalFailedPayments,
    revenueToday,
    revenueMonth,
    averageBasket: totalReservedSales > 0 ? reservedRevenue / totalReservedSales : 0,
    topRoutes: Array.from(routes.entries())
      .map(([route, value]) => ({
        route,
        count: value.count,
        revenue: value.revenue,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.revenue - a.revenue;
      })
      .slice(0, 5),
  };
}

export async function listAdminSales(search = ""): Promise<AdminSalesResult> {
  if (!isSupabaseAdminConfigured()) {
    return {
      sales: [],
      stats: computeStats([]),
      configError:
        "Supabase n'est pas configuré. Ajoutez NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY pour utiliser le backoffice.",
    };
  }

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .select("id, status, payload, reservation, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(error.message);
  }

  const sales = ((data || []) as BookingDraftRow[]).map(mapRowToAdminSale);
  const filteredSales = search.trim()
    ? sales.filter((sale) => matchesSearch(sale, search))
    : sales;

  return {
    sales: filteredSales,
    stats: computeStats(sales),
  };
}

export async function getAdminSaleById(id: string): Promise<AdminSale | null> {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }

  const { data, error } = await getSupabaseAdmin()
    .from("booking_drafts")
    .select("id, status, payload, reservation, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return mapRowToAdminSale(data as BookingDraftRow);
}
