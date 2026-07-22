"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonSession, isNetworkError, rpc, sb } from "@/lib/supabase/client";
import type { PlayState, ValidateKind, ValidateResult } from "@/lib/types";
import { enqueueValidation, flushQueue, listQueued } from "@/lib/game/offline-queue";
import { precacheUrls } from "@/lib/pwa";

export type SubmitOutcome =
  | { status: "correct"; finished: boolean }
  | { status: "wrong"; distanceM?: number }
  | { status: "queued" }
  | { status: "error"; message: string };

export interface OrgMessage {
  id: number;
  message: string;
}

const STATE_CACHE_KEY = "toyah:playstate";

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
          const row = payload.new as { id: number; type: string; payload: { message?: string } };
          if (row.type === "hint_sent" && row.payload?.message) {
            setOrgMessage({ id: row.id, message: row.payload.message });
          }
          void refetch();
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
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    // filet de sécurité : retente régulièrement s'il reste des validations en attente
    const interval = setInterval(() => {
      if (navigator.onLine) void onOnline();
    }, 20000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
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
