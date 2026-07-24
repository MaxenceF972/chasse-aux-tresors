"use client";

import { useEffect, useRef, useState } from "react";

interface GpsCompassProps {
  target: { lat: number; lng: number; radius: number };
  /** Position live remontée au parent (pour la validation serveur) */
  onUpdate: (lat: number, lng: number, distanceM: number) => void;
}

function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Cap (°, 0 = Nord) depuis la position courante vers la cible. */
function bearingDeg(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function fmtDist(d: number): string {
  if (d >= 1000) return `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`;
  return `${Math.round(d)} m`;
}

const CARDINALS = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest"];
function cardinal(deg: number): string {
  return CARDINALS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

interface OrientationEventLike extends Event {
  webkitCompassHeading?: number;
  absolute?: boolean;
  alpha?: number | null;
}

/** Boussole de géocaching : distance live + flèche qui pointe vers la cible. */
export default function GpsCompass({ target, onUpdate }: GpsCompassProps) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [needIosPerm, setNeedIosPerm] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Position GPS en continu
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoErr("Pas de GPS sur ce téléphone.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const la = p.coords.latitude;
        const ln = p.coords.longitude;
        setPos({ lat: la, lng: ln });
        setAcc(p.coords.accuracy ?? null);
        setGeoErr(null);
        onUpdateRef.current(la, ln, distanceM({ lat: la, lng: ln }, target));
      },
      (err) =>
        setGeoErr(
          err.code === err.PERMISSION_DENIED
            ? "Localisation refusée — autorise-la dans les réglages."
            : "Position introuvable — sors à découvert et patiente."
        ),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.lat, target.lng]);

  function applyHeading(e: OrientationEventLike) {
    if (typeof e.webkitCompassHeading === "number") setHeading(e.webkitCompassHeading);
    else if (e.absolute && typeof e.alpha === "number") setHeading((360 - e.alpha) % 360);
  }

  // Orientation du téléphone (magnétomètre)
  useEffect(() => {
    const DOE = typeof window !== "undefined" ? (window.DeviceOrientationEvent as unknown) : null;
    const needsPerm =
      !!DOE && typeof (DOE as { requestPermission?: unknown }).requestPermission === "function";
    if (needsPerm) {
      setNeedIosPerm(true); // iOS : bouton d'activation requis (geste utilisateur)
      return;
    }
    const handler = (e: Event) => applyHeading(e as OrientationEventLike);
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }, []);

  async function enableIosCompass() {
    try {
      const DOE = window.DeviceOrientationEvent as unknown as {
        requestPermission: () => Promise<"granted" | "denied">;
      };
      const res = await DOE.requestPermission();
      if (res === "granted") {
        setNeedIosPerm(false);
        const handler = (e: Event) => applyHeading(e as OrientationEventLike);
        window.addEventListener("deviceorientation", handler, true);
      }
    } catch {
      /* refusé — on reste en mode texte */
    }
  }

  const dist = pos ? distanceM(pos, target) : null;
  const brg = pos ? bearingDeg(pos, target) : null;
  // Flèche relative au téléphone si on connaît son orientation
  const arrowDeg = brg != null && heading != null ? (brg - heading + 360) % 360 : null;
  const within = dist != null && dist <= target.radius;

  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white/70 p-4 text-center">
      {/* Cadran */}
      <div className="relative mx-auto w-44 h-44">
        <div className="absolute inset-0 rounded-full border-[3px] border-ink bg-parchment" />
        {/* Repères cardinaux */}
        <span className="absolute top-1 left-1/2 -translate-x-1/2 font-display text-xs text-ink/50">N</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-display text-xs text-ink/30">S</span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 font-display text-xs text-ink/30">O</span>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-display text-xs text-ink/30">E</span>

        {within ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl animate-bounce">🎯</span>
          </div>
        ) : arrowDeg != null ? (
          <div
            className="absolute inset-0 flex items-center justify-center transition-transform duration-200"
            style={{ transform: `rotate(${arrowDeg}deg)` }}
          >
            {/* Flèche vers la cible */}
            <svg width="70" height="120" viewBox="0 0 70 120" aria-hidden>
              <polygon points="35,6 60,58 40,58 40,112 30,112 30,58 10,58" fill="#C0392B" stroke="#111111" strokeWidth="4" strokeLinejoin="round" />
            </svg>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl">🧭</span>
          </div>
        )}
      </div>

      {/* Distance */}
      <p className="font-display text-4xl mt-3 tabular-nums">
        {dist != null ? fmtDist(dist) : "…"}
      </p>
      {within ? (
        <p className="font-bold text-leaf text-sm mt-1">Vous y êtes ! Validez ci-dessous 🎉</p>
      ) : brg != null ? (
        <p className="font-bold text-ink/60 text-sm mt-1">
          {arrowDeg != null
            ? "Tournez jusqu'à ce que la flèche pointe en haut, puis avancez."
            : `Direction : ${cardinal(brg)}`}
          {acc != null && acc > 30 ? " · signal GPS faible, patientez un peu" : ""}
        </p>
      ) : (
        <p className="font-bold text-ink/60 text-sm mt-1">Acquisition du signal GPS…</p>
      )}

      {needIosPerm && (
        <button
          type="button"
          onClick={enableIosCompass}
          className="mt-3 h-10 px-4 rounded-lg border-2 border-ink bg-gold font-bold text-sm"
        >
          🧭 Activer la boussole
        </button>
      )}
      {geoErr && <p className="text-crimson font-bold text-sm mt-2">{geoErr}</p>}
    </div>
  );
}
