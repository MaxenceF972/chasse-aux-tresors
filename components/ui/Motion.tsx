"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Respecte « Réduire les animations » du téléphone.
 *
 * Le réglage existe dans iOS et Android, et les gens qui l'activent le font
 * souvent parce que le mouvement leur donne mal au cœur. Nos animations
 * passaient toutes par Framer Motion, qui ignore la préférence tant qu'on ne
 * la lui donne pas : `reducedMotion="user"` coupe les déplacements et les
 * mises à l'échelle, et ne garde que les fondus.
 *
 * Le CSS, lui, est traité dans app/globals.css.
 */
export default function Motion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
