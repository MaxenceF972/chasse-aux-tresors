import type { MinigameKind } from "@/lib/types";
import type { MiniGameDef } from "./types";
import { caesarDef } from "./Caesar";
import { taquinDef } from "./Taquin";
import { simonDef } from "./Simon";
import { anagramsDef } from "./Anagrams";
import { lockDef } from "./Lock";
import { memoryDef } from "./Memory";
import { morseDef } from "./Morse";
import { mastermindDef } from "./Mastermind";
import { mazeDef } from "./Maze";

/**
 * Banque de mini-jeux. Pour en ajouter un : créer le composant + son éditeur
 * de config dans ce dossier, exporter un MiniGameDef, et l'enregistrer ici.
 */
export const MINIGAMES: Record<MinigameKind, MiniGameDef> = {
  caesar: caesarDef,
  taquin: taquinDef,
  simon: simonDef,
  anagrams: anagramsDef,
  lock: lockDef,
  memory: memoryDef,
  morse: morseDef,
  mastermind: mastermindDef,
  maze: mazeDef,
};

export const MINIGAME_LIST: MiniGameDef[] = Object.values(MINIGAMES);
