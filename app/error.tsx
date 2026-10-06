"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CONFIG_MANQUANTE } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Logo from "@/components/ui/Logo";

/**
 * Écran d'erreur — remplace le « Application error: a client-side exception
 * has occurred » brut de Next, qui ne dit rien à un joueur et pas grand-chose
 * à l'organisateur.
 *
 * Deux registres : le joueur voit une panne et un bouton pour réessayer ; la
 * cause technique reste lisible en petit, parce que celui qui tombe sur une
 * erreur de configuration, c'est justement la personne qui peut la corriger.
 */
export default function ErrorScreen({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const config = error.message.includes(CONFIG_MANQUANTE);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-8 px-5 py-10 pt-safe-page pb-safe-page">
      <Link href="/">
        <Logo className="w-64 max-w-[70vw]" />
      </Link>

      <Card className="w-full max-w-sm p-6 text-center">
        <div className="text-5xl">{config ? "🔌" : "🌊"}</div>
        <h1 className="font-display text-2xl mt-2 leading-tight">
          {config ? "L'app n'est pas reliée à sa base" : "Oups, une vague a tout emporté !"}
        </h1>
        <p className="font-bold text-ink/65 text-sm mt-3 leading-relaxed">
          {config
            ? "La chasse ne peut pas être chargée : la mise en service n'est pas terminée. Préviens l'organisateur."
            : "Ta progression est enregistrée. Réessaie — si ça recommence, préviens l'organisateur."}
        </p>

        <Button full size="lg" className="mt-6" onClick={reset}>
          🔄 RÉESSAYER
        </Button>

        <p className="font-bold text-ink/40 text-xs mt-6 leading-relaxed break-words">
          {error.message}
          {error.digest && ` (${error.digest})`}
        </p>
      </Card>
    </main>
  );
}
