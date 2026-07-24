/**
 * Échelle du thermomètre « chaud / froid » d'une balise GPS.
 * Partagée entre l'éditeur (aperçu des paliers) et l'écran joueur (thermomètre).
 * Les paliers se répartissent proportionnellement à une PORTÉE réglable par
 * l'organisateur : au-delà de la portée = « glacial ».
 */

export const HOTCOLD_DEFAULT_RANGE = 100;
export const HOTCOLD_MIN_RANGE = 20;

export interface HotColdTier {
  label: string;
  emoji: string;
  /** Couleur pleine (jauge segmentée) */
  color: string;
  /** Dégradé du cœur thermique [clair, foncé] */
  grad: [string, string];
  /** Borne haute de distance, en fraction de la portée (Infinity = au-delà) */
  maxRatio: number;
}

// Du plus froid (index 0) au plus chaud (index 6). L'index correspond au retour
// de heatIndex() et à la jauge segmentée côté joueur.
export const HOTCOLD_TIERS: HotColdTier[] = [
  { label: "GLACIAL", emoji: "🧊", color: "#1B4F72", grad: ["#7FB3D5", "#1B4F72"], maxRatio: Infinity },
  { label: "FROID", emoji: "❄️", color: "#2471A3", grad: ["#85C1E9", "#21618C"], maxRatio: 1.0 },
  { label: "FRAIS", emoji: "🙂", color: "#17A589", grad: ["#A3E4D7", "#148F77"], maxRatio: 0.7 },
  { label: "TIÈDE", emoji: "🌤️", color: "#D4AC0D", grad: ["#F7DC6F", "#B7950B"], maxRatio: 0.5 },
  { label: "CHAUD", emoji: "🔥", color: "#CA6F1E", grad: ["#F5B041", "#AF601A"], maxRatio: 0.35 },
  { label: "TRÈS CHAUD", emoji: "🔥🔥", color: "#BA4A00", grad: ["#EB984E", "#9C3400"], maxRatio: 0.2 },
  { label: "BRÛLANT", emoji: "🔥🔥🔥", color: "#C0392B", grad: ["#EC7063", "#7B241C"], maxRatio: 0.1 },
];

/** Portée valide (arrondie, plancher appliqué) à partir d'une saisie libre. */
export function normalizeRange(value: number | string | null | undefined): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!n || Number.isNaN(n)) return HOTCOLD_DEFAULT_RANGE;
  return Math.max(HOTCOLD_MIN_RANGE, Math.round(n));
}

/** Palier (0 = glacial … 6 = brûlant) pour une distance donnée et une portée. */
export function heatIndex(distanceM: number, range: number = HOTCOLD_DEFAULT_RANGE): number {
  for (let i = HOTCOLD_TIERS.length - 1; i >= 1; i--) {
    if (distanceM <= HOTCOLD_TIERS[i].maxRatio * range) return i;
  }
  return 0;
}

/** Lignes d'aperçu (glacial → brûlant) pour l'éditeur, avec bornes en mètres. */
export function hotColdRows(range: number): { label: string; emoji: string; bound: string }[] {
  return HOTCOLD_TIERS.map((t) => ({
    label: t.label,
    emoji: t.emoji,
    bound: t.maxRatio === Infinity ? `> ${range} m` : `≤ ${Math.round(t.maxRatio * range)} m`,
  }));
}
