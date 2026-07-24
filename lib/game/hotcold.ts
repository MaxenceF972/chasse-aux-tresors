/**
 * Échelle du thermomètre « chaud / froid » d'une balise GPS.
 * Partagée entre l'éditeur (réglage palier par palier) et l'écran joueur.
 * L'organisateur fixe librement la distance max de chaque palier ; au-delà du
 * palier le plus froid = « glacial ».
 */

// 6 seuils éditables en mètres, du plus FROID (le plus loin) au plus BRÛLANT
// (le plus près) — correspondent à HOTCOLD_TIERS[1..6].
export const HOTCOLD_DEFAULT_THRESHOLDS = [60, 54, 30, 18, 10, 5];

export interface HotColdTier {
  label: string;
  emoji: string;
  /** Couleur pleine (jauge segmentée) */
  color: string;
  /** Dégradé du cœur thermique [clair, foncé] */
  grad: [string, string];
}

// Du plus froid (index 0) au plus chaud (index 6). L'index correspond au retour
// de heatIndex() et à la jauge segmentée côté joueur. Les 6 paliers éditables
// sont HOTCOLD_TIERS[1..6] (glacial n'a pas de seuil : c'est « au-delà »).
export const HOTCOLD_TIERS: HotColdTier[] = [
  { label: "GLACIAL", emoji: "🧊", color: "#1B4F72", grad: ["#7FB3D5", "#1B4F72"] },
  { label: "FROID", emoji: "❄️", color: "#2471A3", grad: ["#85C1E9", "#21618C"] },
  { label: "FRAIS", emoji: "🙂", color: "#17A589", grad: ["#A3E4D7", "#148F77"] },
  { label: "TIÈDE", emoji: "🌤️", color: "#D4AC0D", grad: ["#F7DC6F", "#B7950B"] },
  { label: "CHAUD", emoji: "🔥", color: "#CA6F1E", grad: ["#F5B041", "#AF601A"] },
  { label: "TRÈS CHAUD", emoji: "🔥🔥", color: "#BA4A00", grad: ["#EB984E", "#9C3400"] },
  { label: "BRÛLANT", emoji: "🔥🔥🔥", color: "#C0392B", grad: ["#EC7063", "#7B241C"] },
];

/**
 * Renvoie 6 seuils sains (entiers, strictement décroissants) à partir d'une
 * saisie éventuellement absente/incohérente :
 *  - un tableau de 6 valeurs → repris (et forcé décroissant par sécurité),
 *  - sinon une ancienne portée → dérivée en 100/70/50/35/20/10 % de la portée,
 *  - sinon les valeurs par défaut.
 */
export function normalizeThresholds(
  input?: number[] | null,
  rangeFallback?: number | null
): number[] {
  let base: number[];
  if (Array.isArray(input) && input.length === 6 && input.every((n) => typeof n === "number" && n > 0)) {
    base = input.map((n) => Math.round(n));
  } else if (rangeFallback && rangeFallback > 0) {
    base = [1, 0.7, 0.5, 0.35, 0.2, 0.1].map((x) => Math.max(1, Math.round(x * rangeFallback)));
  } else {
    base = [...HOTCOLD_DEFAULT_THRESHOLDS];
  }
  // Chaque palier plus chaud doit être strictement plus proche que le précédent.
  for (let i = 1; i < base.length; i++) {
    if (base[i] >= base[i - 1]) base[i] = base[i - 1] - 1;
  }
  return base.map((n) => Math.max(1, n));
}

/**
 * Palier (0 = glacial … 6 = brûlant) pour une distance donnée.
 * `thresholds` = 6 seuils décroissants (FROID → BRÛLANT).
 */
export function heatIndex(distanceM: number, thresholds: number[]): number {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (distanceM <= thresholds[i]) return i + 1;
  }
  return 0;
}
