"use client";

import { useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface HanoiConfig {
  disks: number;
}

const DISK_COLORS = ["#C0392B", "#F5A623", "#2E5E3A", "#2980B9", "#8E44AD", "#D35400"];

function HanoiGame({ config, onComplete }: MiniGameProps) {
  const cfg = config as unknown as HanoiConfig;
  const disks = Math.min(6, Math.max(3, cfg.disks || 4));
  const minMoves = Math.pow(2, disks) - 1;

  // pegs[i] = tailles des disques, du bas vers le haut (grand → petit)
  const [pegs, setPegs] = useState<number[][]>(() => [
    Array.from({ length: disks }, (_, i) => disks - i),
    [],
    [],
  ]);
  const [selected, setSelected] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [shake, setShake] = useState(false);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  function tapPeg(i: number) {
    if (won) return;
    if (selected === null) {
      if (pegs[i].length > 0) {
        sfx.tick();
        haptics.tap();
        setSelected(i);
      }
      return;
    }
    if (selected === i) {
      setSelected(null);
      return;
    }
    const disk = pegs[selected][pegs[selected].length - 1];
    const destTop = pegs[i][pegs[i].length - 1];
    if (destTop !== undefined && destTop < disk) {
      // interdit : gros disque sur petit
      sfx.fail();
      haptics.fail();
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setSelected(null);
      return;
    }
    const next = pegs.map((p) => [...p]);
    next[selected].pop();
    next[i].push(disk);
    setPegs(next);
    setSelected(null);
    sfx.pop();
    haptics.tap();
    const m = moves + 1;
    setMoves(m);

    if (next[2].length === disks) {
      setWon(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - (m - minMoves) * 8), durationMs }),
        1100
      );
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🗼 Déplace toute la tour sur le <strong>3ᵉ piquet</strong> ! Un seul disque à la fois, et
        jamais un grand sur un petit. Touche un piquet pour prendre, un autre pour poser.
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>Minimum possible : {minMoves} coups</span>
        <span className="tabular-nums">{moves} coups</span>
      </div>

      <div className={`grid grid-cols-3 gap-2 ${shake ? "animate-shake" : ""}`}>
        {pegs.map((peg, i) => (
          <button
            key={i}
            onClick={() => tapPeg(i)}
            aria-label={`Piquet ${i + 1}`}
            className={`relative h-44 rounded-xl border-[3px] flex flex-col-reverse items-center pb-2 gap-1 transition-colors ${
              selected === i
                ? "border-gold bg-gold/15"
                : i === 2
                  ? "border-ink/40 bg-leaf/10"
                  : "border-ink/25 bg-white/40"
            }`}
          >
            {/* Mât */}
            <div className="absolute inset-x-0 bottom-2 top-3 flex justify-center pointer-events-none">
              <div className="w-1.5 rounded-full bg-ink/25" />
            </div>
            {peg.map((diskSize, j) => {
              const isTop = j === peg.length - 1;
              const lifted = selected === i && isTop;
              return (
                <div
                  key={diskSize}
                  className={`relative z-10 h-5 rounded-full border-2 border-ink transition-transform ${
                    lifted ? "-translate-y-2 ring-2 ring-gold" : ""
                  }`}
                  style={{
                    width: `${28 + (diskSize / disks) * 62}%`,
                    backgroundColor: DISK_COLORS[(diskSize - 1) % DISK_COLORS.length],
                  }}
                />
              );
            })}
            <span className="absolute top-1 text-xs font-bold text-ink/40">
              {i === 2 ? "🎯" : i + 1}
            </span>
          </button>
        ))}
      </div>

      {won && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 TOUR DÉPLACÉE EN {moves} COUPS !
        </p>
      )}
    </div>
  );
}

function HanoiEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as HanoiConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Nombre de disques</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "3 — 🟢 rapide", v: 3 },
            { label: "4 — 🟡 moyen", v: 4 },
            { label: "5 — 🔴 long", v: 5 },
            { label: "6 — 🔥 extrême", v: 6 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, disks: o.v })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.disks ?? 4) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Minimum {Math.pow(2, Math.min(6, Math.max(3, cfg.disks ?? 4))) - 1} coups — le casse-tête
        classique, rien à configurer.
      </p>
    </div>
  );
}

export const hanoiDef: MiniGameDef = {
  kind: "hanoi",
  name: "Tour de Hanoï",
  icon: "🗼",
  description: "Déplacer la tour de disques sans jamais poser grand sur petit",
  needsAnswer: false,
  defaultConfig: { disks: 4 },
  Component: HanoiGame,
  ConfigEditor: HanoiEditor,
};
