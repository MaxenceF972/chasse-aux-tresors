"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  title?: string;
  fullScreen?: boolean;
}

export default function Dialog({ open, onClose, children, title, fullScreen }: DialogProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-ink/80 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ y: 60, scale: 0.95, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={
              fullScreen
                ? "relative z-10 w-full h-[100dvh] overflow-y-auto parchment-texture text-ink"
                : "relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto parchment-texture text-ink rounded-t-3xl sm:rounded-3xl border-[3px] border-ink shadow-[6px_6px_0_0_#111111] m-0 sm:m-4"
            }
          >
            {title && (
              <div className="sticky top-0 z-10 parchment-texture border-b-[3px] border-ink px-5 py-3 flex items-center justify-between">
                <h2 className="font-display text-xl">{title}</h2>
                {onClose && (
                  <button
                    onClick={onClose}
                    aria-label="Fermer"
                    className="w-9 h-9 rounded-full bg-crimson text-parchment border-[3px] border-ink font-display text-base leading-none shadow-[2px_2px_0_0_#111111] active:translate-y-[2px] active:shadow-none"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <div className={fullScreen ? "" : "p-5"}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
