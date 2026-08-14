"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AwardedBonus, RankedTeam, RankingData } from "@/lib/types";
import { formatDuration } from "@/lib/game/format";
import TeamBonuses from "@/components/play/TeamBonuses";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Logo from "@/components/ui/Logo";
import Spinner from "@/components/ui/Spinner";

/**
 * Classement en accès libre : la page qu'on envoie aux familles, aux collègues
 * et aux curieux qui ne jouent pas. Pas de compte, pas d'app à installer —
 * juste le tableau, qui se rafraîchit tout seul tant que la partie tourne.
 */
export default function PublicRanking({
  code,
  initial,
}: {
  code: string;
  initial: RankingData | null;
}) {
  const [data, setData] = useState<RankingData | null>(initial);
  const [missing, setMissing] = useState(initial === null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/ranking/${code}`, { cache: "no-store" });
      if (!res.ok) {
        setMissing(true);
        return;
      }
      setData((await res.json()) as RankingData);
      setMissing(false);
    } catch {
      /* réseau : on retentera au prochain tour */
    }
  }, [code]);

  // La partie peut être en cours : on suit sans marteler le serveur.
  useEffect(() => {
    if (!initial) void load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load, initial]);

  if (missing) {
    return (
      <main className="min-h-dvh px-5 py-10 pt-safe-page max-w-lg mx-auto text-center">
        <Logo className="w-64 max-w-[70vw] mx-auto" />
        <h1 className="font-display text-3xl text-gold text-cartoon-outline mt-6">
          CLASSEMENT INTROUVABLE
        </h1>
        <p className="font-bold text-parchment/60 mt-2">
          Ce lien ne correspond à aucune chasse. Vérifie qu&apos;il est complet.
        </p>
        <Link href="/" className="contents">
          <Button size="lg" variant="parchment" className="mt-6">
            🏠 ACCUEIL
          </Button>
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-dvh flex items-center justify-center">
        <Spinner label="Chargement du classement…" />
      </main>
    );
  }

  const { game, teams } = data;
  const isPoints = game.scoring === "points";
  const finished = game.status === "finished";
  const bonusesByTeam = new Map<string, AwardedBonus[]>();
  for (const b of data.bonuses ?? []) {
    bonusesByTeam.set(b.team_id, [...(bonusesByTeam.get(b.team_id) ?? []), b]);
  }
  const winnerPhotos = data.winner_photos ?? (data.winner_photo ? [data.winner_photo] : []);

  const scoreLabel = (team: RankedTeam) => {
    if (isPoints) return `${Math.round(team.points)} pts`;
    if (team.time_ms != null) return formatDuration(team.time_ms);
    return `${team.done}/${team.total}`;
  };
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "Une équipe";

  return (
    <main className="min-h-dvh px-5 py-8 pt-safe-page pb-safe-page max-w-lg mx-auto">
      <div className="text-center mb-6">
        <Logo className="w-64 max-w-[70vw] mx-auto" />
        <h1 className="font-display text-3xl text-gold text-cartoon-outline mt-4 -rotate-2">
          {finished ? "CLASSEMENT FINAL" : "CLASSEMENT EN DIRECT"}
        </h1>
        <p className="font-bold text-parchment/60 mt-1">
          {game.name}
          {isPoints && " · au barème points"}
        </p>
        {!finished && (
          <p className="font-bold text-gold/70 text-xs mt-1">
            Chasse en cours — la page se met à jour toute seule.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {teams.map((entry, i) => (
          <Card key={entry.id} className="p-3.5">
            <div className="flex items-center gap-3">
              <span className="font-display text-xl w-8 text-center">
                {["🥇", "🥈", "🥉"][i] ?? i + 1}
              </span>
              <span
                className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-display truncate">{entry.name}</p>
                {entry.roster?.length > 0 && (
                  <p className="text-xs font-bold text-ink/45 truncate">
                    {entry.roster.join(" · ")}
                  </p>
                )}
                <p className="text-sm font-bold text-ink/55">
                  {entry.done}/{entry.total} étapes
                  {entry.penalty_seconds > 0 &&
                    ` · +${Math.round(entry.penalty_seconds / 60)} min pénalité`}
                  {isPoints && entry.time_ms != null && ` · ${formatDuration(entry.time_ms)}`}
                </p>
                <TeamBonuses bonuses={bonusesByTeam.get(entry.id) ?? []} />
              </div>
              <span className="font-display text-lg tabular-nums">{scoreLabel(entry)}</span>
            </div>
          </Card>
        ))}
      </div>

      <p className="font-bold text-parchment/45 text-xs text-center mt-3 leading-relaxed">
        {isPoints ? (
          <>
            Score = points des étapes validées <span className="text-leaf">+ récompenses 🏅</span>{" "}
            − pénalités (indices, étapes passées, photos refusées).
          </>
        ) : (
          <>
            Classement au chrono : temps de parcours + pénalités (indices, étapes passées,
            photos refusées){" "}
            <span className="text-leaf">− le temps offert par les récompenses 🏅</span>.
          </>
        )}
      </p>

      {finished && winnerPhotos.length > 0 && (
        <div className="mt-10">
          <h2 className="font-display text-2xl text-gold text-center mb-3 -rotate-1">
            🏅 {winnerPhotos.length > 1 ? "LES PHOTOS DE LA PARTIE" : "LA PHOTO DE LA PARTIE"}
          </h2>
          <div className={winnerPhotos.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
            {winnerPhotos.map((photo, i) => (
              <Card key={photo.url} className="p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={`Photo à l'honneur ${i + 1}`}
                  className="w-full rounded-xl border-2 border-ink"
                />
                <p className="text-center font-display mt-2 text-sm">{teamName(photo.team_id)}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      <p className="text-center font-bold text-parchment/40 text-xs mt-10">
        🏴‍☠️ Chasse au trésor organisée avec TOYAH GAMES
      </p>
    </main>
  );
}
