/**
 * Les demandes d'autorisation, à un seul endroit.
 *
 * Elles étaient éparpillées : le briefing du lobby demandait la position, la
 * boussole demandait l'orientation en pleine épreuve, un bandeau demandait le
 * partage de position par-dessus l'énigme en cours. Résultat, une fenêtre
 * système du téléphone tombait au milieu du jeu, sans rien pour l'annoncer —
 * et une fenêtre système qui cite l'adresse du site entre guillemets, ça se
 * lit comme un lien piégé, pas comme une question.
 *
 * Règle du projet, désormais : **une autorisation ne se demande que depuis
 * l'écran de vérification**, qui prévient avant. Partout ailleurs, on lit ce
 * qui a déjà été accordé, et on ne demande rien.
 *
 * Le résultat de la demande d'orientation est mémorisé pour cette raison
 * précise : sur iPhone, `requestPermission()` exige un appui de l'utilisateur.
 * Sans mémoire, chaque étape de boussole devrait le redemander — et le
 * redemander, c'est refaire tomber la fenêtre.
 */

import { getPref, setPref } from "@/lib/game/prefs";

export type Reponse = "ok" | "refus" | "absent";

/* ------------------------------------------------------------------ position */

export interface LecturePosition {
  etat: Reponse;
  cause?: "refus" | "introuvable" | "absent";
  /** Rayon d'incertitude en mètres, tel que le donne le téléphone. */
  precisionM?: number;
}

/** Demande la position — DÉCLENCHE la fenêtre système si elle n'a jamais été posée. */
export function demanderPosition(): Promise<LecturePosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ etat: "absent", cause: "absent" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      // Rien n'est mémorisé ici : l'autorisation du navigateur se RELIT
      // (`etatPositionSansDemander`), elle ne se recopie pas. Le consentement
      // à être suivi par l'organisateur est une AUTRE question, posée à part
      // (clé `partage`, voir `Pref` dans lib/game/prefs.ts).
      (p) => resolve({ etat: "ok", precisionM: p.coords.accuracy ?? undefined }),
      (err) => {
        const refus = err.code === err.PERMISSION_DENIED;
        resolve({ etat: refus ? "refus" : "absent", cause: refus ? "refus" : "introuvable" });
      },
      // Généreux à dessein : cette demande se fait à l'arrêt, au départ, et un
      // premier point GPS sous un toit peut demander plus de dix secondes.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

/**
 * L'état de la position SANS rien demander, quand le navigateur veut bien le
 * dire (Permissions API). Safari ne répond pas toujours : « inconnu » est une
 * réponse normale, pas un échec.
 */
export async function etatPositionSansDemander(): Promise<"ok" | "refus" | "inconnu"> {
  if (typeof navigator === "undefined" || !navigator.permissions) return "inconnu";
  try {
    const res = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    if (res.state === "granted") return "ok";
    if (res.state === "denied") return "refus";
    return "inconnu";
  } catch {
    return "inconnu";
  }
}

/* ----------------------------------------------------------------- boussole */

interface DOEavecPermission {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

function doe(): DOEavecPermission | undefined {
  if (typeof window === "undefined") return undefined;
  return window.DeviceOrientationEvent as unknown as DOEavecPermission | undefined;
}

/** iPhone : l'orientation n'arrive qu'après un appui explicite de l'utilisateur. */
export function orientationDemandeGeste(): boolean {
  return typeof doe()?.requestPermission === "function";
}

/** Ce que l'utilisateur a déjà répondu, lors d'une vérification précédente. */
export function orientationAccordee(): boolean {
  return getPref("orientation") === "granted";
}

/**
 * Demande l'orientation. À n'appeler QUE depuis un gestionnaire d'appui : hors
 * geste, Safari rejette la promesse — ce qui, au moins, rend impossible une
 * fenêtre surprise.
 */
export async function demanderOrientation(): Promise<Reponse> {
  const d = doe();
  if (!d) return "absent";
  if (typeof d.requestPermission !== "function") {
    // Android et ordinateurs : pas d'autorisation à donner, reste à savoir si
    // un magnétomètre répond.
    return (await capteurRepond()) ? "ok" : "absent";
  }
  try {
    const rep = await d.requestPermission();
    if (rep !== "granted") {
      setPref("orientation", "denied");
      return "refus";
    }
    setPref("orientation", "granted");
    return (await capteurRepond()) ? "ok" : "absent";
  } catch {
    return "refus";
  }
}

/**
 * Un capteur branché est un capteur qui parle : on écoute, et s'il ne dit rien
 * en une seconde et demie, c'est qu'il n'y en a pas. Aucun navigateur
 * n'expose « ce téléphone a-t-il un magnétomètre » ; l'écoute est la seule
 * réponse honnête.
 */
export function capteurRepond(delaiMs = 1500): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  const Senseur = (window as unknown as { AbsoluteOrientationSensor?: unknown })
    .AbsoluteOrientationSensor;
  if (Senseur) return Promise.resolve(true);

  return new Promise((resolve) => {
    let fini = false;
    const finir = (v: boolean) => {
      if (fini) return;
      fini = true;
      window.removeEventListener("deviceorientationabsolute", ecoute, true);
      window.removeEventListener("deviceorientation", ecoute, true);
      clearTimeout(minuteur);
      resolve(v);
    };
    const ecoute = (e: Event) => {
      const o = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const utile =
        typeof o.webkitCompassHeading === "number" || (o.absolute && typeof o.alpha === "number");
      if (utile) finir(true);
    };
    const minuteur = setTimeout(() => finir(false), delaiMs);
    window.addEventListener("deviceorientationabsolute", ecoute, true);
    window.addEventListener("deviceorientation", ecoute, true);
  });
}

/* ------------------------------------------------------- réseau, mémoire, photo */

export function enLigne(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Navigation privée : sur iPhone, le stockage local existe mais meurt avec
 * l'onglet ; ailleurs, l'écriture lève. On teste ce qui compte — écrire, puis
 * relire.
 */
export function memoireDisponible(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const cle = "toyah:sonde";
    localStorage.setItem(cle, "1");
    const lu = localStorage.getItem(cle) === "1";
    localStorage.removeItem(cle);
    return lu;
  } catch {
    return false;
  }
}

/**
 * L'appareil photo passe par un champ de fichier `capture`, pas par
 * getUserMedia : c'est le sélecteur natif du système qui s'ouvre, il ne
 * demande donc AUCUNE autorisation web. Rien à préparer — seulement à savoir
 * si le navigateur connaît l'attribut.
 */
export function photoDisponible(): boolean {
  if (typeof document === "undefined") return true;
  return "capture" in document.createElement("input");
}

/**
 * La lecture des balises par le navigateur (Web NFC). Chromium sur Android
 * seulement — et ce n'est PAS un manque sur iPhone, où c'est le système qui
 * lit la balise et ouvre le lien tout seul, sans passer par la page.
 */
export function nfcDisponible(): boolean {
  if (typeof window === "undefined") return false;
  return "NDEFReader" in window;
}
