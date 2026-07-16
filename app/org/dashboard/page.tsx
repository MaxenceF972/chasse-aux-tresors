"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sb, rpc } from "@/lib/supabase/client";
import type { Game } from "@/lib/types";
import { GAME_TEMPLATES, type GameTemplate } from "@/lib/game/templates";
import { newTagId, randomCode } from "@/lib/game/codes";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Dialog from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import Logo from "@/components/ui/Logo";

const STATUS_LABEL: Record<Game["status"], { text: string; cls: string }> = {
  lobby: { text: "Lobby ouvert", cls: "bg-gold text-ink" },
  running: { text: "En cours", cls: "bg-leaf text-parchment" },
  paused: { text: "En pause", cls: "bg-parchment-dark text-ink" },
  finished: { text: "Terminée", cls: "bg-ink text-parchment" },
};

export default function OrgDashboardPage() {
  const { user, loading } = useOrgAuth();
  const router = useRouter();
  const [games, setGames] = useState<Game[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await sb()
      .from("games")
      .select("*")
      .order("created_at", { ascending: false });
    if (!error) setGames((data as Game[]) ?? []);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function createGame(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const game = await rpc<Game>("org_create_game", { p_name: newName });
      router.push(`/org/games/${game.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
      setBusy(false);
    }
  }

  async function deleteGame(game: Game) {
    if (!confirm(`Supprimer définitivement « ${game.name} » (${game.code}) ?`)) return;
    // Nettoie d'abord les médias Storage (sinon fichiers orphelins)
    try {
      const { data } = await sb().auth.getSession();
      if (data.session) {
        await fetch("/api/cleanup-media", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${data.session.access_token}`,
          },
          body: JSON.stringify({ game_id: game.id }),
        });
      }
    } catch {
      /* best-effort */
    }
    await sb().from("games").delete().eq("id", game.id);
    void load();
  }

  async function createFromTemplate(template: GameTemplate) {
    setBusy(true);
    setError(null);
    try {
      const game = await rpc<Game>("org_create_game", { p_name: template.name });
      for (let i = 0; i < template.steps.length; i++) {
        const ts = template.steps[i];
        const { data, error: stepErr } = await sb()
          .from("steps")
          .insert({
            game_id: game.id,
            type: ts.type,
            title: ts.title,
            content: {
              body: ts.body,
              minigame: ts.minigame,
            },
            media_urls: [],
            is_common_checkpoint: ts.is_common ?? false,
            is_final: ts.is_final ?? false,
            order_hint: i * 10,
          })
          .select("id")
          .single();
        if (stepErr) throw new Error(stepErr.message);
        const { error: secErr } = await sb().from("step_secrets").upsert({
          step_id: (data as { id: string }).id,
          answers: ts.answers ?? [],
          nfc_tag_id: ts.type === "nfc" ? newTagId() : null,
          manual_code: ts.type === "nfc" ? randomCode(6) : null,
          hints: ts.hints ?? [],
        });
        if (secErr) throw new Error(secErr.message);
      }
      router.push(`/org/games/${game.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
      setBusy(false);
      setTemplatesOpen(false);
    }
  }

  async function duplicateGame(game: Game) {
    setBusy(true);
    try {
      const copy = await rpc<Game>("org_duplicate_game", { p_game_id: game.id });
      router.push(`/org/games/${copy.id}/edit`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Duplication impossible");
      setBusy(false);
    }
  }

  if (loading || !user) return <Spinner label="Chargement…" />;

  return (
    <main className="min-h-dvh px-5 py-6 max-w-2xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <Link href="/">
          <Logo className="w-28" />
        </Link>
        <button
          className="font-bold text-parchment/60 underline"
          onClick={async () => {
            await sb().auth.signOut();
            router.replace("/");
          }}
        >
          Déconnexion
        </button>
      </header>

      <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
        <h1 className="font-display text-3xl text-parchment">Mes parties</h1>
        <div className="flex gap-2">
          <Button variant="parchment" onClick={() => setTemplatesOpen(true)}>📦 Modèles</Button>
          <Button onClick={() => setCreateOpen(true)}>➕ Nouvelle</Button>
        </div>
      </div>

      {games === null ? (
        <Spinner />
      ) : games.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-5xl mb-3">🗺️</div>
          <p className="font-display text-xl mb-1">Aucune partie pour l&apos;instant</p>
          <p className="font-bold text-ink/60 mb-5">
            Crée ta première chasse au trésor et cache tes balises !
          </p>
          <Button onClick={() => setCreateOpen(true)}>➕ CRÉER UNE PARTIE</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {games.map((game) => {
            const status = STATUS_LABEL[game.status];
            return (
              <Card key={game.id} className="p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="font-display text-xl leading-tight">{game.name}</h2>
                    <p className="font-mono font-bold text-ink/60 tracking-[0.2em]">
                      {game.code}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-lg border-2 border-ink font-display text-xs ${status.cls}`}
                  >
                    {status.text}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/org/games/${game.id}/edit`} className="contents">
                    <Button size="sm" variant="parchment">✏️ Éditer</Button>
                  </Link>
                  <Link href={`/org/games/${game.id}/live`} className="contents">
                    <Button size="sm" variant="leaf">📡 Live</Button>
                  </Link>
                  <Link href={`/org/games/${game.id}/balises`} className="contents">
                    <Button size="sm" variant="gold">🏷️ Balises</Button>
                  </Link>
                  <Button
                    size="sm"
                    variant="parchment"
                    disabled={busy}
                    onClick={() => duplicateGame(game)}
                    title="Dupliquer (mêmes balises, mêmes énigmes, nouveau code)"
                  >
                    📄 Dupliquer
                  </Button>
                  <Button size="sm" variant="crimson" onClick={() => deleteGame(game)}>
                    🗑️
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={templatesOpen} onClose={() => setTemplatesOpen(false)} title="📦 Modèles de parcours">
        <div className="space-y-3">
          <p className="font-bold text-ink/60 text-sm">
            Un parcours complet en un clic — tu pourras tout personnaliser dans l&apos;éditeur
            (les balises reçoivent des identifiants neufs).
          </p>
          {GAME_TEMPLATES.map((template) => (
            <button
              key={template.id}
              disabled={busy}
              onClick={() => createFromTemplate(template)}
              className="w-full text-left rounded-xl border-[3px] border-ink bg-white p-3 shadow-[3px_3px_0_0_#111111] active:translate-y-[2px] active:shadow-[1px_1px_0_0_#111111] disabled:opacity-50"
            >
              <span className="font-display text-lg">
                {template.icon} {template.name}
              </span>
              <span className="block text-sm font-bold text-ink/60">{template.description}</span>
              <span className="block text-xs font-bold text-leaf mt-0.5">{template.audience}</span>
            </button>
          ))}
          {busy && <p className="font-bold text-ink/60 text-center">⏳ Création du parcours…</p>}
        </div>
      </Dialog>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="Nouvelle partie">
        <form onSubmit={createGame} className="space-y-4">
          <div>
            <Label>Nom de la partie</Label>
            <Input
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="La chasse du Capitaine Toyah"
            />
          </div>
          {error && <p className="text-crimson font-bold text-sm">{error}</p>}
          <Button type="submit" full size="lg" disabled={busy || !newName.trim()}>
            {busy ? "…" : "🧭 CRÉER"}
          </Button>
        </form>
      </Dialog>
    </main>
  );
}
