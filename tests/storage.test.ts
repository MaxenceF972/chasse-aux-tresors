import { test } from "node:test";
import assert from "node:assert/strict";
import { appartientA, cheminStorage } from "../lib/game/storage";

const BASE = "https://abcd.supabase.co/storage/v1/object/public/media";
const JEU = "11111111-2222-3333-4444-555555555555";

test("le chemin se lit derrière le marqueur du bucket", () => {
  assert.equal(cheminStorage(`${BASE}/${JEU}/photo.webp`), `${JEU}/photo.webp`);
});

test("la chaîne de requête est retirée", () => {
  assert.equal(cheminStorage(`${BASE}/${JEU}/photo.webp?t=123`), `${JEU}/photo.webp`);
});

test("le chemin est décodé", () => {
  assert.equal(cheminStorage(`${BASE}/${JEU}/le%20chai.webp`), `${JEU}/le chai.webp`);
});

test("une URL étrangère au bucket ne rend rien", () => {
  assert.equal(cheminStorage("https://exemple.fr/photo.webp"), null);
  assert.equal(cheminStorage(`https://abcd.supabase.co/storage/v1/object/public/autre/${JEU}/x.webp`), null);
});

test("une valeur qui n'est pas une chaîne ne rend rien", () => {
  assert.equal(cheminStorage(null), null);
  assert.equal(cheminStorage(undefined), null);
  assert.equal(cheminStorage(42), null);
  assert.equal(cheminStorage(""), null);
});

test("un encodage cassé rend le chemin brut plutôt que rien", () => {
  // Un « % » isolé fait lever decodeURIComponent : perdre le fichier serait
  // pire que rendre son chemin tel quel.
  assert.equal(cheminStorage(`${BASE}/${JEU}/100%.webp`), `${JEU}/100%.webp`);
});

test("l'appartenance se juge sur le DOSSIER, pas sur la présence du texte", () => {
  assert.equal(appartientA(`${BASE}/${JEU}/photo.webp`, JEU), true);
  // L'identifiant cité ailleurs dans l'URL ne fait pas du fichier le sien :
  // c'est exactement ce qui distinguait les deux lectures d'avant.
  assert.equal(appartientA(`${BASE}/autre-partie/${JEU}.webp`, JEU), false);
  assert.equal(appartientA(`${BASE}/autre-partie/photo.webp?ref=${JEU}`, JEU), false);
  assert.equal(appartientA("https://exemple.fr/photo.webp", JEU), false);
});
