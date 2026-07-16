"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";

/**
 * Niveaux : # mur · espace sol · . cible · $ caisse · @ joueur · * caisse sur
 * cible · + joueur sur cible. Niveaux 2-6 issus de Microban (David W. Skinner,
 * distribution libre), triés par difficulté.
 */
export const LEVELS: { tier: 1 | 2 | 3; map: string[] }[] = [
  { tier: 1, map: ["#####", "#@$.#", "#####"] },
  {
    tier: 1,
    map: ["####", "# .#", "#  ###", "#*@  #", "#  $ #", "#  ###", "####"],
  },
  {
    tier: 2,
    map: ["######", "#    #", "# #@ #", "# $* #", "# .* #", "#    #", "######"],
  },
  {
    tier: 2,
    map: ["  ####", "###  ####", "#     $ #", "# #  #$ #", "# . .#@ #", "#########"],
  },
  {
    tier: 3,
    map: ["########", "#      #", "# .**$@#", "#      #", "#####  #", "    ####"],
  },
  {
    tier: 3,
    map: [" #######", " #     #", " # .$. #", "## $@$ #", "#  .$. #", "#      #", "########"],
  },
];

interface LevelState {
  player: [number, number];
  boxes: Set<string>;
}

const key = (r: number, c: number) => `${r},${c}`;

export function parseLevel(map: string[]) {
  const walls = new Set<string>();
  const targets = new Set<string>();
  const boxes = new Set<string>();
  let player: [number, number] = [0, 0];
  map.forEach((row, r) => {
    row.split("").forEach((ch, c) => {
      if (ch === "#") walls.add(key(r, c));
      if (ch === "." || ch === "*" || ch === "+") targets.add(key(r, c));
      if (ch === "$" || ch === "*") boxes.add(key(r, c));
      if (ch === "@" || ch === "+") player = [r, c];
    });
  });
  const rows = map.length;
  const cols = Math.max(...map.map((row) => row.length));
  return { walls, targets, initial: { player, boxes } as LevelState, rows, cols, map };
}

const DIRS: Record<string, [number, number]> = {
  up: [-1, 0],
  down: [1, 0],
  left: [0, -1],
  right: [0, 1],
};

function SokobanGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as { difficulty?: string };
  const difficulty = cfg.difficulty === "facile" || cfg.difficulty === "difficile" ? cfg.difficulty : "moyen";

  // Sélection seedée des niveaux selon la difficulté
  const levels = useMemo(() => {
    const rand = rngFromSeed(`sokoban:${seed}`);
    const tier1 = LEVELS.filter((l) => l.tier === 1);
    const tier2 = seededShuffle(LEVELS.filter((l) => l.tier === 2), rand);
    const tier3 = seededShuffle(LEVELS.filter((l) => l.tier === 3), rand);
    if (difficulty === "facile") return [...tier1];
    if (difficulty === "difficile") return [tier2[0], ...tier3];
    return [tier1[1], tier2[0], tier2[1]];
  }, [seed, difficulty]);

  const [levelIndex, setLevelIndex] = useState(0);
  const level = useMemo(() => parseLevel(levels[levelIndex].map), [levels, levelIndex]);

  const [state, setState] = useState<LevelState>(level.initial);
  const [history, setHistory] = useState<LevelState[]>([]);
  const [moves, setMoves] = useState(0);
  const [won, setWon] = useState(false);
  const [levelDone, setLevelDone] = useState(false);
  const startRef = useRef(Date.now());
  const stateRef = useRef(state);
  stateRef.current = state;

  // Reset à chaque changement de niveau
  useEffect(() => {
    setState(level.initial);
    setHistory([]);
    setLevelDone(false);
  }, [level]);

  function isWin(s: LevelState): boolean {
    return [...level.targets].every((t) => s.boxes.has(t));
  }

  function move(dirKey: keyof typeof DIRS) {
    if (won || levelDone) return;
    const s = stateRef.current;
    const [dr, dc] = DIRS[dirKey];
    const [r, c] = s.player;
    const next: [number, number] = [r + dr, c + dc];
    const nextKey = key(next[0], next[1]);
    if (level.walls.has(nextKey)) return;

    const newBoxes = new Set(s.boxes);
    if (s.boxes.has(nextKey)) {
      const beyond = key(next[0] + dr, next[1] + dc);
      if (level.walls.has(beyond) || s.boxes.has(beyond)) {
        haptics.tap();
        return; // caisse bloquée
      }
      newBoxes.delete(nextKey);
      newBoxes.add(beyond);
      sfx.pop();
    } else {
      sfx.tick();
    }

    setHistory((h) => [...h.slice(-60), s]);
    const newState: LevelState = { player: next, boxes: newBoxes };
    setState(newState);
    setMoves((m) => m + 1);

    if (isWin(newState)) {
      if (levelIndex + 1 >= levels.length) {
        setWon(true);
        sfx.success();
        haptics.success();
        const durationMs = Date.now() - startRef.current;
        const score = Math.max(100, 1000 - moves);
        setTimeout(() => onComplete({ score, durationMs }), 1300);
      } else {
        setLevelDone(true);
        sfx.success();
        setTimeout(() => setLevelIndex((i) => i + 1), 1200);
      }
    }
  }

  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      setState(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
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
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, won, levelDone]);

  return (
    <div className="space-y-3">
      <p className="font-bold text-ink/70">
        📦 Pousse chaque caisse sur une cible <span className="text-leaf">●</span>. On ne peut
        que <strong>pousser</strong> — un coup de trop et c&apos;est le blocage !
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>
          Entrepôt {levelIndex + 1}/{levels.length}
        </span>
        <span className="tabular-nums">{moves} pas</span>
      </div>

      {/* Plateau */}
      <div className="flex justify-center">
        <div
          className="grid gap-0 rounded-xl border-[3px] border-ink overflow-hidden"
          style={{ gridTemplateColumns: `repeat(${level.cols}, minmax(0, 2.1rem))` }}
        >
          {Array.from({ length: level.rows }, (_, r) =>
            Array.from({ length: level.cols }, (_, c) => {
              const k = key(r, c);
              const isWall = level.walls.has(k);
              const isTarget = level.targets.has(k);
              const isBox = state.boxes.has(k);
              const isPlayer = state.player[0] === r && state.player[1] === c;
              return (
                <div
                  key={k}
                  className={`aspect-square flex items-center justify-center text-lg ${
                    isWall ? "bg-ink" : "bg-parchment"
                  }`}
                >
                  {isBox ? (
                    <span
                      className={`w-[85%] h-[85%] rounded-md border-2 border-ink flex items-center justify-center text-sm ${
                        isTarget ? "bg-leaf" : "bg-gold"
                      }`}
                    >
                      📦
                    </span>
                  ) : isPlayer ? (
                    <span>🏴‍☠️</span>
                  ) : isTarget ? (
                    <span className="text-leaf text-xl leading-none">●</span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      {won ? (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 TOUTES LES CAISSES RANGÉES !
        </p>
      ) : levelDone ? (
        <p className="text-center font-display text-xl text-leaf animate-stamp">
          ✅ Entrepôt suivant…
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 max-w-56 mx-auto">
            <Button size="sm" variant="parchment" onClick={undo} disabled={!history.length}>
              ↩️
            </Button>
            <PadBtn label="⬆️" onPress={() => move("up")} />
            <Button
              size="sm"
              variant="crimson"
              onClick={() => {
                setState(level.initial);
                setHistory([]);
              }}
            >
              🔄
            </Button>
            <PadBtn label="⬅️" onPress={() => move("left")} />
            <PadBtn label="⬇️" onPress={() => move("down")} />
            <PadBtn label="➡️" onPress={() => move("right")} />
          </div>
          <p className="text-center text-xs font-bold text-ink/45">
            ↩️ annuler un coup · 🔄 recommencer l&apos;entrepôt
          </p>
        </>
      )}
    </div>
  );
}

function PadBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      className="h-12 rounded-xl border-[3px] border-ink bg-gold text-xl shadow-[0_4px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_1px_0_0_#111111] select-none"
      aria-label={label}
    >
      {label}
    </button>
  );
}

function SokobanEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as { difficulty?: string };
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "🟢 Facile (2 petits)", v: "facile" },
            { label: "🟡 Moyen (3 niveaux)", v: "moyen" },
            { label: "🔴 Difficile (3 retors)", v: "difficile" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, difficulty: o.v })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.difficulty ?? "moyen") === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Niveaux choisis pour chaque équipe (bouton annuler inclus — personne ne reste bloqué).
      </p>
    </div>
  );
}

export const sokobanDef: MiniGameDef = {
  kind: "sokoban",
  name: "Sokoban du port",
  icon: "📦",
  description: "Pousser les caisses sur les cibles sans se bloquer",
  needsAnswer: false,
  defaultConfig: { difficulty: "moyen" },
  Component: SokobanGame,
  ConfigEditor: SokobanEditor,
};
