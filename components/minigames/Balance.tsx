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

function BalanceGame({ config, seed, onComplete }: MiniGameProps) {
  const cfg = config as unknown as BalanceConfig;
  const coins = Math.min(12, Math.max(6, cfg.coins || 9));
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
    if (!left.length || !right.length || weighingsLeft <= 0) return;
    const weightOf = (list: number[]) => list.reduce((sum, i) => sum + (i === heavy ? 2 : 1), 0);
    const wl = weightOf(left);
    const wr = weightOf(right);
    const verdict: Weighing["verdict"] = wl > wr ? "L" : wr > wl ? "R" : "E";
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

  return (
    <div className="space-y-4">
      <p className="font-bold text-ink/70">
        ⚖️ L&apos;une de ces pièces d&apos;or est <strong>plus lourde</strong> que les autres !
        Répartis des pièces sur les deux plateaux, pèse ({maxWeighings} pesées max), puis accuse
        la coupable.
      </p>

      {/* La balance */}
      <div className="flex flex-col items-center">
        <div
          className="text-6xl transition-transform duration-500 select-none"
          style={{
            transform:
              lastVerdict === "L" ? "rotate(-8deg)" : lastVerdict === "R" ? "rotate(8deg)" : "none",
          }}
          aria-hidden
        >
          ⚖️
        </div>
        <p className="font-display text-sm text-ink/60 h-5">
          {lost
            ? ""
            : lastVerdict === "L"
              ? "⬅️ Le plateau GAUCHE penche !"
              : lastVerdict === "R"
                ? "Le plateau DROIT penche ! ➡️"
                : lastVerdict === "E"
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
      <p className="text-center text-xs font-bold text-ink/50 -mt-2">
        {accusing
          ? "🫵 Touche la pièce que tu accuses !"
          : "Touche une pièce : 🟢 plateau gauche → 🔴 plateau droit → reposée."}
      </p>

      {/* Actions */}
      {!won && !lost && (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            variant="leaf"
            onClick={weigh}
            disabled={
              accusing ||
              weighingsLeft <= 0 ||
              !pans.includes("L") ||
              !pans.includes("R")
            }
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
                (cfg.coins ?? 9) === o.coins && (cfg.weighings ?? 3) === o.weighings
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
        Le grand classique de logique : accuser sans réfléchir fait échanger la pièce truquée !
        Générée pour chaque équipe.
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
  defaultConfig: { coins: 9, weighings: 3 },
  Component: BalanceGame,
  ConfigEditor: BalanceEditor,
};
