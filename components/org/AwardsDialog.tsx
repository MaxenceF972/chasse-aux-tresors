"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameEvent, Team } from "@/lib/types";
import { formatDuration } from "@/lib/game/format";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";

/** Une récompense proposée par l'app (record de la partie). */
export interface Trophy {
  key: string;
  icon: string;
  label: string;
  detail?: string;
  teamId: string;
  /** Texte enregistré avec le bonus — sert aussi de clé « déjà attribué ». */
  reason: string;
  amount: number;
}

export interface AwardItem {
  teamId: string;
  amount: number;
  reason: string;
}

/** Famille d'épreuve : elle porte la valeur du record (le type de l'étape). */
export type RecordFamily = "minigame" | "text" | "nfc" | "gps" | "photo";

/** Ce qu'on a chronométré : la partie jouée, ou le délai entre 2 validations. */
export type RecordMeasure = "play" | "gap";

/** Une place du podium de vitesse d'une épreuve. */
export interface StepRecord {
  /** stepId:rang — clé React et clé de sélection */
  key: string;
  stepId: string;
  stepTitle: string;
  family: RecordFamily;
  measure: RecordMeasure;
  /** 1 à 10 : 1 = le plus rapide */
  rank: number;
  teamId: string;
  time: string;
  /** Texte enregistré avec le bonus — sert aussi de clé « déjà attribué ». */
  reason: string;
}

/** Barème par défaut : la valeur suit la QUALITÉ de la mesure.
    Un mini-jeu se chronomètre au vrai temps de jeu (100), une énigme mélange
    réflexion et trajet (100 : ça reste de la tête). Sur une balise en
    revanche, chaque équipe arrive d'une étape différente : les chronos ne sont
    pas comparables, donc 0 — la liste reste affichée pour le débriefing, et
    l'organisateur peut toujours saisir un montant s'il le souhaite. */
const FAMILIES: {
  key: RecordFamily;
  icon: string;
  label: string;
  help: string;
  points: number;
  seconds: number;
}[] = [
  { key: "minigame", icon: "🎮", label: "Mini-jeux", help: "Durée réelle de jeu — la marche ne compte pas.", points: 100, seconds: 60 },
  { key: "text", icon: "❓", label: "Énigmes", help: "Temps entre deux validations : réflexion et trajet.", points: 100, seconds: 60 },
  { key: "nfc", icon: "🏷️", label: "Balises", help: "Info seulement : chaque équipe arrive d'un endroit différent.", points: 0, seconds: 0 },
  { key: "gps", icon: "📍", label: "Balises GPS", help: "Info seulement : chaque équipe arrive d'un endroit différent.", points: 0, seconds: 0 },
  { key: "photo", icon: "📸", label: "Photos", help: "Info seulement : chaque équipe arrive d'un endroit différent.", points: 0, seconds: 0 },
];

/** Classement d'une épreuve : chaque rang perd 10 % du plein (100, 90, 80…
    jusqu'au 10e à 10 %). Tout le monde marque selon sa place au lieu que le
    plus rapide rafle tout — la régularité devient payante. */
const RANK_RATIO = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
/** Rangs affichés d'emblée ; les suivants se déplient à la demande. */
const RANKS_SHOWN = 3;

interface AwardsDialogProps {
  open: boolean;
  onClose: () => void;
  scoring: "time" | "points";
  teams: Team[];
  /** Équipes ARRIVÉES au trésor, dans l'ordre d'arrivée (la 1re en tête). */
  arrived: Team[];
  trophies: Trophy[];
  /** Podiums de vitesse de toutes les épreuves, groupés par famille ici. */
  stepRecords: StepRecord[];
  /** Somme des points d'étape de la partie : sert à afficher le poids des bonus. */
  basePoints: number;
  /** Tous les événements bonus_awarded de la partie (révoqués compris). */
  bonusEvents: GameEvent[];
  onAward: (items: AwardItem[]) => Promise<void>;
  onRevoke: (eventId: number) => Promise<void>;
}

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Tout ce qui touche aux récompenses en UN seul endroit : ce qui a déjà été
 * donné (pour ne jamais se perdre), le podium en un geste, les trophées de
 * la partie avec leur montant, un bonus libre, et l'historique annulable.
 */
export default function AwardsDialog({
  open,
  onClose,
  scoring,
  teams,
  arrived,
  trophies,
  stepRecords,
  basePoints,
  bonusEvents,
  onAward,
  onRevoke,
}: AwardsDialogProps) {
  const isPoints = scoring === "points";
  const unit = isPoints ? "pts" : "min";
  // Les records se règlent en points, ou en SECONDES rendues en mode chrono :
  // un 3e de podium vaut moins d'une minute, la minute serait trop grossière.
  const recUnit = isPoints ? "pts" : "s";
  const [busy, setBusy] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(true);
  const [famValue, setFamValue] = useState<Record<RecordFamily, string>>(() =>
    Object.fromEntries(
      FAMILIES.map((f) => [f.key, String(isPoints ? f.points : f.seconds)])
    ) as Record<RecordFamily, string>
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Épreuves dont les rangs 4+ sont dépliés */
  const [openSteps, setOpenSteps] = useState<Set<string>>(new Set());
  // La sélection par défaut (les 🥇) ne se pose qu'UNE fois par ouverture :
  // sinon un rafraîchissement temps réel effacerait les cases décochées.
  const seeded = useRef(false);
  const [podium, setPodium] = useState<string[]>(
    isPoints ? ["300", "200", "100"] : ["3", "2", "1"]
  );
  const [freeTeam, setFreeTeam] = useState("");
  /** +1 = bonus, −1 = malus (le même canal, au signe près) */
  const [freeSign, setFreeSign] = useState<1 | -1>(1);
  const [freeAmount, setFreeAmount] = useState(isPoints ? "50" : "1");
  const [freeReason, setFreeReason] = useState("");

  // Les bonus vivants (non annulés) : état « déjà attribué » + totaux
  const live = useMemo(
    () => bonusEvents.filter((e) => !e.payload.revoked),
    [bonusEvents]
  );
  const awardedReasons = useMemo(
    () => new Set(live.map((e) => String(e.payload.reason ?? ""))),
    [live]
  );
  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of live) {
      if (!e.team_id) continue;
      const pts = Number(e.payload.points ?? 0);
      const sec = Number(e.payload.seconds ?? 0);
      const value = pts !== 0 ? pts : Math.round(-sec / 60);
      map.set(e.team_id, (map.get(e.team_id) ?? 0) + value);
    }
    return map;
  }, [live]);

  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? "?";
  const teamColor = (id: string) => teams.find((t) => t.id === id)?.color;

  // --- Records de vitesse ----------------------------------------------------

  /** Montant d'une place : points entiers, ou minutes (saisies en secondes). */
  function recordAmount(family: RecordFamily, rank: number): number {
    const base = Math.max(0, Number(famValue[family]) || 0);
    const raw = Math.round(base * (RANK_RATIO[rank - 1] ?? 0));
    return isPoints ? raw : raw / 60;
  }
  /** Affichage d'un montant dans l'unité de saisie (pts ou s). */
  const amountLabel = (a: number) => (isPoints ? `${a}` : `${Math.round(a * 60)}`);

  /** Les épreuves regroupées par famille, chacune avec son podium. */
  const grouped = useMemo(() => {
    return FAMILIES.map((fam) => {
      const byStep = new Map<string, StepRecord[]>();
      for (const r of stepRecords) {
        if (r.family !== fam.key) continue;
        byStep.set(r.stepId, [...(byStep.get(r.stepId) ?? []), r]);
      }
      return {
        fam,
        steps: [...byStep.values()].map((list) => ({
          id: list[0].stepId,
          title: list[0].stepTitle,
          measure: list[0].measure,
          list: list.slice().sort((a, b) => a.rank - b.rank),
        })),
      };
    }).filter((g) => g.steps.length > 0);
  }, [stepRecords]);

  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || stepRecords.length === 0) return;
    seeded.current = true;
    // Départ raisonnable : les 1res places non encore attribuées, et seulement
    // dans les familles qui rapportent quelque chose. Le podium complet se
    // coche famille par famille, en connaissance de cause.
    setSelected(
      new Set(
        stepRecords
          .filter(
            (r) =>
              r.rank === 1 &&
              !awardedReasons.has(r.reason) &&
              (Number(famValue[r.family]) || 0) > 0
          )
          .map((r) => r.key)
      )
    );
  }, [open, stepRecords, awardedReasons, famValue]);

  const pendingRecords = stepRecords.filter(
    (r) => selected.has(r.key) && !awardedReasons.has(r.reason)
  );
  const recordItems: AwardItem[] = pendingRecords
    .map((r) => ({
      teamId: r.teamId,
      amount: recordAmount(r.family, r.rank),
      reason: r.reason,
    }))
    .filter((it) => it.amount > 0);
  const recordTotal = recordItems.reduce((s, it) => s + it.amount, 0);
  // Ce qui compte n'est pas la masse distribuée (elle se répartit sur dix
  // équipes) mais ce qu'une SEULE équipe peut encaisser : c'est ça qui bouge
  // le classement.
  const perTeamTotal = new Map<string, number>();
  for (const it of recordItems) {
    perTeamTotal.set(it.teamId, (perTeamTotal.get(it.teamId) ?? 0) + it.amount);
  }
  const bestTeamTotal = Math.max(0, ...perTeamTotal.values());
  const recordShare =
    isPoints && basePoints > 0 ? Math.round((bestTeamTotal / basePoints) * 100) : null;

  function setFamilySelection(fam: RecordFamily, ranks: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of stepRecords) {
        if (r.family !== fam) continue;
        if (r.rank <= ranks) next.add(r.key);
        else next.delete(r.key);
      }
      return next;
    });
  }

  async function run(items: AwardItem[]) {
    if (!items.length) return;
    setBusy(true);
    try {
      await onAward(items);
    } finally {
      setBusy(false);
    }
  }

  const top3 = arrived.slice(0, 3);
  /** Motif du podium d'arrivée — visible des joueurs, donc explicite. */
  const arrivalReason = (i: number) => `${i + 1}${i === 0 ? "re" : "e"} arrivée au trésor`;
  const podiumItems: AwardItem[] = top3
    .map((t, i) => ({
      teamId: t.id,
      amount: Math.max(0, Math.round(Number(podium[i]) || 0)),
      reason: arrivalReason(i),
    }))
    .filter((it) => it.amount > 0 && !awardedReasons.has(it.reason));

  return (
    <Dialog open={open} onClose={onClose} title="🏅 Récompenses">
      <div className="space-y-5">
        {/* 1. Ce qui a déjà été donné — la réponse à « où j'en suis ? » */}
        <section>
          <h3 className="font-display text-lg mb-2">Déjà attribué</h3>
          {totals.size === 0 ? (
            <p className="font-bold text-ink/55 text-sm">
              Rien pour l&apos;instant — tout est à distribuer.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[...totals.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([teamId, value]) => (
                  <span
                    key={teamId}
                    className="inline-flex items-center gap-1.5 rounded-lg border-2 border-ink bg-white/70 px-2 py-1 font-bold text-sm"
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-ink shrink-0"
                      style={{ backgroundColor: teamColor(teamId) }}
                    />
                    <span className="truncate max-w-[9rem]">{teamName(teamId)}</span>
                    {/* Le solde peut être négatif (photo refusée) : pas de « +− » */}
                    <span className={`font-display ${value < 0 ? "text-crimson" : "text-leaf"}`}>
                      {value > 0 ? "+" : ""}
                      {value} {unit}
                    </span>
                  </span>
                ))}
            </div>
          )}
        </section>

        {/* 2. Le podium en un seul geste */}
        {top3.length > 0 && (
          <section className="rounded-xl border-[3px] border-ink bg-gold/15 p-3">
            <h3 className="font-display text-lg mb-1">🏁 Podium d&apos;arrivée</h3>
            <p className="font-bold text-ink/55 text-xs mb-2">
              Les trois premières équipes rentrées au trésor, dans leur ordre d&apos;arrivée.
            </p>
            <div className="space-y-1.5">
              {top3.map((t, i) => {
                const reason = arrivalReason(i);
                const done = awardedReasons.has(reason);
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{MEDALS[i]}</span>
                    <span
                      className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-display truncate leading-tight">{t.name}</span>
                      {t.final_time_ms != null && (
                        <span className="block font-bold text-ink/45 text-xs tabular-nums">
                          {formatDuration(t.final_time_ms)}
                        </span>
                      )}
                    </span>
                    {done ? (
                      <span className="font-bold text-leaf text-sm shrink-0">✅</span>
                    ) : (
                      // Largeur imposée par le conteneur : l'Input est w-full
                      // par nature, un w-16 sur lui ne gagnerait pas.
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="w-16">
                          <Input
                            value={podium[i]}
                            onChange={(e) =>
                              setPodium((p) =>
                                p.map((v, j) => (j === i ? e.target.value.replace(/\D/g, "") : v))
                              )
                            }
                            inputMode="numeric"
                            className="!h-9 !px-1 !text-base text-center font-mono"
                            aria-label={`Montant ${i + 1}e place`}
                          />
                        </span>
                        <span className="font-bold text-ink/50 text-xs">{unit}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <Button
              full
              size="md"
              variant="gold"
              className="mt-2.5"
              disabled={busy || podiumItems.length === 0}
              onClick={() => run(podiumItems)}
            >
              {podiumItems.length === 0
                ? "✅ PODIUM DÉJÀ RÉCOMPENSÉ"
                : `🏁 ATTRIBUER LE PODIUM (${podiumItems.length})`}
            </Button>
          </section>
        )}

        {/* 3. Les trophées de la partie */}
        {trophies.length > 0 && (
          <section>
            <h3 className="font-display text-lg mb-2">🎖️ Trophées</h3>
            <div className="space-y-1.5">
              {trophies.map((tr) => {
                const done = awardedReasons.has(tr.reason);
                return (
                  <div
                    key={tr.key}
                    className={`flex items-center gap-2 rounded-xl border-2 border-ink/20 px-3 py-2 ${
                      done ? "opacity-60" : ""
                    }`}
                  >
                    <span className="text-xl shrink-0">{tr.icon}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm leading-tight">{tr.label}</span>
                      <span
                        className="block font-display text-sm truncate"
                        style={{ color: teamColor(tr.teamId) }}
                      >
                        {teamName(tr.teamId)}
                        {tr.detail && (
                          <span className="font-bold text-ink/45"> · {tr.detail}</span>
                        )}
                      </span>
                    </span>
                    {done ? (
                      <span className="font-bold text-leaf text-sm shrink-0">✅</span>
                    ) : (
                      <Button
                        size="sm"
                        variant="gold"
                        className="shrink-0"
                        disabled={busy}
                        onClick={() =>
                          run([{ teamId: tr.teamId, amount: tr.amount, reason: tr.reason }])
                        }
                      >
                        +{tr.amount} {unit}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* 3 bis. Records de vitesse : toutes les épreuves, par famille, avec
            leur podium. C'est ici que se joue ce qui départage vraiment. */}
        {grouped.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="font-display text-lg">⚡ Records de vitesse</h3>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 !min-h-8 !py-0.5 !px-2.5 !text-xs"
                onClick={() => setRecordsOpen((v) => !v)}
              >
                {recordsOpen ? "➖ REPLIER" : `➕ VOIR (${stepRecords.length})`}
              </Button>
            </div>

            {recordsOpen && (
              <div className="space-y-3">
                <p className="font-bold text-ink/50 text-xs">
                  Sur chaque épreuve, les 10 plus rapides marquent selon leur rang : la 1re
                  touche le plein, puis <strong>−10 % par place</strong> (100, 90, 80… jusqu&apos;à
                  10). Ajuste la valeur par famille, coche ce que tu donnes, le total s&apos;affiche
                  en bas.
                </p>

                {grouped.map(({ fam, steps }) => (
                  <div key={fam.key} className="rounded-xl border-[3px] border-ink/20 p-2.5 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="text-xl shrink-0" aria-hidden>
                        {fam.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-display leading-tight">{fam.label}</span>
                        <span className="block font-bold text-ink/50 text-xs leading-tight">
                          {fam.help}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <span className="w-16">
                          <Input
                            value={famValue[fam.key]}
                            onChange={(e) =>
                              setFamValue((v) => ({
                                ...v,
                                [fam.key]: e.target.value.replace(/\D/g, ""),
                              }))
                            }
                            inputMode="numeric"
                            className="!h-9 !px-1 !text-base text-center font-mono"
                            aria-label={`Valeur du 1er — ${fam.label}`}
                          />
                        </span>
                        <span className="font-bold text-ink/50 text-xs">{recUnit}</span>
                      </span>
                    </div>

                    <div className="flex gap-1.5">
                      {[
                        { label: "🥇 1res", ranks: 1 },
                        { label: "🏅 Top 10", ranks: RANK_RATIO.length },
                        { label: "✕ Aucune", ranks: 0 },
                      ].map((opt) => (
                        <button
                          key={opt.ranks}
                          type="button"
                          onClick={() => setFamilySelection(fam.key, opt.ranks)}
                          className="flex-1 min-h-9 rounded-lg border-2 border-ink bg-white font-bold text-xs active:bg-gold"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {steps.map((st) => {
                      const stepOpen = openSteps.has(st.id);
                      const hidden = st.list.filter((r) => r.rank > RANKS_SHOWN);
                      const shown = stepOpen ? st.list : st.list.slice(0, RANKS_SHOWN);
                      const hiddenTotal = hidden.reduce(
                        (s, r) => s + recordAmount(r.family, r.rank),
                        0
                      );
                      return (
                      <div key={st.id} className="rounded-lg border-2 border-ink/15 px-2 py-1.5">
                        <p className="font-bold text-sm truncate">
                          {st.title}
                          {st.measure === "play" && (
                            <span className="font-bold text-ink/40 text-xs"> · temps de jeu</span>
                          )}
                        </p>
                        {shown.map((rec) => {
                          const done = awardedReasons.has(rec.reason);
                          const amount = recordAmount(rec.family, rec.rank);
                          return (
                            <label
                              key={rec.key}
                              className={`flex items-center gap-2 min-h-9 ${
                                done ? "opacity-55" : "cursor-pointer"
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="w-5 h-5 shrink-0 accent-[#2E5E3A]"
                                checked={!done && selected.has(rec.key)}
                                disabled={done || busy}
                                onChange={(e) =>
                                  setSelected((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) next.add(rec.key);
                                    else next.delete(rec.key);
                                    return next;
                                  })
                                }
                              />
                              {/* Médaille jusqu'au 3e, puis le rang en clair */}
                              <span
                                className="shrink-0 w-5 text-center font-bold text-ink/50 text-xs"
                                aria-hidden
                              >
                                {MEDALS[rec.rank - 1] ?? rec.rank}
                              </span>
                              <span
                                className="flex-1 min-w-0 truncate font-display text-sm"
                                style={{ color: teamColor(rec.teamId) }}
                              >
                                {teamName(rec.teamId)}
                              </span>
                              <span className="shrink-0 font-bold text-ink/45 text-xs tabular-nums">
                                {rec.time}
                              </span>
                              <span className="shrink-0 w-12 text-right font-display text-sm">
                                {done ? "✅" : amount > 0 ? `+${amountLabel(amount)}` : "—"}
                              </span>
                            </label>
                          );
                        })}
                        {hidden.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenSteps((prev) => {
                                const next = new Set(prev);
                                if (next.has(st.id)) next.delete(st.id);
                                else next.add(st.id);
                                return next;
                              })
                            }
                            className="w-full min-h-8 text-left font-bold text-ink/50 text-xs"
                            aria-expanded={stepOpen}
                          >
                            {stepOpen
                              ? "▴ masquer les autres équipes"
                              : `▾ ${hidden.length} autre${hidden.length > 1 ? "s" : ""} équipe${
                                  hidden.length > 1 ? "s" : ""
                                }${hiddenTotal > 0 ? ` (+${amountLabel(hiddenTotal)} ${recUnit})` : ""}`}
                          </button>
                        )}
                      </div>
                      );
                    })}
                  </div>
                ))}

                <div className="rounded-xl border-[3px] border-ink bg-gold/15 p-3">
                  <p className="font-bold text-sm">
                    {recordItems.length} récompense{recordItems.length > 1 ? "s" : ""} sélectionnée
                    {recordItems.length > 1 ? "s" : ""} ·{" "}
                    <span className="font-display">
                      {isPoints
                        ? `${recordTotal} pts`
                        : `${Math.round(recordTotal * 60)} s rendues`}
                    </span>
                  </p>
                  {bestTeamTotal > 0 && (
                    <p className="font-bold text-ink/55 text-xs mt-0.5">
                      L&apos;équipe la mieux servie encaisse{" "}
                      <strong>
                        {isPoints
                          ? `${bestTeamTotal} pts`
                          : `${Math.round(bestTeamTotal * 60)} s`}
                      </strong>
                      {recordShare != null && ` — ${recordShare} % de son score de parcours`}.
                    </p>
                  )}
                  {recordShare != null && recordShare > 60 && (
                    <p className="font-bold text-crimson text-xs mt-1">
                      ⚠️ À ce niveau, les bonus pèsent plus lourd que le parcours lui-même :
                      c&apos;est la vitesse qui fera le classement, pas les épreuves.
                    </p>
                  )}
                  <Button
                    full
                    size="md"
                    variant="gold"
                    className="mt-2"
                    disabled={busy || recordItems.length === 0}
                    onClick={() => run(recordItems)}
                  >
                    {recordItems.length === 0
                      ? "AUCUNE SÉLECTION"
                      : `⚡ ATTRIBUER LA SÉLECTION (${recordItems.length})`}
                  </Button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 4. Bonus OU malus libre : fair-play, triche, retard… à tout moment */}
        <section>
          <h3 className="font-display text-lg mb-2">✨ Bonus / malus libre</h3>
          <div className="space-y-2">
            {/* Le sens se choisit AVANT le montant : impossible de se tromper
                de signe, et le bouton final dit ce qu'il va faire. */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFreeSign(1)}
                className={`flex-1 min-h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                  freeSign === 1 ? "bg-leaf text-parchment" : "bg-white text-ink/60"
                }`}
              >
                🏅 BONUS
              </button>
              <button
                type="button"
                onClick={() => setFreeSign(-1)}
                className={`flex-1 min-h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                  freeSign === -1 ? "bg-crimson text-parchment" : "bg-white text-ink/60"
                }`}
              >
                ⚠️ MALUS
              </button>
            </div>
            <div>
              <Label>Équipe</Label>
              <select
                value={freeTeam}
                onChange={(e) => setFreeTeam(e.target.value)}
                className="w-full min-w-0 h-12 rounded-xl border-[3px] border-ink bg-white px-3 font-bold text-ink"
              >
                <option value="">— choisir —</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <Label>{isPoints ? "Points" : "Minutes"}</Label>
                <Input
                  value={freeAmount}
                  onChange={(e) => setFreeAmount(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  className="text-center font-mono"
                />
              </div>
              <div className="flex-1 min-w-0">
                <Label>Motif</Label>
                <Input
                  value={freeReason}
                  onChange={(e) => setFreeReason(e.target.value)}
                  placeholder={
                    freeSign === 1 ? "fair-play, coup de cœur…" : "retard, hors zone, triche…"
                  }
                  maxLength={60}
                />
              </div>
            </div>
            <Button
              full
              size="md"
              variant={freeSign === -1 ? "crimson" : "gold"}
              disabled={busy || !freeTeam || !Number(freeAmount)}
              onClick={async () => {
                await run([
                  {
                    teamId: freeTeam,
                    // Un malus, c'est le même canal avec le signe inverse :
                    // points retirés, ou temps ajouté en mode chrono.
                    amount: freeSign * Math.round(Number(freeAmount)),
                    reason:
                      freeReason.trim() ||
                      (freeSign === -1 ? "malus de l'organisateur" : "bonus de l'organisateur"),
                  },
                ]);
                setFreeReason("");
              }}
            >
              {freeSign === -1
                ? `⚠️ RETIRER ${Number(freeAmount) || 0} ${unit}`
                : `🏅 ATTRIBUER ${Number(freeAmount) || 0} ${unit}`}
            </Button>
          </div>
        </section>

        {/* 5. Historique : tout reste rattrapable */}
        <section>
          <h3 className="font-display text-lg mb-2">
            📜 Historique {live.length > 0 && `(${live.length})`}
          </h3>
          {bonusEvents.length === 0 ? (
            <p className="font-bold text-ink/55 text-sm">Aucun bonus attribué.</p>
          ) : (
            <div className="space-y-1.5">
              {bonusEvents.map((ev) => {
                const pts = Number(ev.payload.points ?? 0);
                const sec = Number(ev.payload.seconds ?? 0);
                const revoked = !!ev.payload.revoked;
                // Un malus (photo refusée) descend ici aussi : jamais de « +−50 »
                const amount =
                  pts !== 0
                    ? `${pts > 0 ? "+" : ""}${pts} pts`
                    : `${sec > 0 ? "+" : "−"}${Math.abs(Math.round(sec / 60))} min`;
                const bad = pts < 0 || sec > 0;
                return (
                  <div
                    key={ev.id}
                    className={`flex items-center gap-2 rounded-xl border-2 border-ink/20 px-3 py-1.5 ${
                      revoked ? "opacity-50" : ""
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-ink shrink-0"
                      style={{ backgroundColor: ev.team_id ? teamColor(ev.team_id) : undefined }}
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-sm truncate">
                        {ev.team_id ? teamName(ev.team_id) : "Équipe supprimée"}
                      </span>
                      <span className="block font-bold text-ink/45 text-xs truncate">
                        {String(ev.payload.reason ?? "")}
                        {revoked && " · ↩️ annulé"}
                      </span>
                    </span>
                    <span
                      className={`font-display text-sm shrink-0 ${revoked ? "line-through" : ""} ${
                        bad ? "text-crimson" : ""
                      }`}
                    >
                      {amount}
                    </span>
                    {!revoked && (
                      <Button
                        size="sm"
                        variant="outline-crimson"
                        className="shrink-0 !min-h-8 !py-0.5 !px-2.5 !text-xs"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onRevoke(ev.id);
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        ↩️
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="font-bold text-ink/45 text-xs mt-2">
            Pour corriger un montant : annule (↩️) puis ré-attribue.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
