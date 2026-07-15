// ---------------------------------------------------------------------------
// Types du domaine TOYAH GAMES (miroir du schéma Supabase + retours RPC)
// ---------------------------------------------------------------------------

export type GameStatus = "lobby" | "running" | "paused" | "finished";
export type StepType = "nfc" | "text" | "minigame";
export type RouteStatus = "locked" | "current" | "done";
export type MinigameKind =
  | "caesar"
  | "taquin"
  | "simon"
  | "anagrams"
  | "lock"
  | "memory"
  | "morse"
  | "mastermind"
  | "maze";

export interface GameSettings {
  max_teams?: number | null;
  max_players_per_team?: number | null;
  hint_default_penalty_sec?: number;
}

export interface Game {
  id: string;
  code: string;
  name: string;
  status: GameStatus;
  created_by: string;
  settings: GameSettings;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface StepContent {
  body?: string;
  minigame?: { kind: MinigameKind; config: Record<string, unknown> };
}

export interface Step {
  id: string;
  game_id: string;
  type: StepType;
  title: string;
  content: StepContent;
  media_urls: string[];
  is_common_checkpoint: boolean;
  is_final: boolean;
  order_hint: number;
  created_at: string;
}

export interface Hint {
  text: string;
  penalty_sec?: number | null;
  unlock_after_sec?: number | null;
}

export interface StepSecrets {
  step_id: string;
  answers: string[];
  nfc_tag_id: string | null;
  manual_code: string | null;
  hints: Hint[];
}

export interface Team {
  id: string;
  game_id: string;
  name: string;
  team_code: string;
  color: string;
  penalty_seconds: number;
  finished_at: string | null;
  created_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  team_id: string;
  nickname: string;
  auth_uid: string;
  created_at: string;
}

export interface TeamRoute {
  id: string;
  game_id: string;
  team_id: string;
  step_id: string;
  position: number;
  status: RouteStatus;
  validated_at: string | null;
}

export interface GameEvent {
  id: number;
  game_id: string;
  team_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// --- Retours RPC ---

export interface LobbyTeam {
  id: string;
  name: string;
  color: string;
  created_at: string;
  players: string[];
}

export interface LobbyState {
  error?: string;
  game?: {
    id: string;
    code: string;
    name: string;
    status: GameStatus;
    settings: GameSettings;
  };
  teams?: LobbyTeam[];
  me?: { team_id: string; nickname: string } | null;
}

export interface HintMeta {
  index: number;
  penalty_sec: number | null;
  unlock_after_sec: number | null;
  available_in_sec: number;
  unlocked: boolean;
  text: string | null;
}

export interface PublicStep {
  id: string;
  type: StepType;
  title: string;
  content: StepContent;
  media_urls: string[];
  is_final: boolean;
  is_common: boolean;
}

export interface PlayState {
  error?: string;
  game: {
    id: string;
    code: string;
    name: string;
    status: GameStatus;
    started_at: string | null;
    finished_at: string | null;
    settings: GameSettings;
  };
  team: {
    id: string;
    name: string;
    color: string;
    team_code: string;
    penalty_seconds: number;
    finished_at: string | null;
  };
  progress: { done: number; total: number };
  current: {
    step: PublicStep;
    position: number;
    started_at: string;
    hints: HintMeta[];
  } | null;
  finished: boolean;
}

export interface ValidateResult {
  ok: boolean;
  correct?: boolean;
  already?: boolean;
  finished?: boolean;
  error?: string;
}

export type ValidateKind = "text" | "nfc" | "qr" | "manual" | "minigame";
