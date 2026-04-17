/**
 * Vérification hors-ligne des sommes `nasaTarificaciones` (fixtures + cas synthétique).
 * Exécution : `node --experimental-strip-types scripts/verify-rt-pricing.mts`
 * (ou `npm run verify:rt-pricing`).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveArmasRoundTripPriceBreakdown,
  resolveArmasTarificacionLegMode,
  sumPrecioTotalFromNasaTarificacionesResult,
} from "../src/lib/armas/tarificacion-normalize.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const carPath = join(__dirname, "../runs/s1-car-result.json");
  const raw = JSON.parse(readFileSync(carPath, "utf8")) as {
    rawResult?: unknown;
  };
  const soap = raw.rawResult;
  if (!soap) {
    console.error("Fixture s1-car-result.json : rawResult manquant.");
    process.exit(1);
  }

  const combined = sumPrecioTotalFromNasaTarificacionesResult(soap, "combined");
  const ida = sumPrecioTotalFromNasaTarificacionesResult(soap, "ida_leg");
  const vta = sumPrecioTotalFromNasaTarificacionesResult(soap, "vta_leg");

  console.log("Fixture s1-car-result (aller simple laboratoire) :");
  console.log("  combined:", combined, "ida_leg:", ida, "vta_leg:", vta);

  if (combined !== 201 || ida !== 201 || vta !== 201) {
    console.error("ÉCHEC : attendu 201 / 201 / 201 pour non-régression aller simple.");
    process.exit(1);
  }

  const synthetic = {
    return: {
      tarificacionesEntidad: {
        tarificacionEntidad: [
          {
            precioIdaEntidad: { total: 10 },
            precioVtaEntidad: { total: 25 },
          },
          {
            precioIdaEntidad: { total: 5 },
            precioVtaEntidad: { total: 7 },
          },
        ],
      },
    },
  };

  const sCombined = sumPrecioTotalFromNasaTarificacionesResult(
    synthetic,
    "combined"
  );
  const sIda = sumPrecioTotalFromNasaTarificacionesResult(synthetic, "ida_leg");
  const sVta = sumPrecioTotalFromNasaTarificacionesResult(synthetic, "vta_leg");

  console.log("\nCas synthétique (2 lignes, ida+vta sans precioEntidad) :");
  console.log("  combined (ida+vta par ligne):", sCombined);
  console.log("  ida_leg (somme ida):", sIda);
  console.log("  vta_leg (somme vta):", sVta);

  if (sCombined !== 47 || sIda !== 15 || sVta !== 32) {
    console.error("ÉCHEC : attendu combined=47, ida=15, vta=32.");
    process.exit(1);
  }

  const legOut = resolveArmasTarificacionLegMode("round_trip", "outbound");
  const legIn = resolveArmasTarificacionLegMode("round_trip", "inbound");
  const legOw = resolveArmasTarificacionLegMode("one_way", undefined);
  if (legOut !== "ida_leg" || legIn !== "vta_leg" || legOw !== "combined") {
    console.error("ÉCHEC resolveArmasTarificacionLegMode.");
    process.exit(1);
  }

  const forfaitOnly = {
    return: {
      tarificacionesEntidad: {
        tarificacionEntidad: [{ precioEntidad: { total: 175 } }],
      },
    },
  };
  const br = resolveArmasRoundTripPriceBreakdown(forfaitOnly);
  console.log("\nForfait precioEntidad seul (pas d’ida/vta additifs) :", br);
  if (
    br.bundleTotalEuros !== 175 ||
    br.segmentVentilationReliable !== false ||
    br.idaSubtotalEuros !== 175 ||
    br.vtaSubtotalEuros !== 175
  ) {
    console.error(
      "ÉCHEC : forfait unique doit donner bundle=175, ida/vta reliquats 175 chacun, ventilation non fiable."
    );
    process.exit(1);
  }

  console.log("\nTous les tests hors-ligne OK.");
}

main();
