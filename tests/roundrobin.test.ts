import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Miroir JS exact de l'algorithme de start_game() (supabase/setup.sql) :
 * si ce test casse, le SQL doit être re-vérifié.
 *
 * Deux garanties à tenir simultanément :
 *  - carré latin : jamais deux équipes sur la même énigme AU MÊME RANG ;
 *  - anti-peloton : deux équipes DÉCALÉES ne se suivent pas d'énigme en énigme
 *    (c'est l'ordre de visite mélangé `perm` qui l'assure).
 */

/** PRNG déterministe : les tests ne doivent jamais être capricieux. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Permutation mélangée des rangs — équivalent JS du `order by random()` SQL. */
function shuffledOrder(n: number, seed = 42): number[] {
  const rnd = mulberry32(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Décalage de l'équipe k : réparti sur TOUT le pool (pas de blocs orphelins). */
function teamOffset(k: number, blockCount: number, teamCount: number): number {
  return blockCount > 0 ? Math.floor((k * blockCount) / teamCount) % blockCount : 0;
}

interface Slot {
  id: string;
  common: boolean;
}

function buildRoutes(
  slots: Slot[],
  poolOrder: string[],
  finals: string[],
  teamCount: number,
  perm?: number[]
): string[][] {
  const n = poolOrder.length;
  const order = perm ?? Array.from({ length: n }, (_, i) => i);
  const routes: string[][] = [];
  for (let k = 0; k < teamCount; k++) {
    const offset = teamOffset(k, n, teamCount);
    let poolIndex = 0;
    const route: string[] = [];
    for (const slot of slots) {
      if (slot.common) {
        route.push(slot.id);
      } else {
        route.push(poolOrder[(order[poolIndex] + offset) % n]);
        poolIndex++;
      }
    }
    route.push(...finals);
    routes.push(route);
  }
  return routes;
}

function makeConfig(poolCount: number, commonPositions: number[], finalCount: number) {
  const pool = Array.from({ length: poolCount }, (_, i) => `pool-${i}`);
  const finals = Array.from({ length: finalCount }, (_, i) => `final-${i}`);
  const slots: Slot[] = [];
  let poolLeft = poolCount;
  let index = 0;
  while (poolLeft > 0 || commonPositions.some((p) => p >= index)) {
    if (commonPositions.includes(index)) {
      slots.push({ id: `common-${index}`, common: true });
    } else if (poolLeft > 0) {
      slots.push({ id: "", common: false });
      poolLeft--;
    }
    index++;
  }
  return { slots, pool, finals };
}

test("round-robin : jamais deux équipes sur la même énigme pool au même index", () => {
  for (const [poolCount, teamCount] of [
    [4, 2],
    [6, 3],
    [8, 4],
    [5, 5],
    [10, 3],
    [7, 6],
    [20, 12],
  ] as [number, number][]) {
    const { slots, pool, finals } = makeConfig(poolCount, [2], 1);
    const routes = buildRoutes(slots, pool, finals, teamCount, shuffledOrder(poolCount));

    for (let pos = 0; pos < routes[0].length; pos++) {
      const slot = slots[pos];
      const atPos = routes.map((r) => r[pos]);
      if (slot && !slot.common) {
        // pool : toutes distinctes
        assert.equal(
          new Set(atPos).size,
          teamCount,
          `collision pool=${poolCount} teams=${teamCount} pos=${pos}: ${atPos.join(",")}`
        );
      } else {
        // palier commun / finale : identique pour tout le monde
        assert.equal(new Set(atPos).size, 1, `commun divergent pos=${pos}`);
      }
    }
  }
});

test("round-robin : tout le pool est occupé dès le premier rang (pas d'énigme déserte)", () => {
  // 20 énigmes, 12 équipes : l'ancien pas valait floor(20/12)=1, donc les
  // décalages plafonnaient à 11 et les énigmes 12→19 n'étaient à personne.
  const poolCount = 20;
  const teamCount = 12;
  const offsets = new Set(
    Array.from({ length: teamCount }, (_, k) => teamOffset(k, poolCount, teamCount))
  );
  assert.equal(offsets.size, teamCount, "les décalages doivent tous différer");
  // Le dernier décalage doit arriver à moins d'un pas de la fin du pool
  // (ancien algorithme : max=11 sur 20 → 8 énigmes désertes au départ).
  assert.ok(
    Math.max(...offsets) >= poolCount - Math.ceil(poolCount / teamCount),
    `les décalages doivent couvrir tout le pool (max=${Math.max(...offsets)}/${poolCount})`
  );
});

test("round-robin : chaque équipe parcourt chaque étape exactement une fois", () => {
  const { slots, pool, finals } = makeConfig(6, [1, 4], 1);
  const routes = buildRoutes(slots, pool, finals, 3, shuffledOrder(6));
  const expected = [...pool, "common-1", "common-4", "final-0"].sort();
  for (const route of routes) {
    assert.deepEqual([...route].sort(), expected);
  }
});

test("round-robin : la finale est toujours en dernière position", () => {
  const { slots, pool, finals } = makeConfig(5, [], 1);
  const routes = buildRoutes(slots, pool, finals, 4, shuffledOrder(5));
  for (const route of routes) {
    assert.equal(route[route.length - 1], "final-0");
  }
});

test("anti-peloton : deux équipes décalées ne se suivent pas d'énigme en énigme", () => {
  // Le cas vécu : 12 équipes, 12 énigmes au pool. Avec l'ancien décalage
  // cyclique simple, une équipe UNE étape derrière une autre tombait sur la
  // MÊME énigme à tous les rangs (12 collisions d'affilée) — le peloton.
  const poolCount = 12;
  const teamCount = 12;
  const { slots, pool, finals } = makeConfig(poolCount, [], 0);
  const routes = buildRoutes(slots, pool, finals, teamCount, shuffledOrder(poolCount, 7));

  let worst = 0;
  for (let a = 0; a < teamCount; a++) {
    for (let b = 0; b < teamCount; b++) {
      if (a === b) continue;
      for (const gap of [1, 2, 3]) {
        let hits = 0;
        for (let m = gap; m < poolCount; m++) {
          if (routes[a][m] === routes[b][m - gap]) hits++;
        }
        worst = Math.max(worst, hits);
      }
    }
  }
  // Ancien algorithme : worst === poolCount (12) — suivi systématique.
  assert.ok(
    worst <= 4,
    `peloton détecté : jusqu'à ${worst} rangs consécutifs partagés (limite 4)`
  );
});

/**
 * Miroir JS de la version PAR BLOCS de start_game() : un bloc = un groupe lié
 * (ordonné) ou une étape seule. Le round-robin décale les blocs.
 */
function buildRoutesBlocks(
  slots: { common?: string; mobile?: boolean }[],
  blocks: string[][],
  starts: string[],
  finals: string[],
  teamCount: number,
  perm?: number[]
): string[][] {
  const b = blocks.length;
  const order = perm ?? Array.from({ length: b }, (_, i) => i);
  const routes: string[][] = [];
  for (let k = 0; k < teamCount; k++) {
    const offset = teamOffset(k, b, teamCount);
    let m = 0;
    const route: string[] = [...starts];
    for (const slot of slots) {
      if (slot.common != null) {
        route.push(slot.common);
      } else {
        route.push(...blocks[(order[m] + offset) % b]);
        m++;
      }
    }
    route.push(...finals);
    routes.push(route);
  }
  return routes;
}

test("chaînes : un groupe lié reste soudé et dans l'ordre pour chaque équipe", () => {
  // Groupe A = [A1, A2, A3] + 3 étapes seules + 1 palier commun + 1 finale
  const blocks = [["A1", "A2", "A3"], ["B"], ["C"], ["D"]];
  const slots = [{ mobile: true }, { mobile: true }, { common: "K" }, { mobile: true }, { mobile: true }];
  const routes = buildRoutesBlocks(slots, blocks, ["START"], ["F"], 3, shuffledOrder(blocks.length));
  const expected = ["START", "A1", "A2", "A3", "B", "C", "D", "K", "F"].sort();
  for (const route of routes) {
    // complétude
    assert.deepEqual([...route].sort(), expected);
    // A1→A2→A3 collés et ordonnés
    const i1 = route.indexOf("A1");
    assert.equal(route[i1 + 1], "A2");
    assert.equal(route[i1 + 2], "A3");
    // départ et finale à leur place
    assert.equal(route[0], "START");
    assert.equal(route[route.length - 1], "F");
  }
  // Palier commun : présent une fois pour chaque équipe, au même RANG de bloc
  // (2 blocs avant lui) — l'index absolu varie car les blocs ont des tailles
  // différentes, c'est attendu.
  for (const route of routes) {
    const before = route.slice(1, route.indexOf("K")); // sans START
    const blocksBefore = new Set(before.map((s) => s[0])).size; // A/B/C/D → nb de blocs
    assert.equal(blocksBefore, 2, `K devrait suivre 2 blocs, ${before.join(",")}`);
  }
});

test("chaînes : anti-collision au niveau des blocs (jamais 2 équipes sur le même bloc au même rang)", () => {
  const blocks = [["A1", "A2"], ["B"], ["C"], ["D"], ["E"]];
  const slots = blocks.map(() => ({ mobile: true as const }));
  for (const teamCount of [2, 3, 4, 5]) {
    const routes = buildRoutesBlocks(slots, blocks, [], [], teamCount, shuffledOrder(blocks.length));
    // reconstruire la suite de blocs de chaque équipe (par 1re étape du bloc)
    const firsts = blocks.map((blk) => blk[0]);
    const seqs = routes.map((r) => r.filter((s) => firsts.includes(s)));
    for (let rank = 0; rank < blocks.length; rank++) {
      const atRank = seqs.map((s) => s[rank]);
      assert.equal(
        new Set(atRank).size,
        teamCount,
        `collision bloc rang=${rank} teams=${teamCount} : ${atRank.join(",")}`
      );
    }
  }
});
