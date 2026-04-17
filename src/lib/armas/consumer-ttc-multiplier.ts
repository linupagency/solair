/**
 * Alignement strict sur les montants fournis par Armas.
 *
 * Les fichiers techniques fournis par Armas (`WSDL` + document d'interface) sont
 * la source de vérité pour le tunnel Solair. Toute surcouche de conversion
 * implicite sur les montants SOAP rend l'affichage ambigu, en particulier sur les
 * forfaits aller-retour.
 *
 * Ce module conserve donc une API stable, mais n'applique plus aucune majoration :
 * les montants consommés par l'application sont ceux lus dans la réponse Armas,
 * arrondis à 2 décimales uniquement pour stabiliser les calculs UI.
 */

export function getConsumerTtcMultiplier(): number {
  return 1;
}

export function roundMoneyEuros(value: number): number {
  return Math.round(value * 100) / 100;
}

export function applyConsumerTtcToEuros(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return value;
  return roundMoneyEuros(value);
}
