"use client";

import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";

interface QrScannerProps {
  /** Appelé avec le contenu brut du QR (URL de balise) au premier décodage. */
  onScan: (raw: string) => void;
  onClose: () => void;
}

/**
 * Scanner de QR intégré à l'app (caméra + jsQR) : valider une balise sans
 * quitter l'écran de jeu. Indispensable sur iPhone, où poser la puce NFC
 * ouvre une nouvelle page Safari à chaque scan (et perd la session en mode
 * signet) — ici, tout reste dans l'app.
 */
export default function QrScanner({ onScan, onClose }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let done = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        timer = setInterval(() => {
          if (done || !ctx || video.readyState < 2 || !video.videoWidth) return;
          // Décodage sur une image réduite : suffisant pour un QR, doux pour la batterie
          const scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (qr?.data) {
            done = true;
            haptics.scan();
            onScanRef.current(qr.data);
          }
        }, 250);
      } catch (err) {
        setError(
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "📵 Accès caméra refusé. Autorise la caméra pour ce site (réglages du navigateur), puis réessaie — ou saisis le code de la balise."
            : "📵 Caméra indisponible sur cet appareil — saisis le code de la balise à la place."
        );
      }
    })();

    return () => {
      done = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[65] bg-ink flex flex-col">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      {error ? (
        <div className="relative flex-1 flex items-center justify-center px-8">
          <p className="font-bold text-parchment text-center">{error}</p>
        </div>
      ) : (
        <div className="relative flex-1 flex flex-col items-center justify-center gap-5 px-8">
          {/* Viseur : le halo sombre concentre l'œil sur le cadre */}
          <div className="w-64 h-64 max-w-[70vw] max-h-[70vw] rounded-3xl border-4 border-gold shadow-[0_0_0_9999px_rgba(17,17,17,0.55)]" />
          <p className="relative font-display text-parchment text-lg text-center drop-shadow">
            🎯 Vise le QR de la balise
          </p>
        </div>
      )}
      <div className="relative px-6 pb-safe pt-3">
        <Button full size="lg" variant="parchment" onClick={onClose}>
          ✕ ANNULER
        </Button>
      </div>
    </div>
  );
}
