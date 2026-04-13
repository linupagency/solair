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
  rawTrailerLength?: boolean;
  pricingSoapTrace?: boolean;
  pricingTrace?: boolean;
};
