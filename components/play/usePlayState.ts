"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ensureAnonSession, frError, isNetworkError, rpc, sb } from "@/lib/supabase/client";
import type { BroadcastKind, PlayState, ValidateKind, ValidateResult } from "@/lib/types";
import { enqueueValidation, flushQueue, listQueued } from "@/lib/game/offline-queue";
import { showToast } from "@/components/ui/Toaster";
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
  /**
   * Panne au démarrage AUTRE qu'une coupure réseau : quota de connexions
   * anonymes atteint un jour d'affluence, 5xx, exception SQL. On ne la voyait
   * nulle part — l'erreur était avalée, `loading` retombait à false et l'écran
   * restait sur « Lecture de la carte… » pour toujours. Renseigné seulement
   * quand on n'a RIEN à afficher : une partie déjà chargée continue de vivre.
   */
  const [bootError, setBootError] = useState<string | null>(null);
  const stateRef = useRef<PlayState | null>(null);
  /** Validations encore en file — lu par le filet de sécurité, hors rendu. */
  const pendingRef = useRef(0);

  const refetch = useCallback(async () => {
    try {
      const data = await rpc<PlayState>("get_play_state");
      if (data.error === "NON_INSCRIT") {
        setNotJoined(true);
      } else {
        stateRef.current = data;
        setState(data);
        setOffline(false);
        setBootError(null);
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
      } else if (!stateRef.current) {
        setBootError(frError(err, "La partie n'a pas pu être chargée."));
      }
    } finally {
      setLoading(false);
    }
  }, [expectedCode]);

  const refreshPending = useCallback(async () => {
    try {
      const n = (await listQueued()).length;
      pendingRef.current = n;
      setPendingCount(n);
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
      } catch (err) {
        if (!cancelled) {
          if (!isNetworkError(err)) {
            setBootError(frError(err, "La connexion à la partie a échoué."));
          } else {
            setOffline(true);
          }
          setLoading(false);
        }
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
        // Le sort des validations rejouées se DIT. L'écran a promis qu'elles
        // partiraient toutes seules : les voir disparaître de la file sans un
        // mot laisse l'équipe planter devant une épreuve qu'elle croit finie.
        const sorts = await flushQueue();
        const refuses = sorts.filter((r) => !r.accepte);
        if (refuses.length > 0) {
          showToast(
            refuses.length > 1
              ? `${refuses.length} validations mises en attente n'ont pas été retenues — ces épreuves t'attendent toujours.`
              : "La validation mise en attente n'a pas été retenue — l'épreuve t'attend toujours.",
            "error"
          );
        } else if (sorts.length > 0) {
          showToast(
            sorts.length > 1
              ? `✅ ${sorts.length} validations en attente sont bien enregistrées.`
              : "✅ Ta validation en attente est bien enregistrée.",
            "success"
          );
        }
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
    // FILET DE SÉCURITÉ, PAS UN BATTEMENT DE CŒUR.
    //
    // Ce minuteur rappelait `get_play_state` toutes les 20 secondes sur CHAQUE
    // téléphone, qu'il y ait quelque chose à rejouer ou non — trois requêtes
    // par minute et par visiteur, plus la radio qui ne se rendort jamais. Le
    // temps réel fait déjà le travail ; il ne reste à couvrir que deux cas :
    // une validation en attente (on insiste, toutes les 20 s), et un canal
    // temps réel tombé sans qu'on le sache (on resynchronise, toutes les
    // 2 minutes).
    let tics = 0;
    const interval = setInterval(() => {
      if (!navigator.onLine) return;
      if (pendingRef.current > 0) {
        tics = 0;
        void onOnline();
        return;
      }
      tics++;
      if (tics >= 6) {
        tics = 0;
        void refetch();
      }
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
    bootError,
    pendingCount,
    orgMessage,
    clearOrgMessage: () => setOrgMessage(null),
    refetch,
    submit,
    unlockHint,
  };
}
