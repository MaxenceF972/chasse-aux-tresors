"use client";

import { useState } from "react";
import { sb } from "@/lib/supabase/client";
import type { Hint, MinigameKind, Step, StepSecrets, StepType } from "@/lib/types";
import { newTagId, randomCode, tagUrl } from "@/lib/game/codes";
import { MINIGAMES, MINIGAME_LIST } from "@/components/minigames/registry";
import MediaUpload from "./MediaUpload";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label, TextArea } from "@/components/ui/Input";

type Placement = "pool" | "common" | "final";

interface StepEditorProps {
  gameId: string;
  /** null → création */
  step: Step | null;
  secrets: StepSecrets | null;
  initialType: StepType;
  nextOrderHint: number;
  hasOtherFinal: boolean;
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
};

export default function StepEditor({
  gameId,
  step,
  secrets,
  initialType,
  nextOrderHint,
  hasOtherFinal,
  onSaved,
  onClose,
}: StepEditorProps) {
  const type: StepType = step?.type ?? initialType;

  const [title, setTitle] = useState(step?.title ?? "");
  const [body, setBody] = useState(step?.content?.body ?? "");
  const [mediaUrls, setMediaUrls] = useState<string[]>(step?.media_urls ?? []);
  const [placement, setPlacement] = useState<Placement>(
    step?.is_final ? "final" : step?.is_common_checkpoint ? "common" : "pool"
  );
  const [answersText, setAnswersText] = useState((secrets?.answers ?? []).join("\n"));
  const [nfcTagId, setNfcTagId] = useState(secrets?.nfc_tag_id ?? newTagId());
  const [manualCode, setManualCode] = useState(secrets?.manual_code ?? randomCode(6));
  const [minigameKind, setMinigameKind] = useState<MinigameKind>(
    step?.content?.minigame?.kind ?? "caesar"
  );
  const [minigameConfig, setMinigameConfig] = useState<Record<string, unknown>>(
    step?.content?.minigame?.config ?? MINIGAMES[step?.content?.minigame?.kind ?? "caesar"].defaultConfig
  );
  const [hints, setHints] = useState<Hint[]>(secrets?.hints ?? []);
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

    setBusy(true);
    try {
      const row = {
        game_id: gameId,
        type,
        title: title.trim(),
        content: {
          body: body.trim() || undefined,
          minigame: type === "minigame" ? { kind: minigameKind, config: minigameConfig } : undefined,
        },
        media_urls: mediaUrls,
        is_common_checkpoint: placement === "common",
        is_final: placement === "final",
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
      });
      if (secErr) throw new Error(secErr.message);

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible");
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
          <p className="rounded-xl border-[3px] border-ink/20 p-3 font-bold text-sm text-ink/70">
            📸 Décris dans l&apos;énoncé la photo attendue (« Toute l&apos;équipe qui saute devant
            la fontaine ! »). Les photos arrivent dans le dashboard live avec deux boutons :
            Valider / Refuser.
          </p>
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

        {/* Placement dans le parcours */}
        <div>
          <Label>Placement dans le parcours</Label>
          <div className="space-y-2">
            {(
              [
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
