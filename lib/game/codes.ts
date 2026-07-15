/** Alphabet sans caractères ambigus (pas de O/0/I/1/L). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function randomCode(len = 6): string {
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Identifiant écrit sur les puces NFC et encodé dans les QR codes. */
export function newTagId(): string {
  return `TYH-${randomCode(8)}`;
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
