/** Corps JSON attendu par `/api/armas/test-pricing` (POST) — aligné WSDL `nasaTarificaciones`. */
export type TarificacionRequestBody = {
  origen: string;
  destino: string;
  fechaSalida: string;
  horaSalida: string;
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
  tipoPasajero: string;
  passengerTipos?: string[];
  bonificacion: string;
  sentidoSalida?: number;
  animalsCount?: number;
  vehicle?: string;
  vehicleCategory?: string;
  vehiclePassengerIndex?: number;
  vehicleData?: {
    marque?: string;
    modele?: string;
    immatriculation?: string;
    alto?: string | number;
    ancho?: string | number;
    largo?: string | number;
    tipoVehiculo?: string;
    tara?: string | number;
    seguro?: string;
  };
  companionServicioVenta?: {
    codigoServicioVenta: string;
    tipoServicioVenta: string;
    cantidad?: number;
  };
  /** Segment retour explicite pour une demande AR `nasaTarificaciones` en une seule requête. */
  returnSegment?: {
    origen: string;
    destino: string;
    fechaSalida: string;
    horaSalida: string;
    codigoServicioVenta: string;
    tipoServicioVenta: string;
    sentidoSalida?: number;
  };
  rawTrailerLength?: boolean;
  pricingSoapTrace?: boolean;
  pricingTrace?: boolean;
  /**
   * Métadonnée UI uniquement : ne part pas dans le SOAP `nasaTarificaciones`.
   * Sert aux logs serveur quand `SOLAIR_ARMAS_RT_PRICING_DEBUG=1`.
   */
  pricingRtDebug?: {
    requestId?: string;
    tripType?: "one_way" | "round_trip";
    armasLeg?: "outbound" | "inbound";
    selectedOutboundSegment?: {
      origen: string;
      destino: string;
      fechaSalida: string;
      horaSalida: string;
      barco?: string;
      serviceCode?: string;
      serviceType?: string;
      segmentKey?: string;
    };
    selectedInboundSegment?: {
      origen: string;
      destino: string;
      fechaSalida: string;
      horaSalida: string;
      barco?: string;
      serviceCode?: string;
      serviceType?: string;
      segmentKey?: string;
    };
  };
};
