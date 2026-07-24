import type * as L from "leaflet";

/**
 * Fonds de carte partagés par toutes les cartes de l'app.
 * - plan : OpenStreetMap (noms de rues, navigation)
 * - hd   : orthophotos IGN Géoplateforme (~20 cm, France + DOM dont la
 *          Martinique) — gratuit, sans clé, souvent plus net que Google ici
 * - sat  : Esri World Imagery (couverture mondiale, secours hors France)
 * maxNativeZoom 19 + maxZoom 22 : au-delà de 19, Leaflet agrandit les tuiles
 * (sur-zoom) — image moins nette mais on peut viser un muret précis.
 */
export type BaseKind = "plan" | "hd" | "sat";

export const BASE_OPTIONS: Array<{ kind: BaseKind; label: string }> = [
  { kind: "plan", label: "🗺️ Plan" },
  { kind: "hd", label: "🛰️ HD" },
  { kind: "sat", label: "🌍 Monde" },
];

export function createBaseLayers(leaflet: typeof L): Record<BaseKind, L.TileLayer> {
  return {
    plan: leaflet.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: "© OpenStreetMap",
    }),
    hd: leaflet.tileLayer(
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
        "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
      { maxZoom: 22, maxNativeZoom: 19, attribution: "© IGN Géoplateforme" }
    ),
    sat: leaflet.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 22, maxNativeZoom: 19, attribution: "© Esri, Maxar" }
    ),
  };
}

/** Bascule le fond affiché (retire les autres, ajoute celui demandé). */
export function switchBaseLayer(
  map: L.Map,
  layers: Record<BaseKind, L.TileLayer>,
  next: BaseKind
) {
  (Object.keys(layers) as BaseKind[]).forEach((k) => {
    if (k !== next && map.hasLayer(layers[k])) map.removeLayer(layers[k]);
  });
  layers[next].addTo(map);
}
