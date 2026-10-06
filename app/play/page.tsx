"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ensureAnonSession, frError, rpc } from "@/lib/supabase/client";
import type { GameSettings, LobbyState } from "@/lib/types";
import { getPlayerSession, setPlayerSession } from "@/lib/game/session";
import { marquerPreflight, preflightFait } from "@/lib/game/prefs";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import Logo from "@/components/ui/Logo";
import Preflight from "@/components/play/Preflight";

/**
 * Les temps de l'entrée. En départ groupé (le mode par défaut), seul le code
 * existe : il mène au lobby. En jeu continu, on choisit ensuite sa formule —
 * seul (départ immédiat) ou en équipe (le lobby rassemble le groupe) — et la
 * vérification du téléphone s'intercale avant le chrono.
 */
type Etape = "code" | "formule" | "solo" | "verif";

export default function JoinPage() {
  const router = useRouter();
  const [etape, setEtape] = useState<Etape>("code");
  const [code, setCode] = useState("");
  const [nomPartie, setNomPartie] = useState("");
  const [statutPartie, setStatutPartie] = useState<string>("running");
  /**
   * Les réglages de la partie, retenus à la saisie du code : le départ solo ne
   * passe par aucun lobby, et c'est ici la seule occasion de récupérer la
   * charte et les options de l'organisateur.
   */
  const [reglages, setReglages] = useState<GameSettings | null>(null);
  const [prenom, setPrenom] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * L'équipe déjà créée pour cet essai. Le départ peut échouer APRÈS la
   * création (partie en pause, réseau) : le second essai doit reprendre la
   * même équipe, jamais en semer une deuxième.
   */
  const equipeRef = useRef<{ team_id: string; team_code: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureAnonSession();
      const lobby = await rpc<LobbyState>("get_lobby", { p_code: code.trim() });
      if (lobby.error || !lobby.game) {
        setError("Partie introuvable — vérifie le code ! 🧐");
        return;
      }
      // Départ groupé (défaut) : le lobby fait tout, comme toujours.
      if (!lobby.game.settings?.continuous) {
        router.push(`/play/${lobby.game.code}/lobby`);
        return;
      }
      if (lobby.game.status === "finished") {
        setError("Cette chasse est terminée — à une prochaine fois ! 🏴‍☠️");
        return;
      }
      // Déjà dans une équipe de cette partie (retour, rechargement) : le lobby
      // sait la retrouver et basculer sur le jeu si elle est partie.
      if (lobby.me) {
        router.push(`/play/${lobby.game.code}/lobby`);
        return;
      }
      setStatutPartie(lobby.game.status);
      setReglages(lobby.game.settings);
      setNomPartie(lobby.game.name);
      setCode(lobby.game.code);
      setEtape("formule");
    } catch (err) {
      setError(frError(err, "Connexion impossible — réessaie"));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Le départ solo passe d'abord par la vérification du téléphone.
   *
   * L'ORDRE COMPTE : le chrono démarre à `start_team`. Vérifier après le
   * départ ferait payer à chaque joueur le temps de sa vérification — et
   * bien davantage à celui qui doit aller rallumer sa localisation dans les
   * réglages, c'est-à-dire exactement celui qu'on essaie d'aider.
   */
  function demarrer(e: React.FormEvent) {
    e.preventDefault();
    if (preflightFait(code)) {
      void partirSeul();
      return;
    }
    setEtape("verif");
  }

  /** Départ solo : une équipe d'une personne, créée et lancée d'un trait. */
  async function partirSeul() {
    setBusy(true);
    setError(null);
    try {
      // Une seule équipe par joueur, quoi qu'il arrive : on reprend celle de
      // l'essai précédent, ou celle qu'une session gardait déjà pour ce code.
      const dejaVue = getPlayerSession();
      let equipe =
        equipeRef.current ??
        (dejaVue?.code === code && dejaVue.team_code
          ? { team_id: dejaVue.team_id, team_code: dejaVue.team_code }
          : null);

      if (!equipe) {
        equipe = await rpc<{ team_id: string; team_code: string }>("create_team", {
          p_code: code,
          p_team_name: prenom.trim(),
          p_nickname: prenom.trim(),
          p_members: [],
          p_contact: reglages?.ask_contact ? contact.trim() || null : null,
        });
        equipeRef.current = equipe;
      }
      setPlayerSession({
        code,
        team_id: equipe.team_id,
        team_code: equipe.team_code,
        nickname: prenom.trim(),
      });

      // LA PARTIE N'EST PAS ENCORE OUVERTE : `start_team` refuserait. On fait
      // patienter le joueur au lobby, d'où il repart tout seul dès que
      // l'organisateur ouvre la partie.
      if (statutPartie === "lobby") {
        router.replace(`/play/${code}/lobby`);
        return;
      }

      await rpc("start_team", {});
      router.replace(`/play/${code}/game`);
    } catch (err) {
      setError(messageErreur(err));
      setBusy(false);
      // Retour au formulaire : pendant la vérification du téléphone, l'écran
      // est entièrement occupé par elle et le message ne se verrait nulle part
      // — le joueur croirait que le bouton ne fait rien, et rappuierait.
      setEtape("solo");
    }
  }

  if (etape === "verif") {
    return (
      <Preflight
        charter={reglages?.charter}
        onTermine={() => {
          marquerPreflight(code);
          void partirSeul();
        }}
      />
    );
  }

  const pasEncoreOuverte = statutPartie === "lobby";

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-10 pt-safe-page pb-safe-page gap-8">
      <Link href="/">
        <Logo className="w-80 max-w-[82vw]" />
      </Link>

      {etape === "code" && (
        <Card className="w-full max-w-sm p-6">
          <h1 className="font-display text-2xl mb-1">Rejoindre une partie</h1>
          <p className="font-bold text-ink/60 text-sm mb-5">
            Demande le code à 6 caractères à ton organisateur.
          </p>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Code de la partie</Label>
              <Input
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                  setError(null);
                }}
                placeholder="TRSR42"
                maxLength={6}
                className="font-mono tracking-[0.4em] text-center text-3xl h-16"
                autoComplete="off"
                autoCapitalize="characters"
                enterKeyHint="go"
              />
            </div>
            {error && <p className="text-crimson font-bold text-sm">{error}</p>}
            <Button type="submit" full size="xl" disabled={busy || code.length < 6}>
              {busy ? "…" : "🗺️ EN AVANT !"}
            </Button>
          </form>
        </Card>
      )}

      {etape === "formule" && (
        <Card className="w-full max-w-sm p-6">
          <p className="font-display text-sm text-gold-dark">🏴‍☠️ {nomPartie}</p>
          <h1 className="font-display text-2xl mt-1 leading-tight">
            Tu pars seul ou en équipe ?
          </h1>
          <p className="font-bold text-ink/60 text-sm mt-2">
            Chaque équipe a son propre chrono : partir plus tard ne pénalise personne.
          </p>
          <div className="mt-5 flex flex-col gap-3">
            <Button full size="lg" variant="gold" onClick={() => setEtape("solo")}>
              🧭 JE PARS SEUL
            </Button>
            <Button
              full
              size="lg"
              variant="leaf"
              onClick={() => router.push(`/play/${code}/lobby?creer=1`)}
            >
              ⛺ ON FORME UNE ÉQUIPE
            </Button>
            <Button
              full
              size="md"
              variant="outline"
              onClick={() => router.push(`/play/${code}/lobby`)}
            >
              🔑 REJOINDRE UNE ÉQUIPE
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-5"
            onClick={() => {
              setEtape("code");
              setError(null);
            }}
          >
            ← CHANGER DE CODE
          </Button>
        </Card>
      )}

      {etape === "solo" && (
        <Card className="w-full max-w-sm p-6">
          <form onSubmit={demarrer} className="space-y-4">
            <div>
              <p className="font-display text-sm text-gold-dark">🏴‍☠️ {nomPartie}</p>
              <h1 className="font-display text-2xl mt-1 leading-tight">Sous quel nom ?</h1>
              <p className="font-bold text-ink/60 text-sm mt-1">
                Il apparaîtra au classement.
              </p>
            </div>
            <div>
              <Label>Ton prénom ou pseudo</Label>
              <Input
                autoFocus
                required
                value={prenom}
                onChange={(e) => {
                  setPrenom(e.target.value);
                  setError(null);
                }}
                placeholder="Capitaine Max"
                maxLength={24}
                enterKeyHint={reglages?.ask_contact ? "next" : "go"}
              />
            </div>

            {/* Le contact, FACULTATIF et dit comme tel — et seulement si
                l'organisateur l'a demandé. Le rendre obligatoire transformerait
                le jeu en guichet ; le motif est écrit sous le champ, parce
                qu'un champ de contact sans motif se remplit mal ou faux. */}
            {reglages?.ask_contact && (
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
                  maxLength={160}
                  enterKeyHint="go"
                  placeholder="pour être prévenu si tu gagnes"
                />
                <p className="font-bold text-ink/50 text-xs mt-1.5 leading-relaxed">
                  Uniquement pour te prévenir si tu gagnes. Rien d&apos;autre n&apos;en sera fait,
                  et le champ peut rester vide.
                </p>
              </div>
            )}

            {pasEncoreOuverte && (
              <p className="font-bold text-ink/70 text-sm rounded-xl border-2 border-ink/20 bg-gold/20 px-3 py-2 leading-relaxed">
                ⏳ La chasse n&apos;est pas encore ouverte. Inscris-toi maintenant : le départ se
                fera tout seul dès que l&apos;organisateur l&apos;ouvre.
              </p>
            )}
            {error && <p className="text-crimson font-bold text-sm">{error}</p>}
            {/* Une vérification du téléphone s'intercale avant le chrono, la
                première fois : le libellé ne promet donc pas un départ immédiat
                à quelqu'un qui va voir un autre écran. */}
            <Button type="submit" full size="lg" disabled={busy || !prenom.trim()}>
              {busy
                ? "…"
                : pasEncoreOuverte
                  ? "✍️ M'INSCRIRE ET PATIENTER"
                  : preflightFait(code)
                    ? "🚀 LANCER LE CHRONO"
                    : "CONTINUER →"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEtape("formule");
                setError(null);
              }}
            >
              ← RETOUR
            </Button>
          </form>
        </Card>
      )}

      <Link href="/" className="contents">
        <Button size="sm" variant="ghost">← RETOUR À L&apos;ACCUEIL</Button>
      </Link>
    </main>
  );
}

function messageErreur(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (raw.includes("PSEUDO_REQUIS") || raw.includes("NOM_EQUIPE_REQUIS"))
    return "Indique ton prénom ou ton pseudo !";
  if (raw.includes("AUCUNE_ETAPE"))
    return "Le parcours n'est pas encore prêt — préviens l'organisateur.";
  return frError(err, "Impossible de lancer la chasse — réessaie");
}
