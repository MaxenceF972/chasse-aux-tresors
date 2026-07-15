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
 * URL écrite sur la puce NFC et encodée dans le QR : poser le téléphone sur la
 * balise (ou scanner le QR avec l'appareil photo) ouvre directement la
 * validation — iPhone comme Android, sans app ni navigateur particulier.
 */
export function tagUrl(tagId: string, origin?: string): string {
  const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/t/${tagId}`;
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
