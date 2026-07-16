"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const PHRASES = [
  "LE TRESOR EST ENTERRE SOUS LE VIEUX CHENE DU PORT",
  "QUI CHERCHE LA CARTE TROUVE LE CHEMIN DU BUTIN",
  "LES PIRATES NE CRAIGNENT QUE LE SILENCE DE LA MER",
  "LA CLE DU COFFRE DORT DANS LA POCHE DU CAPITAINE",
  "SEULS LES BRAVES OSENT REGARDER LE PHARE LA NUIT",
  "CENT PAS VERS LE NORD PUIS TROIS PAS VERS LA MER",
  "LA VIGIE A CACHE LA CARTE DERRIERE LE TONNEAU",
  "Sous le sable noir dort la flotte du roi perdu".toUpperCase(),
];

/** Substitution complète sans point fixe (aucune lettre chiffrée en elle-même). */
function buildCipher(seedKey: string): Record<string, string> {
  const letters = A.split("");
  let shuffled = letters;
  const rand = rngFromSeed(seedKey);
  for (let attempt = 0; attempt < 50; attempt++) {
    shuffled = seededShuffle(letters, rand);
    if (shuffled.every((ch, i) => ch !== letters[i])) break;
  }
  const map: Record<string, string> = {};
  letters.forEach((plain, i) => {
    map[plain] = shuffled[i];
  });
  return map;
}

interface CryptoConfig {
  difficulty?: "normal" | "expert";
}

function CryptoGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as CryptoConfig;
  const expert = cfg.difficulty === "expert";

  const { plain, cipherOf, plainOf, cipherText, usedCipherLetters, freq } = useMemo(() => {
    const rand = rngFromSeed(`crypto:${seed}`);
    const plain = PHRASES[seededInt(rand, PHRASES.length)];
    const cipherOf = buildCipher(`crypto-map:${seed}`);
    const plainOf: Record<string, string> = {};
    for (const [p, c] of Object.entries(cipherOf)) plainOf[c] = p;
    const cipherText = plain
      .split("")
      .map((ch) => (A.includes(ch) ? cipherOf[ch] : ch))
      .join("");
    const used = new Set(cipherText.split("").filter((ch) => A.includes(ch)));
    const freq: Record<string, number> = {};
    for (const ch of cipherText) {
      if (A.includes(ch)) freq[ch] = (freq[ch] ?? 0) + 1;
    }
    return { plain, cipherOf, plainOf, cipherText, usedCipherLetters: used, freq };
  }, [seed]);

  // En mode normal, la lettre la plus fréquente est offerte au départ
  const initialMapping = useMemo(() => {
    if (expert) return {};
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    return top ? { [top]: plainOf[top] } : {};
  }, [expert, freq, plainOf]);

  const [mapping, setMapping] = useState<Record<string, string>>(initialMapping);
  const [selected, setSelected] = useState<string | null>(null);
  const [reveals, setReveals] = useState(0);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  function checkWin(m: Record<string, string>) {
    const complete = [...usedCipherLetters].every((c) => m[c] === plainOf[c]);
    if (complete) {
      setWon(true);
      setSelected(null);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - reveals * 150), durationMs }),
        1500
      );
    }
  }

  function assign(plainLetter: string) {
    if (!selected || won) return;
    sfx.tick();
    haptics.tap();
    setMapping((m) => {
      const next = { ...m };
      // une lettre claire ne peut décoder qu'une seule lettre chiffrée
      for (const k of Object.keys(next)) {
        if (next[k] === plainLetter) delete next[k];
      }
      next[selected] = plainLetter;
      checkWin(next);
      return next;
    });
  }

  function clearSelected() {
    if (!selected) return;
    setMapping((m) => {
      const next = { ...m };
      delete next[selected];
      return next;
    });
  }

  function reveal() {
    if (reveals >= 3 || won) return;
    const wrongOrMissing = [...usedCipherLetters].filter((c) => mapping[c] !== plainOf[c]);
    if (!wrongOrMissing.length) return;
    const rand = rngFromSeed(`crypto-reveal:${seed}:${reveals}`);
    const target = wrongOrMissing[seededInt(rand, wrongOrMissing.length)];
    sfx.pop();
    setReveals((r) => r + 1);
    setMapping((m) => {
      const next = { ...m };
      for (const k of Object.keys(next)) {
        if (next[k] === plainOf[target]) delete next[k];
      }
      next[target] = plainOf[target];
      checkWin(next);
      return next;
    });
    setSelected(target);
  }

  const usedPlains = new Set(Object.values(mapping));
  const words = cipherText.split(" ");

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🔤 Chaque lettre a été remplacée par une autre (toujours la même). Touche une lettre
        chiffrée, puis sa traduction. Astuce : commence par les mots courts (LE, LA, DU…) !
      </p>

      {/* Le message chiffré */}
      <div className={`parchment-texture rounded-xl border-[3px] border-ink p-3 flex flex-wrap gap-x-3 gap-y-2 ${won ? "border-leaf" : ""}`}>
        {words.map((word, wi) => (
          <span key={wi} className="flex gap-[3px]">
            {word.split("").map((ch, i) => {
              if (!A.includes(ch)) {
                return (
                  <span key={i} className="font-bold text-ink/60 self-end">
                    {ch}
                  </span>
                );
              }
              const guess = mapping[ch];
              const isSelected = selected === ch;
              return (
                <button
                  key={i}
                  onClick={() => setSelected(isSelected ? null : ch)}
                  className={`flex flex-col items-center w-[1.15rem] rounded-sm ${
                    isSelected ? "bg-gold/60 ring-2 ring-gold" : ""
                  }`}
                >
                  <span className="font-mono text-[10px] leading-none text-crimson">{ch}</span>
                  <span
                    className={`font-mono font-bold text-base leading-tight ${
                      won ? "text-leaf" : guess ? "text-ink" : "text-ink/25"
                    }`}
                  >
                    {won ? plainOf[ch] : guess ?? "·"}
                  </span>
                </button>
              );
            })}
          </span>
        ))}
      </div>

      {won ? (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          📜 MESSAGE DÉCHIFFRÉ !
        </p>
      ) : (
        <>
          {/* Fréquences pour aider l'analyse */}
          <details className="font-bold text-sm text-ink/60">
            <summary className="cursor-pointer underline">📊 Fréquence des lettres chiffrées</summary>
            <p className="mt-1 font-mono text-xs leading-relaxed">
              {Object.entries(freq)
                .sort((a, b) => b[1] - a[1])
                .map(([ch, n]) => `${ch}:${n}`)
                .join("  ")}
              <br />
              (en français : E, A, S, I, T, N sont les plus courantes)
            </p>
          </details>

          {/* Clavier de traduction */}
          <div className={selected ? "" : "opacity-40 pointer-events-none"}>
            <p className="font-bold text-sm text-ink/60 mb-1.5">
              {selected ? (
                <>
                  <span className="font-mono text-crimson">{selected}</span> se traduit par…
                </>
              ) : (
                "Touche d'abord une lettre chiffrée ↑"
              )}
            </p>
            <div className="grid grid-cols-7 gap-1.5">
              {A.split("").map((plainLetter) => (
                <button
                  key={plainLetter}
                  onClick={() => assign(plainLetter)}
                  className={`h-10 rounded-lg border-2 border-ink font-mono font-bold ${
                    usedPlains.has(plainLetter) ? "bg-ink/15 text-ink/35" : "bg-white text-ink"
                  }`}
                >
                  {plainLetter}
                </button>
              ))}
              <button
                onClick={clearSelected}
                className="h-10 rounded-lg border-2 border-ink bg-crimson text-parchment font-bold col-span-2"
              >
                ⌫ effacer
              </button>
            </div>
          </div>

          <button
            onClick={reveal}
            disabled={reveals >= 3}
            className="w-full text-center font-bold text-ink/60 underline disabled:opacity-40"
          >
            💡 Révéler une lettre ({3 - reveals} restante{3 - reveals > 1 ? "s" : ""}, coûte des points)
          </button>
        </>
      )}
    </div>
  );
}

function CryptoEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as CryptoConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2">
          {[
            { v: "normal", label: "🟡 Normal", help: "la lettre la plus fréquente est donnée" },
            { v: "expert", label: "🔴 Expert", help: "aucune aide au départ" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, difficulty: o.v })}
              className={`flex-1 p-2 rounded-xl border-[3px] border-ink text-left ${
                (cfg.difficulty ?? "normal") === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              <span className="font-display text-sm">{o.label}</span>
              <span className="block text-xs font-bold text-ink/60">{o.help}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Phrase et code de substitution générés pour chaque équipe. 3 « révélations » possibles
        (avec malus de score). Prévois 10 à 20 minutes !
      </p>
    </div>
  );
}

export const cryptoDef: MiniGameDef = {
  kind: "crypto",
  name: "Cryptogramme",
  icon: "🔤",
  description: "Casser un code à substitution complète, lettre par lettre",
  needsAnswer: false,
  defaultConfig: { difficulty: "normal" },
  Component: CryptoGame,
  ConfigEditor: CryptoEditor,
};
