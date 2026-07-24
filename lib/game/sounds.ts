/**
 * Sons courts synthétisés (Web Audio) — zéro asset, zéro chargement.
 * Les navigateurs exigent un geste utilisateur avant de jouer du son :
 * tous les appels partent (directement ou après un await) d'un geste, et le
 * contexte est amorcé dès le premier contact tactile.
 */

import { isMuted } from "./prefs";

let ctx: AudioContext | null = null;

function makeCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return AC ? new AC() : null;
  } catch {
    return null;
  }
}

/**
 * Réveille un contexte EXISTANT (événement HORS geste : visibilitychange). On
 * n'en crée jamais ici : sans geste utilisateur, iOS le créerait bloqué en
 * "suspended" sans pouvoir le reprendre.
 */
function wake() {
  if (!ctx) return;
  if (ctx.state === "closed") {
    ctx = null;
    return;
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => {});
}

/**
 * Sur GESTE utilisateur : on peut créer le contexte et le (re)démarrer. L'amorcer
 * dès le 1er tap le rend « running » AVANT le 1er son — or ce son est souvent
 * joué après un await (succès d'une validation), donc détaché du geste. Sans cet
 * amorçage, ce premier son (et ceux qui suivent un retour d'arrière-plan)
 * partaient sur un contexte encore suspendu et étaient perdus « par moments ».
 */
function prime() {
  if (!ctx || ctx.state === "closed") ctx = makeCtx();
  if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });
  // Le tout premier contact amorce l'audio (capture = avant tout autre handler).
  window.addEventListener("pointerdown", prime, { capture: true, passive: true });
  window.addEventListener("touchstart", prime, { capture: true, passive: true });
}

function audio(): AudioContext | null {
  if (typeof window === "undefined" || isMuted()) return null;
  try {
    if (!ctx || ctx.state === "closed") ctx = makeCtx();
    return ctx;
  } catch {
    return null;
  }
}

export function tone(
  freq: number,
  duration = 0.18,
  type: OscillatorType = "square",
  volume = 0.12,
  delay = 0
) {
  const ac = audio();
  if (!ac) return;

  const emit = () => {
    // Reprise échouée (ex. iOS sans geste) : on saute proprement plutôt que de
    // programmer sur une horloge figée (note fantôme).
    if (ac.state !== "running") return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };

  // Contexte suspendu/interrompu (retour d'arrière-plan, coupure iOS) : la
  // reprise est ASYNCHRONE. Programmer la note pendant que l'horloge est encore
  // figée la fait sauter → on attend que le contexte tourne vraiment.
  if (ac.state === "running") emit();
  else ac.resume().then(emit).catch(() => {});
}

export const sfx = {
  /** Validation réussie : petit arpège doré */
  success() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, "square", 0.11, i * 0.09));
  },
  /** Mauvaise réponse */
  fail() {
    tone(170, 0.25, "sawtooth", 0.12);
    tone(120, 0.35, "sawtooth", 0.12, 0.13);
  },
  /** Fin de partie / trésor trouvé */
  fanfare() {
    [523, 523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.2, "square", 0.11, i * 0.13));
  },
  tick() {
    tone(880, 0.05, "square", 0.05);
  },
  pop() {
    tone(440, 0.08, "triangle", 0.1);
    tone(660, 0.08, "triangle", 0.08, 0.06);
  },
  /** Tons des 4 pads du Simon */
  pad(i: number, duration = 0.3) {
    tone([392, 523, 659, 784][i % 4], duration, "triangle", 0.16);
  },
};
