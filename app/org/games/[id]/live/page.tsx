"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { frError, sb, rpc } from "@/lib/supabase/client";
import type { Game, GameEvent, Player, RankingData, Step, Submission, Team, TeamRoute } from "@/lib/types";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { formatClock, formatDuration } from "@/lib/game/format";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Chrono, { gameElapsedMs } from "@/components/ui/Chrono";
import Dialog from "@/components/ui/Dialog";
import { Input, Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import TeamMap from "@/components/org/TeamMap";
import { showToast } from "@/components/ui/Toaster";
import { useConfirm } from "@/components/ui/Confirm";

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
    case "photo_approved": return `👍 Photo de « ${team} » validée`;
    case "photo_winner": return `🏅 Photo gagnante désignée pour « ${team} »`;
    case "minigame_skipped": return `⏭️ « ${team} » a passé « ${String(e.payload.step_title ?? "?")} » (pénalité)`;
    case "minigame_redeemed": return `💪 « ${team} » a rattrapé « ${String(e.payload.step_title ?? "?")} »`;
    case "step_timeout": return `⌛ « ${team} » — temps écoulé sur « ${String(e.payload.step_title ?? "?")} »`;
    case "step_neutralized": return `🛠️ Étape « ${String(e.payload.step_title ?? "?")} » neutralisée (${String(e.payload.teams_affected ?? 0)} équipes)`;
    case "team_message": return `🆘 « ${team} » : ${String(e.payload.message ?? "")}`;
    case "bonus_awarded": {
      const pts = Number(e.payload.points ?? 0);
      const sec = Number(e.payload.seconds ?? 0);
      const amount = pts !== 0 ? `+${pts} pts` : `${sec > 0 ? "+" : "−"}${Math.abs(Math.round(sec / 60))} min`;
      return `BONUS ${amount} pour « ${team} » — ${String(e.payload.reason ?? "")}`;
    }
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [journalFilter, setJournalFilter] = useState<"all" | "sos" | "valid" | "warn" | "photo">("all");
  const [seenMsgId, setSeenMsgId] = useState(0);
  const [teamQuery, setTeamQuery] = useState("");
  const [bonusTarget, setBonusTarget] = useState<{ teamId: string; teamName: string; reason: string } | null>(null);
  const [bonusAmount, setBonusAmount] = useState("50");
  const sosRef = useRef<HTMLDivElement>(null);
  const photosRef = useRef<HTMLHeadingElement>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    const [g, t, p, s, r, e, sub] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("teams").select("*").eq("game_id", gameId).order("created_at"),
      sb().from("players").select("*").eq("game_id", gameId),
      sb().from("steps").select("*").eq("game_id", gameId),
      sb().from("team_routes").select("*").eq("game_id", gameId),
      sb().from("events").select("*").eq("game_id", gameId).order("id", { ascending: false }).limit(250),
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

  // Alerte immédiate quand une équipe contacte le maître du jeu
  const lastMsgIdRef = useRef<number>(0);
  useEffect(() => {
    const messages = events.filter((e) => e.type === "team_message");
    if (!messages.length) return;
    const newest = messages[0]; // events triés par id desc
    if (lastMsgIdRef.current === 0) {
      lastMsgIdRef.current = newest.id; // amorçage : pas d'alerte au premier chargement
      return;
    }
    if (newest.id > lastMsgIdRef.current) {
      lastMsgIdRef.current = newest.id;
      const teamName = newest.team_id ? teamMapRef.current.get(newest.team_id)?.name : "?";
      showToast(`🆘 ${teamName} : ${String(newest.payload.message ?? "")}`, "info");
    }
  }, [events]);

  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);
  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // Messages SOS des équipes : panneau dédié + compteur de non-lus persistant
  const teamMessages = useMemo(() => events.filter((e) => e.type === "team_message"), [events]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`toyah:sos-seen:${gameId}`);
      if (raw) setSeenMsgId(Number(raw) || 0);
    } catch {
      /* stockage indisponible : tout apparaîtra comme nouveau */
    }
  }, [gameId]);
  const unreadCount = teamMessages.filter((m) => m.id > seenMsgId).length;
  function markMessagesRead() {
    const newest = teamMessages[0]?.id ?? 0;
    setSeenMsgId(newest);
    try {
      localStorage.setItem(`toyah:sos-seen:${gameId}`, String(newest));
    } catch {
      /* noop */
    }
  }
  const teamMapRef = useRef(teamMap);
  teamMapRef.current = teamMap;
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

  // Stats fun : temps par étape depuis les routes (validated_at successifs).
  // Les étapes passées/expirées ne comptent pas comme des réussites.
  const funStats = useMemo(() => {
    if (!game?.started_at) return null;
    const start = new Date(game.started_at).getTime();
    const byTeam = new Map<string, TeamRoute[]>();
    for (const r of routes) byTeam.set(r.team_id, [...(byTeam.get(r.team_id) ?? []), r]);
    const bestByStep = new Map<string, { teamId: string; ms: number }>();
    let flash: { teamId: string; stepId: string; ms: number } | null = null;
    const perTeam = new Map<string, { totalMs: number; count: number }>();
    for (const [teamId, rs] of byTeam) {
      let prev = start;
      for (const r of rs.slice().sort((a, b) => a.position - b.position)) {
        if (!r.validated_at) break;
        const t = new Date(r.validated_at).getTime();
        const ms = t - prev;
        prev = t;
        if (r.skipped || r.timed_out || ms <= 0) continue;
        const best = bestByStep.get(r.step_id);
        if (!best || ms < best.ms) bestByStep.set(r.step_id, { teamId, ms });
        if (!flash || ms < flash.ms) flash = { teamId, stepId: r.step_id, ms };
        const agg = perTeam.get(teamId) ?? { totalMs: 0, count: 0 };
        agg.totalMs += ms;
        agg.count += 1;
        perTeam.set(teamId, agg);
      }
    }
    let hardest: { stepId: string; ms: number } | null = null;
    for (const [stepId, best] of bestByStep) {
      if (!hardest || best.ms > hardest.ms) hardest = { stepId, ms: best.ms };
    }
    // Équipe la plus régulière : meilleur temps moyen par étape réussie (≥ 2)
    let bestAvg: { teamId: string; ms: number } | null = null;
    for (const [teamId, agg] of perTeam) {
      if (agg.count < 2) continue;
      const avg = agg.totalMs / agg.count;
      if (!bestAvg || avg < bestAvg.ms) bestAvg = { teamId, ms: avg };
    }
    const firstFinisher = teams
      .filter((t) => t.finished_at)
      .sort((a, b) => (a.finished_at! < b.finished_at! ? -1 : 1))[0];
    return { bestByStep, flash, hardest, firstFinisher, bestAvg };
  }, [routes, teams, game?.started_at]);

  async function doStart() {
    setBusy(true);
    setError(null);
    try {
      await rpc("start_game", { p_game_id: gameId });
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const key = Object.keys(START_ERRORS).find((k) => raw.includes(k));
      setError(key ? START_ERRORS[key] : frError(err, "Lancement impossible — réessaie"));
    } finally {
      setBusy(false);
      void load();
    }
  }

  async function setStatus(status: "paused" | "running" | "finished") {
    if (status === "finished") {
      const ok = await confirm({
        title: "🏁 Terminer la partie ?",
        message: "La partie se termine immédiatement pour toutes les équipes. Le classement est figé.",
        confirmLabel: "Terminer",
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await rpc("org_set_status", { p_game_id: gameId, p_status: status });
      showToast(
        status === "finished" ? "Partie terminée 🏁" : status === "paused" ? "Partie en pause ⏸️" : "Partie reprise ▶️",
        "success"
      );
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur inconnue")}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function forceValidate(live: TeamLive) {
    if (!live.current) return;
    const ok = await confirm({
      title: "Valider l'étape ?",
      message: `Marquer « ${live.current.step.title} » comme validée pour « ${live.team.name} » ?`,
      confirmLabel: "Valider",
    });
    if (!ok) return;
    try {
      await rpc("org_force_validate", { p_team_id: live.team.id, p_step_id: live.current.step.id });
      showToast("Étape validée ✅", "success");
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  async function neutralizeStep(step: Step) {
    const ok = await confirm({
      title: "⚠️ Neutraliser cette étape ?",
      message: `« ${step.title} » sera validée pour TOUTES les équipes qui ne l'ont pas encore faite (balise cassée, lieu inaccessible…). Irréversible.`,
      confirmLabel: "Neutraliser",
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await rpc<{ ok: boolean; teams_affected: number }>("org_neutralize_step", {
        p_game_id: gameId,
        p_step_id: step.id,
      });
      showToast(`Étape neutralisée pour ${res.teams_affected} équipe(s) ✅`, "success");
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  async function sendHint() {
    if (!hintTarget || !hintMessage.trim()) return;
    const message = hintMessage.trim();
    try {
      await rpc("org_send_hint", { p_team_id: hintTarget.id, p_message: message });
    } catch (err) {
      showToast(`Envoi impossible : ${frError(err, "erreur")}`, "error");
      return;
    }
    showToast("Indice envoyé 📨", "success");
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

  // Bonus organisateur : +points (mode points) ou temps rendu (mode chrono),
  // montant au choix via un petit dialog.
  function awardBonus(teamId: string, teamName: string, reason: string) {
    setBonusAmount(game?.settings.scoring === "points" ? "50" : "1");
    setBonusTarget({ teamId, teamName, reason });
  }

  async function sendBonus() {
    if (!bonusTarget) return;
    const isPoints = game?.settings.scoring === "points";
    const amount = Math.max(1, Math.round(Number(bonusAmount) || 0));
    if (!amount) return;
    try {
      await rpc("org_award_bonus", {
        p_team_id: bonusTarget.teamId,
        p_points: isPoints ? amount : 0,
        p_seconds: isPoints ? 0 : -amount * 60,
        p_reason: bonusTarget.reason,
      });
      showToast(
        `Bonus ${isPoints ? `+${amount} pts` : `−${amount} min`} attribué à « ${bonusTarget.teamName} »`,
        "success"
      );
      setBonusTarget(null);
      await load();
    } catch (err) {
      showToast(`Bonus impossible : ${frError(err, "erreur")}`, "error");
    }
  }

  async function renameTeam(team: Team, name: string) {
    if (!name.trim() || name.trim() === team.name) return;
    try {
      await rpc("org_rename_team", { p_team_id: team.id, p_name: name.trim() });
      showToast("Équipe renommée ✅", "success");
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  async function deleteTeam(team: Team) {
    const ok = await confirm({
      title: "Supprimer l'équipe ?",
      message: `« ${team.name} » et ses joueurs seront retirés. (possible uniquement avant le lancement)`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await rpc("org_delete_team", { p_team_id: team.id });
      showToast("Équipe supprimée", "success");
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  async function reviewPhoto(submission: Submission, approve: boolean) {
    try {
      await rpc("org_review_photo", { p_submission_id: submission.id, p_approve: approve });
      showToast(approve ? "Photo validée ✅" : "Photo refusée", approve ? "success" : "info");
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  async function kickPlayer(player: Player) {
    const ok = await confirm({
      title: "Retirer ce joueur ?",
      message: `${player.nickname} sera retiré (il pourra re-rejoindre avec le code équipe).`,
      confirmLabel: "Retirer",
      danger: true,
    });
    if (!ok) return;
    try {
      // supabase-js ne lève pas d'exception : l'erreur est dans la réponse
      const { error } = await sb().from("players").delete().eq("id", player.id);
      if (error) throw new Error(error.message);
      await load();
    } catch (err) {
      showToast(`Échec : ${frError(err, "erreur")}`, "error");
    }
  }

  if (loading || !user || !game) return <Spinner label="Chargement…" />;

  const poolCount = steps.filter((s) => !s.is_common_checkpoint && !s.is_final).length;
  // Vue d'ensemble pour les grosses chasses (20-30 équipes) : compteurs dans
  // la barre d'actions collante, recherche dans le classement.
  const finishedCount = teams.filter((t) => t.finished_at).length;
  const stuckCount =
    game.status === "running"
      ? ranking.filter(
          (l) =>
            !l.team.finished_at &&
            l.current?.since &&
            Date.now() - new Date(l.current.since).getTime() >= 10 * 60000
        ).length
      : 0;
  const rankIndex = new Map(ranking.map((l, i) => [l.team.id, i]));
  const shownRanking = teamQuery.trim()
    ? ranking.filter((l) => l.team.name.toLowerCase().includes(teamQuery.trim().toLowerCase()))
    : ranking;

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
          <Link href={`/org/games/${gameId}/photos`} className="font-bold text-parchment/70 underline py-2 inline-block">
            🖼️ Photos
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

      {/* Actions globales : barre collante avec compteurs d'état (grosses chasses) */}
      <div className="sticky top-0 z-40 -mx-5 px-5 py-2.5 mb-4 bg-ink/95 backdrop-blur-sm border-b-2 border-parchment/10">
        {game.status !== "lobby" && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-2 font-bold text-xs text-parchment/70">
            <span>🏁 {finishedCount}/{teams.length} arrivées</span>
            {stuckCount > 0 && <span className="text-crimson">⚠️ {stuckCount} bloquée{stuckCount > 1 ? "s" : ""}</span>}
            {unreadCount > 0 && (
              <button
                className="text-gold underline"
                onClick={() => sosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                🆘 {unreadCount} message{unreadCount > 1 ? "s" : ""} non lu{unreadCount > 1 ? "s" : ""}
              </button>
            )}
            {submissions.length > 0 && (
              <button
                className="text-gold underline"
                onClick={() => photosRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                📸 {submissions.length} photo{submissions.length > 1 ? "s" : ""} à juger
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
        {game.status === "lobby" && (
          <Button size="lg" disabled={busy} onClick={doStart}>
            {busy ? "⏳ LANCEMENT…" : "🚀 LANCER LA PARTIE"}
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
        {game.status !== "lobby" && (
          <Button variant="parchment" disabled={busy} onClick={() => setStatsOpen(true)}>
            📈 Stats
          </Button>
        )}
        {(game.status === "running" || game.status === "paused") && (
          <>
            <Button variant="parchment" disabled={busy} onClick={() => setToolsOpen(true)}>
              🛠️ Outils
            </Button>
            <Button variant="crimson" disabled={busy} onClick={() => setStatus("finished")}>
              🏁 Terminer
            </Button>
          </>
        )}
        {game.status === "finished" && (
          <Link href={`/org/games/${gameId}/photos`} className="contents">
            <Button variant="gold">🖼️ Galerie photos</Button>
          </Link>
        )}
        </div>
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
                    aria-label="Gérer l'équipe"
                  >
                    👥
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

      {/* Classement live */}
      {game.status !== "lobby" && (
        <>
          <h2 className="font-display text-2xl text-parchment mb-1">
            Classement live
            {game.settings.scoring === "points" && (
              <span className="text-gold text-base ml-2">(au barème points)</span>
            )}
          </h2>
          <p className="font-bold text-parchment/50 text-xs mb-3">
            Une case par étape — couleur de l&apos;équipe : validée · 🟡 clignotante : en cours ·
            🔴 : passée avec pénalité · grise : temps écoulé · blanche : à venir. Touche une case
            pour voir le nom de l&apos;étape.
          </p>
          {teams.length > 6 && (
            <div className="mb-3">
              <Input
                value={teamQuery}
                onChange={(e) => setTeamQuery(e.target.value)}
                placeholder="🔎 Chercher une équipe…"
                className="h-11"
              />
            </div>
          )}
          <div className="space-y-2 mb-8 max-h-[30rem] overflow-y-auto overscroll-contain pr-1">
            {shownRanking.length === 0 && (
              <p className="font-bold text-parchment/50 text-sm">Aucune équipe ne correspond.</p>
            )}
            {shownRanking.map((live) => {
              const i = rankIndex.get(live.team.id) ?? 0;
              return (
              <Card key={live.team.id} className="p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-display text-lg w-7 shrink-0">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                  </span>
                  <span
                    className="w-3.5 h-3.5 rounded-full border-2 border-ink shrink-0"
                    style={{ backgroundColor: live.team.color }}
                  />
                  <span className="font-display flex-1 truncate">{live.team.name}</span>
                  {(rankMap.get(live.team.id)?.bonus_points ?? 0) > 0 && (
                    <span
                      className="shrink-0 text-[10px] font-bold bg-gold border border-ink rounded px-1"
                      title={`${rankMap.get(live.team.id)?.bonus_points} points bonus`}
                    >
                      BONUS +{rankMap.get(live.team.id)?.bonus_points}
                    </span>
                  )}
                  <span className="font-bold text-ink/60 text-sm tabular-nums shrink-0">
                    {live.done}/{live.total}
                  </span>
                </div>

                {/* Avancement étape par étape (une case = une étape) */}
                <div className="flex gap-[3px] mb-1.5">
                  {routes
                    .filter((r) => r.team_id === live.team.id)
                    .sort((a, b) => a.position - b.position)
                    .map((r) => {
                      const st = stepMap.get(r.step_id);
                      const label = `${r.position + 1}. ${st?.title ?? "?"}${
                        r.skipped ? " (passée, pénalité)" : r.timed_out ? " (temps écoulé)" : ""
                      }`;
                      let cls = "bg-white";
                      let bg: string | undefined;
                      if (r.status === "done") {
                        if (r.skipped) cls = "bg-crimson";
                        else if (r.timed_out) cls = "bg-ink/25";
                        else {
                          cls = "";
                          bg = live.team.color;
                        }
                      } else if (r.status === "current") {
                        cls = "bg-gold animate-pulse";
                      }
                      return (
                        <div
                          key={r.id}
                          title={label}
                          className={`h-2.5 flex-1 rounded-sm border border-ink ${cls}`}
                          style={bg ? { backgroundColor: bg } : undefined}
                        />
                      );
                    })}
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
                      (() => {
                        const cur = live.current;
                        const min = cur.since
                          ? Math.floor((Date.now() - new Date(cur.since).getTime()) / 60000)
                          : null;
                        const stuck = min != null && min >= 10 && game.status === "running";
                        return (
                          <>
                            ➡️ {cur.step.title}
                            {min != null && (
                              <span className={stuck ? "text-crimson" : "text-ink/45"}>
                                {" "}
                                · depuis {min < 1 ? "moins d'une min" : `${min} min`}
                                {stuck && " ⚠️ bloquée ? Envoie un indice !"}
                              </span>
                            )}
                          </>
                        );
                      })()
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
              );
            })}
          </div>
        </>
      )}

      {/* Messages des équipes : panneau dédié pour ne jamais rater un SOS */}
      {teamMessages.length > 0 && (
        <>
          <div ref={sosRef} className="flex items-center justify-between gap-3 mb-3 flex-wrap scroll-mt-24">
            <h2 className="font-display text-2xl text-gold">
              🆘 Messages des équipes
              {unreadCount > 0 && (
                <span className="ml-2 inline-block align-middle text-sm font-bold bg-crimson text-parchment border-2 border-ink rounded-full px-2.5 py-0.5 animate-pulse">
                  {unreadCount} nouveau{unreadCount > 1 ? "x" : ""}
                </span>
              )}
            </h2>
            {unreadCount > 0 && (
              <button className="font-bold text-parchment/60 underline text-sm py-1" onClick={markMessagesRead}>
                Tout marquer lu
              </button>
            )}
          </div>
          <div className="space-y-2 mb-8 max-h-80 overflow-y-auto overscroll-contain pr-1">
            {teamMessages.slice(0, 30).map((msg) => {
              const team = msg.team_id ? teamMap.get(msg.team_id) : undefined;
              const isNew = msg.id > seenMsgId;
              return (
                <Card key={msg.id} className={`p-3 ${isNew ? "ring-4 ring-crimson" : ""}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="w-4 h-4 rounded-full border-2 border-ink shrink-0"
                      style={{ backgroundColor: team?.color }}
                    />
                    <span className="font-display truncate">{team?.name ?? "?"}</span>
                    <span className="font-bold text-ink/45 text-xs">{formatClock(msg.created_at)}</span>
                    {isNew && <span className="font-bold text-crimson text-xs animate-pulse">● NOUVEAU</span>}
                    {team && (
                      <div className="ml-auto">
                        <Button size="sm" variant="gold" onClick={() => setHintTarget(team)}>
                          💬 Répondre
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="font-bold text-ink/85 mt-1.5">{String(msg.payload.message ?? "")}</p>
                  {!!msg.payload.nickname && (
                    <p className="font-bold text-ink/45 text-xs mt-0.5">— {String(msg.payload.nickname)}</p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Log d'événements */}
      <h2 className="font-display text-2xl text-parchment mb-3">Journal</h2>
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {(
          [
            ["all", "Tout"],
            ["sos", `🆘 SOS${teamMessages.length ? ` (${teamMessages.length})` : ""}`],
            ["valid", "✅ Validations"],
            ["warn", "⚠️ Problèmes"],
            ["photo", "📸 Photos"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setJournalFilter(key)}
            className={`h-9 px-3 rounded-lg border-2 border-ink font-bold text-sm ${
              journalFilter === key ? "bg-gold text-ink" : "bg-parchment/10 text-parchment/70"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Card dark className="p-4 max-h-96 overflow-y-auto">
        {(() => {
          const FILTER_TYPES: Record<string, string[]> = {
            sos: ["team_message"],
            valid: ["step_validated", "team_finished", "manual_validate", "step_neutralized", "minigame_redeemed"],
            warn: ["wrong_answer", "minigame_skipped", "step_timeout", "hint_unlocked", "game_paused"],
            photo: ["photo_submitted", "photo_approved", "photo_rejected", "photo_winner"],
          };
          const shown =
            journalFilter === "all"
              ? events
              : events.filter((e) => FILTER_TYPES[journalFilter]?.includes(e.type));
          if (shown.length === 0) {
            return <p className="font-bold text-parchment/50">Rien pour l&apos;instant…</p>;
          }
          return (
            <ul className="space-y-2">
              {shown.map((e) => (
                <li
                  key={e.id}
                  className={`font-bold text-sm leading-snug ${
                    e.type === "team_message"
                      ? "text-gold bg-gold/10 rounded-lg px-2 py-1 -mx-2"
                      : ""
                  }`}
                >
                  <span className="text-parchment/40 font-mono mr-2">{formatClock(e.created_at)}</span>
                  {eventLabel(e, e.team_id ? teamMap.get(e.team_id)?.name : undefined)}
                </li>
              ))}
            </ul>
          );
        })()}
      </Card>

      {/* Photos à valider */}
      {submissions.length > 0 && (
        <>
          <h2 ref={photosRef} className="font-display text-2xl text-gold mb-3 mt-8 animate-pulse scroll-mt-24">
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
          <h2 className="font-display text-2xl text-parchment mb-3 mt-8">📍 Sur le terrain</h2>
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
        </>
      )}

      {/* Dialog gestion des joueurs d'une équipe */}
      <Dialog
        open={!!manageTeam}
        onClose={() => setManageTeam(null)}
        title={`👥 « ${manageTeam?.name ?? ""} »`}
      >
        {manageTeam && (
          <div className="space-y-3">
            <div>
              <Label>Nom de l&apos;équipe</Label>
              <div className="flex gap-2">
                <Input
                  key={manageTeam.id}
                  defaultValue={manageTeam.name}
                  maxLength={30}
                  onBlur={(e) => renameTeam(manageTeam, e.target.value)}
                />
              </div>
              <p className="text-xs font-bold text-ink/50 mt-1">Modifie et touche ailleurs pour enregistrer.</p>
            </div>
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

      {/* Dialog Bonus : montant au choix */}
      <Dialog
        open={!!bonusTarget}
        onClose={() => setBonusTarget(null)}
        title={`Bonus pour « ${bonusTarget?.teamName ?? ""} »`}
      >
        {bonusTarget && (
          <div className="space-y-4">
            <p className="font-bold text-ink/70 text-sm">Motif : {bonusTarget.reason}</p>
            <div>
              <Label>
                {game.settings.scoring === "points" ? "Points bonus" : "Minutes rendues (chrono)"}
              </Label>
              <div className="flex gap-2 items-center">
                <Input
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric"
                  className="w-24 text-center font-mono"
                />
                {(game.settings.scoring === "points" ? [25, 50, 100] : [1, 2, 5]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setBonusAmount(String(preset))}
                    className={`h-11 px-3 rounded-lg border-2 border-ink font-bold text-sm ${
                      Number(bonusAmount) === preset ? "bg-gold" : "bg-white"
                    }`}
                  >
                    {game.settings.scoring === "points" ? `+${preset}` : `−${preset} min`}
                  </button>
                ))}
              </div>
            </div>
            <Button full size="lg" onClick={sendBonus} disabled={!Number(bonusAmount)}>
              ATTRIBUER LE BONUS
            </Button>
          </div>
        )}
      </Dialog>

      {/* Dialog Stats : records par épreuve + infos fun */}
      <Dialog open={statsOpen} onClose={() => setStatsOpen(false)} title="📈 Stats de la partie">
        {!funStats || funStats.bestByStep.size === 0 ? (
          <p className="font-bold text-ink/60">
            Encore rien à raconter — les records apparaîtront dès les premières validations !
          </p>
        ) : (
          <div className="space-y-4">
            <p className="font-bold text-ink/55 text-xs">
              « BONUS » récompense l&apos;équipe du record —{" "}
              {game.settings.scoring === "points" ? "points" : "minutes rendues"} au montant de
              ton choix.
            </p>
            {/* Infos fun */}
            <div className="space-y-2">
              {funStats.firstFinisher && (
                <div className="flex items-center gap-2 font-bold text-sm rounded-xl border-2 border-ink/20 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    🏁 Premier arrivé au trésor :{" "}
                    <span style={{ color: funStats.firstFinisher.color }} className="font-display">
                      {funStats.firstFinisher.name}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() =>
                      awardBonus(funStats.firstFinisher!.id, funStats.firstFinisher!.name, "premier arrivé au trésor")
                    }
                  >
                    BONUS
                  </Button>
                </div>
              )}
              {funStats.flash && (
                <div className="flex items-center gap-2 font-bold text-sm rounded-xl border-2 border-ink/20 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    ⚡ Étape éclair : « {stepMap.get(funStats.flash.stepId)?.title ?? "?"} » par{" "}
                    <span
                      style={{ color: teamMap.get(funStats.flash.teamId)?.color }}
                      className="font-display"
                    >
                      {teamMap.get(funStats.flash.teamId)?.name ?? "?"}
                    </span>{" "}
                    en {formatDuration(funStats.flash.ms)} !
                  </span>
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() =>
                      awardBonus(
                        funStats.flash!.teamId,
                        teamMap.get(funStats.flash!.teamId)?.name ?? "?",
                        "étape éclair de la partie"
                      )
                    }
                  >
                    BONUS
                  </Button>
                </div>
              )}
              {funStats.bestAvg && (
                <div className="flex items-center gap-2 font-bold text-sm rounded-xl border-2 border-ink/20 px-3 py-2">
                  <span className="flex-1 min-w-0">
                    🎯 La plus régulière :{" "}
                    <span
                      style={{ color: teamMap.get(funStats.bestAvg.teamId)?.color }}
                      className="font-display"
                    >
                      {teamMap.get(funStats.bestAvg.teamId)?.name ?? "?"}
                    </span>{" "}
                    — {formatDuration(funStats.bestAvg.ms)} de moyenne par étape
                  </span>
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={() =>
                      awardBonus(
                        funStats.bestAvg!.teamId,
                        teamMap.get(funStats.bestAvg!.teamId)?.name ?? "?",
                        "équipe la plus régulière"
                      )
                    }
                  >
                    BONUS
                  </Button>
                </div>
              )}
              {funStats.hardest && funStats.bestByStep.size > 1 && (
                <p className="font-bold text-sm rounded-xl border-2 border-ink/20 px-3 py-2">
                  🪨 La plus coriace : « {stepMap.get(funStats.hardest.stepId)?.title ?? "?"} » —
                  même les plus rapides ont mis {formatDuration(funStats.hardest.ms)}.
                </p>
              )}
            </div>

            {/* Record par épreuve */}
            <div>
              <p className="font-display mb-2">🏆 Les plus rapides par épreuve</p>
              <div className="space-y-1.5 max-h-[45dvh] overflow-y-auto overscroll-contain pr-1">
                {steps
                  .slice()
                  .sort((a, b) => a.order_hint - b.order_hint)
                  .map((step) => {
                    const best = funStats.bestByStep.get(step.id);
                    const team = best ? teamMap.get(best.teamId) : undefined;
                    return (
                      <div
                        key={step.id}
                        className="flex items-center gap-2 rounded-xl border-2 border-ink/15 px-3 py-1.5 text-sm font-bold"
                      >
                        <span className="flex-1 min-w-0 truncate">{step.title}</span>
                        {best && team ? (
                          <>
                            <span
                              className="w-3 h-3 rounded-full border border-ink shrink-0"
                              style={{ backgroundColor: team.color }}
                            />
                            <span className="font-display truncate max-w-[6rem]">{team.name}</span>
                            <span className="tabular-nums text-ink/60">
                              {formatDuration(best.ms)}
                            </span>
                            <button
                              className="h-8 px-2 rounded-lg border-2 border-ink bg-gold shrink-0 text-[10px] font-bold"
                              aria-label={`Bonus pour ${team.name}`}
                              onClick={() =>
                                awardBonus(team.id, team.name, `plus rapide sur « ${step.title} »`)
                              }
                            >
                              BONUS
                            </button>
                          </>
                        ) : (
                          <span className="text-ink/40">—</span>
                        )}
                      </div>
                    );
                  })}
              </div>
              <p className="text-xs font-bold text-ink/45 mt-2">
                Temps mesuré entre deux validations (les étapes passées ou expirées ne comptent
                pas). Partage ces records au moment de la remise des prix ! 🎉
              </p>
            </div>
          </div>
        )}
      </Dialog>

      {/* Dialog Outils : neutraliser une étape */}
      <Dialog open={toolsOpen} onClose={() => setToolsOpen(false)} title="🛠️ Outils de secours">
        <div className="space-y-3">
          <p className="font-bold text-ink/70 text-sm">
            Balise cassée, lieu inaccessible ? Neutralise l&apos;étape : elle sera validée pour
            toutes les équipes qui ne l&apos;ont pas encore faite.
          </p>
          <div className="space-y-2 max-h-[50dvh] overflow-y-auto">
            {steps
              .slice()
              .sort((a, b) => a.order_hint - b.order_hint)
              .map((step) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2 rounded-xl border-2 border-ink/20 px-3 py-2"
                >
                  <span className="font-bold text-sm flex-1 truncate">
                    {step.type === "nfc" ? "🏷️" : step.type === "photo" ? "📸" : step.type === "minigame" ? "🎮" : step.type === "gps" ? "📍" : "💬"}{" "}
                    {step.title}
                  </span>
                  <Button
                    size="sm"
                    variant="crimson"
                    onClick={() => {
                      setToolsOpen(false);
                      void neutralizeStep(step);
                    }}
                  >
                    Neutraliser
                  </Button>
                </div>
              ))}
          </div>
        </div>
      </Dialog>

      {/* Dialog envoi d'indice */}
      <Dialog
        open={!!hintTarget}
        onClose={() => setHintTarget(null)}
        title={`📨 Message pour « ${hintTarget?.name ?? ""} »`}
      >
        <div className="space-y-4">
          <p className="font-bold text-ink/55 text-sm">
            L&apos;équipe le reçoit immédiatement à l&apos;écran (et en notification si activée).
          </p>
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

      {confirmDialog}
    </main>
  );
}
