"use client";

import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import ImageField from "./ImageField";

interface MemoryConfig {
  image_urls: string[];
}

const DEFAULT_EMOJIS = ["🗺️", "💰", "🧭", "⚓", "🏴‍☠️", "🦜", "🗝️", "💎"];

interface MemoryCard {
  id: number;
  pairKey: string;
  isImage: boolean;
}

function MemoryGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as MemoryConfig;

  const cards = useMemo<MemoryCard[]>(() => {
    const urls = (cfg.image_urls || []).filter(Boolean);
    const faces =
      urls.length >= 2
        ? urls.slice(0, 8).map((u) => ({ key: u, isImage: true }))
        : DEFAULT_EMOJIS.map((e) => ({ key: e, isImage: false }));
    const doubled = faces.flatMap((f, i) => [
      { id: i * 2, pairKey: f.key, isImage: f.isImage },
      { id: i * 2 + 1, pairKey: f.key, isImage: f.isImage },
    ]);
    return seededShuffle(doubled, rngFromSeed(seed));
  }, [cfg.image_urls, seed]);

  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [moves, setMoves] = useState(0);
  const [locked, setLocked] = useState(false);
  const startRef = useRef(Date.now());

  const cols = cards.length <= 12 ? 3 : 4;

  function tap(card: MemoryCard) {
    if (locked || flipped.includes(card.id) || matched.has(card.pairKey)) return;
    sfx.tick();
    haptics.tap();
    const next = [...flipped, card.id];
    setFlipped(next);

    if (next.length === 2) {
      setMoves((m) => m + 1);
      setLocked(true);
      const [a, b] = next.map((id) => cards.find((c) => c.id === id)!);
      if (a.pairKey === b.pairKey) {
        setTimeout(() => {
          sfx.pop();
          const nextMatched = new Set(matched).add(a.pairKey);
          setMatched(nextMatched);
          setFlipped([]);
          setLocked(false);
          if (nextMatched.size === cards.length / 2) {
            sfx.success();
            haptics.success();
            const durationMs = Date.now() - startRef.current;
            setTimeout(
              () => onComplete({ score: Math.max(100, 1000 - moves * 8), durationMs }),
              1000
            );
          }
        }, 450);
      } else {
        setTimeout(() => {
          setFlipped([]);
          setLocked(false);
        }, 850);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between font-bold text-ink/70">
        <span>Retrouve les paires ! 🃏</span>
        <span className="tabular-nums">{moves} coups</span>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {cards.map((card) => {
          const isUp = flipped.includes(card.id) || matched.has(card.pairKey);
          const isMatched = matched.has(card.pairKey);
          return (
            <motion.button
              key={card.id}
              onClick={() => tap(card)}
              className="relative aspect-square rounded-xl border-[3px] border-ink overflow-hidden"
              animate={{ rotateY: isUp ? 180 : 0, opacity: isMatched ? 0.55 : 1 }}
              transition={{ duration: 0.3 }}
              style={{ transformStyle: "preserve-3d" }}
              aria-label="Carte"
            >
              {/* Dos */}
              <div
                className="absolute inset-0 bg-crimson flex items-center justify-center text-2xl"
                style={{ backfaceVisibility: "hidden" }}
              >
                <span className="opacity-70">🧭</span>
              </div>
              {/* Face */}
              <div
                className="absolute inset-0 parchment-texture flex items-center justify-center text-3xl"
                style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
              >
                {card.isImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={card.pairKey} alt="" className="w-full h-full object-cover" />
                ) : (
                  card.pairKey
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function MemoryEditor({ value, onChange, gameId }: ConfigEditorProps) {
  const cfg = value as unknown as MemoryConfig;
  return (
    <div className="space-y-2">
      <ImageField
        label="Images des paires (2 à 8 — sinon emojis pirates par défaut)"
        gameId={gameId}
        urls={cfg.image_urls || []}
        max={8}
        onChange={(urls) => onChange({ ...value, image_urls: urls })}
      />
    </div>
  );
}

export const memoryDef: MiniGameDef = {
  kind: "memory",
  name: "Memory",
  icon: "🃏",
  description: "Paires de cartes à retrouver, images personnalisables",
  needsAnswer: false,
  defaultConfig: { image_urls: [] },
  Component: MemoryGame,
  ConfigEditor: MemoryEditor,
};
