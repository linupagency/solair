export type TarificacionServiceLine = {
  cantidad: number;
  codigoServicioVenta: string;
  tipoServicioVenta: string;
};

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
  /**
   * Lignes `servicioVentaEntidad` explicites pour la salida aller.
   * Permet de reproduire un panier mixte (ex. 3 x BY + 1 x BP + XR).
   */
  serviceLines?: TarificacionServiceLine[];
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
  /** Lignes `servicioVentaEntidad` explicites pour la salida retour, si `returnSegment` est utilisé. */
  returnServiceLines?: TarificacionServiceLine[];
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
