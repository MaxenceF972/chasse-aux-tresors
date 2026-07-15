"use client";

import { useEffect, useRef } from "react";
import { sb } from "@/lib/supabase/client";

/**
 * Abonnement Realtime à toutes les tables d'une partie : sert de signal
 * d'invalidation (debounced) — l'état de vérité est toujours refetché.
 */
export function useGameInvalidate(gameId: string | null | undefined, onChange: () => void) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    if (!gameId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), 300);
    };

    const channel = sb()
      .channel(`game-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "games", filter: `id=eq.${gameId}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams", filter: `game_id=eq.${gameId}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `game_id=eq.${gameId}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "team_routes", filter: `game_id=eq.${gameId}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "events", filter: `game_id=eq.${gameId}` }, debounced)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void sb().removeChannel(channel);
    };
  }, [gameId]);
}
