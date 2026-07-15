"use client";

import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";

interface NumPadProps {
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  submitDisabled?: boolean;
}

/** Pavé numérique tactile grand format (Code éclair, Calcul en cascade…). */
export default function NumPad({ onDigit, onDelete, onSubmit, submitDisabled }: NumPadProps) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "ok"];
  return (
    <div className="grid grid-cols-3 gap-2 max-w-64 mx-auto">
      {keys.map((k) => {
        if (k === "del") {
          return (
            <button
              key={k}
              onClick={() => {
                sfx.tick();
                haptics.tap();
                onDelete();
              }}
              aria-label="Effacer"
              className="h-13 rounded-xl border-[3px] border-ink bg-crimson text-parchment font-display text-xl shadow-[0_4px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_1px_0_0_#111111]"
            >
              ⌫
            </button>
          );
        }
        if (k === "ok") {
          return (
            <button
              key={k}
              onClick={onSubmit}
              disabled={submitDisabled}
              aria-label="Valider"
              className="h-13 rounded-xl border-[3px] border-ink bg-leaf text-parchment font-display text-xl shadow-[0_4px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_1px_0_0_#111111] disabled:opacity-40"
            >
              ✓
            </button>
          );
        }
        return (
          <button
            key={k}
            onClick={() => {
              sfx.tick();
              haptics.tap();
              onDigit(k);
            }}
            className="h-13 rounded-xl border-[3px] border-ink bg-parchment text-ink font-display text-2xl shadow-[0_4px_0_0_#111111] active:translate-y-[3px] active:shadow-[0_1px_0_0_#111111]"
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
