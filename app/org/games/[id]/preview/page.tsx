"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { sb } from "@/lib/supabase/client";
import type { Game, Step, StepSecrets } from "@/lib/types";
import { normalizeAnswer } from "@/lib/game/normalize";
import { isVideoUrl } from "@/lib/game/media";
import { renderRich } from "@/lib/game/rich";
import { sfx } from "@/lib/game/sounds";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import MinigameModal from "@/components/play/MinigameModal";
import ProgressPath from "@/components/ui/ProgressPath";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";

/**
 * Mode test : l'organisateur joue son parcours dans l'ordre de l'éditeur,
 * sans équipe ni enregistrement — idéal pour tout valider avant le jour J.
 */
export default function PreviewPage() {
  const { user, loading } = useOrgAuth();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [secretsMap, setSecretsMap] = useState<Record<string, StepSecrets>>({});
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [wrong, setWrong] = useState(false);
  const [minigameOpen, setMinigameOpen] = useState(false);

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("steps").select("*").eq("game_id", gameId).order("order_hint").order("created_at"),
    ]);
    setGame(g.data as Game);
    const rows = (s.data as Step[]) ?? [];
    // même ordre logique que le jeu : la finale à la fin
    rows.sort((a, b) => Number(a.is_final) - Number(b.is_final));
    setSteps(rows);
    if (rows.length) {
      const { data: secs } = await sb()
        .from("step_secrets")
        .select("*")
        .in("step_id", rows.map((r) => r.id));
      const map: Record<string, StepSecrets> = {};
      for (const sec of (secs as StepSecrets[]) ?? []) map[sec.step_id] = sec;
      setSecretsMap(map);
    }
  }, [gameId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (loading || !user || !game) return <Spinner label="Préparation du test…" />;

  const step = steps[index];
  const secrets = step ? secretsMap[step.id] : undefined;
  const done = index >= steps.length;

  function next() {
    sfx.success();
    setAnswer("");
    setIndex((i) => i + 1);
  }

  function checkAnswer() {
    const ok = (secrets?.answers ?? []).some(
      (a) => normalizeAnswer(a) !== "" && normalizeAnswer(a) === normalizeAnswer(answer)
    );
    if (ok) next();
    else {
      sfx.fail();
      setWrong(true);
      setTimeout(() => setWrong(false), 600);
    }
  }

  return (
    <main className="min-h-dvh parchment-texture text-ink pb-16">
      <header className="sticky top-0 z-30 bg-ink text-parchment px-4 py-2.5">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
          <Link href={`/org/games/${gameId}/edit`} className="font-bold underline text-parchment/70">
            ← Éditeur
          </Link>
          <span className="font-display text-gold">🧪 MODE TEST</span>
          <span className="font-bold text-parchment/60 text-sm tabular-nums">
            {Math.min(index + 1, steps.length)}/{steps.length}
          </span>
        </div>
      </header>

      <div className="max-w-lg mx-auto px-4">
        <p className="mt-3 rounded-xl border-[3px] border-ink bg-gold/20 px-3 py-2 font-bold text-sm">
          Rien n&apos;est enregistré — tu joues le parcours dans l&apos;ordre de l&apos;éditeur
          (en vraie partie, le pool est mélangé par équipe).
        </p>

        <div className="mt-2">
          <ProgressPath total={Math.max(steps.length, 2)} done={index} />
        </div>

        {done ? (
          <div className="text-center py-10 space-y-4">
            <div className="text-6xl">🧪✅</div>
            <h1 className="font-display text-3xl">PARCOURS VALIDÉ !</h1>
            <p className="font-bold text-ink/60">
              Les {steps.length} étapes fonctionnent. Prêt pour le jour J ?
            </p>
            <div className="flex flex-col gap-2 items-center">
              <Button onClick={() => setIndex(0)} variant="parchment">
                🔁 REJOUER LE TEST
              </Button>
              <Link href={`/org/games/${gameId}/live`} className="contents">
                <Button size="lg">📡 DASHBOARD LIVE</Button>
              </Link>
            </div>
          </div>
        ) : step ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={step.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mt-3 space-y-5"
            >
              <div className="flex items-center gap-2">
                <span className="font-display text-sm bg-ink text-gold px-2.5 py-1 rounded-lg -rotate-2">
                  ÉTAPE {index + 1}
                </span>
                {step.is_final && (
                  <span className="font-display text-sm bg-crimson text-parchment px-2.5 py-1 rounded-lg">
                    🏁 FINALE
                  </span>
                )}
                {step.is_common_checkpoint && (
                  <span className="font-display text-sm bg-leaf text-parchment px-2.5 py-1 rounded-lg">
                    📍 COMMUN
                  </span>
                )}
              </div>

              <h1 className="font-display text-3xl leading-tight">{step.title}</h1>

              {step.media_urls.map((url) =>
                isVideoUrl(url) ? (
                  <video key={url} src={url} controls playsInline className="w-full rounded-2xl border-[3px] border-ink" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt="" className="w-full rounded-2xl border-[3px] border-ink" />
                )
              )}

              {step.content.body && (
                <div
                  className="font-bold text-lg leading-relaxed text-ink/85"
                  dangerouslySetInnerHTML={{ __html: renderRich(step.content.body) }}
                />
              )}

              {/* Validation simulée selon le type */}
              {step.type === "text" && (
                <div className={wrong ? "animate-shake" : ""}>
                  <div className="flex gap-2">
                    <Input
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      placeholder="Ta réponse…"
                    />
                    <Button onClick={checkAnswer} disabled={!answer.trim()}>
                      OK
                    </Button>
                  </div>
                  <p className="text-xs font-bold text-ink/50 mt-1">
                    Réponses acceptées : {(secrets?.answers ?? []).join(" · ") || "(aucune !)"}
                  </p>
                </div>
              )}

              {step.type === "nfc" && (
                <div className="space-y-2">
                  <p className="font-bold text-sm text-ink/60">
                    Code manuel : <span className="font-mono">{secrets?.manual_code ?? "—"}</span>
                  </p>
                  <Button full size="lg" onClick={next}>
                    📡 SIMULER LE SCAN DE LA BALISE
                  </Button>
                </div>
              )}

              {step.type === "minigame" && step.content.minigame && (
                <>
                  <Button full size="xl" onClick={() => setMinigameOpen(true)}>
                    🎮 JOUER LE MINI-JEU
                  </Button>
                  {minigameOpen && (
                    <MinigameModal
                      kind={step.content.minigame.kind}
                      config={step.content.minigame.config}
                      seed={`preview:${step.id}`}
                      onClose={() => setMinigameOpen(false)}
                      onComplete={async (result) => {
                        if (result.answer !== undefined && (secrets?.answers ?? []).length > 0) {
                          const ok = (secrets?.answers ?? []).some(
                            (a) =>
                              normalizeAnswer(a) !== "" &&
                              normalizeAnswer(a) === normalizeAnswer(result.answer ?? "")
                          );
                          if (!ok) return false;
                        }
                        setMinigameOpen(false);
                        next();
                        return true;
                      }}
                    />
                  )}
                </>
              )}

              {step.type === "photo" && (
                <Button full size="lg" onClick={next}>
                  📸 SIMULER LA VALIDATION DE LA PHOTO
                </Button>
              )}

              {/* Indices visibles en clair pour l'organisateur */}
              {(secrets?.hints ?? []).length > 0 && (
                <div className="rounded-xl border-[3px] border-ink/20 p-3 space-y-1">
                  <p className="font-display text-sm text-ink/60">💡 Indices configurés :</p>
                  {(secrets?.hints ?? []).map((h, i) => (
                    <p key={i} className="font-bold text-sm text-ink/75">
                      {i + 1}. {h.text}{" "}
                      <span className="text-ink/45">
                        {h.penalty_sec ? `(+${Math.round(h.penalty_sec / 60)} min)` : ""}
                        {h.unlock_after_sec ? ` (gratuit après ${Math.round(h.unlock_after_sec / 60)} min)` : ""}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              <button className="w-full text-center font-bold text-ink/50 underline" onClick={next}>
                Passer cette étape →
              </button>
            </motion.div>
          </AnimatePresence>
        ) : (
          <p className="font-bold text-ink/60 py-10 text-center">
            Aucune étape — ajoute des énigmes dans l&apos;éditeur !
          </p>
        )}
      </div>
    </main>
  );
}
