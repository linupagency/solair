import fs from "fs";
import path from "path";

function normalize(v: string | undefined): string {
  return (v || "").trim();
}

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

function resolveLocalPath(v: string): string {
  if (!v) return "";
  if (path.isAbsolute(v)) return v;
  return path.resolve(process.cwd(), v);
}

function resolveWsdlLocation(raw: string): string {
  if (!raw) return "";
  if (isHttpUrl(raw)) return raw;
  return resolveLocalPath(raw);
}

function resolveCertPath(raw: string): string {
  if (!raw) return "";
  return resolveLocalPath(raw);
}

export const armasConfig = {
  wsdlUrl: normalize(process.env.ARMAS_WSDL_URL),
  endpoint: normalize(process.env.ARMAS_ENDPOINT),
  agencyCode: normalize(process.env.ARMAS_AGENCY_CODE),
  userCode: normalize(process.env.ARMAS_USER_CODE),
  xmlVersion: normalize(process.env.ARMAS_XML_VERSION),
  language: normalize(process.env.ARMAS_LANGUAGE) || "FR",
  certPath: normalize(process.env.ARMAS_CERT_PATH),
  certBase64: normalize(process.env.ARMAS_CERT_BASE64),
  certPassphrase: normalize(process.env.ARMAS_CERT_PASSPHRASE),
};

export function getResolvedArmasWsdlUrl(): string {
  return resolveWsdlLocation(armasConfig.wsdlUrl);
}

export function getResolvedArmasCertPath(): string {
  return resolveCertPath(armasConfig.certPath);
}

let cachedArmasCertBuffer: Buffer | null = null;

export function getArmasCertBuffer(): Buffer | undefined {
  if (cachedArmasCertBuffer) return cachedArmasCertBuffer;

  if (armasConfig.certBase64) {
    cachedArmasCertBuffer = Buffer.from(
      armasConfig.certBase64.replace(/\s+/g, ""),
      "base64"
    );
    return cachedArmasCertBuffer;
  }

  const certPath = getResolvedArmasCertPath();
  if (!certPath) return undefined;
  cachedArmasCertBuffer = fs.readFileSync(certPath);
  return cachedArmasCertBuffer;
}

export function validateArmasBasicConfig() {
  const missing: string[] = [];

  if (!getResolvedArmasWsdlUrl()) missing.push("ARMAS_WSDL_URL");
  if (!armasConfig.agencyCode) missing.push("ARMAS_AGENCY_CODE");
  if (!armasConfig.userCode) missing.push("ARMAS_USER_CODE");
  if (!armasConfig.xmlVersion) missing.push("ARMAS_XML_VERSION");
  if (!armasConfig.certBase64 && !getResolvedArmasCertPath()) {
    missing.push("ARMAS_CERT_BASE64 (ou ARMAS_CERT_PATH)");
  }

  return {
    isValid: missing.length === 0,
    missing,
  };
}