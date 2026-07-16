import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer } from "@/lib/game/normalize";

test("normalizeAnswer : casse, accents, ponctuation, espaces", () => {
  assert.equal(normalizeAnswer("La Fontaine"), "lafontaine");
  assert.equal(normalizeAnswer("  l'épée  DORÉE !"), "lepeedoree");
  assert.equal(normalizeAnswer("Où ça ?"), "ouca");
  assert.equal(normalizeAnswer("le cœur"), "lecoeur");
  assert.equal(normalizeAnswer("Ça brûle-t-il"), "cabruletil");
  assert.equal(normalizeAnswer("42"), "42");
  assert.equal(normalizeAnswer(""), "");
});

test("normalizeAnswer : deux écritures équivalentes matchent", () => {
  const pairs: [string, string][] = [
    ["L'ombre", "lombre"],
    ["chêne", "CHENE"],
    ["rendez-vous", "Rendez Vous"],
    ["a b c", "abc"],
  ];
  for (const [a, b] of pairs) {
    assert.equal(normalizeAnswer(a), normalizeAnswer(b), `${a} ≠ ${b}`);
  }
});
