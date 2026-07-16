"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ensureAnonSession, rpc } from "@/lib/supabase/client";
import type { RankedTeam, RankingData } from "@/lib/types";
import { clearPlayerSession, getPlayerSession } from "@/lib/game/session";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { formatDuration } from "@/lib/game/format";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Logo from "@/components/ui/Logo";

interface Award {
  icon: string;
  title: string;
  detail: string;
  team: RankedTeam;
}

function computeAwards(teams: RankedTeam[]): Award[] {
  const awards: Award[] = [];
  const finished = teams.filter((t) => t.time_ms != null);

  const fastest = [...finished].sort((a, b) => a.time_ms! - b.time_ms!)[0];
  if (fastest) {
    awards.push({
      icon: "🏆",
      title: "Chasseurs suprêmes",
      detail: `Parcours bouclé en ${formatDuration(fastest.time_ms!)}`,
      team: fastest,
    });
  }

  const flash = [...teams]
    .filter((t) => t.fastest_step_ms != null && t.fastest_step_ms > 0)
    .sort((a, b) => a.fastest_step_ms! - b.fastest_step_ms!)[0];
  if (flash) {
    awards.push({
      icon: "⚡",
      title: "Étape éclair",
      detail: `Une étape validée en ${formatDuration(flash.fastest_step_ms!)} !`,
      team: flash,
    });
  }

  const brains = [...teams].sort((a, b) => b.points - a.points)[0];
  if (brains && brains.points > 0) {
    awards.push({
      icon: "🧠",
      title: "Rois des casse-têtes",
      detail: `${Math.round(brains.points)} points au compteur`,
      team: brains,
    });
  }

  const curious = [...teams]
    .filter((t) => t.penalty_seconds > 0)
    .sort((a, b) => b.penalty_seconds - a.penalty_seconds)[0];
  if (curious) {
    awards.push({
      icon: "💡",
      title: "Accros aux indices",
      detail: `${Math.round(curious.penalty_seconds / 60)} min de pénalités assumées`,
      team: curious,
    });
  }

  // une équipe = un seul trophée (le plus prestigieux)
  const seen = new Set<string>();
  return awards.filter((a) => {
    if (seen.has(a.team.id)) return false;
    seen.add(a.team.id);
    return true;
  });
}

export default function FinalPage() {
  const params = useParams<{ code: string }>();
  const code = params.code?.toUpperCase() ?? "";
  const [data, setData] = useState<RankingData | null>(null);
  const myTeamId = getPlayerSession()?.team_id;

  const load = useCallback(async () => {
    try {
      const ranking = await rpc<RankingData>("get_ranking", { p_code: code });
      if (!ranking.error) setData(ranking);
    } catch {
      /* retentera via realtime/poll */
    }
  }, [code]);

  useEffect(() => {
    void ensureAnonSession().then(load).catch(() => {});
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);
  useGameInvalidate(data?.game?.id, load);

  // Partie terminée → on oublie la session pour que « Reprendre » disparaisse
  useEffect(() => {
    if (data?.game?.status === "finished") clearPlayerSession();
  }, [data?.game?.status]);

  const awards = useMemo(() => (data ? computeAwards(data.teams) : []), [data]);

  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <Spinner label="Calcul du classement…" />
      </main>
    );
  }

  const { game, teams } = data;
  const isPoints = game.scoring === "points";
  const finished = game.status === "finished";
  const podium = teams.slice(0, 3);
  const podiumOrder = [1, 0, 2]; // 2e, 1er, 3e
  const podiumHeights = ["h-20", "h-28", "h-14"];
  const medals = ["🥈", "🥇", "🥉"];

  function scoreLabel(team: RankedTeam): string {
    if (isPoints) return `${Math.round(team.points)} pts`;
    if (team.time_ms != null) return formatDuration(team.time_ms);
    return `${team.done}/${team.total}`;
  }

  async function share() {
    const lines = teams
      .slice(0, 3)
      .map((t, i) => `${["🥇", "🥈", "🥉"][i]} ${t.name} — ${scoreLabel(t)}`);
    const text = `🏴‍☠️ ${game.name} — TOYAH GAMES\n${lines.join("\n")}`;
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        alert("Classement copié !");
      }
    } catch {
      /* partage annulé */
    }
  }

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
          {finished ? "CLASSEMENT FINAL" : "CLASSEMENT"}
        </motion.h1>
        <p className="font-bold text-parchment/60 mt-1">
          {game.name}
          {isPoints && " · au barème points"}
        </p>
      </div>

      {/* Podium */}
      {podium.length > 0 && (
        <div className="flex items-end justify-center gap-2 sm:gap-3 mb-8">
          {podiumOrder.map((rankIndex, col) => {
            const entry = podium[rankIndex];
            if (!entry) return <div key={col} className="w-24" />;
            return (
              <motion.div
                key={entry.id}
                initial={{ y: 120, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 + col * 0.2, type: "spring", stiffness: 160, damping: 16 }}
                className="flex flex-col items-center w-24 sm:w-28 min-w-0"
              >
                <span className="text-4xl mb-1">{medals[col]}</span>
                <span
                  className="font-display text-sm text-center leading-tight mb-2"
                  style={{ color: entry.color }}
                >
                  {entry.name}
                </span>
                <div
                  className={`w-full ${podiumHeights[col]} rounded-t-xl border-[3px] border-ink flex items-center justify-center`}
                  style={{ backgroundColor: entry.color }}
                >
                  <span className="font-display text-parchment text-base drop-shadow px-1 text-center">
                    {scoreLabel(entry)}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Liste complète */}
      <div className="space-y-3">
        {teams.map((entry, i) => (
          <Card
            key={entry.id}
            className={`p-3.5 ${entry.id === myTeamId ? "ring-4 ring-gold" : ""}`}
          >
            <div className="flex items-center gap-3">
              <span className="font-display text-xl w-8 text-center">{i + 1}</span>
              <span
                className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-display truncate">
                  {entry.name}
                  {entry.id === myTeamId && " ⭐"}
                </p>
                <p className="text-sm font-bold text-ink/55">
                  {entry.done}/{entry.total} étapes
                  {entry.penalty_seconds > 0 &&
                    ` · +${Math.round(entry.penalty_seconds / 60)} min pénalité`}
                  {isPoints && entry.time_ms != null && ` · ${formatDuration(entry.time_ms)}`}
                </p>
              </div>
              <span className="font-display text-lg tabular-nums">
                {entry.time_ms == null && !isPoints ? "⏳" : scoreLabel(entry)}
              </span>
            </div>
          </Card>
        ))}
      </div>

      {/* Récompenses */}
      {finished && awards.length > 0 && (
        <>
          <h2 className="font-display text-2xl text-gold text-center mt-10 mb-4 -rotate-1">
            🎖️ RÉCOMPENSES
          </h2>
          <div className="space-y-3">
            {awards.map((award, i) => (
              <motion.div
                key={award.title}
                initial={{ x: i % 2 ? 60 : -60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.3 + i * 0.15, type: "spring", stiffness: 200, damping: 18 }}
              >
                <Card className="p-3.5 flex items-center gap-3">
                  <span className="text-4xl shrink-0">{award.icon}</span>
                  <div className="min-w-0">
                    <p className="font-display leading-tight">
                      {award.title} —{" "}
                      <span style={{ color: award.team.color }}>{award.team.name}</span>
                    </p>
                    <p className="font-bold text-sm text-ink/60">{award.detail}</p>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        </>
      )}

      <div className="mt-10 flex flex-col items-center gap-3">
        {finished && (
          <Button size="lg" variant="gold" onClick={share}>
            📣 PARTAGER LE RÉSULTAT
          </Button>
        )}
        {!finished && myTeamId && (
          <Link href={`/play/${code}/game`} className="contents">
            <Button size="lg">🗺️ RETOUR À L&apos;ÉNIGME</Button>
          </Link>
        )}
        {finished && (
          <Link href="/play" className="contents">
            <Button size="lg" variant="leaf">🏴‍☠️ REJOUER UNE AUTRE PARTIE</Button>
          </Link>
        )}
        <Link href="/" className="contents">
          <Button variant="parchment" size="lg">🏠 RETOUR À L&apos;ACCUEIL</Button>
        </Link>
      </div>
    </main>
  );
}
