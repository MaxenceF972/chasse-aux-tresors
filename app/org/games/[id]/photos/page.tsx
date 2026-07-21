"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { sb, rpc } from "@/lib/supabase/client";
import type { Game, Step, Submission, Team } from "@/lib/types";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import { useGameInvalidate } from "@/lib/hooks/useGameChannel";
import { showToast } from "@/components/ui/Toaster";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Dialog from "@/components/ui/Dialog";
import Spinner from "@/components/ui/Spinner";

const STATUS_BADGE: Record<Submission["status"], { label: string; cls: string }> = {
  pending: { label: "⏳ À juger", cls: "bg-gold text-ink" },
  approved: { label: "✅ Validée", cls: "bg-leaf text-parchment" },
  rejected: { label: "❌ Refusée", cls: "bg-crimson text-parchment" },
};

/**
 * Galerie des photos de la partie : jugement (valider/refuser), désignation de
 * la meilleure, consultation plein écran et téléchargement (unitaire + ZIP).
 * Accès réservé à l'organisateur (RLS + garde useOrgAuth).
 */
export default function PhotosPage() {
  const { user, loading } = useOrgAuth();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [lightbox, setLightbox] = useState<Submission | null>(null);
  const [zipping, setZipping] = useState(false);

  const load = useCallback(async () => {
    const [g, t, s, sub] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("teams").select("*").eq("game_id", gameId),
      sb().from("steps").select("*").eq("game_id", gameId),
      sb().from("submissions").select("*").eq("game_id", gameId).order("created_at"),
    ]);
    setGame(g.data as Game);
    setTeams((t.data as Team[]) ?? []);
    setSteps((s.data as Step[]) ?? []);
    setSubmissions((sub.data as Submission[]) ?? []);
  }, [gameId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);
  useGameInvalidate(user ? gameId : null, load);

  const teamMap = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const stepMap = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps]);

  // Regroupées par équipe
  const byTeam = useMemo(() => {
    const map = new Map<string, Submission[]>();
    for (const sub of submissions) {
      map.set(sub.team_id, [...(map.get(sub.team_id) ?? []), sub]);
    }
    return map;
  }, [submissions]);

  async function review(sub: Submission, approve: boolean) {
    try {
      await rpc("org_review_photo", { p_submission_id: sub.id, p_approve: approve });
      await load();
    } catch (err) {
      showToast(`Échec : ${err instanceof Error ? err.message : "erreur"}`, "error");
    }
  }

  async function setWinner(sub: Submission) {
    try {
      await rpc("org_set_photo_winner", { p_submission_id: sub.id });
      await load();
    } catch (err) {
      showToast(`Échec : ${err instanceof Error ? err.message : "erreur"}`, "error");
    }
  }

  function fileName(sub: Submission): string {
    const team = teamMap.get(sub.team_id)?.name ?? "equipe";
    const step = stepMap.get(sub.step_id)?.title ?? "etape";
    const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 30);
    return `${safe(team)}_${safe(step)}_${sub.id.slice(0, 6)}.webp`;
  }

  async function downloadOne(sub: Submission) {
    try {
      const res = await fetch(sub.url);
      const blob = await res.blob();
      triggerDownload(URL.createObjectURL(blob), fileName(sub));
    } catch {
      // repli : ouvrir dans un onglet
      window.open(sub.url, "_blank");
    }
  }

  async function downloadZip() {
    if (!submissions.length) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      await Promise.all(
        submissions.map(async (sub) => {
          try {
            const res = await fetch(sub.url);
            zip.file(fileName(sub), await res.blob());
          } catch {
            /* photo inaccessible — ignorée */
          }
        })
      );
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(URL.createObjectURL(blob), `photos-${game?.code ?? "toyah"}.zip`);
    } catch {
      showToast("Téléchargement ZIP impossible", "error");
    } finally {
      setZipping(false);
    }
  }

  if (loading || !user || !game) return <Spinner label="Chargement de la galerie…" />;

  const pendingCount = submissions.filter((s) => s.status === "pending").length;

  return (
    <main className="min-h-dvh px-5 py-6 max-w-3xl mx-auto pb-16">
      <header className="mb-6">
        <Link href={`/org/games/${gameId}/live`} className="font-bold text-parchment/70 underline py-2 inline-block">
          ← Dashboard live
        </Link>
        <div className="flex items-center justify-between gap-3 mt-1 flex-wrap">
          <h1 className="font-display text-3xl text-parchment">🖼️ Galerie photos</h1>
          {submissions.length > 0 && (
            <Button variant="gold" onClick={downloadZip} disabled={zipping}>
              {zipping ? "⏳ Compression…" : "⬇️ Tout télécharger (ZIP)"}
            </Button>
          )}
        </div>
        <p className="font-bold text-parchment/60 text-sm mt-1">
          {submissions.length} photo{submissions.length > 1 ? "s" : ""}
          {pendingCount > 0 && ` · ${pendingCount} à juger`} · désigne ta 🏅 préférée pour la
          récompense « meilleure photo »
        </p>
      </header>

      {submissions.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="text-5xl mb-3">📸</div>
          <p className="font-display text-xl mb-1">Aucune photo pour l&apos;instant</p>
          <p className="font-bold text-ink/60">
            Les épreuves photo apparaîtront ici au fil de la partie.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {teams
            .filter((t) => (byTeam.get(t.id) ?? []).length > 0)
            .map((team) => (
              <div key={team.id}>
                <h2 className="font-display text-xl text-parchment mb-2 flex items-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border-2 border-parchment/50"
                    style={{ backgroundColor: team.color }}
                  />
                  {team.name}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(byTeam.get(team.id) ?? []).map((sub) => {
                    const badge = STATUS_BADGE[sub.status];
                    return (
                      <Card key={sub.id} className="p-0 overflow-hidden">
                        <button
                          className="block w-full aspect-square bg-ink"
                          onClick={() => setLightbox(sub)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={sub.url}
                            alt={stepMap.get(sub.step_id)?.title ?? ""}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </button>
                        <div className="p-2 space-y-1.5">
                          <p className="font-bold text-xs text-ink/70 truncate">
                            {stepMap.get(sub.step_id)?.title ?? "Étape"}
                          </p>
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border border-ink ${badge.cls}`}>
                              {badge.label}
                            </span>
                            {sub.is_winner && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-ink bg-gold text-ink">
                                🏅 Gagnante
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1">
                            {sub.status !== "approved" && (
                              <button
                                className="flex-1 h-10 rounded-lg border-2 border-ink bg-leaf text-parchment text-xs font-bold"
                                onClick={() => review(sub, true)}
                              >
                                ✅
                              </button>
                            )}
                            {sub.status !== "rejected" && (
                              <button
                                className="flex-1 h-10 rounded-lg border-2 border-ink bg-crimson text-parchment text-xs font-bold"
                                onClick={() => review(sub, false)}
                              >
                                ❌
                              </button>
                            )}
                            <button
                              className={`flex-1 h-10 rounded-lg border-2 border-ink text-xs font-bold ${
                                sub.is_winner ? "bg-gold text-ink" : "bg-white text-ink"
                              }`}
                              onClick={() => setWinner(sub)}
                              aria-label="Désigner meilleure photo"
                            >
                              🏅
                            </button>
                          </div>
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Plein écran */}
      <Dialog open={!!lightbox} onClose={() => setLightbox(null)} title={lightbox ? stepMap.get(lightbox.step_id)?.title ?? "Photo" : ""}>
        {lightbox && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt=""
              className="w-full rounded-xl border-[3px] border-ink bg-ink"
            />
            <p className="font-bold text-ink/70 text-sm">
              {teamMap.get(lightbox.team_id)?.name} — {STATUS_BADGE[lightbox.status].label}
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" variant="leaf" onClick={() => { review(lightbox, true); setLightbox(null); }}>
                ✅ Valider
              </Button>
              <Button className="flex-1" variant="crimson" onClick={() => { review(lightbox, false); setLightbox(null); }}>
                ❌ Refuser
              </Button>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" variant={lightbox.is_winner ? "gold" : "parchment"} onClick={() => setWinner(lightbox)}>
                🏅 {lightbox.is_winner ? "Meilleure photo ✓" : "Meilleure photo"}
              </Button>
              <Button className="flex-1" variant="parchment" onClick={() => downloadOne(lightbox)}>
                ⬇️ Télécharger
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </main>
  );
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
