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
