"use client";

import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE_OPTIONS, createBaseLayers, switchBaseLayer, type BaseKind } from "@/lib/map/layers";

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
  const layersRef = useRef<Record<BaseKind, L.TileLayer> | null>(null);
  const [view, setView] = useState<BaseKind>("plan");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = (await import("leaflet")).default as unknown as typeof L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        maxZoom: 22,
      });
      layersRef.current = createBaseLayers(leaflet);
      layersRef.current.plan.addTo(map); // plan par défaut : lire les rues
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

  function switchView(next: BaseKind) {
    setView(next);
    if (mapRef.current && layersRef.current) {
      switchBaseLayer(mapRef.current, layersRef.current, next);
    }
  }

  return (
    <div className="relative isolate">
      <div ref={containerRef} className="h-56 rounded-xl border-[3px] border-ink overflow-hidden z-0" />
      <div className="absolute top-2 right-2 z-20 flex rounded-lg border-2 border-ink overflow-hidden shadow-[2px_2px_0_0_#111111]">
        {BASE_OPTIONS.map((opt, i) => (
          <button
            key={opt.kind}
            type="button"
            onClick={() => switchView(opt.kind)}
            className={`px-2 h-8 text-xs font-bold ${i > 0 ? "border-l-2 border-ink" : ""} ${
              view === opt.kind ? "bg-gold text-ink" : "bg-white text-ink/60"
            }`}
          >
            {opt.label.split(" ")[0]}
          </button>
        ))}
      </div>
    </div>
  );
}
