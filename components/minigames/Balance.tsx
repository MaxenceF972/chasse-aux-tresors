"use client";

import { useMemo, useRef, useState } from "react";
import type { ConfigEditorProps, MiniGameDef, MiniGameProps } from "./types";
import { rngFromSeed, seededInt } from "@/lib/game/prng";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import { Label } from "@/components/ui/Input";

interface BalanceConfig {
  coins: number;
  weighings: number;
}

type Pan = "L" | "R" | null;

interface Weighing {
  left: number[];
  right: number[];
  verdict: "L" | "R" | "E";
}

/**
 * Le verdict d'une pesée — sorti du composant pour être vérifiable.
 *
 * Rend `null` quand les plateaux ne sont pas comparables : une balance ne
 * renseigne QUE si elle porte autant de pièces d'un côté que de l'autre.
 * C'était le bug du jeu : la somme brute était comparée telle quelle, si bien
 * que deux pièces dont la lourde (1+2 = 3) contre trois pièces ordinaires (3)
 * annonçaient « parfait équilibre » alors que la pièce truquée était sur un
 * plateau — l'inverse exact de la vérité, et une déduction impossible.
 */
export function peser(
  left: readonly number[],
  right: readonly number[],
  heavy: number
): Weighing["verdict"] | null {
  if (left.length === 0 || left.length !== right.length) return null;
  const poids = (l: readonly number[]) => l.reduce((sum, i) => sum + (i === heavy ? 2 : 1), 0);
  const wl = poids(left);
  const wr = poids(right);
  return wl > wr ? "L" : wr > wl ? "R" : "E";
}

function BalanceGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as BalanceConfig;
  const coins = Math.min(12, Math.max(6, cfg.coins || 8));
  const maxWeighings = Math.min(5, Math.max(2, cfg.weighings || 3));

  const [attempt, setAttempt] = useState(0);
  const [pans, setPans] = useState<Pan[]>(() => Array(coins).fill(null));
  const [history, setHistory] = useState<Weighing[]>([]);
  const [accusing, setAccusing] = useState(false);
  const [lost, setLost] = useState(false);
  const [won, setWon] = useState(false);
  const startRef = useRef(Date.now());

  // La pièce truquée, différente à chaque tentative ratée
  const heavy = useMemo(
    () => seededInt(rngFromSeed(`balance:${seed}:${attempt}`), coins),
    [seed, attempt, coins]
  );

  const weighingsLeft = maxWeighings - history.length;
  const nbGauche = pans.filter((v) => v === "L").length;
  const nbDroite = pans.filter((v) => v === "R").length;
  // UNE BALANCE COMPARE DES PLATEAUX, PAS DES TAS : elle ne renseigne que si
  // les deux plateaux portent AUTANT de pièces. On l'exige donc (voir peser).
  const plateauxComparables = nbGauche > 0 && nbGauche === nbDroite;

  function tapCoin(i: number) {
    if (won || lost) return;
    if (accusing) {
      accuse(i);
      return;
    }
    sfx.tick();
    haptics.tap();
    setPans((p) =>
      p.map((v, j) => (j === i ? (v === null ? "L" : v === "L" ? "R" : null) : v))
    );
  }

  function weigh() {
    const left = pans.flatMap((v, i) => (v === "L" ? [i] : []));
    const right = pans.flatMap((v, i) => (v === "R" ? [i] : []));
    if (weighingsLeft <= 0) return;
    const verdict = peser(left, right, heavy);
    if (verdict === null) return; // plateaux inégaux : la balance ne dit rien
    setHistory((h) => [...h, { left, right, verdict }]);
    setPans(Array(coins).fill(null));
    sfx.pop();
    haptics.scan();
  }

  function accuse(i: number) {
    setAccusing(false);
    if (i === heavy) {
      setWon(true);
      sfx.success();
      haptics.success();
      const durationMs = Date.now() - startRef.current;
      setTimeout(
        () =>
          onComplete({
            score: Math.max(100, 1000 - attempt * 200 - history.length * 30),
            durationMs,
          }),
        1100
      );
    } else {
      sfx.fail();
      haptics.fail();
      setLost(true);
      setTimeout(() => {
        setLost(false);
        setAttempt((a) => a + 1); // nouvelle pièce truquée, pesées remises à zéro
        setHistory([]);
        setPans(Array(coins).fill(null));
      }, 1800);
    }
  }

  const lastVerdict = history[history.length - 1]?.verdict;
  // La balance ne montre le verdict que tant que les plateaux sont vides. Dès
  // qu'on repose une pièce dessus, elle revient à l'horizontale : sinon elle
  // reste penchée de la pesée PRÉCÉDENTE pendant qu'on prépare la suivante, et
  // on croit lire un résultat qui n'existe pas encore. L'historique garde tout.
  const enPlacement = nbGauche + nbDroite > 0;
  const inclinaison = enPlacement ? undefined : lastVerdict;

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        ⚖️ L&apos;une de ces pièces d&apos;or est <strong>plus lourde</strong> que les autres !
        Pose-en <strong>autant de chaque côté</strong> de la balance — elle ne compare que des
        plateaux égaux — pèse ({maxWeighings} pesées max), puis accuse la coupable.
      </p>

      {/* La balance */}
      <div className="flex flex-col items-center">
        <div
          className="text-6xl transition-transform duration-500 select-none"
          style={{
            transform:
              inclinaison === "L" ? "rotate(-8deg)" : inclinaison === "R" ? "rotate(8deg)" : "none",
          }}
          aria-hidden
        >
          ⚖️
        </div>
        <p className="font-display text-sm text-ink/60 h-5">
          {lost
            ? ""
            : inclinaison === "L"
              ? "⬅️ Le plateau GAUCHE penche !"
              : inclinaison === "R"
                ? "Le plateau DROIT penche ! ➡️"
                : inclinaison === "E"
                  ? "⚖️ Parfait équilibre."
                  : "Répartis des pièces puis pèse."}
        </p>
      </div>

      {/* Les pièces */}
      <div className="flex flex-wrap justify-center gap-2">
        {Array.from({ length: coins }, (_, i) => {
          const pan = pans[i];
          return (
            <button
              key={i}
              onClick={() => tapCoin(i)}
              aria-label={`Pièce ${i + 1}`}
              className={`w-12 h-12 rounded-full border-[3px] font-display text-lg transition-all ${
                accusing
                  ? "border-crimson bg-gold animate-wiggle"
                  : pan === "L"
                    ? "border-ink bg-leaf text-parchment -translate-y-1"
                    : pan === "R"
                      ? "border-ink bg-crimson text-parchment -translate-y-1"
                      : "border-ink bg-gold text-ink"
              }`}
            >
              {i + 1}
            </button>
          );
        })}
      </div>
      {/* Le compte de chaque plateau, en toutes lettres : c'est la seule chose
          qui explique pourquoi « Peser » reste éteint. */}
      <p className="text-center text-xs font-bold text-ink/50 -mt-2 tabular-nums">
        {accusing ? (
          "🫵 Touche la pièce que tu accuses !"
        ) : enPlacement ? (
          <>
            🟢 Gauche {nbGauche} · 🔴 droite {nbDroite}
            {plateauxComparables ? "" : " — il en faut autant de chaque côté pour peser."}
          </>
        ) : (
          "Touche une pièce : 🟢 plateau gauche → 🔴 plateau droit → reposée."
        )}
      </p>

      {/* Actions */}
      {!won && !lost && (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant="leaf"
            onClick={weigh}
            disabled={accusing || weighingsLeft <= 0 || !plateauxComparables}
          >
            ⚖️ PESER ({weighingsLeft} restante{weighingsLeft > 1 ? "s" : ""})
          </Button>
          <Button
            className="flex-1"
            variant={accusing ? "parchment" : "crimson"}
            onClick={() => setAccusing((a) => !a)}
          >
            {accusing ? "Annuler" : "🫵 ACCUSER"}
          </Button>
        </div>
      )}

      {/* Historique des pesées */}
      {history.length > 0 && (
        <div className="space-y-1.5 rounded-xl border-[3px] border-ink/15 p-2.5">
          {history.map((w, i) => (
            <p key={i} className="font-bold text-sm text-ink/75">
              Pesée {i + 1} : [{w.left.map((c) => c + 1).join(", ")}] vs [
              {w.right.map((c) => c + 1).join(", ")}] →{" "}
              {w.verdict === "L" ? "⬅️ gauche plus lourd" : w.verdict === "R" ? "droit plus lourd ➡️" : "équilibre ⚖️"}
            </p>
          ))}
        </div>
      )}

      {lost && (
        <p className="text-center font-display text-xl text-crimson animate-stamp">
          ❌ MAUVAISE PIÈCE ! Le faussaire l&apos;a échangée… on recommence !
        </p>
      )}
      {won && (
        <p className="text-center font-display text-2xl text-leaf animate-stamp">
          🏆 PIÈCE TRUQUÉE DÉMASQUÉE !
        </p>
      )}
    </div>
  );
}

function BalanceEditor({ value, onChange }: ConfigEditorProps) {
  const cfg = value as unknown as BalanceConfig;
  return (
    <div className="space-y-3">
      <div>
        <Label>Difficulté</Label>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: "🟢 8 pièces / 3 pesées", coins: 8, weighings: 3 },
            { label: "🟡 9 pièces / 2 pesées", coins: 9, weighings: 2 },
            { label: "🔴 12 pièces / 3 pesées", coins: 12, weighings: 3 },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => onChange({ ...value, coins: o.coins, weighings: o.weighings })}
              className={`px-3 h-11 rounded-xl border-[3px] border-ink font-display text-sm ${
                (cfg.coins ?? 8) === o.coins && (cfg.weighings ?? 3) === o.weighings
                  ? "bg-gold"
                  : "bg-white"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-sm font-bold text-ink/60">
        Le grand classique de logique : les plateaux doivent porter autant de pièces l&apos;un
        que l&apos;autre (c&apos;est la règle de la balance). Accuser sans réfléchir fait échanger
        la pièce truquée ! Générée pour chaque équipe.
      </p>
    </div>
  );
}

export const balanceDef: MiniGameDef = {
  kind: "balance",
  name: "La pièce truquée",
  icon: "⚖️",
  description: "Démasquer la pièce la plus lourde en un nombre limité de pesées",
  needsAnswer: false,
  // Doit correspondre à l'une des trois difficultés proposées, sinon l'éditeur
  // s'ouvre sans aucune d'elles sélectionnée.
  defaultConfig: { coins: 8, weighings: 3 },
  Component: BalanceGame,
  ConfigEditor: BalanceEditor,
};
