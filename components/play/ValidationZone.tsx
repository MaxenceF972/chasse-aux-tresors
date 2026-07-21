"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayState, PublicStep, ValidateKind } from "@/lib/types";
import type { SubmitOutcome } from "./usePlayState";
import { extractTagId } from "@/lib/game/codes";
import { uploadSubmissionPhoto } from "@/lib/game/media";
import { frError, rpc } from "@/lib/supabase/client";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { showToast } from "@/components/ui/Toaster";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import MinigameModal from "./MinigameModal";

interface ValidationZoneProps {
  step: PublicStep;
  teamId: string;
  gameId: string;
  submission: NonNullable<PlayState["current"]>["submission"];
  disabled: boolean;
  /** Libellé de la pénalité de skip ("50 points" ou "3 minutes") */
  skipPenaltyLabel: string;
  onSubmit: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
  onRefetch: () => Promise<void>;
  /** Photo envoyée → l'équipe avance (déclenche l'animation de succès) */
  onAdvanced: (finished: boolean) => void;
}

/** Zone de validation adaptée au type d'étape : NFC/QR/code, texte, mini-jeu, photo. */
export default function ValidationZone({
  step,
  teamId,
  gameId,
  submission,
  disabled,
  skipPenaltyLabel,
  onSubmit,
  onRefetch,
  onAdvanced,
}: ValidationZoneProps) {
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  function feedbackWrong() {
    setWrong(true);
    sfx.fail();
    haptics.fail();
    setTimeout(() => setWrong(false), 650);
  }

  async function run(kind: ValidateKind, payload: Record<string, unknown>): Promise<SubmitOutcome> {
    setBusy(true);
    setInfo(null);
    try {
      const outcome = await onSubmit(kind, payload);
      if (outcome.status === "wrong") feedbackWrong();
      if (outcome.status === "queued")
        setInfo("📶 Pas de réseau — ta validation est enregistrée et partira automatiquement.");
      if (outcome.status === "error") setInfo(`⚠️ ${outcome.message}`);
      return outcome;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={wrong ? "animate-shake" : ""}>
      {step.type === "text" && <TextAnswer disabled={disabled || busy} onRun={run} />}
      {step.type === "nfc" && <NfcValidation disabled={disabled || busy} onRun={run} />}
      {step.type === "minigame" && (
        <MinigameValidation
          step={step}
          teamId={teamId}
          disabled={disabled || busy}
          skipPenaltyLabel={skipPenaltyLabel}
          onRun={run}
          onRefetch={onRefetch}
        />
      )}
      {step.type === "photo" && (
        <PhotoValidation
          step={step}
          gameId={gameId}
          submission={submission}
          disabled={disabled || busy}
          onAdvanced={onAdvanced}
        />
      )}
      {info && <p className="mt-3 font-bold text-sm text-ink/70 text-center">{info}</p>}
    </div>
  );
}

// --- Réponse texte -----------------------------------------------------------

function TextAnswer({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
}) {
  const [answer, setAnswer] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return;
    const outcome = await onRun("text", { answer: answer.trim() });
    if (outcome.status === "correct") setAnswer("");
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Label>Ta réponse</Label>
      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Écris la réponse ici…"
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="go"
      />
      <Button type="submit" full size="xl" disabled={disabled || !answer.trim()}>
        ⚡ VALIDER
      </Button>
    </form>
  );
}

// --- Balise NFC / QR / code manuel ------------------------------------------

function NfcValidation({
  disabled,
  onRun,
}: {
  disabled: boolean;
  onRun: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
}) {
  const [nfcSupported, setNfcSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [nfcError, setNfcError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setNfcSupported("NDEFReader" in window);
    return () => abortRef.current?.abort();
  }, []);

  async function startNfcScan() {
    setScanning(true);
    setNfcError(null);
    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const ndef = new NDEFReader();
      ndef.onreading = (event) => {
        for (const record of event.message.records) {
          // Les balises TOYAH contiennent une URL ; on accepte aussi le texte brut.
          if ((record.recordType === "url" || record.recordType === "text") && record.data) {
            const raw = new TextDecoder(record.encoding || "utf-8").decode(record.data).trim();
            if (raw) {
              ctrl.abort();
              setScanning(false);
              haptics.scan();
              void onRun("nfc", { tag: extractTagId(raw) });
              return;
            }
          }
        }
      };
      await ndef.scan({ signal: ctrl.signal });
    } catch (err) {
      setScanning(false);
      // Arrêt volontaire (bouton ou fermeture) : pas une erreur
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        setNfcError(
          "📵 Accès NFC refusé. Autorise-le quand le navigateur le demande (ou dans les réglages du site), puis réessaie."
        );
      } else {
        setNfcError(
          "📵 Lecture NFC impossible (NFC coupé ?). Active le NFC dans les réglages du téléphone, puis réessaie — ou saisis le code de la balise ci-dessous."
        );
      }
    }
  }

  function stopNfcScan() {
    abortRef.current?.abort();
    setScanning(false);
  }

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const outcome = await onRun("manual", { tag: manualCode.trim() });
    if (outcome.status === "correct") {
      setManualOpen(false);
      setManualCode("");
    }
  }

  return (
    <div className="space-y-3">
      {nfcSupported &&
        (scanning ? (
          <Button full size="xl" variant="leaf" onClick={stopNfcScan}>
            <span className="animate-pulse">📡 POSITIONNE-LE SUR LA BALISE…</span>
          </Button>
        ) : (
          <Button full size="xl" onClick={startNfcScan} disabled={disabled}>
            📡 POSITIONNE TON TÉLÉPHONE SUR LA BALISE
          </Button>
        ))}
      {!nfcSupported && (
        <div className="rounded-xl border-[3px] border-ink bg-gold px-4 py-4 text-center">
          <div className="text-3xl mb-1 animate-pulse">📡</div>
          <p className="font-display text-lg leading-tight">
            POSITIONNE TON TÉLÉPHONE SUR LA BALISE
          </p>
          <p className="font-bold text-ink/60 text-sm mt-1">
            Colle le haut du téléphone sur la balise, écran allumé : la validation
            s&apos;ouvre toute seule !
          </p>
        </div>
      )}
      {nfcError && (
        <p className="text-center font-bold text-crimson text-sm rounded-xl border-2 border-crimson/40 bg-crimson/5 px-3 py-2">
          {nfcError}
        </p>
      )}
      <button
        className="w-full text-center font-bold text-ink/60 underline py-1"
        onClick={() => setManualOpen(true)}
        disabled={disabled}
      >
        Balise abîmée ou introuvable ? Saisir son code
      </button>

      <Dialog open={manualOpen} onClose={() => setManualOpen(false)} title="🔢 Code de la balise">
        <form onSubmit={submitManual} className="space-y-4">
          <Input
            autoFocus
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            placeholder="EX : K7M2PX"
            className="font-mono tracking-[0.3em] text-center text-2xl"
            maxLength={12}
            autoCapitalize="characters"
            autoComplete="off"
            enterKeyHint="go"
          />
          <Button type="submit" full size="lg" disabled={!manualCode.trim()}>
            ⚡ VALIDER
          </Button>
        </form>
      </Dialog>
    </div>
  );
}

// --- Épreuve photo -------------------------------------------------------------

function PhotoValidation({
  step,
  gameId,
  disabled,
  onAdvanced,
}: {
  step: PublicStep;
  gameId: string;
  submission: NonNullable<PlayState["current"]>["submission"];
  disabled: boolean;
  onAdvanced: (finished: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadSubmissionPhoto(gameId, file);
      const res = await rpc<{ ok: boolean; finished?: boolean; error?: string }>("submit_photo", {
        p_step_id: step.id,
        p_url: url,
      });
      if (!res.ok) throw new Error(res.error ?? "Envoi refusé");
      // Photo envoyée → on avance tout de suite ; l'organisateur jugera plus tard
      onAdvanced(!!res.finished);
    } catch (err) {
      setError(frError(err, "Envoi impossible — réessaie"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <Button full size="xl" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
        {busy ? "⏳ ENVOI…" : "📸 PRENDRE LA PHOTO"}
      </Button>
      <p className="text-center font-bold text-ink/55 text-sm">
        La photo part au maître du jeu et vous passez direct à la suite — il la jugera en fin de
        partie (refusée = 0 point sur l&apos;étape 😬).
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />
      {error && <p className="text-crimson font-bold text-sm text-center">{error}</p>}
    </div>
  );
}

// --- Mini-jeu ----------------------------------------------------------------

function MinigameValidation({
  step,
  teamId,
  disabled,
  skipPenaltyLabel,
  onRun,
  onRefetch,
}: {
  step: PublicStep;
  teamId: string;
  disabled: boolean;
  skipPenaltyLabel: string;
  onRun: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
  onRefetch: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [skipBusy, setSkipBusy] = useState(false);

  if (!step.content.minigame) {
    return <p className="font-bold text-crimson">Mini-jeu mal configuré.</p>;
  }

  async function doSkip() {
    setSkipBusy(true);
    try {
      const res = await rpc<{ ok: boolean; error?: string }>("skip_minigame", {
        p_step_id: step.id,
      });
      if (res.ok) {
        sfx.pop();
        setSkipConfirm(false);
        await onRefetch();
      } else {
        showToast(res.error ?? "Impossible de passer le mini-jeu — réessaie", "error");
      }
    } catch {
      showToast("Connexion instable — impossible de passer le mini-jeu, réessaie", "error");
    } finally {
      setSkipBusy(false);
    }
  }

  return (
    <>
      <Button full size="xl" onClick={() => setOpen(true)} disabled={disabled}>
        🎮 LANCER LE MINI-JEU
      </Button>
      <button
        className="w-full text-center font-bold text-ink/55 underline py-1.5"
        disabled={disabled}
        onClick={() => setSkipConfirm(true)}
      >
        Trop dur ? Passer ce mini-jeu (pénalité : {skipPenaltyLabel})
      </button>

      <Dialog open={skipConfirm} onClose={() => setSkipConfirm(false)} title="⏭️ Passer le mini-jeu ?">
        <div className="space-y-4">
          <p className="font-bold text-ink/75">
            Êtes-vous sûrs de vouloir passer ce mini-jeu ? Pénalité :{" "}
            <span className="text-crimson">{skipPenaltyLabel}</span>.
          </p>
          <p className="font-bold text-ink/55 text-sm">
            💡 Vous pourrez le retenter plus tard depuis « Mini-jeux à rattraper » — le réussir
            annulera la pénalité !
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" variant="parchment" onClick={() => setSkipConfirm(false)}>
              On continue !
            </Button>
            <Button className="flex-1" variant="crimson" disabled={skipBusy} onClick={doSkip}>
              {skipBusy ? "…" : "⏭️ PASSER"}
            </Button>
          </div>
        </div>
      </Dialog>

      {open && (
        <MinigameModal
          kind={step.content.minigame.kind}
          config={step.content.minigame.config}
          seed={`${teamId}:${step.id}`}
          onClose={() => setOpen(false)}
          onComplete={async (result) => {
            const outcome = await onRun("minigame", {
              answer: result.answer,
              score: result.score,
              duration_ms: result.durationMs,
            });
            if (outcome.status === "correct" || outcome.status === "queued") {
              setOpen(false);
              return true;
            }
            return false;
          }}
        />
      )}
    </>
  );
}
