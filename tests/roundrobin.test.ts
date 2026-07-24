import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Miroir JS exact de l'algorithme de start_game() (supabase/setup.sql) :
 * si ce test casse, le SQL doit être re-vérifié.
 */
interface Slot {
  id: string;
  common: boolean;
}

function buildRoutes(slots: Slot[], poolOrder: string[], finals: string[], teamCount: number): string[][] {
  const n = poolOrder.length;
  const routes: string[][] = [];
  for (let k = 0; k < teamCount; k++) {
    const offset = n > 0 ? (k * Math.max(1, Math.floor(n / teamCount))) % n : 0;
    let poolIndex = 0;
    const route: string[] = [];
    for (const slot of slots) {
      if (slot.common) {
        route.push(slot.id);
      } else {
        route.push(poolOrder[(poolIndex + offset) % n]);
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
  ] as [number, number][]) {
    const { slots, pool, finals } = makeConfig(poolCount, [2], 1);
    const routes = buildRoutes(slots, pool, finals, teamCount);

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

test("round-robin : chaque équipe parcourt chaque étape exactement une fois", () => {
  const { slots, pool, finals } = makeConfig(6, [1, 4], 1);
  const routes = buildRoutes(slots, pool, finals, 3);
  const expected = [...pool, "common-1", "common-4", "final-0"].sort();
  for (const route of routes) {
    assert.deepEqual([...route].sort(), expected);
  }
});

test("round-robin : la finale est toujours en dernière position", () => {
  const { slots, pool, finals } = makeConfig(5, [], 1);
  const routes = buildRoutes(slots, pool, finals, 4);
  for (const route of routes) {
    assert.equal(route[route.length - 1], "final-0");
  }
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
  teamCount: number
): string[][] {
  const b = blocks.length;
  const routes: string[][] = [];
  for (let k = 0; k < teamCount; k++) {
    const offset = b > 0 ? (k * Math.max(1, Math.floor(b / teamCount))) % b : 0;
    let m = 0;
    const route: string[] = [...starts];
    for (const slot of slots) {
      if (slot.common != null) {
        route.push(slot.common);
      } else {
        route.push(...blocks[(m + offset) % b]);
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
  const routes = buildRoutesBlocks(slots, blocks, ["START"], ["F"], 3);
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
    const routes = buildRoutesBlocks(slots, blocks, [], [], teamCount);
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
