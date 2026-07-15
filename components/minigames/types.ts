import type { ComponentType } from "react";
import type { MinigameKind } from "@/lib/types";

export interface MiniGameResult {
  score: number;
  durationMs: number;
  /** Pour les jeux à réponse (cadenas, César) : vérifiée côté serveur. */
  answer?: string;
}

export interface MiniGameProps {
  config: Record<string, unknown>;
  /** Déterministe par (équipe, étape) : recharger ne re-mélange pas le jeu. */
  seed: string;
  /**
   * Appelé quand le joueur termine (ou tente une réponse finale).
   * Retourne true si la validation serveur accepte — false = mauvaise réponse,
   * le mini-jeu reste ouvert et peut afficher un feedback d'échec.
   */
  onComplete: (result: MiniGameResult) => Promise<boolean>;
}

export interface ConfigEditorProps {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
  /** Pour les uploads d'images de config (taquin, memory). */
  gameId: string;
}

export interface MiniGameDef {
  kind: MinigameKind;
  name: string;
  icon: string;
  description: string;
  /** true → la réponse finale est vérifiée contre step_secrets.answers */
  needsAnswer: boolean;
  answerLabel?: string;
  defaultConfig: Record<string, unknown>;
  Component: ComponentType<MiniGameProps>;
  ConfigEditor: ComponentType<ConfigEditorProps>;
}
