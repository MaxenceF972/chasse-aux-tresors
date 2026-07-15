"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { usePlayState } from "@/components/play/usePlayState";
import { useWakeLock } from "@/lib/hooks/useWakeLock";
import { isVideoUrl } from "@/lib/game/media";
import { renderRich } from "@/lib/game/rich";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import type { ValidateKind } from "@/lib/types";
import { clearPlayerSession } from "@/lib/game/session";
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
  } = usePlayState();

  const [success, setSuccess] = useState<{ finished: boolean } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useWakeLock(!!state && state.game.status === "running");

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

  if (loading || !state) {
    return (
      <main className="min-h-dvh parchment-texture text-ink flex items-center justify-center">
        <Spinner label="Lecture de la carte…" />
      </main>
    );
  }

  const { game, team, progress, current, finished } = state;

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
      <header className="sticky top-0 z-30 bg-ink text-parchment border-b-[3px] border-ink shadow-md">
        <div className="max-w-lg mx-auto px-4 py-2.5 flex items-center gap-3">
          <span
            className="w-4 h-4 rounded-full border-2 border-parchment shrink-0"
            style={{ backgroundColor: team.color }}
            title={team.name}
          />
          <span className="font-display text-sm truncate flex-1">{team.name}</span>
          <Chrono
            startedAt={game.started_at}
            finishedAt={team.finished_at}
            penaltySeconds={team.penalty_seconds}
            className="font-display text-xl text-gold"
          />
          <span className="font-bold text-parchment/60 text-sm tabular-nums">
            {progress.done}/{progress.total}
          </span>
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Menu"
            className="w-9 h-9 rounded-lg border-2 border-parchment/40 text-parchment font-bold active:bg-parchment/10"
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
                startedAt={game.started_at}
                finishedAt={team.finished_at}
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
              <div className="flex items-center gap-2">
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
              </div>

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
                disabled={game.status !== "running"}
                onSubmit={handleSubmit}
              />

              {/* Indices */}
              <HintPanel hints={current.hints} onUnlock={unlockHint} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

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
            className="fixed bottom-4 inset-x-4 z-50 max-w-lg mx-auto rounded-2xl border-[3px] border-ink bg-gold p-4 text-left shadow-[5px_5px_0_0_#111111]"
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
