"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface MazeConfig {
  size: number;
  fog: boolean;
}

export interface Cell {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

type Dir = keyof Cell;

/** Génération par backtracking récursif — labyrinthe parfait, toujours solvable. */
export function genMaze(n: number, rand: () => number): Cell[][] {
  const cells: Cell[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => ({ n: true, e: true, s: true, w: true }))
  );
  const visited = Array.from({ length: n }, () => Array(n).fill(false));
  const stack: [number, number][] = [[0, 0]];
  visited[0][0] = true;

  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options: [number, number, Dir, Dir][] = [];
    if (y > 0 && !visited[y - 1][x]) options.push([x, y - 1, "n", "s"]);
    if (x < n - 1 && !visited[y][x + 1]) options.push([x + 1, y, "e", "w"]);
    if (y < n - 1 && !visited[y + 1][x]) options.push([x, y + 1, "s", "n"]);
    if (x > 0 && !visited[y][x - 1]) options.push([x - 1, y, "w", "e"]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, ny, wall, opposite] = options[seededInt(rand, options.length)];
    cells[y][x][wall] = false;
    cells[ny][nx][opposite] = false;
    visited[ny][nx] = true;
    stack.push([nx, ny]);
  }
  return cells;
}

const DIRS: Record<string, { dx: number; dy: number; wall: Dir }> = {
  up: { dx: 0, dy: -1, wall: "n" },
  down: { dx: 0, dy: 1, wall: "s" },
  left: { dx: -1, dy: 0, wall: "w" },
  right: { dx: 1, dy: 0, wall: "e" },
};

function MazeGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as MazeConfig;
  const n = [9, 11, 13].includes(cfg.size) ? cfg.size : 11;
  const fog = cfg.fog !== false;

  const maze = useMemo(() => genMaze(n, rngFromSeed(`maze:${seed}`)), [n, seed]);
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());
  const wonRef = useRef(false);
  const posRef = useRef<[number, number]>([0, 0]);
  const movesRef = useRef(0);

  function move(dirKey: keyof typeof DIRS) {
    if (wonRef.current) return;
    const dir = DIRS[dirKey];
    const [x, y] = posRef.current;
    if (maze[y][x][dir.wall]) {
      haptics.tap(); // mur !
      return;
    }
    const next: [number, number] = [x + dir.dx, y + dir.dy];
    posRef.current = next;
    movesRef.current += 1;
    setPos(next);
    setMoves(movesRef.current);
    sfx.tick();
    if (next[0] === n - 1 && next[1] === n - 1) {
      wonRef.current = true;
      setWon(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      const score = Math.max(100, 1000 - movesRef.current);
      setTimeout(() => onComplete({ score, durationMs }), 1100);
    }
  }

  // Flèches clavier (test sur desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, keyof typeof DIRS> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      if (map[e.key]) {
        e.preventDefault();
        move(map[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maze]);

  const C = 10; // taille d'une cellule (unités SVG)
  const [px, py] = pos;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between font-bold text-ink/70">
        <span>Trouve le trésor {fog && "dans le brouillard "}! 🌀</span>
        <span className="tabular-nums">{moves} pas</span>
      </div>
      {fog && (
        <p className="text-sm font-bold text-ink/50 -mt-2">
          🧭 La lanterne n&apos;éclaire pas loin… Le ❌ est quelque part au sud-est.
        </p>
      )}

      <svg
        viewBox={`-1 -1 ${n * C + 2} ${n * C + 2}`}
        className="w-full aspect-square rounded-xl border-[3px] border-ink parchment-texture"
      >
        {/* Murs */}
        {maze.map((row, y) =>
          row.map((cell, x) => (
            <g key={`${x}-${y}`} stroke="#111111" strokeWidth={1.6} strokeLinecap="round">
              {cell.n && <line x1={x * C} y1={y * C} x2={x * C + C} y2={y * C} />}
              {cell.w && <line x1={x * C} y1={y * C} x2={x * C} y2={y * C + C} />}
              {x === n - 1 && cell.e && (
                <line x1={x * C + C} y1={y * C} x2={x * C + C} y2={y * C + C} />
              )}
              {y === n - 1 && cell.s && (
                <line x1={x * C} y1={y * C + C} x2={x * C + C} y2={y * C + C} />
              )}
            </g>
          ))
        )}

        {/* Le X du trésor */}
        <g stroke="#C0392B" strokeWidth={2.2} strokeLinecap="round">
          <line
            x1={(n - 1) * C + 2.5}
            y1={(n - 1) * C + 2.5}
            x2={n * C - 2.5}
            y2={n * C - 2.5}
          />
          <line
            x1={n * C - 2.5}
            y1={(n - 1) * C + 2.5}
            x2={(n - 1) * C + 2.5}
            y2={n * C - 2.5}
          />
        </g>

        {/* Joueur */}
        <circle
          cx={px * C + C / 2}
          cy={py * C + C / 2}
          r={C * 0.3}
          fill="#F5A623"
          stroke="#111111"
          strokeWidth={1.4}
        />

        {/* Brouillard : tout ce qui est à plus d'une case est masqué */}
        {fog &&
          !won &&
          maze.map((row, y) =>
            row.map((_, x) => {
              const dist = Math.max(Math.abs(x - px), Math.abs(y - py));
              if (dist <= 1) return null;
              return (
                <rect
                  key={`fog-${x}-${y}`}
                  x={x * C - 0.5}
                  y={y * C - 0.5}
                  width={C + 1}
                  height={C + 1}
                  fill="#111111"
                  opacity={dist === 2 ? 0.72 : 0.97}
                />
              );
            })
          )}
      </svg>

      {won ? (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 SORTIE TROUVÉE !
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 max-w-56 mx-auto">
          <div />
          <PadButton label="⬆️" onPress={() => move("up")} />
          <div />
          <PadButton label="⬅️" onPress={() => move("left")} />
          <PadButton label="⬇️" onPress={() => move("down")} />
          <PadButton label="➡️" onPress={() => move("right")} />
        </div>
      )}
    </div>
  );
}

function PadButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      className="h-14 rounded-xl border-[3px] border-ink bg-gold text-2xl shadow-[0_4px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_1px_0_0_#111111] select-none"
      aria-label={label}
    >
      {label}
    </button>
  );
}

function MazeEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as MazeConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Taille du labyrinthe</Label>
        <div className="flex gap-2">
          {[
            { label: "9×9 Facile", v: 9 },
            { label: "11×11 Moyen", v: 11 },
            { label: "13×13 Difficile", v: 13 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, size: o.v })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.size ?? 11) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <label className="flex items-center gap-2 font-bold text-ink/70">
        <input
          type="checkbox"
          className="w-5 h-5 accent-[#F5A623]"
          checked={cfg.fog !== false}
          onChange={(e) => onChange({ ...value, fog: e.target.checked })}
        />
        Brouillard (on ne voit qu&apos;à une case autour — bien plus corsé !)
      </label>
      <p className="text-sm font-bold text-ink/60">
        Le labyrinthe est généré différemment pour chaque équipe.
      </p>
    </div>
  );
}

export const mazeDef: MiniGameDef = {
  kind: "maze",
  name: "Labyrinthe",
  icon: "🌀",
  description: "Trouver le trésor dans un labyrinthe embrumé",
  needsAnswer: false,
  defaultConfig: { size: 11, fog: true },
  Component: MazeGame,
  ConfigEditor: MazeEditor,
};
