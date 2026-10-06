/**
 * Préférences locales du joueur (persistées sur le device).
 *
 * Toutes les clés portent le préfixe `toyah:`. Toutes les écritures sont
 * muettes en cas d'échec : en navigation privée, `localStorage` lève, et un
 * réglage perdu ne doit pas emporter l'écran avec lui. C'est l'écran de
 * vérification du téléphone qui prévient que la mémoire est fermée.
 */

const PREFIXE = "toyah:";

/** Réglages connus. Une clé de plus se déclare ici, pas en dur dans un écran. */
export type Pref =
  | "muted"
  /**
   * ACCEPTER QUE L'ORGANISATEUR TE SUIVE SUR SA CARTE — et rien d'autre.
   *
   * Ce consentement vivait sous la clé `geo`, et la même action y écrivait la
   * réponse à la fenêtre système du navigateur : répondre « Autoriser » au
   * téléphone pour que la boussole marche cochait le partage avec
   * l'organisateur sans qu'on ait posé la question. Deux questions, deux clés.
   *
   * Le nom change exprès : une valeur écrite sous l'ancienne clé est
   * ambiguë, et une permission de suivi ne s'hérite pas d'un doute.
   */
  | "partage"
  /** Réponse à la demande d'orientation (boussole), iPhone surtout. */
  | "orientation"
  /** Vérification du téléphone déjà passée (valeur : le code de la partie). */
  | "preflight";

export function getPref(cle: Pref): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PREFIXE + cle);
  } catch {
    return null;
  }
}

export function setPref(cle: Pref, valeur: string) {
  try {
    localStorage.setItem(PREFIXE + cle, valeur);
  } catch {
    /* mémoire fermée — le jeu continue, l'écran de vérification l'a dit */
  }
}

export function isMuted(): boolean {
  return getPref("muted") === "1";
}

export function setMuted(muted: boolean) {
  setPref("muted", muted ? "1" : "0");
}

export type GeoConsent = "granted" | "denied" | null;

export function getGeoConsent(): GeoConsent {
  const v = getPref("partage");
  return v === "granted" || v === "denied" ? v : null;
}

export function setGeoConsent(consent: Exclude<GeoConsent, null>) {
  setPref("partage", consent);
}

/** La vérification du téléphone ne se repose pas à chaque étape, ni à chaque partie. */
export function preflightFait(codePartie: string): boolean {
  return getPref("preflight") === codePartie;
}

export function marquerPreflight(codePartie: string) {
  setPref("preflight", codePartie);
}
