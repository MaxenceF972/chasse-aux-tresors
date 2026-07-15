"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface LanternsConfig {
  size: number;
  scramble: number;
}

function toggle(grid: boolean[], index: number, size: number): boolean[] {
  const next = [...grid];
  const r = Math.floor(index / size);
  const c = index % size;
  const flip = (rr: number, cc: number) => {
    if (rr >= 0 && rr < size && cc >= 0 && cc < size) {
      next[rr * size + cc] = !next[rr * size + cc];
    }
  };
  flip(r, c);
  flip(r - 1, c);
  flip(r + 1, c);
  flip(r, c - 1);
  flip(r, c + 1);
  return next;
}

function LanternsGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as LanternsConfig;
  const size = [4, 5].includes(cfg.size) ? cfg.size : 5;
  const scramble = Math.max(4, cfg.scramble || 10);

  // Mélange par pressions aléatoires depuis l'état résolu → toujours solvable
  const initial = useMemo(() => {
    const rand = rngFromSeed(`lanterns:${seed}`);
    let grid = Array<boolean>(size * size).fill(false);
    let guard = 0;
    do {
      for (let k = 0; k < scramble; k++) {
        grid = toggle(grid, seededInt(rand, size * size), size);
      }
      guard++;
    } while (grid.every((v) => !v) && guard < 5);
    return grid;
  }, [seed, size, scramble]);

  const [grid, setGrid] = useState(initial);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  function tap(index: number) {
    if (won) return;
    sfx.tick();
    haptics.tap();
    const next = toggle(grid, index, size);
    setGrid(next);
    const m = moves + 1;
    setMoves(m);
    if (next.every((v) => !v)) {
      setWon(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(() => onComplete({ score: Math.max(100, 1000 - m * 5), durationMs }), 1100);
    }
  }

  const litCount = grid.filter(Boolean).length;

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🏮 Éteins <strong>toutes</strong> les lanternes ! Mais attention : toucher une lanterne
        inverse aussi ses 4 voisines…
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>{litCount} encore allumée{litCount > 1 ? "s" : ""}</span>
        <span className="tabular-nums">{moves} coups</span>
      </div>

      <div
        className="grid gap-2 rounded-xl border-[3px] border-ink bg-ink p-2.5"
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {grid.map((lit, i) => (
          <button
            key={i}
            onClick={() => tap(i)}
            aria-label={lit ? "Lanterne allumée" : "Lanterne éteinte"}
            className={`aspect-square rounded-lg border-2 transition-all duration-150 text-2xl ${
              lit
                ? "bg-gold border-gold-light shadow-[0_0_14px_4px_rgba(245,166,35,0.55)]"
                : "bg-ink-soft border-ink-soft opacity-70"
            }`}
          >
            {lit ? "🏮" : ""}
          </button>
        ))}
      </div>

      {won && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🌙 TOUT EST ÉTEINT !
        </p>
      )}
    </div>
  );
}

function LanternsEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as LanternsConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "🟢 Facile", size: 4, scramble: 5 },
            { label: "🟡 Moyen", size: 5, scramble: 10 },
            { label: "🔴 Difficile", size: 5, scramble: 18 },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange({ ...value, size: o.size, scramble: o.scramble })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.size ?? 5) === o.size && (cfg.scramble ?? 10) === o.scramble
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
        Grille générée pour chaque équipe, toujours solvable. Rien d&apos;autre à configurer !
      </p>
    </div>
  );
}

export const lanternsDef: MiniGameDef = {
  kind: "lanterns",
  name: "Lanternes",
  icon: "🏮",
  description: "Éteindre toutes les lanternes (chaque pression inverse les voisines)",
  needsAnswer: false,
  defaultConfig: { size: 5, scramble: 10 },
  Component: LanternsGame,
  ConfigEditor: LanternsEditor,
};
