"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { frError, sb } from "@/lib/supabase/client";
import type { Game, Step, StepSecrets, StepType } from "@/lib/types";
import { DEFAULT_CHARTER_LINES } from "@/lib/game/charter";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import StepEditor from "@/components/org/StepEditor";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import { showToast } from "@/components/ui/Toaster";
import { useConfirm } from "@/components/ui/Confirm";

const TYPE_ICON: Record<StepType, string> = { nfc: "🏷️", text: "💬", minigame: "🎮", photo: "📸", gps: "📍" };
const TYPE_LABEL: Record<StepType, string> = { nfc: "Balise", text: "Énigme", minigame: "Mini-jeu", photo: "Photo", gps: "Balise GPS" };

export default function GameEditPage() {
  const { user, loading } = useOrgAuth();
  const { confirm: confirmDlg, confirmDialog } = useConfirm();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [secretsMap, setSecretsMap] = useState<Record<string, StepSecrets>>({});
  const [editing, setEditing] = useState<{ step: Step | null; type: StepType } | null>(null);
  const [copied, setCopied] = useState(false);
  // Les secrets doivent être chargés AVANT d'éditer une étape existante :
  // ouvrir l'éditeur avec secrets=null écraserait réponses/indices et
  // régénérerait l'identifiant NFC (puces déjà écrites invalidées).
  const [secretsReady, setSecretsReady] = useState(false);

  const load = useCallback(async () => {
    const [gameRes, stepsRes] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("steps").select("*").eq("game_id", gameId).order("order_hint").order("created_at"),
    ]);
    if (gameRes.data) setGame(gameRes.data as Game);
    const stepRows = (stepsRes.data as Step[]) ?? [];
    setSteps(stepRows);
    if (stepRows.length) {
      const { data: secs, error: secErr } = await sb()
        .from("step_secrets")
        .select("*")
        .in("step_id", stepRows.map((s) => s.id));
      if (secErr) {
        setSecretsReady(false);
        showToast("Chargement des secrets d'étapes impossible — recharge la page avant d'éditer.", "error");
        return;
      }
      const map: Record<string, StepSecrets> = {};
      for (const s of (secs as StepSecrets[]) ?? []) map[s.step_id] = s;
      setSecretsMap(map);
      setSecretsReady(true);
    } else {
      setSecretsReady(true);
    }
  }, [gameId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const editable = game?.status === "lobby";
  const poolCount = useMemo(
    () => steps.filter((s) => !s.is_common_checkpoint && !s.is_final).length,
    [steps]
  );
  const hasFinal = useMemo(() => steps.some((s) => s.is_final), [steps]);

  async function move(index: number, dir: -1 | 1) {
    const other = index + dir;
    if (other < 0 || other >= steps.length) return;
    const a = steps[index];
    const b = steps[other];
    // Échange les order_hint (réindexe si égaux)
    const hintA = b.order_hint === a.order_hint ? a.order_hint + dir : b.order_hint;
    await Promise.all([
      sb().from("steps").update({ order_hint: hintA }).eq("id", a.id),
      sb().from("steps").update({ order_hint: a.order_hint }).eq("id", b.id),
    ]);
    // Réindexation propre pour éviter les collisions au fil du temps
    const reordered = [...steps];
    [reordered[index], reordered[other]] = [reordered[other], reordered[index]];
    await Promise.all(
      reordered.map((s, i) => sb().from("steps").update({ order_hint: i * 10 }).eq("id", s.id))
    );
    void load();
  }

  async function deleteStep(step: Step) {
    const ok = await confirmDlg({
      title: "Supprimer l'étape ?",
      message: `« ${step.title} » sera retirée du parcours.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const { error } = await sb().from("steps").delete().eq("id", step.id);
    if (error) {
      showToast(`Suppression impossible : ${frError(error, "erreur")}`, "error");
      return;
    }
    showToast("Étape supprimée", "success");
    void load();
  }

  async function saveSettings(patch: Record<string, unknown>) {
    if (!game) return;
    const settings = { ...game.settings, ...patch };
    setGame({ ...game, settings });
    const { error } = await sb().from("games").update({ settings }).eq("id", gameId);
    if (error) showToast(`Réglage non enregistré : ${frError(error, "erreur")}`, "error");
  }

  if (loading || !user || !game) return <Spinner label="Chargement…" />;

  return (
    <main className="min-h-dvh px-5 py-6 max-w-2xl mx-auto pb-24">
      <header className="mb-6">
        <Link href="/org/dashboard" className="font-bold text-parchment/60 underline">
          ← Mes parties
        </Link>
        <div className="flex items-end justify-between gap-3 mt-2">
          <h1 className="font-display text-3xl text-parchment leading-tight">{game.name}</h1>
        </div>
        <button
          className="mt-2 inline-flex items-center gap-2 bg-gold text-ink font-mono font-bold text-xl tracking-[0.3em] px-4 py-1.5 rounded-xl border-[3px] border-ink shadow-[3px_3px_0_0_#111111] active:translate-y-[2px]"
          onClick={async () => {
            await navigator.clipboard.writeText(game.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copier le code"
        >
          {game.code} <span className="text-sm tracking-normal">{copied ? "✅" : "📋"}</span>
        </button>
        <p className="text-parchment/50 font-bold text-sm mt-1">
          Partage ce code avec les joueurs pour qu&apos;ils rejoignent la partie.
        </p>
      </header>

      {!editable && (
        <Card dark className="p-4 mb-6 border-gold">
          <p className="font-bold">
            ⚠️ La partie est {game.status === "finished" ? "terminée" : "lancée"} — le parcours
            n&apos;est plus modifiable.{" "}
            <Link href={`/org/games/${gameId}/live`} className="underline text-gold">
              Ouvrir le dashboard live →
            </Link>
          </p>
        </Card>
      )}

      {/* Présentation & charte */}
      <Card className="p-4 mb-6">
        <h2 className="font-display text-lg mb-3">📜 Présentation & charte</h2>
        <div className="space-y-3">
          <div>
            <Label>Le mot du maître du jeu (affiché aux joueurs au lobby)</Label>
            <TextArea
              rows={4}
              defaultValue={game.settings.briefing ?? ""}
              placeholder={"Bienvenue moussaillons ! Le trésor du Capitaine a disparu…\nThème, déroulé, consignes du jour — **gras** et *italique* supportés."}
              onBlur={(e) => saveSettings({ briefing: e.target.value.trim() || undefined })}
            />
          </div>
          <div>
            <Label>Charte du capitaine (une règle par ligne — vide = charte par défaut)</Label>
            <TextArea
              rows={5}
              defaultValue={(game.settings.charter ?? []).join("\n")}
              placeholder={DEFAULT_CHARTER_LINES.join("\n")}
              onBlur={(e) =>
                saveSettings({
                  charter: e.target.value
                    .split("\n")
                    .map((l) => l.trim())
                    .filter(Boolean),
                })
              }
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              Le capitaine devra l&apos;accepter au nom de son équipe avant de la créer. Astuce :
              « Titre : détail » met le titre en avant.
            </p>
          </div>
        </div>
      </Card>

      {/* Réglages */}
      <Card className="p-4 mb-6">
        <h2 className="font-display text-lg mb-3">Réglages</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Équipes max</Label>
            <Input
              type="number"
              min={1}
              disabled={!editable}
              defaultValue={game.settings.max_teams ?? ""}
              placeholder="∞"
              onBlur={(e) =>
                saveSettings({ max_teams: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </div>
          <div>
            <Label>Joueurs / équipe max</Label>
            <Input
              type="number"
              min={1}
              disabled={!editable}
              defaultValue={game.settings.max_players_per_team ?? ""}
              placeholder="∞"
              onBlur={(e) =>
                saveSettings({
                  max_players_per_team: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
        </div>
        <div className="mt-3">
          <Label>Classement</Label>
          <div className="flex gap-2">
            {(
              [
                { v: "time", label: "⏱️ Au temps", help: "le plus rapide gagne" },
                { v: "points", label: "🎯 Aux points", help: "étapes + scores des mini-jeux" },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={!editable}
                onClick={() => saveSettings({ scoring: o.v })}
                className={`flex-1 p-2 rounded-xl border-[3px] border-ink text-left disabled:opacity-60 ${
                  (game.settings.scoring ?? "time") === o.v ? "bg-gold" : "bg-white"
                }`}
              >
                <span className="font-display text-sm">{o.label}</span>
                <span className="block text-xs font-bold text-ink/60">{o.help}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label>
              Pénalité « passer un mini-jeu »
              {(game.settings.scoring ?? "time") === "points" ? " (points)" : " (min)"}
            </Label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              disabled={!editable}
              defaultValue={
                (game.settings.scoring ?? "time") === "points"
                  ? game.settings.skip_penalty_points ?? 50
                  : Math.round((game.settings.skip_penalty_sec ?? 180) / 60)
              }
              onBlur={(e) =>
                saveSettings(
                  (game.settings.scoring ?? "time") === "points"
                    ? { skip_penalty_points: Number(e.target.value) || 0 }
                    : { skip_penalty_sec: (Number(e.target.value) || 0) * 60 }
                )
              }
            />
          </div>
          <div>
            <Label>Pénalité « photo refusée » (min)</Label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              disabled={!editable}
              defaultValue={Math.round((game.settings.photo_penalty_sec ?? 180) / 60)}
              onBlur={(e) => saveSettings({ photo_penalty_sec: (Number(e.target.value) || 0) * 60 })}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">Mode chrono. En points : 0 point sur l&apos;étape.</p>
          </div>
        </div>
      </Card>

      {/* Parcours */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-2xl text-parchment">Parcours</h2>
        <span className="font-bold text-parchment/50 text-sm">
          {steps.length} étape{steps.length > 1 ? "s" : ""} · pool {poolCount}
        </span>
      </div>

      {steps.length === 0 && (
        <Card className="p-6 text-center mb-4">
          <p className="font-bold text-ink/60">
            Ajoute tes premières énigmes ! Le pool aléatoire est distribué dans un ordre différent
            à chaque équipe. 🎲
          </p>
        </Card>
      )}

      <div className="space-y-3 mb-5">
        {steps.map((step, i) => (
          <Card key={step.id} className="p-3">
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-1.5">
                <button
                  disabled={!editable || i === 0}
                  onClick={() => move(i, -1)}
                  className="w-10 h-10 rounded-lg border-2 border-ink bg-white font-bold text-lg disabled:opacity-30 active:bg-parchment-dark"
                  aria-label="Monter"
                >
                  ↑
                </button>
                <button
                  disabled={!editable || i === steps.length - 1}
                  onClick={() => move(i, 1)}
                  className="w-10 h-10 rounded-lg border-2 border-ink bg-white font-bold text-lg disabled:opacity-30 active:bg-parchment-dark"
                  aria-label="Descendre"
                >
                  ↓
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display truncate">
                  {TYPE_ICON[step.type]} {step.title}
                </div>
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {step.is_final ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-crimson text-parchment border-2 border-ink">
                      🏁 Sprint final
                    </span>
                  ) : step.is_common_checkpoint ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-leaf text-parchment border-2 border-ink">
                      📍 Palier commun
                    </span>
                  ) : (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-parchment-dark border-2 border-ink">
                      🎲 Pool
                    </span>
                  )}
                  {step.type === "minigame" && step.content.minigame && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-white border-2 border-ink">
                      {step.content.minigame.kind}
                    </span>
                  )}
                  {step.media_urls.length > 0 && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-white border-2 border-ink">
                      📷 {step.media_urls.length}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  size="sm"
                  variant="parchment"
                  disabled={!editable}
                  onClick={() => {
                    if (!secretsReady) {
                      showToast("Chargement des réponses en cours — réessaie dans une seconde.", "info");
                      return;
                    }
                    setEditing({ step, type: step.type });
                  }}
                >
                  ✏️
                </Button>
                <Button size="sm" variant="crimson" disabled={!editable} onClick={() => deleteStep(step)}>
                  🗑️
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {editable && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
          {(Object.keys(TYPE_ICON) as StepType[]).map((t) => (
            <Button key={t} variant="gold" onClick={() => setEditing({ step: null, type: t })}>
              ➕ {TYPE_ICON[t]} {TYPE_LABEL[t]}
            </Button>
          ))}
        </div>
      )}

      {/* Liens bas de page */}
      <div className="flex flex-wrap gap-3">
        <Link href={`/org/games/${gameId}/preview`} className="contents">
          <Button variant="gold">🧪 Tester mon parcours</Button>
        </Link>
        <Link href={`/org/games/${gameId}/balises`} className="contents">
          <Button variant="parchment">🏷️ Balises NFC / QR</Button>
        </Link>
        <Link href={`/org/games/${gameId}/antiseche`} className="contents">
          <Button variant="parchment">📜 Antisèche</Button>
        </Link>
        <Link href={`/org/games/${gameId}/live`} className="contents">
          <Button variant="leaf">📡 Dashboard live {game.status === "lobby" ? "& lancement" : ""}</Button>
        </Link>
      </div>

      {!hasFinal && steps.length > 1 && (
        <p className="mt-4 text-sm font-bold text-gold/80">
          💡 Conseil : marque une étape comme « Sprint final » pour un finish commun à toutes les
          équipes.
        </p>
      )}

      {editing && (
        <StepEditor
          gameId={gameId}
          step={editing.step}
          secrets={editing.step ? (secretsMap[editing.step.id] ?? null) : null}
          initialType={editing.type}
          nextOrderHint={(steps.length ? Math.max(...steps.map((s) => s.order_hint)) : 0) + 10}
          hasOtherFinal={steps.some((s) => s.is_final && s.id !== editing.step?.id)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDialog}
    </main>
  );
}
