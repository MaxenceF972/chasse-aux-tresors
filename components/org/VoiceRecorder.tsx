"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";

interface VoiceRecorderProps {
  /** Reçoit le fichier prêt à téléverser ; peut lever une erreur (retour à l'aperçu) */
  onRecorded: (file: File) => Promise<void> | void;
  disabled?: boolean;
}

const MAX_SEC = 180; // 3 min max — largement assez pour un message mystère

/** audio/mp4 en priorité : c'est le seul format lu PARTOUT (iPhone inclus). */
function pickMime(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates: Array<[string, string]> = [
    ["audio/mp4", "m4a"],
    ["audio/webm;codecs=opus", "weba"],
    ["audio/webm", "weba"],
    ["audio/ogg;codecs=opus", "ogg"],
  ];
  for (const [mime, ext] of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

/** Enregistreur de message vocal (épreuves audio sans quitter l'app). */
export default function VoiceRecorder({ onRecorded, disabled }: VoiceRecorderProps) {
  const [state, setState] = useState<"idle" | "recording" | "preview" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resultRef = useRef<{ blob: Blob; ext: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanupCapture() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  // Coupe micro et minuteur si l'éditeur se ferme en plein enregistrement
  useEffect(() => {
    return () => cleanupCapture();
  }, []);

  async function start() {
    setError(null);
    const picked = pickMime();
    if (!picked) {
      setError("Enregistrement non supporté sur ce navigateur — téléverse un fichier audio à la place.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: picked.mime });
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: picked.mime.split(";")[0] });
        resultRef.current = { blob, ext: picked.ext };
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        cleanupCapture();
        setState("preview");
      };
      recorder.start(250);
      setSeconds(0);
      setState("recording");
      timerRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SEC) stopRecording();
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      cleanupCapture();
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "🎙️ Micro refusé — autorise-le quand le navigateur le demande (ou dans les réglages du site), puis réessaie."
          : "🎙️ Micro indisponible sur cet appareil — téléverse un fichier audio à la place."
      );
    }
  }

  function stopRecording() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else cleanupCapture();
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    resultRef.current = null;
    setState("idle");
  }

  async function send() {
    const result = resultRef.current;
    if (!result) return;
    setState("sending");
    setError(null);
    try {
      const file = new File([result.blob], `message-vocal-${Date.now()}.${result.ext}`, {
        type: result.blob.type,
      });
      await onRecorded(file);
      discard();
    } catch {
      // l'appelant affiche son erreur ; on laisse réécouter/réessayer
      setState("preview");
    }
  }

  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="mt-2">
      {state === "idle" && (
        <button
          type="button"
          disabled={disabled}
          onClick={start}
          className="h-11 px-3 rounded-lg border-2 border-dashed border-ink/40 text-ink/60 hover:border-ink hover:text-ink font-bold text-sm disabled:opacity-50"
        >
          🎙️ Enregistrer un message vocal
        </button>
      )}

      {state === "recording" && (
        <div className="flex items-center gap-3 rounded-xl border-[3px] border-crimson bg-crimson/10 px-3 py-2">
          <span className="w-3 h-3 rounded-full bg-crimson animate-pulse shrink-0" />
          <span className="font-display tabular-nums">
            {mm}:{ss}
          </span>
          <span className="font-bold text-ink/60 text-sm flex-1">Enregistrement…</span>
          <Button size="sm" variant="crimson" onClick={stopRecording}>
            ⏹️ STOP
          </Button>
        </div>
      )}

      {(state === "preview" || state === "sending") && previewUrl && (
        <div className="space-y-2 rounded-xl border-[3px] border-ink/20 p-3">
          <p className="font-bold text-ink/60 text-sm">🎙️ Réécoute ton message :</p>
          <audio src={previewUrl} controls preload="metadata" className="w-full" />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              size="md"
              variant="parchment"
              disabled={state === "sending"}
              onClick={discard}
            >
              🗑️ Refaire
            </Button>
            <Button
              className="flex-1"
              size="md"
              variant="leaf"
              disabled={state === "sending"}
              onClick={send}
            >
              {state === "sending" ? "⏳ Envoi…" : "✅ AJOUTER À L'ÉTAPE"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-crimson font-bold text-sm mt-1">{error}</p>}
    </div>
  );
}
