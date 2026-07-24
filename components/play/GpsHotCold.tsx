"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { rpc } from "@/lib/supabase/client";
import { haptics } from "@/lib/game/haptics";
import { tone } from "@/lib/game/sounds";

interface GpsHotColdProps {
  stepId: string;
  /** Dernière position connue remontée au parent (pour la validation serveur) */
  onPosition: (lat: number, lng: number) => void;
  /** Appelé UNE fois à l'entrée dans le rayon (le composant re-arme à la sortie) */
  onWithin: (lat: number, lng: number) => void;
}

interface PingResult {
  ok: boolean;
  distance_m?: number;
  radius?: number;
  within?: boolean;
  error?: string;
}

/** Distance en mètres entre deux points GPS (haversine) — pour nos propres pas. */
function selfDistance(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function fmtDist(d: number): string {
  if (d >= 1000) return `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`;
  return `${Math.round(d)} m`;
}

// Paliers thermiques, du plus froid au plus chaud : couleur + intitulé + emoji.
const TIERS = [
  { label: "GLACIAL", emoji: "🧊", color: "#1B4F72", grad: ["#7FB3D5", "#1B4F72"] },
  { label: "FROID", emoji: "❄️", color: "#2471A3", grad: ["#85C1E9", "#21618C"] },
  { label: "FRAIS", emoji: "🙂", color: "#17A589", grad: ["#A3E4D7", "#148F77"] },
  { label: "TIÈDE", emoji: "🌤️", color: "#D4AC0D", grad: ["#F7DC6F", "#B7950B"] },
  { label: "CHAUD", emoji: "🔥", color: "#CA6F1E", grad: ["#F5B041", "#AF601A"] },
  { label: "TRÈS CHAUD", emoji: "🔥🔥", color: "#BA4A00", grad: ["#EB984E", "#9C3400"] },
  { label: "BRÛLANT", emoji: "🔥🔥🔥", color: "#C0392B", grad: ["#EC7063", "#7B241C"] },
] as const;

/** Palier (0 = glacial … 6 = brûlant) selon la distance restante. */
function heatIndex(dist: number): number {
  if (dist <= 20) return 6;
  if (dist <= 40) return 5;
  if (dist <= 75) return 4;
  if (dist <= 150) return 3;
  if (dist <= 300) return 2;
  if (dist <= 600) return 1;
  return 0;
}

/**
 * Thermomètre « chaud / froid » : suit la position en continu, interroge le
 * serveur (sans révéler la cible) et indique de plus en plus fort à mesure que
 * l'équipe s'approche — palier coloré, jauge qui se remplit, tendance
 * chaud/froid, distance en clair et vibration/son à chaque palier gagné.
 */
export default function GpsHotCold({ stepId, onPosition, onWithin }: GpsHotColdProps) {
  const [dist, setDist] = useState<number | null>(null);
  const [within, setWithin] = useState(false);
  const [trend, setTrend] = useState<"up" | "down" | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);

  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const onWithinRef = useRef(onWithin);
  onWithinRef.current = onWithin;

  const mountedRef = useRef(true);
  const pingingRef = useRef(false);
  const lastPingAtRef = useRef(0);
  const lastSelfRef = useRef<{ lat: number; lng: number } | null>(null);
  const prevDistRef = useRef<number | null>(null);
  const lastIdxRef = useRef<number>(-1);
  const wasWithinRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    async function ping(lat: number, lng: number, at: number) {
      pingingRef.current = true;
      lastPingAtRef.current = at;
      lastSelfRef.current = { lat, lng };
      try {
        const res = await rpc<PingResult>("gps_ping", { p_step_id: stepId, p_lat: lat, p_lng: lng });
        if (!mountedRef.current || !res.ok || res.distance_m == null) return;
        const d = res.distance_m;
        setDist(d);
        setGeoErr(null);

        const isWithin = !!res.within;
        setWithin(isWithin);

        // Tendance (rapprochement / éloignement) avec zone morte anti-bruit GPS
        if (prevDistRef.current != null) {
          const delta = d - prevDistRef.current;
          if (delta < -3) setTrend("up");
          else if (delta > 3) setTrend("down");
        }
        prevDistRef.current = d;

        // Palier franchi vers le chaud → retour haptique + blip de plus en plus aigu
        const idx = isWithin ? 7 : heatIndex(d);
        if (idx > lastIdxRef.current && lastIdxRef.current >= 0) {
          haptics.tap();
          tone(320 + idx * 90, 0.09, "square", 0.08);
        }
        lastIdxRef.current = idx;

        // Entrée dans le rayon : on prévient le parent une seule fois
        if (isWithin) {
          if (!wasWithinRef.current) {
            wasWithinRef.current = true;
            onWithinRef.current(lat, lng);
          }
        } else {
          wasWithinRef.current = false;
        }
      } finally {
        pingingRef.current = false;
      }
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoErr("Pas de GPS sur ce téléphone.");
      return;
    }

    const id = navigator.geolocation.watchPosition(
      (p) => {
        const lat = p.coords.latitude;
        const lng = p.coords.longitude;
        setAcc(p.coords.accuracy ?? null);
        onPositionRef.current(lat, lng);

        // Cadence des pings : au moins 1,5 s d'écart, puis dès ~5 m parcourus
        // (ou 3 s max) → distance vivante sans marteler le serveur.
        const now = Date.now();
        if (pingingRef.current) return;
        const gap = now - lastPingAtRef.current;
        if (gap < 1500) return;
        const moved =
          !lastSelfRef.current || selfDistance(lastSelfRef.current, { lat, lng }) >= 5;
        if (moved || gap >= 3000) void ping(lat, lng, now);
      },
      (err) =>
        setGeoErr(
          err.code === err.PERMISSION_DENIED
            ? "Localisation refusée — autorise-la dans les réglages."
            : "Position introuvable — sors à découvert et patiente."
        ),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => {
      mountedRef.current = false;
      navigator.geolocation.clearWatch(id);
    };
  }, [stepId]);

  const ready = dist != null && !geoErr;
  const idx = dist == null ? 0 : heatIndex(dist);
  const tier = TIERS[idx];
  // Plus c'est chaud, plus le cœur pulse vite (indicateur « de plus en plus fort »)
  const pulseDur = within ? 0.5 : 2.3 - idx * 0.28;

  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white/70 p-4 text-center">
      {/* Cœur thermique pulsant */}
      <div className="relative mx-auto w-44 h-44">
        <motion.div
          className="absolute inset-0 rounded-full border-[3px] border-ink flex flex-col items-center justify-center"
          style={{
            background: within
              ? "radial-gradient(circle at 50% 38%, #7DCEA0, #1E8449)"
              : ready
                ? `radial-gradient(circle at 50% 38%, ${tier.grad[0]}, ${tier.grad[1]})`
                : "radial-gradient(circle at 50% 38%, #EDE0C4, #B7A98A)",
          }}
          animate={{ scale: ready || within ? [1, 1.05, 1] : 1 }}
          transition={{ duration: pulseDur, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="text-5xl leading-none">{within ? "🎯" : ready ? tier.emoji : "📡"}</span>
          <span className="font-display text-lg text-parchment text-cartoon-outline mt-1.5">
            {within ? "TROUVÉ" : ready ? tier.label : "SIGNAL…"}
          </span>
        </motion.div>
      </div>

      {/* Distance */}
      <p className="font-display text-4xl mt-3 tabular-nums">{dist != null ? fmtDist(dist) : "…"}</p>

      {/* Jauge segmentée : monte avec la chaleur */}
      <div className="flex items-end justify-center gap-1 mt-2 h-8" aria-hidden>
        {TIERS.map((t, i) => (
          <span
            key={t.label}
            className="w-4 rounded-sm border-2 border-ink transition-colors"
            style={{
              height: `${10 + i * 3}px`,
              backgroundColor: ready && !within && i <= idx ? t.color : within ? "#1E8449" : "#00000014",
            }}
          />
        ))}
      </div>

      {/* Tendance chaud / froid */}
      {within ? (
        <p className="font-bold text-leaf text-sm mt-2">Vous y êtes ! Validez ci-dessous 🎉</p>
      ) : ready ? (
        <p
          className="font-bold text-sm mt-2"
          style={{ color: trend === "up" ? "#C0392B" : trend === "down" ? "#2471A3" : "#6b6b6b" }}
        >
          {trend === "up"
            ? "🔥 Ça chauffe — vous vous rapprochez !"
            : trend === "down"
              ? "🧊 Ça refroidit — vous vous éloignez"
              : "Déplacez-vous : le thermomètre vous guide"}
          {acc != null && acc > 30 ? " · signal GPS faible" : ""}
        </p>
      ) : (
        <p className="font-bold text-ink/60 text-sm mt-2">Acquisition du signal GPS…</p>
      )}

      {geoErr && <p className="text-crimson font-bold text-sm mt-2">{geoErr}</p>}
    </div>
  );
}
