"use client";

import { useEffect, useRef } from "react";
import { sb } from "@/lib/supabase/client";

/** Les tables d'une partie sur lesquelles un écran peut vouloir se caler. */
export type TableJeu = "games" | "teams" | "players" | "team_routes" | "events" | "submissions";

const TOUTES: TableJeu[] = ["games", "teams", "players", "team_routes", "events", "submissions"];

export interface OptionsInvalidation {
  /**
   * Les tables à écouter. Par défaut toutes — mais `players` est un cas à
   * part : chaque téléphone qui partage sa position y écrit toutes les douze
   * secondes. Un écran qui s'y abonne se recharge donc au rythme des PAS DE
   * TOUT LE MONDE. Sur un site où cent visiteurs marchent en même temps, le
   * classement de chaque joueur se rechargeait plusieurs fois par seconde.
   * Un écran qui n'affiche ni les positions ni l'arrivée d'un coéquipier n'a
   * rien à faire de cette table.
   */
  tables?: TableJeu[];
  /** Délai d'agrégation des signaux. 300 ms par défaut. */
  debounceMs?: number;
}

/**
 * Abonnement Realtime aux tables d'une partie : sert de signal d'invalidation
 * (agrégé) — l'état de vérité est toujours refetché.
 */
export function useGameInvalidate(
  gameId: string | null | undefined,
  onChange: () => void,
  options?: OptionsInvalidation
) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  const tables = (options?.tables ?? TOUTES).join(",");
  const debounceMs = options?.debounceMs ?? 300;

  useEffect(() => {
    if (!gameId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    };

    // Le jeu de tables entre dans le nom du canal : deux écrans montés
    // ensemble avec des abonnements différents ne doivent pas se partager
    // un même topic Realtime.
    let channel = sb().channel(`game-${gameId}-${tables}`);
    for (const table of tables.split(",") as TableJeu[]) {
      // `games` se filtre sur son id, toutes les autres sur game_id.
      const filter = table === "games" ? `id=eq.${gameId}` : `game_id=eq.${gameId}`;
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter },
        debounced
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void sb().removeChannel(channel);
    };
  }, [gameId, tables, debounceMs]);
}
