/**
 * Sons courts synthétisés (Web Audio) — zéro asset, zéro chargement.
 * Les navigateurs exigent un geste utilisateur avant de jouer du son :
 * tous les appels partent d'un handler de clic/scan, c'est le cas ici.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
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
