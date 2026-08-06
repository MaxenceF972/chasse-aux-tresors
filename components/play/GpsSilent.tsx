"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { rpc } from "@/lib/supabase/client";

interface GpsSilentProps {
  stepId: string;
  /** Dernière position connue remontée au parent (pour la validation serveur) */
  onPosition: (lat: number, lng: number) => void;
  /** Appelé UNE fois à l'entrée dans le rayon (le composant re-arme à la sortie) */
  onWithin: (lat: number, lng: number) => void;
}

interface PingResult {
  ok: boolean;
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

/**
 * Mode « aucun indice » : suit la position et interroge le serveur en silence.
 * Ni flèche, ni distance, ni thermomètre — le serveur ne répond d'ailleurs que
 * « sur place ou pas ». C'est l'énigme qui mène au lieu ; l'arrivée valide
 * toute seule.
 */
export default function GpsSilent({ stepId, onPosition, onWithin }: GpsSilentProps) {
  const [tracking, setTracking] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  // RPC gps_ping injoignable (SQL pas ré-appliqué, réseau coupé) : repli manuel
  const [softErr, setSoftErr] = useState(false);

  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const onWithinRef = useRef(onWithin);
  onWithinRef.current = onWithin;

  const mountedRef = useRef(true);
  const pingingRef = useRef(false);
  const lastPingAtRef = useRef(0);
  const lastSelfRef = useRef<{ lat: number; lng: number } | null>(null);
  const wasWithinRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    async function ping(lat: number, lng: number, at: number) {
      pingingRef.current = true;
      lastPingAtRef.current = at;
      lastSelfRef.current = { lat, lng };
      try {
        const res = await rpc<PingResult>("gps_ping", { p_step_id: stepId, p_lat: lat, p_lng: lng });
        if (!mountedRef.current || !res.ok) return;
        setSoftErr(false);
        if (res.within) {
          if (!wasWithinRef.current) {
            wasWithinRef.current = true;
            onWithinRef.current(lat, lng);
          }
        } else {
          wasWithinRef.current = false;
        }
      } catch {
        if (mountedRef.current) setSoftErr(true);
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
        setTracking(true);
        setGeoErr(null);
        onPositionRef.current(lat, lng);

        // Cadence discrète : rien à afficher, on vérifie l'arrivée dès ~10 m
        // parcourus (ou toutes les 8 s max), jamais plus vite que toutes les 3 s.
        const now = Date.now();
        if (pingingRef.current) return;
        const gap = now - lastPingAtRef.current;
        if (gap < 3000) return;
        const moved =
          !lastSelfRef.current || selfDistance(lastSelfRef.current, { lat, lng }) >= 10;
        if (moved || gap >= 8000) void ping(lat, lng, now);
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

  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white/70 p-4 text-center">
      <motion.div
        className="mx-auto w-28 h-28 rounded-full border-[3px] border-ink bg-ink flex items-center justify-center"
        animate={{ scale: tracking ? [1, 1.06, 1] : 1 }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      >
        <span className="text-5xl select-none" aria-hidden>
          {tracking ? "🤫" : "📡"}
        </span>
      </motion.div>
      <p className="font-display text-xl mt-3">LIEU MYSTÈRE</p>
      <p className="font-bold text-ink/60 text-sm mt-1">
        {softErr
          ? "Vérification automatique indisponible — une fois sur place, appuie sur « On est sur place ! »."
          : tracking
            ? "Aucun indice ne viendra : à vous de trouver le lieu. Une fois dessus, la validation se fait toute seule."
            : "Acquisition du signal GPS…"}
      </p>
      {geoErr && <p className="text-crimson font-bold text-sm mt-2">{geoErr}</p>}
    </div>
  );
}
