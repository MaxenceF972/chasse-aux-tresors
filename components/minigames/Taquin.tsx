"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";
import ImageField from "./ImageField";

interface TaquinConfig {
  image_url?: string;
  size: number;
}

/** Mélange par marche aléatoire depuis l'état résolu → toujours solvable. */
function shuffledBoard(size: number, seed: string): number[] {
  const n = size * size;
  const board = Array.from({ length: n }, (_, i) => i);
  const rand = rngFromSeed(seed);
  let hole = n - 1;
  let prev = -1;
  for (let step = 0; step < 140 * size; step++) {
    const r = Math.floor(hole / size);
    const c = hole % size;
    const candidates = [
      r > 0 ? hole - size : -1,
      r < size - 1 ? hole + size : -1,
      c > 0 ? hole - 1 : -1,
      c < size - 1 ? hole + 1 : -1,
    ].filter((p) => p !== -1 && p !== prev);
    const pick = candidates[seededInt(rand, candidates.length)];
    [board[hole], board[pick]] = [board[pick], board[hole]];
    prev = hole;
    hole = pick;
  }
  return board;
}

function TaquinGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as TaquinConfig;
  const size = cfg.size === 4 ? 4 : 3;
  const n = size * size;
  const [board, setBoard] = useState<number[]>(() => shuffledBoard(size, seed));
  const [moves, setMoves] = useState(0);
  const [solved, setSolved] = useState(false);
  const startRef = useRef(Date.now());

  const holeTile = n - 1;
  const solvedNow = useMemo(() => board.every((t, i) => t === i), [board]);

  function tapTile(pos: number) {
    if (solved) return;
    const hole = board.indexOf(holeTile);
    const sameRow = Math.floor(pos / size) === Math.floor(hole / size) && Math.abs(pos - hole) === 1;
    const sameCol = pos % size === hole % size && Math.abs(pos - hole) === size;
    if (!sameRow && !sameCol) return;

    const next = [...board];
    [next[pos], next[hole]] = [next[hole], next[pos]];
    setBoard(next);
    setMoves((m) => m + 1);
    sfx.tick();
    haptics.tap();

    if (next.every((t, i) => t === i)) {
      setSolved(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - moves * 3), durationMs }),
        1200
      );
    }
  }

  const pct = 100 / size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between font-bold text-ink/70">
        <span>Reconstitue l&apos;image ! 🧩</span>
        <span className="tabular-nums">{moves} coups</span>
      </div>

      <div className="relative w-full aspect-square rounded-xl border-[3px] border-ink overflow-hidden bg-ink/10">
        {board.map((tile, pos) => {
          if (tile === holeTile && !solved) return null;
          const row = Math.floor(pos / size);
          const col = pos % size;
          const tRow = Math.floor(tile / size);
          const tCol = tile % size;
          return (
            <button
              key={tile}
              onClick={() => tapTile(pos)}
              aria-label={`Tuile ${tile + 1}`}
              className="absolute transition-all duration-150 ease-out border border-ink/40"
              style={{
                width: `${pct}%`,
                height: `${pct}%`,
                left: `${col * pct}%`,
                top: `${row * pct}%`,
                ...(cfg.image_url
                  ? {
                      backgroundImage: `url(${cfg.image_url})`,
                      backgroundSize: `${size * 100}% ${size * 100}%`,
                      backgroundPosition: `${(tCol * 100) / (size - 1)}% ${(tRow * 100) / (size - 1)}%`,
                    }
                  : { backgroundColor: "#F5A623" }),
              }}
            >
              {!cfg.image_url && (
                <span className="font-display text-2xl text-ink">{tile + 1}</span>
              )}
            </button>
          );
        })}
        {solved && (
          <div className="absolute inset-0 flex items-center justify-center bg-gold/20">
            <span className="font-display text-4xl text-parchment text-cartoon-outline animate-stamp">
              BRAVO !
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function TaquinEditor({ value, onChange, gameId }: ConfigEditorProps) {
  const cfg = value as unknown as TaquinConfig;
  return (
    <div className="space-y-3">
      <ImageField
        label="Image du puzzle"
        gameId={gameId}
        urls={cfg.image_url ? [cfg.image_url] : []}
        max={1}
        onChange={(urls) => onChange({ ...value, image_url: urls[0] })}
      />
      <div>
        <Label>Taille</Label>
        <div className="flex gap-2">
          {[3, 4].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...value, size: s })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                (cfg.size ?? 3) === s ? "bg-gold" : "bg-white"
              }`}
            >
              {s}×{s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const taquinDef: MiniGameDef = {
  kind: "taquin",
  name: "Taquin",
  icon: "🧩",
  description: "Puzzle glissant avec une image personnalisée",
  needsAnswer: false,
  defaultConfig: { size: 3 },
  Component: TaquinGame,
  ConfigEditor: TaquinEditor,
};
