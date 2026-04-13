export type ArmasContext = {
    codigoAgencia: string;
    codigoIdioma: string;
    codigoUsuario: string;
    versionXml: string;
  };
  
  export type ArmasPort = {
    codigoPuerto?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
  
  export type ArmasRoute = {
    flagcompuesto?: boolean | string | number;
    puertoOrigenEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
    puertoDestinoEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
  };
  
  export type ArmasDeparture = {
    codigoBarco?: string;
    codigoNaviera?: string;
    estadoSalida?: string;
    fechaLlegada?: string;
    fechaSalida?: string;
    horaLlegada?: string;
    horaSalida?: string;
    muelleLlegada?: string;
    muelleSalida?: string;
    tipoBarco?: string;
    tipoSalida?: string;
    flagcompuesto?: boolean | string | number;
    puertoOrigenEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
    puertoDestinoEntidad?: {
      codigoPuerto?: string;
      textoCorto?: string;
      textoLargo?: string;
    };
    servicioVentaEntidad?: unknown;
  };
  
  export type ArmasPriceLine = {
    codigoBonificacion?: string;
    textoCorto?: string;
    textoLargo?: string;
    total?: number | string;
    codigoTarifa?: string;
  };
  
  export type ArmasPassengerType = {
    textoCorto?: string;
    textoLargo?: string;
    tipoPasajero?: string;
    flagNacionalidad?: boolean | string | number;
    flagFechaNacimiento?: boolean | string | number;
    rellenaDatos?: boolean | string | number;
    rangoFechaNacimiento?: string | number;
  };
  
  export type ArmasDiscount = {
    codigoBonificacion?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
  
  export type ArmasDocumentType = {
    tipoDocumento?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
  
  export type ArmasRateType = {
    codigoTarifa?: string;
    textoCorto?: string;
    textoLargo?: string;
  };
  
  export type ArmasBookingResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
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
            precioIdaEntidad?: {
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
            precioIdaEntidad?: {
              total?: number | string;
            };
          }>;
    };
  };
  
  export type ArmasPortsResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    puertosEntidad?: {
      puertoEntidad?: ArmasPort[] | ArmasPort;
    };
  };
  
  export type ArmasRoutesResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    trayectosEntidad?: {
      trayectoEntidad?: ArmasRoute[] | ArmasRoute;
    };
  };
  
  export type ArmasDeparturesResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    salidasEntidad?: {
      salidaEntidad?: ArmasDeparture[] | ArmasDeparture;
    };
  };
  
  export type ArmasPricingResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    tarifasEntidad?: {
      tarifaEntidad?: ArmasPriceLine[] | ArmasPriceLine;
    };
  };
  
  export type ArmasPassengerTypesResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    tiposPasajerosEntidad?: {
      tipoPasajeroEntidad?: ArmasPassengerType[] | ArmasPassengerType;
    };
  };
  
  export type ArmasDiscountsResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    bonificacionesEntidad?: {
      bonificacionEntidad?: ArmasDiscount[] | ArmasDiscount;
    };
  };
  
  export type ArmasDocumentTypesResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    tiposDocumentosEntidad?: {
      tipoDocumentoEntidad?: ArmasDocumentType[] | ArmasDocumentType;
    };
  };
  
  export type ArmasRateTypesResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    tarifasEntidad?: {
      tarifaEntidad?: ArmasRateType[] | ArmasRateType;
    };
  };