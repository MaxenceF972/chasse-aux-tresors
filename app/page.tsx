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
  const [resume, setResume] = useState<{ code: string; label: string } | null>(null);

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
          setResume({
            code: session.code,
            label: lobby.game.status === "lobby" ? "⛺ RETOURNER AU LOBBY" : "⚡ REPRENDRE MA PARTIE",
          });
        }
      } catch {
        // hors-ligne : on propose quand même, l'écran de jeu gérera
        if (!cancelled) setResume({ code: session.code, label: "⚡ REPRENDRE MA PARTIE" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center gap-10 px-6 py-12 relative overflow-hidden">
      {/* Décor */}
      <div className="absolute top-8 left-6 text-4xl opacity-20 animate-wiggle select-none" aria-hidden>🧭</div>
      <div className="absolute bottom-24 right-8 text-4xl opacity-20 animate-floaty select-none" aria-hidden>🗝️</div>
      <div className="absolute top-24 right-10 text-3xl opacity-15 animate-floaty [animation-delay:1s] select-none" aria-hidden>🦜</div>
      <div className="absolute bottom-40 left-8 text-3xl opacity-15 animate-wiggle [animation-delay:0.6s] select-none" aria-hidden>💰</div>

      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -6 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="animate-floaty"
      >
        <Logo className="w-64 max-w-[70vw]" />
      </motion.div>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-center text-parchment/80 font-bold text-lg max-w-xs"
      >
        La chasse au trésor en temps réel, sur ton téléphone. 🏴‍☠️
      </motion.p>

      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <Link href="/play" className="contents">
          <Button size="xl" full variant="gold">
            🗺️ REJOINDRE UNE PARTIE
          </Button>
        </Link>
        {resume && (
          <Link href={`/play/${resume.code}/game`} className="contents">
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

      <p className="text-parchment/40 text-sm font-bold absolute bottom-5">
        TOYAH GAMES © {new Date().getFullYear()}
      </p>
    </main>
  );
}
