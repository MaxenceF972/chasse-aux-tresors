"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface Motif {
  name: string;
  icon: string;
  rows: string[]; // 10 lignes de "0"/"1"
}

const MOTIFS: Motif[] = [
  {
    name: "Le crâne maudit",
    icon: "💀",
    rows: [
      "0011111100",
      "0111111110",
      "1111111111",
      "1100110011",
      "1100110011",
      "1111111111",
      "0111001110",
      "0011111100",
      "0010101000",
      "0010101000",
    ],
  },
  {
    name: "L'ancre du galion",
    icon: "⚓",
    rows: [
      "0000110000",
      "0001111000",
      "0001111000",
      "0000110000",
      "0111111110",
      "0000110000",
      "1100110011",
      "1100110011",
      "0110110110",
      "0011111100",
    ],
  },
  {
    name: "La clé du coffre",
    icon: "🗝️",
    rows: [
      "0001111000",
      "0011001100",
      "0110000110",
      "0011001100",
      "0001111000",
      "0000110000",
      "0000110000",
      "0000111100",
      "0000110000",
      "0000111100",
    ],
  },
  {
    name: "Le voilier fantôme",
    icon: "⛵",
    rows: [
      "0000010000",
      "0000110000",
      "0001110000",
      "0011110000",
      "0111110000",
      "0000110000",
      "1111111111",
      "0111111110",
      "0011111100",
      "0000000000",
    ],
  },
  {
    name: "La croix du trésor",
    icon: "❌",
    rows: [
      "1100000011",
      "1110000111",
      "0111001110",
      "0011111100",
      "0001111000",
      "0001111000",
      "0011111100",
      "0111001110",
      "1110000111",
      "1100000011",
    ],
  },
  {
    name: "La bouteille à la mer",
    icon: "🍾",
    rows: [
      "0000111000",
      "0000101000",
      "0000101000",
      "0001101100",
      "0011000110",
      "0010000010",
      "0010111010",
      "0010111010",
      "0011000110",
      "0001111100",
    ],
  },
];

function lineClues(cells: number[]): number[] {
  const clues: number[] = [];
  let run = 0;
  for (const c of cells) {
    if (c === 1) run++;
    else if (run > 0) {
      clues.push(run);
      run = 0;
    }
  }
  if (run > 0) clues.push(run);
  return clues.length ? clues : [0];
}

type Cell = 0 | 1 | 2; // vide | rempli | croix

function NonogramGame({ seed, onComplete }: MiniGameProps) {
  const motif = useMemo(
    () => MOTIFS[seededInt(rngFromSeed(`nonogram:${seed}`), MOTIFS.length)],
    [seed]
  );
  const solution = useMemo(
    () => motif.rows.map((row) => row.split("").map(Number)),
    [motif]
  );
  const rowClues = useMemo(() => solution.map(lineClues), [solution]);
  const colClues = useMemo(
    () => solution[0].map((_, c) => lineClues(solution.map((row) => row[c]))),
    [solution]
  );
  const totalFilled = useMemo(
    () => solution.flat().filter((v) => v === 1).length,
    [solution]
  );

  const [grid, setGrid] = useState<Cell[][]>(() =>
    Array.from({ length: 10 }, () => Array<Cell>(10).fill(0))
  );
  const [mode, setMode] = useState<"fill" | "cross">("fill");
  const [errors, setErrors] = useState(0);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  const filledCount = grid.flat().filter((v) => v === 1).length;

  function tap(r: number, c: number) {
    if (won) return;
    const current = grid[r][c];

    if (mode === "cross") {
      if (current === 1) return; // on ne décoche pas une case juste
      sfx.tick();
      setGrid((g) => g.map((row, i) => row.map((v, j) => (i === r && j === c ? (v === 2 ? 0 : 2) : v))));
      return;
    }

    if (current !== 0) return;
    if (solution[r][c] === 1) {
      sfx.tick();
      haptics.tap();
      const next = grid.map((row, i) =>
        row.map((v, j) => (i === r && j === c ? (1 as Cell) : v))
      );
      setGrid(next);
      if (next.flat().filter((v) => v === 1).length === totalFilled) {
        setWon(true);
        sfx.success();
        haptics.success();
        const durationMs = Date.now() - startRef.current;
        setTimeout(
          () => onComplete({ score: Math.max(100, 1000 - errors * 40), durationMs }),
          1600
        );
      }
    } else {
      // erreur : la case se marque toute seule d'une croix
      sfx.fail();
      haptics.fail();
      setErrors((e) => e + 1);
      setGrid((g) => g.map((row, i) => row.map((v, j) => (i === r && j === c ? (2 as Cell) : v))));
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-bold text-ink/70">
        🖼️ Les nombres indiquent les blocs de cases pleines (dans l&apos;ordre) sur chaque ligne
        et colonne. Résous la grille… un dessin apparaîtra !
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>
          {filledCount}/{totalFilled} cases
        </span>
        {errors > 0 && <span className="text-crimson">{errors} erreur{errors > 1 ? "s" : ""}</span>}
      </div>

      {/* Grille : coin + indices colonnes / indices lignes + cellules */}
      <div
        className="grid select-none"
        style={{ gridTemplateColumns: `minmax(2.4rem, auto) repeat(10, minmax(0, 1fr))` }}
      >
        <div />
        {colClues.map((clues, c) => (
          <div
            key={`col-${c}`}
            className={`flex flex-col items-center justify-end pb-1 font-mono font-bold text-[11px] leading-tight text-ink/75 ${
              c % 5 === 0 ? "border-l-2 border-ink/30" : ""
            }`}
          >
            {clues.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        ))}
        {grid.map((row, r) => (
          <div key={`row-${r}`} className="contents">
            <div
              className={`flex items-center justify-end gap-1 pr-1.5 font-mono font-bold text-[11px] text-ink/75 ${
                r % 5 === 0 ? "border-t-2 border-ink/30" : ""
              }`}
            >
              {rowClues[r].map((n, i) => (
                <span key={i}>{n}</span>
              ))}
            </div>
            {row.map((cell, c) => (
              <button
                key={c}
                onClick={() => tap(r, c)}
                aria-label={`Case ${r + 1},${c + 1}`}
                className={`aspect-square border border-ink/25 transition-colors duration-100 ${
                  r % 5 === 0 ? "border-t-2 border-t-ink/40" : ""
                } ${c % 5 === 0 ? "border-l-2 border-l-ink/40" : ""} ${
                  cell === 1
                    ? won
                      ? "bg-leaf"
                      : "bg-ink"
                    : "bg-white/70"
                }`}
              >
                {cell === 2 && !won && (
                  <span className="text-crimson font-bold text-xs leading-none">✗</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Mode de pose */}
      {!won ? (
        <div className="flex gap-2">
          <button
            onClick={() => setMode("fill")}
            className={`flex-1 h-11 rounded-xl border-[3px] border-ink font-display ${
              mode === "fill" ? "bg-ink text-parchment" : "bg-white text-ink"
            }`}
          >
            🖌️ REMPLIR
          </button>
          <button
            onClick={() => setMode("cross")}
            className={`flex-1 h-11 rounded-xl border-[3px] border-ink font-display ${
              mode === "cross" ? "bg-crimson text-parchment" : "bg-white text-ink"
            }`}
          >
            ✗ MARQUER VIDE
          </button>
        </div>
      ) : (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          {motif.icon} {motif.name.toUpperCase()} !
        </p>
      )}
    </div>
  );
}

function NonogramEditor({}: ConfigEditorProps) {
  return (
    <div className="space-y-2">
      <Label>Rien à configurer !</Label>
      <p className="text-sm font-bold text-ink/60">
        Chaque équipe reçoit un dessin mystère différent (crâne, ancre, voilier…) parmi{" "}
        {MOTIFS.length} motifs. Les erreurs sont signalées immédiatement et comptées.
      </p>
    </div>
  );
}

export const nonogramDef: MiniGameDef = {
  kind: "nonogram",
  name: "Nonogram",
  icon: "🖼️",
  description: "Révéler le dessin caché grâce aux indices numériques",
  needsAnswer: false,
  defaultConfig: {},
  Component: NonogramGame,
  ConfigEditor: NonogramEditor,
};
