"use client";

import { useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Input, Label, TextArea } from "@/components/ui/Input";

interface LockConfig {
  digits: number;
  clues: string[];
}

function LockGame({ config, onComplete }: MiniGameProps) {
  const cfg = config as unknown as LockConfig;
  const digits = Math.min(6, Math.max(3, cfg.digits || 4));
  const [wheels, setWheels] = useState<number[]>(() => Array(digits).fill(0));
  const [attempts, setAttempts] = useState(0);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const startRef = useRef(Date.now());

  function spin(i: number, delta: number) {
    sfx.tick();
    haptics.tap();
    setWheels((w) => w.map((v, j) => (j === i ? (v + delta + 10) % 10 : v)));
  }

  async function tryOpen() {
    setBusy(true);
    const code = wheels.join("");
    const durationMs = Date.now() - startRef.current;
    const accepted = await onComplete({
      score: Math.max(100, 1000 - attempts * 40),
      durationMs,
      answer: code,
    });
    setBusy(false);
    if (!accepted) {
      setAttempts((a) => a + 1);
      setWrong(true);
      sfx.fail();
      haptics.fail();
      setTimeout(() => setWrong(false), 600);
    }
  }

  return (
    <div className="space-y-5">
      <p className="font-bold text-ink/70">
        Trouve la combinaison grâce aux indices ! 🔓
      </p>

      {(cfg.clues || []).length > 0 && (
        <ul className="parchment-texture rounded-xl border-[3px] border-ink p-4 space-y-1.5">
          {(cfg.clues || []).map((clue, i) => (
            <li key={i} className="font-bold text-ink/85">
              🔎 {clue}
            </li>
          ))}
        </ul>
      )}

      <div className={`flex justify-center gap-2 ${wrong ? "animate-shake" : ""}`}>
        {wheels.map((v, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => spin(i, 1)}
              aria-label={`Chiffre ${i + 1} plus`}
              className="w-12 h-9 rounded-t-xl bg-gold border-[3px] border-ink font-display shadow-[2px_2px_0_0_#111111] active:translate-y-[1px]"
            >
              ▲
            </button>
            <div
              className={`w-12 h-14 rounded-lg border-[3px] border-ink flex items-center justify-center font-display text-3xl ${
                wrong ? "bg-crimson text-parchment" : "bg-ink text-gold"
              }`}
            >
              {v}
            </div>
            <button
              onClick={() => spin(i, -1)}
              aria-label={`Chiffre ${i + 1} moins`}
              className="w-12 h-9 rounded-b-xl bg-gold border-[3px] border-ink font-display shadow-[2px_2px_0_0_#111111] active:translate-y-[1px]"
            >
              ▼
            </button>
          </div>
        ))}
      </div>

      <Button full size="lg" onClick={tryOpen} disabled={busy}>
        {busy ? "…" : "🔓 OUVRIR LE CADENAS"}
      </Button>
      {attempts > 0 && (
        <p className="text-center text-sm font-bold text-crimson">
          {attempts} tentative{attempts > 1 ? "s" : ""} ratée{attempts > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

function LockEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as LockConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Nombre de chiffres (3–6)</Label>
        <Input
          type="number"
          min={3}
          max={6}
          value={cfg.digits ?? 4}
          onChange={(e) => onChange({ ...value, digits: Number(e.target.value) || 4 })}
        />
      </div>
      <div>
        <Label>Indices affichés (un par ligne)</Label>
        <TextArea
          rows={3}
          defaultValue={(cfg.clues || []).join("\n")}
          onChange={(e) =>
            onChange({ ...value, clues: e.target.value.split("\n").map((c) => c.trim()).filter(Boolean) })
          }
          placeholder={"Le 1er chiffre est le nombre de fontaines sur la place\nLe dernier est pair…"}
        />
      </div>
      <p className="text-sm font-bold text-leaf">
        💡 Le code exact se règle dans « Réponses acceptées » ci-dessous (ex. : 4726) —
        il est vérifié côté serveur, introuvable en trichant.
      </p>
    </div>
  );
}

export const lockDef: MiniGameDef = {
  kind: "lock",
  name: "Cadenas",
  icon: "🔓",
  description: "Combinaison à trouver via des indices",
  needsAnswer: true,
  answerLabel: "Code du cadenas (chiffres)",
  defaultConfig: { digits: 4, clues: [] },
  Component: LockGame,
  ConfigEditor: LockEditor,
};
