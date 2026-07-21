"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toast: Toast) => void;
let listener: Listener | null = null;
let nextId = 1;

/** Affiche un toast depuis n'importe où (le <Toaster/> est monté dans le layout). */
export function showToast(message: string, kind: ToastKind = "info") {
  listener?.({ id: nextId++, kind, message });
}

const KIND_STYLE: Record<ToastKind, string> = {
  success: "bg-leaf text-parchment",
  error: "bg-crimson text-parchment",
  info: "bg-ink text-parchment",
};

const KIND_ICON: Record<ToastKind, string> = {
  success: "✅",
  error: "⚠️",
  info: "ℹ️",
};

export default function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    listener = (toast) => {
      setToasts((list) => [...list.slice(-2), toast]);
      setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== toast.id));
      }, 4000);
    };
    return () => {
      listener = null;
    };
  }, []);

  return (
    <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] inset-x-4 z-[70] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            initial={{ y: -30, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))}
            className={`pointer-events-auto max-w-md w-full rounded-xl border-[3px] border-ink px-4 py-2.5 font-bold text-sm text-left shadow-[4px_4px_0_0_#111111] ${KIND_STYLE[toast.kind]}`}
          >
            {KIND_ICON[toast.kind]} {toast.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
