"use client";

import { useEffect, useMemo, useRef } from "react";
import type { Step, StepType, Team, TeamRoute } from "@/lib/types";
import { formatClock, formatDuration } from "@/lib/game/format";
import Dialog from "@/components/ui/Dialog";

const STEP_ICON: Record<StepType, string> = {
  nfc: "🏷️",
  text: "💬",
  minigame: "🎮",
  photo: "📸",
  gps: "📍",
};

type Status = "done" | "skipped" | "redeemed" | "timeout" | "current" | "todo";

/** Même code couleur que les petites cases du dashboard. */
const STATUS: Record<Status, { label: string; dot: string; text: string }> = {
  done:     { label: "validée",            dot: "",           text: "text-ink/55" },
  redeemed: { label: "rattrapée",          dot: "bg-leaf",    text: "text-leaf" },
  skipped:  { label: "passée · pénalité",  dot: "bg-crimson", text: "text-crimson" },
  timeout:  { label: "temps écoulé",       dot: "bg-ink/25",  text: "text-ink/45" },
  current:  { label: "en cours",           dot: "bg-gold",    text: "text-ink/70" },
  todo:     { label: "à venir",            dot: "bg-white",   text: "text-ink/35" },
};

function statusOf(r: TeamRoute): Status {
  if (r.status === "current") return "current";
  if (r.status !== "done") return "todo";
  if (r.skipped) return r.redeemed_at ? "redeemed" : "skipped";
  if (r.timed_out) return "timeout";
  return "done";
}

interface TeamJourneyProps {
  team: Team;
  /** Les routes de CETTE équipe */
  routes: TeamRoute[];
  steps: Map<string, Step>;
  startedAt: string | null;
  /** Étape sur laquelle on a cliqué : mise en avant et amenée à l'écran */
  focusStepId?: string | null;
  onClose: () => void;
}

/**
 * Le parcours complet d'une équipe, étape par étape : ce qu'elle a fait, en
 * combien de temps, ce qu'elle a passé et ce qu'elle a rattrapé.
 *
 * C'est la réponse à « il s'est passé quoi chez eux ? » — les petites cases du
 * dashboard donnent la forme d'ensemble, ceci donne le détail.
 */
export default function TeamJourney({
  team,
  routes,
  steps,
  startedAt,
  focusStepId,
  onClose,
}: TeamJourneyProps) {
  const focusRef = useRef<HTMLLIElement>(null);

  // Ordre réellement vécu : les validées dans leur ordre de validation, puis
  // l'étape en cours, puis le reste (l'ordre est choisi en direct par le
  // serveur, la position d'origine ne dit plus la vérité).
  const rows = useMemo(() => {
    const sorted = [...routes].sort((a, b) => {
      const grp = (r: TeamRoute) => (r.status === "done" ? 0 : r.status === "current" ? 1 : 2);
      if (grp(a) !== grp(b)) return grp(a) - grp(b);
      if (a.status === "done") return (a.validated_at ?? "").localeCompare(b.validated_at ?? "");
      return a.position - b.position;
    });
    let prev = startedAt ? new Date(startedAt).getTime() : null;
    return sorted.map((r, i) => {
      const st = statusOf(r);
      let ms: number | null = null;
      if (r.validated_at && prev != null) {
        ms = new Date(r.validated_at).getTime() - prev;
        prev = new Date(r.validated_at).getTime();
      } else if (st === "current" && prev != null) {
        ms = Date.now() - prev; // temps déjà passé dessus
      }
      return { route: r, step: steps.get(r.step_id), status: st, ms, index: i + 1 };
    });
  }, [routes, steps, startedAt]);

  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" });
  }, [focusStepId]);

  const doneCount = rows.filter((r) => r.status !== "todo" && r.status !== "current").length;
  const skipped = rows.filter((r) => r.status === "skipped").length;
  const redeemed = rows.filter((r) => r.status === "redeemed").length;

  return (
    <Dialog open onClose={onClose} title={`🗺️ Parcours — ${team.name}`}>
      <div className="space-y-3">
        <p className="font-bold text-ink/55 text-sm">
          {doneCount}/{rows.length} étapes faites
          {skipped > 0 && (
            <>
              {" · "}
              <span className="text-crimson">
                {skipped} passée{skipped > 1 ? "s" : ""}
              </span>
            </>
          )}
          {redeemed > 0 && (
            <>
              {" · "}
              <span className="text-leaf">
                {redeemed} rattrapée{redeemed > 1 ? "s" : ""}
              </span>
            </>
          )}
          {team.penalty_seconds > 0 &&
            ` · ${Math.round(team.penalty_seconds / 60)} min de pénalité au total`}
        </p>

        <ul className="space-y-1">
          {rows.map((row) => {
            const meta = STATUS[row.status];
            const focused = focusStepId === row.route.step_id;
            return (
              <li
                key={row.route.id}
                ref={focused ? focusRef : undefined}
                className={`flex items-center gap-2 rounded-lg border-2 px-2 py-1.5 ${
                  focused ? "border-gold bg-gold/15" : "border-ink/15"
                }`}
              >
                <span className="w-6 shrink-0 text-center font-bold text-ink/40 text-xs tabular-nums">
                  {row.index}
                </span>
                <span
                  className={`w-3 h-3 shrink-0 rounded-sm border-2 border-ink ${meta.dot}`}
                  style={meta.dot ? undefined : { backgroundColor: team.color }}
                  aria-hidden
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-sm leading-tight truncate">
                    {row.step ? STEP_ICON[row.step.type] : "❔"} {row.step?.title ?? "Étape supprimée"}
                  </span>
                  <span className={`block text-xs font-bold leading-tight ${meta.text}`}>
                    {meta.label}
                    {row.route.validated_at && ` · ${formatClock(row.route.validated_at)}`}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-display text-sm tabular-nums">
                    {row.ms != null && row.ms > 0 ? formatDuration(row.ms) : "—"}
                  </span>
                  {row.status === "current" && (
                    <span className="block font-bold text-gold text-[10px] leading-none">
                      en cours
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="font-bold text-ink/40 text-xs">
          Le temps affiché est celui écoulé depuis la validation précédente : il inclut le trajet
          jusqu&apos;au lieu de l&apos;épreuve.
        </p>
      </div>
    </Dialog>
  );
}
