"use client";

import { ReactNode, useCallback, useRef, useState } from "react";
import Dialog from "./Dialog";
import Button from "./Button";

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Remplace window.confirm (peu fiable en PWA plein écran) par un vrai dialog.
 * Usage :
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (await confirm({ title: "Terminer ?", danger: true })) { … }
 *   // et rendre {confirmDialog} dans le JSX
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOptions(null);
  }, []);

  const confirmDialog: ReactNode = (
    <Dialog open={!!options} onClose={() => close(false)} title={options?.title ?? ""}>
      <div className="space-y-4">
        {options?.message && <p className="font-bold text-ink/75">{options.message}</p>}
        <div className="flex gap-2">
          <Button className="flex-1" variant="parchment" onClick={() => close(false)}>
            {options?.cancelLabel ?? "Annuler"}
          </Button>
          <Button
            className="flex-1"
            variant={options?.danger ? "crimson" : "gold"}
            onClick={() => close(true)}
          >
            {options?.confirmLabel ?? "Confirmer"}
          </Button>
        </div>
      </div>
    </Dialog>
  );

  return { confirm, confirmDialog };
}
