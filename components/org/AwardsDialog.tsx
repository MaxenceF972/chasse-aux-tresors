"use client";

import { useMemo, useState } from "react";
import type { GameEvent, Team } from "@/lib/types";
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

/** Record de vitesse sur une énigme ou un mini-jeu (liste repliée par défaut). */
export interface StepRecord {
  stepId: string;
  stepTitle: string;
  icon: string;
  teamId: string;
  time: string;
  reason: string;
  amount: number;
}

interface AwardsDialogProps {
  open: boolean;
  onClose: () => void;
  scoring: "time" | "points";
  teams: Team[];
  /** Classement officiel, dans l'ordre (1er en tête). */
  ranked: Team[];
  trophies: Trophy[];
  /** Records par épreuve — repliés : on ne récompense pas 26 fois. */
  stepRecords: StepRecord[];
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
  ranked,
  trophies,
  stepRecords,
  bonusEvents,
  onAward,
  onRevoke,
}: AwardsDialogProps) {
  const isPoints = scoring === "points";
  const unit = isPoints ? "pts" : "min";
  const [busy, setBusy] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [podium, setPodium] = useState<string[]>(
    isPoints ? ["300", "200", "100"] : ["3", "2", "1"]
  );
  const [freeTeam, setFreeTeam] = useState("");
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

  async function run(items: AwardItem[]) {
    if (!items.length) return;
    setBusy(true);
    try {
      await onAward(items);
    } finally {
      setBusy(false);
    }
  }

  const top3 = ranked.slice(0, 3);
  const podiumItems: AwardItem[] = top3
    .map((t, i) => ({
      teamId: t.id,
      amount: Math.max(0, Math.round(Number(podium[i]) || 0)),
      reason: `podium — ${i + 1}${i === 0 ? "re" : "e"} place`,
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
                    <span className="font-display text-leaf">
                      +{value} {unit}
                    </span>
                  </span>
                ))}
            </div>
          )}
        </section>

        {/* 2. Le podium en un seul geste */}
        {top3.length > 0 && (
          <section className="rounded-xl border-[3px] border-ink bg-gold/15 p-3">
            <h3 className="font-display text-lg mb-1">🏆 Podium</h3>
            <p className="font-bold text-ink/55 text-xs mb-2">
              Les trois premières du classement, récompensées d&apos;un coup.
            </p>
            <div className="space-y-1.5">
              {top3.map((t, i) => {
                const reason = `podium — ${i + 1}${i === 0 ? "re" : "e"} place`;
                const done = awardedReasons.has(reason);
                return (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="text-xl shrink-0">{MEDALS[i]}</span>
                    <span
                      className="w-3 h-3 rounded-full border-2 border-ink shrink-0"
                      style={{ backgroundColor: t.color }}
                    />
                    <span className="font-display flex-1 min-w-0 truncate">{t.name}</span>
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
                : `🏆 ATTRIBUER LE PODIUM (${podiumItems.length})`}
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

        {/* 3 bis. Records par épreuve — repliés : c'est du détail, pas la
            liste d'actions principale. */}
        {stepRecords.length > 0 && (
          <section>
            <Button
              full
              size="md"
              variant="outline"
              onClick={() => setRecordsOpen((v) => !v)}
            >
              {recordsOpen ? "➖ MASQUER" : "⚡ RÉCOMPENSER UN RECORD"} ({stepRecords.length})
            </Button>
            {recordsOpen && (
              <div className="space-y-1.5 mt-2">
                <p className="font-bold text-ink/50 text-xs">
                  L&apos;équipe la plus rapide sur chaque énigme et mini-jeu — là où la
                  vitesse récompense la réflexion, pas les jambes.
                </p>
                {stepRecords.map((rec) => {
                  const done = awardedReasons.has(rec.reason);
                  return (
                    <div
                      key={rec.stepId}
                      className={`flex items-center gap-2 rounded-xl border-2 border-ink/15 px-2.5 py-1.5 ${
                        done ? "opacity-60" : ""
                      }`}
                    >
                      <span className="text-lg shrink-0" aria-hidden>
                        {rec.icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block font-bold text-sm truncate">{rec.stepTitle}</span>
                        <span
                          className="block font-display text-xs truncate"
                          style={{ color: teamColor(rec.teamId) }}
                        >
                          {teamName(rec.teamId)}
                          <span className="font-bold text-ink/45"> · {rec.time}</span>
                        </span>
                      </span>
                      {done ? (
                        <span className="font-bold text-leaf text-sm shrink-0">✅</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="gold"
                          className="shrink-0 !min-h-8 !py-0.5 !px-2 !text-xs"
                          disabled={busy}
                          onClick={() =>
                            run([
                              { teamId: rec.teamId, amount: rec.amount, reason: rec.reason },
                            ])
                          }
                        >
                          +{rec.amount}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 4. Bonus libre : fair-play, coup de cœur… */}
        <section>
          <h3 className="font-display text-lg mb-2">✨ Bonus libre</h3>
          <div className="space-y-2">
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
                  placeholder="fair-play, coup de cœur…"
                  maxLength={60}
                />
              </div>
            </div>
            <Button
              full
              size="md"
              disabled={busy || !freeTeam || !Number(freeAmount)}
              onClick={async () => {
                await run([
                  {
                    teamId: freeTeam,
                    amount: Math.round(Number(freeAmount)),
                    reason: freeReason.trim() || "bonus de l'organisateur",
                  },
                ]);
                setFreeReason("");
              }}
            >
              ✨ ATTRIBUER CE BONUS
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
                const amount =
                  pts !== 0
                    ? `+${pts} pts`
                    : `${sec > 0 ? "+" : "−"}${Math.abs(Math.round(sec / 60))} min`;
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
                      className={`font-display text-sm shrink-0 ${revoked ? "line-through" : ""}`}
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
