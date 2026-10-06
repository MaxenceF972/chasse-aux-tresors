/**
 * La boussole : cap magnétique, relèvement et distance.
 *
 * Sorti des composants pour être VÉRIFIABLE. Le cap est la seule valeur de
 * l'app qu'on ne peut pas contrôler à l'œil : une flèche qui pointe
 * confortablement à 40° du bon azimut a exactement l'air d'une flèche juste.
 */

import { magvar } from "magvar";

export interface Point {
  lat: number;
  lng: number;
}

/**
 * LA DÉCLINAISON MAGNÉTIQUE, et pourquoi la flèche tombait à côté.
 *
 * `relevementDeg` calcule un relèvement depuis des coordonnées : il est donc
 * dans le NORD VRAI, celui du pôle géographique. Un magnétomètre, lui, montre
 * le NORD MAGNÉTIQUE. Entre les deux il y a un angle — la déclinaison — et il
 * dépend du LIEU : environ −15,5° en Martinique, +2° à Paris, −19,5° à la
 * Réunion (modèle WMM-2025 du NOAA).
 *
 * Soustraire la mauvaise référence, c'est se tromper EN PERMANENCE : à −15,5°,
 * 13 m de côté à 50 m de la cible. On suit la flèche et on arrive à côté de la
 * chose.
 *
 * Une chasse TOYAH peut se jouer n'importe où : la déclinaison se calcule donc
 * au lieu de la cible, par le World Magnetic Model (paquet `magvar`). Elle
 * varie de quelques centièmes de degré par kilomètre, le lieu de la cible
 * vaut celui du joueur.
 */
const cacheDeclinaison = new Map<string, number>();

export function declinaisonDeg(lieu: Point, quand?: Date): number {
  // Arrondi à ~1 km : une boussole recalcule son cap trente fois par seconde,
  // le modèle (douze degrés d'harmoniques) n'a pas à tourner à chaque fois.
  const cle = `${lieu.lat.toFixed(2)},${lieu.lng.toFixed(2)}`;
  if (!quand) {
    const connu = cacheDeclinaison.get(cle);
    if (connu !== undefined) return connu;
  }
  let d = 0;
  try {
    d = magvar(lieu.lat, lieu.lng, 0, quand);
  } catch {
    d = 0; // coordonnées invalides : aucune correction plutôt qu'une correction fausse
  }
  if (!Number.isFinite(d)) d = 0;
  if (!quand) cacheDeclinaison.set(cle, d);
  return d;
}

/** Par rapport à quel Nord une source rend son cap. */
export type ReferenceNord = "magnetique" | "vrai";

export interface CapMesure {
  /** Le cap tel que la source le rend, sans correction. */
  deg: number;
  reference: ReferenceNord;
}

/**
 * iOS rend-il déjà le Nord VRAI ?
 *
 * À TRANCHER SUR LE TERRAIN, et c'est pour ça que c'est une constante nommée
 * et pas une valeur noyée dans le code.
 *
 * La documentation se contredit. Apple décrit `webkitCompassHeading` comme un
 * cap « relative to magnetic north » ; des praticiens mesurent au contraire un
 * cap vrai, au motif que Safari lirait `trueHeading` de CoreLocation, comme
 * l'application Boussole d'Apple. Les deux affirmations circulent, et aucune
 * lecture de documentation ne les départagera.
 *
 * `true` est le choix SANS RÉGRESSION : c'est le comportement historique.
 * Se tromper dans ce sens laisse iOS tel qu'il était ; se tromper dans l'autre
 * ajouterait la déclinaison là où il n'y en avait pas.
 *
 * LA MESURE, deux minutes dehors, loin de tout métal : ouvrir l'application
 * Boussole d'Apple, viser un point fixe, noter le cap ; ouvrir le jeu au même
 * endroit en visant le même point. Écart nul → cette constante est juste.
 * Écart égal à la déclinaison du lieu → la passer à `false`.
 * (Réglages › Boussole › « Utiliser le nord géographique » doit être activé,
 * sinon c'est l'application d'Apple qui montre le nord magnétique.)
 */
export const IOS_REND_LE_NORD_VRAI = true;

/**
 * Le cap ramené au Nord VRAI — celui dans lequel les relèvements sont calculés.
 *
 * C'est la seule fonction qui a le droit d'ajouter la déclinaison, et elle ne
 * l'ajoute qu'à ce qui est magnétique. Une source déjà vraie passe telle
 * quelle : corriger deux fois double l'erreur au lieu de l'annuler.
 */
export function capVrai(mesure: CapMesure, declinaison: number): number {
  return norme360(mesure.deg + (mesure.reference === "magnetique" ? declinaison : 0));
}

/** Distance en mètres (haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Relèvement (°, 0 = Nord, sens horaire) de a vers b. */
export function relevementDeg(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng);
  return norme360((Math.atan2(y, x) * 180) / Math.PI);
}

/**
 * Ramène un angle dans [0, 360).
 *
 * Écrit en deux temps plutôt qu'en `((d % 360) + 360) % 360` : ce raccourci
 * fait un aller-retour par 360 même quand l'angle est déjà bon, et en rapporte
 * une erreur de virgule flottante (137,4° en ressortait à 137,39999999999998).
 */
export function norme360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Écart signé entre deux caps, dans (-180, 180].
 *
 * C'est ce qui empêche la flèche de faire un tour complet en passant de 359°
 * à 1° : sans lui, l'aiguille part dans le mauvais sens sur 358° à chaque
 * franchissement du Nord, et c'est très visible.
 */
export function ecartAngulaire(de: number, vers: number): number {
  return 180 - ((((de - vers) % 360) + 540) % 360);
}

/**
 * Cap depuis un QUATERNION d'orientation absolue (API Generic Sensor).
 *
 * C'est la meilleure source disponible sur le web, et de loin : le système
 * FUSIONNE accéléromètre, gyroscope et magnétomètre, corrige la dérive du
 * gyroscope par le champ magnétique et lisse le magnétomètre par le gyroscope.
 * C'est le même étage de traitement que celui dont se sert la navigation piétonne
 * de Google Maps. `DeviceOrientationEvent`, lui, ne donne que des angles d'Euler,
 * avec le blocage de cardan qui va avec.
 *
 * Le repère de référence est Est-Nord-Haut. Le bord supérieur de l'écran est
 * l'axe +Y ; son image dans le repère terrestre est la 2e colonne de la matrice
 * de rotation du quaternion, soit (2(xy − zw), 1 − 2(x² + z²), 2(yz + xw)).
 * Le cap est l'arc-tangente de ses composantes horizontales.
 */
export function capDepuisQuaternion(q: readonly number[]): CapMesure | null {
  const h = horizontaleEcran(q);
  if (h === null) return null;
  // Le repère terrestre de l'API est Est-Nord-Haut, et son Nord est le Nord
  // MAGNÉTIQUE : ni Chromium ni la couche capteurs d'Android n'appliquent la
  // déclinaison. `referenceFrame` ne règle que la rotation de l'écran.
  return {
    deg: norme360((Math.atan2(h.est, h.nord) * 180) / Math.PI),
    reference: "magnetique",
  };
}

/**
 * Le haut de l'écran est-il assez couché pour donner un cap ?
 *
 * La LONGUEUR de sa projection au sol est la mesure exacte de la fiabilité :
 * elle vaut 1 quand le téléphone est à plat et tend vers 0 quand on le dresse.
 * Même seuil que `capFiable` — environ 70° d'inclinaison.
 */
export function capFiableQuaternion(q: readonly number[]): boolean {
  const h = horizontaleEcran(q);
  if (h === null) return false;
  return Math.hypot(h.est, h.nord) > 0.34;
}

/** Projection au sol du bord supérieur de l'écran, ou null si elle s'annule. */
function horizontaleEcran(
  q: readonly number[]
): { est: number; nord: number } | null {
  if (!q || q.length < 4) return null;
  const [x, y, z, w] = q;
  const est = 2 * (x * y - z * w);
  const nord = 1 - 2 * (x * x + z * z);
  // Seuil numérique, pas physique : à la verticale exacte la projection
  // s'annule et l'arc-tangente ne rendrait que du bruit d'arrondi.
  return Math.hypot(est, nord) < 1e-6 ? null : { est, nord };
}

export interface LectureOrientation {
  alpha?: number | null;
  beta?: number | null;
  gamma?: number | null;
  absolute?: boolean;
  /** iOS : cap déjà compensé en inclinaison par le système. */
  webkitCompassHeading?: number;
}

/**
 * Cap du BORD SUPÉRIEUR du téléphone (0 = Nord, sens horaire), ou null si
 * l'appareil ne sait pas où est le Nord.
 *
 * iOS livre `webkitCompassHeading` : c'est la même valeur que l'application
 * Boussole d'Apple, magnétomètre compensé en inclinaison par le système. On la
 * prend telle quelle.
 *
 * Ailleurs, il faut la calculer. Le repère de l'événement est intrinsèque
 * Z-X'-Y'' : le bord supérieur du téléphone est l'axe +Y de l'appareil, et sa
 * position dans le repère terrestre est la 2e colonne de Rz(α)·Rx(β)·Ry(γ),
 * soit (−sinα·cosβ, cosα·cosβ, sinβ). Sa projection horizontale donne
 *
 *     cap = atan2(−sinα·cosβ, cosα·cosβ)
 *
 * Deux choses en tombent, qui sont exactement les deux défauts de la version
 * naïve `360 − α` :
 *
 *  • le ROULIS (γ) disparaît de l'équation — pencher le téléphone sur le côté
 *    ne fausse rien, ce qui est le comportement attendu d'une boussole ;
 *  • le facteur cosβ CHANGE DE SIGNE quand on bascule le téléphone au-delà de
 *    la verticale (|β| > 90°, écran tourné vers le ciel ou posé face contre
 *    table). `360 − α` renvoyait alors un cap à 180° du vrai — plein Sud pour
 *    plein Nord. Le garder dans l'atan2 corrige ce demi-tour tout seul.
 *
 * Reste une limite PHYSIQUE, pas logicielle : à β proche de ±90° (téléphone
 * tenu droit devant soi), le bord supérieur pointe vers le ciel, sa projection
 * horizontale tend vers zéro et le cap devient indéterminé. C'est le blocage de
 * cardan ; aucune formule n'en sort. `capFiable` sert à le dire au joueur.
 */
export function capDepuisOrientation(
  e: LectureOrientation,
  angleEcran = 0
): CapMesure | null {
  let cap: number | null = null;
  // La RÉFÉRENCE se décide ici, dans la branche qui sait d'où vient le chiffre
  // — pas plus haut, où l'on ne saurait plus laquelle a répondu.
  let reference: ReferenceNord = "magnetique";

  if (typeof e.webkitCompassHeading === "number" && e.webkitCompassHeading >= 0) {
    cap = e.webkitCompassHeading;
    reference = IOS_REND_LE_NORD_VRAI ? "vrai" : "magnetique";
  } else if (e.absolute && typeof e.alpha === "number") {
    const rad = Math.PI / 180;
    const sA = Math.sin(e.alpha * rad);
    const cA = Math.cos(e.alpha * rad);
    // beta absent (rare) : on suppose le téléphone à plat, cosβ = 1.
    const cB = typeof e.beta === "number" ? Math.cos(e.beta * rad) : 1;
    cap = (Math.atan2(-sA * cB, cA * cB) * 180) / Math.PI;
    // `deviceorientationabsolute` est adossé au Nord magnétique, comme le
    // magnétomètre qui le nourrit.
    reference = "magnetique";
  }

  if (cap === null) return null;
  // L'OS fait pivoter le contenu quand on tourne le téléphone : le haut de
  // l'ÉCRAN n'est alors plus le haut de l'APPAREIL. Convention standard.
  // Vérifiée en portrait (angle 0) ; en paysage, à confirmer sur le terrain.
  return { deg: norme360(cap + angleEcran), reference };
}

/**
 * Le cap est-il exploitable ? À plus de 70° d'inclinaison, la projection
 * horizontale du bord supérieur du téléphone est trop courte pour donner une
 * direction stable : mieux vaut demander à le remettre à plat que d'afficher
 * une aiguille qui danse.
 */
export function capFiable(beta: number | null | undefined): boolean {
  if (typeof beta !== "number") return true;
  return Math.abs(Math.cos(beta * (Math.PI / 180))) > 0.34; // ≈ |β| < 70°
}

/**
 * Le relèvement a-t-il encore un sens ?
 *
 * De près, non. Le GPS d'un téléphone est précis à 5–20 m à ciel ouvert, bien
 * moins sous un toit : à 6 m du but, la direction calculée est du bruit, et
 * l'aiguille tourne comme une girouette. Les applications qui font ça bien
 * (Apple, les traceurs Bluetooth) cessent alors d'indiquer une direction et
 * disent simplement de chercher sur place — c'est plus honnête et plus utile.
 */
export function relevementUtile(distance: number, precisionGps: number | null): boolean {
  return distance > Math.max(10, (precisionGps ?? 0) * 0.8);
}

const CARDINAUX = [
  "Nord", "Nord-Est", "Est", "Sud-Est",
  "Sud", "Sud-Ouest", "Ouest", "Nord-Ouest",
];

export function cardinal(deg: number): string {
  return CARDINAUX[Math.round(norme360(deg) / 45) % 8];
}

export function formatDistance(d: number): string {
  if (d >= 1000) return `${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km`;
  return `${Math.round(d)} m`;
}
