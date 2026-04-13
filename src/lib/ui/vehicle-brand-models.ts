export const OTHER_OPTION_VALUE = "__OTHER__";

export const VEHICLE_BRAND_MODELS: Record<string, readonly string[]> = {
  AUDI: ["A1", "A3", "A4", "A6", "Q2", "Q3", "Q5"],
  BMW: ["SERIE 1", "SERIE 3", "SERIE 5", "X1", "X3", "X5"],
  CITROEN: ["C1", "C3", "C4", "BERLINGO", "C5 AIRCROSS"],
  DACIA: ["SANDERO", "DUSTER", "JOGGER"],
  FIAT: ["500", "PANDA", "TIPO", "DOBLO"],
  FORD: ["FIESTA", "FOCUS", "PUMA", "KUGA"],
  HONDA: ["CIVIC", "JAZZ", "CR-V", "HR-V"],
  HYUNDAI: ["I10", "I20", "I30", "TUCSON", "KONA"],
  KIA: ["PICANTO", "RIO", "CEED", "SPORTAGE", "NIRO"],
  MERCEDES: ["CLASSE A", "CLASSE C", "GLA", "GLC"],
  NISSAN: ["MICRA", "JUKE", "QASHQAI", "X-TRAIL"],
  OPEL: ["CORSA", "ASTRA", "MOKKA", "CROSSLAND"],
  PEUGEOT: ["208", "308", "2008", "3008", "5008"],
  RENAULT: ["CLIO", "CAPTUR", "MEGANE", "ARKANA", "SCENIC"],
  SEAT: ["IBIZA", "LEON", "ARONA", "ATECA"],
  SKODA: ["FABIA", "SCALA", "OCTAVIA", "KAMIQ", "KODIAQ"],
  TOYOTA: ["YARIS", "COROLLA", "C-HR", "RAV4"],
  VOLKSWAGEN: ["POLO", "GOLF", "T-ROC", "TIGUAN", "PASSAT"],
  VOLVO: ["V40", "XC40", "XC60", "XC90"],
};

export const VEHICLE_BRAND_OPTIONS: readonly string[] = [
  ...Object.keys(VEHICLE_BRAND_MODELS).sort(),
  OTHER_OPTION_VALUE,
];
