"use client";

import type { MinigameKind } from "@/lib/types";
import type { MiniGameResult } from "@/components/minigames/types";
import { MINIGAMES } from "@/components/minigames/registry";
import Dialog from "@/components/ui/Dialog";

interface MinigameModalProps {
  kind: MinigameKind;
  config: Record<string, unknown>;
  seed: string;
  onClose: () => void;
  /** true = validation acceptée (le modal se ferme côté parent) */
  onComplete: (result: MiniGameResult) => Promise<boolean>;
}

export default function MinigameModal({ kind, config, seed, onClose, onComplete }: MinigameModalProps) {
  const def = MINIGAMES[kind];
  if (!def) {
    return (
      <Dialog open onClose={onClose} title="Mini-jeu">
        <p className="font-bold text-crimson">Mini-jeu inconnu : {kind}</p>
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={`${def.icon} ${def.name}`}>
      <def.Component config={config} seed={seed} onComplete={onComplete} />
    </Dialog>
  );
}
