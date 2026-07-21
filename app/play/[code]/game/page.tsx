"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayState } from "@/components/play/usePlayState";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { useGeoShare } from "@/lib/hooks/useGeoShare";
import { isVideoUrl } from "@/lib/game/media";
import { renderRich } from "@/lib/game/rich";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { getGeoConsent, isMuted, setGeoConsent, setMuted, type GeoConsent } from "@/lib/game/prefs";
import { enablePush, isPushEnabled, pushSupported } from "@/lib/push";
import type { PlayState, ValidateKind } from "@/lib/types";
import { clearPlayerSession } from "@/lib/game/session";
import { rpc } from "@/lib/supabase/client";
import { showToast } from "@/components/ui/Toaster";
import { TextArea, Label } from "@/components/ui/Input";
import MinigameModal from "@/components/play/MinigameModal";
import ValidationZone from "@/components/play/ValidationZone";
import HintPanel from "@/components/play/HintPanel";
import SuccessOverlay from "@/components/play/SuccessOverlay";
import ProgressPath from "@/components/ui/ProgressPath";
import Chrono from "@/components/ui/Chrono";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

export default function GameScreen() {
  const params = useParams<{ code: string }>();
  const code = params.code?.toUpperCase() ?? "";
  const router = useRouter();
  const {
    state,
    loading,
    notJoined,
    offline,
    pendingCount,
    orgMessage,
    clearOrgMessage,
    submit,
    unlockHint,
    refetch,
  } = usePlayState(code);

  const [success, setSuccess] = useState<{ finished: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactMessage, setContactMessage] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [redeemStep, setRedeemStep] = useState<PlayState["skipped_minigames"][number] | null>(null);
  const [timerNow, setTimerNow] = useState(() => Date.now());
  const [muted, setMutedState] = useState(false);
  const [geo, setGeo] = useState<GeoConsent>(null);
  const [pushState, setPushState] = useState<"off" | "on" | "busy">("off");
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    setMutedState(isMuted());
    setGeo(getGeoConsent());
    void isPushEnabled().then((on) => setPushState(on ? "on" : "off"));
  }, []);

  useWakeLock(!!state && state.game.status === "running");
  useGeoShare(geo === "granted" && state?.game.status === "running");

  // Redirections d'état
  useEffect(() => {
    if (notJoined) router.replace(`/play/${code}/lobby`);
  }, [notJoined, code, router]);
  useEffect(() => {
    if (!state) return;
    if (state.game.status === "lobby") router.replace(`/play/${code}/lobby`);
    if (state.game.status === "finished") router.replace(`/play/${code}/final`);
  }, [state, code, router]);

  // Message de l'organisateur → vibration + son
  useEffect(() => {
    if (orgMessage) {
      sfx.pop();
      haptics.scan();
    }
  }, [orgMessage]);

  // Tic du timer d'étape (si l'étape en a un)
  const hasTimer = !!state?.current?.step.time_limit_sec;
  useEffect(() => {
    if (!hasTimer) return;
    const t = setInterval(() => setTimerNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [hasTimer]);

  if (loading || !state) {
    return (
      <main className="min-h-dvh parchment-texture text-ink flex items-center justify-center">
        <Spinner label="Lecture de la carte…" />
      </main>
    );
  }

  const { game, team, progress, current, finished, skipped_minigames: skippedMinigames } = state;
  const teamElapsedMs = team.final_time_ms ?? game.elapsed_ms;
  const chronoTicking = game.status === "running" && !team.finished_at;
  const isPoints = game.settings.scoring === "points";
  const skipPenaltyLabel = isPoints
    ? `−${game.settings.skip_penalty_points ?? 50} points`
    : `+${Math.round((game.settings.skip_penalty_sec ?? 180) / 60)} min`;

  // Timer d'étape : temps restant (null si pas de limite)
  const timerLeftSec =
    current?.step.time_limit_sec != null
      ? Math.ceil(
          current.step.time_limit_sec -
            (timerNow - new Date(current.started_at).getTime()) / 1000
        )
      : null;

  async function handleTimeoutSkip() {
    if (!current) return;
    const res = await rpc<{ ok: boolean; error?: string }>("skip_step_timeout", {
      p_step_id: current.step.id,
    }).catch(() => ({ ok: false }));
    if (res.ok) {
      showToast("Temps écoulé — étape passée (0 point)", "info");
      await refetch();
    }
  }

  async function sendContactMessage() {
    if (!contactMessage.trim()) return;
    setContactBusy(true);
    try {
      await rpc("send_team_message", { p_message: contactMessage.trim() });
      showToast("Message envoyé au maître du jeu 📣", "success");
      setContactMessage("");
      setContactOpen(false);
    } catch {
      showToast("Envoi impossible — vérifie ta connexion", "error");
    } finally {
      setContactBusy(false);
    }
  }

  async function handleSubmit(kind: ValidateKind, payload: Record<string, unknown>) {
    const outcome = await submit(kind, payload);
    if (outcome.status === "correct") {
      sfx.success();
      haptics.success();
      setSuccess({ finished: outcome.finished });
      if (outcome.finished) sfx.fanfare();
    }
    return outcome;
  }

  return (
    <main className="min-h-dvh parchment-texture text-ink pb-10">
      {/* Barre du haut */}
      <header className="sticky top-0 z-30 bg-ink text-parchment border-b-[3px] border-ink shadow-md pt-[env(safe-area-inset-top)]">
        <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center gap-3">
          <span
            className="w-4 h-4 rounded-full border-2 border-parchment shrink-0"
            style={{ backgroundColor: team.color }}
            title={team.name}
          />
          <span className="font-display text-sm truncate flex-1">{team.name}</span>
          <Chrono
            elapsedMs={teamElapsedMs}
            ticking={chronoTicking}
            penaltySeconds={team.penalty_seconds}
            className="font-display text-xl text-gold"
          />
          <span className="font-bold text-parchment/60 text-sm tabular-nums">
            {progress.done}/{progress.total}
          </span>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="w-11 h-11 -mr-1 shrink-0 rounded-lg border-2 border-parchment/40 text-parchment font-bold text-lg active:bg-parchment/10"
          >
            ☰
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4">
        {/* Bandeaux d'état */}
        {offline && (
          <div className="mt-3 rounded-xl border-[3px] border-ink bg-gold px-3 py-2 font-bold text-sm">
            📶 Hors-ligne — {pendingCount > 0
              ? `${pendingCount} validation${pendingCount > 1 ? "s" : ""} en attente d'envoi.`
              : "tes actions seront synchronisées au retour du réseau."}
          </div>
        )}
        {team.penalty_seconds > 0 && (
          <p className="mt-2 text-right text-xs font-bold text-crimson">
            ⏱️ +{Math.round(team.penalty_seconds / 60)} min de pénalités
          </p>
        )}

        {/* Consentement au partage de position (suivi organisateur) */}
        {geo === null && game.status === "running" && (
          <div className="mt-3 rounded-xl border-[3px] border-ink bg-white/60 p-3">
            <p className="font-bold text-sm text-ink/80 mb-2">
              📍 Partager la position de l&apos;équipe avec l&apos;organisateur ? (sécurité et
              suivi sur sa carte — rien n&apos;est visible par les autres équipes)
            </p>
            <div className="flex gap-2">
              <button
                className="flex-1 h-10 rounded-xl border-[3px] border-ink bg-gold font-display text-sm"
                onClick={() => {
                  setGeoConsent("granted");
                  setGeo("granted");
                }}
              >
                OUI, ACTIVER
              </button>
              <button
                className="flex-1 h-10 rounded-xl border-[3px] border-ink bg-white font-display text-sm"
                onClick={() => {
                  setGeoConsent("denied");
                  setGeo("denied");
                }}
              >
                Non merci
              </button>
            </div>
          </div>
        )}

        {/* Chemin de progression vers le X */}
        <div className="mt-2">
          <ProgressPath total={progress.total} done={progress.done} color={team.color} />
        </div>

        {/* Équipe arrivée au bout */}
        {finished && (
          <div className="text-center py-10 space-y-5">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1, rotate: [0, -5, 5, 0] }}
              transition={{ type: "spring", stiffness: 200 }}
              className="text-7xl"
            >
              🏆
            </motion.div>
            <h1 className="font-display text-3xl">PARCOURS TERMINÉ !</h1>
            <p className="font-bold text-ink/60">
              Votre temps :{" "}
              <Chrono
                elapsedMs={teamElapsedMs}
                ticking={false}
                penaltySeconds={team.penalty_seconds}
                className="text-ink"
              />
            </p>
            <Button size="lg" onClick={() => router.push(`/play/${code}/final`)}>
              🏅 VOIR LE CLASSEMENT
            </Button>
          </div>
        )}

        {/* Énigme courante */}
        {!finished && current && (
          <AnimatePresence mode="wait">
            <motion.div
              key={current.step.id}
              initial={{ opacity: 0, scaleY: 0.2, rotateX: 35, transformOrigin: "top" }}
              animate={{ opacity: 1, scaleY: 1, rotateX: 0 }}
              exit={{ opacity: 0, y: -40, rotate: -3 }}
              transition={{ type: "spring", stiffness: 160, damping: 20 }}
              className="mt-3 space-y-5"
            >
              {/* En-tête d'étape */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display text-sm bg-ink text-gold px-2.5 py-1 rounded-lg -rotate-2">
                  ÉTAPE {current.position + 1}
                </span>
                {current.step.is_final && (
                  <span className="font-display text-sm bg-crimson text-parchment px-2.5 py-1 rounded-lg rotate-1">
                    🏁 SPRINT FINAL
                  </span>
                )}
                {current.step.is_common && !current.step.is_final && (
                  <span className="font-display text-sm bg-leaf text-parchment px-2.5 py-1 rounded-lg rotate-1">
                    📍 PALIER COMMUN
                  </span>
                )}
                {isPoints && (
                  <span className="font-display text-sm bg-gold text-ink px-2.5 py-1 rounded-lg rotate-1">
                    {current.step.points} PTS
                  </span>
                )}
                {timerLeftSec != null && (
                  <span
                    className={`font-display text-sm px-2.5 py-1 rounded-lg tabular-nums ${
                      timerLeftSec <= 0
                        ? "bg-crimson text-parchment"
                        : timerLeftSec <= 60
                          ? "bg-crimson/80 text-parchment animate-pulse"
                          : "bg-ink text-parchment"
                    }`}
                  >
                    ⌛{" "}
                    {timerLeftSec > 0
                      ? `${Math.floor(timerLeftSec / 60)}:${String(timerLeftSec % 60).padStart(2, "0")}`
                      : "TEMPS ÉCOULÉ"}
                  </span>
                )}
              </div>

              {timerLeftSec != null && timerLeftSec <= 0 && (
                <Button full variant="crimson" onClick={handleTimeoutSkip}>
                  ⌛ PASSER L&apos;ÉTAPE (temps écoulé — 0 point, sans pénalité)
                </Button>
              )}

              <h1 className="font-display text-3xl leading-tight">{current.step.title}</h1>

              {/* Médias */}
              {current.step.media_urls.length > 0 && (
                <div className="space-y-3">
                  {current.step.media_urls.map((url) =>
                    isVideoUrl(url) ? (
                      <video
                        key={url}
                        src={url}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111] bg-ink"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={url}
                        src={url}
                        alt=""
                        className="w-full rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111]"
                      />
                    )
                  )}
                </div>
              )}

              {/* Énoncé */}
              {current.step.content.body && (
                <div
                  className="font-bold text-lg leading-relaxed text-ink/85"
                  dangerouslySetInnerHTML={{ __html: renderRich(current.step.content.body) }}
                />
              )}

              {/* Validation */}
              <ValidationZone
                step={current.step}
                teamId={team.id}
                gameId={game.id}
                submission={current.submission}
                disabled={game.status !== "running"}
                skipPenaltyLabel={skipPenaltyLabel}
                onSubmit={handleSubmit}
                onRefetch={refetch}
                onAdvanced={(wasFinished) => {
                  sfx.success();
                  haptics.success();
                  if (wasFinished) sfx.fanfare();
                  setSuccess({ finished: wasFinished });
                  void refetch();
                }}
              />

              {/* Indices */}
              <HintPanel hints={current.hints} onUnlock={unlockHint} />

              <button
                className="w-full text-center font-bold text-ink/50 underline py-1"
                onClick={() => setContactOpen(true)}
              >
                🆘 Un souci sur le terrain ? Contacter le maître du jeu
              </button>
            </motion.div>
          </AnimatePresence>
        )}

        {/* Mini-jeux passés, à rattraper pour annuler la pénalité */}
        {!finished && skippedMinigames.length > 0 && (
          <div className="mt-6 rounded-xl border-[3px] border-dashed border-crimson/50 p-3">
            <p className="font-display text-sm text-crimson mb-2">
              🎮 MINI-JEUX À RATTRAPER ({skipPenaltyLabel.replace("−", "").replace("+", "")} de
              pénalité chacun — les réussir l&apos;annule !)
            </p>
            <div className="flex flex-wrap gap-2">
              {skippedMinigames.map((skippedStep) => (
                <button
                  key={skippedStep.id}
                  onClick={() => setRedeemStep(skippedStep)}
                  className="px-3 h-11 rounded-xl border-[3px] border-ink bg-white font-display text-sm shadow-[2px_2px_0_0_#111111] active:translate-y-[1px]"
                >
                  {skippedStep.content.minigame
                    ? `🎮 ${skippedStep.title}`
                    : skippedStep.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Rattrapage d'un mini-jeu passé */}
      {redeemStep?.content.minigame && (
        <MinigameModal
          kind={redeemStep.content.minigame.kind}
          config={redeemStep.content.minigame.config}
          seed={`${team.id}:${redeemStep.id}`}
          onClose={() => setRedeemStep(null)}
          onComplete={async (result) => {
            try {
              const res = await rpc<{ ok: boolean; correct?: boolean }>("redeem_minigame", {
                p_idem_key: crypto.randomUUID(),
                p_step_id: redeemStep.id,
                p_payload: {
                  answer: result.answer,
                  score: result.score,
                  duration_ms: result.durationMs,
                },
              });
              if (res.correct) {
                sfx.success();
                haptics.success();
                showToast("💪 Mini-jeu rattrapé — pénalité annulée !", "success");
                setRedeemStep(null);
                await refetch();
                return true;
              }
              return false;
            } catch {
              showToast("Connexion instable — réessaie", "error");
              return false;
            }
          }}
        />
      )}

      {/* Contacter le maître du jeu */}
      <Dialog open={contactOpen} onClose={() => setContactOpen(false)} title="🆘 Maître du jeu">
        <div className="space-y-4">
          <p className="font-bold text-ink/60 text-sm">
            Balise introuvable, souci sur le terrain, question ? Il reçoit ton message
            immédiatement sur son dashboard.
          </p>
          <div>
            <Label>Ton message</Label>
            <TextArea
              rows={3}
              autoFocus
              value={contactMessage}
              onChange={(e) => setContactMessage(e.target.value)}
              placeholder="La balise du lavoir est introuvable…"
              maxLength={300}
            />
          </div>
          <Button full size="lg" disabled={contactBusy || !contactMessage.trim()} onClick={sendContactMessage}>
            {contactBusy ? "…" : "📣 ENVOYER"}
          </Button>
        </div>
      </Dialog>

      {/* Overlay pause */}
      <AnimatePresence>
        {game.status === "paused" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-ink/85 flex flex-col items-center justify-center gap-4 px-8 text-center"
          >
            <div className="text-6xl animate-wiggle">⏸️</div>
            <h2 className="font-display text-3xl text-parchment">PARTIE EN PAUSE</h2>
            <p className="font-bold text-parchment/60">
              L&apos;organisateur a suspendu la chasse. Profitez-en pour souffler ! 🍃
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast message organisateur */}
      <AnimatePresence>
        {orgMessage && (
          <motion.button
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 120, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 24 }}
            onClick={clearOrgMessage}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] inset-x-4 z-50 max-w-lg mx-auto rounded-2xl border-[3px] border-ink bg-gold p-4 text-left shadow-[5px_5px_0_0_#111111]"
          >
            <p className="font-display text-sm mb-0.5">📨 MESSAGE DE L&apos;ORGANISATEUR</p>
            <p className="font-bold text-ink/85">{orgMessage.message}</p>
            <p className="text-xs font-bold text-ink/50 mt-1">(toucher pour fermer)</p>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Menu joueur */}
      <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="☰ Menu">
        <div className="space-y-4">
          <div className="rounded-xl border-[3px] border-ink/20 p-3">
            <p className="font-bold text-ink/60 text-sm">Ton équipe</p>
            <p className="font-display text-xl" style={{ color: team.color }}>
              {team.name}
            </p>
            <p className="font-bold text-ink/60 text-sm mt-1">
              Code équipe à partager :{" "}
              <span className="font-mono text-ink text-base tracking-[0.2em]">{team.team_code}</span>
            </p>
            <p className="font-bold text-ink/60 text-sm">
              Partie : <span className="font-mono text-ink">{game.code}</span> — {game.name}
            </p>
          </div>
          <Button
            full
            variant="parchment"
            onClick={() => {
              setMenuOpen(false);
              router.push(`/play/${code}/final`);
            }}
          >
            📊 VOIR LE CLASSEMENT
          </Button>
          <Button
            full
            variant="gold"
            onClick={() => {
              setMenuOpen(false);
              setContactOpen(true);
            }}
          >
            🆘 CONTACTER LE MAÎTRE DU JEU
          </Button>
          <Button
            full
            variant={muted ? "leaf" : "parchment"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setMutedState(next);
              if (!next) sfx.pop();
            }}
          >
            {muted ? "🔊 RÉACTIVER LE SON" : "🔇 COUPER SON & VIBRATIONS"}
          </Button>
          {pushSupported() && (
            <div>
              <Button
                full
                variant="parchment"
                disabled={pushState !== "off"}
                onClick={async () => {
                  setPushState("busy");
                  setPushError(null);
                  const res = await enablePush();
                  if (res.ok) {
                    setPushState("on");
                  } else {
                    setPushState("off");
                    setPushError(res.error ?? null);
                  }
                }}
              >
                {pushState === "on"
                  ? "🔔 ALERTES ACTIVÉES ✓"
                  : pushState === "busy"
                    ? "…"
                    : "🔔 ACTIVER LES ALERTES ORGA"}
              </Button>
              {pushError && <p className="text-crimson font-bold text-xs mt-1">{pushError}</p>}
            </div>
          )}
          <button
            className="w-full text-center font-bold text-ink/60 underline text-sm"
            onClick={() => {
              const next = geo === "granted" ? "denied" : "granted";
              setGeoConsent(next);
              setGeo(next);
            }}
          >
            📍 Partage de position : {geo === "granted" ? "activé (toucher pour couper)" : "coupé (toucher pour activer)"}
          </button>
          <Button
            full
            variant="crimson"
            onClick={() => {
              if (confirm("Quitter la partie sur ce téléphone ? (ton équipe continue sans toi)")) {
                clearPlayerSession();
                router.push("/");
              }
            }}
          >
            🚪 QUITTER LA PARTIE
          </Button>
        </div>
      </Dialog>

      {/* Animation de succès */}
      <SuccessOverlay
        show={!!success}
        finished={success?.finished}
        onDone={() => {
          const wasFinished = success?.finished;
          setSuccess(null);
          if (wasFinished) router.push(`/play/${code}/final`);
        }}
      />
    </main>
  );
}
