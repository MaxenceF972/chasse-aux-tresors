"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";
import NumPad from "./NumPad";

interface CascadeConfig {
  steps: number;
  speed_ms: number;
}

interface CascadeSequence {
  items: string[]; // ["7", "× 3", "+ 12", …]
  answer: number;
}

function buildSequence(seedKey: string, steps: number): CascadeSequence {
  const rand = rngFromSeed(seedKey);
  let value = 2 + seededInt(rand, 8);
  const items = [String(value)];
  for (let i = 0; i < steps; i++) {
    const candidates: { label: string; next: number }[] = [];
    for (let n = 2; n <= 9; n++) {
      if (value + n <= 99) candidates.push({ label: `+ ${n}`, next: value + n });
      if (value - n >= 0) candidates.push({ label: `− ${n}`, next: value - n });
    }
    for (let n = 2; n <= 3; n++) {
      if (value * n <= 99 && value >= 2) candidates.push({ label: `× ${n}`, next: value * n });
    }
    const pick = candidates[seededInt(rand, candidates.length)];
    items.push(pick.label);
    value = pick.next;
  }
  return { items, answer: value };
}

function CascadeGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as CascadeConfig;
  const steps = Math.min(9, Math.max(3, cfg.steps || 5));
  const speed = Math.max(900, cfg.speed_ms || 2000);

  const [phase, setPhase] = useState<"idle" | "show" | "input">("idle");
  const [itemIndex, setItemIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [input, setInput] = useState("");
  const [wrong, setWrong] = useState(false);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());

  const sequence = useMemo(() => buildSequence(`cascade:${seed}`, steps), [seed, steps]);

  // Défilement des opérations une par une
  useEffect(() => {
    if (phase !== "show") return;
    if (itemIndex >= sequence.items.length) {
      setPhase("input");
      setInput("");
      return;
    }
    sfx.tick();
    const t = setTimeout(() => setItemIndex((i) => i + 1), speed);
    return () => clearTimeout(t);
  }, [phase, itemIndex, sequence.items.length, speed]);

  function start() {
    setItemIndex(0);
    setPhase("show");
  }

  function submit() {
    if (!input || done) return;
    if (Number(input) === sequence.answer) {
      setDone(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - attempt * 100), durationMs }),
        1100
      );
    } else {
      sfx.fail();
      haptics.fail();
      setWrong(true);
      setAttempt((a) => a + 1);
      setTimeout(() => setWrong(false), 600);
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🧮 Un calcul défile, opération par opération — <strong>tout de tête</strong>, interdit de
        noter (enfin, on ne dira rien 🏴‍☠️). Donne le résultat final !
      </p>

      <div
        className={`rounded-xl border-[3px] border-ink bg-ink text-center py-8 px-3 min-h-28 flex items-center justify-center ${
          wrong ? "animate-shake" : ""
        }`}
      >
        {done ? (
          <span className="font-display text-3xl text-leaf">🏆 CALCUL EXACT !</span>
        ) : phase === "idle" ? (
          <Button size="lg" onClick={start}>
            ▶️ LANCER LE CALCUL
          </Button>
        ) : phase === "show" ? (
          <span
            key={itemIndex}
            className="font-display text-6xl text-gold"
            style={{ animation: "cascade-pop 0.4s cubic-bezier(0.2, 1.8, 0.4, 1)" }}
          >
            {sequence.items[Math.min(itemIndex, sequence.items.length - 1)]}
          </span>
        ) : (
          <div>
            <span className="font-display text-2xl text-parchment/60 block mb-1">= ?</span>
            <span
              className={`font-mono font-bold text-4xl tracking-widest ${
                wrong ? "text-crimson" : "text-parchment"
              }`}
            >
              {input || "··"}
            </span>
          </div>
        )}
        <style>{`@keyframes cascade-pop { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }`}</style>
      </div>

      {phase === "input" && !done && (
        <>
          <NumPad
            onDigit={(d) => input.length < 2 && setInput((v) => v + d)}
            onDelete={() => setInput((v) => v.slice(0, -1))}
            onSubmit={submit}
            submitDisabled={!input}
          />
          <button
            className="w-full text-center font-bold text-ink/60 underline"
            onClick={start}
          >
            🔁 Revoir le calcul (ça compte comme un essai raté !)
          </button>
        </>
      )}
      {attempt > 0 && !done && (
        <p className="text-center text-sm font-bold text-crimson">
          {attempt} essai{attempt > 1 ? "s" : ""} raté{attempt > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

function CascadeEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as CascadeConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Nombre d&apos;opérations</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "4 — 🟢", v: 4 },
            { label: "6 — 🟡", v: 6 },
            { label: "8 — 🔴", v: 8 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, steps: o.v })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.steps ?? 5) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Label>Vitesse de défilement</Label>
        <div className="flex gap-2">
          {[
            { label: "Lente", v: 2600 },
            { label: "Normale", v: 2000 },
            { label: "Rapide", v: 1300 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, speed_ms: o.v })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                (cfg.speed_ms ?? 2000) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Calcul généré pour chaque équipe (résultat toujours entre 0 et 99).
      </p>
    </div>
  );
}

export const cascadeDef: MiniGameDef = {
  kind: "cascade",
  name: "Calcul en cascade",
  icon: "🧮",
  description: "Suivre un calcul mental qui défile opération par opération",
  needsAnswer: false,
  defaultConfig: { steps: 5, speed_ms: 2000 },
  Component: CascadeGame,
  ConfigEditor: CascadeEditor,
};
