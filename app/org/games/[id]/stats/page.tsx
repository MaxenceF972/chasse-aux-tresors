"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { frError, rpc, sb, toutesLesLignes } from "@/lib/supabase/client";
import type { Game, Player, Team } from "@/lib/types";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import { showToast } from "@/components/ui/Toaster";
import { useConfirm } from "@/components/ui/Confirm";

/**
 * LES STATISTIQUES D'UNE PARTIE — et l'écran des organisateurs invités.
 *
 * C'est la seule page qu'un invité peut ouvrir utilement, et elle ne fait que
 * LIRE. Ce n'est pas une politesse d'interface : le serveur refuse tout le
 * reste (voir `game_staff` dans supabase/setup.sql, et les scénarios de
 * tests/sql/organisateurs-invites.test.mjs). Cacher un bouton n'a jamais
 * protégé quoi que ce soit ; ici il n'y a rien à cacher, il n'y a rien à
 * faire.
 *
 * Le propriétaire y voit une chose de plus : la liste des invités, et de quoi
 * la tenir. Personne d'autre ne la voit.
 */

interface Avis {
  count: number;
  average: number | null;
  distribution: Record<string, number>;
}

interface Photo {
  id: string;
  url: string;
  team_id: string;
  status: string;
  created_at: string;
}

function duree(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

function Etoiles({ note, taille = "w-4 h-4" }: { note: number; taille?: string }) {
  return (
    <span className="flex shrink-0" aria-label={`${note} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          viewBox="0 0 24 24"
          className={taille}
          fill={n <= note ? "#F5A623" : "none"}
          stroke="#111111"
          strokeOpacity={n <= note ? 1 : 0.25}
          strokeWidth="1.8"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z" />
        </svg>
      ))}
    </span>
  );
}

export default function StatsPage() {
  const params = useParams<{ id: string }>();
  const gameId = params.id;
  const { user, loading } = useOrgAuth();
  const { confirm, confirmDialog } = useConfirm();

  const [game, setGame] = useState<Game | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [contacts, setContacts] = useState<Map<string, string>>(new Map());
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [avis, setAvis] = useState<Avis | null>(null);
  const [staff, setStaff] = useState<string[]>([]);
  const [nouvelEmail, setNouvelEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [pret, setPret] = useState(false);

  const charger = useCallback(async () => {
    const [g, t, p, c, s, ph] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).maybeSingle(),
      sb().from("teams").select("*").eq("game_id", gameId).order("created_at"),
      // Paginé : une partie à trois cents joueurs dépasse le plafond que
      // PostgREST applique en silence (voir `toutesLesLignes`).
      toutesLesLignes<Player>((de, a) =>
        sb().from("players").select("*").eq("game_id", gameId).order("id").range(de, a)
      ).then((data) => ({ data })),
      sb().from("team_contacts").select("team_id, contact").eq("game_id", gameId),
      // Vide pour un invité : la politique ne répond qu'au propriétaire.
      sb().from("game_staff").select("email").eq("game_id", gameId).order("email"),
      toutesLesLignes<Photo>((de, a) =>
        sb()
          .from("submissions")
          .select("id, url, team_id, status, created_at")
          .eq("game_id", gameId)
          .not("url", "is", null)
          .order("created_at")
          .range(de, a)
      ).then((data) => ({ data })),
    ]);
    setGame((g.data as Game) ?? null);
    setTeams((t.data as Team[]) ?? []);
    setPlayers((p.data as Player[]) ?? []);
    setContacts(
      new Map(
        ((c.data as { team_id: string; contact: string }[]) ?? []).map((x) => [x.team_id, x.contact])
      )
    );
    setStaff(((s.data as { email: string }[]) ?? []).map((x) => x.email));
    setPhotos((ph.data as Photo[]) ?? []);
    try {
      setAvis(await rpc<Avis>("get_ratings", { p_game_id: gameId }));
    } catch {
      setAvis(null);
    }
    setPret(true);
  }, [gameId]);

  useEffect(() => {
    if (user) void charger();
  }, [user, charger]);

  if (loading || !pret) return <Spinner label="Chargement…" />;

  // La partie ne se charge pas : ni propriétaire ni invité. On le dit, plutôt
  // que de laisser un écran vide qui ressemble à une panne.
  if (!game) {
    return (
      <main className="min-h-dvh px-5 py-10 pt-safe-page max-w-md mx-auto text-center">
        <div className="text-5xl">🔒</div>
        <h1 className="font-display text-2xl text-parchment mt-3">
          Cette chasse ne t&apos;est pas ouverte
        </h1>
        <p className="font-bold text-parchment/60 text-sm mt-3 leading-relaxed">
          Demande à l&apos;organisateur de t&apos;inviter avec l&apos;adresse de ce compte
          {user?.email ? (
            <>
              {" "}— <span className="font-mono">{user.email}</span>
            </>
          ) : null}
          .
        </p>
        <Link href="/org/dashboard" className="contents">
          <Button variant="ghost" className="mt-8">
            ← MES PARTIES
          </Button>
        </Link>
      </main>
    );
  }

  const proprietaire = game.created_by === user?.id;
  const parties = teams.filter((t) => t.started_at);
  const arrivees = teams.filter((t) => t.finished_at);
  const temps = arrivees
    .map((t) => t.final_time_ms)
    .filter((v): v is number => typeof v === "number");
  const moyenne = temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
  const photosVisibles = photos.filter((p) => p.status !== "rejected");
  const joueursPar = new Map<string, Player[]>();
  for (const p of players) {
    joueursPar.set(p.team_id, [...(joueursPar.get(p.team_id) ?? []), p]);
  }

  // QUI A MIS QUOI. Les notes sont par joueur ; `players` les porte déjà.
  // Triées en COMMENÇANT PAR LES PLUS BASSES : une moyenne rassure, ce sont
  // les deux étoiles qui disent quoi corriger, et on ne les cherche pas en bas
  // d'une liste.
  const nomEquipe = new Map(teams.map((t) => [t.id, t.name]));
  const notes = players
    .filter((p) => p.rating != null)
    .sort((a, b) => (a.rating ?? 0) - (b.rating ?? 0) || a.nickname.localeCompare(b.nickname));

  // LES ÉQUIPES DANS L'ORDRE DU RÉSULTAT, pas de leur inscription : cette page
  // sert d'abord à trouver quelqu'un — le gagnant, en général, pour le
  // prévenir. Trois familles : arrivées (au temps), encore en course (à
  // l'heure de départ), pas parties.
  const rang = (t: Team) => (t.finished_at ? 0 : t.started_at ? 1 : 2);
  const classees = [...teams].sort((a, b) => {
    if (rang(a) !== rang(b)) return rang(a) - rang(b);
    if (a.finished_at) return (a.final_time_ms ?? 0) - (b.final_time_ms ?? 0);
    if (a.started_at) return String(a.started_at).localeCompare(String(b.started_at ?? ""));
    return a.name.localeCompare(b.name);
  });

  async function inviter(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc("org_add_staff", { p_game_id: gameId, p_email: nouvelEmail });
      setNouvelEmail("");
      showToast("Invitation enregistrée ✅", "success");
      void charger();
    } catch (err) {
      showToast(frError(err), "error");
    } finally {
      setBusy(false);
    }
  }

  async function retirer(email: string) {
    if (
      !(await confirm({
        title: "Retirer cet accès ?",
        message: `${email} ne verra plus cette chasse au prochain chargement de page.`,
        confirmLabel: "Retirer",
        danger: true,
      }))
    )
      return;
    try {
      await rpc("org_remove_staff", { p_game_id: gameId, p_email: email });
      showToast("Accès retiré.", "success");
      void charger();
    } catch (err) {
      showToast(frError(err), "error");
    }
  }

  const statut =
    game.status === "running"
      ? "🟢 en cours"
      : game.status === "paused"
        ? "⏸️ en pause"
        : game.status === "finished"
          ? "🏁 terminée"
          : "⏳ pas encore lancée";

  return (
    <main className="min-h-dvh px-5 py-6 pt-safe-page pb-safe-page max-w-2xl mx-auto">
      {confirmDialog}

      <Link href="/org/dashboard" className="contents">
        <Button size="sm" variant="ghost">
          ← MES PARTIES
        </Button>
      </Link>
      <h1 className="font-display text-3xl text-parchment mt-3 leading-tight">📊 {game.name}</h1>
      <p className="font-bold text-parchment/55 text-sm mt-1">
        Code <span className="font-mono tracking-[0.15em] text-gold">{game.code}</span> · {statut}
        {game.settings?.continuous ? " · 🔁 en continu" : ""}
      </p>
      {!proprietaire && (
        <p className="font-bold text-parchment/45 text-xs mt-1">
          👀 Tu es invité sur cette chasse — lecture seule.
        </p>
      )}

      {/* ── LA PARTIE EN CHIFFRES ─────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="font-display text-xl text-gold">🏁 La partie</h2>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Card className="p-4">
            <p className="font-bold text-ink/55 text-xs">Arrivées au bout</p>
            <p className="font-display text-3xl tabular-nums mt-0.5">
              {arrivees.length}
              <span className="text-ink/35 text-xl"> / {teams.length}</span>
            </p>
          </Card>
          <Card className="p-4">
            <p className="font-bold text-ink/55 text-xs">Temps moyen</p>
            <p className="font-display text-3xl tabular-nums mt-0.5">{duree(moyenne)}</p>
          </Card>
        </div>
        <p className="font-bold text-parchment/55 text-sm mt-2 leading-relaxed">
          {teams.length} {teams.length > 1 ? "équipes inscrites" : "équipe inscrite"} ·{" "}
          {parties.length} parties · {players.length}{" "}
          {players.length > 1 ? "joueurs" : "joueur"} · {photosVisibles.length}{" "}
          {photosVisibles.length > 1 ? "photos" : "photo"}
        </p>
      </section>

      {/* ── L'AVIS DES JOUEURS ─────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-display text-xl text-gold">⭐ Ce qu&apos;ils en ont pensé</h2>
        {avis && avis.count > 0 ? (
          <Card className="mt-2 p-4">
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="font-display text-4xl tabular-nums">
                {avis.average?.toFixed(1)}
                <span className="text-ink/35 text-xl"> / 5</span>
              </p>
              <Etoiles note={Math.round(avis.average ?? 0)} taille="w-5 h-5" />
              <span className="font-bold text-ink/50 text-sm">
                {avis.count} {avis.count > 1 ? "réponses" : "réponse"}
              </span>
            </div>
            {/* La moyenne seule ment : 1 et 5 font 3, exactement comme 3 et 3.
                C'est le détail qui dit s'il y a un problème ou des goûts. */}
            <div className="mt-3 space-y-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const nb = avis.distribution[String(n)] ?? 0;
                const part = avis.count ? (100 * nb) / avis.count : 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-xs font-bold">
                    <span className="tabular-nums w-3 text-ink/60">{n}</span>
                    <div className="flex-1 h-2.5 rounded-full border-2 border-ink bg-white overflow-hidden">
                      <div className="h-full bg-gold" style={{ width: `${part}%` }} />
                    </div>
                    <span className="tabular-nums w-7 text-right text-ink/55">{nb}</span>
                  </div>
                );
              })}
            </div>

            {notes.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t-2 border-ink/10 pt-3">
                {notes.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <Etoiles note={p.rating ?? 0} taille="w-3.5 h-3.5" />
                    <span className="font-bold text-sm min-w-0 truncate">
                      {p.nickname}
                      {nomEquipe.get(p.team_id) && nomEquipe.get(p.team_id) !== p.nickname && (
                        <span className="text-ink/45"> · {nomEquipe.get(p.team_id)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <p className="font-bold text-parchment/50 text-sm mt-2 leading-relaxed">
            {game.settings?.ask_rating
              ? "Personne n'a encore noté. La question est posée à l'arrivée, aux joueurs dont l'équipe a terminé."
              : "La note n'est pas demandée pour cette partie — active « ⭐ Demander une note à la fin » dans l'éditeur."}
          </p>
        )}
      </section>

      {/* ── LES ÉQUIPES ───────────────────────────────────────────────── */}
      <section className="mt-8">
        <h2 className="font-display text-xl text-gold">👥 Les équipes</h2>
        {teams.length === 0 ? (
          <p className="font-bold text-parchment/50 text-sm mt-2">Personne pour l&apos;instant.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {classees.map((t, i) => {
              const contact = contacts.get(t.id);
              const membres = (joueursPar.get(t.id) ?? []).map((p) => p.nickname);
              // EN SOLO, LE NOM S'ÉCRIRAIT DEUX FOIS : le départ solo prend le
              // prénom comme nom d'équipe ET comme pseudo. C'est l'affichage
              // qui s'adapte.
              const solo = membres.length === 1 && membres[0] === t.name;
              // Le rang n'a de sens que pour les arrivées.
              const place = t.finished_at ? i + 1 : null;
              return (
                <Card key={t.id} className={`p-3.5 ${place === 1 ? "ring-4 ring-gold" : ""}`}>
                  <div className="flex items-baseline gap-2.5">
                    {place != null && (
                      <span
                        className={`font-display tabular-nums shrink-0 ${
                          place === 1 ? "text-gold-dark text-xl" : "text-ink/40 text-base"
                        }`}
                      >
                        {place === 1 ? "🥇" : place === 2 ? "🥈" : place === 3 ? "🥉" : place}
                      </span>
                    )}
                    <span
                      className="w-3 h-3 rounded-full border-2 border-ink shrink-0 self-center"
                      style={{ backgroundColor: t.color }}
                    />
                    <p className="font-display text-lg leading-tight flex-1 min-w-0">{t.name}</p>
                    <p className="font-bold text-ink/50 text-xs tabular-nums shrink-0">
                      {t.finished_at
                        ? duree(t.final_time_ms)
                        : t.started_at
                          ? "en course"
                          : "pas partie"}
                    </p>
                  </div>
                  <p className="font-bold text-ink/55 text-sm mt-1">
                    {solo ? "Seul" : membres.join(", ") || "—"}
                    {contact ? (
                      <>
                        {" · "}
                        <a
                          href={
                            contact.includes("@")
                              ? `mailto:${contact}`
                              : `tel:${contact.replace(/[^\d+]/g, "")}`
                          }
                          className="font-mono underline underline-offset-4 text-ink"
                        >
                          {contact}
                        </a>
                      </>
                    ) : game.settings?.ask_contact ? (
                      <span className="text-ink/35"> · sans contact</span>
                    ) : null}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── LES PHOTOS ────────────────────────────────────────────────── */}
      {photosVisibles.length > 0 && (
        <section className="mt-8">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-xl text-gold">📸 Les photos</h2>
            {proprietaire && (
              <Link href={`/org/games/${gameId}/photos`} className="contents">
                <Button size="sm" variant="parchment">
                  GALERIE & JUGEMENT
                </Button>
              </Link>
            )}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {photosVisibles.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.url}
                  alt=""
                  loading="lazy"
                  className="w-full aspect-square object-cover rounded-xl border-[3px] border-ink"
                />
              </a>
            ))}
          </div>
        </section>
      )}

      {/* ── LES INVITÉS — propriétaire uniquement ─────────────────────── */}
      {proprietaire && (
        <section className="mt-8">
          <h2 className="font-display text-xl text-gold">🤝 Organisateurs invités</h2>
          <Card className="mt-2 p-4">
            <p className="font-bold text-ink/60 text-sm leading-relaxed">
              Ils voient ces statistiques, les notes, les équipes et leurs contacts — en lecture
              seule. Indique leur adresse : ils créent leur compte avec cette même adresse depuis
              l&apos;écran de connexion. L&apos;ordre n&apos;a pas d&apos;importance.
            </p>

            <form onSubmit={inviter} className="mt-3 flex gap-2 items-end">
              <div className="flex-1 min-w-0">
                <Label>Adresse e-mail</Label>
                <Input
                  type="email"
                  value={nouvelEmail}
                  onChange={(e) => setNouvelEmail(e.target.value)}
                  placeholder="prenom@exemple.fr"
                />
              </div>
              <Button type="submit" disabled={busy || !nouvelEmail.trim()}>
                INVITER
              </Button>
            </form>

            {staff.length > 0 && (
              <ul className="mt-3 space-y-2">
                {staff.map((email) => (
                  <li
                    key={email}
                    className="flex items-center justify-between gap-3 rounded-xl border-2 border-ink/20 bg-white/60 p-2.5"
                  >
                    <span className="font-mono text-sm break-all">{email}</span>
                    <Button
                      size="sm"
                      variant="outline-crimson"
                      onClick={() => retirer(email)}
                      aria-label={`Retirer ${email}`}
                    >
                      🗑️
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      )}

      <div className="h-12" />
    </main>
  );
}
