"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";
import NumPad from "./NumPad";

interface FlashCodeConfig {
  rounds: number;
}

function FlashCodeGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as FlashCodeConfig;
  const rounds = Math.min(7, Math.max(3, cfg.rounds || 5));

  const [round, setRound] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<"show" | "input">("show");
  const [input, setInput] = useState("");
  const [wrong, setWrong] = useState(false);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());

  const length = 3 + round; // 4 → 10 chiffres
  const code = useMemo(() => {
    const rand = rngFromSeed(`flash:${seed}:${round}:${attempt}`);
    return Array.from({ length }, () => seededInt(rand, 10)).join("");
  }, [seed, round, attempt, length]);

  const showMs = 650 * length;

  useEffect(() => {
    if (phase !== "show" || done) return;
    setInput("");
    const t = setTimeout(() => setPhase("input"), showMs);
    return () => clearTimeout(t);
  }, [phase, code, showMs, done]);

  function submit() {
    if (input.length === 0 || done) return;
    if (input === code) {
      if (round >= rounds) {
        setDone(true);
        sfx.success();
        haptics.success();
        const durationMs = Date.now() - startRef.current;
        setTimeout(
          () => onComplete({ score: Math.max(100, 1000 - attempt * 50), durationMs }),
          1100
        );
      } else {
        sfx.pop();
        haptics.scan();
        setRound((r) => r + 1);
        setPhase("show");
      }
    } else {
      sfx.fail();
      haptics.fail();
      setWrong(true);
      setTimeout(() => {
        setWrong(false);
        setAttempt((a) => a + 1); // nouveau code, même longueur
        setPhase("show");
      }, 700);
    }
  }

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        ⚡ Un code s&apos;affiche quelques secondes… mémorise-le et retape-le ! Les codes
        s&apos;allongent à chaque manche.
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>
          Manche {Math.min(round, rounds)}/{rounds} · {length} chiffres
        </span>
        {attempt > 0 && <span className="text-crimson">{attempt} raté{attempt > 1 ? "s" : ""}</span>}
      </div>

      {/* Zone d'affichage */}
      <div
        className={`rounded-xl border-[3px] border-ink bg-ink text-center py-6 px-3 ${
          wrong ? "animate-shake" : ""
        }`}
      >
        {done ? (
          <span className="font-display text-3xl text-leaf">🏆 MÉMOIRE D&apos;ACIER !</span>
        ) : phase === "show" ? (
          <>
            <span className="font-mono font-bold text-3xl tracking-[0.25em] text-gold break-all">
              {code}
            </span>
            <div className="mt-3 h-2 rounded-full bg-ink-soft overflow-hidden mx-4">
              <div
                key={`${round}-${attempt}`}
                className="h-full bg-gold"
                style={{ animation: `flash-shrink ${showMs}ms linear forwards` }}
              />
            </div>
            <style>{`@keyframes flash-shrink { from { width: 100%; } to { width: 0%; } }`}</style>
          </>
        ) : (
          <span
            className={`font-mono font-bold text-3xl tracking-[0.25em] break-all ${
              wrong ? "text-crimson" : "text-parchment"
            }`}
          >
            {input || "· · ·"}
          </span>
        )}
      </div>

      {phase === "input" && !done && (
        <NumPad
          onDigit={(d) => input.length < length && setInput((v) => v + d)}
          onDelete={() => setInput((v) => v.slice(0, -1))}
          onSubmit={submit}
          submitDisabled={input.length === 0}
        />
      )}
    </div>
  );
}

function FlashCodeEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as FlashCodeConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Nombre de manches</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "3 — 🟢 (codes de 4 à 6)", v: 3 },
            { label: "5 — 🟡 (jusqu'à 8)", v: 5 },
            { label: "7 — 🔴 (jusqu'à 10 !)", v: 7 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, rounds: o.v })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.rounds ?? 5) === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Codes générés pour chaque équipe — rien d&apos;autre à configurer.
      </p>
    </div>
  );
}

export const flashcodeDef: MiniGameDef = {
  kind: "flashcode",
  name: "Code éclair",
  icon: "⚡",
  description: "Mémoriser des codes de plus en plus longs",
  needsAnswer: false,
  defaultConfig: { rounds: 5 },
  Component: FlashCodeGame,
  ConfigEditor: FlashCodeEditor,
};
