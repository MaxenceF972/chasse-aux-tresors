import { test } from "node:test";
import assert from "node:assert/strict";
import { caesarShift } from "@/components/minigames/Caesar";
import { encodeMorse, decodeMorse } from "@/components/minigames/Morse";
import { feedback } from "@/components/minigames/Mastermind";
import { generatePuzzle, countSolutions } from "@/components/minigames/LogicPuzzle";
import { genMaze, type Cell } from "@/components/minigames/Maze";
import { LEVELS, parseLevel } from "@/components/minigames/Sokoban";
import { rngFromSeed } from "@/lib/game/prng";

// --- César ------------------------------------------------------------------

test("césar : chiffrer puis déchiffrer restitue le message", () => {
  for (const shift of [1, 3, 13, 25]) {
    const plain = "LE TRESOR EST SOUS LE CHENE 42";
    assert.equal(caesarShift(caesarShift(plain, shift), -shift), plain);
  }
});

// --- Morse ------------------------------------------------------------------

test("morse : encoder puis décoder restitue le message", () => {
  for (const msg of ["SOS", "CHERCHEZ LE PUITS", "RDV 21 H"]) {
    assert.equal(decodeMorse(encodeMorse(msg)), msg);
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

// --- Logigramme ---------------------------------------------------------------

test("logigramme : solution unique garantie, vérité cohérente (10 seeds)", () => {
  for (let i = 0; i < 10; i++) {
    for (const hard of [false, true]) {
      const puzzle = generatePuzzle(`team-${i}:step-logic`, hard);
      assert.equal(countSolutions(puzzle.clues, 2), 1, `seed ${i} hard=${hard} non unique`);
      assert.ok(
        puzzle.clues.every((clue) => clue.test(puzzle.truth)),
        `seed ${i} hard=${hard} : un indice contredit la vérité`
      );
      assert.ok(puzzle.thief >= 0 && puzzle.thief < 4);
      assert.ok(puzzle.clues.length >= 4 && puzzle.clues.length <= 25);
    }
  }
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
