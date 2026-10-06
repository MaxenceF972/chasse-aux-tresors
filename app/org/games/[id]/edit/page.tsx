"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { frError, rpc, sb } from "@/lib/supabase/client";
import type { Game, Step, StepSecrets, StepType } from "@/lib/types";
import { DEFAULT_CHARTER_LINES } from "@/lib/game/charter";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import StepEditor, { MAX_FINAL_STEPS } from "@/components/org/StepEditor";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label, TextArea } from "@/components/ui/Input";
import Spinner from "@/components/ui/Spinner";
import { showToast } from "@/components/ui/Toaster";
import { useConfirm } from "@/components/ui/Confirm";

const TYPE_ICON: Record<StepType, string> = { nfc: "🏷️", text: "💬", minigame: "🎮", photo: "📸", gps: "📍" };
const TYPE_LABEL: Record<StepType, string> = { nfc: "Balise", text: "Énigme", minigame: "Mini-jeu", photo: "Photo", gps: "Balise GPS" };

type SectionKey = "starts" | "middle" | "finals";

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
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
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

  // Le parcours reste modifiable TANT QUE LA PARTIE N'EST PAS TERMINÉE : une
  // balise arrachée ou une énigme illisible ne doit pas attendre la prochaine
  // partie — et en jeu continu, la partie EST la journée : la verrouiller à
  // l'ouverture revenait à la verrouiller pour de bon. Les équipes déjà
  // parties gardent les lignes de parcours qui leur ont été distribuées ;
  // seule la suppression les touche, et elle passe par org_delete_step.
  const editable = game?.status !== "finished";
  const enCours = game?.status === "running" || game?.status === "paused";
  // Le barème, lui, se fige au lancement : le changer en pleine partie
  // retournerait le classement de toutes les équipes d'un coup.
  const baremeModifiable = game?.status === "lobby";
  // Nombre de BLOCS du pool (un groupe lié = 1 bloc) : c'est ce qui doit être
  // ≥ nombre d'équipes pour l'anti-collision.
  const poolCount = useMemo(() => {
    const keys = new Set<string>();
    steps
      .filter((s) => !s.is_common_checkpoint && !s.is_final && !s.is_start)
      .forEach((s) => keys.add(s.chain_group?.trim() ? `g:${s.chain_group.trim()}` : `s:${s.id}`));
    return keys.size;
  }, [steps]);
  // Le parcours est affiché dans l'ordre où il se JOUE : départ, puis le corps
  // de la chasse (pool mélangé + paliers communs), puis le sprint final. C'est
  // exactement le découpage de start_game — l'ordre d'une section n'a de sens
  // que face aux étapes de la même section.
  const sections = useMemo(
    () => ({
      starts: steps.filter((s) => s.is_start && !s.is_final),
      middle: steps.filter((s) => !s.is_start && !s.is_final),
      finals: steps.filter((s) => s.is_final),
    }),
    [steps]
  );
  const hasFinal = sections.finals.length > 0;

  /** Monte / descend une étape À L'INTÉRIEUR de sa section. */
  async function move(key: SectionKey, index: number, dir: -1 | 1) {
    const list = sections[key];
    const other = index + dir;
    if (other < 0 || other >= list.length) return;
    const swapped = [...list];
    [swapped[index], swapped[other]] = [swapped[other], swapped[index]];

    // La liste complète, dans l'ordre de jeu : c'est elle qui fixe les
    // order_hint (réindexés proprement pour éviter les collisions).
    const ordered = [
      key === "starts" ? swapped : sections.starts,
      key === "middle" ? swapped : sections.middle,
      key === "finals" ? swapped : sections.finals,
    ].flat();
    const changed = ordered
      .map((s, i) => ({ id: s.id, hint: i * 10, was: s.order_hint }))
      .filter((u) => u.hint !== u.was);
    setSteps(ordered.map((s, i) => ({ ...s, order_hint: i * 10 })));

    const results = await Promise.all(
      changed.map((u) => sb().from("steps").update({ order_hint: u.hint }).eq("id", u.id))
    );
    if (results.some((r) => r.error)) {
      showToast("Réordonnancement non enregistré — réessaie.", "error");
    }
    void load();
  }

  async function deleteStep(step: Step) {
    const ok = await confirmDlg({
      title: "Supprimer l'étape ?",
      message: enCours
        ? `« ${step.title} » sera retirée du parcours. Les équipes qui sont dessus en ce moment passeront à l'épreuve suivante.`
        : `« ${step.title} » sera retirée du parcours.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    // Passe par la RPC et non par un delete direct : en pleine partie, la
    // cascade sur team_routes laisserait une équipe sans étape courante,
    // écran figé. org_delete_step fait d'abord avancer celles qui sont dessus.
    try {
      const res = await rpc<{ ok: boolean; teams_affected: number }>("org_delete_step", {
        p_step_id: step.id,
      });
      showToast(
        res.teams_affected > 0
          ? `Étape supprimée — ${res.teams_affected} équipe${res.teams_affected > 1 ? "s ont" : " a"} été envoyée${res.teams_affected > 1 ? "s" : ""} à la suivante`
          : "Étape supprimée",
        "success"
      );
    } catch (err) {
      showToast(`Suppression impossible : ${frError(err, "erreur")}`, "error");
      return;
    }
    void load();
  }

  async function saveSettings(patch: Record<string, unknown>) {
    if (!game) return;
    const settings = { ...game.settings, ...patch };
    setGame({ ...game, settings });
    const { error } = await sb().from("games").update({ settings }).eq("id", gameId);
    if (error) showToast(`Réglage non enregistré : ${frError(error, "erreur")}`, "error");
  }

  // Renommer la partie (autorisé à tout statut — c'est purement cosmétique).
  async function renameGame() {
    if (!game) return;
    const name = nameDraft.trim();
    if (!name) {
      showToast("Le nom de la partie ne peut pas être vide.", "error");
      return;
    }
    setEditingName(false);
    if (name === game.name) return;
    setGame({ ...game, name });
    const { error } = await sb().from("games").update({ name }).eq("id", gameId);
    if (error) showToast(`Renommage impossible : ${frError(error, "erreur")}`, "error");
    else showToast("Nom de la partie mis à jour ✅", "success");
  }

  if (loading || !user || !game) return <Spinner label="Chargement…" />;

  const continu = !!game.settings.continuous;
  const sensFixe = (game.settings.route_mode ?? "disperse") === "fixe";

  return (
    <main className="min-h-dvh px-5 py-6 pt-safe-page max-w-2xl mx-auto pb-24">
      <header className="mb-6">
        <Link href="/org/dashboard" className="contents">
          <Button size="sm" variant="ghost">← MES PARTIES</Button>
        </Link>
        <div className="flex items-center justify-between gap-2 mt-2">
          {editingName ? (
            <div className="flex-1 flex items-center gap-2">
              <Input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void renameGame();
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={80}
                className="text-xl"
                aria-label="Nom de la partie"
              />
              <Button size="sm" variant="leaf" onClick={() => void renameGame()} aria-label="Enregistrer le nom">
                ✅
              </Button>
              <Button size="sm" variant="parchment" onClick={() => setEditingName(false)} aria-label="Annuler">
                ✕
              </Button>
            </div>
          ) : (
            <>
              <h1 className="font-display text-3xl text-parchment leading-tight flex-1 min-w-0 break-words">
                {game.name}
              </h1>
              <Button
                size="sm"
                variant="parchment"
                onClick={() => {
                  setNameDraft(game.name);
                  setEditingName(true);
                }}
                aria-label="Renommer la partie"
              >
                ✏️
              </Button>
            </>
          )}
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
            🏁 La partie est terminée — son classement est écrit, le parcours n&apos;est plus
            modifiable. Pour rejouer, duplique-la depuis le tableau de bord.
          </p>
          <Link href={`/org/games/${gameId}/live`} className="contents">
            <Button size="sm" variant="gold" className="mt-2">
              📊 OUVRIR LE DASHBOARD LIVE
            </Button>
          </Link>
        </Card>
      )}

      {enCours && (
        <Card dark className="p-4 mb-6 border-gold">
          <p className="font-bold">⚡ La partie est en cours — le parcours reste modifiable.</p>
          <p className="font-bold text-parchment/60 text-sm mt-1 leading-relaxed">
            Une balise arrachée ou une énigme illisible n&apos;a pas à attendre. Les équipes déjà
            parties gardent le parcours qui leur a été distribué
            {continu ? " ; tes ajouts valent pour celles qui partiront ensuite" : ""}. Supprimer
            une étape fait passer à la suivante les équipes qui sont dessus.
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

      {/* Déroulement : les choix qui changent la nature de la partie */}
      <Card className="p-4 mb-6">
        <h2 className="font-display text-lg mb-1">⚙️ Déroulement de la partie</h2>
        <p className="font-bold text-ink/55 text-sm mb-3 leading-relaxed">
          Choisis exactement comment se joue ta chasse. Tout est modifiable tant que la partie
          n&apos;est pas terminée.
        </p>

        <Label>Départ des équipes</Label>
        <div className="grid gap-2">
          {(
            [
              {
                v: false,
                title: "👥 Départ groupé",
                help: "Les équipes s'inscrivent au lobby et partent toutes ensemble quand tu lances la partie depuis le dashboard live. Les inscriptions ferment au lancement.",
              },
              {
                v: true,
                title: "🔁 En continu",
                help: "Tu ouvres la partie, puis chacun arrive et part quand il veut — seul ou en équipe — avec son propre chrono. Les inscriptions restent ouvertes. Idéal pour un lieu ouvert au public.",
              },
            ] as const
          ).map((o) => (
            <OptionChoix
              key={o.title}
              actif={continu === o.v}
              titre={o.title}
              aide={o.help}
              disabled={!editable}
              onClick={() => saveSettings({ continuous: o.v })}
            />
          ))}
        </div>
        {enCours && (
          <p className="font-bold text-ink/45 text-xs mt-1.5 leading-relaxed">
            Changé en pleine partie : « en continu » ouvre les inscriptions aux retardataires ;
            « départ groupé » les referme (une équipe déjà inscrite peut encore partir).
          </p>
        )}

        <div className="mt-4">
          <Label>Sens du parcours</Label>
          <div className="grid gap-2">
            {(
              [
                {
                  v: "disperse",
                  title: "🎲 Chaque équipe son ordre",
                  help: "Chaque équipe reçoit les épreuves dans un ordre qui lui est propre, et l'app la réoriente en direct vers celle où il n'y a personne : personne ne se suit.",
                },
                {
                  v: "fixe",
                  title: "➡️ Le même ordre pour toutes",
                  help: "Tout le monde suit l'ordre de l'éditeur, du premier au dernier — quand le lieu impose un sens de circulation. Au prix de quelques embouteillages.",
                },
              ] as const
            ).map((o) => (
              <OptionChoix
                key={o.v}
                actif={(game.settings.route_mode ?? "disperse") === o.v}
                titre={o.title}
                aide={o.help}
                disabled={!editable}
                onClick={() => saveSettings({ route_mode: o.v })}
              />
            ))}
          </div>
          <p className="font-bold text-ink/45 text-xs mt-1.5 leading-relaxed">
            Le départ, les paliers communs et le sprint final gardent leur rang dans les deux
            cas.{enCours ? " Changé en pleine partie, il vaut pour les équipes qui partiront ensuite." : ""}
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <Label>Options</Label>
          <OptionInterrupteur
            actif={!!game.settings.unattended}
            titre="🙈 Sans surveillance"
            aide="Personne ne suit le dashboard pendant la partie : les photos « bloquantes » ne bloquent plus (elles se jugent plus tard), les énigmes bonus se corrigent toutes seules, et l'app ne promet plus l'aide d'un maître du jeu en direct."
            disabled={!editable}
            onClick={() => saveSettings({ unattended: !game.settings.unattended })}
          />
          <OptionInterrupteur
            actif={!!game.settings.ask_rating}
            titre="⭐ Demander une note à la fin"
            aide="Chaque joueur arrivé note l'aventure de 1 à 5 étoiles. Les résultats (moyenne et détail) sont dans les statistiques."
            disabled={!editable}
            onClick={() => saveSettings({ ask_rating: !game.settings.ask_rating })}
          />
          <OptionInterrupteur
            actif={!!game.settings.ask_contact}
            titre="📇 Demander un contact pour prévenir les gagnants"
            aide="Un champ facultatif (e-mail ou téléphone) à la création de l'équipe. Visible de toi seul, dans les statistiques — jamais des autres joueurs."
            disabled={!editable}
            onClick={() => saveSettings({ ask_contact: !game.settings.ask_contact })}
          />
          <OptionInterrupteur
            actif={!!game.settings.auto_close}
            titre="🌙 Fermer la partie chaque soir"
            aide={
              game.settings.auto_close
                ? "La partie se ferme d'elle-même à l'heure choisie, et le classement est figé. Les équipes encore en route restent au classement avec leur progression."
                : "Éteint : la partie tourne jusqu'à ce que tu la termines depuis le dashboard live."
            }
            disabled={!editable}
            onClick={() =>
              saveSettings({
                auto_close: !game.settings.auto_close,
                // Le fuseau de l'organisateur : c'est dans le sien qu'il pense
                // « 19 h ». Le serveur ferme à cette heure-là, dans ce fuseau.
                timezone:
                  game.settings.timezone ??
                  Intl.DateTimeFormat().resolvedOptions().timeZone ??
                  undefined,
              })
            }
          />
          {game.settings.auto_close && (
            <div className="flex items-center gap-2 pl-2">
              <Input
                type="number"
                min={0}
                max={23}
                inputMode="numeric"
                disabled={!editable}
                defaultValue={game.settings.close_hour ?? 19}
                onBlur={(e) => {
                  const h = Math.min(23, Math.max(0, Number(e.target.value) || 0));
                  void saveSettings({ close_hour: h });
                }}
                className="w-24 text-center tabular-nums"
                aria-label="Heure de fermeture"
              />
              <span className="font-bold text-ink/60 text-sm">
                h — fuseau {game.settings.timezone ?? "America/Martinique"}
              </span>
            </div>
          )}
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
              min={0}
              disabled={!editable}
              defaultValue={game.settings.max_teams || ""}
              placeholder="∞"
              onBlur={(e) =>
                saveSettings({
                  max_teams: Number(e.target.value) > 0 ? Number(e.target.value) : null,
                })
              }
            />
          </div>
          <div>
            <Label>Joueurs / équipe max</Label>
            <Input
              type="number"
              min={0}
              disabled={!editable}
              defaultValue={game.settings.max_players_per_team || ""}
              placeholder="∞"
              onBlur={(e) =>
                saveSettings({
                  max_players_per_team:
                    Number(e.target.value) > 0 ? Number(e.target.value) : null,
                })
              }
            />
          </div>
        </div>
        <p className="text-xs font-bold text-ink/50 mt-1">Vide ou 0 : aucun plafond.</p>
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
                disabled={!baremeModifiable}
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
          {!baremeModifiable && (
            <p className="text-xs font-bold text-ink/50 mt-1">
              Figé depuis le lancement : le changer retournerait tout le classement.
            </p>
          )}
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
            <Label>
              Malus « photo refusée » ({(game.settings.scoring ?? "time") === "points" ? "points" : "min"})
            </Label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              disabled={!editable}
              defaultValue={
                (game.settings.scoring ?? "time") === "points"
                  ? game.settings.photo_penalty_points ?? 50
                  : Math.round((game.settings.photo_penalty_sec ?? 180) / 60)
              }
              onBlur={(e) =>
                saveSettings(
                  (game.settings.scoring ?? "time") === "points"
                    ? { photo_penalty_points: Number(e.target.value) || 0 }
                    : { photo_penalty_sec: (Number(e.target.value) || 0) * 60 }
                )
              }
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              S&apos;ajoute à la perte des points de l&apos;étape. Réglable épreuve par épreuve.
            </p>
          </div>
        </div>
      </Card>

      {/* Parcours */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-2xl text-parchment">Parcours</h2>
        <span className="font-bold text-parchment/50 text-sm">
          {steps.length} étape{steps.length > 1 ? "s" : ""} · {poolCount} bloc{poolCount > 1 ? "s" : ""} au pool
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

      {steps.length > 0 && (
        <div className="space-y-6 mb-5">
          {(
            [
              {
                key: "starts",
                title: "🚀 DÉPART",
                help: "La première épreuve, la même pour toutes les équipes.",
              },
              {
                key: "middle",
                title: sensFixe ? "➡️ LE PARCOURS" : "🎲 LE PARCOURS",
                help: sensFixe
                  ? `Le cœur de la chasse : ${poolCount} bloc${poolCount > 1 ? "s" : ""} joué${poolCount > 1 ? "s" : ""} dans CET ordre par toutes les équipes, paliers communs compris.`
                  : `Le cœur de la chasse : ${poolCount} bloc${poolCount > 1 ? "s" : ""} distribué${poolCount > 1 ? "s" : ""} dans un ordre différent à chaque équipe, et les paliers communs à leur position fixe.`,
              },
              {
                key: "finals",
                title: "🏁 SPRINT FINAL",
                help: `Jusqu'à ${MAX_FINAL_STEPS} épreuves jouées à la suite, dans CET ordre, par toutes les équipes — débloquées seulement quand tout le reste est validé.`,
              },
            ] as { key: SectionKey; title: string; help: string }[]
          ).map((sec) => {
            const list = sections[sec.key];
            // Une section vide ne s'affiche que pour le sprint final : c'est là
            // qu'on veut voir qu'il n'y a rien, et comment le remplir.
            if (list.length === 0 && sec.key !== "finals") return null;
            return (
              <section key={sec.key}>
                <h3 className="font-display text-parchment text-lg">{sec.title}</h3>
                <p className="font-bold text-parchment/45 text-xs mb-2 leading-snug">{sec.help}</p>

                {list.length === 0 ? (
                  <Card className="p-3">
                    <p className="font-bold text-ink/55 text-sm">
                      Aucune épreuve — ouvre une étape et choisis « 🏁 Sprint final » pour un finish
                      commun (le trésor, une dernière énigme, une photo de groupe…).
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {list.map((step, i) => (
                      <Card key={step.id} className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex flex-col gap-1.5">
                            <button
                              disabled={!editable || i === 0}
                              onClick={() => move(sec.key, i, -1)}
                              className="w-10 h-10 rounded-lg border-2 border-ink bg-white font-bold text-lg disabled:opacity-30 active:bg-parchment-dark"
                              aria-label="Monter"
                            >
                              ↑
                            </button>
                            <button
                              disabled={!editable || i === list.length - 1}
                              onClick={() => move(sec.key, i, 1)}
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
                                  🏁 Sprint {i + 1}
                                  {list.length > 1 ? `/${list.length}` : ""}
                                </span>
                              ) : step.is_start ? (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gold border-2 border-ink">
                                  🚀 Départ
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
                              {step.chain_group && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-gold border-2 border-ink">
                                  🔗 Groupe {step.chain_group}
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
                                  showToast(
                                    "Chargement des réponses en cours — réessaie dans une seconde.",
                                    "info"
                                  );
                                  return;
                                }
                                setEditing({ step, type: step.type });
                              }}
                            >
                              ✏️
                            </Button>
                            <Button
                              size="sm"
                              variant="crimson"
                              disabled={!editable}
                              onClick={() => deleteStep(step)}
                            >
                              🗑️
                            </Button>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

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
        <Link href={`/org/games/${gameId}/stats`} className="contents">
          <Button variant="parchment">📊 Statistiques</Button>
        </Link>
        <Link href={`/org/games/${gameId}/live`} className="contents">
          <Button variant="leaf">
            📡 Dashboard live{" "}
            {game.status === "lobby" ? (continu ? "& ouverture" : "& lancement") : ""}
          </Button>
        </Link>
      </div>

      {!hasFinal && steps.length > 1 && (
        <p className="mt-4 text-sm font-bold text-gold/80">
          💡 Conseil : marque 1 à {MAX_FINAL_STEPS} étapes comme « 🏁 Sprint final » pour un finish
          commun — toutes les équipes les enchaînent dans le même ordre, une fois le reste bouclé.
        </p>
      )}

      {editing && (
        <StepEditor
          gameId={gameId}
          step={editing.step}
          secrets={editing.step ? (secretsMap[editing.step.id] ?? null) : null}
          initialType={editing.type}
          nextOrderHint={(steps.length ? Math.max(...steps.map((s) => s.order_hint)) : 0) + 10}
          otherFinals={steps.filter((s) => s.is_final && s.id !== editing.step?.id).length}
          hasOtherStart={steps.some((s) => s.is_start && s.id !== editing.step?.id)}
          scoring={game.settings.scoring === "points" ? "points" : "time"}
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

/** Une option parmi plusieurs (carte cliquable, l'active est dorée). */
function OptionChoix({
  actif,
  titre,
  aide,
  disabled,
  onClick,
}: {
  actif: boolean;
  titre: string;
  aide: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={actif}
      className={`w-full text-left p-3 rounded-xl border-[3px] transition-colors disabled:opacity-60 ${
        actif ? "border-ink bg-gold/30" : "border-ink/25 bg-white/60"
      }`}
    >
      <span className="font-display text-sm">
        {actif ? "✅ " : ""}
        {titre}
      </span>
      <span className="block text-xs font-bold text-ink/60 mt-0.5 leading-relaxed">{aide}</span>
    </button>
  );
}

/** Une option qu'on allume ou qu'on éteint. */
function OptionInterrupteur({
  actif,
  titre,
  aide,
  disabled,
  onClick,
}: {
  actif: boolean;
  titre: string;
  aide: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left p-3 rounded-xl border-[3px] transition-colors disabled:opacity-60 flex gap-3 items-start ${
        actif ? "border-ink bg-leaf/15" : "border-ink/25 bg-white/60"
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 shrink-0 w-10 h-6 rounded-full border-[3px] border-ink relative transition-colors ${
          actif ? "bg-leaf" : "bg-parchment-dark"
        }`}
      >
        <span
          className={`absolute top-0 w-[18px] h-[18px] rounded-full bg-white border-2 border-ink transition-[left] ${
            actif ? "left-[16px]" : "left-0"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="font-display text-sm">{titre}</span>
        <span className="block text-xs font-bold text-ink/60 mt-0.5 leading-relaxed">{aide}</span>
      </span>
    </button>
  );
}
