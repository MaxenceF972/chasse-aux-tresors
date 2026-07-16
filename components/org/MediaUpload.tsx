"use client";

import { useRef, useState } from "react";
import { uploadMedia, isVideoUrl } from "@/lib/game/media";
import { Label } from "@/components/ui/Input";

interface MediaUploadProps {
  gameId: string;
  urls: string[];
  onChange: (urls: string[]) => void;
}

/** Upload des médias d'une énigme (photos compressées WebP, vidéos ≤ 50 Mo). */
export default function MediaUpload({ gameId, urls, onChange }: MediaUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const next = [...urls];
      for (const file of Array.from(files)) {
        next.push(await uploadMedia(gameId, file));
      }
      onChange(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload impossible");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <Label>Photos / vidéo</Label>
      <div className="flex flex-wrap gap-2">
        {urls.map((url) => (
          <div key={url} className="relative w-24 h-24">
            {isVideoUrl(url) ? (
              <video src={url} className="w-full h-full object-cover rounded-lg border-[3px] border-ink" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt="" className="w-full h-full object-cover rounded-lg border-[3px] border-ink" />
            )}
            <button
              type="button"
              aria-label="Supprimer le média"
              onClick={() => onChange(urls.filter((u) => u !== url))}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-crimson text-parchment border-2 border-ink text-xs font-bold"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="w-24 h-24 rounded-lg border-[3px] border-dashed border-ink/40 text-ink/50 hover:border-ink hover:text-ink transition-colors disabled:opacity-50 flex flex-col items-center justify-center font-bold text-sm"
        >
          <span className="text-2xl">{busy ? "⏳" : "📷"}</span>
          {busy ? "Traitement…" : "Ajouter"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="text-crimson text-sm font-bold mt-1">{error}</p>}
    </div>
  );
}
