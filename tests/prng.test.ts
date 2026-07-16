import { test } from "node:test";
import assert from "node:assert/strict";
import { rngFromSeed, seededShuffle, seededInt } from "@/lib/game/prng";

test("rngFromSeed : déterministe (même seed → même suite)", () => {
  const a = rngFromSeed("team-1:step-2");
  const b = rngFromSeed("team-1:step-2");
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b());
  }
});

test("rngFromSeed : seeds différents → suites différentes", () => {
  const a = rngFromSeed("team-1:step-2");
  const b = rngFromSeed("team-2:step-2");
  const va = Array.from({ length: 10 }, () => a());
  const vb = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(va, vb);
});

test("seededShuffle : produit une permutation complète", () => {
  const input = Array.from({ length: 20 }, (_, i) => i);
  const out = seededShuffle(input, rngFromSeed("x"));
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort((a, b) => a - b), input);
  // l'original n'est pas muté
  assert.deepEqual(input, Array.from({ length: 20 }, (_, i) => i));
});

test("seededInt : borné dans [0, max)", () => {
  const rand = rngFromSeed("bounds");
  for (let i = 0; i < 1000; i++) {
    const v = seededInt(rand, 7);
    assert.ok(v >= 0 && v < 7 && Number.isInteger(v));
  }
});
