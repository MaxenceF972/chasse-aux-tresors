"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt, seededShuffle } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";

const SUSPECTS = [
  { name: "Barbe-Rousse", icon: "🧔" },
  { name: "La Vigie", icon: "🔭" },
  { name: "Coco", icon: "🦜" },
  { name: "Sabre-d'Or", icon: "⚔️" },
];

const CATS = [
  {
    name: "Chapeau",
    icon: "🎩",
    verbPos: "porte",
    verbNeg: "ne porte pas",
    objects: ["le tricorne", "le bandana", "le bicorne", "le chapeau de paille"],
    shorts: ["tricorne", "bandana", "bicorne", "paille"],
  },
  {
    name: "Animal",
    icon: "🐾",
    verbPos: "garde",
    verbNeg: "ne garde pas",
    objects: ["le perroquet", "le singe", "le chat noir", "le rat"],
    shorts: ["perroquet", "singe", "chat", "rat"],
  },
  {
    name: "Cachette",
    icon: "🕯️",
    verbPos: "se cache",
    verbNeg: "ne se cache pas",
    objects: ["à la taverne", "au phare", "dans la cale", "sur la plage"],
    shorts: ["taverne", "phare", "cale", "plage"],
  },
];

// a[cat][suspect] = index de valeur — chaque catégorie est une permutation
type Assign = number[][];

interface Clue {
  text: string;
  test: (a: Assign) => boolean;
}

const PERMS: number[][] = (() => {
  const out: number[][] = [];
  const items = [0, 1, 2, 3];
  const rec = (current: number[], rest: number[]) => {
    if (!rest.length) {
      out.push(current);
      return;
    }
    rest.forEach((v, i) => rec([...current, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  rec([], items);
  return out;
})();

/** Compte les affectations compatibles avec les indices (arrêt à `limit`). */
function countSolutions(clues: Clue[], limit: number): number {
  let count = 0;
  for (const p0 of PERMS) {
    for (const p1 of PERMS) {
      for (const p2 of PERMS) {
        const a = [p0, p1, p2];
        if (clues.every((clue) => clue.test(a))) {
          count++;
          if (count >= limit) return count;
        }
      }
    }
  }
  return count;
}

interface Puzzle {
  truth: Assign;
  clues: Clue[];
  thief: number;
  thiefClue: string;
}

function generatePuzzle(seed: string, hard: boolean): Puzzle {
  const rand = rngFromSeed(`logic:${seed}`);
  const truth: Assign = [
    seededShuffle([0, 1, 2, 3], rand),
    seededShuffle([0, 1, 2, 3], rand),
    seededShuffle([0, 1, 2, 3], rand),
  ];

  const pred = (cat: number, v: number, neg = false) =>
    `${neg ? CATS[cat].verbNeg : CATS[cat].verbPos} ${CATS[cat].objects[v]}`;
  const ownerOf = (a: Assign, cat: number, v: number) => a[cat].indexOf(v);

  // Banque de candidats, des plus retors aux plus directs
  const links: Clue[] = [];
  const negLinks: Clue[] = [];
  const negDirects: Clue[] = [];
  const posDirects: Clue[] = [];

  const pairs: [number, number][] = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];
  for (const [ca, cb] of pairs) {
    for (let s = 0; s < 4; s++) {
      const va = truth[ca][s];
      const vb = truth[cb][s];
      links.push({
        text: `Celui qui ${pred(ca, va)} ${pred(cb, vb)}.`,
        test: (a) => a[cb][ownerOf(a, ca, va)] === vb,
      });
      // faux appariement (vrai indice négatif)
      const otherS = (s + 1 + seededInt(rand, 3)) % 4;
      const wrongVb = truth[cb][otherS];
      negLinks.push({
        text: `Celui qui ${pred(ca, va)} ${pred(cb, wrongVb, true)}.`,
        test: (a) => a[cb][ownerOf(a, ca, va)] !== wrongVb,
      });
    }
  }
  for (let cat = 0; cat < 3; cat++) {
    for (let s = 0; s < 4; s++) {
      const wrong = (truth[cat][s] + 1 + seededInt(rand, 3)) % 4;
      negDirects.push({
        text: `${SUSPECTS[s].name} ${pred(cat, wrong, true)}.`,
        test: (a) => a[cat][s] !== wrong,
      });
      posDirects.push({
        text: `${SUSPECTS[s].name} ${pred(cat, truth[cat][s])}.`,
        test: (a) => a[cat][s] === truth[cat][s],
      });
    }
  }

  const pool = [
    ...seededShuffle([...links, ...negLinks], rand),
    ...seededShuffle(negDirects, rand),
    ...seededShuffle(posDirects, rand),
  ];

  // Glouton : on n'ajoute un indice que s'il réduit l'espace des solutions
  const clues: Clue[] = [];
  let count = countSolutions(clues, Number.MAX_SAFE_INTEGER); // 13 824 au départ
  for (const candidate of pool) {
    if (count === 1) break;
    const withCandidate = countSolutions([...clues, candidate], count);
    if (withCandidate < count) {
      clues.push(candidate);
      count = withCandidate;
    }
  }

  // Mode difficile : on retire tout indice redondant (jeu minimal)
  if (hard) {
    for (let i = clues.length - 1; i >= 0; i--) {
      const without = clues.filter((_, j) => j !== i);
      if (countSolutions(without, 2) === 1) clues.splice(i, 1);
    }
  }

  const thief = seededInt(rand, 4);
  const thiefCat = seededInt(rand, 3);
  const thiefClue = `Le voleur est celui qui ${pred(thiefCat, truth[thiefCat][thief])} !`;

  return { truth, clues: seededShuffle(clues, rand), thief, thiefClue };
}

type Mark = 0 | 1 | 2; // vide | ✗ | ✓

function LogicGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as { difficulty?: string };
  const hard = cfg.difficulty === "difficile";

  const puzzle = useMemo(() => generatePuzzle(seed, hard), [seed, hard]);

  const [marks, setMarks] = useState<Mark[][][]>(() =>
    CATS.map(() => Array.from({ length: 4 }, () => Array<Mark>(4).fill(0)))
  );
  const [attempts, setAttempts] = useState(0);
  const [accusing, setAccusing] = useState<number | null>(null);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  function tapMark(cat: number, s: number, v: number) {
    if (won) return;
    sfx.tick();
    setMarks((m) =>
      m.map((grid, ci) => {
        if (ci !== cat) return grid;
        const current = grid[s][v];
        const next: Mark = current === 0 ? 1 : current === 1 ? 2 : 0;
        return grid.map((row, si) =>
          row.map((cell, vi) => {
            if (si === s && vi === v) return next;
            // poser un ✓ élimine le reste de la ligne et de la colonne
            if (next === 2 && (si === s || vi === v)) return 1 as Mark;
            return cell;
          })
        );
      })
    );
  }

  function accuse(s: number) {
    if (s === puzzle.thief) {
      setWon(true);
      setAccusing(null);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () => onComplete({ score: Math.max(100, 1000 - attempts * 200), durationMs }),
        1800
      );
    } else {
      setAccusing(null);
      setAttempts((a) => a + 1);
      sfx.fail();
      haptics.fail();
      setWrongFlash(true);
      setTimeout(() => setWrongFlash(false), 700);
    }
  }

  return (
    <div className={`space-y-4 ${wrongFlash ? "animate-shake" : ""}`}>
      <p className="font-bold text-ink/70">
        🕵️ Le trésor a disparu ! Quatre suspects, des indices… Croisez tout dans les grilles
        (touchez une case : vide → ✗ → ✓) et démasquez le coupable.
      </p>

      {/* L'indice du voleur */}
      <p className="rounded-xl border-[3px] border-crimson bg-crimson/10 p-3 font-display text-crimson">
        ⚠️ {puzzle.thiefClue}
      </p>

      {/* Les indices */}
      <ol className="parchment-texture rounded-xl border-[3px] border-ink p-3 pl-8 space-y-1 list-decimal">
        {puzzle.clues.map((clue, i) => (
          <li key={i} className="font-bold text-ink/85 text-sm leading-snug">
            {clue.text}
          </li>
        ))}
      </ol>

      {/* Grilles de déduction */}
      {CATS.map((cat, ci) => (
        <div key={cat.name}>
          <p className="font-display text-sm text-ink/70 mb-1">
            {cat.icon} {cat.name.toUpperCase()}
          </p>
          <div
            className="grid gap-[3px]"
            style={{ gridTemplateColumns: "minmax(5rem, auto) repeat(4, 1fr)" }}
          >
            <div />
            {cat.shorts.map((short) => (
              <div
                key={short}
                className="text-center font-bold text-[10px] text-ink/60 leading-tight self-end pb-0.5"
              >
                {short}
              </div>
            ))}
            {SUSPECTS.map((suspect, s) => (
              <div key={suspect.name} className="contents">
                <div className="font-bold text-xs text-ink/75 flex items-center gap-1 pr-1">
                  {suspect.icon} {suspect.name}
                </div>
                {cat.shorts.map((_, v) => {
                  const mark = marks[ci][s][v];
                  return (
                    <button
                      key={v}
                      onClick={() => tapMark(ci, s, v)}
                      aria-label={`${suspect.name} / ${cat.shorts[v]}`}
                      className={`h-10 rounded-md border-2 border-ink font-display text-base ${
                        mark === 2
                          ? "bg-leaf text-parchment"
                          : mark === 1
                            ? "bg-white text-crimson/70"
                            : "bg-white/60 text-transparent"
                      }`}
                    >
                      {mark === 2 ? "✓" : mark === 1 ? "✗" : "·"}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Accusation */}
      {won ? (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          {SUSPECTS[puzzle.thief].icon} C&apos;ÉTAIT {SUSPECTS[puzzle.thief].name.toUpperCase()} !
        </p>
      ) : accusing !== null ? (
        <div className="rounded-xl border-[3px] border-ink p-3 space-y-2">
          <p className="font-bold text-center">
            Accuser {SUSPECTS[accusing].icon} <strong>{SUSPECTS[accusing].name}</strong> ?
            {attempts === 0 ? " (sois sûr de toi…)" : ""}
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" variant="crimson" onClick={() => accuse(accusing)}>
              🫵 J&apos;ACCUSE !
            </Button>
            <Button className="flex-1" variant="parchment" onClick={() => setAccusing(null)}>
              Attendre
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <p className="font-display text-sm text-ink/70 mb-1.5">🫵 QUI EST LE VOLEUR ?</p>
          <div className="grid grid-cols-2 gap-2">
            {SUSPECTS.map((suspect, s) => (
              <Button key={s} variant="parchment" size="sm" onClick={() => setAccusing(s)}>
                {suspect.icon} {suspect.name}
              </Button>
            ))}
          </div>
          {attempts > 0 && (
            <p className="text-center text-sm font-bold text-crimson mt-2">
              {attempts} fausse{attempts > 1 ? "s" : ""} accusation{attempts > 1 ? "s" : ""} — il
              avait un alibi !
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LogicEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as { difficulty?: string };
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2">
          {[
            { v: "normal", label: "🟡 Normal", help: "indices généreux" },
            { v: "difficile", label: "🔴 Difficile", help: "le strict minimum d'indices" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() => onChange({ ...value, difficulty: o.v })}
              className={`flex-1 p-2 rounded-xl border-[3px] border-ink text-left ${
                (cfg.difficulty ?? "normal") === o.v ? "bg-gold" : "bg-white"
              }`}
            >
              <span className="font-display text-sm">{o.label}</span>
              <span className="block text-xs font-bold text-ink/60">{o.help}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Énigme façon « énigme d&apos;Einstein » : suspects, indices croisés et grilles de
        déduction. Générée pour chaque équipe avec solution unique garantie. Prévois 10 à 20
        minutes — le meilleur casse-tête pour souder une équipe !
      </p>
    </div>
  );
}

export const logicDef: MiniGameDef = {
  kind: "logic",
  name: "Qui a volé le trésor ?",
  icon: "🕵️",
  description: "Logigramme de déduction façon énigme d'Einstein",
  needsAnswer: false,
  defaultConfig: { difficulty: "normal" },
  Component: LogicGame,
  ConfigEditor: LogicEditor,
};
