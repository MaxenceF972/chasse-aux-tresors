"use client";

import { useRef, useState } from "react";
import { uploadMedia } from "@/lib/game/media";
import { frError } from "@/lib/supabase/client";
import { Label } from "@/components/ui/Input";

interface ImageFieldProps {
  label: string;
  gameId: string;
  urls: string[];
  max?: number;
  onChange: (urls: string[]) => void;
}

/** Upload d'images de configuration de mini-jeu (taquin, memory). */
export default function ImageField({ label, gameId, urls, max = 1, onChange }: ImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...urls];
      for (const file of Array.from(files).slice(0, max - urls.length)) {
        next.push(await uploadMedia(gameId, file));
      }
      onChange(next);
    } catch (err) {
      setError(frError(err, "Envoi du fichier impossible — réessaie"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {urls.map((url, i) => (
          <div key={url} className="relative w-20 h-20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`Image ${i + 1}`}
              className="w-full h-full object-cover rounded-lg border-[3px] border-ink"
            />
            <button
              type="button"
              aria-label="Supprimer l'image"
              onClick={() => onChange(urls.filter((u) => u !== url))}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-crimson text-parchment border-2 border-ink text-xs font-bold"
            >
              ✕
            </button>
          </div>
        ))}
        {urls.length < max && (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="w-20 h-20 rounded-lg border-[3px] border-dashed border-ink/40 text-3xl text-ink/50 hover:border-ink hover:text-ink transition-colors disabled:opacity-50"
          >
            {busy ? "⏳" : "＋"}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple={max > 1}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="text-crimson text-sm font-bold mt-1">{error}</p>}
    </div>
  );
}
