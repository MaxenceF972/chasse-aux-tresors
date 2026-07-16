import { isMuted } from "./prefs";

/** Vibrations (Vibration API) — silencieusement ignorées si non supportées. */
function vibrate(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator && !isMuted()) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* noop */
    }
  }
}

export const haptics = {
  success: () => vibrate([40, 60, 40, 60, 120]),
  fail: () => vibrate([90, 50, 90]),
  tap: () => vibrate(15),
  scan: () => vibrate([20, 30, 20]),
};
