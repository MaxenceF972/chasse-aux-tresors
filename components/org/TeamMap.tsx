"use client";

import { useEffect, useRef } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Player, Team } from "@/lib/types";

interface TeamMapProps {
  players: Player[];
  teams: Team[];
}

/**
 * Carte de suivi des équipes (positions partagées avec consentement).
 * Leaflet + tuiles OpenStreetMap, marqueurs aux couleurs des équipes.
 */
export default function TeamMap({ players, teams }: TeamMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const fittedRef = useRef(false);

  const positioned = players.filter((p) => p.last_lat != null && p.last_lng != null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = (await import("leaflet")).default as unknown as typeof L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      });
      leaflet
        .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        })
        .addTo(map);
      map.setView([46.6, 2.4], 5); // France par défaut, recentré dès la 1re position
      layerRef.current = leaflet.layerGroup().addTo(map);
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  // Met à jour les marqueurs à chaque rafraîchissement des positions
  useEffect(() => {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!leaflet || !map || !layer) return;

    layer.clearLayers();
    const teamMap = new Map(teams.map((t) => [t.id, t]));
    const bounds: [number, number][] = [];

    for (const p of positioned) {
      const team = teamMap.get(p.team_id);
      const ageMin = p.pos_updated_at
        ? Math.round((Date.now() - new Date(p.pos_updated_at).getTime()) / 60000)
        : null;
      const stale = ageMin != null && ageMin > 5;
      const marker = leaflet.circleMarker([p.last_lat!, p.last_lng!], {
        radius: 9,
        color: "#111111",
        weight: 2,
        fillColor: team?.color ?? "#F5A623",
        fillOpacity: stale ? 0.35 : 0.95,
      });
      marker.bindPopup(
        `<b>${team?.name ?? "?"}</b><br/>${p.nickname}<br/>` +
          (ageMin != null ? `il y a ${ageMin < 1 ? "moins d'1" : ageMin} min` : "")
      );
      marker.addTo(layer);
      bounds.push([p.last_lat!, p.last_lng!]);
    }

    if (bounds.length && !fittedRef.current) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
      fittedRef.current = true;
    }
  }, [positioned, teams]);

  // Le conteneur doit TOUJOURS être rendu : l'init Leaflet ne tourne qu'au
  // montage — s'il n'existait pas tant qu'aucune position n'était partagée,
  // la carte restait vide pour toute la partie.
  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-80 rounded-2xl border-[3px] border-ink overflow-hidden z-0"
      />
      {!positioned.length && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center rounded-2xl bg-ink/60 px-6 text-center">
          <p className="font-bold text-parchment/90 text-sm">
            📍 Aucune position partagée pour l&apos;instant — les joueurs doivent accepter le
            partage de position sur leur écran de jeu.
          </p>
        </div>
      )}
    </div>
  );
}
