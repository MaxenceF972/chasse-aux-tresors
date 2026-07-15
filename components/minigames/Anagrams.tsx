"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededShuffle } from "@/lib/game/prng";
import { normalizeAnswer } from "@/lib/game/normalize";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Input, Label, TextArea } from "@/components/ui/Input";

interface AnagramsConfig {
  words: string[];
  time_per_word_sec: number;
}

interface Letter {
  char: string;
  id: number;
}

function scramble(word: string, seedKey: string): Letter[] {
  const letters = word
    .toUpperCase()
    .replace(/\s+/g, "")
    .split("")
    .map((char, id) => ({ char, id }));
  let out = seededShuffle(letters, rngFromSeed(seedKey));
  // Évite de présenter le mot déjà dans l'ordre
  let guard = 0;
  while (out.map((l) => l.char).join("") === letters.map((l) => l.char).join("") && guard++ < 10) {
    out = seededShuffle(out, rngFromSeed(seedKey + guard));
  }
  return out;
}

function AnagramsGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as AnagramsConfig;
  const words = useMemo(() => (cfg.words || []).filter((w) => w.trim().length > 1), [cfg.words]);
  const timePerWord = Math.max(10, cfg.time_per_word_sec || 30);

  const [wordIndex, setWordIndex] = useState(0);
  const [retries, setRetries] = useState(0);
  const [picked, setPicked] = useState<Letter[]>([]);
  const [timeLeft, setTimeLeft] = useState(timePerWord);
  const [wrong, setWrong] = useState(false);
  const [done, setDone] = useState(false);
  const startRef = useRef(Date.now());

  const word = words[wordIndex] ?? "";
  const pool = useMemo(
    () => scramble(word, `${seed}:${wordIndex}:${retries}`),
    [word, seed, wordIndex, retries]
  );
  const remaining = pool.filter((l) => !picked.some((p) => p.id === l.id));

  // Chrono du mot courant
  useEffect(() => {
    if (done || !word) return;
    setTimeLeft(timePerWord);
    const t = setInterval(() => {
      setTimeLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          sfx.fail();
          haptics.fail();
          setRetries((r) => r + 1);
          setPicked([]);
          return timePerWord;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [wordIndex, retries, timePerWord, done, word]);

  // Vérification automatique quand toutes les lettres sont posées
  useEffect(() => {
    if (!word || picked.length !== pool.length || pool.length === 0) return;
    const guess = picked.map((l) => l.char).join("");
    if (normalizeAnswer(guess) === normalizeAnswer(word)) {
      sfx.pop();
      haptics.scan();
      if (wordIndex + 1 >= words.length) {
        setDone(true);
        sfx.success();
        const durationMs = Date.now() - startRef.current;
        setTimeout(
          () => onComplete({ score: Math.max(100, 1000 - retries * 60), durationMs }),
          900
        );
      } else {
        setTimeout(() => {
          setWordIndex((i) => i + 1);
          setPicked([]);
        }, 500);
      }
    } else {
      setWrong(true);
      sfx.fail();
      haptics.fail();
      setTimeout(() => {
        setWrong(false);
        setPicked([]);
      }, 550);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);

  if (!words.length) {
    return <p className="font-bold text-crimson">Aucun mot configuré pour ce jeu.</p>;
  }

  const timePct = (timeLeft / timePerWord) * 100;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between font-bold text-ink/70">
        <span>Remets les lettres dans l&apos;ordre ! 🔤</span>
        <span className="tabular-nums">
          Mot {Math.min(wordIndex + 1, words.length)}/{words.length}
        </span>
      </div>

      {/* Barre de temps */}
      <div className="h-4 rounded-full border-[3px] border-ink bg-white overflow-hidden">
        <div
          className={`h-full transition-[width] duration-1000 ease-linear ${
            timePct < 30 ? "bg-crimson" : "bg-gold"
          }`}
          style={{ width: `${timePct}%` }}
        />
      </div>

      {/* Réponse en cours */}
      <div
        className={`min-h-16 flex flex-wrap gap-1.5 items-center justify-center rounded-xl border-[3px] border-dashed p-2 ${
          wrong ? "animate-shake border-crimson bg-crimson/10" : "border-ink/40"
        }`}
      >
        {picked.length === 0 && (
          <span className="text-ink/30 font-bold">Touche les lettres…</span>
        )}
        {picked.map((l) => (
          <button
            key={l.id}
            onClick={() => setPicked((p) => p.filter((x) => x.id !== l.id))}
            className="w-10 h-12 rounded-lg bg-leaf text-parchment font-display text-xl border-[3px] border-ink shadow-[2px_2px_0_0_#111111]"
          >
            {l.char}
          </button>
        ))}
      </div>

      {/* Lettres disponibles */}
      <div className="flex flex-wrap gap-1.5 items-center justify-center">
        {remaining.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              sfx.tick();
              setPicked((p) => [...p, l]);
            }}
            className="w-11 h-13 rounded-lg bg-parchment font-display text-2xl text-ink border-[3px] border-ink shadow-[3px_3px_0_0_#111111] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#111111]"
          >
            {l.char}
          </button>
        ))}
      </div>

      {done && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 TOUS LES MOTS TROUVÉS !
        </p>
      )}
    </div>
  );
}

function AnagramsEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as AnagramsConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Mots à deviner (un par ligne)</Label>
        <TextArea
          rows={4}
          defaultValue={(cfg.words || []).join("\n")}
          onChange={(e) =>
            onChange({ ...value, words: e.target.value.split("\n").map((w) => w.trim()).filter(Boolean) })
          }
          placeholder={"BOUSSOLE\nTRESOR\nPIRATE"}
        />
      </div>
      <div>
        <Label>Temps par mot (secondes)</Label>
        <Input
          type="number"
          min={10}
          max={180}
          value={cfg.time_per_word_sec ?? 30}
          onChange={(e) => onChange({ ...value, time_per_word_sec: Number(e.target.value) || 30 })}
        />
      </div>
    </div>
  );
}

export const anagramsDef: MiniGameDef = {
  kind: "anagrams",
  name: "Anagrammes",
  icon: "🔤",
  description: "Mots mélangés à reconstituer contre la montre",
  needsAnswer: false,
  defaultConfig: { words: [], time_per_word_sec: 30 },
  Component: AnagramsGame,
  ConfigEditor: AnagramsEditor,
};
