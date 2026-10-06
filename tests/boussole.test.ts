/**
 * La boussole.
 *
 * C'est la seule valeur de l'app qu'on ne peut pas vérifier à l'œil — une
 * aiguille fausse de 40° a exactement l'air d'une aiguille juste. D'où ce
 * fichier, et d'où le fait que `lib/game/boussole.ts` soit sorti des
 * composants.
 *
 * Ces tests vivaient dans `minigames.test.ts`, où personne ne les aurait
 * cherchés. Ils sont ici, avec ceux de la DÉCLINAISON.
 *
 * La déclinaison, justement, est le morceau qui mérite le plus d'attention :
 * une erreur de signe ne corrige pas l'écart, elle le DOUBLE — 31° au lieu de
 * 15,5 en Martinique — et rien à l'écran ne le montre. C'est la faute qu'un
 * test attrape en une milliseconde et qu'un essai sur le terrain met une
 * demi-journée à cerner. Et elle dépend du lieu : on la vérifie à trois
 * endroits du monde.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  declinaisonDeg,
  capDepuisOrientation,
  capDepuisQuaternion,
  capFiable,
  capFiableQuaternion,
  capVrai,
  cardinal,
  distanceM,
  ecartAngulaire,
  norme360,
  relevementDeg,
  relevementUtile,
} from "@/lib/game/boussole";

/* ------------------------------------------------------------------------- *
 * La déclinaison magnétique
 * ------------------------------------------------------------------------- */

/** Le François, Martinique — le lieu où la valeur a été relevée au NOAA. */
const LE_FRANCOIS = { lat: 14.6139, lng: -60.9042 };
const DECLINAISON_MARTINIQUE = declinaisonDeg(LE_FRANCOIS);

test("déclinaison : la valeur du lieu est celle du modèle mondial", () => {
  // −15,53° au NOAA (WMM-2025) pour Le François, septembre 2026, ±0,32°.
  // Le Nord magnétique y est à l'OUEST du Nord vrai : la valeur est NÉGATIVE.
  const sept2026 = declinaisonDeg(LE_FRANCOIS, new Date("2026-09-15T12:00:00Z"));
  assert.ok(sept2026 < 0, "aux Antilles la déclinaison est ouest, donc négative");
  assert.ok(Math.abs(sept2026 + 15.53) < 0.35, `${sept2026}° au lieu de −15,53°`);
});

test("déclinaison : elle dépend du lieu — une chasse TOYAH peut se jouer partout", () => {
  // Une constante unique (celle d'un seul site) serait juste en Martinique et
  // fausse de 17° à Paris : le contraire d'une correction.
  const paris = declinaisonDeg({ lat: 48.8566, lng: 2.3522 }, new Date("2026-09-15T12:00:00Z"));
  assert.ok(paris > 0 && paris < 4, `Paris : ${paris}° (attendu ≈ +2°, déclinaison est)`);
  const reunion = declinaisonDeg({ lat: -21.11, lng: 55.53 }, new Date("2026-09-15T12:00:00Z"));
  assert.ok(reunion < -17 && reunion > -22, `La Réunion : ${reunion}° (attendu ≈ −19,5°)`);
});

test("déclinaison : une coordonnée invalide ne casse rien", () => {
  assert.equal(declinaisonDeg({ lat: Number.NaN, lng: 0 }), 0);
});

test("capVrai : viser le Nord vrai donne bien zéro", () => {
  // Le Nord magnétique étant à 15,5° à l'ouest du Nord vrai, un téléphone
  // pointé sur le Nord VRAI lit 15,5° au magnétomètre.
  const lu = -DECLINAISON_MARTINIQUE;
  assert.ok(Math.abs(capVrai({ deg: lu, reference: "magnetique" }, DECLINAISON_MARTINIQUE)) < 1e-9);
});

test("capVrai : n'importe quel relèvement se retrouve exactement", () => {
  // La propriété qui compte, et celle qu'un signe inversé casse : quel que
  // soit le cap vrai visé, la correction doit le restituer.
  for (const decl of [DECLINAISON_MARTINIQUE, 2.08, -19.48]) {
    for (const vrai of [0, 37, 90, 180, 271, 359]) {
      const luParLeMagnetometre = norme360(vrai - decl);
      const rendu = capVrai({ deg: luParLeMagnetometre, reference: "magnetique" }, decl);
      const ecart = Math.abs(ecartAngulaire(rendu, vrai));
      assert.ok(ecart < 1e-9, `relèvement ${vrai}° rendu ${rendu}° (déclinaison ${decl})`);
    }
  }
});

test("capVrai : une source DÉJÀ vraie n'est pas corrigée", () => {
  // Corriger deux fois ne réduit pas l'erreur, elle la crée. C'est tout
  // l'objet du champ `reference`.
  for (const deg of [0, 42, 180, 359]) {
    assert.equal(capVrai({ deg, reference: "vrai" }, DECLINAISON_MARTINIQUE), deg);
  }
});

test("capVrai rend toujours un angle dans [0, 360)", () => {
  for (let d = 0; d < 360; d += 13) {
    const v = capVrai({ deg: d, reference: "magnetique" }, DECLINAISON_MARTINIQUE);
    assert.ok(v >= 0 && v < 360, `${d} → ${v}`);
  }
});

test("chaque source annonce à quel Nord elle se rapporte", () => {
  // Sans ce champ, impossible de savoir s'il faut corriger : c'est la branche
  // qui produit le chiffre qui sait d'où il vient, pas l'appelant.
  assert.equal(capDepuisQuaternion([0, 0, 0, 1])?.reference, "magnetique");
  assert.equal(
    capDepuisOrientation({ alpha: 0, beta: 0, absolute: true })?.reference,
    "magnetique"
  );
  const ios = capDepuisOrientation({ webkitCompassHeading: 42 });
  assert.ok(ios && (ios.reference === "vrai" || ios.reference === "magnetique"));
});

/* ------------------------------------------------------------------------- *
 * Le cap
 * ------------------------------------------------------------------------- */

test("boussole : iOS livre son cap, on le prend tel quel", () => {
  assert.equal(capDepuisOrientation({ webkitCompassHeading: 137.4 })?.deg, 137.4);
  // -1 = magnétomètre non calibré : ce n'est pas un cap.
  assert.equal(capDepuisOrientation({ webkitCompassHeading: -1 }), null);
});

test("boussole : sans cap absolu, on n'invente rien", () => {
  assert.equal(capDepuisOrientation({ alpha: 90, beta: 0, absolute: false }), null);
  assert.equal(capDepuisOrientation({ absolute: true }), null);
});

test("boussole : téléphone à plat, le cap est l'opposé de alpha", () => {
  const cas: [number, number][] = [[0, 0], [90, 270], [180, 180], [270, 90]];
  for (const [alpha, attendu] of cas) {
    const cap = capDepuisOrientation({ alpha, beta: 0, gamma: 0, absolute: true })!.deg;
    assert.ok(Math.abs(cap - attendu) < 1e-6, `alpha ${alpha} → ${cap}`);
  }
});

test("boussole : le ROULIS ne fausse pas le cap", () => {
  // Pencher le téléphone sur le côté ne doit rien changer : le bord supérieur
  // pointe toujours au même endroit. C'est le comportement d'une vraie boussole.
  const droit = capDepuisOrientation({ alpha: 200, beta: 30, gamma: 0, absolute: true })!.deg;
  for (const gamma of [-60, -20, 20, 60]) {
    const penche = capDepuisOrientation({ alpha: 200, beta: 30, gamma, absolute: true })!.deg;
    assert.ok(Math.abs(penche - droit) < 1e-6, `gamma ${gamma} : ${penche} ≠ ${droit}`);
  }
});

test("boussole : basculé au-delà de la verticale, le cap ne part pas à l'opposé", () => {
  // C'est le bug de la formule naïve `360 - alpha` : écran tourné vers le ciel
  // (|beta| > 90°), elle annonçait plein Sud pour plein Nord.
  const naif = (a: number) => (360 - a) % 360;
  const alpha = 0;
  const beta = 120; // le haut du téléphone bascule vers l'arrière
  const cap = capDepuisOrientation({ alpha, beta, gamma: 0, absolute: true })!.deg;
  assert.ok(Math.abs(cap - 180) < 1e-6, `attendu 180, obtenu ${cap}`);
  assert.equal(naif(alpha), 0, "la formule naïve se serait trompée de 180°");
});

test("boussole : l'écran tourné décale le cap du même angle", () => {
  const portrait = capDepuisOrientation({ alpha: 45, beta: 10, absolute: true }, 0)!.deg;
  const paysage = capDepuisOrientation({ alpha: 45, beta: 10, absolute: true }, 90)!.deg;
  assert.ok(Math.abs(paysage - norme360(portrait + 90)) < 1e-6);
});

test("boussole : le quaternion de l'orientation absolue donne le bon cap", () => {
  const r2 = Math.SQRT1_2;
  // Identité : l'écran est aligné sur le repère terrestre, son haut vise le Nord.
  assert.equal(capDepuisQuaternion([0, 0, 0, 1])!.deg, 0);
  // Quart de tour autour de la verticale : le Nord passe à l'Ouest.
  assert.ok(Math.abs(capDepuisQuaternion([0, 0, r2, r2])!.deg - 270) < 1e-6);
  assert.ok(Math.abs(capDepuisQuaternion([0, 0, -r2, r2])!.deg - 90) < 1e-6);
  // Demi-tour.
  assert.ok(Math.abs(capDepuisQuaternion([0, 0, 1, 0])!.deg - 180) < 1e-6);
});

test("boussole : un quaternion dégénéré ou tronqué ne produit pas de cap", () => {
  const r2 = Math.SQRT1_2;
  // Écran dressé à la verticale : le haut vise le ciel, il n'a plus de cap.
  assert.equal(capDepuisQuaternion([r2, 0, 0, r2]), null);
  assert.equal(capDepuisQuaternion([0, 0, 1]), null);
  assert.equal(capDepuisQuaternion([]), null);
});

/* ------------------------------------------------------------------------- *
 * Refuser de répondre quand la mesure ne veut rien dire
 * ------------------------------------------------------------------------- */

test("boussole : le cap n'est pas fiable près de la verticale", () => {
  assert.equal(capFiable(0), true, "à plat");
  assert.equal(capFiable(45), true, "incliné pour lire");
  assert.equal(capFiable(89), false, "tenu droit devant soi : blocage de cardan");
  assert.equal(capFiable(-95), false);
  assert.equal(capFiable(null), true, "sans mesure, on ne décourage personne");
});

test("boussole : même verdict de fiabilité depuis le quaternion", () => {
  const r2 = Math.SQRT1_2;
  assert.equal(capFiableQuaternion([0, 0, 0, 1]), true);
  assert.equal(capFiableQuaternion([r2, 0, 0, r2]), false);
});

test("boussole : de trop près, la direction est du bruit et on cesse de la donner", () => {
  assert.equal(relevementUtile(120, 8), true);
  assert.equal(relevementUtile(6, 8), false, "6 m avec 8 m de marge : indéterminable");
  assert.equal(relevementUtile(9, 5), false, "sous le plancher de 10 m, jamais");
  assert.equal(relevementUtile(30, 50), false, "signal GPS trop dégradé pour 30 m");
});

/* ------------------------------------------------------------------------- *
 * Angles, distances, étiquettes
 * ------------------------------------------------------------------------- */

test("boussole : l'écart angulaire prend toujours le chemin le plus court", () => {
  assert.equal(ecartAngulaire(350, 10), 20, "on franchit le Nord vers l'avant");
  assert.equal(ecartAngulaire(10, 350), -20, "et vers l'arrière");
  assert.equal(ecartAngulaire(0, 180), 180);
  assert.equal(ecartAngulaire(0, 181), -179, "au-delà du demi-tour, l'autre sens est plus court");
  assert.equal(ecartAngulaire(90, 90), 0);
});

test("boussole : l'écart angulaire reste dans (-180, 180]", () => {
  for (let a = 0; a < 360; a += 7) {
    for (let b = 0; b < 360; b += 11) {
      const e = ecartAngulaire(a, b);
      assert.ok(e > -180 && e <= 180, `${a}→${b} donne ${e}`);
    }
  }
});

test("norme360 ramène dans [0, 360) sans erreur de virgule", () => {
  assert.equal(norme360(137.4), 137.4); // le raccourci %360 rendait 137.39999999999998
  assert.equal(norme360(0), 0);
  assert.equal(norme360(360), 0);
  assert.equal(norme360(-90), 270);
  assert.equal(norme360(450), 90);
});

test("relèvement : le Nord et l'Est tombent juste", () => {
  const ici = { lat: 14.61, lng: -60.9 };  // Le François, Martinique
  assert.ok(Math.abs(relevementDeg(ici, { lat: 14.62, lng: -60.9 }) - 0) < 0.5);
  assert.ok(Math.abs(relevementDeg(ici, { lat: 14.61, lng: -60.89 }) - 90) < 0.5);
  assert.ok(Math.abs(relevementDeg(ici, { lat: 14.60, lng: -60.9 }) - 180) < 0.5);
  assert.ok(Math.abs(relevementDeg(ici, { lat: 14.61, lng: -60.91 }) - 270) < 0.5);
});

test("distance : un dixième de degré de latitude fait environ 11 km", () => {
  const d = distanceM({ lat: 14.6, lng: -60.9 }, { lat: 14.7, lng: -60.9 });
  assert.ok(Math.abs(d - 11119) < 30, `${d} m`);
  assert.equal(distanceM({ lat: 14.6, lng: -60.9 }, { lat: 14.6, lng: -60.9 }), 0);
});

test("distance : cent mètres font cent mètres, et la mesure est symétrique", () => {
  // L'échelle qui compte ici : une épreuve se joue à quelques dizaines de mètres.
  const a = { lat: 14.6139, lng: -60.9042 };
  const b = { lat: a.lat + 100 / 111195, lng: a.lng };
  assert.ok(Math.abs(distanceM(a, b) - 100) < 0.5, `${distanceM(a, b)} m`);
  assert.ok(Math.abs(distanceM(a, b) - distanceM(b, a)) < 1e-6);
});

test("cardinal nomme les huit secteurs, et boucle proprement", () => {
  assert.equal(cardinal(0), "Nord");
  assert.equal(cardinal(45), "Nord-Est");
  assert.equal(cardinal(90), "Est");
  assert.equal(cardinal(180), "Sud");
  assert.equal(cardinal(270), "Ouest");
  assert.equal(cardinal(359), "Nord", "près de 360 on revient au Nord");
  assert.equal(cardinal(-90), "Ouest");
});
