// ---------------------------------------------------------------------------
// Types du domaine TOYAH GAMES (miroir du schéma Supabase + retours RPC)
// ---------------------------------------------------------------------------

export type GameStatus = "lobby" | "running" | "paused" | "finished";
export type StepType = "nfc" | "text" | "minigame" | "photo" | "gps";
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
  | "maze"
  | "lanterns"
  | "hanoi"
  | "flashcode"
  | "cascade"
  | "chimp"
  | "balance"
  | "logic"
  | "nonogram"
  | "sokoban"
  | "crypto"
  | "bonto";

export interface GameSettings {
  max_teams?: number | null;
  max_players_per_team?: number | null;
  hint_default_penalty_sec?: number;
  /** 'time' (défaut) = classement au chrono ; 'points' = points d'étapes */
  scoring?: "time" | "points";
  /** Pénalité d'un mini-jeu passé : points (mode points) / secondes (mode chrono) */
  skip_penalty_points?: number;
  skip_penalty_sec?: number;
  photo_penalty_sec?: number;
  /** Présentation de la chasse (thème, déroulé…) affichée aux joueurs au lobby */
  briefing?: string;
  /** Charte personnalisée par l'organisateur (une règle par ligne) — défaut si absente */
  charter?: string[];
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
  paused_total_ms: number;
  paused_at: string | null;
}

export interface StepContent {
  body?: string;
  minigame?: { kind: MinigameKind; config: Record<string, unknown> };
  /** Point de rendez-vous GPS public : affiché aux joueurs (« rendez-vous ici ») */
  rdv?: { lat: number; lng: number };
  /** Épreuve photo : bonus (avance direct, jugée après) ou gate (bloquante, l'orga valide pour avancer) */
  photo_mode?: "bonus" | "gate";
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
  /** Points gagnés en validant l'étape (classement aux points) */
  points: number;
  /** Limite de temps optionnelle (secondes) — expiration = passage à 0 point */
  time_limit_sec: number | null;
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
  gps_lat: number | null;
  gps_lng: number | null;
  gps_radius_m: number | null;
}

export interface Team {
  id: string;
  game_id: string;
  name: string;
  team_code: string;
  color: string;
  /** Membres listés par le capitaine à la création */
  roster: string[];
  penalty_seconds: number;
  finished_at: string | null;
  /** Temps effectif figé à l'arrivée (pauses déduites, hors pénalités) */
  final_time_ms: number | null;
  created_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  team_id: string;
  nickname: string;
  auth_uid: string;
  created_at: string;
  last_lat: number | null;
  last_lng: number | null;
  pos_updated_at: string | null;
}

export interface Submission {
  id: string;
  game_id: string;
  team_id: string;
  step_id: string;
  url: string;
  status: "pending" | "approved" | "rejected";
  is_winner: boolean;
  created_at: string;
  decided_at: string | null;
}

export interface TeamRoute {
  id: string;
  game_id: string;
  team_id: string;
  step_id: string;
  position: number;
  status: RouteStatus;
  validated_at: string | null;
  skipped: boolean;
  timed_out: boolean;
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
  /** Membres listés par le capitaine */
  roster: string[];
  /** Pseudos des joueurs connectés (devices) */
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
  points: number;
  time_limit_sec: number | null;
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
    /** Temps de partie effectif au moment du fetch (pauses déduites) */
    elapsed_ms: number;
  };
  team: {
    id: string;
    name: string;
    color: string;
    team_code: string;
    penalty_seconds: number;
    finished_at: string | null;
    final_time_ms: number | null;
  };
  progress: { done: number; total: number };
  current: {
    step: PublicStep;
    position: number;
    started_at: string;
    hints: HintMeta[];
    submission: { status: Submission["status"]; url: string } | null;
  } | null;
  /** Mini-jeux passés, rattrapables pour annuler la pénalité */
  skipped_minigames: { id: string; title: string; content: StepContent }[];
  finished: boolean;
}

export interface RankedTeam {
  id: string;
  name: string;
  color: string;
  roster: string[];
  penalty_seconds: number;
  finished_at: string | null;
  done: number;
  total: number;
  /** Temps final pénalités incluses (null si pas fini) */
  time_ms: number | null;
  points: number;
  fastest_step_ms: number | null;
  /** Bonus attribués par l'organisateur (absent tant que le SQL n'est pas ré-appliqué) */
  bonus_points?: number;
}

export interface RankingData {
  error?: string;
  game: {
    id: string;
    code: string;
    name: string;
    status: GameStatus;
    started_at: string | null;
    finished_at: string | null;
    scoring: "time" | "points";
    elapsed_ms: number;
  };
  teams: RankedTeam[];
  /** Photo gagnante (servie par get_ranking : la RLS submissions ne laisse pas les autres équipes la lire) */
  winner_photo?: { url: string; team_id: string } | null;
}

export interface ValidateResult {
  ok: boolean;
  correct?: boolean;
  already?: boolean;
  finished?: boolean;
  error?: string;
  /** Balise GPS : distance restante (m) quand la validation échoue */
  distance_m?: number;
}

export type ValidateKind = "text" | "nfc" | "qr" | "manual" | "minigame" | "gps";
