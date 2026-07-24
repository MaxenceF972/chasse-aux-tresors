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
import GpsCompass from "./GpsCompass";
import GpsHotCold from "./GpsHotCold";
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
      {step.type === "gps" && <GpsValidation step={step} disabled={disabled || busy} onRun={run} />}
      {step.type === "minigame" && (
        <MinigameValidation step={step} teamId={teamId} disabled={disabled || busy} onRun={run} />
      )}
      {step.type === "photo" && (
        <PhotoValidation
          step={step}
          gameId={gameId}
          submission={submission}
          disabled={disabled || busy}
          onAdvanced={onAdvanced}
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

// --- Balise GPS ---------------------------------------------------------------

function GpsValidation({
  step,
  disabled,
  onRun,
}: {
  step: PublicStep;
  disabled: boolean;
  onRun: (kind: ValidateKind, payload: Record<string, unknown>) => Promise<SubmitOutcome>;
}) {
  const target = step.gps_target ?? null;
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const livePos = useRef<{ lat: number; lng: number } | null>(null);
  const [liveDist, setLiveDist] = useState<number | null>(null);
  const autoTried = useRef(false);

  async function submitPos(lat: number, lng: number) {
    setChecking(true);
    setStatus(null);
    const outcome = await onRun("gps", { lat, lng });
    if (outcome.status === "wrong") {
      setStatus(
        outcome.distanceM != null
          ? `🧭 Pas encore ! Vous êtes à environ ${
              outcome.distanceM >= 1000
                ? `${(outcome.distanceM / 1000).toFixed(1)} km`
                : `${Math.round(outcome.distanceM)} m`
            } du lieu.`
          : "🧭 Pas encore au bon endroit — continuez à avancer !"
      );
    }
    setChecking(false);
  }

  // Mode boussole : la cible est fournie → guidage live + validation auto à l'arrivée
  if (target) {
    const within = liveDist != null && liveDist <= target.radius;
    return (
      <div className="space-y-3">
        <GpsCompass
          target={target}
          onUpdate={(lat, lng, d) => {
            livePos.current = { lat, lng };
            setLiveDist(d);
            if (d <= target.radius && !autoTried.current && !checking) {
              autoTried.current = true;
              void submitPos(lat, lng);
            }
            if (d > target.radius) autoTried.current = false;
          }}
        />
        <Button
          full
          size="xl"
          variant={within ? "leaf" : "gold"}
          disabled={disabled || checking || !livePos.current}
          onClick={() => livePos.current && submitPos(livePos.current.lat, livePos.current.lng)}
        >
          {checking
            ? "🛰️ VÉRIFICATION…"
            : within
              ? "🎯 VALIDER — VOUS Y ÊTES !"
              : "📍 VALIDER MA POSITION"}
        </Button>
        {status && (
          <p className="text-center font-bold text-ink/75 text-sm rounded-xl border-2 border-ink/20 bg-white/60 px-3 py-2">
            {status}
          </p>
        )}
      </div>
    );
  }

  // Mode chaud/froid : cible cachée. Thermomètre live (pings serveur en lecture
  // seule) — la distance et l'intensité montent à mesure qu'on approche, sans
  // jamais divulguer la position exacte de la balise. Validation automatique à
  // l'arrivée, plus un bouton manuel de repli.
  return (
    <div className="space-y-3">
      <GpsHotCold
        stepId={step.id}
        onPosition={(lat, lng) => {
          livePos.current = { lat, lng };
        }}
        onWithin={(lat, lng) => {
          if (!checking) void submitPos(lat, lng);
        }}
      />
      <Button
        full
        size="xl"
        variant="gold"
        disabled={disabled || checking || !livePos.current}
        onClick={() => livePos.current && submitPos(livePos.current.lat, livePos.current.lng)}
      >
        {checking ? "🛰️ VÉRIFICATION…" : "📍 VALIDER MA POSITION"}
      </Button>
      <p className="text-center font-bold text-ink/55 text-sm">
        Approchez-vous du lieu mystère : plus vous chauffez, plus vous êtes près. La validation se
        fait toute seule dès que vous y êtes.
      </p>
      {status && (
        <p className="text-center font-bold text-ink/75 text-sm rounded-xl border-2 border-ink/20 bg-white/60 px-3 py-2">
          {status}
        </p>
      )}
    </div>
  );
}

// --- Épreuve photo -------------------------------------------------------------

function PhotoValidation({
  step,
  gameId,
  submission,
  disabled,
  onAdvanced,
  onRefetch,
}: {
  step: PublicStep;
  gameId: string;
  submission: NonNullable<PlayState["current"]>["submission"];
  disabled: boolean;
  onAdvanced: (finished: boolean) => void;
  onRefetch: () => Promise<void>;
}) {
  const isGate = step.content.photo_mode === "gate";
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Libère l'aperçu si on quitte l'écran sans envoyer
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.url);
    };
  }, [pending]);

  function handleFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setPending({ file, url: URL.createObjectURL(file) });
    if (inputRef.current) inputRef.current.value = "";
  }

  function retake() {
    setPending(null);
    setError(null);
    // rouvre directement l'appareil photo
    setTimeout(() => inputRef.current?.click(), 50);
  }

  async function send() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const url = await uploadSubmissionPhoto(gameId, pending.file);
      const res = await rpc<{ ok: boolean; finished?: boolean; pending?: boolean; error?: string }>(
        "submit_photo",
        { p_step_id: step.id, p_url: url }
      );
      if (!res.ok) throw new Error(res.error ?? "Envoi refusé");
      setPending(null);
      if (res.pending) {
        // Photo bloquante : on attend le verdict du maître du jeu
        showToast("📨 Photo envoyée au maître du jeu — en attente de sa validation !", "info");
        await onRefetch();
      } else {
        // Photo bonus : on avance tout de suite ; l'organisateur jugera plus tard
        onAdvanced(!!res.finished);
      }
    } catch (err) {
      setError(frError(err, "Envoi impossible — réessaie"));
    } finally {
      setBusy(false);
    }
  }

  const waitingReview = isGate && !pending && submission?.status === "pending";
  const wasRejected = isGate && !pending && submission?.status === "rejected";

  return (
    <div className="space-y-3">
      {waitingReview && (
        <div className="rounded-xl border-[3px] border-ink bg-white/70 px-4 py-4 text-center">
          <div className="text-3xl mb-1 animate-pulse">⏳</div>
          <p className="font-display text-lg leading-tight">PHOTO CHEZ LE MAÎTRE DU JEU</p>
          <p className="font-bold text-ink/60 text-sm mt-1">
            Dès qu&apos;il la valide, vous passez à la suite — vous pouvez aussi en renvoyer une
            meilleure en attendant.
          </p>
        </div>
      )}
      {wasRejected && (
        <p className="text-center font-bold text-crimson text-sm rounded-xl border-2 border-crimson/40 bg-crimson/5 px-3 py-2">
          ❌ Photo refusée par le maître du jeu — reprenez-en une pour continuer !
        </p>
      )}
      {pending ? (
        <>
          {/* Boutons AU-DESSUS de la photo : sur un portrait plein cadre, placés
              en dessous ils passaient sous la ligne de flottaison. */}
          <div className="flex gap-2">
            <Button className="flex-1" size="lg" variant="parchment" disabled={busy} onClick={retake}>
              🔄 REPRENDRE
            </Button>
            <Button className="flex-1" size="lg" variant="leaf" disabled={busy} onClick={send}>
              {busy ? "⏳ ENVOI…" : "✅ ENVOYER"}
            </Button>
          </div>
          <p className="text-center font-bold text-ink/55 text-sm">
            {isGate
              ? "Vérifiez la photo avant d'envoyer — le maître du jeu doit la valider pour que vous passiez à la suite."
              : "Vérifiez la photo avant d'envoyer — une fois partie, le maître du jeu la jugera (refusée = 0 point sur l'étape 😬)."}
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pending.url}
            alt="Aperçu de la photo"
            className="w-full rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111] bg-ink"
          />
        </>
      ) : (
        <>
          <Button full size="xl" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
            {waitingReview || wasRejected ? "📸 REPRENDRE UNE PHOTO" : "📸 PRENDRE LA PHOTO"}
          </Button>
          <p className="text-center font-bold text-ink/55 text-sm">
            Vous verrez un aperçu avant l&apos;envoi — possible de la reprendre autant de fois que
            vous voulez.
          </p>
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
