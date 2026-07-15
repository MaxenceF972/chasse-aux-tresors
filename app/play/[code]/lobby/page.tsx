"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ensureAnonSession, rpc } from "@/lib/supabase/client";
import type { LobbyState, LobbyTeam } from "@/lib/types";
import { setPlayerSession } from "@/lib/game/session";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { sfx } from "@/lib/game/sounds";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Dialog from "@/components/ui/Dialog";
import { Input, Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import Logo from "@/components/ui/Logo";

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const code = params.code?.toUpperCase() ?? "";
  const router = useRouter();

  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinTarget, setJoinTarget] = useState<LobbyTeam | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [nickname, setNickname] = useState("");
  const [membersText, setMembersText] = useState("");
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await rpc<LobbyState>("get_lobby", { p_code: code });
      if (data.error || !data.game) {
        setError("Partie introuvable.");
        return;
      }
      setLobby(data);
      // La partie démarre → tous les joueurs inscrits basculent sur l'énigme
      if (data.game.status !== "lobby" && data.me && !startedRef.current) {
        startedRef.current = true;
        sfx.fanfare();
        router.replace(`/play/${code}/game`);
      }
    } catch {
      /* réseau — le poll réessaiera */
    }
  }, [code, router]);

  useEffect(() => {
    void ensureAnonSession().then(load).catch((err) => {
      setError(err instanceof Error ? err.message : "Erreur");
    });
    const poll = setInterval(load, 4000);
    return () => clearInterval(poll);
  }, [load]);

  useGameInvalidate(lobby?.game?.id, load);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await rpc<{ team_id: string; team_code: string }>("create_team", {
        p_code: code,
        p_team_name: teamName,
        p_nickname: nickname,
        p_members: membersText.split("\n").map((m) => m.trim()).filter(Boolean),
      });
      setPlayerSession({ code, team_id: res.team_id, team_code: res.team_code, nickname });
      setTeamCode(res.team_code);
      setCreateOpen(false);
      sfx.pop();
      void load();
    } catch (err) {
      alert(frenchError(err));
    } finally {
      setBusy(false);
    }
  }

  async function joinTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!joinTarget) return;
    setBusy(true);
    try {
      const res = await rpc<{ team_id: string; team_code: string }>("join_team", {
        p_code: code,
        p_team_id: joinTarget.id,
        p_nickname: nickname,
      });
      setPlayerSession({ code, team_id: res.team_id, team_code: res.team_code, nickname });
      setJoinTarget(null);
      sfx.pop();
      void load();
    } catch (err) {
      alert(frenchError(err));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <main className="min-h-dvh flex flex-col items-center justify-center gap-4 px-5">
        <p className="font-display text-2xl text-parchment">😵 {error}</p>
        <Link href="/play" className="contents">
          <Button>← Réessayer</Button>
        </Link>
      </main>
    );
  }

  if (!lobby?.game) return <Spinner label="Ouverture du lobby…" />;

  const me = lobby.me;
  const myTeam = me ? lobby.teams?.find((t) => t.id === me.team_id) : null;
  const settings = lobby.game.settings;
  const maxPlayers = settings.max_players_per_team ?? null;

  return (
    <main className="min-h-dvh px-5 py-8 max-w-lg mx-auto flex flex-col gap-6">
      <div className="text-center">
        <Link href="/" className="inline-block">
          <Logo className="w-36 mx-auto" />
        </Link>
        <h1 className="font-display text-2xl text-parchment mt-3 leading-tight">
          {lobby.game.name}
        </h1>
        <p className="font-mono font-bold text-gold tracking-[0.3em]">{code}</p>
        {!me && (
          <Link href="/play" className="font-bold text-parchment/50 underline text-sm">
            ← Changer de code
          </Link>
        )}
      </div>

      {me && myTeam ? (
        <>
          <Card className="p-5 text-center">
            <div className="text-4xl mb-1">⛺</div>
            <h2 className="font-display text-2xl" style={{ color: myTeam.color }}>
              {myTeam.name}
            </h2>
            <p className="font-bold text-ink/60 mb-3">
              Toi : <span className="text-ink">{me.nickname}</span>
            </p>
            <div className="flex flex-wrap justify-center gap-1.5 mb-4">
              {Array.from(new Set([...myTeam.players, ...(myTeam.roster ?? [])])).map((p) => (
                <span
                  key={p}
                  className="px-2.5 py-1 rounded-lg bg-white border-2 border-ink font-bold text-sm"
                >
                  {myTeam.players.includes(p) ? "📱 " : ""}
                  {p}
                </span>
              ))}
            </div>
            {teamCode && (
              <p className="font-bold text-sm text-ink/60 mb-2">
                Code d&apos;équipe à partager :{" "}
                <span className="font-mono text-lg text-ink tracking-[0.2em]">{teamCode}</span>
              </p>
            )}
            <motion.p
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="font-display text-lg text-leaf"
            >
              ⏳ En attente du lancement…
            </motion.p>
          </Card>
          <p className="text-center font-bold text-parchment/50 text-sm">
            Garde cette page ouverte : la chasse démarre automatiquement ! 🏴‍☠️
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display text-xl text-parchment -mb-2">Choisis ton équipage :</h2>
          <div className="space-y-3">
            {(lobby.teams ?? []).map((team) => {
              const full = maxPlayers != null && team.players.length >= maxPlayers;
              const allNames = Array.from(new Set([...team.players, ...(team.roster ?? [])]));
              return (
                <button
                  key={team.id}
                  disabled={full}
                  onClick={() => {
                    setNickname("");
                    setJoinTarget(team);
                  }}
                  className="w-full text-left parchment-texture rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111] p-4 active:translate-y-[2px] active:shadow-[2px_2px_0_0_#111111] transition-all disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="w-5 h-5 rounded-full border-[3px] border-ink shrink-0"
                      style={{ backgroundColor: team.color }}
                    />
                    <span className="font-display text-lg text-ink flex-1">{team.name}</span>
                    <span className="font-bold text-ink/50 text-sm">
                      {team.players.length}
                      {maxPlayers != null ? `/${maxPlayers}` : ""} 👤
                    </span>
                  </div>
                  {allNames.length > 0 && (
                    <p className="font-bold text-ink/50 text-sm mt-1 truncate">
                      {allNames.join(", ")}
                    </p>
                  )}
                  {full && <p className="font-bold text-crimson text-sm">Équipe complète</p>}
                </button>
              );
            })}
          </div>
          <Button
            size="lg"
            variant="gold"
            onClick={() => {
              setTeamName("");
              setNickname("");
              setCreateOpen(true);
            }}
          >
            ➕ CRÉER UNE ÉQUIPE
          </Button>
        </>
      )}

      {/* Dialog création */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="⛺ Nouvelle équipe">
        <form onSubmit={createTeam} className="space-y-4">
          <div>
            <Label>Nom de l&apos;équipe</Label>
            <Input
              autoFocus
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Les Requins Malins"
              maxLength={30}
            />
          </div>
          <div>
            <Label>Ton pseudo (capitaine)</Label>
            <Input
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Capitaine Max"
              maxLength={20}
            />
          </div>
          <div>
            <Label>Ton équipage (un prénom par ligne)</Label>
            <TextArea
              rows={3}
              value={membersText}
              onChange={(e) => setMembersText(e.target.value)}
              placeholder={"Léa\nHugo\nJade"}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              Liste tes coéquipiers — pratique quand l&apos;équipe joue sur un seul téléphone.
            </p>
          </div>
          <Button type="submit" full size="lg" disabled={busy}>
            {busy ? "…" : "🏴‍☠️ HISSER LE DRAPEAU"}
          </Button>
        </form>
      </Dialog>

      {/* Dialog rejoindre */}
      <Dialog
        open={!!joinTarget}
        onClose={() => setJoinTarget(null)}
        title={`Rejoindre « ${joinTarget?.name ?? ""} »`}
      >
        <form onSubmit={joinTeam} className="space-y-4">
          <div>
            <Label>Ton pseudo</Label>
            <Input
              autoFocus
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Moussaillon Léa"
              maxLength={20}
            />
          </div>
          <Button type="submit" full size="lg" disabled={busy}>
            {busy ? "…" : "⚓ EMBARQUER"}
          </Button>
        </form>
      </Dialog>
    </main>
  );
}

function frenchError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (raw.includes("PARTIE_DEJA_LANCEE")) return "La partie est déjà lancée !";
  if (raw.includes("EQUIPE_PLEINE")) return "Cette équipe est complète.";
  if (raw.includes("MAX_EQUIPES_ATTEINT")) return "Le nombre maximum d'équipes est atteint.";
  if (raw.includes("PSEUDO_REQUIS")) return "Choisis un pseudo !";
  if (raw.includes("NOM_EQUIPE_REQUIS")) return "Donne un nom à ton équipe !";
  return raw || "Erreur inconnue";
}
