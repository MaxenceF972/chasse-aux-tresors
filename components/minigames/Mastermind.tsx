"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
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
}

interface Attempt {
  guess: number[];
  black: number; // bien placés
  white: number; // bonne couleur, mal placée
}

function feedback(secret: number[], guess: number[]): { black: number; white: number } {
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

  // Secret déterministe par équipe : introuvable dans la config (anti-triche)
  const secret = useMemo(() => {
    const rand = rngFromSeed(`mastermind:${seed}`);
    return Array.from({ length: slots }, () => seededInt(rand, colorCount));
  }, [seed, slots, colorCount]);

  const [current, setCurrent] = useState<(number | null)[]>(() => Array(slots).fill(null));
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [won, setWon] = useState(false);
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
    if (won) return;
    setCurrent((c) => c.map((v, j) => (j === i ? null : v)));
  }

  function tryGuess() {
    if (current.some((v) => v === null) || won) return;
    const guess = current as number[];
    const { black, white } = feedback(secret, guess);
    const attempt = { guess, black, white };
    setAttempts((a) => [attempt, ...a]);
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

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        Trouve la combinaison secrète ! ⚫ = bonne couleur bien placée, ⚪ = bonne
        couleur mal placée.
      </p>

      {/* Essai en cours */}
      <div className="flex items-center justify-center gap-2">
        {current.map((v, i) => (
          <button
            key={i}
            onClick={() => clearSlot(i)}
            aria-label={`Case ${i + 1}`}
            className="w-12 h-12 rounded-full border-[3px] border-ink bg-white"
            style={v !== null ? { backgroundColor: COLORS[v].hex } : undefined}
          >
            {v === null && <span className="text-ink/30 font-display">?</span>}
          </button>
        ))}
      </div>

      {/* Palette */}
      <div className="flex flex-wrap justify-center gap-2">
        {COLORS.slice(0, colorCount).map((color, i) => (
          <button
            key={color.hex}
            onClick={() => fill(i)}
            aria-label={color.name}
            className="w-10 h-10 rounded-full border-[3px] border-ink shadow-[2px_2px_0_0_#111111] active:translate-y-[2px] active:shadow-none"
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

      {/* Historique */}
      {attempts.length > 0 && (
        <div className="space-y-2 max-h-56 overflow-y-auto rounded-xl border-[3px] border-ink/15 p-2.5">
          {attempts.map((attempt, i) => (
            <div key={attempts.length - i} className="flex items-center gap-2">
              <span className="font-bold text-ink/40 text-sm w-7 tabular-nums">
                #{attempts.length - i}
              </span>
              <div className="flex gap-1.5 flex-1">
                {attempt.guess.map((c, j) => (
                  <span
                    key={j}
                    className="w-7 h-7 rounded-full border-2 border-ink inline-block"
                    style={{ backgroundColor: COLORS[c].hex }}
                  />
                ))}
              </div>
              <span className="font-bold text-sm tabular-nums">
                {"⚫".repeat(attempt.black)}
                {"⚪".repeat(attempt.white)}
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
                (cfg.slots ?? 4) === n ? "bg-gold" : "bg-white"
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
                (cfg.colors ?? 6) === n ? "bg-gold" : "bg-white"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        La combinaison est générée pour chaque équipe (différente à chaque fois) —
        rien à configurer, impossible à tricher.
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
