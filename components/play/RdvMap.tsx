"use client";

import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";

interface RdvMapProps {
  lat: number;
  lng: number;
}

/**
 * Carte du point de rendez-vous intégrée à l'écran joueur : le lieu est
 * visible directement (pin doré pulsant), sans quitter l'app. Bascule
 * Plan/Satellite, lien itinéraire en secours.
 */
export default function RdvMap({ lat, lng }: RdvMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const satLayerRef = useRef<L.TileLayer | null>(null);
  const planLayerRef = useRef<L.TileLayer | null>(null);
  const [view, setView] = useState<"plan" | "sat">("plan");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = (await import("leaflet")).default as unknown as typeof L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        maxZoom: 19,
      });
      planLayerRef.current = leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      });
      satLayerRef.current = leaflet.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, attribution: "© Esri, Maxar" }
      );
      planLayerRef.current.addTo(map);
      map.setView([lat, lng], 16);
      leaflet
        .circleMarker([lat, lng], {
          radius: 11,
          color: "#111111",
          weight: 3,
          fillColor: "#F5A623",
          fillOpacity: 0.95,
        })
        .addTo(map);
      leaflet
        .circle([lat, lng], {
          radius: 25,
          color: "#C0392B",
          weight: 2,
          fillColor: "#C0392B",
          fillOpacity: 0.15,
        })
        .addTo(map);
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 60);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng]);

  function switchView(next: "plan" | "sat") {
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

  return (
    <div className="relative">
      <div ref={containerRef} className="h-56 rounded-xl border-[3px] border-ink overflow-hidden z-0" />
      <div className="absolute top-2 right-2 z-[1000] flex rounded-lg border-2 border-ink overflow-hidden shadow-[2px_2px_0_0_#111111]">
        <button
          type="button"
          onClick={() => switchView("plan")}
          className={`px-2 h-8 text-xs font-bold ${view === "plan" ? "bg-gold text-ink" : "bg-white text-ink/60"}`}
        >
          🗺️
        </button>
        <button
          type="button"
          onClick={() => switchView("sat")}
          className={`px-2 h-8 text-xs font-bold border-l-2 border-ink ${view === "sat" ? "bg-gold text-ink" : "bg-white text-ink/60"}`}
        >
          🛰️
        </button>
      </div>
    </div>
  );
}
