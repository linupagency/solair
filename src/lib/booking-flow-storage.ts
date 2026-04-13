import {
  cloneBookingFlow,
  createEmptyBookingFlow,
  type BookingFlow,
  type BookingJourneySegment,
  type BookingSalidaServiceOffer,
  type BookingSelectedDeparture,
} from "@/lib/booking-flow";
  
  const BOOKING_FLOW_STORAGE_KEY = "solair-booking-flow";
  
  function canUseStorage() {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  }
  
  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  
  function normalizeString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
  }
  
  function normalizeNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim().replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
  }
  
  function normalizeSelectedDeparture(
    value: unknown
  ): BookingSelectedDeparture | undefined {
    if (!isObject(value)) return undefined;
    const d = value;
    const base = {
      origen: normalizeString(d.origen),
      destino: normalizeString(d.destino),
      fechaSalida: normalizeString(d.fechaSalida),
      horaSalida: normalizeString(d.horaSalida),
      codigoServicioVenta: normalizeString(d.codigoServicioVenta),
      tipoServicioVenta: normalizeString(d.tipoServicioVenta),
      barco: normalizeString(d.barco),
      transportPrice: normalizeString(d.transportPrice),
      pricingRaw: d.pricingRaw,
    };
    if (
      !base.origen ||
      !base.destino ||
      !base.fechaSalida ||
      !base.horaSalida ||
      !base.codigoServicioVenta ||
      !base.tipoServicioVenta
    ) {
      return undefined;
    }
    return base;
  }

  function normalizeSalidaServices(
    value: unknown
  ): BookingSalidaServiceOffer[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const list = value
      .filter(isObject)
      .map((s) => ({
        codigoServicioVenta: normalizeString(s.codigoServicioVenta),
        tipoServicioVenta: normalizeString(s.tipoServicioVenta),
        textoCorto: normalizeString(s.textoCorto),
        textoLargo: normalizeString(s.textoLargo),
      }))
      .filter((s) => s.codigoServicioVenta && s.tipoServicioVenta);
    return list.length ? list : undefined;
  }

  function normalizeJourneySegment(value: unknown): BookingJourneySegment {
    if (!isObject(value)) return {};
    const acc = isObject(value.accommodation) ? value.accommodation : undefined;
    const accommodation =
      acc &&
      normalizeString(acc.code) &&
      normalizeString(acc.label)
        ? {
            code: normalizeString(acc.code),
            label: normalizeString(acc.label),
            price: normalizeString(acc.price, "0"),
            details: normalizeString(acc.details),
            codigoServicioVenta: normalizeString(acc.codigoServicioVenta),
            tipoServicioVenta: normalizeString(acc.tipoServicioVenta),
            ...(typeof acc.isBaseIncluded === "boolean"
              ? { isBaseIncluded: acc.isBaseIncluded }
              : {}),
          }
        : undefined;

    const tbs = isObject(value.transportBaseService)
      ? value.transportBaseService
      : undefined;
    const transportBaseService =
      tbs &&
      normalizeString(tbs.codigoServicioVenta) &&
      normalizeString(tbs.tipoServicioVenta)
        ? {
            codigoServicioVenta: normalizeString(tbs.codigoServicioVenta),
            tipoServicioVenta: normalizeString(tbs.tipoServicioVenta),
          }
        : undefined;

    const tvs = isObject(value.transportVehicleService)
      ? value.transportVehicleService
      : undefined;
    const transportVehicleService =
      tvs &&
      normalizeString(tvs.codigoServicioVenta) &&
      normalizeString(tvs.tipoServicioVenta)
        ? {
            codigoServicioVenta: normalizeString(tvs.codigoServicioVenta),
            tipoServicioVenta: normalizeString(tvs.tipoServicioVenta),
          }
        : undefined;

    return {
      selectedDeparture: normalizeSelectedDeparture(value.selectedDeparture),
      transportBaseService,
      transportVehicleService,
      accommodation,
      availableServices: normalizeSalidaServices(value.availableServices),
    };
  }

  function normalizeBookingFlow(raw: unknown): BookingFlow {
    const empty = createEmptyBookingFlow();
  
    if (!isObject(raw)) {
      return empty;
    }
  
    const search = isObject(raw.search) ? raw.search : {};
    const passengers = isObject(search.passengers) ? search.passengers : {};
    const animals = isObject(search.animals) ? search.animals : {};
    const contact = isObject(raw.contact) ? raw.contact : {};
    const totals = isObject(raw.totals) ? raw.totals : {};
    const outboundRaw = isObject(raw.outbound) ? raw.outbound : {};
    const inboundRaw = raw.inbound;
  
    const vehicles = Array.isArray(search.vehicles)
      ? search.vehicles
          .filter(isObject)
          .map((vehicle) => {
            let category = normalizeString(vehicle.category);
            if (category === "moto") {
              const lab = normalizeString(vehicle.label).toLowerCase();
              if (
                lab.includes("bicy") ||
                lab.includes("vélo") ||
                lab.includes("velo")
              ) {
                category = "bike";
              }
            }
            return {
            category,
            quantity: normalizeNumber(vehicle.quantity, 0),
            label: normalizeString(vehicle.label),
            driverPassengerIndex:
              typeof vehicle.driverPassengerIndex === "number"
                ? vehicle.driverPassengerIndex
                : undefined,
            marque: normalizeString(vehicle.marque),
            modele: normalizeString(vehicle.modele),
            immatriculation: normalizeString(vehicle.immatriculation),
            dimensions: isObject(vehicle.dimensions)
              ? {
                  alto:
                    typeof vehicle.dimensions.alto === "number"
                      ? vehicle.dimensions.alto
                      : undefined,
                  ancho:
                    typeof vehicle.dimensions.ancho === "number"
                      ? vehicle.dimensions.ancho
                      : undefined,
                  largo:
                    typeof vehicle.dimensions.largo === "number"
                      ? vehicle.dimensions.largo
                      : undefined,
                }
              : undefined,
            tipoVehiculo: (() => {
              const s = normalizeString(vehicle.tipoVehiculo);
              return s || undefined;
            })(),
            taraKg:
              typeof vehicle.taraKg === "number" && Number.isFinite(vehicle.taraKg)
                ? Math.floor(vehicle.taraKg)
                : undefined,
            seguro: (() => {
              const s = normalizeString(vehicle.seguro);
              return s || undefined;
            })(),
            rawTrailerLength:
              vehicle.rawTrailerLength === true ||
              vehicle.rawTrailerLength === false
                ? vehicle.rawTrailerLength
                : undefined,
          };
          })
      : [];
  
    const travelers = Array.isArray(raw.travelers)
      ? raw.travelers
          .filter(isObject)
          .map((traveler) => ({
            nombre: normalizeString(traveler.nombre),
            apellido1: normalizeString(traveler.apellido1),
            apellido2: normalizeString(traveler.apellido2),
            fechaNacimiento: normalizeString(traveler.fechaNacimiento),
            codigoPais: normalizeString(traveler.codigoPais, "FR"),
            sexo: normalizeString(traveler.sexo, "H"),
            tipoDocumento: normalizeString(traveler.tipoDocumento, "P"),
            codigoDocumento: normalizeString(traveler.codigoDocumento),
            tipoPasajero: normalizeString(traveler.tipoPasajero),
          }))
      : [];
  
    return {
      tripType:
        raw.tripType === "round_trip" || raw.tripType === "one_way"
          ? raw.tripType
          : empty.tripType,
  
      search: {
        origen: normalizeString(search.origen),
        destino: normalizeString(search.destino),
        fechaIda: normalizeString(search.fechaIda),
        fechaVuelta: normalizeString(search.fechaVuelta),
        bonificacion: normalizeString(search.bonificacion, "G"),
        passengers: {
          adults: normalizeNumber(passengers.adults, 1),
          youth: normalizeNumber(passengers.youth, 0),
          seniors: normalizeNumber(passengers.seniors, 0),
          children: normalizeNumber(passengers.children, 0),
          babies: normalizeNumber(passengers.babies, 0),
        },
        animals: {
          enabled: Boolean(animals.enabled),
          count: normalizeNumber(animals.count, 0),
        },
        vehicles,
      },
  
      outbound: normalizeJourneySegment(outboundRaw),
      inbound:
        raw.tripType === "round_trip" && isObject(inboundRaw)
          ? normalizeJourneySegment(inboundRaw)
          : undefined,
  
      travelers,
  
      contact: {
        mail: normalizeString(contact.mail),
        telefono: normalizeString(contact.telefono),
      },
  
      totals: {
        transportOutbound: normalizeString(totals.transportOutbound),
        transportInbound: normalizeString(totals.transportInbound),
        accommodationOutbound: normalizeString(totals.accommodationOutbound),
        accommodationInbound: normalizeString(totals.accommodationInbound),
        finalTotal: normalizeString(totals.finalTotal),
      },
    };
  }
  
  export function getBookingFlow(): BookingFlow {
    if (!canUseStorage()) {
      return createEmptyBookingFlow();
    }
  
    const raw = window.localStorage.getItem(BOOKING_FLOW_STORAGE_KEY);
  
    if (!raw) {
      return createEmptyBookingFlow();
    }
  
    try {
      return normalizeBookingFlow(JSON.parse(raw));
    } catch {
      return createEmptyBookingFlow();
    }
  }
  
  export function setBookingFlow(flow: BookingFlow): BookingFlow {
    const normalized = normalizeBookingFlow(flow);
  
    if (canUseStorage()) {
      window.localStorage.setItem(
        BOOKING_FLOW_STORAGE_KEY,
        JSON.stringify(normalized)
      );
    }
  
    return normalized;
  }
  
  export function clearBookingFlow() {
    if (canUseStorage()) {
      window.localStorage.removeItem(BOOKING_FLOW_STORAGE_KEY);
    }
  }
  
  export function updateBookingFlow(
    updater:
      | Partial<BookingFlow>
      | ((current: BookingFlow) => BookingFlow)
  ): BookingFlow {
    const current = getBookingFlow();
  
    const next =
      typeof updater === "function"
        ? updater(cloneBookingFlow(current))
        : ({
            ...current,
            ...updater,
          } as BookingFlow);
  
    return setBookingFlow(next);
  }