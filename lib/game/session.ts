/** Session joueur persistée sur le device (en plus de la session Supabase anonyme). */

export interface PlayerSession {
  code: string;
  team_id: string;
  team_code?: string;
  nickname?: string;
}

const KEY = "toyah:session";

export function getPlayerSession(): PlayerSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlayerSession) : null;
  } catch {
    return null;
  }
}

export function setPlayerSession(session: PlayerSession) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* stockage plein / privé — non bloquant */
  }
}

export function clearPlayerSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
