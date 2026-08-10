"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { rpc } from "@/lib/supabase/client";
import { bonusLabel, formatDuration } from "@/lib/game/format";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import type { RankedTeam, RankingData } from "@/lib/types";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { showToast } from "@/components/ui/Toaster";
import Dialog from "@/components/ui/Dialog";

interface LiveRankProps {
  code: string;
  gameId: string;
  teamId: string;
}

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Classement live sur l'écran de jeu, dosé « ni trop ni pas assez » :
 * - un bandeau une ligne (pastille tampon encre/or) toujours visible ;
 * - un tap ouvre le classement complet en bottom-sheet, sans quitter l'énigme ;
 * - une seule famille de notifs : prendre ou perdre la 1re place.
 *   Les autres dépassements se lisent en silence dans le bandeau.
 */
export default function LiveRank({ code, gameId, teamId }: LiveRankProps) {
  const [data, setData] = useState<RankingData | null>(null);
  const [open, setOpen] = useState(false);
  const wasLeaderRef = useRef<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const ranking = await rpc<RankingData>("get_ranking", { p_code: code });
      if (!ranking.error) setData(ranking);
    } catch {
      /* réseau — le prochain signal retentera */
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);
  useGameInvalidate(gameId, load);
  // Filet de sécurité si le Realtime décroche
  useEffect(() => {
    const t = setInterval(() => void load(), 45000);
    return () => clearInterval(t);
  }, [load]);

  const teams = useMemo(() => data?.teams ?? [], [data]);
  const isPoints = data?.game.scoring === "points";

  // « o devant t » selon le VRAI barème de la partie :
  // - points : plus de points (pénalités déjà déduites par le serveur) ;
  // - chrono : progression, puis temps final (arrivés), puis pénalités de
  //   temps — le chrono courant étant commun, à progression égale c'est
  //   bien la pénalité qui fait la différence de temps.
  const isAhead = useCallback(
    (o: RankedTeam, t: RankedTeam) => {
      if (isPoints) return o.points > t.points;
      if (o.done !== t.done) return o.done > t.done;
      if (o.time_ms != null || t.time_ms != null)
        return o.time_ms != null && (t.time_ms == null || o.time_ms < t.time_ms);
      return o.penalty_seconds < t.penalty_seconds;
    },
    [isPoints]
  );
  // Rang avec ex-aequo : 1 + nombre d'équipes strictement devant
  const rankOf = useCallback(
    (t: RankedTeam) => 1 + teams.filter((o) => o.id !== t.id && isAhead(o, t)).length,
    [teams, isAhead]
  );

  const me = teams.find((t) => t.id === teamId);
  const myRank = me ? rankOf(me) : 0;
  const leader = teams.find((t) => t.id !== teamId && rankOf(t) === 1);
  const tiedForLead = myRank === 1 && !!leader;

  // Notif uniquement pour la bataille de la 1re place (jamais au 1er chargement)
  useEffect(() => {
    if (!me || teams.length < 2) return;
    const isLeader = myRank === 1;
    const was = wasLeaderRef.current;
    wasLeaderRef.current = isLeader;
    if (was == null || was === isLeader) return;
    if (isLeader) {
      sfx.success();
      haptics.success();
      showToast("👑 Vous prenez la tête de la course !", "success");
    } else {
      haptics.scan();
      showToast(`😱 « ${leader?.name ?? "Une équipe"} » vous prend la tête !`, "info");
    }
  }, [myRank, me, teams.length, leader]);

  // Solo ou pas encore chargé : rien à comparer, rien à afficher
  if (!me || teams.length < 2) return null;

  // Score affiché dans la langue du barème : points, temps final (arrivés),
  // ou progression + pénalités de temps (en course).
  const scoreOf = (t: RankedTeam) => {
    if (isPoints) return `${Math.round(t.points)} pts`;
    if (t.time_ms != null) return formatDuration(t.time_ms);
    const penMin = Math.round(t.penalty_seconds / 60);
    return `${t.done}/${t.total}${penMin > 0 ? ` · +${penMin} min` : ""}`;
  };
  const subline =
    myRank === 1
      ? tiedForLead
        ? "À égalité en tête — sprintez ! ⚡"
        : "Vous menez — tenez bon ! 🏴‍☠️"
      : leader
        ? `« ${leader.name} » mène (${scoreOf(leader)})`
        : "";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full mt-3 flex items-center gap-2.5 rounded-2xl border-[3px] border-ink bg-white/60 shadow-[4px_4px_0_0_#111111] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#111111] transition-all px-3 py-2 min-h-11 text-left"
        aria-label="Voir le classement en direct"
      >
        {/* Pastille tampon : re-tamponnée à chaque changement de rang */}
        <motion.span
          key={myRank}
          initial={{ scale: 1.6, rotate: -12, opacity: 0.6 }}
          animate={{ scale: 1, rotate: -2, opacity: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 16 }}
          className="shrink-0 inline-flex items-center gap-1.5 bg-ink text-gold font-display text-sm px-2.5 py-1 rounded-lg"
        >
          <span aria-hidden>{MEDALS[myRank - 1] ?? "🏅"}</span>
          {myRank === 1 ? "EN TÊTE" : `${myRank}ᵉ/${teams.length}`}
        </motion.span>
        <span className="flex-1 min-w-0 font-bold text-ink/70 text-sm truncate">{subline}</span>
        <span className="font-display text-ink/40 text-xl shrink-0" aria-hidden>
          ›
        </span>
      </button>

      {/* Classement complet en bottom-sheet : un œil, on referme, on repart */}
      <Dialog open={open} onClose={() => setOpen(false)} title="🏅 Classement en direct">
        <div className="space-y-2">
          {teams.map((t) => {
            const r = rankOf(t);
            const mine = t.id === teamId;
            return (
              <div
                key={t.id}
                className={`flex items-center gap-3 rounded-xl border-[3px] border-ink bg-white/70 px-3 py-2.5 ${
                  mine ? "ring-4 ring-gold" : ""
                }`}
              >
                <span className="font-display text-lg w-9 text-center shrink-0" aria-hidden>
                  {MEDALS[r - 1] ?? r}
                </span>
                <span
                  className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-display truncate">
                    {t.name}
                    {mine && " ⭐"}
                  </span>
                  {t.finished_at && (
                    <span className="block text-xs font-bold text-leaf">Arrivés ! 🏁</span>
                  )}
                  {/* Récompenses reçues, avec leur motif */}
                  {(data?.bonuses ?? [])
                    .filter((b) => b.team_id === t.id)
                    .map((b, bi) => (
                      <span key={bi} className="block text-xs font-bold text-leaf leading-snug">
                        🏅 {bonusLabel(b.points, b.seconds)}
                        {b.reason && <span className="text-ink/50"> — {b.reason}</span>}
                      </span>
                    ))}
                </span>
                <span className="font-display tabular-nums shrink-0 text-right">{scoreOf(t)}</span>
              </div>
            );
          })}
          <p className="text-center font-bold text-ink/50 text-xs pt-1">
            {isPoints
              ? "Classement aux points (pénalités déduites)"
              : "Classement au chrono : progression, puis pénalités de temps"}{" "}
            — mis à jour en direct.
          </p>
        </div>
      </Dialog>
    </>
  );
}
