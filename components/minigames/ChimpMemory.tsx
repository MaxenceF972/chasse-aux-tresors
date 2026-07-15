"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface ChimpConfig {
  start: number;
  rounds: number;
}

const GRID_COLS = 4;
const GRID_ROWS = 6;

function ChimpGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as ChimpConfig;
  const start = Math.min(6, Math.max(3, cfg.start || 4));
  const rounds = Math.min(6, Math.max(2, cfg.rounds || 4));

  const [round, setRound] = useState(0); // 0..rounds-1
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"show" | "play">("show");
  const [progress, setProgress] = useState(0); // prochain numéro attendu - 1
  const [done, setDone] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(false);
  const startRef = useRef(Date.now());

  const count = start + round;

  // Positions des numéros dans la grille, différentes par manche/tentative
  const cells = useMemo(() => {
    const rand = rngFromSeed(`chimp:${seed}:${round}:${attempt}`);
    const all = Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => i);
    const picked = seededShuffle(all, rand).slice(0, count);
    const map = new Map<number, number>(); // cellule → numéro (1..count)
    picked.forEach((cell, i) => map.set(cell, i + 1));
    return map;
  }, [seed, round, attempt, count]);

  const showMs = 900 + count * 550;

  useEffect(() => {
    if (phase !== "show" || done) return;
    setProgress(0);
    const t = setTimeout(() => setPhase("play"), showMs);
    return () => clearTimeout(t);
  }, [phase, cells, showMs, done]);

  function tapCell(cell: number) {
    if (phase !== "play" || done) return;
    const num = cells.get(cell);
    if (num === undefined) return;
    if (num !== progress + 1) {
      // raté → nouvelle disposition
      sfx.fail();
      haptics.fail();
      setWrongFlash(true);
      setTimeout(() => {
        setWrongFlash(false);
        setAttempt((a) => a + 1);
        setPhase("show");
      }, 650);
      return;
    }
    sfx.tick();
    haptics.tap();
    const next = progress + 1;
    setProgress(next);
    if (next === count) {
      if (round + 1 >= rounds) {
        setDone(true);
        sfx.success();
        haptics.success();
        const durationMs = Date.now() - startRef.current;
        setTimeout(
          () => onComplete({ score: Math.max(100, 1000 - attempt * 60), durationMs }),
          1100
        );
      } else {
        sfx.pop();
        setTimeout(() => {
          setRound((r) => r + 1);
          setPhase("show");
        }, 500);
      }
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🐵 Mémorise la position des nombres… puis touche-les dans l&apos;ordre croissant quand ils
        se cachent ! (le fameux test du chimpanzé)
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>
          Manche {Math.min(round + 1, rounds)}/{rounds} · {count} nombres
        </span>
        <span className="font-display text-base h-6">
          {done ? "" : phase === "show" ? "👀 Mémorise…" : `Prochain : ${progress + 1}`}
        </span>
      </div>

      <div
        className={`grid gap-1.5 rounded-xl border-[3px] border-ink bg-ink p-2 ${
          wrongFlash ? "animate-shake" : ""
        }`}
        style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
      >
        {Array.from({ length: GRID_COLS * GRID_ROWS }, (_, cell) => {
          const num = cells.get(cell);
          const isTapped = num !== undefined && num <= progress;
          if (num === undefined) {
            return <div key={cell} className="aspect-square rounded-lg bg-ink-soft/40" />;
          }
          return (
            <button
              key={cell}
              onClick={() => tapCell(cell)}
              aria-label={`Case ${num}`}
              className={`aspect-square rounded-lg border-2 border-ink font-display text-xl transition-all ${
                phase === "show"
                  ? "bg-gold text-ink"
                  : isTapped
                    ? "bg-leaf text-parchment opacity-70"
                    : "bg-parchment text-transparent"
              }`}
            >
              {phase === "show" || isTapped ? num : "?"}
            </button>
          );
        })}
      </div>

      {done && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🍌 MÉMOIRE DE CHIMPANZÉ !
        </p>
      )}
    </div>
  );
}

function ChimpEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as ChimpConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "🟢 Facile (3→5)", start: 3, rounds: 3 },
            { label: "🟡 Moyen (4→7)", start: 4, rounds: 4 },
            { label: "🔴 Difficile (5→9)", start: 5, rounds: 5 },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange({ ...value, start: o.start, rounds: o.rounds })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.start ?? 4) === o.start && (cfg.rounds ?? 4) === o.rounds
                  ? "bg-gold"
                  : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Dispositions générées pour chaque équipe — rien d&apos;autre à configurer.
      </p>
    </div>
  );
}

export const chimpDef: MiniGameDef = {
  kind: "chimp",
  name: "Mémoire de singe",
  icon: "🐵",
  description: "Retenir la position des nombres et les toucher dans l'ordre",
  needsAnswer: false,
  defaultConfig: { start: 4, rounds: 4 },
  Component: ChimpGame,
  ConfigEditor: ChimpEditor,
};
