"use client";

import { useEffect } from "react";
import { rpc } from "@/lib/supabase/client";

const MIN_INTERVAL_MS = 40000;
const MIN_MOVE_METERS = 40;

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
 * Throttlé : au plus toutes les 40 s, ou après 40 m de déplacement.
 */
export function useGeoShare(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;

    let last: { lat: number; lng: number; at: number } | null = null;

    const report = (lat: number, lng: number) => {
      const now = Date.now();
      if (
        last &&
        now - last.at < MIN_INTERVAL_MS &&
        distanceMeters(last, { lat, lng }) < MIN_MOVE_METERS
      ) {
        return;
      }
      last = { lat, lng, at: now };
      rpc("report_position", { p_lat: lat, p_lng: lng }).catch(() => {});
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => report(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [enabled]);
}
