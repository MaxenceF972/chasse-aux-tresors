"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import GeoManquante, { PositionApproximative } from "@/components/play/GeoManquante";
import { plateforme, remedeBoussole, type Plateforme } from "@/lib/game/diagnostic";
import {
  demanderOrientation,
  orientationAccordee,
  orientationDemandeGeste,
} from "@/lib/game/permissions";
import {
  capDepuisOrientation,
  capDepuisQuaternion,
  capFiable,
  capFiableQuaternion,
  capVrai,
  cardinal,
  declinaisonDeg,
  distanceM,
  ecartAngulaire,
  formatDistance,
  norme360,
  relevementDeg,
  relevementUtile,
  type LectureOrientation,
} from "@/lib/game/boussole";

interface GpsCompassProps {
  target: { lat: number; lng: number; radius: number };
  /** Position live remontée au parent (pour la validation serveur) */
  onUpdate: (lat: number, lng: number, distanceM: number) => void;
  /** Message d'arrivée — différent quand la boussole ne fait que guider */
  withinLabel?: string;
  /**
   * Cacher le compte de mètres : la flèche seule.
   *
   * Le nombre change la nature du jeu. Avec lui on regarde l'écran descendre
   * — 84, 71, 60 — et l'on marche à l'estime, tête baissée ; on sait quand
   * s'arrêter sans avoir rien cherché. Sans lui, il reste une DIRECTION, ce
   * qui est exactement ce qu'une boussole donne, et le lieu se trouve en
   * levant les yeux.
   *
   * Ce qui reste dit, et qui doit le rester : l'acquisition du signal, et
   * l'approche finale sous dix mètres. Ce ne sont pas des mesures mais les
   * deux moments où le cadran CESSE DE RÉPONDRE — les taire donnerait un
   * écran en panne.
   */
  sansDistance?: boolean;
}

/** Lissage du cap : 0 = figé, 1 = brut. Le magnétomètre est bruité. */
const LISSAGE = 0.22;

/** Au-delà, iOS considère lui-même son magnétomètre déréglé (degrés). */
const CALIBRAGE_DOUTEUX = 20;

/** Au-delà, la position ne désigne plus un lieu : voir GeoManquante. */
const PRECISION_INUTILISABLE_M = 1000;

interface EvtOrientation extends Event, LectureOrientation {
  webkitCompassAccuracy?: number;
}

/**
 * L'API Generic Sensor n'est pas dans les types de TypeScript : elle n'est
 * implémentée que par Chromium. Déclaration minimale de ce qu'on en utilise.
 */
interface SenseurOrientation {
  quaternion: number[] | null;
  start(): void;
  stop(): void;
  addEventListener(t: "reading" | "error", f: (e: Event) => void): void;
}
type FabriqueSenseur = new (opts: {
  frequency?: number;
  referenceFrame?: "device" | "screen";
}) => SenseurOrientation;

function angleEcran(): number {
  if (typeof window === "undefined") return 0;
  const o = window.screen?.orientation;
  if (o && typeof o.angle === "number") return o.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? norme360(legacy) : 0;
}

/**
 * Boussole de géocaching : distance en direct et flèche vers la cible.
 *
 * C'est une VRAIE boussole magnétique, pas une flèche calculée à partir des
 * déplacements : sur iOS elle lit `webkitCompassHeading` (la donnée de
 * l'application Boussole d'Apple) ; ailleurs, l'orientation fusionnée du
 * système (AbsoluteOrientationSensor) ou, à défaut, les angles de l'appareil.
 * Le cap est ramené au Nord VRAI par la déclinaison du lieu (lib/game/boussole.ts).
 *
 * Trois choses la rendent utilisable sur le terrain plutôt que seulement
 * juste : le lissage (le magnétomètre tremble), le chemin le plus court (sans
 * quoi la flèche fait un tour complet chaque fois qu'on passe le Nord) et
 * l'aveu d'ignorance — de trop près, ou téléphone tenu droit, elle dit qu'elle
 * ne sait pas au lieu de pointer au hasard.
 */
export default function GpsCompass({
  target,
  onUpdate,
  withinLabel = "Vous y êtes ! Validez ci-dessous 🎉",
  sansDistance = false,
}: GpsCompassProps) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [acc, setAcc] = useState<number | null>(null);
  const [cap, setCap] = useState<number | null>(null);
  const [aPlat, setAPlat] = useState(true);
  const [calibrage, setCalibrage] = useState<number | null>(null);
  const [permIos, setPermIos] = useState(false);
  const [geoCause, setGeoCause] = useState<"refus" | "introuvable" | "absent" | null>(null);
  // Deux compteurs de relance, pour que « Réessayer » et « Activer » repassent
  // par les effets — et donc par leur nettoyage — au lieu de poser un second
  // écouteur à côté du premier.
  const [relanceGeo, setRelanceGeo] = useState(0);
  const [relanceCap, setRelanceCap] = useState(0);
  const [capRefuse, setCapRefuse] = useState(false);
  const [plat, setPlat] = useState<Plateforme>("autre");

  // Angle AFFICHÉ de la rose : continu, jamais ramené dans [0, 360). C'est ce
  // qui lui fait prendre le chemin le plus court — une valeur qui repasse de
  // 359 à 1 ferait tourner le CSS de 358° dans le mauvais sens.
  const [aiguille, setAiguille] = useState(0);
  const aiguilleRef = useRef(0);
  const capRef = useRef<number | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // La déclinaison du LIEU de la cible : une chasse peut se jouer partout.
  const declinaison = useMemo(
    () => declinaisonDeg({ lat: target.lat, lng: target.lng }),
    [target.lat, target.lng]
  );
  const declinaisonRef = useRef(declinaison);
  declinaisonRef.current = declinaison;

  useEffect(() => {
    setPlat(plateforme(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  // Position GPS en continu
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoCause("absent");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const la = p.coords.latitude;
        const ln = p.coords.longitude;
        setPos({ lat: la, lng: ln });
        setAcc(p.coords.accuracy ?? null);
        setGeoCause(null);
        onUpdateRef.current(la, ln, distanceM({ lat: la, lng: ln }, target));
      },
      (err) => setGeoCause(err.code === err.PERMISSION_DENIED ? "refus" : "introuvable"),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.lat, target.lng, relanceGeo]);

  /**
   * Le cap, lissé. Un magnétomètre brut tremble de plusieurs degrés ; sans
   * passe-bas, la rose vibre en permanence et la flèche paraît cassée.
   */
  function poserCap(brut: number) {
    const lisse =
      capRef.current === null
        ? brut
        : norme360(capRef.current + ecartAngulaire(capRef.current, brut) * LISSAGE);
    capRef.current = lisse;
    setCap(lisse);
  }

  /**
   * La source du cap, par ordre de qualité décroissante. Un seul point
   * d'entrée, monté ici et démonté proprement.
   *
   *  1. AbsoluteOrientationSensor — orientation FUSIONNÉE par le système
   *     (accéléromètre + gyroscope + magnétomètre). `referenceFrame: "screen"`
   *     fait compenser la rotation de l'écran PAR LE NAVIGATEUR. Chromium.
   *  2. iOS — `webkitCompassHeading`, déjà fusionné et compensé par le système.
   *  3. `deviceorientationabsolute` — le repli, angles d'Euler.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    let arret: (() => void) | null = null;
    let demonte = false;

    const Senseur = (window as unknown as { AbsoluteOrientationSensor?: FabriqueSenseur })
      .AbsoluteOrientationSensor;

    if (Senseur) {
      try {
        const senseur = new Senseur({ frequency: 30, referenceFrame: "screen" });
        senseur.addEventListener("reading", () => {
          const q = senseur.quaternion;
          if (!q) return;
          setAPlat(capFiableQuaternion(q));
          const mesure = capDepuisQuaternion(q);
          if (mesure !== null) poserCap(capVrai(mesure, declinaisonRef.current));
        });
        // Capteur absent, bloqué par la politique de permissions, ou coupé en
        // arrière-plan : on redescend sur l'orientation classique.
        senseur.addEventListener("error", () => {
          if (demonte) return;
          arret?.();
          arret = repliOrientation();
        });
        senseur.start();
        arret = () => senseur.stop();
        return () => {
          demonte = true;
          arret?.();
        };
      } catch {
        /* constructeur refusé — on continue vers le repli */
      }
    }

    // iPhone : l'orientation exige un accord explicite, et l'accord se demande
    // sur l'écran de vérification du téléphone. Ici on ne fait que lire la
    // réponse déjà donnée : rien, sur cet écran, ne doit ouvrir une fenêtre
    // système par-dessus l'épreuve en cours sans un appui du joueur.
    if (orientationDemandeGeste() && !orientationAccordee()) {
      setPermIos(true);
      return;
    }
    setPermIos(false);
    arret = repliOrientation();
    return () => {
      demonte = true;
      arret?.();
    };
    // repliOrientation ne capture que des setters d'état et des refs, stables
    // par construction. `relanceCap` rejoue tout l'effet après un accord donné
    // à la main, nettoyage compris.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relanceCap]);

  function repliOrientation() {
    const handler = (evt: Event) => {
      const e = evt as EvtOrientation;
      if (typeof e.webkitCompassAccuracy === "number") setCalibrage(e.webkitCompassAccuracy);
      setAPlat(capFiable(e.beta));
      const mesure = capDepuisOrientation(e, angleEcran());
      if (mesure !== null) poserCap(capVrai(mesure, declinaisonRef.current));
    };
    window.addEventListener("deviceorientationabsolute", handler, true);
    window.addEventListener("deviceorientation", handler, true);
    return () => {
      window.removeEventListener("deviceorientationabsolute", handler, true);
      window.removeEventListener("deviceorientation", handler, true);
    };
  }

  /** Appui délibéré du joueur — jamais automatique. */
  async function autoriserBoussole() {
    const rep = await demanderOrientation();
    if (rep === "ok") {
      setCapRefuse(false);
      setRelanceCap((n) => n + 1);
      return;
    }
    // Un refus muet laissait un bouton qui ne fait rien devant un cadran vide.
    // iOS ne repose pas la question de la session : il faut le dire, et dire
    // où se trouve l'interrupteur.
    setCapRefuse(true);
  }

  const dist = pos ? distanceM(pos, target) : null;
  const brg = pos ? relevementDeg(pos, target) : null;
  const within = dist != null && dist <= target.radius;
  // De près, le relèvement n'est plus que du bruit GPS : on cesse de le donner.
  const oriente = dist != null && brg != null && relevementUtile(dist, acc);

  // La rose tourne à −cap et la flèche lui est SOLIDAIRE, plantée à l'azimut
  // de la cible : c'est le fonctionnement d'une boussole de relèvement.
  //
  // Elle ne porte plus de lettres N, S, E, O. Un « N » est une AFFIRMATION
  // VÉRIFIABLE — le joueur peut la confronter au soleil ou à sa propre
  // boussole — alors qu'une flèche dit seulement « par là ». Et une rose
  // graduée s'apprend : qui n'en a pas l'habitude essaie d'aligner le N sur le
  // haut du cadran, exactement l'erreur que ces lettres induisaient.
  const rose = cap != null ? -cap : null;

  useEffect(() => {
    if (rose === null) return;
    const suivant =
      aiguilleRef.current + ecartAngulaire(norme360(aiguilleRef.current), norme360(rose));
    aiguilleRef.current = suivant;
    // Zone morte : le passe-bas converge, et une fois immobile les variations
    // tombent sous le dixième de degré — invisibles sur un cadran de 176 px.
    // Sans elle, le composant se redessine trente fois par seconde pour ne
    // rien montrer.
    setAiguille((a) => (Math.abs(a - suivant) < 0.2 ? a : suivant));
  }, [rose]);

  const capDouteux = calibrage != null && (calibrage < 0 || calibrage > CALIBRAGE_DOUTEUX);

  // SANS POSITION, PAS DE BOUSSOLE. Afficher un cadran qui cherche
  // indéfiniment un signal sous un message « localisation refusée », c'est
  // faire croire à une panne. On dit ce qui manque, et comment le rendre.
  if (geoCause) {
    return <GeoManquante cause={geoCause} onReessayer={() => setRelanceGeo((n) => n + 1)} />;
  }

  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white/70 p-4 text-center">
      {/* Cadran */}
      <div className="relative mx-auto w-44 h-44">
        <div className="absolute inset-0 rounded-full border-[3px] border-ink bg-parchment" />
        <div className="absolute inset-[14px] rounded-full border-2 border-dashed border-ink/15" />

        {within ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-5xl animate-bounce">🎯</span>
          </div>
        ) : rose != null && oriente && brg != null ? (
          <div
            className="absolute inset-0"
            // AUCUNE TRANSITION CSS ICI, et c'est un choix mesuré. Le capteur
            // tourne à 30 Hz : une transition de 200 ms était RELANCÉE toutes
            // les 33 ms et n'arrivait jamais à son terme — un retard constant
            // et un flottement caoutchouteux qu'on prend pour un capteur
            // imprécis. Le passe-bas lisse déjà en amont ; lisser deux fois
            // n'ajoute que du retard.
            style={{ transform: `rotate(${aiguille}deg)` }}
          >
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ transform: `rotate(${brg}deg)` }}
            >
              {/* Flèche vers la cible */}
              <svg width="70" height="120" viewBox="0 0 70 120" aria-hidden>
                <polygon
                  points="35,6 60,58 40,58 40,112 30,112 30,58 10,58"
                  fill="#C0392B"
                  stroke="#111111"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-4xl">{dist != null && !oriente ? "👀" : "🧭"}</span>
          </div>
        )}
      </div>

      {/* Distance */}
      {!sansDistance && (
        <p className="font-display text-4xl mt-3 tabular-nums">
          {dist != null ? formatDistance(dist) : "…"}
        </p>
      )}

      <p
        className={`font-bold text-sm mt-1 leading-relaxed min-h-10 ${
          within ? "text-leaf" : "text-ink/60"
        }`}
      >
        {within
          ? withinLabel
          : dist == null
            ? "Acquisition du signal GPS…"
            : !oriente
              ? // Sous le rayon du GPS, une direction serait inventée. Le dire.
                "Tout près ! Le GPS ne distingue plus la direction : cherchez autour de vous."
              : rose != null
                ? "Tournez jusqu'à ce que la flèche pointe en haut, puis avancez."
                : `Direction : ${cardinal(brg!)}`}
      </p>

      {/* Ce que la boussole ne sait pas, elle le dit. */}
      {!within && !aPlat && rose != null && (
        <p className="font-bold text-crimson text-xs mt-1">
          📱 Tiens le téléphone à plat dans la main : tenu droit, une boussole ne sait plus où
          est le Nord.
        </p>
      )}
      {!within && capDouteux && (
        <p className="font-bold text-crimson text-xs mt-1">
          🧭 Boussole déréglée — dessine un 8 en l&apos;air avec le téléphone pour la recalibrer.
        </p>
      )}
      {!within && oriente && cap == null && !permIos && (
        <p className="font-bold text-ink/50 text-xs mt-1">
          Ce téléphone ne donne pas le Nord : fie-toi à la direction écrite.
        </p>
      )}
      {!within && acc != null && acc > 30 && acc <= PRECISION_INUTILISABLE_M && (
        <p className="font-bold text-ink/50 text-xs mt-1 tabular-nums">
          📶 Signal GPS faible (± {Math.round(acc)} m) — la distance peut sauter, patientez un peu.
        </p>
      )}
      {acc != null && acc > PRECISION_INUTILISABLE_M && <PositionApproximative precisionM={acc} />}

      {permIos && !capRefuse && (
        <div className="mt-3">
          <button
            type="button"
            onClick={autoriserBoussole}
            className="min-h-11 px-4 rounded-xl border-[3px] border-ink bg-gold font-display text-sm shadow-[2px_2px_0_0_#111111] active:translate-y-[1px]"
          >
            🧭 Activer la boussole
          </button>
          <p className="font-bold text-ink/50 text-xs mt-1.5 leading-relaxed">
            {sansDistance
              ? "Sans elle, la flèche ne peut pas s'orienter : tu n'auras que la direction écrite."
              : "Facultatif : la distance ci-dessus suffit à savoir si tu approches."}
          </p>
        </div>
      )}

      {capRefuse && (
        <div className="mt-3 rounded-xl border-2 border-ink/20 bg-parchment/60 p-3 text-left">
          <p className="font-display text-sm leading-snug">
            {remedeBoussole(plat, "refus").constat}
          </p>
          <ol className="mt-2 space-y-1">
            {remedeBoussole(plat, "refus").etapes.map((e, i) => (
              <li key={i} className="flex gap-2 font-bold text-ink/65 text-xs leading-relaxed">
                <span className="font-display text-gold-dark tabular-nums shrink-0">{i + 1}.</span>
                <span>{e}</span>
              </li>
            ))}
          </ol>
          {!sansDistance && (
            <p className="font-bold text-ink/50 text-xs leading-relaxed mt-2">
              En attendant, la distance suffit : si elle descend quand tu marches, tu vas dans le
              bon sens.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
