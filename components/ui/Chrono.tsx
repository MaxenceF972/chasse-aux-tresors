"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration } from "@/lib/game/format";
import type { Game } from "@/lib/types";

interface ChronoProps {
  /** Temps écoulé (ms) au moment du dernier fetch — pauses déjà déduites. */
  elapsedMs: number;
  /** true = le chrono avance (partie en cours, pas en pause). */
  ticking: boolean;
  /** Pénalités à ajouter (secondes). */
  penaltySeconds?: number;
  className?: string;
}

/** Chrono de partie : se fige pendant les pauses (le serveur fait foi). */
export default function Chrono({ elapsedMs, ticking, penaltySeconds = 0, className = "" }: ChronoProps) {
  const baseRef = useRef({ ms: elapsedMs, at: Date.now() });
  const [, tick] = useState(0);

  // Resynchronise la base à chaque nouvelle valeur serveur
  useEffect(() => {
    baseRef.current = { ms: elapsedMs, at: Date.now() };
    tick((n) => n + 1);
  }, [elapsedMs]);

  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  const live = ticking ? Date.now() - baseRef.current.at : 0;
  const ms = Math.max(0, baseRef.current.ms + live) + penaltySeconds * 1000;

  return (
    <span className={`tabular-nums ${className}`} suppressHydrationWarning>
      {formatDuration(ms)}
    </span>
  );
}

/** Miroir client de public.game_elapsed_ms (pour les données lues directement). */
export function gameElapsedMs(game: Pick<Game, "started_at" | "finished_at" | "paused_total_ms" | "paused_at">): number {
  if (!game.started_at) return 0;
  const end = game.finished_at ? new Date(game.finished_at).getTime() : Date.now();
  const activePause = game.paused_at ? Date.now() - new Date(game.paused_at).getTime() : 0;
  return Math.max(0, end - new Date(game.started_at).getTime() - (game.paused_total_ms ?? 0) - activePause);
}
