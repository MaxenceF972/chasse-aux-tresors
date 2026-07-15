"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { normalizeAnswer } from "@/lib/game/normalize";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Input, Label, TextArea } from "@/components/ui/Input";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function caesarShift(text: string, shift: number): string {
  return text
    .toUpperCase()
    .split("")
    .map((c) => {
      const i = A.indexOf(c);
      return i === -1 ? c : A[(i + shift + 26 * 10) % 26];
    })
    .join("");
}

type CaesarMode = "preview" | "wheel" | "expert";

interface CaesarConfig {
  ciphertext: string;
  shift: number;
  mode?: CaesarMode;
}

const MODE_META: Record<CaesarMode, { label: string; help: string }> = {
  preview: {
    label: "Facile",
    help: "Le texte se déchiffre en direct quand on tourne la roue — rapide.",
  },
  wheel: {
    label: "Normal",
    help: "Roue de correspondance des lettres : il faut trouver le bon décalage ET décoder le message à la main, lettre par lettre.",
  },
  expert: {
    label: "Expert",
    help: "Aucune aide — juste le message chiffré. Pour les équipes de cryptographes !",
  },
};

/** Roue de correspondance : lettre chiffrée (haut) → lettre en clair (bas). */
function AlphabetWheel({ offset }: { offset: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-y-2">
      {A.split("").map((cipher, i) => (
        <div
          key={cipher}
          className="flex flex-col items-center w-[3.05rem] border-r last:border-r-0 border-ink/10"
        >
          <span className="font-mono font-bold text-lg text-crimson leading-tight">{cipher}</span>
          <span className="text-[10px] leading-none text-ink/40">↓</span>
          <span className="font-mono font-bold text-lg text-leaf leading-tight">
            {A[(i - offset + 26 * 10) % 26]}
          </span>
        </div>
      ))}
    </div>
  );
}

function CaesarGame({ config, onComplete }: MiniGameProps) {
  const cfg = config as unknown as CaesarConfig;
  const mode: CaesarMode = cfg.mode ?? "wheel";
  const [wheel, setWheel] = useState(0);
  const [input, setInput] = useState("");
  const [wrong, setWrong] = useState(false);
  const startRef = useRef(Date.now());

  const plaintext = useMemo(
    () => caesarShift(cfg.ciphertext || "", -(cfg.shift || 0)),
    [cfg.ciphertext, cfg.shift]
  );
  const preview = useMemo(
    () => caesarShift(cfg.ciphertext || "", -wheel),
    [cfg.ciphertext, wheel]
  );

  async function submit() {
    if (normalizeAnswer(input) === normalizeAnswer(plaintext) && normalizeAnswer(input) !== "") {
      const durationMs = Date.now() - startRef.current;
      await onComplete({
        score: Math.max(100, 1000 - Math.floor(durationMs / 1000) * 5),
        durationMs,
        answer: input,
      });
    } else {
      setWrong(true);
      sfx.fail();
      haptics.fail();
      setTimeout(() => setWrong(false), 600);
    }
  }

  return (
    <div className="space-y-5">
      <p className="font-bold text-ink/70">
        Un message intercepté… mais il est chiffré !{" "}
        {mode === "expert"
          ? "César n'a laissé aucun indice. 🔐"
          : mode === "wheel"
            ? "Trouve le bon décalage avec la roue, puis décode-le lettre par lettre. 🔐"
            : "Tourne la roue pour le décoder. 🔐"}
      </p>

      <div className="parchment-texture rounded-xl border-[3px] border-ink p-4 font-mono text-lg font-bold tracking-widest break-words text-center">
        {cfg.ciphertext}
      </div>

      {/* Roue de déchiffrement (masquée en expert) */}
      {mode !== "expert" && (
        <>
          <div className="flex items-center justify-center gap-4">
            <Button
              size="md"
              variant="crimson"
              onClick={() => {
                setWheel((w) => (w + 25) % 26);
                sfx.tick();
              }}
              aria-label="Décalage -1"
            >
              ◀
            </Button>
            <div className="text-center">
              <div className="font-display text-3xl">{wheel}</div>
              <div className="text-xs font-bold uppercase tracking-wider text-ink/60">décalage</div>
            </div>
            <Button
              size="md"
              variant="crimson"
              onClick={() => {
                setWheel((w) => (w + 1) % 26);
                sfx.tick();
              }}
              aria-label="Décalage +1"
            >
              ▶
            </Button>
          </div>

          {mode === "wheel" ? (
            <div className="rounded-xl border-[3px] border-dashed border-ink/30 p-2.5">
              <p className="text-center text-xs font-bold uppercase tracking-wider text-ink/50 mb-1.5">
                <span className="text-crimson">chiffré</span> → <span className="text-leaf">clair</span>
              </p>
              <AlphabetWheel offset={wheel} />
            </div>
          ) : (
            <div
              className={`rounded-xl border-[3px] border-dashed p-4 font-mono text-lg font-bold tracking-widest break-words text-center transition-colors ${
                wheel !== 0 ? "border-leaf text-leaf bg-leaf/10" : "border-ink/30 text-ink/40"
              }`}
            >
              {wheel === 0 ? "— tourne la roue —" : preview}
            </div>
          )}
        </>
      )}

      <div className={wrong ? "animate-shake" : ""}>
        <Label>Le message en clair</Label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écris le message décodé…"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
          />
          <Button onClick={submit} disabled={!input.trim()}>
            OK
          </Button>
        </div>
        {wrong && (
          <p className="text-crimson font-bold text-sm mt-1.5">
            Raté ! Vérifie ton décodage… 🧐
          </p>
        )}
      </div>
    </div>
  );
}

function CaesarEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as CaesarConfig;
  const shift = cfg.shift ?? 3;
  const mode: CaesarMode = cfg.mode ?? "wheel";
  const plaintext = caesarShift(cfg.ciphertext || "", -shift);

  function update(patch: Partial<{ plain: string; shift: number; mode: CaesarMode }>) {
    const newPlain = patch.plain ?? plaintext;
    const newShift = patch.shift ?? shift;
    onChange({
      ciphertext: caesarShift(newPlain, newShift),
      shift: newShift,
      mode: patch.mode ?? mode,
    });
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Message secret (en clair)</Label>
        <TextArea
          rows={2}
          defaultValue={plaintext}
          onChange={(e) => update({ plain: e.target.value })}
          placeholder="LE TRESOR EST SOUS LE CHENE"
        />
      </div>
      <div>
        <Label>Décalage (1–25)</Label>
        <Input
          type="number"
          min={1}
          max={25}
          value={shift}
          onChange={(e) => update({ shift: Math.min(25, Math.max(1, Number(e.target.value) || 1)) })}
        />
      </div>
      <div>
        <Label>Difficulté</Label>
        <div className="space-y-2">
          {(Object.keys(MODE_META) as CaesarMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => update({ mode: m })}
              className={`w-full p-2.5 rounded-xl border-[3px] border-ink text-left ${
                mode === m ? "bg-gold" : "bg-white"
              }`}
            >
              <span className="font-display">{MODE_META[m].label}</span>
              <span className="block text-xs font-bold text-ink/60">{MODE_META[m].help}</span>
            </button>
          ))}
        </div>
      </div>
      {cfg.ciphertext && (
        <p className="text-sm font-bold text-ink/60">
          Les joueurs verront : <span className="font-mono">{cfg.ciphertext}</span>
        </p>
      )}
      <p className="text-sm font-bold text-leaf">
        💡 Ajoute aussi le message en clair dans « Réponses acceptées » ci-dessous : la
        validation finale est vérifiée côté serveur.
      </p>
    </div>
  );
}

export const caesarDef: MiniGameDef = {
  kind: "caesar",
  name: "Code César",
  icon: "🔐",
  description: "Déchiffrer un message codé avec la roue de César",
  needsAnswer: true,
  answerLabel: "Message déchiffré attendu",
  defaultConfig: { ciphertext: "", shift: 3, mode: "wheel" },
  Component: CaesarGame,
  ConfigEditor: CaesarEditor,
};
