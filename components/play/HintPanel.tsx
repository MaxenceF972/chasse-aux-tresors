"use client";

import { useEffect, useState } from "react";
import type { HintMeta } from "@/lib/types";
import { sfx } from "@/lib/game/sounds";

interface HintPanelProps {
  hints: HintMeta[];
  onUnlock: (index: number) => Promise<{ ok: boolean; text?: string; error?: string }>;
}

/** Indices progressifs : gratuits après délai, ou débloqués contre pénalité. */
export default function HintPanel({ hints, onUnlock }: HintPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [busy, setBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Les délais "gratuit dans X" sont relatifs au moment du fetch de l'état
  useEffect(() => {
    setFetchedAt(Date.now());
  }, [hints]);

  if (!hints.length) return null;

  return (
    <div className="space-y-2.5">
      <h3 className="font-display text-lg text-ink/70">💡 Indices</h3>
      {hints.map((hint) => {
        if (hint.unlocked && hint.text) {
          return (
            <div
              key={hint.index}
              className="parchment-texture rounded-xl border-[3px] border-leaf p-3 font-bold text-ink/85"
            >
              💡 {hint.text}
            </div>
          );
        }

        const remaining = Math.max(
          0,
          hint.available_in_sec - Math.floor((now - fetchedAt) / 1000)
        );
        const freeNow = hint.unlock_after_sec != null && remaining === 0;
        const hasPenalty = hint.penalty_sec != null && hint.penalty_sec > 0;
        const penaltyMin = Math.round((hint.penalty_sec ?? 0) / 60);
        const canUnlock = freeNow || hasPenalty;

        return (
          <div key={hint.index} className="rounded-xl border-[3px] border-dashed border-ink/30 p-3">
            {confirming === hint.index ? (
              <div className="space-y-2">
                <p className="font-bold text-sm">
                  Débloquer cet indice contre <span className="text-crimson">+{penaltyMin} min</span>{" "}
                  de pénalité ?
                </p>
                <div className="flex gap-2">
                  <button
                    className="flex-1 h-10 rounded-xl border-[3px] border-ink bg-gold font-display"
                    disabled={busy !== null}
                    onClick={async () => {
                      setBusy(hint.index);
                      const res = await onUnlock(hint.index);
                      if (res.ok) sfx.pop();
                      setBusy(null);
                      setConfirming(null);
                    }}
                  >
                    {busy === hint.index ? "…" : "OUI !"}
                  </button>
                  <button
                    className="flex-1 h-10 rounded-xl border-[3px] border-ink bg-white font-display"
                    onClick={() => setConfirming(null)}
                  >
                    Non
                  </button>
                </div>
              </div>
            ) : (
              <button
                className="w-full flex items-center justify-between gap-2 font-bold text-ink/70 disabled:opacity-60"
                disabled={!canUnlock || busy !== null}
                onClick={async () => {
                  if (freeNow) {
                    setBusy(hint.index);
                    const res = await onUnlock(hint.index);
                    if (res.ok) sfx.pop();
                    setBusy(null);
                  } else {
                    setConfirming(hint.index);
                  }
                }}
              >
                <span>🔒 Indice {hint.index + 1}</span>
                <span className="text-sm">
                  {freeNow
                    ? "GRATUIT — toucher pour révéler"
                    : hint.unlock_after_sec != null && !hasPenalty
                      ? `gratuit dans ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                      : hint.unlock_after_sec != null
                        ? `+${penaltyMin} min (gratuit dans ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")})`
                        : `+${penaltyMin} min de pénalité`}
                </span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
