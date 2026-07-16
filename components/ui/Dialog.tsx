"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ReactNode, useEffect } from "react";

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  title?: string;
  fullScreen?: boolean;
}

export default function Dialog({ open, onClose, children, title, fullScreen }: DialogProps) {
  // Verrouille le scroll de la page derrière le dialog
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

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
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 60, scale: 0.95, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 60, scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            className={
              fullScreen
                ? "relative z-10 w-full h-[100dvh] overflow-y-auto overscroll-contain parchment-texture text-ink pt-safe"
                : "relative z-10 w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto overscroll-contain parchment-texture text-ink rounded-t-3xl sm:rounded-3xl border-[3px] border-ink shadow-[6px_6px_0_0_#111111] m-0 sm:m-4"
            }
          >
            {title && (
              <div className="sticky top-0 z-10 parchment-texture border-b-[3px] border-ink px-4 py-2.5 flex items-center justify-between gap-3">
                <h2 className="font-display text-xl min-w-0 truncate">{title}</h2>
                {onClose && (
                  <button
                    onClick={onClose}
                    aria-label="Fermer"
                    className="w-11 h-11 shrink-0 rounded-full bg-crimson text-parchment border-[3px] border-ink font-display text-lg leading-none shadow-[2px_2px_0_0_#111111] active:translate-y-[2px] active:shadow-none"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <div className={fullScreen ? "pb-safe" : "p-4 sm:p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
