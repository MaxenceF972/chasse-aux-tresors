/** 3723000 → "1:02:03" ; 83000 → "01:23" */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Libellé d'une récompense, du point de vue du joueur : « +300 points »,
 * « 2 min offertes ». En mode chrono un bonus est un temps RENDU (secondes
 * négatives) — dit tel quel, ça se comprend sans explication.
 */
export function bonusLabel(points: number, seconds: number): string {
  if (points !== 0) return `${points > 0 ? "+" : ""}${points} points`;
  const abs = Math.abs(Math.round(seconds));
  // Sous la minute (un 3e de podium sur une balise, par exemple), arrondir à
  // « 1 min » mentirait sur la récompense : on l'annonce en secondes.
  if (abs < 60) return seconds < 0 ? `${abs} s offertes` : `+${abs} s de pénalité`;
  const min = Math.round(abs / 60);
  return seconds < 0 ? `${min} min offertes` : `+${min} min de pénalité`;
}
