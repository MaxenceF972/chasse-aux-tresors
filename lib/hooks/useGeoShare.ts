"use client";

import { useEffect } from "react";
import { rpc } from "@/lib/supabase/client";
import { showToast } from "@/components/ui/Toaster";

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
 * Économe : le suivi est suspendu quand l'app passe en arrière-plan.
 */
export function useGeoShare(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;

    let last: { lat: number; lng: number; at: number } | null = null;
    // Lissage exponentiel léger : atténue les sauts GPS sans traîner
    let smooth: { lat: number; lng: number } | null = null;
    let deniedNotified = false;

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

    let watchId: number | null = null;

    const start = () => {
      if (watchId != null) return;
      watchId = navigator.geolocation.watchPosition(
        (pos) => report(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 999),
        (err) => {
          // Permission refusée au niveau du téléphone : sans message, l'équipe
          // croit partager sa position alors que l'organisateur ne voit rien.
          if (err.code === err.PERMISSION_DENIED && !deniedNotified) {
            deniedNotified = true;
            showToast(
              "📍 Position bloquée par le téléphone. Pour que l'organisateur te voie sur la carte, autorise la localisation dans les réglages du navigateur, puis réactive le partage dans le menu ☰.",
              "error"
            );
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      );
    };
    const stop = () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
    };
    // Écran verrouillé / app en arrière-plan → on coupe le GPS (batterie)
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
