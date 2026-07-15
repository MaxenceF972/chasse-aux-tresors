"use client";

import { useEffect, useRef, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import { haptics } from "@/lib/game/haptics";

interface QrScanModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (value: string) => void;
}

/** Scanner QR caméra (jsQR, importé à la demande) — tous navigateurs mobiles. */
export default function QrScanModal({ open, onClose, onScan }: QrScanModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

    (async () => {
      const jsQR = (await import("jsqr")).default;

      const loop = () => {
        if (stopped) return;
        const video = videoRef.current;
        if (video && video.readyState >= video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(image.data, image.width, image.height, {
            inversionAttempts: "dontInvert",
          });
          if (qr?.data) {
            stopped = true;
            haptics.scan();
            onScanRef.current(qr.data.trim());
            return;
          }
        }
        raf = requestAnimationFrame(loop);
      };

      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        raf = requestAnimationFrame(loop);
      } catch {
        setError(
          "Impossible d'accéder à la caméra. Autorise la caméra dans les réglages du navigateur, ou utilise le code imprimé sur la balise."
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title="📷 Scanner le QR code">
      {error ? (
        <p className="font-bold text-crimson">{error}</p>
      ) : (
        <div className="relative rounded-xl overflow-hidden border-[3px] border-ink bg-ink aspect-[3/4]">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
          {/* Viseur */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-52 h-52 border-4 border-gold rounded-2xl shadow-[0_0_0_2000px_rgba(17,17,17,0.35)]" />
          </div>
          <p className="absolute bottom-3 inset-x-0 text-center font-display text-parchment text-lg drop-shadow">
            Vise le QR de la balise !
          </p>
        </div>
      )}
    </Dialog>
  );
}
