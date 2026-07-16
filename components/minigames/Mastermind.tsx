"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";

const COLORS = [
  { hex: "#F5A623", name: "Or" },
  { hex: "#C0392B", name: "Rouge" },
  { hex: "#2E5E3A", name: "Vert" },
  { hex: "#2980B9", name: "Bleu" },
  { hex: "#8E44AD", name: "Violet" },
  { hex: "#D35400", name: "Orange" },
  { hex: "#16A085", name: "Turquoise" },
  { hex: "#111111", name: "Noir" },
];

interface MastermindConfig {
  slots: number;
  colors: number;
  /** false (défaut) = toutes les couleurs du code sont différentes */
  allow_repeats?: boolean;
}

interface Attempt {
  guess: number[];
  black: number; // bien placés
  white: number; // bonne couleur, mal placée
}

export function feedback(secret: number[], guess: number[]): { black: number; white: number } {
  let black = 0;
  const secretRest: number[] = [];
  const guessRest: number[] = [];
  secret.forEach((s, i) => {
    if (guess[i] === s) black++;
    else {
      secretRest.push(s);
      guessRest.push(guess[i]);
    }
  });
  let white = 0;
  for (const g of guessRest) {
    const idx = secretRest.indexOf(g);
    if (idx !== -1) {
      white++;
      secretRest.splice(idx, 1);
    }
  }
  return { black, white };
}

function MastermindGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as MastermindConfig;
  const slots = Math.min(5, Math.max(3, cfg.slots || 4));
  const colorCount = Math.min(COLORS.length, Math.max(4, cfg.colors || 6));

  // Sans doublons, le jeu est beaucoup plus lisible (et déductible)
  const allowRepeats = cfg.allow_repeats === true || colorCount < slots;

  // Combinaison déterministe par équipe : introuvable dans la config (anti-triche)
  const secret = useMemo(() => {
    const rand = rngFromSeed(`mastermind:${seed}`);
    if (allowRepeats) {
      return Array.from({ length: slots }, () => seededInt(rand, colorCount));
    }
    const pool = Array.from({ length: colorCount }, (_, i) => i);
    return seededShuffle(pool, rand).slice(0, slots);
  }, [seed, slots, colorCount, allowRepeats]);

  const [current, setCurrent] = useState<(number | null)[]>(() => Array(slots).fill(null));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [won, setWon] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const startRef = useRef(Date.now());

  function fill(colorIdx: number) {
    if (won) return;
    const i = current.indexOf(null);
    if (i === -1) return;
    sfx.tick();
    haptics.tap();
    setCurrent((c) => c.map((v, j) => (j === i ? colorIdx : v)));
  }

  function clearSlot(i: number) {
    if (won || current[i] === null) return;
    sfx.tick();
    setCurrent((c) => c.map((v, j) => (j === i ? null : v)));
  }

  function tryGuess() {
    if (current.some((v) => v === null) || won) return;
    const guess = current as number[];
    const { black, white } = feedback(secret, guess);
    setAttempts((a) => [{ guess, black, white }, ...a]);
    setCurrent(Array(slots).fill(null));

    if (black === slots) {
      setWon(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      const tries = attempts.length + 1;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - (tries - 1) * 60), durationMs }),
        1100
      );
    } else {
      sfx.pop();
    }
  }

  const filledCount = current.filter((v) => v !== null).length;

  return (
    <div className="space-y-4">
      {/* Règles, toujours accessibles */}
      <div className="rounded-xl border-[3px] border-ink/20 bg-white/50 p-3">
        <p className="font-bold text-ink/80">
          🎯 Un coffre à combinaison secrète de <strong>{slots} couleurs</strong> !{" "}
          {allowRepeats ? (
            <span className="text-crimson">Attention : les couleurs peuvent se répéter.</span>
          ) : (
            <span className="text-leaf">Indice : les {slots} couleurs sont toutes différentes.</span>
          )}
        </p>
        <button
          className="font-bold text-leaf underline text-sm mt-1"
          onClick={() => setHelpOpen((o) => !o)}
        >
          {helpOpen ? "Masquer les règles" : "Comment jouer ?"}
        </button>
        {helpOpen && (
          <ol className="mt-2 space-y-1 font-bold text-sm text-ink/70 list-decimal list-inside">
            <li>Touche les couleurs en bas pour remplir les {slots} cases.</li>
            <li>Appuie sur ESSAYER : tu reçois des indices.</li>
            <li>
              <span className="text-ink">« bien placée »</span> = cette couleur existe ET elle est
              à la bonne position. <span className="text-ink">« mal placée »</span> = la couleur
              existe dans le code, mais ailleurs.
            </li>
            <li>
              Déduis, recommence, et trouve le code !{" "}
              {allowRepeats
                ? "(les couleurs peuvent se répéter)"
                : "(chaque couleur n'apparaît qu'une seule fois)"}
            </li>
          </ol>
        )}
      </div>

      {/* Essai en cours */}
      <div>
        <p className="text-center font-display text-sm text-ink/60 mb-1.5">
          {filledCount === 0
            ? "👇 Touche les couleurs pour remplir"
            : filledCount < slots
              ? `Encore ${slots - filledCount} case${slots - filledCount > 1 ? "s" : ""}…`
              : "Prêt ? ESSAYER !"}
        </p>
        <div className="flex items-center justify-center gap-2">
          {current.map((v, i) => (
            <button
              key={i}
              onClick={() => clearSlot(i)}
              aria-label={`Case ${i + 1}${v !== null ? " (toucher pour vider)" : ""}`}
              className="w-12 h-12 rounded-full border-[3px] border-ink bg-white shadow-inner"
              style={v !== null ? { backgroundColor: COLORS[v].hex } : undefined}
            >
              {v === null && <span className="text-ink/30 font-display">?</span>}
            </button>
          ))}
        </div>
        {filledCount > 0 && !won && (
          <p className="text-center text-xs font-bold text-ink/40 mt-1">
            (touche une case remplie pour la vider)
          </p>
        )}
      </div>

      {/* Palette */}
      <div className="flex flex-wrap justify-center gap-2">
        {COLORS.slice(0, colorCount).map((color, i) => (
          <button
            key={color.hex}
            onClick={() => fill(i)}
            aria-label={color.name}
            className="w-11 h-11 rounded-full border-[3px] border-ink shadow-[2px_2px_0_0_#111111] active:translate-y-[2px] active:shadow-none"
            style={{ backgroundColor: color.hex }}
          />
        ))}
      </div>

      <Button full size="lg" onClick={tryGuess} disabled={current.some((v) => v === null) || won}>
        🎯 ESSAYER
      </Button>

      {won && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 COMBINAISON TROUVÉE !
        </p>
      )}

      {/* Historique des essais avec indices en toutes lettres */}
      {attempts.length > 0 && !won && (
        <p className="font-display text-sm text-ink/60">
          Tes essais ({attempts.length}) :
        </p>
      )}
      {attempts.length > 0 && (
        <div className="space-y-2 max-h-60 overflow-y-auto rounded-xl border-[3px] border-ink/15 p-2.5">
          {attempts.map((attempt, i) => (
            <div
              key={attempts.length - i}
              className="flex items-center gap-2.5 rounded-lg bg-white/50 px-2 py-1.5"
            >
              <span className="font-bold text-ink/40 text-sm w-7 tabular-nums shrink-0">
                #{attempts.length - i}
              </span>
              <div className="flex gap-1 shrink-0">
                {attempt.guess.map((c, j) => (
                  <span
                    key={j}
                    className="w-6 h-6 rounded-full border-2 border-ink inline-block"
                    style={{ backgroundColor: COLORS[c].hex }}
                  />
                ))}
              </div>
              <span className="font-bold text-xs leading-tight text-ink/75">
                {attempt.black === 0 && attempt.white === 0 ? (
                  "aucune bonne couleur !"
                ) : (
                  <>
                    {attempt.black > 0 && (
                      <span className="text-leaf">{attempt.black} bien placée{attempt.black > 1 ? "s" : ""}</span>
                    )}
                    {attempt.black > 0 && attempt.white > 0 && " · "}
                    {attempt.white > 0 && (
                      <span className="text-crimson">
                        {attempt.white} mal placée{attempt.white > 1 ? "s" : ""}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MastermindEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as MastermindConfig;
  const slots = cfg.slots ?? 4;
  const colors = cfg.colors ?? 6;
  const repeats = cfg.allow_repeats === true;
  const score = slots + colors + (repeats ? 4 : 0);
  const difficulty =
    score <= 9 ? "🟢 Facile" : score <= 11 ? "🟡 Corsé" : "🔴 Très difficile";

  return (
    <div className="space-y-3">
      <div>
        <Label>Nombre de cases (3–5)</Label>
        <div className="flex gap-2">
          {[3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ ...value, slots: n })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                slots === n ? "bg-gold" : "bg-white"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Nombre de couleurs (4–8)</Label>
        <div className="flex gap-2 flex-wrap">
          {[4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange({ ...value, colors: n })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                colors === n ? "bg-gold" : "bg-white"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 font-bold text-ink/70">
        <input
          type="checkbox"
          className="w-5 h-5 accent-[#F5A623]"
          checked={repeats}
          onChange={(e) => onChange({ ...value, allow_repeats: e.target.checked })}
        />
        Autoriser les couleurs en double (beaucoup plus dur !)
      </label>
      <p className="font-bold text-sm text-ink/70">
        Difficulté estimée : {difficulty}
        {score > 11 && " — prévois 10 à 20 minutes pour une équipe !"}
      </p>
      <p className="text-sm font-bold text-ink/60">
        Le conseil TOYAH : 4 cases / 6 couleurs, c&apos;est déjà un vrai défi. La combinaison est
        générée pour chaque équipe — impossible à tricher.
      </p>
    </div>
  );
}

export const mastermindDef: MiniGameDef = {
  kind: "mastermind",
  name: "Mastermind",
  icon: "🎯",
  description: "Déduire la combinaison de couleurs secrète",
  needsAnswer: false,
  defaultConfig: { slots: 4, colors: 6 },
  Component: MastermindGame,
  ConfigEditor: MastermindEditor,
};
