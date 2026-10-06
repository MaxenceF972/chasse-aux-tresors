"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ensureAnonSession, frError, rpc } from "@/lib/supabase/client";
import type { LobbyState, LobbyTeam } from "@/lib/types";
import { getPlayerSession, setPlayerSession } from "@/lib/game/session";
import { marquerPreflight, preflightFait } from "@/lib/game/prefs";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { sfx } from "@/lib/game/sounds";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Dialog from "@/components/ui/Dialog";
import { Input, Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import Logo from "@/components/ui/Logo";
import Briefing from "@/components/play/Briefing";
import Consignes from "@/components/play/Consignes";
import Preflight from "@/components/play/Preflight";
import { showToast } from "@/components/ui/Toaster";
import { charterRules } from "@/lib/game/charter";
import { renderRich } from "@/lib/game/rich";
import QRCode from "qrcode";

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
  const [contact, setContact] = useState("");
  const [membersText, setMembersText] = useState("");
  const [rejoinOpen, setRejoinOpen] = useState(false);
  const [rejoinCode, setRejoinCode] = useState("");
  const [charterAccepted, setCharterAccepted] = useState(false);
  const [charterOpen, setCharterOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteQr, setInviteQr] = useState<string | null>(null);
  const [invitedTeamCode, setInvitedTeamCode] = useState<string | null>(null);
  const [teamCode, setTeamCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Vérification du téléphone : avant le départ (jeu en continu), ou en
  // attendant le lancement (départ groupé).
  const [verifDepart, setVerifDepart] = useState(false);
  const [verifLobby, setVerifLobby] = useState(false);
  const [verifFaite, setVerifFaite] = useState(false);
  const [veutCreer, setVeutCreer] = useState(false);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await rpc<LobbyState>("get_lobby", { p_code: code });
      if (data.error || !data.game) {
        setError("Partie introuvable.");
        return;
      }
      setLobby(data);

      // Le code d'équipe est ce qui permet d'INVITER. Il n'existait qu'en
      // mémoire, posé à la création : un rafraîchissement, un passage par
      // l'appareil photo pour montrer le QR, et le capitaine le perdait. On le
      // relit de la session du téléphone, s'il désigne bien l'équipe où l'on est.
      const session = getPlayerSession();
      if (session?.code === code && session.team_code && session.team_id === data.me?.team_id) {
        setTeamCode(session.team_code);
      }

      // Bascule sur l'écran de jeu quand MON ÉQUIPE est partie.
      //
      // En jeu continu, seul `started_at` le dit : la partie vaut « running »
      // toute la journée, y compris pour une équipe qui vient de se former —
      // s'en servir jetterait le capitaine dans le jeu à la seconde où il crée
      // son équipe, sans lien d'invitation ni personne à attendre.
      // En départ groupé, le lancement fait partir tout le monde : le statut
      // suffit quand la base ne fournit pas encore `started_at` (SQL pas
      // ré-appliqué). S'il est fourni et vaut null, l'équipe n'est PAS partie
      // — même en départ groupé (partie repassée de « continu » à « groupé »
      // en cours de route) — et c'est ici qu'elle peut partir.
      const monEquipe = data.me ? data.teams?.find((t) => t.id === data.me!.team_id) : null;
      const continu = !!data.game.settings?.continuous;
      const partie =
        monEquipe?.started_at != null ||
        (monEquipe?.started_at === undefined && !continu && data.game.status !== "lobby");
      if (data.me && partie && !startedRef.current) {
        startedRef.current = true;
        sfx.fanfare();
        router.replace(`/play/${code}/game`);
      }
    } catch {
      /* réseau — le poll réessaiera */
    }
  }, [code, router]);

  useEffect(() => {
    setVerifFaite(preflightFait(code));
    void ensureAnonSession().then(load).catch((err) => {
      setError(frError(err, "Connexion impossible — recharge la page"));
    });
    const poll = setInterval(load, 4000);
    return () => clearInterval(poll);
  }, [load, code]);

  // Lien d'invitation ?team=CODE → rejoindre l'équipe en un tap.
  // ?creer=1 → on vient de « On forme une équipe » : la création est
  // l'intention, pas la liste des équipages déjà là.
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const teamParam = q.get("team");
      if (teamParam) setInvitedTeamCode(teamParam.toUpperCase());
      if (q.get("creer")) setVeutCreer(true);
    } catch {
      /* noop */
    }
  }, []);

  // Ouverte une fois le lobby chargé, et seulement si on n'a pas déjà une
  // équipe (retour arrière, page rouverte).
  useEffect(() => {
    if (veutCreer && lobby?.game && !lobby.me && !invitedTeamCode) {
      setVeutCreer(false);
      setTeamName("");
      setNickname("");
      setCreateOpen(true);
    }
  }, [veutCreer, lobby, invitedTeamCode]);

  useGameInvalidate(lobby?.game?.id, load);

  async function shareInvite() {
    const myTeamCode = getMyTeamCode();
    if (!myTeamCode) return;
    const url = `${window.location.origin}/play/${code}/lobby?team=${myTeamCode}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Rejoins mon équipe — TOYAH GAMES",
          text: "Rejoins mon équipe pour la chasse au trésor !",
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        showToast("Lien d'invitation copié !", "success");
      }
    } catch {
      /* partage annulé */
    }
  }

  function getMyTeamCode(): string | null {
    return teamCode ?? null;
  }

  async function openInvite() {
    const myTeamCode = getMyTeamCode();
    if (!myTeamCode) return;
    const url = `${window.location.origin}/play/${code}/lobby?team=${myTeamCode}`;
    setInviteQr(await QRCode.toDataURL(url, { width: 400, margin: 1 }));
    setInviteOpen(true);
  }

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!charterAccepted) {
      showToast("Coche la charte de l'aventurier pour continuer !", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await rpc<{ team_id: string; team_code: string }>("create_team", {
        p_code: code,
        p_team_name: teamName,
        p_nickname: nickname,
        p_members: membersText.split("\n").map((m) => m.trim()).filter(Boolean),
        p_contact: lobby?.game?.settings?.ask_contact ? contact.trim() || null : null,
      });
      setPlayerSession({ code, team_id: res.team_id, team_code: res.team_code, nickname });
      setTeamCode(res.team_code);
      setCreateOpen(false);
      sfx.pop();
      void load();
    } catch (err) {
      showToast(frenchError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Jeu en continu : un membre appuie sur « Partir ». On vérifie d'abord son
   * téléphone, PENDANT QUE LE CHRONO EST ENCORE À ZÉRO — vérifier après le
   * départ ferait payer sa vérification à chaque équipe, et une pénalité de
   * plusieurs minutes à celle qui doit aller rallumer un réglage.
   */
  function demarrer() {
    if (preflightFait(code)) {
      void partir();
      return;
    }
    setVerifDepart(true);
  }

  /**
   * Départ de l'équipe (jeu en continu) : c'est ici que naît le parcours et
   * que le chrono se déclenche. Idempotent côté base — deux coéquipiers qui
   * appuient en même temps ne remettent pas le chrono à zéro.
   */
  async function partir() {
    setBusy(true);
    try {
      await rpc("start_team", {});
      sfx.fanfare();
      startedRef.current = true;
      router.replace(`/play/${code}/game`);
    } catch (err) {
      showToast(frenchError(err), "error");
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
      showToast(frenchError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function rejoinByTeamCode(e: React.FormEvent, forcedCode?: string) {
    e.preventDefault();
    const teamCodeToUse = forcedCode ?? rejoinCode;
    setBusy(true);
    try {
      const res = await rpc<{ team_id: string; team_code: string }>("join_by_team_code", {
        p_code: code,
        p_team_code: teamCodeToUse,
        p_nickname: nickname,
      });
      setPlayerSession({ code, team_id: res.team_id, team_code: res.team_code, nickname });
      setRejoinOpen(false);
      setInvitedTeamCode(null);
      sfx.pop();
      // On recharge, et c'est `load` qui tranche : si l'équipe rejointe est
      // déjà partie, on bascule sur le jeu ; sinon on l'attend ici.
      await load();
    } catch (err) {
      showToast(
        err instanceof Error && err.message.includes("CODE_EQUIPE_INVALIDE")
          ? "Code équipe introuvable dans cette partie."
          : frenchError(err),
        "error"
      );
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

  // La vérification du téléphone avant le départ (jeu en continu). Les
  // réglages sont lus à la source : `settings` n'est déclaré qu'après le garde
  // de chargement, plus bas.
  if (verifDepart) {
    return (
      <Preflight
        charter={lobby?.game?.settings?.charter}
        onTermine={() => {
          marquerPreflight(code);
          setVerifFaite(true);
          setVerifDepart(false);
          void partir();
        }}
      />
    );
  }

  // La même vérification, en attendant le lancement (départ groupé) : chacun
  // règle SON téléphone au calme, plutôt que tout le monde au coup d'envoi.
  if (verifLobby) {
    return (
      <Preflight
        contexte="lobby"
        charter={lobby?.game?.settings?.charter}
        onTermine={() => {
          marquerPreflight(code);
          setVerifFaite(true);
          setVerifLobby(false);
        }}
        onFermer={() => setVerifLobby(false)}
      />
    );
  }

  if (!lobby?.game) return <Spinner label="Ouverture du lobby…" />;

  const me = lobby.me;
  const myTeam = me ? lobby.teams?.find((t) => t.id === me.team_id) : null;
  const settings = lobby.game.settings;
  const continu = !!settings.continuous;
  const status = lobby.game.status;
  // 0, absent ou négatif = PAS DE PLAFOND — même lecture que create_team et
  // join_team côté SQL. Avec un 0 en base, toutes les équipes paraissaient
  // complètes et le compteur affichait « 2/0 ».
  const maxBrut = settings.max_players_per_team;
  const maxPlayers = maxBrut != null && maxBrut > 0 ? maxBrut : null;
  const rules = charterRules(settings.charter);
  // Départ groupé et partie lancée : les inscriptions sont fermées. Un
  // retardataire rejoint SON équipe par le code que lui donne son capitaine.
  const inscriptionsFermees = !continu && status !== "lobby";

  return (
    <main className="min-h-dvh px-5 py-8 pt-safe-page pb-safe-page max-w-lg mx-auto flex flex-col gap-6">
      <div className="text-center">
        <Link href="/" className="inline-block">
          <Logo className="w-72 max-w-[78vw] mx-auto" />
        </Link>
        <h1 className="font-display text-2xl text-parchment mt-3 leading-tight">
          {lobby.game.name}
        </h1>
        <p className="font-mono font-bold text-gold tracking-[0.3em]">{code}</p>
        {!me && (
          <Link href="/play" className="contents">
            <Button size="sm" variant="ghost" className="mt-2">
              ← CHANGER DE CODE
            </Button>
          </Link>
        )}
      </div>

      {/* Le mot du maître du jeu : thème et déroulé de la chasse */}
      {settings.briefing && (
        <Card className="p-4">
          <p className="font-display text-sm text-ink/60 mb-1.5">📜 LE MOT DU MAÎTRE DU JEU</p>
          <div
            className="font-bold text-ink/85 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderRich(settings.briefing) }}
          />
        </Card>
      )}

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
              <div className="mb-3">
                <p className="font-bold text-sm text-ink/60 mb-2">
                  Invite tes coéquipiers en un tap :
                </p>
                <div className="flex gap-2 justify-center">
                  <Button size="sm" variant="gold" onClick={shareInvite}>
                    🔗 Partager le lien
                  </Button>
                  <Button size="sm" variant="parchment" onClick={openInvite}>
                    📱 QR code
                  </Button>
                </div>
                <p className="font-bold text-xs text-ink/45 mt-2">
                  ou code équipe : <span className="font-mono tracking-[0.2em]">{teamCode}</span>
                </p>
              </div>
            )}
            {status === "lobby" ? (
              <motion.p
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 2 }}
                className="font-display text-lg text-leaf"
              >
                {continu ? "⏳ En attente de l'ouverture…" : "⏳ En attente du lancement…"}
              </motion.p>
            ) : (continu || myTeam.started_at === null) && status === "paused" ? (
              <p className="font-display text-lg text-ink/60">
                ⏸️ Partie en pause — le départ attend la reprise.
              </p>
            ) : (continu || myTeam.started_at === null) && status === "running" ? (
              // Jeu en continu : la partie est ouverte, c'est l'équipe qui
              // décide de son départ. Le chrono ne court qu'à partir de là.
              <Button full size="xl" variant="leaf" onClick={demarrer} disabled={busy}>
                {busy ? "…" : "🚀 PARTIR MAINTENANT"}
              </Button>
            ) : null}
          </Card>
          <p className="text-center font-bold text-parchment/50 text-sm">
            {continu && status !== "lobby"
              ? "Rien ne presse : le chrono ne part qu'à cet appui, une fois tout le groupe là. ⏱️"
              : "Garde cette page ouverte : la chasse démarre automatiquement ! 🏴‍☠️"}
          </p>

          {/* La vérification du téléphone, au calme. En jeu continu elle
              s'impose au départ ; ici, chacun peut la faire en attendant. */}
          {verifFaite ? (
            <Button full size="md" variant="ghost" onClick={() => setVerifLobby(true)}>
              ✅ TÉLÉPHONE VÉRIFIÉ — REVOIR
            </Button>
          ) : (
            <Button full size="lg" variant="parchment" onClick={() => setVerifLobby(true)}>
              📱 VÉRIFIER MON TÉLÉPHONE
            </Button>
          )}

          {/* La charte EN CLAIR pour les coéquipiers en jeu continu : seul celui
              qui appuie sur « Partir » traverse la vérification (et sa charte).
              Les autres n'ont que cette page, et peu de temps pour la lire. */}
          {continu && (
            <Card className="p-4">
              <Consignes charter={settings.charter} />
            </Card>
          )}
          <Briefing
            charter={settings.charter}
            ordreFixe={settings.route_mode === "fixe"}
            unattended={!!settings.unattended}
            continuous={continu}
          />
        </>
      ) : invitedTeamCode ? (
        <Card className="p-5 text-center">
          <div className="text-4xl mb-1">🎉</div>
          <h2 className="font-display text-xl mb-1">Tu es invité·e !</h2>
          <p className="font-bold text-ink/60 mb-4">
            Rejoins l&apos;équipe et c&apos;est parti — juste ton prénom !
          </p>
          <form onSubmit={(e) => rejoinByTeamCode(e, invitedTeamCode)} className="space-y-3">
            <Input
              autoFocus
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Ton prénom"
              maxLength={20}
              className="text-center"
            />
            <Button type="submit" full size="lg" disabled={busy}>
              {busy ? "…" : "⚓ REJOINDRE L'ÉQUIPE"}
            </Button>
          </form>
          <Button
            full
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setInvitedTeamCode(null)}
          >
            🔄 PAS LA BONNE ÉQUIPE ? CHOISIR MOI-MÊME
          </Button>
        </Card>
      ) : (
        <>
          {/* À lire AVANT de choisir son équipage */}
          <Briefing
            charter={settings.charter}
            ordreFixe={settings.route_mode === "fixe"}
            unattended={!!settings.unattended}
            continuous={continu}
          />
          {inscriptionsFermees ? (
            <Card className="p-5 text-center">
              <div className="text-4xl mb-1">⛵</div>
              <h2 className="font-display text-xl mb-1">La chasse a commencé !</h2>
              <p className="font-bold text-ink/60">
                Les inscriptions sont fermées. Pour rejoindre ton équipe, demande son code
                d&apos;équipe à ton capitaine (menu ☰ de son téléphone).
              </p>
            </Card>
          ) : (
            <>
              <h2 className="font-display text-xl text-parchment -mb-2">Choisis ton équipage :</h2>
              <div className="space-y-3">
                {(lobby.teams ?? []).length === 0 && (
                  <p className="font-bold text-parchment/50 text-sm text-center">
                    Aucune équipe pour l&apos;instant — crée la tienne !
                  </p>
                )}
                {(lobby.teams ?? []).map((team) => {
                  const full = maxPlayers != null && team.players.length >= maxPlayers;
                  const allNames = Array.from(new Set([...team.players, ...(team.roster ?? [])]));
                  return (
                    <button
                      key={team.id}
                      type="button"
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
          <Button
            full
            size="md"
            variant="ghost"
            onClick={() => {
              setNickname("");
              setRejoinCode("");
              setRejoinOpen(true);
            }}
          >
            🔑 J&apos;AI DÉJÀ UN CODE ÉQUIPE
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
            <Label>TON prénom (tu es le capitaine)</Label>
            <Input
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Ton prénom à toi"
              maxLength={20}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              C&apos;est bien TON prénom ici, pas le nom de l&apos;équipe.
            </p>
          </div>
          {/* Le contact, FACULTATIF : un seul pour l'équipe, celui du capitaine
              — et seulement si l'organisateur l'a demandé. C'est lui qu'on
              joindra si l'équipe gagne. */}
          {settings.ask_contact && (
            <div>
              <Label>
                E-mail ou téléphone <span className="text-ink/45 normal-case">— facultatif</span>
              </Label>
              <Input
                type="text"
                inputMode="email"
                autoComplete="email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="pour être prévenus si vous gagnez"
                maxLength={160}
              />
              <p className="text-xs font-bold text-ink/50 mt-1 leading-relaxed">
                Uniquement pour vous prévenir si votre équipe gagne. Rien d&apos;autre n&apos;en sera
                fait, et le champ peut rester vide.
              </p>
            </div>
          )}
          <div>
            <Label>Tes coéquipiers (facultatif, un prénom par ligne)</Label>
            <TextArea
              rows={3}
              value={membersText}
              onChange={(e) => setMembersText(e.target.value)}
              placeholder={"Léa\nHugo\nJade"}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              Utile si vous jouez sur un seul téléphone. Sinon, invite-les avec le lien après.
            </p>
          </div>

          {/* Charte de l'aventurier — le capitaine s'engage pour son équipe */}
          <label className="flex items-start gap-2.5 rounded-xl border-[3px] border-ink bg-white/60 p-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-6 h-6 mt-0.5 shrink-0 accent-[#2E5E3A]"
              checked={charterAccepted}
              onChange={(e) => setCharterAccepted(e.target.checked)}
            />
            <span className="flex-1">
              <span className="font-bold text-sm text-ink/85">
                Au nom de mon équipe, j&apos;accepte la charte de l&apos;aventurier (respect des
                balises, des autres équipes et de la sécurité).
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={(e) => {
                  e.preventDefault();
                  setCharterOpen(true);
                }}
              >
                📜 LIRE LA CHARTE
              </Button>
            </span>
          </label>

          <Button type="submit" full size="lg" disabled={busy || !charterAccepted}>
            {busy ? "…" : "🏴‍☠️ HISSER LE DRAPEAU"}
          </Button>
        </form>
      </Dialog>

      {/* Charte de l'aventurier */}
      <Dialog open={charterOpen} onClose={() => setCharterOpen(false)} title="📜 Charte de l'aventurier">
        <div className="space-y-3">
          <p className="font-bold text-ink/70">
            En tant que capitaine, je m&apos;engage — pour toute mon équipe — à :
          </p>
          <ul className="space-y-2.5">
            {rules.map((rule, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-2xl shrink-0">{rule.icon}</span>
                <div>
                  {rule.title && (
                    <p className="font-display text-sm leading-tight">{rule.title}</p>
                  )}
                  <p className="font-bold text-ink/65 text-sm">{rule.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <Button
            full
            variant="leaf"
            onClick={() => {
              setCharterAccepted(true);
              setCharterOpen(false);
            }}
          >
            ✅ J&apos;accepte au nom de mon équipe
          </Button>
        </div>
      </Dialog>

      {/* QR d'invitation */}
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title="📱 Inviter dans l'équipe">
        <div className="space-y-3 text-center">
          <p className="font-bold text-ink/70">
            Tes coéquipiers scannent ce QR (appareil photo) → ils rejoignent directement ton
            équipe !
          </p>
          {inviteQr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={inviteQr}
              alt="QR d'invitation"
              className="w-56 h-56 mx-auto border-[3px] border-ink rounded-xl"
            />
          )}
          <Button full variant="gold" onClick={shareInvite}>
            🔗 Ou partager le lien
          </Button>
        </div>
      </Dialog>

      {/* Dialog reconnexion par code équipe */}
      <Dialog open={rejoinOpen} onClose={() => setRejoinOpen(false)} title="🔑 Retrouver mon équipe">
        <form onSubmit={rejoinByTeamCode} className="space-y-4">
          <div>
            <Label>Code équipe (donné à la création)</Label>
            <Input
              autoFocus
              required
              value={rejoinCode}
              onChange={(e) => setRejoinCode(e.target.value.toUpperCase())}
              placeholder="EX : K7M2PX"
              className="font-mono tracking-[0.3em] text-center text-2xl"
              maxLength={8}
            />
          </div>
          <div>
            <Label>Ton pseudo</Label>
            <Input
              required
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Capitaine Max"
              maxLength={20}
            />
          </div>
          <Button type="submit" full size="lg" disabled={busy}>
            {busy ? "…" : "⚓ REMBARQUER"}
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
  if (raw.includes("PARTIE_DEJA_LANCEE"))
    return "La partie est déjà lancée : demande le code d'équipe à ton capitaine pour la rejoindre.";
  if (raw.includes("EQUIPE_PLEINE")) return "Cette équipe est complète.";
  if (raw.includes("MAX_EQUIPES_ATTEINT")) return "Le nombre maximum d'équipes est atteint.";
  if (raw.includes("PSEUDO_REQUIS")) return "Choisis un pseudo !";
  if (raw.includes("NOM_EQUIPE_REQUIS")) return "Donne un nom à ton équipe !";
  if (raw.includes("NON_INSCRIT")) return "Forme d'abord ton équipe !";
  return frError(err, "Erreur inconnue — réessaie");
}
