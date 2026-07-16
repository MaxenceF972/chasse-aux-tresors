/** Préférences locales du joueur (persistées sur le device). */

const MUTE_KEY = "toyah:muted";
const GEO_KEY = "toyah:geo";

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* noop */
  }
}

export type GeoConsent = "granted" | "denied" | null;

export function getGeoConsent(): GeoConsent {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(GEO_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function setGeoConsent(consent: Exclude<GeoConsent, null>) {
  try {
    localStorage.setItem(GEO_KEY, consent);
  } catch {
    /* noop */
  }
}
