export function padHour(value: string | number | null | undefined) {
    return String(value ?? "").padStart(4, "0");
  }
  
  export function makeSegmentKey(s: any) {
    return [
      String(s?.sentidoSalida ?? ""),
      String(s?.fechaSalida ?? ""),
      padHour(s?.horaSalida),
      String(s?.fechaLlegada ?? ""),
      padHour(s?.horaLlegada),
      String(s?.trayectoEntidad?.puertoOrigenEntidad?.codigoPuerto ?? ""),
      String(s?.trayectoEntidad?.puertoDestinoEntidad?.codigoPuerto ?? ""),
      String(s?.barcoEntidad?.codigoBarco ?? ""),
    ].join("|");
  }
  
  export function debugSegment(label: string, s: any) {
    console.log(label, {
      key: makeSegmentKey(s),
      sentidoSalida: s?.sentidoSalida ?? null,
      fechaSalida: s?.fechaSalida ?? null,
      horaSalida: padHour(s?.horaSalida),
      fechaLlegada: s?.fechaLlegada ?? null,
      horaLlegada: padHour(s?.horaLlegada),
      origen: s?.trayectoEntidad?.puertoOrigenEntidad?.codigoPuerto ?? null,
      destino: s?.trayectoEntidad?.puertoDestinoEntidad?.codigoPuerto ?? null,
      barco: s?.barcoEntidad?.codigoBarco ?? null,
    });
  }