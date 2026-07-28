"use client";

import { useRef, useState } from "react";
import type { SkippedStep } from "@/lib/types";
import { frError, rpc } from "@/lib/supabase/client";
import { isAudioUrl, isVideoUrl, uploadSubmissionPhoto } from "@/lib/game/media";
import { normalizeThresholds } from "@/lib/game/hotcold";
import { renderRich } from "@/lib/game/rich";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import { showToast } from "@/components/ui/Toaster";
import GpsCompass from "./GpsCompass";
import GpsHotCold from "./GpsHotCold";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { Input, Label } from "@/components/ui/Input";

interface RedeemResult {
  ok: boolean;
  correct?: boolean;
  error?: string;
  distance_m?: number;
  blocking_title?: string;
}

interface RedeemModalProps {
  step: SkippedStep;
  gameId: string;
  onClose: () => void;
  /** Rattrapage réussi : le parent resynchronise l'état */
  onDone: () => Promise<void> | void;
}

/**
 * Rattrapage d'une épreuve sautée (texte, balise NFC, balise GPS, photo) —
 * les mini-jeux passent par MinigameModal. La pénalité du skip reste due :
 * réussir ici rend le gain de l'étape (points / photo jugée).
 */
export default function RedeemModal({ step, gameId, onClose, onDone }: RedeemModalProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState("");
  const livePos = useRef<{ lat: number; lng: number } | null>(null);
  const [hasPos, setHasPos] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  async function send(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    try {
      const res = await rpc<RedeemResult>("redeem_step", {
        p_idem_key: crypto.randomUUID(),
        p_step_id: step.id,
        p_payload: payload,
      });
      if (res.correct) {
        sfx.success();
        haptics.success();
        showToast(
          step.type === "photo"
            ? "📸 Photo envoyée — le maître du jeu la jugera !"
            : "💪 Épreuve rattrapée !",
          "success"
        );
        await onDone();
        onClose();
        return true;
      }
      if (res.error === "GROUPE_ORDRE") {
        setStatus(
          `⛓️ Ces épreuves se jouent dans l'ordre — rattrapez d'abord « ${
            res.blocking_title ?? "l'épreuve précédente"
          } » !`
        );
      } else if (res.error) {
        setStatus(`⚠️ ${res.error}`);
      } else {
        sfx.fail();
        haptics.fail();
        setStatus(
          step.type === "gps" && res.distance_m != null
            ? `🧭 Pas encore ! Vous êtes à environ ${
                res.distance_m >= 1000
                  ? `${(res.distance_m / 1000).toFixed(1)} km`
                  : `${Math.round(res.distance_m)} m`
              } du lieu.`
            : "❌ Raté — réessayez !"
        );
      }
      return false;
    } catch (err) {
      setStatus(`⚠️ ${frError(err, "Erreur — réessaie")}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendPhoto(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setPhotoBusy(true);
    setStatus(null);
    try {
      const url = await uploadSubmissionPhoto(gameId, file);
      await send({ url });
    } catch (err) {
      setStatus(`⚠️ ${frError(err, "Envoi impossible — réessaie")}`);
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  const target = step.gps_target ?? null;

  return (
    <Dialog open onClose={onClose} title={`⏩ ${step.title}`}>
      <div className="space-y-4">
        <p className="font-bold text-ink/55 text-sm">
          Épreuve sautée — la rattraper maintenant ne coûte rien de plus (la pénalité du
          skip est déjà comptée).
        </p>

        {/* Médias et énoncé, comme sur l'épreuve d'origine */}
        {step.media_urls.map((url) =>
          isAudioUrl(url) ? (
            <div key={url} className="rounded-2xl border-[3px] border-ink bg-white/70 p-3">
              <p className="font-display text-sm mb-2">🎵 MESSAGE AUDIO</p>
              <audio src={url} controls preload="metadata" className="w-full" />
            </div>
          ) : isVideoUrl(url) ? (
            <video
              key={url}
              src={url}
              controls
              playsInline
              preload="metadata"
              className="w-full rounded-2xl border-[3px] border-ink"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="w-full rounded-2xl border-[3px] border-ink" />
          )
        )}
        {step.content.body && (
          <div
            className="font-bold leading-relaxed text-ink/85"
            dangerouslySetInnerHTML={{ __html: renderRich(step.content.body) }}
          />
        )}

        {step.type === "text" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (answer.trim()) void send({ answer: answer.trim() });
            }}
            className="space-y-3"
          >
            <Label>Ta réponse</Label>
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Écris la réponse ici…"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="go"
            />
            <Button type="submit" full size="lg" disabled={busy || !answer.trim()}>
              ⚡ VALIDER
            </Button>
          </form>
        )}

        {step.type === "nfc" && (
          <div className="space-y-3">
            <div className="rounded-xl border-[3px] border-ink bg-gold px-4 py-3 text-center">
              <div className="text-3xl mb-1 animate-pulse">📡</div>
              <p className="font-bold text-ink/80 text-sm">
                Retournez à la balise et posez le téléphone dessus : le scan la rattrape
                tout seul. Balise abîmée ? Saisissez son code :
              </p>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) void send({ tag: code.trim() });
              }}
              className="space-y-3"
            >
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="EX : K7M2PX"
                className="font-mono tracking-[0.3em] text-center text-2xl"
                maxLength={12}
                autoCapitalize="characters"
                autoComplete="off"
                enterKeyHint="go"
              />
              <Button type="submit" full size="lg" disabled={busy || !code.trim()}>
                ⚡ VALIDER
              </Button>
            </form>
          </div>
        )}

        {step.type === "gps" && (
          <div className="space-y-3">
            {target ? (
              <GpsCompass
                target={target}
                onUpdate={(lat, lng) => {
                  livePos.current = { lat, lng };
                  setHasPos(true);
                }}
              />
            ) : (
              <GpsHotCold
                stepId={step.id}
                thresholds={normalizeThresholds(
                  step.content.gps_hotcold_thresholds,
                  step.content.gps_hotcold_range
                )}
                onPosition={(lat, lng) => {
                  livePos.current = { lat, lng };
                  setHasPos(true);
                }}
                onWithin={(lat, lng) => {
                  if (!busy) void send({ lat, lng });
                }}
              />
            )}
            <Button
              full
              size="lg"
              disabled={busy || !hasPos}
              onClick={() => livePos.current && send({ lat: livePos.current.lat, lng: livePos.current.lng })}
            >
              {busy ? "🛰️ VÉRIFICATION…" : "📍 VALIDER MA POSITION"}
            </Button>
          </div>
        )}

        {step.type === "photo" && (
          <div className="space-y-3">
            <Button
              full
              size="lg"
              disabled={photoBusy || busy}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoBusy ? "⏳ ENVOI…" : "📸 PRENDRE LA PHOTO"}
            </Button>
            <p className="text-center font-bold text-ink/55 text-sm">
              Elle part directement chez le maître du jeu (refusée = 0 point sur l&apos;étape).
            </p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void sendPhoto(e.target.files)}
            />
          </div>
        )}

        {status && (
          <p className="text-center font-bold text-ink/75 text-sm rounded-xl border-2 border-ink/20 bg-white/60 px-3 py-2">
            {status}
          </p>
        )}
      </div>
    </Dialog>
  );
}
