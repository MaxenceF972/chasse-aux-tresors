"use client";

import { useEffect, useRef, useState } from "react";
import type * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { BASE_OPTIONS, createBaseLayers, switchBaseLayer, type BaseKind } from "@/lib/map/layers";
import Button from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

interface MapPickerProps {
  /** Coordonnées actuelles (pin affiché) — null si rien de choisi */
  lat: number | null;
  lng: number | null;
  onPick: (lat: number, lng: number) => void;
}

/**
 * Choisir un point sans être sur place : recherche de lieu (Nominatim/OSM)
 * puis clic sur la carte pour poser/ajuster le pin. Vue satellite par défaut
 * (imagerie Esri) pour viser précisément — bascule Plan disponible.
 */
export default function MapPicker({ lat, lng, onPick }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);
  const leafletRef = useRef<typeof L | null>(null);
  const layersRef = useRef<Record<BaseKind, L.TileLayer> | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const [view, setView] = useState<BaseKind>("hd");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  function placeMarker(la: number, ln: number) {
    const leaflet = leafletRef.current;
    const map = mapRef.current;
    if (!leaflet || !map) return;
    if (markerRef.current) markerRef.current.setLatLng([la, ln]);
    else {
      markerRef.current = leaflet
        .circleMarker([la, ln], {
          radius: 10,
          color: "#111111",
          weight: 3,
          fillColor: "#C0392B",
          fillOpacity: 0.95,
        })
        .addTo(map);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaflet = (await import("leaflet")).default as unknown as typeof L;
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = leaflet;
      const map = leaflet.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
        maxZoom: 22, // sur-zoom au-delà des tuiles natives : on vise au mètre
      });
      layersRef.current = createBaseLayers(leaflet);
      layersRef.current.hd.addTo(map); // orthophotos IGN HD par défaut
      mapRef.current = map;

      if (lat != null && lng != null) {
        map.setView([lat, lng], 18);
        placeMarker(lat, lng);
      } else {
        map.setView([46.6, 2.4], 5); // France par défaut
        // Best effort : centre sur la position de l'organisateur
        navigator.geolocation?.getCurrentPosition(
          (pos) => {
            if (!cancelled && mapRef.current && !markerRef.current) {
              mapRef.current.setView([pos.coords.latitude, pos.coords.longitude], 16);
            }
          },
          () => {},
          { timeout: 8000, maximumAge: 60000 }
        );
      }

      map.on("click", (e: L.LeafletMouseEvent) => {
        placeMarker(e.latlng.lat, e.latlng.lng);
        onPickRef.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)));
      });

      // Le bloc vient de se déplier : Leaflet doit recalculer sa taille
      setTimeout(() => map.invalidateSize(), 60);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coordonnées modifiées pendant que la carte est ouverte (collage, « ma
  // position »…) → on recale le pin et la vue.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || lat == null || lng == null) return;
    const current = markerRef.current?.getLatLng();
    if (current && Math.abs(current.lat - lat) < 1e-9 && Math.abs(current.lng - lng) < 1e-9) return;
    placeMarker(lat, lng);
    map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }, [lat, lng]);

  function switchView(next: BaseKind) {
    setView(next);
    if (mapRef.current && layersRef.current) {
      switchBaseLayer(mapRef.current, layersRef.current, next);
    }
  }

  async function search() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(q)}`,
        { headers: { Accept: "application/json" } }
      );
      const results = (await res.json()) as { lat: string; lon: string }[];
      if (!results.length) {
        setSearchError("Lieu introuvable — précise (nom + ville, ou une adresse).");
        return;
      }
      const la = Number(results[0].lat);
      const ln = Number(results[0].lon);
      mapRef.current?.setView([la, ln], 18);
      placeMarker(la, ln);
      onPickRef.current(Number(la.toFixed(6)), Number(ln.toFixed(6)));
    } catch {
      setSearchError("Recherche impossible — vérifie ta connexion.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un lieu (ex : fontaine Gueydon Fort-de-France)"
          enterKeyHint="search"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search();
            }
          }}
        />
        <Button variant="parchment" onClick={() => void search()} disabled={searching || !query.trim()}>
          {searching ? "…" : "🔎"}
        </Button>
      </div>
      {searchError && <p className="text-crimson font-bold text-xs">{searchError}</p>}
      <div className="relative isolate">
        <div ref={containerRef} className="h-72 rounded-xl border-[3px] border-ink overflow-hidden z-0" />
        {/* Bascule de fond de carte, par-dessus la carte */}
        <div className="absolute top-2 right-2 z-20 flex rounded-lg border-2 border-ink overflow-hidden shadow-[2px_2px_0_0_#111111]">
          {BASE_OPTIONS.map((opt, i) => (
            <button
              key={opt.kind}
              type="button"
              onClick={() => switchView(opt.kind)}
              className={`px-2 h-9 text-xs font-bold ${i > 0 ? "border-l-2 border-ink" : ""} ${
                view === opt.kind ? "bg-gold text-ink" : "bg-white text-ink/60"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs font-bold text-ink/55">
        Zoome jusqu&apos;à voir les toits puis touche la carte pour poser (ou déplacer) le point
        📍 — les coordonnées se remplissent toutes seules.
      </p>
    </div>
  );
}
