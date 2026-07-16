"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sb, rpc } from "@/lib/supabase/client";
import type { Game, GameEvent, Player, RankingData, Step, Submission, Team, TeamRoute } from "@/lib/types";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { formatClock, formatDuration } from "@/lib/game/format";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Chrono, { gameElapsedMs } from "@/components/ui/Chrono";
import Dialog from "@/components/ui/Dialog";
import { Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import TeamMap from "@/components/org/TeamMap";

const START_ERRORS: Record<string, string> = {
  AUCUNE_EQUIPE: "Aucune équipe n'a rejoint le lobby.",
  AUCUNE_ETAPE: "Le parcours est vide — ajoute des étapes dans l'éditeur.",
  POOL_TROP_PETIT:
    "Pas assez d'énigmes dans le pool aléatoire : il en faut au moins autant que d'équipes pour garantir que personne ne se suive.",
};

function eventLabel(e: GameEvent, teamName: string | undefined, stepTitle?: string): string {
  const team = teamName ?? "—";
  switch (e.type) {
    case "game_started": return "🚀 La partie est lancée !";
    case "game_paused": return "⏸️ Partie mise en pause";
    case "game_resumed": return "▶️ Reprise de la partie";
    case "game_finished": return "🏁 Partie terminée par l'organisateur";
    case "team_created": return `⛺ Équipe « ${team} » créée`;
    case "player_joined": return `👤 ${String(e.payload.nickname ?? "?")} a rejoint « ${team} »`;
    case "step_validated": return `✅ « ${team} » a validé « ${String(e.payload.step_title ?? stepTitle ?? "?")} » (${String(e.payload.kind)})`;
    case "wrong_answer": return `❌ « ${team} » s'est trompé sur « ${String(e.payload.step_title ?? "?")} »`;
    case "hint_unlocked": return `💡 « ${team} » a débloqué un indice (+${Math.round(Number(e.payload.penalty_sec ?? 0) / 60)} min)`;
    case "hint_sent": return `📨 Indice envoyé à « ${team} » : ${String(e.payload.message ?? "")}`;
    case "manual_validate": return `🛠️ Étape validée manuellement pour « ${team} »`;
    case "photo_submitted": return `📸 « ${team} » a envoyé une photo pour « ${String(e.payload.step_title ?? "?")} »`;
    case "photo_rejected": return `🙅 Photo de « ${team} » refusée`;
    case "team_finished": return `🏆 « ${team} » a terminé le parcours !`;
    default: return `${e.type}`;
  }
}

export default function LiveDashboardPage() {
  const { user, loading } = useOrgAuth();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [routes, setRoutes] = useState<TeamRoute[]>([]);
  const [events, setEvents] = useState<GameEvent[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [rank, setRank] = useState<RankingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hintTarget, setHintTarget] = useState<Team | null>(null);
  const [hintMessage, setHintMessage] = useState("");
  const [manageTeam, setManageTeam] = useState<Team | null>(null);

  const load = useCallback(async () => {
    const [g, t, p, s, r, e, sub] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("teams").select("*").eq("game_id", gameId).order("created_at"),
      sb().from("players").select("*").eq("game_id", gameId),
      sb().from("steps").select("*").eq("game_id", gameId),
      sb().from("team_routes").select("*").eq("game_id", gameId),
      sb().from("events").select("*").eq("game_id", gameId).order("id", { ascending: false }).limit(120),
      sb().from("submissions").select("*").eq("game_id", gameId).eq("status", "pending").order("created_at"),
    ]);
    if (g.data) {
      setGame(g.data as Game);
      rpc<RankingData>("get_ranking", { p_code: (g.data as Game).code })
        .then((data) => setRank(data.error ? null : data))
        .catch(() => {});
    }
    setTeams((t.data as Team[]) ?? []);
    setPlayers((p.data as Player[]) ?? []);
    setSteps((s.data as Step[]) ?? []);
    setRoutes((r.data as TeamRoute[]) ?? []);
    setEvents((e.data as GameEvent[]) ?? []);
    setSubmissions((sub.data as Submission[]) ?? []);
  }, [gameId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);
  useGameInvalidate(user ? gameId : null, load);

  // Filet de sécurité si le Realtime décroche (et rafraîchit la carte GPS)
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [user, load]);

  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playersByTeam = useMemo(() => {
    const map = new Map<string, Player[]>();
    for (const p of players) {
      map.set(p.team_id, [...(map.get(p.team_id) ?? []), p]);
    }
    return map;
  }, [players]);

  interface TeamLive {
    team: Team;
    done: number;
    total: number;
    current: { step: Step; since: string | null } | null;
    lastValidatedAt: string | null;
  }

  const ranking = useMemo<TeamLive[]>(() => {
    const rows = teams.map((team) => {
      const teamRoutes = routes.filter((r) => r.team_id === team.id);
      const done = teamRoutes.filter((r) => r.status === "done").length;
      const currentRoute = teamRoutes.find((r) => r.status === "current");
      const validated = teamRoutes
        .filter((r) => r.validated_at)
        .sort((a, b) => (a.validated_at! < b.validated_at! ? 1 : -1));
      const currentStep = currentRoute ? stepMap.get(currentRoute.step_id) : undefined;
      return {
        team,
        done,
        total: teamRoutes.length,
        current: currentStep
          ? { step: currentStep, since: validated[0]?.validated_at ?? game?.started_at ?? null }
          : null,
        lastValidatedAt: validated[0]?.validated_at ?? null,
      };
    });
    // L'ordre officiel vient de get_ranking (respecte le mode temps/points)
    if (rank?.teams?.length) {
      const order = new Map(rank.teams.map((t, i) => [t.id, i]));
      return rows.sort((a, b) => (order.get(a.team.id) ?? 99) - (order.get(b.team.id) ?? 99));
    }
    return rows.sort((a, b) => {
      if (a.done !== b.done) return b.done - a.done;
      const fa = a.team.finished_at ? new Date(a.team.finished_at).getTime() : Infinity;
      const fb = b.team.finished_at ? new Date(b.team.finished_at).getTime() : Infinity;
      if (fa !== fb) return fa - fb;
      return a.team.name.localeCompare(b.team.name);
    });
  }, [teams, routes, stepMap, game?.started_at, rank]);

  const rankMap = useMemo(
    () => new Map((rank?.teams ?? []).map((t) => [t.id, t])),
    [rank]
  );

  async function doStart() {
    setBusy(true);
    setError(null);
    try {
      await rpc("start_game", { p_game_id: gameId });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const key = Object.keys(START_ERRORS).find((k) => raw.includes(k));
      setError(key ? START_ERRORS[key] : raw);
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function setStatus(status: "paused" | "running" | "finished") {
    if (status === "finished" && !confirm("Terminer la partie pour tout le monde ?")) return;
    setBusy(true);
    try {
      await rpc("org_set_status", { p_game_id: gameId, p_status: status });
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function forceValidate(live: TeamLive) {
    if (!live.current) return;
    if (!confirm(`Valider « ${live.current.step.title} » pour « ${live.team.name} » ?`)) return;
    await rpc("org_force_validate", { p_team_id: live.team.id, p_step_id: live.current.step.id });
    void load();
  }

  async function sendHint() {
    if (!hintTarget || !hintMessage.trim()) return;
    const message = hintMessage.trim();
    await rpc("org_send_hint", { p_team_id: hintTarget.id, p_message: message });
    // Notification push en bonus (vibre même app fermée) — best-effort
    try {
      const { data } = await sb().auth.getSession();
      if (data.session) {
        void fetch("/api/push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ team_id: hintTarget.id, message }),
        });
      }
    } catch {
      /* push optionnel */
    }
    setHintTarget(null);
    setHintMessage("");
    void load();
  }

  async function renameTeam(team: Team) {
    const name = prompt(`Nouveau nom pour « ${team.name} » :`, team.name);
    if (!name?.trim()) return;
    await rpc("org_rename_team", { p_team_id: team.id, p_name: name.trim() });
    void load();
  }

  async function deleteTeam(team: Team) {
    if (!confirm(`Supprimer l'équipe « ${team.name} » et ses joueurs ?`)) return;
    await rpc("org_delete_team", { p_team_id: team.id });
    void load();
  }

  async function reviewPhoto(submission: Submission, approve: boolean) {
    await rpc("org_review_photo", { p_submission_id: submission.id, p_approve: approve });
    void load();
  }

  async function kickPlayer(player: Player) {
    if (!confirm(`Retirer ${player.nickname} de la partie ? (il pourra re-rejoindre avec le code)`))
      return;
    await sb().from("players").delete().eq("id", player.id);
    void load();
  }

  if (loading || !user || !game) return <Spinner label="Chargement…" />;

  const poolCount = steps.filter((s) => !s.is_common_checkpoint && !s.is_final).length;

  return (
    <main className="min-h-dvh px-5 py-6 max-w-3xl mx-auto pb-24">
      <header className="mb-6">
        <nav className="flex gap-4 flex-wrap">
          <Link href="/org/dashboard" className="font-bold text-parchment/70 underline py-2 inline-block">
            ← Mes parties
          </Link>
          <Link href={`/org/games/${gameId}/edit`} className="font-bold text-parchment/70 underline py-2 inline-block">
            ✏️ Éditeur
          </Link>
          <Link href={`/org/games/${gameId}/balises`} className="font-bold text-parchment/70 underline py-2 inline-block">
            🏷️ Balises
          </Link>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
          <div>
            <h1 className="font-display text-3xl text-parchment leading-tight">{game.name}</h1>
            <p className="font-mono font-bold text-gold tracking-[0.3em] text-xl">{game.code}</p>
          </div>
          {game.started_at && (
            <div className="text-right">
              <Chrono
                elapsedMs={gameElapsedMs(game)}
                ticking={game.status === "running"}
                className="font-display text-3xl text-gold"
              />
              <p className="text-parchment/50 font-bold text-xs uppercase">
                {game.status === "paused" ? "⏸️ Chrono figé" : "Chrono de partie"}
              </p>
            </div>
          )}
        </div>
      </header>

      {/* Actions globales */}
      <div className="flex flex-wrap gap-2 mb-6">
        {game.status === "lobby" && (
          <Button size="lg" disabled={busy} onClick={doStart}>
            🚀 LANCER LA PARTIE
          </Button>
        )}
        {game.status === "running" && (
          <Button variant="parchment" disabled={busy} onClick={() => setStatus("paused")}>
            ⏸️ Pause
          </Button>
        )}
        {game.status === "paused" && (
          <Button variant="leaf" disabled={busy} onClick={() => setStatus("running")}>
            ▶️ Reprendre
          </Button>
        )}
        {(game.status === "running" || game.status === "paused") && (
          <Button variant="crimson" disabled={busy} onClick={() => setStatus("finished")}>
            🏁 Terminer
          </Button>
        )}
      </div>

      {error && (
        <Card className="p-4 mb-6 bg-crimson">
          <p className="font-bold text-parchment">⚠️ {error}</p>
        </Card>
      )}

      {game.status === "lobby" && (
        <Card className="p-4 mb-6">
          <h2 className="font-display text-lg mb-1">En attente dans le lobby…</h2>
          <p className="font-bold text-ink/60 text-sm mb-3">
            {teams.length} équipe{teams.length > 1 ? "s" : ""} · {players.length} joueur
            {players.length > 1 ? "s" : ""} · {poolCount} énigme{poolCount > 1 ? "s" : ""} dans le
            pool {teams.length > poolCount && poolCount > 0 && "⚠️ pool trop petit !"}
          </p>
          {teams.length === 0 ? (
            <p className="font-bold text-ink/50">
              Partage le code <span className="font-mono">{game.code}</span> pour que les équipes
              se forment.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {teams.map((team) => (
                <li key={team.id} className="flex items-center gap-2 font-bold">
                  <span
                    className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="min-w-0 truncate">{team.name}</span>
                  <span className="text-ink/50 text-sm flex-1 min-w-0 truncate">
                    {Array.from(
                      new Set([
                        ...(playersByTeam.get(team.id) ?? []).map((p) => p.nickname),
                        ...(team.roster ?? []),
                      ])
                    ).join(", ") || "vide"}
                  </span>
                  <button
                    className="w-10 h-10 rounded-lg border-2 border-ink bg-white shrink-0 active:bg-parchment-dark"
                    onClick={() => setManageTeam(team)}
                    aria-label="Gérer les joueurs"
                  >
                    👥
                  </button>
                  <button
                    className="w-10 h-10 rounded-lg border-2 border-ink bg-white shrink-0 active:bg-parchment-dark"
                    onClick={() => renameTeam(team)}
                    aria-label="Renommer l'équipe"
                  >
                    ✏️
                  </button>
                  <button
                    className="w-10 h-10 rounded-lg border-2 border-ink bg-crimson text-parchment shrink-0 active:bg-crimson-dark"
                    onClick={() => deleteTeam(team)}
                    aria-label="Supprimer l'équipe"
                  >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Photos à valider */}
      {submissions.length > 0 && (
        <>
          <h2 className="font-display text-2xl text-gold mb-3 animate-pulse">
            📸 Photos à valider ({submissions.length})
          </h2>
          <div className="space-y-4 mb-8">
            {submissions.map((submission) => {
              const team = teamMap.get(submission.team_id);
              const step = stepMap.get(submission.step_id);
              return (
                <Card key={submission.id} className="p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                      style={{ backgroundColor: team?.color }}
                    />
                    <span className="font-display truncate">{team?.name ?? "?"}</span>
                    <span className="font-bold text-ink/50 text-sm truncate">
                      — {step?.title ?? "?"}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={submission.url}
                    alt={`Photo de ${team?.name ?? "?"}`}
                    className="w-full max-h-80 object-contain rounded-xl border-[3px] border-ink bg-ink mb-3"
                  />
                  <div className="flex gap-2">
                    <Button className="flex-1" variant="leaf" onClick={() => reviewPhoto(submission, true)}>
                      ✅ VALIDER
                    </Button>
                    <Button className="flex-1" variant="crimson" onClick={() => reviewPhoto(submission, false)}>
                      ❌ REFUSER
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Carte de suivi GPS */}
      {game.status !== "lobby" && (
        <>
          <h2 className="font-display text-2xl text-parchment mb-3">📍 Sur le terrain</h2>
          <div className="mb-3">
            <TeamMap players={players} teams={teams} />
          </div>
          {players.some((p) => p.last_lat != null) && (
            <ul className="mb-8 space-y-1">
              {players
                .filter((p) => p.last_lat != null && p.last_lng != null)
                .sort((a, b) => (a.pos_updated_at ?? "") < (b.pos_updated_at ?? "") ? 1 : -1)
                .map((p) => {
                  const ageMin = p.pos_updated_at
                    ? Math.round((Date.now() - new Date(p.pos_updated_at).getTime()) / 60000)
                    : null;
                  return (
                    <li key={p.id} className="flex items-center gap-2 font-bold text-sm text-parchment/80">
                      <span
                        className="w-3 h-3 rounded-full border border-parchment/40 shrink-0"
                        style={{ backgroundColor: teamMap.get(p.team_id)?.color }}
                      />
                      <span className="truncate">{p.nickname}</span>
                      <span className="text-parchment/45">
                        {ageMin != null ? (ageMin < 1 ? "à l'instant" : `il y a ${ageMin} min`) : ""}
                      </span>
                      <a
                        className="ml-auto underline text-parchment/60 py-1"
                        href={`https://maps.google.com/?q=${p.last_lat},${p.last_lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        🗺️ Maps
                      </a>
                    </li>
                  );
                })}
            </ul>
          )}
          {!players.some((p) => p.last_lat != null) && <div className="mb-8" />}
        </>
      )}

      {/* Classement live */}
      {game.status !== "lobby" && (
        <>
          <h2 className="font-display text-2xl text-parchment mb-3">
            Classement live
            {game.settings.scoring === "points" && (
              <span className="text-gold text-base ml-2">(au barème points)</span>
            )}
          </h2>
          <div className="space-y-3 mb-8">
            {ranking.map((live, i) => (
              <Card key={live.team.id} className="p-4">
                <div className="flex items-center gap-3 mb-2">
                  <span className="font-display text-2xl w-8">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>
                  <span
                    className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: live.team.color }}
                  />
                  <span className="font-display text-lg flex-1 truncate">{live.team.name}</span>
                  <span className="font-bold text-ink/60 tabular-nums">
                    {live.done}/{live.total}
                  </span>
                </div>

                {/* Barre de progression */}
                <div className="h-3.5 rounded-full border-2 border-ink bg-white overflow-hidden mb-2">
                  <div
                    className="h-full transition-[width] duration-500"
                    style={{
                      width: `${live.total ? (live.done / live.total) * 100 : 0}%`,
                      backgroundColor: live.team.color,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="font-bold text-sm text-ink/70 min-w-0">
                    {live.team.finished_at ? (
                      <>
                        🏆 Terminé en{" "}
                        {formatDuration(
                          rankMap.get(live.team.id)?.time_ms ??
                            (live.team.final_time_ms ?? 0) + live.team.penalty_seconds * 1000
                        )}
                        {live.team.penalty_seconds > 0 &&
                          ` (dont ${Math.round(live.team.penalty_seconds / 60)} min de pénalité)`}
                        {game.settings.scoring === "points" &&
                          ` · ${Math.round(rankMap.get(live.team.id)?.points ?? 0)} pts`}
                      </>
                    ) : live.current ? (
                      <>
                        ➡️ {live.current.step.title}
                        {live.current.since && (
                          <span className="text-ink/45"> · depuis {formatClock(live.current.since)}</span>
                        )}
                      </>
                    ) : (
                      "En attente…"
                    )}
                  </p>
                  {!live.team.finished_at && game.status !== "finished" && (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="parchment" onClick={() => setManageTeam(live.team)}>
                        👥
                      </Button>
                      <Button size="sm" variant="parchment" onClick={() => setHintTarget(live.team)}>
                        💡 Indice
                      </Button>
                      {live.current && (
                        <Button size="sm" variant="leaf" onClick={() => forceValidate(live)}>
                          ✅ Valider
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Log d'événements */}
      <h2 className="font-display text-2xl text-parchment mb-3">Journal</h2>
      <Card dark className="p-4 max-h-96 overflow-y-auto">
        {events.length === 0 ? (
          <p className="font-bold text-parchment/50">Rien pour l&apos;instant…</p>
        ) : (
          <ul className="space-y-2">
            {events.map((e) => (
              <li key={e.id} className="font-bold text-sm leading-snug">
                <span className="text-parchment/40 font-mono mr-2">{formatClock(e.created_at)}</span>
                {eventLabel(e, e.team_id ? teamMap.get(e.team_id)?.name : undefined)}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Dialog gestion des joueurs d'une équipe */}
      <Dialog
        open={!!manageTeam}
        onClose={() => setManageTeam(null)}
        title={`👥 « ${manageTeam?.name ?? ""} »`}
      >
        {manageTeam && (
          <div className="space-y-3">
            <p className="font-bold text-ink/60 text-sm">
              Code équipe : <span className="font-mono text-ink tracking-[0.15em]">{manageTeam.team_code}</span>{" "}
              (à donner pour re-rejoindre)
            </p>
            {(playersByTeam.get(manageTeam.id) ?? []).length === 0 ? (
              <p className="font-bold text-ink/60">Aucun téléphone connecté à cette équipe.</p>
            ) : (
              <ul className="space-y-2">
                {(playersByTeam.get(manageTeam.id) ?? []).map((player) => (
                  <li
                    key={player.id}
                    className="flex items-center gap-2 rounded-xl border-2 border-ink/20 px-3 py-2"
                  >
                    <span className="font-bold flex-1 truncate">📱 {player.nickname}</span>
                    <button
                      className="w-10 h-10 rounded-lg border-2 border-ink bg-crimson text-parchment shrink-0"
                      onClick={() => kickPlayer(player)}
                      aria-label={`Retirer ${player.nickname}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(manageTeam.roster ?? []).length > 0 && (
              <p className="font-bold text-ink/60 text-sm">
                Équipage annoncé : {(manageTeam.roster ?? []).join(", ")}
              </p>
            )}
          </div>
        )}
      </Dialog>

      {/* Dialog envoi d'indice */}
      <Dialog
        open={!!hintTarget}
        onClose={() => setHintTarget(null)}
        title={`💡 Indice pour « ${hintTarget?.name ?? ""} »`}
      >
        <div className="space-y-4">
          <div>
            <Label>Message</Label>
            <TextArea
              rows={3}
              autoFocus
              value={hintMessage}
              onChange={(e) => setHintMessage(e.target.value)}
              placeholder="Cherchez près de la statue du lion…"
            />
          </div>
          <Button full size="lg" onClick={sendHint} disabled={!hintMessage.trim()}>
            📨 ENVOYER
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
