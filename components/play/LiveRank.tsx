"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { rpc } from "@/lib/supabase/client";
import { formatDuration } from "@/lib/game/format";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import type { RankedTeam, RankingData } from "@/lib/types";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { showToast } from "@/components/ui/Toaster";
import Dialog from "@/components/ui/Dialog";
import TeamBonuses from "./TeamBonuses";

interface LiveRankProps {
  code: string;
  gameId: string;
  teamId: string;
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** Temps de course d'une équipe pour le classement : final si elle est
 *  arrivée, courant + pénalités sinon, null tant qu'elle n'est pas partie
 *  (ou que le SQL n'est pas ré-appliqué). */
function raceMs(eq: RankedTeam): number | null {
  if (eq.time_ms != null) return eq.time_ms;
  if (eq.elapsed_ms == null) return null;
  return eq.elapsed_ms + eq.penalty_seconds * 1000;
}

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
  // Pas `players` : cette table encaisse un `report_position` par téléphone
  // toutes les douze secondes, et le classement se rechargeait au rythme des
  // pas de tout le monde. Deux secondes d'agrégation, aussi : un classement
  // n'a pas besoin d'être à la milliseconde, et CHAQUE téléphone le relit.
  useGameInvalidate(gameId, load, {
    tables: ["games", "teams", "team_routes", "events", "submissions"],
    debounceMs: 2000,
  });
  // Filet de sécurité si le Realtime décroche
  useEffect(() => {
    const t = setInterval(() => void load(), 45000);
    return () => clearInterval(t);
  }, [load]);

  const teams = useMemo(() => data?.teams ?? [], [data]);
  const isPoints = data?.game.scoring === "points";

  // « o devant t » selon le VRAI barème de la partie — même ordre que
  // get_ranking côté serveur :
  // - points : plus de points (pénalités déjà déduites par le serveur) ;
  // - chrono : les arrivées d'abord, au temps final ; puis celles encore en
  //   course, à la progression puis au temps de course + pénalités (en jeu
  //   continu chaque équipe a SON chrono ; en départ groupé, à progression
  //   égale, c'est la pénalité qui fait la différence).
  const isAhead = useCallback(
    (o: RankedTeam, t: RankedTeam) => {
      if (isPoints) return o.points > t.points;
      // Une équipe ARRIVÉE passe devant toutes celles qui courent encore, et
      // entre deux arrivées seul le temps final compte. La progression ne
      // départage que les équipes en course : elles n'ont pas forcément le
      // même nombre d'étapes (étape ajoutée ou neutralisée en cours de route).
      const oFini = o.time_ms != null;
      const tFini = t.time_ms != null;
      if (oFini !== tFini) return oFini;
      if (oFini && tFini) return (o.time_ms as number) < (t.time_ms as number);
      if (o.done !== t.done) return o.done > t.done;
      const [ro, rt] = [raceMs(o), raceMs(t)];
      if (ro != null || rt != null) return ro != null && (rt == null || ro < rt);
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
    // Jeu en continu : sa progression et SON temps (pas celui de la journée).
    const run =
      data?.game.continuous && t.elapsed_ms != null ? ` · ${formatDuration(t.elapsed_ms)}` : "";
    return `${t.done}/${t.total}${run}${penMin > 0 ? ` · +${penMin} min` : ""}`;
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
                <div className="flex-1 min-w-0">
                  <span className="block font-display truncate">
                    {t.name}
                    {mine && " ⭐"}
                  </span>
                  {t.finished_at && (
                    <span className="block text-xs font-bold text-leaf">Arrivés ! 🏁</span>
                  )}
                  {/* Récompenses reçues : total replié, détail au doigt */}
                  <TeamBonuses bonuses={(data?.bonuses ?? []).filter((b) => b.team_id === t.id)} />
                </div>
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
