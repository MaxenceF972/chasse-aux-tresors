"use client";

import { useState } from "react";
import { frError, sb } from "@/lib/supabase/client";
import type { Hint, MinigameKind, Step, StepSecrets, StepType } from "@/lib/types";
import { newTagId, randomCode, tagUrl } from "@/lib/game/codes";
import { HOTCOLD_DEFAULT_THRESHOLDS, HOTCOLD_TIERS, normalizeThresholds } from "@/lib/game/hotcold";
import { MINIGAMES, MINIGAME_LIST } from "@/components/minigames/registry";
import MediaUpload from "./MediaUpload";
import MapPicker from "./MapPicker";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label, TextArea } from "@/components/ui/Input";

type Placement = "start" | "pool" | "common" | "final";

/**
 * Détecte un couple « lat, lng » collé d'un bloc (format Google Maps :
 * « 14.616065, -61.058779 ») pour remplir les deux champs d'un coup.
 * Un nombre seul à virgule française (« 14,616065 ») n'est PAS un couple.
 */
function splitCoords(raw: string): { lat: string; lng: string } | null {
  if (!raw.includes(".")) return null;
  const m = raw.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  return m ? { lat: m[1], lng: m[2] } : null;
}

function parseCoord(raw: string): number {
  return Number(raw.trim().replace(",", "."));
}

interface StepEditorProps {
  gameId: string;
  /** null → création */
  step: Step | null;
  secrets: StepSecrets | null;
  initialType: StepType;
  nextOrderHint: number;
  hasOtherFinal: boolean;
  hasOtherStart: boolean;
  /** Mode de score de la partie : décide si la pénalité de skip est en min ou en points */
  scoring: "time" | "points";
  onSaved: () => void;
  onClose: () => void;
}

const TYPE_META: Record<StepType, { icon: string; label: string; help: string }> = {
  nfc: {
    icon: "🏷️",
    label: "Balise sur le terrain",
    help: "Les joueurs trouvent le lieu et scannent la puce NFC — ou le QR code / code imprimé en secours.",
  },
  text: {
    icon: "💬",
    label: "Énigme à réponse",
    help: "Les joueurs résolvent l'énigme et saisissent la réponse sur leur téléphone.",
  },
  minigame: {
    icon: "🎮",
    label: "Mini-jeu",
    help: "Un casse-tête de la banque de mini-jeux, joué directement dans l'app.",
  },
  photo: {
    icon: "📸",
    label: "Épreuve photo",
    help: "L'équipe envoie une photo depuis le terrain (ex : « toute l'équipe devant la statue ! ») — tu la valides en un clic depuis le dashboard live.",
  },
  gps: {
    icon: "📍",
    label: "Balise GPS",
    help: "Aucune puce à poser : l'équipe doit se rendre au bon endroit et appuyer sur « On est sur place ! » — le serveur vérifie la position. Idéal pour un point de vue, une clairière…",
  },
};

export default function StepEditor({
  gameId,
  step,
  secrets,
  initialType,
  nextOrderHint,
  hasOtherFinal,
  hasOtherStart,
  scoring,
  onSaved,
  onClose,
}: StepEditorProps) {
  const type: StepType = step?.type ?? initialType;

  const [title, setTitle] = useState(step?.title ?? "");
  const [body, setBody] = useState(step?.content?.body ?? "");
  const [mediaUrls, setMediaUrls] = useState<string[]>(step?.media_urls ?? []);
  const [placement, setPlacement] = useState<Placement>(
    step?.is_final ? "final" : step?.is_start ? "start" : step?.is_common_checkpoint ? "common" : "pool"
  );
  const [answersText, setAnswersText] = useState((secrets?.answers ?? []).join("\n"));
  // Ne générer un identifiant/code qu'à la CRÉATION : pour une étape
  // existante sans secrets chargés, régénérer invaliderait les puces écrites.
  const [nfcTagId, setNfcTagId] = useState(secrets?.nfc_tag_id ?? (step ? "" : newTagId()));
  const [manualCode, setManualCode] = useState(secrets?.manual_code ?? (step ? "" : randomCode(6)));
  // Un jeu retiré de la banque (ex : morse) peut encore exister sur une vieille
  // étape : on retombe sur "caesar" au lieu de planter.
  const storedKind = step?.content?.minigame?.kind;
  const safeKind: MinigameKind = storedKind && MINIGAMES[storedKind] ? storedKind : "caesar";
  const [minigameKind, setMinigameKind] = useState<MinigameKind>(safeKind);
  const [minigameConfig, setMinigameConfig] = useState<Record<string, unknown>>(
    (storedKind && MINIGAMES[storedKind] ? step?.content?.minigame?.config : undefined) ??
      MINIGAMES[safeKind].defaultConfig
  );
  const [hints, setHints] = useState<Hint[]>(secrets?.hints ?? []);
  const [gpsLat, setGpsLat] = useState<string>(secrets?.gps_lat != null ? String(secrets.gps_lat) : "");
  const [gpsLng, setGpsLng] = useState<string>(secrets?.gps_lng != null ? String(secrets.gps_lng) : "");
  const [gpsRadius, setGpsRadius] = useState<string>(String(secrets?.gps_radius_m ?? 2));
  const [gpsGuidance, setGpsGuidance] = useState<"compass" | "hotcold" | "none">(
    step?.content?.gps_guidance ?? "compass"
  );
  // 6 seuils chaud/froid (FROID→BRÛLANT), édités palier par palier
  const [gpsThresholds, setGpsThresholds] = useState<string[]>(() =>
    normalizeThresholds(step?.content?.gps_hotcold_thresholds, step?.content?.gps_hotcold_range).map(String)
  );
  const [chainGroup, setChainGroup] = useState<string>(step?.chain_group ?? "");
  const [gpsLocating, setGpsLocating] = useState(false);
  // Point de rendez-vous public (optionnel, affiché aux joueurs)
  const [rdvLat, setRdvLat] = useState<string>(
    step?.content?.rdv?.lat != null ? String(step.content.rdv.lat) : ""
  );
  const [rdvLng, setRdvLng] = useState<string>(
    step?.content?.rdv?.lng != null ? String(step.content.rdv.lng) : ""
  );
  const [rdvLocating, setRdvLocating] = useState(false);
  const [gpsMapOpen, setGpsMapOpen] = useState(false);
  const [rdvMapOpen, setRdvMapOpen] = useState(false);
  const [photoMode, setPhotoMode] = useState<"bonus" | "gate">(
    step?.content?.photo_mode ?? "bonus"
  );
  const [points, setPoints] = useState<number>(step?.points ?? 100);
  const [timeLimitMin, setTimeLimitMin] = useState<string>(
    step?.time_limit_sec ? String(Math.round(step.time_limit_sec / 60)) : ""
  );
  // Pénalité de skip par étape : minutes (chrono) ou points (points), vide = défaut global
  const [skipPenalty, setSkipPenalty] = useState<string>(() => {
    const c = step?.content;
    if (scoring === "points") return c?.skip_penalty_points != null ? String(c.skip_penalty_points) : "";
    return c?.skip_penalty_sec != null ? String(Math.round(c.skip_penalty_sec / 60)) : "";
  });
  // Rattrapable après un skip (défaut : oui pour les mini-jeux)
  const [redeemable, setRedeemable] = useState<boolean>(
    step?.content?.redeemable ?? (step?.type ?? initialType) === "minigame"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const minigameDef = MINIGAMES[minigameKind];
  const showAnswers = type === "text" || (type === "minigame" && minigameDef.needsAnswer);

  async function save() {
    setError(null);
    if (!title.trim()) {
      setError("Donne un titre à l'étape.");
      return;
    }
    if (placement === "final" && hasOtherFinal) {
      setError("Il y a déjà un sprint final — retire d'abord l'autre étape finale.");
      return;
    }
    if (placement === "start" && hasOtherStart) {
      setError("Il y a déjà une épreuve de départ — retire d'abord l'autre.");
      return;
    }
    const answers = answersText.split("\n").map((a) => a.trim()).filter(Boolean);
    if (showAnswers && answers.length === 0) {
      setError("Ajoute au moins une réponse acceptée.");
      return;
    }
    if (type === "minigame" && minigameKind === "anagrams") {
      const words = (minigameConfig.words as string[]) || [];
      if (!words.length) {
        setError("Ajoute au moins un mot dans la config des anagrammes.");
        return;
      }
    }
    if (type === "nfc" && !nfcTagId.trim()) {
      setError("Identifiant de balise manquant — ferme, recharge la page et rouvre l'étape.");
      return;
    }
    if (type === "gps") {
      const lat = parseCoord(gpsLat);
      const lng = parseCoord(gpsLng);
      if (!gpsLat.trim() || !gpsLng.trim() || Number.isNaN(lat) || Number.isNaN(lng)
          || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        setError("Renseigne des coordonnées GPS valides (latitude et longitude).");
        return;
      }
      if (gpsGuidance === "hotcold") {
        const th = gpsThresholds.map(Number);
        if (th.some((n) => !Number.isFinite(n) || n < 1)) {
          setError("Chaud/froid : chaque palier doit être un nombre de mètres (≥ 1).");
          return;
        }
        for (let i = 1; i < th.length; i++) {
          if (th[i] >= th[i - 1]) {
            setError("Chaud/froid : les paliers doivent décroître de FROID (le plus loin) à BRÛLANT (le plus près).");
            return;
          }
        }
      }
    }
    const hasRdv = rdvLat.trim() !== "" || rdvLng.trim() !== "";
    if (type !== "gps" && hasRdv) {
      const lat = parseCoord(rdvLat);
      const lng = parseCoord(rdvLng);
      if (!rdvLat.trim() || !rdvLng.trim() || Number.isNaN(lat) || Number.isNaN(lng)
          || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        setError("Point de rendez-vous : coordonnées invalides (remplis latitude ET longitude, ou laisse les deux vides).");
        return;
      }
    }

    setBusy(true);
    try {
      const row = {
        game_id: gameId,
        type,
        title: title.trim(),
        content: {
          body: body.trim() || undefined,
          minigame: type === "minigame" ? { kind: minigameKind, config: minigameConfig } : undefined,
          rdv:
            type !== "gps" && rdvLat.trim() && rdvLng.trim()
              ? { lat: parseCoord(rdvLat), lng: parseCoord(rdvLng) }
              : undefined,
          photo_mode: type === "photo" ? photoMode : undefined,
          gps_guidance: type === "gps" ? gpsGuidance : undefined,
          gps_hotcold_thresholds:
            type === "gps" && gpsGuidance === "hotcold" ? gpsThresholds.map(Number) : undefined,
          // Conserve la clé de l'AUTRE mode (au cas où la partie change de score)
          skip_penalty_sec:
            scoring === "points"
              ? step?.content?.skip_penalty_sec
              : skipPenalty.trim()
                ? Math.max(1, Number(skipPenalty)) * 60
                : undefined,
          skip_penalty_points:
            scoring === "points"
              ? skipPenalty.trim()
                ? Math.max(0, Number(skipPenalty))
                : undefined
              : step?.content?.skip_penalty_points,
          redeemable,
        },
        media_urls: mediaUrls,
        is_common_checkpoint: placement === "common",
        is_final: placement === "final",
        is_start: placement === "start",
        points: Math.max(0, points || 0),
        time_limit_sec: timeLimitMin.trim() ? Math.max(1, Number(timeLimitMin)) * 60 : null,
        // Groupe d'enchaînement : uniquement pour le pool
        chain_group: placement === "pool" && chainGroup ? chainGroup : null,
      };

      let stepId = step?.id;
      if (stepId) {
        const { error } = await sb().from("steps").update(row).eq("id", stepId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await sb()
          .from("steps")
          .insert({ ...row, order_hint: nextOrderHint })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        stepId = (data as { id: string }).id;
      }

      const { error: secErr } = await sb().from("step_secrets").upsert({
        step_id: stepId,
        answers,
        nfc_tag_id: type === "nfc" ? nfcTagId : null,
        manual_code: type === "nfc" ? manualCode : null,
        hints,
        gps_lat: type === "gps" ? parseCoord(gpsLat) : null,
        gps_lng: type === "gps" ? parseCoord(gpsLng) : null,
        gps_radius_m: type === "gps" ? Math.max(1, Number(gpsRadius) || 2) : null,
      });
      if (secErr) throw new Error(secErr.message);

      onSaved();
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      if (/invalid input value for enum|does not exist|schema cache/i.test(raw)) {
        setError(
          `⚠️ La base Supabase ne connaît pas encore un champ requis par cette version de l'app. Recolle TOUT le contenu de supabase/setup.sql (version du jour) dans le SQL Editor, exécute-le, attends 10 secondes, puis réessaie. Détail technique : ${raw}`
        );
      } else {
        setError(frError(err, "Enregistrement impossible — réessaie"));
      }
      setBusy(false);
    }
  }

  function updateHint(i: number, patch: Partial<Hint>) {
    setHints((h) => h.map((hint, j) => (j === i ? { ...hint, ...patch } : hint)));
  }

  const meta = TYPE_META[type];

  return (
    <Dialog open onClose={onClose} title={`${meta.icon} ${step ? "Modifier" : "Nouvelle"} — ${meta.label}`}>
      <div className="space-y-5 pb-2">
        <p className="font-bold text-ink/60 text-sm -mt-2">{meta.help}</p>

        <div>
          <Label>Titre de l&apos;étape</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="La fontaine aux secrets"
          />
        </div>

        <div>
          <Label>Énoncé / contexte (optionnel, **gras** et *italique* supportés)</Label>
          <TextArea
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Sous le regard de pierre du lion,\nle prochain indice attend les braves…"}
          />
        </div>

        <MediaUpload gameId={gameId} urls={mediaUrls} onChange={setMediaUrls} />

        {/* Type-spécifique */}
        {type === "nfc" && (
          <div className="space-y-3 rounded-xl border-[3px] border-ink/20 p-3">
            {/* LE lien à mettre sur la puce NFC (et encodé dans le QR) */}
            <div className="rounded-xl border-[3px] border-gold bg-gold/15 p-3">
              <Label>🔗 Lien à écrire sur la puce NFC</Label>
              <p className="font-mono text-sm break-all text-ink/80 mb-2">{tagUrl(nfcTagId)}</p>
              <Button
                size="sm"
                variant="gold"
                onClick={async () => {
                  await navigator.clipboard.writeText(tagUrl(nfcTagId));
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 1800);
                }}
              >
                {linkCopied ? "✅ Copié !" : "📋 COPIER LE LIEN"}
              </Button>
              <p className="text-xs font-bold text-ink/55 mt-2">
                Colle-le comme enregistrement « URL » sur la puce (app NFC Tools, ou écriture
                directe depuis l&apos;onglet Balises sur Chrome Android). Le joueur qui scanne
                valide l&apos;étape et passe à la suivante.
              </p>
            </div>
            <div>
              <Label>Identifiant de balise</Label>
              <div className="flex gap-2">
                <Input value={nfcTagId} onChange={(e) => setNfcTagId(e.target.value)} className="font-mono" />
                <Button variant="parchment" onClick={() => setNfcTagId(newTagId())} title="Régénérer (la puce déjà écrite ne sera plus valide !)">
                  🎲
                </Button>
              </div>
            </div>
            <div>
              <Label>Code manuel de secours (imprimé sur la balise)</Label>
              <div className="flex gap-2">
                <Input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                  className="font-mono tracking-[0.25em]"
                />
                <Button variant="parchment" onClick={() => setManualCode(randomCode(6))} title="Régénérer">
                  🎲
                </Button>
              </div>
            </div>
            <p className="text-sm font-bold text-ink/50">
              L&apos;onglet « Balises » de la partie permet d&apos;écrire les puces NFC et
              d&apos;imprimer les QR codes.
            </p>
          </div>
        )}

        {type === "photo" && (
          <div className="space-y-3 rounded-xl border-[3px] border-ink/20 p-3">
            <p className="font-bold text-sm text-ink/70">
              📸 Décris dans l&apos;énoncé la photo attendue (« Toute l&apos;équipe qui saute devant
              la fontaine ! »). Les photos arrivent dans le dashboard live : Valider / Refuser.
            </p>
            <Label>Type d&apos;épreuve photo</Label>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setPhotoMode("bonus")}
                className={`w-full text-left p-3 rounded-xl border-[3px] border-ink ${
                  photoMode === "bonus" ? "bg-gold" : "bg-white"
                }`}
              >
                <span className="font-display">🎁 Photo bonus</span>
                <span className="block text-xs font-bold text-ink/60">
                  L&apos;équipe envoie la photo et continue tout de suite. Tu la juges quand tu
                  veux : refusée = 0 point sur l&apos;étape (ou pénalité en mode chrono).
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPhotoMode("gate")}
                className={`w-full text-left p-3 rounded-xl border-[3px] border-ink ${
                  photoMode === "gate" ? "bg-gold" : "bg-white"
                }`}
              >
                <span className="font-display">🚧 Photo bloquante</span>
                <span className="block text-xs font-bold text-ink/60">
                  L&apos;équipe reste sur l&apos;étape jusqu&apos;à ce que TU valides sa photo
                  (depuis le dashboard live). Refusée = elle doit en reprendre une. Sois
                  réactif pendant la partie !
                </span>
              </button>
            </div>
          </div>
        )}

        {type === "gps" && (
          <div className="space-y-3 rounded-xl border-[3px] border-ink/20 p-3">
            <Button
              full
              variant="gold"
              disabled={gpsLocating}
              onClick={() => {
                if (!navigator.geolocation) {
                  setError("Pas de GPS sur cet appareil — saisis les coordonnées à la main.");
                  return;
                }
                setGpsLocating(true);
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setGpsLat(pos.coords.latitude.toFixed(6));
                    setGpsLng(pos.coords.longitude.toFixed(6));
                    setGpsLocating(false);
                    // Ouvre la carte : on VOIT où le point vient d'être posé
                    setGpsMapOpen(true);
                  },
                  () => {
                    setError(
                      "Position introuvable — autorise la localisation ou saisis les coordonnées à la main."
                    );
                    setGpsLocating(false);
                  },
                  { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                );
              }}
            >
              {gpsLocating ? "🛰️ POSITION EN COURS…" : "📍 UTILISER MA POSITION ACTUELLE"}
            </Button>
            <Button full variant="parchment" onClick={() => setGpsMapOpen((o) => !o)}>
              {gpsMapOpen ? "🗺️ FERMER LA CARTE" : "🗺️ CHOISIR SUR LA CARTE"}
            </Button>
            {gpsMapOpen && (
              <MapPicker
                lat={gpsLat.trim() && !Number.isNaN(parseCoord(gpsLat)) ? parseCoord(gpsLat) : null}
                lng={gpsLng.trim() && !Number.isNaN(parseCoord(gpsLng)) ? parseCoord(gpsLng) : null}
                onPick={(la, ln) => {
                  setGpsLat(String(la));
                  setGpsLng(String(ln));
                }}
              />
            )}
            <p className="text-xs font-bold text-ink/55 -mt-1">
              Sur place : « utiliser ma position ». À distance : « choisir sur la carte »
              (recherche + un clic), ou colle « 14.616065, -61.058779 » copié de Google Maps
              dans le champ Latitude : les deux champs se remplissent.
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label>Latitude</Label>
                <Input
                  value={gpsLat}
                  onChange={(e) => {
                    const pair = splitCoords(e.target.value);
                    if (pair) {
                      setGpsLat(pair.lat);
                      setGpsLng(pair.lng);
                    } else setGpsLat(e.target.value);
                  }}
                  placeholder="14.616065"
                  className="font-mono"
                />
              </div>
              <div className="flex-1">
                <Label>Longitude</Label>
                <Input
                  value={gpsLng}
                  onChange={(e) => {
                    const pair = splitCoords(e.target.value);
                    if (pair) {
                      setGpsLat(pair.lat);
                      setGpsLng(pair.lng);
                    } else setGpsLng(e.target.value);
                  }}
                  placeholder="-61.058779"
                  className="font-mono"
                />
              </div>
            </div>
            <div>
              <Label>Rayon de validation (mètres)</Label>
              <Input
                value={gpsRadius}
                onChange={(e) => setGpsRadius(e.target.value.replace(/\D/g, ""))}
                inputMode="numeric"
                className="w-28"
              />
              <p className="text-xs font-bold text-ink/55 mt-1">
                Réglé à 2 m par défaut (très serré). Le GPS d&apos;un téléphone est précis à 5-20 m
                dehors : si des équipes n&apos;arrivent pas à valider alors qu&apos;elles sont sur
                place, monte à 10-30 m.
              </p>
            </div>
            <div>
              <Label>Guidage des joueurs</Label>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setGpsGuidance("compass")}
                  className={`w-full text-left p-3 rounded-xl border-[3px] border-ink ${
                    gpsGuidance === "compass" ? "bg-gold" : "bg-white"
                  }`}
                >
                  <span className="font-display">🧭 Boussole + distance</span>
                  <span className="block text-xs font-bold text-ink/60">
                    Une flèche pointe vers le point et la distance s&apos;affiche en direct — comme
                    une chasse au trésor géante. Validation automatique à l&apos;arrivée.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setGpsGuidance("hotcold")}
                  className={`w-full text-left p-3 rounded-xl border-[3px] border-ink ${
                    gpsGuidance === "hotcold" ? "bg-gold" : "bg-white"
                  }`}
                >
                  <span className="font-display">🔥 Chaud / froid</span>
                  <span className="block text-xs font-bold text-ink/60">
                    Pas de flèche : un thermomètre chauffe (glacial → brûlant) avec la distance en
                    direct à mesure que l&apos;équipe approche. Plus mystérieux, plus de recherche.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setGpsGuidance("none")}
                  className={`w-full text-left p-3 rounded-xl border-[3px] border-ink ${
                    gpsGuidance === "none" ? "bg-gold" : "bg-white"
                  }`}
                >
                  <span className="font-display">🤫 Aucun indice (lieu secret)</span>
                  <span className="block text-xs font-bold text-ink/60">
                    Ni flèche ni thermomètre : c&apos;est ton énoncé qui mène au lieu (« rendez-vous
                    au vieux lavoir… »). Sur place, la validation se fait toute seule — même la
                    distance reste cachée.
                  </span>
                </button>
              </div>

              {gpsGuidance === "hotcold" && (
                <div className="mt-3 rounded-xl border-[3px] border-ink/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label className="!mb-0">Paliers du thermomètre (mètres)</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 !min-h-8 !py-0.5 !px-2.5 !text-xs"
                      onClick={() => setGpsThresholds(HOTCOLD_DEFAULT_THRESHOLDS.map(String))}
                    >
                      🔄 RÉINITIALISER
                    </Button>
                  </div>
                  <p className="text-xs font-bold text-ink/55">
                    Distance max de chaque palier, du plus loin (froid) au plus près (brûlant). Les
                    valeurs doivent décroître ; garde le plus grand supérieur au rayon de validation.
                  </p>
                  <div className="space-y-1.5">
                    {HOTCOLD_TIERS.slice(1).map((t, i) => (
                      <div key={t.label} className="flex items-center gap-2">
                        <span className="flex-1 font-bold text-sm">
                          {t.emoji} {t.label}
                        </span>
                        <span className="font-bold text-ink/45 text-sm">≤</span>
                        <Input
                          value={gpsThresholds[i] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value.replace(/\D/g, "");
                            setGpsThresholds((prev) => prev.map((x, j) => (j === i ? v : x)));
                          }}
                          inputMode="numeric"
                          className="w-20 text-center"
                        />
                        <span className="font-bold text-ink/45 text-sm w-4">m</span>
                      </div>
                    ))}
                    <div className="flex items-center gap-2 pt-1 text-ink/55">
                      <span className="flex-1 font-bold text-sm">
                        {HOTCOLD_TIERS[0].emoji} {HOTCOLD_TIERS[0].label}
                      </span>
                      <span className="font-bold text-sm">au-delà de {gpsThresholds[0] || "—"} m</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {type === "minigame" && (
          <div className="space-y-3 rounded-xl border-[3px] border-ink/20 p-3">
            <div>
              <Label>Mini-jeu</Label>
              <div className="grid grid-cols-2 gap-2">
                {MINIGAME_LIST.map((def) => (
                  <button
                    key={def.kind}
                    type="button"
                    onClick={() => {
                      setMinigameKind(def.kind);
                      setMinigameConfig(
                        step?.content?.minigame?.kind === def.kind
                          ? step.content.minigame.config
                          : def.defaultConfig
                      );
                    }}
                    className={`p-2.5 rounded-xl border-[3px] border-ink text-left transition-colors ${
                      minigameKind === def.kind ? "bg-gold" : "bg-white"
                    }`}
                  >
                    <div className="font-display">
                      {def.icon} {def.name}
                    </div>
                    <div className="text-xs font-bold text-ink/60 leading-tight">
                      {def.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <minigameDef.ConfigEditor
              value={minigameConfig}
              onChange={setMinigameConfig}
              gameId={gameId}
            />
          </div>
        )}

        {type !== "gps" && (
          <div className="space-y-3 rounded-xl border-[3px] border-ink/20 p-3">
            <Label>📍 Point de rendez-vous GPS (optionnel)</Label>
            <p className="text-xs font-bold text-ink/55 -mt-1">
              Affiché aux joueurs avec un bouton « Itinéraire » : « Rendez-vous à ce point et
              cherchez-y ! ». La validation reste {type === "nfc" ? "la balise" : type === "photo" ? "la photo" : "l'épreuve"} —
              le point GPS sert juste à les amener au bon endroit.
            </p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label>Latitude</Label>
                <Input
                  value={rdvLat}
                  onChange={(e) => {
                    const pair = splitCoords(e.target.value);
                    if (pair) {
                      setRdvLat(pair.lat);
                      setRdvLng(pair.lng);
                    } else setRdvLat(e.target.value);
                  }}
                  placeholder="14.616065"
                  className="font-mono"
                />
              </div>
              <div className="flex-1">
                <Label>Longitude</Label>
                <Input
                  value={rdvLng}
                  onChange={(e) => {
                    const pair = splitCoords(e.target.value);
                    if (pair) {
                      setRdvLat(pair.lat);
                      setRdvLng(pair.lng);
                    } else setRdvLng(e.target.value);
                  }}
                  placeholder="-61.058779"
                  className="font-mono"
                />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="parchment"
                disabled={rdvLocating}
                onClick={() => {
                  if (!navigator.geolocation) return;
                  setRdvLocating(true);
                  navigator.geolocation.getCurrentPosition(
                    (pos) => {
                      setRdvLat(pos.coords.latitude.toFixed(6));
                      setRdvLng(pos.coords.longitude.toFixed(6));
                      setRdvLocating(false);
                      // Ouvre la carte : on VOIT où le point vient d'être posé
                      setRdvMapOpen(true);
                    },
                    () => setRdvLocating(false),
                    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
                  );
                }}
              >
                {rdvLocating ? "🛰️…" : "📍 Ma position"}
              </Button>
              <Button size="sm" variant="parchment" onClick={() => setRdvMapOpen((o) => !o)}>
                {rdvMapOpen ? "🗺️ Fermer la carte" : "🗺️ Choisir sur la carte"}
              </Button>
              {(rdvLat.trim() || rdvLng.trim()) && (
                <Button
                  size="sm"
                  variant="parchment"
                  onClick={() => {
                    setRdvLat("");
                    setRdvLng("");
                  }}
                >
                  ✕ Effacer
                </Button>
              )}
            </div>
            {rdvMapOpen && (
              <MapPicker
                lat={rdvLat.trim() && !Number.isNaN(parseCoord(rdvLat)) ? parseCoord(rdvLat) : null}
                lng={rdvLng.trim() && !Number.isNaN(parseCoord(rdvLng)) ? parseCoord(rdvLng) : null}
                onPick={(la, ln) => {
                  setRdvLat(String(la));
                  setRdvLng(String(ln));
                }}
              />
            )}
            <p className="text-xs font-bold text-ink/50">
              Astuce : colle « lat, lng » copié depuis Google Maps directement dans le champ
              Latitude, les deux se remplissent.
            </p>
          </div>
        )}

        {showAnswers && (
          <div>
            <Label>
              {type === "minigame" && minigameDef.answerLabel
                ? minigameDef.answerLabel
                : "Réponses acceptées (une par ligne)"}
            </Label>
            <TextArea
              rows={3}
              value={answersText}
              onChange={(e) => setAnswersText(e.target.value)}
              placeholder={"la fontaine\nfontaine"}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">
              Insensible à la casse, aux accents et à la ponctuation.
            </p>
          </div>
        )}

        {/* Indices */}
        <div>
          <Label>Indices progressifs</Label>
          <div className="space-y-3">
            {hints.map((hint, i) => (
              <div key={i} className="rounded-xl border-[3px] border-ink/20 p-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={hint.text}
                    onChange={(e) => updateHint(i, { text: e.target.value })}
                    placeholder={`Indice ${i + 1}…`}
                  />
                  <Button
                    variant="crimson"
                    size="md"
                    onClick={() => setHints((h) => h.filter((_, j) => j !== i))}
                    aria-label="Supprimer l'indice"
                  >
                    🗑️
                  </Button>
                </div>
                <div className="flex gap-3 items-center flex-wrap text-sm font-bold text-ink/70">
                  <label className="flex items-center gap-1.5">
                    Pénalité
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="w-20 h-11 rounded-lg border-2 border-ink px-2 bg-white text-base"
                      value={hint.penalty_sec != null ? Math.round(hint.penalty_sec / 60) : ""}
                      placeholder="2"
                      onChange={(e) =>
                        updateHint(i, {
                          penalty_sec: e.target.value === "" ? null : Number(e.target.value) * 60,
                        })
                      }
                    />
                    min
                  </label>
                  <label className="flex items-center gap-1.5">
                    Gratuit après
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      className="w-20 h-11 rounded-lg border-2 border-ink px-2 bg-white text-base"
                      value={hint.unlock_after_sec != null ? Math.round(hint.unlock_after_sec / 60) : ""}
                      placeholder="—"
                      onChange={(e) =>
                        updateHint(i, {
                          unlock_after_sec: e.target.value === "" ? null : Number(e.target.value) * 60,
                        })
                      }
                    />
                    min
                  </label>
                </div>
              </div>
            ))}
            <Button
              variant="parchment"
              size="sm"
              onClick={() => setHints((h) => [...h, { text: "", penalty_sec: 120, unlock_after_sec: null }])}
            >
              💡 Ajouter un indice
            </Button>
          </div>
        </div>

        {/* Points & timer */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Points (mode points)</Label>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={points}
              onChange={(e) => setPoints(Number(e.target.value))}
            />
            <p className="text-xs font-bold text-ink/50 mt-1">Gagnés en validant l&apos;étape.</p>
          </div>
          <div>
            <Label>Temps limite (min)</Label>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={timeLimitMin}
              onChange={(e) => setTimeLimitMin(e.target.value)}
              placeholder="∞"
            />
            <p className="text-xs font-bold text-ink/50 mt-1">Vide = illimité. Écoulé = 0 point.</p>
          </div>
        </div>

        {/* Pénalité si l'équipe passe cette étape */}
        <div>
          <Label>
            🚪 Pénalité si l&apos;équipe passe cette étape{" "}
            {scoring === "points" ? "(points perdus)" : "(minutes ajoutées)"}
          </Label>
          <Input
            type="number"
            min={0}
            inputMode="numeric"
            value={skipPenalty}
            onChange={(e) => setSkipPenalty(e.target.value)}
            placeholder={scoring === "points" ? "défaut de la partie" : "défaut de la partie"}
          />
          <p className="text-xs font-bold text-ink/50 mt-1">
            Un bouton « Bloqué ? Passer l&apos;étape » apparaît chez les joueurs. Vide = on
            utilise la pénalité globale de la partie. Mets une grosse valeur pour décourager
            l&apos;abandon d&apos;une épreuve clé.
          </p>

          {/* Rattrapable après un skip */}
          <label className="mt-3 flex items-start gap-2.5 rounded-xl border-[3px] border-ink bg-white/60 p-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-6 h-6 mt-0.5 shrink-0 accent-[#2E5E3A]"
              checked={redeemable}
              onChange={(e) => setRedeemable(e.target.checked)}
            />
            <span className="font-bold text-sm text-ink/85">
              <span className="font-display">↩️ Rattrapable après un skip</span> — l&apos;équipe
              peut revenir finir cette épreuve plus tard : réussie, la pénalité du skip est
              annulée et le gain de l&apos;étape rendu. Décochée = passer est définitif.
              Les épreuves d&apos;un groupe se rattrapent dans l&apos;ordre du groupe.
            </span>
          </label>
        </div>

        {/* Placement dans le parcours */}
        <div>
          <Label>Placement dans le parcours</Label>
          <div className="space-y-2">
            {(
              [
                { v: "start", icon: "🚀", label: "Épreuve de départ", help: "Toujours la première étape, identique pour toutes les équipes" },
                { v: "pool", icon: "🎲", label: "Pool aléatoire", help: "Ordre décalé pour chaque équipe (anti-suivi)" },
                { v: "common", icon: "📍", label: "Palier commun", help: "Position fixe, tout le monde y passe à ce moment du parcours" },
                { v: "final", icon: "🏁", label: "Sprint final", help: "Dernière étape identique pour tous, débloquée quand tout est validé" },
              ] as { v: Placement; icon: string; label: string; help: string }[]
            ).map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setPlacement(opt.v)}
                className={`w-full p-2.5 rounded-xl border-[3px] border-ink text-left ${
                  placement === opt.v ? "bg-gold" : "bg-white"
                }`}
              >
                <span className="font-display">
                  {opt.icon} {opt.label}
                </span>
                <span className="block text-xs font-bold text-ink/60">{opt.help}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Enchaînement d'étapes (pool uniquement) */}
        {placement === "pool" && (
          <div>
            <Label>🔗 Enchaîner avec d&apos;autres étapes (optionnel)</Label>
            <div className="flex flex-wrap gap-2">
              {(["", "A", "B", "C", "D", "E", "F"] as const).map((g) => (
                <button
                  key={g || "none"}
                  type="button"
                  onClick={() => setChainGroup(g)}
                  className={`h-10 px-3 rounded-lg border-2 border-ink font-bold text-sm ${
                    chainGroup === g ? "bg-gold text-ink" : "bg-white text-ink/60"
                  }`}
                >
                  {g === "" ? "Aucun" : `Groupe ${g}`}
                </button>
              ))}
            </div>
            <p className="text-xs font-bold text-ink/50 mt-1">
              Les étapes d&apos;un même groupe se jouent <strong>à la suite, dans l&apos;ordre de
              la liste</strong> (range-les avec les flèches ↑↓). Le groupe entier tombe à un
              endroit au hasard du parcours, mais reste soudé.
            </p>
          </div>
        )}

        {error && <p className="text-crimson font-bold">{error}</p>}

        <div className="flex gap-3 pt-1">
          <Button variant="parchment" onClick={onClose} className="flex-1">
            Annuler
          </Button>
          <Button onClick={save} disabled={busy} className="flex-1" size="lg">
            {busy ? "…" : "💾 ENREGISTRER"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
