"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayState, PublicStep, ValidateKind } from "@/lib/types";
import type { SubmitOutcome } from "./usePlayState";
import { extractTagId } from "@/lib/game/codes";
import { uploadSubmissionPhoto } from "@/lib/game/media";
import { rpc } from "@/lib/supabase/client";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";
import QrScanModal from "./QrScanModal";
import MinigameModal from "./MinigameModal";

interface ValidationZoneProps {
  step: PublicStep;
  teamId: string;
  gameId: string;
  submission: NonNullable<PlayState["current"]>["submission"];
  disabled: boolean;
  onSubmit: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
  onRefetch: () => Promise<void>;
}

/** Zone de validation adaptée au type d'étape : NFC/QR/code, texte, mini-jeu, photo. */
export default function ValidationZone({
  step,
  teamId,
  gameId,
  submission,
  disabled,
  onSubmit,
  onRefetch,
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
        <MinigameValidation step={step} teamId={teamId} disabled={disabled || busy} onRun={run} />
      )}
      {step.type === "photo" && (
        <PhotoValidation
          step={step}
          gameId={gameId}
          submission={submission}
          disabled={disabled || busy}
          onRefetch={onRefetch}
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
  const [qrOpen, setQrOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setNfcSupported("NDEFReader" in window);
    return () => abortRef.current?.abort();
  }, []);

  async function startNfcScan() {
    setScanning(true);
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
    } catch {
      setScanning(false);
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
            <span className="animate-pulse">📡 APPROCHE LA BALISE…</span>
          </Button>
        ) : (
          <Button full size="xl" onClick={startNfcScan} disabled={disabled}>
            📡 SCANNER LA BALISE NFC
          </Button>
        ))}
      <Button
        full
        size={nfcSupported ? "lg" : "xl"}
        variant={nfcSupported ? "parchment" : "gold"}
        onClick={() => setQrOpen(true)}
        disabled={disabled}
      >
        📷 SCANNER LE QR CODE
      </Button>
      <button
        className="w-full text-center font-bold text-ink/60 underline py-1"
        onClick={() => setManualOpen(true)}
        disabled={disabled}
      >
        Balise abîmée ? Saisir le code imprimé
      </button>

      <QrScanModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onScan={(value) => {
          setQrOpen(false);
          void onRun("qr", { tag: extractTagId(value) });
        }}
      />

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
  submission,
  disabled,
  onRefetch,
}: {
  step: PublicStep;
  gameId: string;
  submission: NonNullable<PlayState["current"]>["submission"];
  disabled: boolean;
  onRefetch: () => Promise<void>;
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
      const res = await rpc<{ ok: boolean; error?: string }>("submit_photo", {
        p_step_id: step.id,
        p_url: url,
      });
      if (!res.ok) throw new Error(res.error ?? "Envoi refusé");
      sfx.pop();
      haptics.scan();
      await onRefetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const pending = submission?.status === "pending";
  const rejected = submission?.status === "rejected";

  return (
    <div className="space-y-3">
      {pending ? (
        <div className="rounded-xl border-[3px] border-leaf bg-leaf/10 p-3 text-center">
          {submission?.url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={submission.url}
              alt="Photo envoyée"
              className="w-full max-h-56 object-cover rounded-lg border-2 border-ink mb-2"
            />
          )}
          <p className="font-display text-lg text-leaf animate-pulse">
            ⏳ PHOTO ENVOYÉE !
          </p>
          <p className="font-bold text-ink/60 text-sm">
            L&apos;organisateur la vérifie… vous pouvez souffler un instant.
          </p>
        </div>
      ) : (
        <>
          {rejected && (
            <div className="rounded-xl border-[3px] border-crimson bg-crimson/10 p-3 text-center">
              <p className="font-display text-crimson">❌ PHOTO REFUSÉE !</p>
              <p className="font-bold text-ink/60 text-sm">
                L&apos;organisateur veut mieux que ça — reprenez-en une !
              </p>
            </div>
          )}
          <Button
            full
            size="xl"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "⏳ ENVOI…" : "📸 PRENDRE LA PHOTO"}
          </Button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files)}
      />
      {pending && (
        <button
          className="w-full text-center font-bold text-ink/60 underline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Remplacer par une autre photo
        </button>
      )}
      {error && <p className="text-crimson font-bold text-sm text-center">{error}</p>}
    </div>
  );
}

// --- Mini-jeu ----------------------------------------------------------------

function MinigameValidation({
  step,
  teamId,
  disabled,
  onRun,
}: {
  step: PublicStep;
  teamId: string;
  disabled: boolean;
  onRun: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
}) {
  const [open, setOpen] = useState(false);

  if (!step.content.minigame) {
    return <p className="font-bold text-crimson">Mini-jeu mal configuré.</p>;
  }

  return (
    <>
      <Button full size="xl" onClick={() => setOpen(true)} disabled={disabled}>
        🎮 LANCER LE MINI-JEU
      </Button>
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
