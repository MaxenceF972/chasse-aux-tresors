"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { tone, sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Input, Label, TextArea } from "@/components/ui/Input";

const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export function encodeMorse(text: string): string {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word
        .split("")
        .map((c) => MORSE[c] ?? "")
        .filter(Boolean)
        .join(" ")
    )
    .join(" / ");
}

export function decodeMorse(pattern: string): string {
  return (pattern || "")
    .split("/")
    .map((word) =>
      word
        .trim()
        .split(" ")
        .filter(Boolean)
        .map((code) => MORSE_REVERSE[code] ?? "?")
        .join("")
    )
    .join(" ");
}

interface MorseConfig {
  pattern: string;
  unit_ms: number;
  show_chart: boolean;
}

/** Découpe le pattern en segments lumière allumée / éteinte. */
function patternToSegments(pattern: string, unit: number): { on: boolean; ms: number }[] {
  const segments: { on: boolean; ms: number }[] = [];
  const words = pattern.split("/").map((w) => w.trim()).filter(Boolean);
  words.forEach((word, wi) => {
    const letters = word.split(" ").filter(Boolean);
    letters.forEach((letter, li) => {
      letter.split("").forEach((symbol, si) => {
        segments.push({ on: true, ms: symbol === "-" ? unit * 3 : unit });
        if (si < letter.length - 1) segments.push({ on: false, ms: unit });
      });
      if (li < letters.length - 1) segments.push({ on: false, ms: unit * 3 });
    });
    if (wi < words.length - 1) segments.push({ on: false, ms: unit * 7 });
  });
  return segments;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function MorseGame({ config, onComplete }: MiniGameProps) {
  const cfg = config as unknown as MorseConfig;
  const unit = Math.max(60, cfg.unit_ms || 140);
  const [flash, setFlash] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [input, setInput] = useState("");
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  async function play() {
    if (playing) return;
    setPlaying(true);
    cancelRef.current = false;
    const segments = patternToSegments(cfg.pattern || "", unit);
    for (const seg of segments) {
      if (cancelRef.current) break;
      setFlash(seg.on);
      if (seg.on) tone(620, (seg.ms / 1000) * 0.9, "sine", 0.15);
      await sleep(seg.ms);
    }
    setFlash(false);
    setPlaying(false);
  }

  async function submit() {
    if (!input.trim() || busy) return;
    setBusy(true);
    const durationMs = Date.now() - startRef.current;
    const accepted = await onComplete({
      score: Math.max(100, 1000 - Math.floor(durationMs / 1000) * 4),
      durationMs,
      answer: input.trim(),
    });
    setBusy(false);
    if (!accepted) {
      setWrong(true);
      sfx.fail();
      haptics.fail();
      setTimeout(() => setWrong(false), 600);
    }
  }

  return (
    <div className="space-y-5">
      <p className="font-bold text-ink/70">
        Un signal lumineux au loin… Transcris le message en morse ! 🔦
        <br />
        <span className="text-sm text-ink/50">
          Signal court = point (·), signal long = trait (–), longue pause = nouveau mot.
        </span>
      </p>

      {/* La lampe */}
      <div className="flex flex-col items-center gap-4">
        <div
          className={`w-40 h-40 rounded-full border-[5px] border-ink transition-all duration-75 ${
            flash
              ? "bg-gold shadow-[0_0_60px_18px_rgba(245,166,35,0.75)]"
              : "bg-ink-soft shadow-inner"
          }`}
          aria-label={flash ? "Signal allumé" : "Signal éteint"}
        />
        <Button size="lg" onClick={play} disabled={playing}>
          {playing ? "📡 SIGNAL EN COURS…" : "▶️ (RE)JOUER LE SIGNAL"}
        </Button>
      </div>

      {/* Alphabet morse */}
      {cfg.show_chart !== false && (
        <div>
          <button
            className="font-bold text-ink/60 underline"
            onClick={() => setChartOpen((o) => !o)}
          >
            {chartOpen ? "Masquer" : "Afficher"} l&apos;alphabet morse
          </button>
          {chartOpen && (
            <div className="mt-2 grid grid-cols-4 gap-x-3 gap-y-1 rounded-xl border-[3px] border-ink/20 p-3 font-mono font-bold text-sm">
              {Object.entries(MORSE).map(([letter, code]) => (
                <span key={letter}>
                  <span className="text-crimson">{letter}</span>{" "}
                  <span className="text-ink/70">{code}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className={wrong ? "animate-shake" : ""}>
        <Label>Le message reçu</Label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Écris le message décodé…"
            autoCapitalize="characters"
            autoComplete="off"
          />
          <Button onClick={submit} disabled={!input.trim() || busy}>
            OK
          </Button>
        </div>
        {wrong && (
          <p className="text-crimson font-bold text-sm mt-1.5">Raté ! Réécoute le signal… 📻</p>
        )}
      </div>
    </div>
  );
}

function MorseEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as MorseConfig;
  const message = decodeMorse(cfg.pattern || "");

  return (
    <div className="space-y-3">
      <div>
        <Label>Message à transmettre (lettres et chiffres)</Label>
        <TextArea
          rows={2}
          defaultValue={message}
          onChange={(e) => onChange({ ...value, pattern: encodeMorse(e.target.value) })}
          placeholder="CHERCHEZ LE PUITS"
        />
        {cfg.pattern && (
          <p className="text-sm font-bold text-ink/60 mt-1 font-mono break-words">
            Signal : {cfg.pattern}
          </p>
        )}
      </div>
      <div>
        <Label>Vitesse du signal</Label>
        <div className="flex gap-2">
          {[
            { label: "Lente", v: 220 },
            { label: "Normale", v: 140 },
            { label: "Rapide", v: 90 },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, unit_ms: o.v })}
              className={`px-4 h-11 rounded-xl border-[3px] border-ink font-display ${
                (cfg.unit_ms ?? 140) === o.v ? "bg-gold" : "bg-white"
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
          checked={cfg.show_chart !== false}
          onChange={(e) => onChange({ ...value, show_chart: e.target.checked })}
        />
        Alphabet morse consultable par les joueurs (décoché = expert)
      </label>
      <p className="text-sm font-bold text-leaf">
        💡 Ajoute aussi le message en clair dans « Réponses acceptées » ci-dessous.
      </p>
    </div>
  );
}

export const morseDef: MiniGameDef = {
  kind: "morse",
  name: "Morse",
  icon: "🔦",
  description: "Signal lumineux et sonore à transcrire",
  needsAnswer: true,
  answerLabel: "Message morse attendu",
  defaultConfig: { pattern: "", unit_ms: 140, show_chart: true },
  Component: MorseGame,
  ConfigEditor: MorseEditor,
};
