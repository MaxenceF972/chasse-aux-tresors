"use client";

import { useEffect } from "react";
import { rpc } from "@/lib/supabase/client";

const MIN_INTERVAL_MS = 12000; // au plus une fois toutes les 12 s
const MIN_MOVE_METERS = 12; // …ou dès 12 m de déplacement

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Partage la position de l'équipe avec l'organisateur (consentement requis).
 * Réactif : haute précision, lissage léger, et remontée dès 12 m / 12 s.
 */
export function useGeoShare(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;

    let last: { lat: number; lng: number; at: number } | null = null;
    // Lissage exponentiel léger : atténue les sauts GPS sans traîner
    let smooth: { lat: number; lng: number } | null = null;

    const report = (rawLat: number, rawLng: number, accuracy: number) => {
      // Ignore les points très imprécis (> 100 m) sauf tout premier fix
      if (accuracy > 100 && smooth) return;

      const alpha = 0.5;
      smooth = smooth
        ? { lat: smooth.lat + alpha * (rawLat - smooth.lat), lng: smooth.lng + alpha * (rawLng - smooth.lng) }
        : { lat: rawLat, lng: rawLng };

      const now = Date.now();
      const moved = last ? distanceMeters(last, smooth) : Infinity;
      if (last && now - last.at < MIN_INTERVAL_MS && moved < MIN_MOVE_METERS) return;

      last = { lat: smooth.lat, lng: smooth.lng, at: now };
      rpc("report_position", { p_lat: smooth.lat, p_lng: smooth.lng }).catch(() => {});
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => report(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 999),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);
}
