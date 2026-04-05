export const armasConfig = {
    wsdlUrl: process.env.ARMAS_WSDL_URL || "",
    endpoint: process.env.ARMAS_ENDPOINT || "",
    agencyCode: process.env.ARMAS_AGENCY_CODE || "",
    userCode: process.env.ARMAS_USER_CODE || "",
    xmlVersion: process.env.ARMAS_XML_VERSION || "",
    language: process.env.ARMAS_LANGUAGE || "FR",
    certPath: process.env.ARMAS_CERT_PATH || "",
    certPassphrase: process.env.ARMAS_CERT_PASSPHRASE || "",
  };
  
  export function validateArmasBasicConfig() {
    const missing: string[] = [];
  
    if (!armasConfig.wsdlUrl) missing.push("ARMAS_WSDL_URL");
    if (!armasConfig.agencyCode) missing.push("ARMAS_AGENCY_CODE");
    if (!armasConfig.userCode) missing.push("ARMAS_USER_CODE");
    if (!armasConfig.xmlVersion) missing.push("ARMAS_XML_VERSION");
    if (!armasConfig.certPath) missing.push("ARMAS_CERT_PATH");
  
    return {
      isValid: missing.length === 0,
      missing,
    };
  }