import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIBELLES,
  aRegler,
  navigateur,
  plateforme,
  remedeBoussole,
  remedeMemoire,
  remedeNfc,
  remedePhoto,
  remedePosition,
  remedeReseau,
  remedeSon,
  type Constat,
  type Remede,
  verdict,
} from "../lib/game/diagnostic";

/* --------------------------------------------------------------- plateforme */

test("plateforme reconnaît un iPhone", () => {
  const ua =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  assert.equal(plateforme(ua), "ios");
});

test("plateforme démasque un iPad, qui se déclare Macintosh", () => {
  // iPadOS 13+ ment sur son user-agent : seul le tactile le trahit.
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  assert.equal(plateforme(ua, 5), "ios");
  assert.equal(plateforme(ua, 0), "autre", "un vrai Mac ne doit pas devenir un iPad");
});

test("plateforme reconnaît Android", () => {
  const ua =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
  assert.equal(plateforme(ua), "android");
});

/* ------------------------------------------------------------- les remèdes */

const TOUS: Remede[] = [
  remedeReseau(),
  remedePhoto(),
  ...(["ios", "android", "autre"] as const).flatMap((p) => [
    remedePosition(p, "refus"),
    remedePosition(p, "introuvable"),
    remedePosition(p, "absent"),
    remedeBoussole(p, "refus"),
    remedeBoussole(p, "absent"),
    remedeSon(p),
    remedeMemoire(p),
  ]),
];

test("aucune marche à suivre n'envoie ailleurs", () => {
  // La demande du client, mot pour mot : « je veux pas de message comme ça qui
  // ouvre un autre lien ». Un lien au milieu d'un dépannage inquiète plus qu'il
  // n'aide, et depuis le web on ne peut de toute façon PAS ouvrir les réglages
  // d'un iPhone. On décrit le chemin, on ne l'ouvre pas.
  for (const r of TOUS) {
    for (const e of [r.constat, ...r.etapes]) {
      assert.ok(!/https?:\/\//i.test(e), `lien dans « ${e} »`);
      assert.ok(!/\bapp-settings:|\bprefs:/i.test(e), `lien de réglages dans « ${e} »`);
    }
  }
});

test("aucun emoji dans les textes de dépannage", () => {
  const emoji = /\p{Extended_Pictographic}/u;
  for (const r of TOUS) {
    for (const e of [r.constat, ...r.etapes]) {
      assert.ok(!emoji.test(e), `emoji dans « ${e} »`);
    }
  }
  for (const l of Object.values(LIBELLES)) {
    assert.ok(!emoji.test(l.titre + l.pourquoi));
  }
});

test("les textes tutoient, comme le reste des écrans joueur", () => {
  // Le ton de TOYAH est complice : on parle au joueur qui tient le téléphone.
  // `\b` de JavaScript est ASCII, d'où les gardes Unicode. Le trait d'union
  // est exclu à gauche : « rendez-vous » est un nom, pas un vouvoiement.
  const vouvoiement = /(?<![\p{L}-])(vous|votre|vos)(?!\p{L})/iu;
  for (const r of TOUS) {
    for (const e of [r.constat, ...r.etapes]) {
      assert.ok(!vouvoiement.test(e), `vouvoiement dans « ${e} »`);
    }
  }
  for (const l of Object.values(LIBELLES)) {
    assert.ok(!vouvoiement.test(l.titre + " " + l.pourquoi), `vouvoiement dans « ${l.pourquoi} »`);
  }
});

test("chaque remède dit quelque chose et donne au moins une action", () => {
  for (const r of TOUS) {
    assert.ok(r.constat.length > 10);
    assert.ok(r.etapes.length >= 1);
    for (const e of r.etapes) assert.ok(e.length > 10, `étape trop courte : « ${e} »`);
  }
});

test("la localisation refusée sur iPhone donne les trois verrous d'Apple", () => {
  const r = remedePosition("ios", "refus");
  const tout = r.etapes.join(" ");
  assert.match(tout, /Réglages du site web/);
  assert.match(tout, /Safari/);
  assert.match(tout, /Service de localisation/);
});

test("la localisation refusée sur Android parle du navigateur, pas de Safari", () => {
  const r = remedePosition("android", "refus");
  assert.ok(!r.etapes.join(" ").includes("Safari"));
  assert.match(r.etapes.join(" "), /Autorisations/);
});

test("une boussole absente n'envoie chercher aucun réglage", () => {
  // Beaucoup d'appareils n'ont pas de magnétomètre. Envoyer leur propriétaire
  // fouiller un réglage inexistant, c'est le faire échouer deux fois.
  for (const p of ["ios", "android", "autre"] as const) {
    const r = remedeBoussole(p, "absent");
    assert.ok(!r.etapes.join(" ").includes("Réglages"));
    assert.match(r.etapes.join(" "), /distance/);
  }
});

test("le mode silencieux d'un iPhone renvoie à l'interrupteur, pas à un réglage", () => {
  assert.match(remedeSon("ios").etapes.join(" "), /tranche gauche/);
  assert.match(remedeSon("android").etapes.join(" "), /Multimédia/);
});

/* --------------------------------------------------------------- le verdict */

const c = (sujet: Constat["sujet"], etat: Constat["etat"]): Constat => ({ sujet, etat });

test("le verdict attend que tout soit mesuré", () => {
  assert.equal(verdict([c("reseau", "ok"), c("position", "encours")]), "encours");
});

test("une boussole absente ne retient personne", () => {
  const etats = [c("reseau", "ok"), c("position", "ok"), c("boussole", "absent")];
  assert.equal(verdict(etats), "pret");
});

test("une position refusée rend le départ partiel, jamais bloqué", () => {
  const etats = [c("reseau", "ok"), c("position", "refus")];
  assert.equal(verdict(etats), "partiel");
});

test("le son que personne n'a testé ne dégrade pas le verdict", () => {
  const etats = [c("reseau", "ok"), c("position", "ok"), c("son", "inconnu")];
  assert.equal(verdict(etats), "pret");
});

test("à régler : les refus d'abord, et rien de ce qui va bien", () => {
  const liste = aRegler([
    c("son", "inconnu"),
    c("position", "refus"),
    c("reseau", "ok"),
    c("boussole", "absent"),
    c("photo", "encours"),
  ]);
  assert.deepEqual(
    liste.map((x) => x.sujet),
    ["position", "boussole", "son"]
  );
});

/* ------------------------------------------------------------------------
   Le NAVIGATEUR, et non seulement le systeme.

   Le systeme dit ou chercher, le navigateur dit comment. « Touchez aA a
   cote de l'adresse » ne vaut que pour Safari : envoyer un utilisateur de
   Chrome iOS chercher ce bouton est pire que de ne rien lui dire, parce
   qu'il cherchera.
   ------------------------------------------------------------------------ */

test("les navigateurs iOS se declarent tous « Safari » : l'ordre des tests decide", () => {
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
  assert.equal(navigateur(`${IOS} Version/17.5 Mobile/15E148 Safari/604.1`), "safari");
  assert.equal(navigateur(`${IOS} CriOS/126.0 Mobile/15E148 Safari/604.1`), "chrome",
    "Chrome iOS se declare aussi Safari — CriOS doit passer avant");
  assert.equal(navigateur(`${IOS} FxiOS/127.0 Mobile/15E148 Safari/605.1.15`), "firefox");
  assert.equal(navigateur(`${IOS} EdgiOS/126.0 Mobile/15E148 Safari/605.1.15`), "edge");
});

test("Edge se nomme autrement sur chaque systeme, et se declare aussi Chrome", () => {
  assert.equal(navigateur("Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 EdgA/120.0"), "edge",
    "sur Android c'est EdgA, pas Edg");
  assert.equal(navigateur("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 EdgiOS/126.0 Mobile Safari/605.1.15"), "edge");
  assert.equal(navigateur("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0"), "edge");
});

test("le chemin des reglages NFC ne cite AUCUN menu de marque", () => {
  const tout = remedeNfc("android").etapes.join(" ");
  assert.ok(!tout.includes("Appareils connectés"),
    "ce menu est celui d'un Pixel : sur Samsung c'est « Connexions », sur Xiaomi autre chose encore");
  assert.ok(tout.includes("cherche"), "la recherche des réglages, elle, existe partout");
});

test("Samsung Internet se declare Chrome : il doit etre teste avant", () => {
  const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36";
  assert.equal(navigateur(ua), "samsung");
});

test("sur iPhone hors Safari, on n'envoie pas chercher le bouton « aA »", () => {
  const chrome = remedePosition("ios", "refus", "chrome");
  const tout = chrome.etapes.join(" ");
  assert.ok(!tout.includes("aA"), "« aA » n'existe pas dans Chrome iOS");
  assert.ok(tout.includes("Safari"), "le raccourci le plus sur reste d'ouvrir Safari");
  assert.ok(tout.includes("Chrome"), "les reglages de l'iPhone nomment l'application");

  const safari = remedePosition("ios", "refus", "safari");
  assert.ok(safari.etapes.join(" ").includes("aA"), "dans Safari, le bouton existe");
});

test("chaque navigateur de bureau a son propre chemin", () => {
  const chemins = {
    chrome: "Paramètres du site",
    firefox: "cadenas",
    safari: "Réglages pour ce site web",
  } as const;
  for (const [nav, attendu] of Object.entries(chemins)) {
    const r = remedePosition("autre", "refus", nav as "chrome");
    assert.ok(r.etapes.join(" ").includes(attendu),
      `${nav} devrait mener vers « ${attendu} »`);
  }
  // Navigateur inconnu : une consigne generique, jamais un chemin invente.
  const inconnu = remedePosition("autre", "refus", "autre");
  assert.ok(inconnu.etapes.join(" ").includes("barre d'adresse"));
});

test("« Mouvement et orientation » n'est propose que dans Safari", () => {
  assert.ok(remedeBoussole("ios", "refus", "safari").etapes.join(" ").includes("Mouvement et orientation"));
  const chrome = remedeBoussole("ios", "refus", "chrome").etapes.join(" ");
  assert.ok(!chrome.includes("Mouvement et orientation"),
    "ce reglage n'existe pas hors Safari : le citer ferait fouiller un ecran vide");
  assert.ok(chrome.includes("distance"), "et le jeu tourne sans boussole — il faut le dire");
});

test("Android : ce n'est pas le NAVIGATEUR qui lit la balise, c'est le systeme", () => {
  const r = remedeNfc("android");
  assert.ok(!r.constat.includes("navigateur"),
    "blamer le navigateur envoie chercher au mauvais endroit : Firefox Android lit tres bien les balises");
  const tout = r.etapes.join(" ");
  assert.ok(tout.includes("système"), "il faut dire QUI lit la puce");
  assert.ok(tout.includes("NFC"), "le seul reglage a verifier");
  assert.ok(tout.includes("passer"), "et ce qu'on fait quand l'appareil n'a pas de puce");
});

test("le code de secours d'une balise n'est promis qu'au conditionnel", () => {
  // L'organisateur PEUT définir un code par balise (step_secrets.manual_code),
  // mais rien ne dit qu'il l'a écrit dessus. L'annoncer sans condition
  // enverrait chercher un numéro qui n'existe peut-être pas — sur le terrain,
  // sans personne à qui demander.
  for (const p of ["ios", "android", "autre"] as const) {
    for (const e of remedeNfc(p).etapes) {
      if (/code/i.test(e)) {
        assert.match(e, /\bsi un code\b/i, `${p} : « ${e} » promet un code sans condition`);
      }
    }
  }
});
