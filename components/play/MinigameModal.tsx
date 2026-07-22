"use client";

import { useState } from "react";
import type { MinigameKind } from "@/lib/types";
import type { MiniGameResult } from "@/components/minigames/types";
import { MINIGAMES } from "@/components/minigames/registry";
import Button from "@/components/ui/Button";
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
  // Écran d'intro : le jeu (et son chrono interne) ne démarre qu'au GO,
  // le temps de lire les règles tranquillement.
  const [started, setStarted] = useState(false);
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
      {started ? (
        <def.Component config={config} seed={seed} onComplete={onComplete} />
      ) : (
        <div className="space-y-4 text-center py-2">
          <div className="text-6xl">{def.icon}</div>
          <p className="font-bold text-ink/80 text-lg leading-snug">{def.description}</p>
          <p className="font-bold text-ink/50 text-sm">
            Prenez le temps de lire — le jeu démarre quand vous appuyez sur GO.
          </p>
          <Button full size="xl" onClick={() => setStarted(true)}>
            🚀 GO !
          </Button>
        </div>
      )}
    </Dialog>
  );
}
