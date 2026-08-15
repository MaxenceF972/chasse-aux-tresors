"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonSession, isNetworkError, rpc, sb } from "@/lib/supabase/client";
import type { BroadcastKind, PlayState, ValidateKind, ValidateResult } from "@/lib/types";
import { enqueueValidation, flushQueue, listQueued } from "@/lib/game/offline-queue";
import { bonusLabel } from "@/lib/game/format";
import { precacheUrls } from "@/lib/pwa";

export type SubmitOutcome =
  | { status: "correct"; finished: boolean }
  | { status: "wrong"; distanceM?: number }
  | { status: "queued" }
  | { status: "error"; message: string };

export interface OrgMessage {
  id: number;
  message: string;
  /**
   * "bonus" = récompense du maître du jeu (célébrée), "hint" = message privé
   * à l'équipe, info/warning/alert = message général à toute la partie.
   */
  kind: "hint" | "bonus" | BroadcastKind;
}

const STATE_CACHE_KEY = "toyah:playstate";
/** Dernier message général déjà affiché : évite de le rejouer à chaque refetch. */
const SEEN_BROADCAST_KEY = "toyah:broadcast-seen";
/** Au-delà, un message général n'est plus rattrapé : il n'est plus d'actualité. */
const BROADCAST_MAX_AGE_MS = 30 * 60 * 1000;

function seenBroadcastId(): number {
  try {
    return Number(localStorage.getItem(SEEN_BROADCAST_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function markBroadcastSeen(id: number) {
  try {
    localStorage.setItem(SEEN_BROADCAST_KEY, String(id));
  } catch {
    /* stockage plein — le message sera juste réaffiché */
  }
}

/**
 * État central de l'écran joueur : bootstrap + realtime + validations
 * (avec file offline idempotente) + préchargement du média suivant.
 * Le dernier état connu est persisté : recharger la page sans réseau
 * réaffiche l'énigme en cours au lieu d'un écran vide.
 */
export function usePlayState(expectedCode?: string) {
  const [state, setState] = useState<PlayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notJoined, setNotJoined] = useState(false);
  const [offline, setOffline] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [orgMessage, setOrgMessage] = useState<OrgMessage | null>(null);
  const stateRef = useRef<PlayState | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await rpc<PlayState>("get_play_state");
      if (data.error === "NON_INSCRIT") {
        setNotJoined(true);
      } else {
        stateRef.current = data;
        setState(data);
        setOffline(false);
        // Rattrapage : un message général envoyé pendant que le téléphone
        // dormait n'a jamais atteint le canal temps réel. On le rejoue ici,
        // une seule fois (chaque refetch le renverrait sinon), et seulement
        // s'il est encore d'actualité — une équipe qui installe l'app en
        // cours de partie n'a pas à recevoir l'annonce d'il y a deux heures.
        const b = data.broadcast;
        if (b?.message && b.id > seenBroadcastId()) {
          markBroadcastSeen(b.id);
          const ageMs = Date.now() - new Date(b.at).getTime();
          if (ageMs < BROADCAST_MAX_AGE_MS) {
            setOrgMessage({ id: b.id, message: b.message, kind: b.kind });
          }
        }
        try {
          localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(data));
        } catch {
          /* stockage plein — non bloquant */
        }
      }
    } catch (err) {
      if (isNetworkError(err)) {
        setOffline(true);
        // Hors-ligne au chargement → on restaure le dernier état connu
        if (!stateRef.current) {
          try {
            const cached = localStorage.getItem(STATE_CACHE_KEY);
            if (cached) {
              const data = JSON.parse(cached) as PlayState;
              if (!expectedCode || data.game?.code === expectedCode) {
                stateRef.current = data;
                setState(data);
              }
            }
          } catch {
            /* cache illisible */
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [expectedCode]);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount((await listQueued()).length);
    } catch {
      /* IndexedDB indisponible */
    }
  }, []);

  // Bootstrap
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonSession();
        if (!cancelled) {
          await refetch();
          await refreshPending();
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refetch, refreshPending]);

  // Realtime : progression de mon équipe, statut de partie, messages orga
  const teamId = state?.team?.id;
  const gameId = state?.game?.id;
  useEffect(() => {
    if (!teamId || !gameId) return;
    const channel = sb()
      .channel(`play-${teamId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "games", filter: `id=eq.${gameId}` },
        () => void refetch()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_routes", filter: `team_id=eq.${teamId}` },
        () => void refetch()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `team_id=eq.${teamId}` },
        (payload) => {
          const row = payload.new as {
            id: number;
            type: string;
            payload: { message?: string; points?: number; seconds?: number; reason?: string };
          };
          if (row.type === "hint_sent" && row.payload?.message) {
            setOrgMessage({ id: row.id, message: row.payload.message, kind: "hint" });
          } else if (row.type === "bonus_awarded") {
            // L'équipe doit comprendre POURQUOI elle gagne : montant + motif
            const label = bonusLabel(Number(row.payload?.points ?? 0), Number(row.payload?.seconds ?? 0));
            const reason = String(row.payload?.reason ?? "").trim();
            setOrgMessage({
              id: row.id,
              message: reason ? `${label} — ${reason}` : label,
              kind: "bonus",
            });
          }
          void refetch();
        }
      )
      // Messages généraux : ils portent team_id null, donc le filtre par
      // équipe ci-dessus ne les voit pas. La policy events_select limite ce
      // qui remonte ici aux events de la partie visibles par ce joueur.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "events", filter: `game_id=eq.${gameId}` },
        (payload) => {
          const row = payload.new as {
            id: number;
            type: string;
            payload: { kind?: string; message?: string };
          };
          if (row.type !== "org_broadcast" || !row.payload?.message) return;
          markBroadcastSeen(row.id);
          setOrgMessage({
            id: row.id,
            message: row.payload.message,
            kind: (row.payload.kind as BroadcastKind) ?? "info",
          });
        }
      )
      .subscribe();
    return () => {
      void sb().removeChannel(channel);
    };
  }, [teamId, gameId, refetch]);

  // Retour réseau → rejoue la file puis resynchronise
  useEffect(() => {
    const onOnline = () => {
      setOffline(false);
      void (async () => {
        await flushQueue();
        await refreshPending();
        await refetch();
      })();
    };
    const onOffline = () => setOffline(true);
    // Retour sur l'onglet (les scans NFC iPhone ouvrent de nouveaux onglets :
    // chaque onglet du jeu doit être à jour dès qu'on revient dessus)
    const onVisible = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void onOnline();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    // filet de sécurité : retente régulièrement s'il reste des validations en attente
    const interval = setInterval(() => {
      if (navigator.onLine) void onOnline();
    }, 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [refetch, refreshPending]);

  // Préchargement des médias de l'étape suivante
  const currentStepId = state?.current?.step.id;
  useEffect(() => {
    if (!currentStepId) return;
    rpc<string[]>("get_next_media")
      .then((urls) => precacheUrls(urls ?? []))
      .catch(() => {});
  }, [currentStepId]);

  const submit = useCallback(
    async (kind: ValidateKind, payload: Record<string, unknown>): Promise<SubmitOutcome> => {
      const step = stateRef.current?.current?.step;
      if (!step) return { status: "error", message: "Aucune étape en cours" };
      const idemKey = crypto.randomUUID();

      const queueIt = async (): Promise<SubmitOutcome> => {
        await enqueueValidation({
          idem_key: idemKey,
          step_id: step.id,
          kind,
          payload,
          queued_at: Date.now(),
        });
        await refreshPending();
        setOffline(true);
        return { status: "queued" };
      };

      if (typeof navigator !== "undefined" && !navigator.onLine) return queueIt();

      try {
        const result = await rpc<ValidateResult>("validate_step", {
          p_idem_key: idemKey,
          p_step_id: step.id,
          p_kind: kind,
          p_payload: payload,
        });
        if (result.correct) {
          await refetch();
          return { status: "correct", finished: !!result.finished };
        }
        if (result.error) {
          if (result.error === "PARTIE_EN_PAUSE") {
            await refetch();
            return { status: "error", message: "La partie est en pause." };
          }
          return { status: "error", message: result.error };
        }
        return {
          status: "wrong",
          distanceM: typeof result.distance_m === "number" ? result.distance_m : undefined,
        };
      } catch (err) {
        if (isNetworkError(err)) return queueIt();
        return { status: "error", message: err instanceof Error ? err.message : "Erreur" };
      }
    },
    [refetch, refreshPending]
  );

  const unlockHint = useCallback(
    async (hintIndex: number) => {
      const step = stateRef.current?.current?.step;
      if (!step) return { ok: false as const };
      try {
        const res = await rpc<{ ok: boolean; text?: string; penalty_sec?: number; error?: string }>(
          "unlock_hint",
          { p_step_id: step.id, p_hint_index: hintIndex }
        );
        await refetch();
        return res;
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : "Erreur" };
      }
    },
    [refetch]
  );

  return {
    state,
    loading,
    notJoined,
    offline,
    pendingCount,
    orgMessage,
    clearOrgMessage: () => setOrgMessage(null),
    refetch,
    submit,
    unlockHint,
  };
}
