"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sb } from "@/lib/supabase/client";
import { tagUrl } from "@/lib/game/codes";
import type { Game, Step, StepSecrets, StepType } from "@/lib/types";
import { MINIGAMES } from "@/components/minigames/registry";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

const TYPE_LABEL: Record<StepType, string> = {
  nfc: "🏷️ Balise",
  text: "💬 Énigme",
  minigame: "🎮 Mini-jeu",
  photo: "📸 Photo",
  gps: "📍 Balise GPS",
};

/**
 * L'antisèche terrain : tout le parcours avec réponses, codes de secours et
 * indices sur une page imprimable. Le papier ne tombe jamais en panne. 🔋
 */
export default function AntisechePage() {
  const { user, loading } = useOrgAuth();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [secretsMap, setSecretsMap] = useState<Record<string, StepSecrets>>({});

  const load = useCallback(async () => {
    const [g, s] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("steps").select("*").eq("game_id", gameId).order("order_hint").order("created_at"),
    ]);
    setGame(g.data as Game);
    const rows = (s.data as Step[]) ?? [];
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

  if (loading || !user || !game) return <Spinner label="Préparation de l'antisèche…" />;

  return (
    <main className="min-h-dvh bg-white text-ink px-5 py-6 max-w-2xl mx-auto print:p-2 print:max-w-none">
      <header className="mb-5 print:hidden">
        <Link href={`/org/games/${gameId}/edit`} className="font-bold text-ink/50 underline py-2 inline-block">
          ← Retour à l&apos;éditeur
        </Link>
        <div className="flex items-center justify-between gap-3 mt-1 flex-wrap">
          <h1 className="font-display text-3xl">📜 Antisèche terrain</h1>
          <Button onClick={() => window.print()} variant="gold">
            🖨️ Imprimer
          </Button>
        </div>
        <p className="font-bold text-crimson text-sm mt-2">
          ⚠️ Document confidentiel : toutes les réponses y figurent. À garder dans TA poche !
        </p>
      </header>

      {/* En-tête imprimé */}
      <div className="border-[3px] border-ink rounded-xl p-3 mb-5">
        <p className="font-display text-xl">
          {game.name} — code partie :{" "}
          <span className="font-mono tracking-[0.2em]">{game.code}</span>
        </p>
        <p className="font-bold text-sm text-ink/60">
          {steps.length} étape{steps.length > 1 ? "s" : ""} · classement{" "}
          {game.settings.scoring === "points" ? "aux points" : "au temps"} ·
          l&apos;ordre ci-dessous est celui de l&apos;éditeur (chaque équipe reçoit le pool mélangé)
        </p>
      </div>

      <div className="space-y-4">
        {steps.map((step, i) => {
          const secrets = secretsMap[step.id];
          const minigame = step.content.minigame ? MINIGAMES[step.content.minigame.kind] : null;
          return (
            <div key={step.id} className="border-2 border-ink rounded-xl p-3 break-inside-avoid">
              <p className="font-display">
                {i + 1}. {TYPE_LABEL[step.type]} — {step.title}
                {step.is_final && " 🏁 FINALE"}
                {step.is_common_checkpoint && " 📍 COMMUN"}
              </p>
              {step.content.body && (
                <p className="text-sm text-ink/70 font-bold mt-1 whitespace-pre-line">
                  {step.content.body}
                </p>
              )}
              <div className="mt-2 space-y-1 text-sm font-bold">
                {(secrets?.answers ?? []).length > 0 && (
                  <p>
                    ✅ Réponse{(secrets?.answers ?? []).length > 1 ? "s" : ""} :{" "}
                    <span className="font-mono bg-parchment px-1.5 py-0.5 rounded border border-ink/30">
                      {(secrets?.answers ?? []).join("  ·  ")}
                    </span>
                  </p>
                )}
                {step.type === "nfc" && secrets?.manual_code && (
                  <>
                    <p>
                      🔢 Code de secours :{" "}
                      <span className="font-mono text-base tracking-[0.2em] bg-parchment px-1.5 py-0.5 rounded border border-ink/30">
                        {secrets.manual_code}
                      </span>
                    </p>
                    {secrets.nfc_tag_id && (
                      <p className="text-ink/60 break-all">🔗 {tagUrl(secrets.nfc_tag_id)}</p>
                    )}
                  </>
                )}
                {step.content.rdv && (
                  <p>
                    🧭 Rendez-vous :{" "}
                    <span className="font-mono bg-parchment px-1.5 py-0.5 rounded border border-ink/30">
                      {step.content.rdv.lat}, {step.content.rdv.lng}
                    </span>
                  </p>
                )}
                {step.type === "gps" && secrets?.gps_lat != null && (
                  <p>
                    📍 Cible GPS :{" "}
                    <span className="font-mono bg-parchment px-1.5 py-0.5 rounded border border-ink/30">
                      {secrets.gps_lat}, {secrets.gps_lng}
                    </span>{" "}
                    · rayon {secrets.gps_radius_m ?? 30} m
                  </p>
                )}
                {minigame && (
                  <p>
                    {minigame.icon} {minigame.name}
                    {step.content.minigame?.config &&
                      Object.keys(step.content.minigame.config).length > 0 && (
                        <span className="text-ink/60 font-mono text-xs">
                          {" "}
                          (
                          {Object.entries(step.content.minigame.config)
                            .filter(([, v]) => typeof v !== "object" || v === null)
                            .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
                            .join(", ")}
                          )
                        </span>
                      )}
                  </p>
                )}
                {step.type === "photo" && <p>📸 Validation à faire depuis le dashboard live</p>}
                {(secrets?.hints ?? []).map((hint, hi) => (
                  <p key={hi} className="text-ink/70">
                    💡 Indice {hi + 1} : {hint.text}
                    <span className="text-ink/50">
                      {hint.penalty_sec ? ` (+${Math.round(hint.penalty_sec / 60)} min)` : ""}
                      {hint.unlock_after_sec
                        ? ` (gratuit après ${Math.round(hint.unlock_after_sec / 60)} min)`
                        : ""}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-xs font-bold text-ink/40 print:block">
        TOYAH GAMES — antisèche organisateur · {game.code}
      </p>
    </main>
  );
}
