"use client";

import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";

interface SuccessOverlayProps {
  show: boolean;
  finished?: boolean;
  onDone: () => void;
}

/** Le "X" rouge s'abat sur la carte : validation réussie ! */
export default function SuccessOverlay({ show, finished, onDone }: SuccessOverlayProps) {
  const confetti = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        x: (Math.random() - 0.5) * 320,
        delay: Math.random() * 0.25,
        rotate: Math.random() * 360,
        color: ["#F5A623", "#C0392B", "#2E5E3A", "#EDE0C4"][i % 4],
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [show]
  );

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onDone, finished ? 2400 : 1900);
    return () => clearTimeout(t);
  }, [show, finished, onDone]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-ink/70 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Confettis */}
          {confetti.map((c, i) => (
            <motion.div
              key={i}
              className="absolute w-3 h-3 rounded-sm border border-ink"
              style={{ backgroundColor: c.color, top: "38%" }}
              initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
              animate={{ x: c.x, y: 300 + Math.random() * 150, opacity: 0, rotate: c.rotate }}
              transition={{ duration: 1.4, delay: c.delay, ease: "easeIn" }}
            />
          ))}

          <motion.div
            initial={{ scale: 3, rotate: -30, opacity: 0 }}
            animate={{ scale: 1, rotate: -8, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 14 }}
            className="font-display text-8xl text-crimson drop-shadow-[4px_4px_0_#111111] select-none"
          >
            ✗
          </motion.div>
          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 18 }}
            className="font-display text-4xl text-gold text-cartoon-outline mt-4 -rotate-2 select-none"
          >
            {finished ? "TRÉSOR TROUVÉ !" : "TROUVÉ !"}
          </motion.p>
          {finished && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="font-bold text-parchment mt-2"
            >
              Parcours terminé — direction le classement ! 🏆
            </motion.p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
