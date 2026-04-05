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
  
  export type ArmasPortsResponse = {
    codigo?: string;
    texto?: string;
    versionXml?: string;
    puertosEntidad?: {
      puertoEntidad?: ArmasPort[] | ArmasPort;
    };
  };