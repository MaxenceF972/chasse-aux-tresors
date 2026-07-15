"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ensureAnonSession, sb } from "@/lib/supabase/client";
import type { Game, Team, TeamRoute } from "@/lib/types";
import { clearPlayerSession, getPlayerSession } from "@/lib/game/session";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { formatDuration } from "@/lib/game/format";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Logo from "@/components/ui/Logo";

interface Ranked {
  team: Team;
  done: number;
  total: number;
  timeMs: number | null;
}

export default function FinalPage() {
  const params = useParams<{ code: string }>();
  const code = params.code?.toUpperCase() ?? "";
  const [game, setGame] = useState<Game | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [routes, setRoutes] = useState<TeamRoute[]>([]);
  const myTeamId = getPlayerSession()?.team_id;

  const load = useCallback(async () => {
    const { data: g } = await sb().from("games").select("*").eq("code", code).single();
    if (!g) return;
    setGame(g as Game);
    const gameId = (g as Game).id;
    const [t, r] = await Promise.all([
      sb().from("teams").select("*").eq("game_id", gameId),
      sb().from("team_routes").select("*").eq("game_id", gameId),
    ]);
    setTeams((t.data as Team[]) ?? []);
    setRoutes((r.data as TeamRoute[]) ?? []);
  }, [code]);

  useEffect(() => {
    void ensureAnonSession().then(load).catch(() => {});
  }, [load]);
  useGameInvalidate(game?.id, load);

  // Partie terminée → on oublie la session pour que « Reprendre » disparaisse
  useEffect(() => {
    if (game?.status === "finished") clearPlayerSession();
  }, [game?.status]);

  const ranking = useMemo<Ranked[]>(() => {
    if (!game?.started_at) return [];
    const start = new Date(game.started_at).getTime();
    return teams
      .map((team) => {
        const teamRoutes = routes.filter((r) => r.team_id === team.id);
        const done = teamRoutes.filter((r) => r.status === "done").length;
        return {
          team,
          done,
          total: teamRoutes.length,
          timeMs: team.finished_at
            ? new Date(team.finished_at).getTime() - start + team.penalty_seconds * 1000
            : null,
        };
      })
      .sort((a, b) => {
        if (a.done !== b.done) return b.done - a.done;
        const ta = a.timeMs ?? Infinity;
        const tb = b.timeMs ?? Infinity;
        if (ta !== tb) return ta - tb;
        return a.team.name.localeCompare(b.team.name);
      });
  }, [teams, routes, game?.started_at]);

  if (!game) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <Spinner label="Calcul du classement…" />
      </main>
    );
  }

  const podium = ranking.slice(0, 3);
  const rest = ranking.slice(3);
  const podiumOrder = [1, 0, 2]; // 2e, 1er, 3e
  const podiumHeights = ["h-20", "h-28", "h-14"];
  const medals = ["🥈", "🥇", "🥉"];

  return (
    <main className="min-h-dvh px-5 py-8 max-w-lg mx-auto">
      <div className="text-center mb-8">
        <Logo className="w-32 mx-auto" />
        <motion.h1
          initial={{ scale: 0, rotate: -8 }}
          animate={{ scale: 1, rotate: -2 }}
          transition={{ type: "spring", stiffness: 200, damping: 14, delay: 0.2 }}
          className="font-display text-4xl text-gold text-cartoon-outline mt-4"
        >
          {game.status === "finished" ? "CLASSEMENT FINAL" : "CLASSEMENT"}
        </motion.h1>
        <p className="font-bold text-parchment/60 mt-1">{game.name}</p>
      </div>

      {/* Podium */}
      {podium.length > 0 && (
        <div className="flex items-end justify-center gap-3 mb-8">
          {podiumOrder.map((rankIndex, col) => {
            const entry = podium[rankIndex];
            if (!entry) return <div key={col} className="w-24" />;
            return (
              <motion.div
                key={entry.team.id}
                initial={{ y: 120, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 + col * 0.2, type: "spring", stiffness: 160, damping: 16 }}
                className="flex flex-col items-center w-28"
              >
                <span className="text-4xl mb-1">{medals[col]}</span>
                <span
                  className="font-display text-sm text-center leading-tight mb-2 text-parchment"
                  style={{ color: entry.team.color }}
                >
                  {entry.team.name}
                </span>
                <div
                  className={`w-full ${podiumHeights[col]} rounded-t-xl border-[3px] border-ink flex items-center justify-center`}
                  style={{ backgroundColor: entry.team.color }}
                >
                  <span className="font-display text-parchment text-lg drop-shadow">
                    {entry.timeMs != null ? formatDuration(entry.timeMs) : `${entry.done}/${entry.total}`}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Liste complète */}
      <div className="space-y-3">
        {ranking.map((entry, i) => (
          <Card
            key={entry.team.id}
            className={`p-3.5 ${entry.team.id === myTeamId ? "ring-4 ring-gold" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-display text-xl w-8 text-center">{i + 1}</span>
              <span
                className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                style={{ backgroundColor: entry.team.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-display truncate">
                  {entry.team.name}
                  {entry.team.id === myTeamId && " ⭐"}
                </p>
                <p className="text-sm font-bold text-ink/55">
                  {entry.done}/{entry.total} étapes
                  {entry.team.penalty_seconds > 0 &&
                    ` · +${Math.round(entry.team.penalty_seconds / 60)} min pénalité`}
                </p>
              </div>
              <span className="font-display text-lg tabular-nums">
                {entry.timeMs != null ? formatDuration(entry.timeMs) : "⏳"}
              </span>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center gap-3">
        {game.status !== "finished" && myTeamId && (
          <Link href={`/play/${code}/game`} className="contents">
            <Button size="lg">🗺️ RETOUR À L&apos;ÉNIGME</Button>
          </Link>
        )}
        {game.status === "finished" && (
          <Link href="/play" className="contents">
            <Button size="lg">🏴‍☠️ REJOUER UNE AUTRE PARTIE</Button>
          </Link>
        )}
        <Link href="/" className="contents">
          <Button variant="parchment" size="lg">🏠 RETOUR À L&apos;ACCUEIL</Button>
        </Link>
      </div>
    </main>
  );
}
