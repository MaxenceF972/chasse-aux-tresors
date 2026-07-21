import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/** Client Supabase singleton (navigateur). */
export function sb(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: true, autoRefreshToken: true },
        realtime: { params: { eventsPerSecond: 5 } },
      }
    );
  }
  return _client;
}

/**
 * Garantit une session (anonyme si besoin) — les joueurs n'ont pas de compte,
 * mais le RLS et le Realtime exigent un auth.uid().
 */
export async function ensureAnonSession(): Promise<SupabaseClient> {
  const client = sb();
  const { data } = await client.auth.getSession();
  if (!data.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) {
      throw new Error(
        error.message.toLowerCase().includes("anonymous")
          ? "Les connexions anonymes ne sont pas activées sur le projet Supabase (Authentication → Sign In / Up)."
          : error.message
      );
    }
  }
  return client;
}

/** Appel RPC typé : lève une Error si Supabase renvoie une erreur. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Une erreur de fetch réseau (offline) — à distinguer d'un refus serveur. */
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|failed to fetch|load failed|timeout/i.test(msg);
}

/**
 * Message d'erreur lisible par un humain : traduit les erreurs techniques
 * courantes (réseau coupé, session expirée, anti-spam) qui sortent en anglais
 * de Supabase/fetch. À utiliser à l'AFFICHAGE uniquement — jamais avant les
 * tests logiques sur le message brut (codes INTERDIT, *_fkey, etc.).
 */
export function frError(err: unknown, fallback = "Une erreur est survenue — réessaie."): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  if (!raw) return fallback;
  if (/fetch|network|load failed|timeout/i.test(raw))
    return "Pas de réseau — vérifie ta connexion et réessaie.";
  if (/jwt|refresh token/i.test(raw) && /expired|invalid|not found|missing/i.test(raw))
    return "Session expirée — recharge la page.";
  if (/security purposes|rate limit/i.test(raw))
    return "Trop de tentatives — patiente quelques secondes et réessaie.";
  return raw;
}
