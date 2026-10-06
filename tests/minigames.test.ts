import { test } from "node:test";
import assert from "node:assert/strict";
import { caesarShift } from "@/components/minigames/Caesar";
import { feedback } from "@/components/minigames/Mastermind";
import { genMaze, type Cell } from "@/components/minigames/Maze";
import { LEVELS, parseLevel } from "@/components/minigames/Sokoban";
import { peser } from "@/components/minigames/Balance";
import { rngFromSeed } from "@/lib/game/prng";

// --- César ------------------------------------------------------------------

test("césar : chiffrer puis déchiffrer restitue le message", () => {
  for (const shift of [1, 3, 13, 25]) {
    const plain = "LE TRESOR EST SOUS LE CHENE 42";
    assert.equal(caesarShift(caesarShift(plain, shift), -shift), plain);
  }
});

// --- Mastermind ---------------------------------------------------------------

test("mastermind : pions noirs/blancs corrects (doublons inclus)", () => {
  assert.deepEqual(feedback([0, 1, 2, 3], [0, 1, 2, 3]), { black: 4, white: 0 });
  assert.deepEqual(feedback([0, 1, 2, 3], [3, 2, 1, 0]), { black: 0, white: 4 });
  assert.deepEqual(feedback([0, 1, 2, 3], [0, 2, 1, 5]), { black: 1, white: 2 });
  assert.deepEqual(feedback([0, 0, 1, 1], [0, 1, 0, 0]), { black: 1, white: 2 });
  assert.deepEqual(feedback([0, 0, 0, 0], [0, 0, 1, 1]), { black: 2, white: 0 });
  assert.deepEqual(feedback([1, 2, 3, 4], [5, 5, 5, 5]), { black: 0, white: 0 });
});

// --- Labyrinthe ---------------------------------------------------------------

test("labyrinthe : parfait (toutes les cases atteignables) pour chaque taille", () => {
  for (const size of [9, 11, 13]) {
    for (let s = 0; s < 5; s++) {
      const maze = genMaze(size, rngFromSeed(`maze:test-${s}`));
      const seen = new Set<string>(["0,0"]);
      const queue: [number, number][] = [[0, 0]];
      while (queue.length) {
        const [x, y] = queue.shift()!;
        const cell: Cell = maze[y][x];
        const moves: [boolean, number, number][] = [
          [!cell.n, x, y - 1],
          [!cell.s, x, y + 1],
          [!cell.w, x - 1, y],
          [!cell.e, x + 1, y],
        ];
        for (const [open, nx, ny] of moves) {
          if (open && nx >= 0 && ny >= 0 && nx < size && ny < size && !seen.has(`${nx},${ny}`)) {
            seen.add(`${nx},${ny}`);
            queue.push([nx, ny]);
          }
        }
      }
      assert.equal(seen.size, size * size, `labyrinthe ${size}x${size} seed ${s} non connexe`);
    }
  }
});

// --- Sokoban -------------------------------------------------------------------

/** Solveur BFS : prouve que chaque niveau embarqué est résoluble. */
function solvable(map: string[]): boolean {
  const { walls, targets, initial, rows, cols } = parseLevel(map);
  const key = (r: number, c: number) => r * cols + c;
  const stateKey = (player: [number, number], boxes: Set<string>) =>
    `${player[0]},${player[1]}|${[...boxes].sort().join(";")}`;
  const isWin = (boxes: Set<string>) => [...targets].every((t) => boxes.has(t));

  const queue: { player: [number, number]; boxes: Set<string> }[] = [initial];
  const seen = new Set([stateKey(initial.player, initial.boxes)]);
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let iterations = 0;

  while (queue.length) {
    if (++iterations > 500_000) return false;
    const { player, boxes } = queue.shift()!;
    if (isWin(boxes)) return true;
    for (const [dr, dc] of dirs) {
      const nr = player[0] + dr;
      const nc = player[1] + dc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      const nk = `${nr},${nc}`;
      if (walls.has(nk)) continue;
      let newBoxes = boxes;
      if (boxes.has(nk)) {
        const br = nr + dr;
        const bc = nc + dc;
        const bk = `${br},${bc}`;
        if (br < 0 || bc < 0 || br >= rows || bc >= cols || walls.has(bk) || boxes.has(bk)) continue;
        newBoxes = new Set(boxes);
        newBoxes.delete(nk);
        newBoxes.add(bk);
      }
      const sk = stateKey([nr, nc], newBoxes);
      if (!seen.has(sk)) {
        seen.add(sk);
        queue.push({ player: [nr, nc], boxes: newBoxes });
      }
    }
  }
  return false;
}

test("sokoban : les 6 niveaux embarqués sont résolubles", () => {
  LEVELS.forEach((level, i) => {
    assert.ok(solvable(level.map), `niveau ${i + 1} (tier ${level.tier}) insoluble !`);
  });
});

/* ------------------------------------------------------------------------- *
 * La pièce truquée : une balance ne compare que des plateaux ÉGAUX
 * ------------------------------------------------------------------------- */

test("pesée : plateaux égaux — le verdict désigne bien le côté de la pièce lourde", () => {
  // 9 pièces, la n°2 (indice 1) est la lourde.
  assert.equal(peser([0, 1, 2], [3, 4, 5], 1), "L");
  assert.equal(peser([3, 4, 5], [0, 1, 2], 1), "R");
  assert.equal(peser([3, 4, 5], [6, 7, 8], 1), "E", "la lourde est hors des plateaux");
  assert.equal(peser([0], [1], 1), "R");
});

test("pesée : plateaux inégaux — la balance ne dit RIEN plutôt que de mentir", () => {
  // Le cas exact qui rendait le jeu insoluble : 2 pièces dont la lourde
  // (1+2 = 3) contre 3 pièces ordinaires (3) annonçait « parfait équilibre »,
  // donc que la pièce cherchée n'était sur aucun plateau — l'inverse du vrai.
  assert.equal(peser([0, 1], [2, 3, 4], 0), null);
  assert.equal(peser([0], [1, 2], 0), null);
  assert.equal(peser([], [], 0), null);
  assert.equal(peser([], [0], 0), null);
});

test("pesée : à plateaux égaux, un équilibre innocente TOUJOURS les deux plateaux", () => {
  // L'invariant dont dépend toute la déduction du joueur, vérifié pour chaque
  // position possible de la pièce lourde sur une partie à 12 pièces.
  const gauche = [0, 1, 2, 3];
  const droite = [4, 5, 6, 7];
  for (let heavy = 0; heavy < 12; heavy++) {
    const v = peser(gauche, droite, heavy);
    if (gauche.includes(heavy)) assert.equal(v, "L", `pièce ${heavy} à gauche`);
    else if (droite.includes(heavy)) assert.equal(v, "R", `pièce ${heavy} à droite`);
    else assert.equal(v, "E", `pièce ${heavy} hors balance`);
  }
});
