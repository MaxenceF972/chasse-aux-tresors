"use client";

import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Player, Team } from "@/lib/types";

interface TeamMapProps {
  players: Player[];
  teams: Team[];
}

/**
 * Carte de suivi des équipes (positions partagées avec consentement).
 * Satellite par défaut (on voit le terrain réel), bascule Plan disponible.
 */
export default function TeamMap({ players, teams }: TeamMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const planLayerRef = useRef<L.TileLayer | null>(null);
  const fittedRef = useRef(false);
  const [view, setView] = useState<"sat" | "plan">("sat");

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
        maxZoom: 19,
      });
      satLayerRef.current = leaflet.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri, Maxar" }
      );
      planLayerRef.current = leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      });
      satLayerRef.current.addTo(map);
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

  function switchView(next: "sat" | "plan") {
    setView(next);
    const map = mapRef.current;
    const sat = satLayerRef.current;
    const plan = planLayerRef.current;
    if (!map || !sat || !plan) return;
    if (next === "sat") {
      map.removeLayer(plan);
      sat.addTo(map);
    } else {
      map.removeLayer(sat);
      plan.addTo(map);
    }
  }

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
      {/* Bascule satellite / plan */}
      <div className="absolute top-2 right-2 z-[600] flex rounded-lg border-2 border-ink overflow-hidden shadow-[2px_2px_0_0_#111111]">
        <button
          type="button"
          onClick={() => switchView("sat")}
          className={`px-2.5 h-9 text-xs font-bold ${view === "sat" ? "bg-gold text-ink" : "bg-white text-ink/60"}`}
        >
          🛰️ Satellite
        </button>
        <button
          type="button"
          onClick={() => switchView("plan")}
          className={`px-2.5 h-9 text-xs font-bold border-l-2 border-ink ${view === "plan" ? "bg-gold text-ink" : "bg-white text-ink/60"}`}
        >
          🗺️ Plan
        </button>
      </div>
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
