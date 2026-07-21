"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ensureAnonSession, frError, rpc } from "@/lib/supabase/client";
import type { LobbyState } from "@/lib/types";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import Logo from "@/components/ui/Logo";

export default function JoinPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await ensureAnonSession();
      const lobby = await rpc<LobbyState>("get_lobby", { p_code: code.trim() });
      if (lobby.error || !lobby.game) {
        setError("Partie introuvable — vérifie le code ! 🧐");
        setBusy(false);
        return;
      }
      router.push(`/play/${lobby.game.code}/lobby`);
    } catch (err) {
      setError(frError(err, "Connexion impossible — réessaie"));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-10 gap-8">
      <Link href="/">
        <Logo className="w-44" />
      </Link>

      <Card className="w-full max-w-sm p-6">
        <h1 className="font-display text-2xl mb-1">Rejoindre une partie</h1>
        <p className="font-bold text-ink/60 text-sm mb-5">
          Demande le code à 6 caractères à ton organisateur.
        </p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Code de la partie</Label>
            <Input
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="TRSR42"
              maxLength={6}
              className="font-mono tracking-[0.4em] text-center text-3xl h-16"
              autoComplete="off"
              autoCapitalize="characters"
              enterKeyHint="go"
            />
          </div>
          {error && <p className="text-crimson font-bold text-sm">{error}</p>}
          <Button type="submit" full size="xl" disabled={busy || code.length < 6}>
            {busy ? "…" : "🗺️ EN AVANT !"}
          </Button>
        </form>
      </Card>

      <Link href="/" className="font-bold text-parchment/70 underline py-2 inline-block">
        ← Retour à l&apos;accueil
      </Link>
    </main>
  );
}
