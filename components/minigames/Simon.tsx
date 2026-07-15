"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Input, Label } from "@/components/ui/Input";

interface SimonConfig {
  rounds: number;
  speed_ms: number;
}

const PADS = [
  { color: "#F5A623", active: "#FFD57E", label: "Or" },
  { color: "#C0392B", active: "#F1948A", label: "Rouge" },
  { color: "#2E5E3A", active: "#7DCEA0", label: "Vert" },
  { color: "#2980B9", active: "#85C1E9", label: "Bleu" },
];

function SimonGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as SimonConfig;
  const rounds = Math.min(20, Math.max(3, cfg.rounds || 7));
  const speed = Math.max(250, cfg.speed_ms || 600);

  const sequence = useMemo(() => {
    const rand = rngFromSeed(seed);
    return Array.from({ length: rounds }, () => seededInt(rand, 4));
  }, [seed, rounds]);

  const [level, setLevel] = useState(1);
  const [lit, setLit] = useState<number | null>(null);
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [attempts, setAttempts] = useState(1);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());
  const timeouts = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timeouts.current.forEach(clearTimeout), []);

  // Joue la séquence du niveau courant
  useEffect(() => {
    if (done) return;
    setPlaying(true);
    setProgress(0);
    timeouts.current.forEach(clearTimeout);
    timeouts.current = [];
    for (let i = 0; i < level; i++) {
      timeouts.current.push(
        setTimeout(() => {
          setLit(sequence[i]);
          sfx.pad(sequence[i], speed / 1000 * 0.7);
          timeouts.current.push(setTimeout(() => setLit(null), speed * 0.6));
        }, 600 + i * speed)
      );
    }
    timeouts.current.push(
      setTimeout(() => setPlaying(false), 600 + level * speed)
    );
  }, [level, attempts, sequence, speed, done]);

  function tapPad(i: number) {
    if (playing || done) return;
    setLit(i);
    sfx.pad(i, 0.25);
    haptics.tap();
    setTimeout(() => setLit(null), 200);

    if (i === sequence[progress]) {
      const next = progress + 1;
      if (next === level) {
        if (level === rounds) {
          setDone(true);
          sfx.success();
          haptics.success();
          const durationMs = Date.now() - startRef.current;
          setTimeout(
            () => onComplete({ score: Math.max(100, 1000 - (attempts - 1) * 60), durationMs }),
            900
          );
        } else {
          setPlaying(true);
          setTimeout(() => setLevel((l) => l + 1), 700);
        }
      } else {
        setProgress(next);
      }
    } else {
      sfx.fail();
      haptics.fail();
      setAttempts((a) => a + 1);
      setLevel(1);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between font-bold text-ink/70">
        <span>Mémorise la séquence ! 🔆</span>
        <span className="tabular-nums">
          Niveau {level}/{rounds}
        </span>
      </div>

      <div className={`grid grid-cols-2 gap-3 ${done ? "opacity-60" : ""}`}>
        {PADS.map((pad, i) => (
          <button
            key={i}
            onClick={() => tapPad(i)}
            disabled={playing}
            aria-label={pad.label}
            className="aspect-square rounded-2xl border-[3px] border-ink shadow-[0_5px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_2px_0_0_#111111] transition-all duration-75"
            style={{
              backgroundColor: lit === i ? pad.active : pad.color,
              filter: lit === i ? "brightness(1.25)" : playing ? "brightness(0.75)" : "none",
            }}
          />
        ))}
      </div>

      <p className="text-center font-display text-lg text-ink/70 h-6">
        {done ? "🏆 SÉQUENCE COMPLÈTE !" : playing ? "👀 Regarde bien…" : "À toi de jouer !"}
      </p>
    </div>
  );
}

function SimonEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as SimonConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Longueur de la séquence (3–20)</Label>
        <Input
          type="number"
          min={3}
          max={20}
          value={cfg.rounds ?? 7}
          onChange={(e) => onChange({ ...value, rounds: Number(e.target.value) || 7 })}
        />
      </div>
      <div>
        <Label>Vitesse</Label>
        <div className="flex gap-2">
          {[
            { label: "Lente", v: 800 },
            { label: "Normale", v: 600 },
            { label: "Rapide", v: 420 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, speed_ms: o.v })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                (cfg.speed_ms ?? 600) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export const simonDef: MiniGameDef = {
  kind: "simon",
  name: "Simon",
  icon: "🔆",
  description: "Mémorisation de séquences lumineuses et sonores",
  needsAnswer: false,
  defaultConfig: { rounds: 7, speed_ms: 600 },
  Component: SimonGame,
  ConfigEditor: SimonEditor,
};
