"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { frError, sb } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { Input, Label } from "@/components/ui/Input";
import Logo from "@/components/ui/Logo";

export default function OrgLoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      // Écrase une éventuelle session joueur anonyme sur ce device
      const { data } = await sb().auth.getSession();
      if (data.session?.user.is_anonymous) await sb().auth.signOut();

      if (mode === "login") {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/org/dashboard");
      } else {
        const { data: res, error } = await sb().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/org/login` },
        });
        if (error) throw error;
        if (res.session) {
          router.replace("/org/dashboard");
        } else {
          setMessage({
            kind: "info",
            text: "Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.",
          });
          setMode("login");
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Erreur inconnue";
      const text = /invalid login credentials/i.test(raw)
        ? "Email ou mot de passe incorrect."
        : /email not confirmed/i.test(raw)
          ? "Email non confirmé — vérifie ta boîte mail."
          : /at least 6/i.test(raw)
            ? "Le mot de passe doit faire au moins 6 caractères."
            : frError(err, "Connexion impossible — réessaie");
      setMessage({ kind: "error", text });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-10 gap-8">
      <Link href="/">
        <Logo className="w-64 max-w-[70vw]" />
      </Link>

      <Card className="w-full max-w-sm p-6">
        <h1 className="font-display text-2xl mb-1">
          {mode === "login" ? "Connexion" : "Créer un compte"}
        </h1>
        <p className="font-bold text-ink/60 text-sm mb-5">
          Espace organisateur — crée et pilote tes chasses au trésor.
        </p>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="capitaine@toyah.games"
            />
          </div>
          <div>
            <Label>Mot de passe</Label>
            <Input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {message && (
            <p
              className={`font-bold text-sm ${
                message.kind === "error" ? "text-crimson" : "text-leaf"
              }`}
            >
              {message.text}
            </p>
          )}

          <Button type="submit" full size="lg" disabled={busy}>
            {busy ? "…" : mode === "login" ? "⚓ SE CONNECTER" : "🏴‍☠️ CRÉER LE COMPTE"}
          </Button>
        </form>

        <button
          className="mt-4 w-full text-center font-bold text-ink/60 underline"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage(null);
          }}
        >
          {mode === "login" ? "Pas de compte ? Inscris-toi" : "Déjà un compte ? Connecte-toi"}
        </button>
      </Card>
    </main>
  );
}
