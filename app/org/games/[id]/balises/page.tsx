"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { sb } from "@/lib/supabase/client";
import { tagUrl } from "@/lib/game/codes";
import type { Game, Step, StepSecrets } from "@/lib/types";
import { useOrgAuth } from "@/components/org/useOrgAuth";
import { showToast } from "@/components/ui/Toaster";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

interface Balise {
  step: Step;
  tagId: string;
  manualCode: string;
  qrDataUrl: string;
}

export default function BalisesPage() {
  const { user, loading } = useOrgAuth();
  const params = useParams<{ id: string }>();
  const gameId = params.id;

  const [game, setGame] = useState<Game | null>(null);
  const [balises, setBalises] = useState<Balise[] | null>(null);
  const [nfcStatus, setNfcStatus] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;

  useEffect(() => {
    setIsLocalhost(window.location.hostname === "localhost");
  }, []);

  const load = useCallback(async () => {
    const [gameRes, stepsRes] = await Promise.all([
      sb().from("games").select("*").eq("id", gameId).single(),
      sb().from("steps").select("*").eq("game_id", gameId).eq("type", "nfc").order("order_hint"),
    ]);
    setGame(gameRes.data as Game);
    const steps = (stepsRes.data as Step[]) ?? [];
    if (!steps.length) {
      setBalises([]);
      return;
    }
    const { data: secs, error: secErr } = await sb()
      .from("step_secrets")
      .select("*")
      .in("step_id", steps.map((s) => s.id));
    if (secErr) {
      // Sans les secrets, on afficherait à tort « aucune balise »
      showToast("Chargement des balises impossible — recharge la page.", "error");
      return;
    }
    const secMap = new Map(((secs as StepSecrets[]) ?? []).map((s) => [s.step_id, s]));
    const out: Balise[] = [];
    for (const step of steps) {
      const sec = secMap.get(step.id);
      if (!sec?.nfc_tag_id) continue;
      out.push({
        step,
        tagId: sec.nfc_tag_id,
        manualCode: sec.manual_code ?? "",
        // Le QR encode l'URL complète : scannable avec l'appareil photo natif,
        // il ouvre directement la page de validation (comme la puce NFC).
        qrDataUrl: await QRCode.toDataURL(tagUrl(sec.nfc_tag_id), {
          width: 400,
          margin: 1,
          color: { dark: "#111111", light: "#ffffff" },
        }),
      });
    }
    setBalises(out);
  }, [gameId]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  function markTagged() {
    try {
      localStorage.setItem(`toyah:tagged:${gameId}`, "1");
    } catch {
      /* noop */
    }
  }

  async function writeNfc(balise: Balise) {
    markTagged();
    setNfcStatus((s) => ({ ...s, [balise.step.id]: "⏳ Approche la puce NFC du téléphone…" }));
    try {
      const ndef = new NDEFReader();
      // Enregistrement URL : poser n'importe quel téléphone (iPhone inclus)
      // sur la puce ouvre directement la page de validation.
      await ndef.write({ records: [{ recordType: "url", data: tagUrl(balise.tagId) }] });
      setNfcStatus((s) => ({ ...s, [balise.step.id]: "✅ Puce écrite avec succès !" }));
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "accès NFC refusé — autorise-le quand Chrome le demande, puis réessaie"
          : err instanceof DOMException && err.name === "AbortError"
            ? "écriture annulée"
            : "vérifie que le NFC du téléphone est activé, puis réessaie";
      setNfcStatus((s) => ({ ...s, [balise.step.id]: `❌ Échec : ${reason}` }));
    }
  }

  if (loading || !user || balises === null) return <Spinner label="Chargement…" />;

  return (
    <main className="min-h-dvh px-5 py-6 max-w-2xl mx-auto bg-white text-ink print:p-2">
      <header className="mb-6 print:hidden">
        <Link href={`/org/games/${gameId}/edit`} className="font-bold text-ink/50 underline">
          ← Retour à l&apos;éditeur
        </Link>
        <div className="flex items-center justify-between mt-2 gap-3">
          <h1 className="font-display text-3xl">🏷️ Balises</h1>
          <Button
            onClick={() => {
              markTagged();
              window.print();
            }}
            variant="gold"
          >
            🖨️ Imprimer
          </Button>
        </div>
        <p className="font-bold text-ink/60 mt-2">
          Chaque puce NFC et chaque QR contient une <strong>URL</strong> : les joueurs posent
          simplement leur téléphone dessus (ou scannent le QR avec l&apos;appareil photo) et la
          validation s&apos;ouvre toute seule — iPhone comme Android. Écris les puces ci-dessous
          (Chrome Android requis pour l&apos;écriture uniquement) ou imprime la page.
        </p>
        {isLocalhost && (
          <p className="font-bold text-crimson mt-2 text-sm">
            ⚠️ Tu es sur localhost : les URLs encodées pointeraient vers ton PC. Écris les puces
            et imprime les QR depuis le site déployé (toyah-games.vercel.app).
          </p>
        )}
        {!nfcSupported && (
          <p className="font-bold text-crimson mt-2 text-sm">
            ⚠️ Web NFC indisponible sur ce navigateur — utilise Chrome sur Android pour écrire les
            puces. Les QR codes et codes manuels fonctionnent partout.
          </p>
        )}
        <p className="font-bold text-leaf mt-2 text-sm">
          🧪 Mode test : une fois tes puces écrites, scanne-les toi-même (connecté à TON compte
          organisateur) → un écran vert « Balise OK ! » confirme qu&apos;elles marchent, sans rien
          valider.
        </p>
      </header>

      {game && (
        <p className="hidden print:block font-display text-xl mb-4">
          {game.name} — code partie : {game.code}
        </p>
      )}

      {balises.length === 0 ? (
        <p className="font-bold text-ink/60">
          Aucune étape de type « Balise NFC » dans cette partie.
        </p>
      ) : (
        <div className="space-y-6">
          {balises.map((balise) => (
            <div
              key={balise.step.id}
              className="rounded-2xl border-[3px] border-ink p-4 flex flex-col sm:flex-row gap-4 items-center break-inside-avoid"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={balise.qrDataUrl}
                alt={`QR ${balise.tagId}`}
                className="w-44 h-44 sm:w-36 sm:h-36 shrink-0 border-2 border-ink rounded-lg"
              />
              <div className="min-w-0 w-full">
                <h2 className="font-display text-xl leading-tight">{balise.step.title}</h2>
                <p className="font-mono text-sm text-ink/60 break-all mt-1">{tagUrl(balise.tagId)}</p>
                <div className="mt-1.5 print:hidden">
                  <Button
                    size="sm"
                    variant="gold"
                    onClick={async () => {
                      await navigator.clipboard.writeText(tagUrl(balise.tagId));
                      markTagged();
                      setCopiedId(balise.step.id);
                      setTimeout(() => setCopiedId(null), 1800);
                    }}
                  >
                    {copiedId === balise.step.id ? "✅ Copié !" : "📋 Copier le lien"}
                  </Button>
                </div>
                <p className="font-bold mt-2">
                  Code de secours :{" "}
                  <span className="font-mono text-2xl tracking-[0.2em] bg-parchment px-2 py-0.5 rounded-lg border-2 border-ink">
                    {balise.manualCode}
                  </span>
                </p>
                {nfcSupported && (
                  <div className="mt-3 print:hidden">
                    <Button size="sm" variant="leaf" onClick={() => writeNfc(balise)}>
                      📡 Écrire la puce NFC
                    </Button>
                    {nfcStatus[balise.step.id] && (
                      <p className="text-sm font-bold mt-1">{nfcStatus[balise.step.id]}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
