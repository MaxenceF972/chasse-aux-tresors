/** Alphabet sans caractères ambigus (pas de O/0/I/1/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(len = 6): string {
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Identifiant unique d'une balise. */
export function newTagId(): string {
  return `TYH-${randomCode(8)}`;
}

/**
 * Domaine canonique gravé sur les puces NFC et les QR : épinglé en dur pour
 * que les liens soient identiques quel que soit l'hôte depuis lequel
 * l'organisateur les écrit (toyah-games.app, *.vercel.app, localhost…).
 * Une puce est définitive : ne changer ce domaine que si l'ancien reste servi.
 */
const CANONICAL_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? "https://toyah-games.app";

/**
 * URL écrite sur la puce NFC et encodée dans le QR : poser le téléphone sur la
 * balise (ou scanner le QR avec l'appareil photo) ouvre directement la
 * validation — iPhone comme Android, sans app ni navigateur particulier.
 */
export function tagUrl(tagId: string, origin?: string): string {
  return `${origin ?? CANONICAL_ORIGIN}/t/${tagId}`;
}

/** Extrait l'identifiant de balise d'une URL /t/… ou renvoie la valeur brute. */
export function extractTagId(raw: string): string {
  const match = raw.trim().match(/\/t\/([^/?#\s]+)/);
  return match ? match[1] : raw.trim();
}

export const TEAM_COLORS = [
  "#C0392B",
  "#F5A623",
  "#2E5E3A",
  "#2980B9",
  "#8E44AD",
  "#D35400",
  "#16A085",
  "#34495E",
];
