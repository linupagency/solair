import fs from "fs";
import https from "https";
import soap from "soap";
import { armasConfig } from "@/lib/armas/config";
import type { ArmasContext } from "@/types/armas";

export function buildArmasContext(): ArmasContext {
  return {
    codigoAgencia: armasConfig.agencyCode,
    codigoIdioma: armasConfig.language,
    codigoUsuario: armasConfig.userCode,
    versionXml: armasConfig.xmlVersion,
  };
}

function buildHttpsAgent() {
  if (!armasConfig.certPath) {
    return undefined;
  }

  const pfxBuffer = fs.readFileSync(armasConfig.certPath);

  return new https.Agent({
    pfx: pfxBuffer,
    passphrase: armasConfig.certPassphrase || undefined,
    rejectUnauthorized: true,
  });
}

export async function createArmasSoapClient() {
  const httpsAgent = buildHttpsAgent();

  const client = await soap.createClientAsync(armasConfig.wsdlUrl, {
    endpoint: armasConfig.endpoint || undefined,
    wsdl_options: httpsAgent ? { httpsAgent } : undefined,
  });

  if (armasConfig.certPath) {
    client.setSecurity(
      new soap.ClientSSLSecurityPFX(
        fs.readFileSync(armasConfig.certPath),
        armasConfig.certPassphrase || ""
      )
    );
  }

  return client;
}

export async function nasaPuertosRequest() {
  const client = await createArmasSoapClient();

  const args = {
    contextoEntidad: buildArmasContext(),
  };

  const [result] = await client.nasaPuertosAsync(args);
  return result;
}