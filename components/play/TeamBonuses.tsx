"use client";

import { useState } from "react";
import type { AwardedBonus } from "@/lib/types";
import { bonusLabel } from "@/lib/game/format";

/** Montant seul, en colonne : « +300 », « −2 min ». */
function shortAmount(b: AwardedBonus): string {
  if (b.points) return `${b.points > 0 ? "+" : "−"}${Math.abs(b.points)}`;
  const abs = Math.abs(Math.round(b.seconds));
  const sign = b.seconds < 0 ? "−" : "+";
  return abs < 60 ? `${sign}${abs} s` : `${sign}${Math.round(abs / 60)} min`;
}

/** Un malus : points retirés, ou temps ajouté (photo refusée, par exemple). */
function isPenalty(b: { points: number; seconds: number }): boolean {
  return b.points < 0 || b.seconds > 0;
}

/**
 * Les récompenses d'une équipe dans le classement.
 *
 * Une équipe peut en cumuler huit (podium d'arrivée, records par épreuve…) :
 * les lister à plat transformerait le classement en mur de texte. On affiche
 * donc le TOTAL — la seule chose qui compte pour comprendre l'écart — et le
 * détail se déplie à la demande.
 */
export default function TeamBonuses({ bonuses }: { bonuses: AwardedBonus[] }) {
  const [open, setOpen] = useState(false);
  if (!bonuses.length) return null;

  // Une seule ligne : la plier n'apporterait rien.
  if (bonuses.length === 1) {
    const b = bonuses[0];
    const bad = isPenalty(b);
    return (
      <p className={`text-sm font-bold leading-snug ${bad ? "text-crimson" : "text-leaf"}`}>
        {bad ? "⚠️" : "🏅"} {bonusLabel(b.points, b.seconds)}
        {b.reason && <span className="text-ink/55"> — {b.reason}</span>}
      </p>
    );
  }

  const points = bonuses.reduce((s, b) => s + (b.points || 0), 0);
  const seconds = bonuses.reduce((s, b) => s + (b.seconds || 0), 0);
  // Le solde peut être négatif (photos refusées) : on ne le déguise pas en prix.
  const netBad = isPenalty({ points, seconds });
  const anyPenalty = bonuses.some(isPenalty);
  const sorted = [...bonuses].sort(
    (a, b) => (b.points || 0) - (a.points || 0) || (a.seconds || 0) - (b.seconds || 0)
  );

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex w-full items-center gap-1.5 min-h-8 text-sm font-bold leading-snug text-left ${
          netBad ? "text-crimson" : "text-leaf"
        }`}
      >
        {/* Une seule ligne, toujours : sur un écran étroit le texte se coupe,
            mais le chevron reste visible — sinon le bouton paraît décoratif. */}
        <span className="min-w-0 truncate">
          {netBad ? "⚠️" : "🏅"} {bonusLabel(points, seconds)}
          <span className="text-ink/45">
            {" "}
            · {bonuses.length} {anyPenalty ? "ajustements" : "récompenses"}
          </span>
        </span>
        <span className="shrink-0 text-ink/45" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul className="mt-0.5 mb-1 space-y-0.5 border-l-2 border-leaf/40 pl-2">
          {sorted.map((b, i) => (
            <li key={i} className="flex gap-2 text-xs font-bold leading-snug">
              <span
                className={`w-12 shrink-0 text-right tabular-nums ${
                  isPenalty(b) ? "text-crimson" : "text-leaf"
                }`}
              >
                {shortAmount(b)}
              </span>
              <span className="min-w-0 text-ink/60">{b.reason || "récompense"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
