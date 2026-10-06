"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ensureAnonSession, rpc } from "@/lib/supabase/client";
import { clearPlayerSession, getPlayerSession } from "@/lib/game/session";
import type { LobbyState } from "@/lib/types";
import Logo from "@/components/ui/Logo";
import Button from "@/components/ui/Button";

export default function LandingPage() {
  const [resume, setResume] = useState<{ code: string; label: string; href: string } | null>(
    null
  );

  // N'affiche « Reprendre » que si la partie mémorisée est encore en cours.
  useEffect(() => {
    const session = getPlayerSession();
    if (!session?.code) return;
    let cancelled = false;
    (async () => {
      try {
        await ensureAnonSession();
        const lobby = await rpc<LobbyState>("get_lobby", { p_code: session.code });
        if (cancelled) return;
        if (!lobby.game || lobby.game.status === "finished" || !lobby.me) {
          clearPlayerSession();
        } else {
          // Équipe formée mais pas encore partie (jeu en continu, ou partie
          // pas encore lancée) : c'est au lobby qu'on la retrouve, pas sur
          // l'écran d'énigme.
          const monEquipe = lobby.teams?.find((t) => t.id === lobby.me!.team_id);
          const partie =
            monEquipe?.started_at != null ||
            (monEquipe?.started_at === undefined && lobby.game.status !== "lobby");
          setResume({
            code: session.code,
            label: partie ? "⚡ REPRENDRE MA PARTIE" : "⛺ RETROUVER MON ÉQUIPE",
            href: partie ? `/play/${session.code}/game` : `/play/${session.code}/lobby`,
          });
        }
      } catch {
        // hors-ligne : on propose quand même, l'écran de jeu gérera
        if (!cancelled)
          setResume({
            code: session.code,
            label: "⚡ REPRENDRE MA PARTIE",
            href: `/play/${session.code}/game`,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center px-6 py-8 pt-safe">
      {/* Les entrées animent la POSITION, jamais l'opacité : un `initial:
          opacity 0` rend la page BLANCHE tant que le JavaScript n'a pas
          hydraté — sur une connexion lente, l'accueil se lisait comme une
          panne. Là, le contenu est visible dès le HTML, et l'animation
          s'ajoute ensuite. */}
      <div className="my-auto flex flex-col items-center gap-8 w-full">
      <motion.div
        initial={{ scale: 0.85, rotate: -6 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="animate-floaty"
      >
        <Logo className="w-[34rem] max-w-[94vw]" />
      </motion.div>

      <motion.p
        initial={{ y: 12 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-center text-parchment/80 font-bold text-lg max-w-xs"
      >
        La chasse au trésor en temps réel, sur ton téléphone.
      </motion.p>

      <motion.div
        initial={{ y: 16 }}
        animate={{ y: 0 }}
        transition={{ delay: 0.35 }}
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <Link href="/play" className="contents">
          <Button size="xl" full variant="gold">
            🗺️ REJOINDRE UNE PARTIE
          </Button>
        </Link>
        {resume && (
          <Link href={resume.href} className="contents">
            <Button size="lg" full variant="leaf">
              {resume.label}
            </Button>
          </Link>
        )}
        <Link href="/org/dashboard" className="contents">
          <Button size="lg" full variant="crimson">
            🧭 ESPACE ORGANISATEUR
          </Button>
        </Link>
      </motion.div>

      </div>
      <p className="text-parchment/60 text-sm font-bold mt-8 pb-safe">
        TOYAH GAMES © {new Date().getFullYear()}
      </p>
    </main>
  );
}
