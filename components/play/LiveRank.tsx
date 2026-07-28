"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { rpc } from "@/lib/supabase/client";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import type { RankedTeam, RankingData } from "@/lib/types";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { showToast } from "@/components/ui/Toaster";

interface LiveRankProps {
  code: string;
  gameId: string;
  teamId: string;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function rankLabel(rank: number): string {
  return rank === 1 ? "1ᵉʳ" : `${rank}ᵉ`;
}

/**
 * Bandeau de classement live sur l'écran de jeu : rang de l'équipe toujours
 * visible (pression compétitive !), toast + son quand on gagne ou perd une
 * place, et un tap ouvre le classement complet.
 */
export default function LiveRank({ code, gameId, teamId }: LiveRankProps) {
  const router = useRouter();
  const [data, setData] = useState<RankingData | null>(null);
  const prevRankRef = useRef<number | null>(null);

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

  const teams = data?.teams ?? [];
  const isPoints = data?.game.scoring === "points";
  const me = teams.find((t) => t.id === teamId);
  const metric = (t: RankedTeam) => (isPoints ? t.points : t.done);
  // Rang avec ex-aequo : 1 + nombre d'équipes strictement devant
  const rank = me ? 1 + teams.filter((t) => metric(t) > metric(me)).length : 0;
  const tiedForLead = rank === 1 && !!me && teams.some((t) => t.id !== teamId && metric(t) === metric(me));

  // Toast + son quand le rang change (jamais au premier chargement)
  useEffect(() => {
    if (!me || teams.length < 2) return;
    const prev = prevRankRef.current;
    prevRankRef.current = rank;
    if (prev == null || prev === rank) return;
    if (rank < prev) {
      sfx.success();
      haptics.success();
      showToast(`🚀 À l'abordage — vous voilà ${rankLabel(rank)} !`, "success");
    } else {
      haptics.scan();
      showToast(`😱 Une équipe vous double — ${rankLabel(rank)} maintenant !`, "info");
    }
  }, [rank, me, teams.length]);

  // Solo ou pas encore chargé : rien à comparer, rien à afficher
  if (!me || teams.length < 2) return null;

  const leader = teams.find((t) => t.id !== teamId && metric(t) >= metric(me));
  const subline =
    rank === 1
      ? tiedForLead
        ? "À égalité en tête — sprintez ! ⚡"
        : "Vous menez la course — tenez bon ! 🏴‍☠️"
      : leader
        ? `« ${leader.name} » mène ${
            isPoints ? `avec ${Math.round(leader.points)} pts` : `avec ${leader.done}/${leader.total}`
          }`
        : "";

  return (
    <button
      onClick={() => router.push(`/play/${code}/final`)}
      className="w-full mt-3 rounded-2xl border-[3px] border-ink bg-white/70 shadow-[4px_4px_0_0_#111111] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#111111] transition-all px-4 py-2.5 flex items-center gap-3 text-left"
      aria-label="Voir le classement complet"
    >
      <span className="text-3xl shrink-0" aria-hidden>
        {MEDALS[rank - 1] ?? "🏅"}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-display text-lg leading-tight">
          {rank === 1 ? "EN TÊTE !" : `${rank}ᵉ SUR ${teams.length}`}
        </span>
        <span className="block font-bold text-ink/60 text-sm truncate">{subline}</span>
      </span>
      <span className="font-display text-ink/40 text-2xl shrink-0" aria-hidden>
        ›
      </span>
    </button>
  );
}
