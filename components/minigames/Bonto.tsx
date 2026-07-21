"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { Label } from "@/components/ui/Input";

interface BontoConfig {
  cups: number;      // 3, 4 ou 5 gobelets
  shuffles: number;  // nombre d'échanges
  rounds: number;    // manches à gagner d'affilée
  speed_ms: number;  // vitesse d'un échange
}

interface Swap {
  a: number;
  b: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gobelet cartoon dessiné (identique sur tous les téléphones, contrairement aux emojis). */
function Cup({ grayscale }: { grayscale?: boolean }) {
  return (
    <svg
      viewBox="0 0 80 92"
      className="w-full max-w-[5rem]"
      style={grayscale ? { filter: "grayscale(1)" } : undefined}
      aria-hidden
    >
      {/* corps du gobelet renversé : plus large en bas (le bord posé au sol) */}
      <path
        d="M20 10 L60 10 L70 82 L10 82 Z"
        fill="#C0392B"
        stroke="#111111"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      {/* reflet */}
      <path d="M27 16 L33 16 L26 78 L19 78 Z" fill="#ffffff" opacity="0.18" />
      {/* bandes dorées */}
      <rect x="15" y="66" width="50" height="9" fill="#F5A623" stroke="#111111" strokeWidth="3" />
      <rect x="21" y="12" width="38" height="7" rx="3" fill="#F5A623" stroke="#111111" strokeWidth="3" />
    </svg>
  );
}

/** Pièce d'or cartoon dessinée. */
function Coin() {
  return (
    <svg viewBox="0 0 48 48" className="w-9 h-9" aria-hidden>
      <circle cx="24" cy="24" r="20" fill="#F5A623" stroke="#111111" strokeWidth="4" />
      <circle cx="24" cy="24" r="13" fill="none" stroke="#D68910" strokeWidth="3" />
      <text
        x="24"
        y="31"
        textAnchor="middle"
        fontSize="18"
        fontWeight="bold"
        fill="#D68910"
        fontFamily="serif"
      >
        $
      </text>
    </svg>
  );
}

function BontoGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as BontoConfig;
  const cups = Math.min(5, Math.max(3, cfg.cups || 3));
  const shuffles = Math.max(3, cfg.shuffles || 8);
  const totalRounds = Math.min(5, Math.max(1, cfg.rounds || 3));
  const speed = Math.max(220, cfg.speed_ms || 480);

  const [round, setRound] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [positions, setPositions] = useState<number[]>(() =>
    Array.from({ length: cups }, (_, i) => i)
  );
  const [coinAt, setCoinAt] = useState(0); // index de gobelet contenant la pièce
  const [phase, setPhase] = useState<"reveal" | "shuffle" | "pick" | "result">("reveal");
  const [lifted, setLifted] = useState<number | null>(null); // gobelet soulevé (départ + résultat)
  const [picked, setPicked] = useState<number | null>(null);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());
  const cancelRef = useRef(false);

  // Séquence d'échanges déterministe par (équipe, manche, tentative)
  const swaps = useMemo<Swap[]>(() => {
    const rand = rngFromSeed(`bonto:${seed}:${round}:${attempt}`);
    const seq: Swap[] = [];
    for (let i = 0; i < shuffles + round; i++) {
      let a = seededInt(rand, cups);
      let b = seededInt(rand, cups);
      while (b === a) b = seededInt(rand, cups);
      seq.push({ a, b });
    }
    return seq;
  }, [seed, round, attempt, cups, shuffles]);

  useEffect(() => {
    cancelRef.current = false;
    return () => {
      cancelRef.current = true;
    };
  }, []);

  // Déroulé d'une manche : montre la pièce, mélange, laisse choisir
  useEffect(() => {
    let alive = true;
    (async () => {
      setPhase("reveal");
      setPicked(null);
      setPositions(Array.from({ length: cups }, (_, i) => i));
      setCoinAt(0);
      setLifted(0); // on montre la pièce sous le gobelet de gauche
      await sleep(1100);
      if (!alive || cancelRef.current) return;
      setLifted(null);
      await sleep(350);
      if (!alive || cancelRef.current) return;

      setPhase("shuffle");
      let coin = 0;
      for (const swap of swaps) {
        if (!alive || cancelRef.current) return;
        setPositions((prev) => {
          const next = [...prev];
          const ia = next.indexOf(swap.a);
          const ib = next.indexOf(swap.b);
          [next[ia], next[ib]] = [next[ib], next[ia]];
          return next;
        });
        // suit la pièce
        if (coin === swap.a) coin = swap.b;
        else if (coin === swap.b) coin = swap.a;
        sfx.tick();
        await sleep(speed);
      }
      if (!alive || cancelRef.current) return;
      setCoinAt(coin);
      setPhase("pick");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, attempt]);

  function pick(cupId: number) {
    if (phase !== "pick") return;
    setPicked(cupId);
    setLifted(cupId);
    setPhase("result");
    const success = cupId === coinAt;

    if (success) {
      sfx.pop();
      haptics.scan();
      if (round >= totalRounds) {
        setWon(true);
        sfx.success();
        haptics.success();
        const durationMs = Date.now() - startRef.current;
        setTimeout(() => onComplete({ score: Math.max(100, 1000 - attempt * 80), durationMs }), 1400);
      } else {
        setTimeout(() => setRound((r) => r + 1), 1400);
      }
    } else {
      sfx.fail();
      haptics.fail();
      // montre où était la pièce, puis rejoue la manche
      setTimeout(() => {
        setAttempt((a) => a + 1);
      }, 1600);
    }
  }

  // Largeur d'un gobelet en % (pour l'animation de position)
  const slotPct = 100 / cups;

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        🥥 La pièce d&apos;or est sous un gobelet… Suis-la bien pendant le mélange, puis désigne
        sa cachette ! {totalRounds > 1 && `${totalRounds} manches à gagner.`}
      </p>
      <div className="flex items-center justify-between font-bold text-ink/60 text-sm">
        <span>
          Manche {Math.min(round, totalRounds)}/{totalRounds}
        </span>
        <span className="font-display h-5">
          {phase === "reveal"
            ? "👀 Repère la pièce…"
            : phase === "shuffle"
              ? "🌀 Ça mélange !"
              : phase === "pick"
                ? "👇 Où est la pièce ?"
                : picked === coinAt
                  ? "✅ Bravo !"
                  : "❌ Perdu…"}
        </span>
      </div>

      {/* Table de jeu */}
      <div className="relative h-40 rounded-2xl border-[3px] border-ink parchment-texture overflow-hidden">
        {positions.map((cupId) => {
          // slot = position à l'écran de ce gobelet
          const slot = positions.indexOf(cupId);
          const hasCoin = cupId === coinAt;
          const isLifted = lifted === cupId;
          const isWrongPick = phase === "result" && picked === cupId && cupId !== coinAt;
          return (
            <motion.button
              key={cupId}
              className="absolute bottom-4 flex flex-col items-center"
              style={{ width: `${slotPct}%` }}
              animate={{ left: `${slot * slotPct}%` }}
              transition={{ type: "tween", ease: "easeInOut", duration: speed / 1000 }}
              onClick={() => pick(cupId)}
              disabled={phase !== "pick"}
              aria-label={`Gobelet ${slot + 1}`}
            >
              {/* Emplacement pièce : IDENTIQUE pour tous les gobelets (aucun tell).
                  La pièce n'apparaît que sous le bon gobelet ET seulement soulevé. */}
              <div className="h-10 flex items-end justify-center">
                {hasCoin && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: isLifted ? 1 : 0, y: isLifted ? 0 : 8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Coin />
                  </motion.div>
                )}
              </div>
              {/* Le gobelet (SVG plus grand, contours cartoon) */}
              <motion.div
                animate={{ y: isLifted ? -40 : 0, rotate: isWrongPick ? [0, -8, 8, 0] : 0 }}
                transition={{ duration: 0.3 }}
                className="w-full flex justify-center px-1"
              >
                <Cup grayscale={isWrongPick} />
              </motion.div>
            </motion.button>
          );
        })}
      </div>

      {won && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 ŒIL DE LYNX — PIÈCE TROUVÉE !
        </p>
      )}
      {attempt > 0 && !won && (
        <p className="text-center text-sm font-bold text-crimson">
          {attempt} manche{attempt > 1 ? "s" : ""} ratée{attempt > 1 ? "s" : ""} — on recommence !
        </p>
      )}
    </div>
  );
}

function BontoEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as BontoConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "🟢 Facile", cups: 3, shuffles: 6, rounds: 1, speed_ms: 560 },
            { label: "🟡 Moyen", cups: 3, shuffles: 10, rounds: 3, speed_ms: 440 },
            { label: "🔴 Difficile", cups: 4, shuffles: 14, rounds: 3, speed_ms: 320 },
            { label: "🔥 Expert", cups: 5, shuffles: 18, rounds: 3, speed_ms: 250 },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange({ ...value, ...o })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.cups ?? 3) === o.cups && (cfg.shuffles ?? 8) === o.shuffles
                  ? "bg-gold"
                  : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Le bonneteau du port : suis la pièce d&apos;or sous les noix de coco ! Mélange généré pour
        chaque équipe — impossible à tricher, tout est dans l&apos;œil.
      </p>
    </div>
  );
}

export const bontoDef: MiniGameDef = {
  kind: "bonto",
  name: "Bonto",
  icon: "🥥",
  description: "Le bonneteau : suivre la pièce d'or sous les gobelets",
  needsAnswer: false,
  defaultConfig: { cups: 3, shuffles: 10, rounds: 3, speed_ms: 440 },
  Component: BontoGame,
  ConfigEditor: BontoEditor,
};
