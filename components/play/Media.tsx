"use client";

import { useState } from "react";
import { isAudioUrl, isVideoUrl } from "@/lib/game/media";

interface MediaProps {
  url: string;
  /** Décrit ce que le média montre — sert d'alternative et de repli. */
  legende?: string;
  /** Libellé au-dessus d'un son (« 🎵 MESSAGE AUDIO — écoutez bien ! »). */
  titreAudio?: string;
}

/**
 * Un média d'épreuve ou d'indice : image, vidéo ou son.
 *
 * Il GÈRE SON ÉCHEC. Un `<img>` dont la source ne répond pas laisse, sur
 * iPhone, un grand cadre vide barré d'un point d'interrogation bleu : le
 * joueur croit que l'application est cassée. On préfère l'admettre en une
 * phrase et proposer d'ouvrir le fichier à part — et, surtout, ne plus
 * occuper la moitié de l'écran avec un cadre mort.
 */
export default function Media({ url, legende, titreAudio }: MediaProps) {
  const [casse, setCasse] = useState(false);

  if (casse) {
    return (
      <div className="rounded-xl border-[3px] border-ink/30 bg-white/60 px-3 py-2.5 flex items-center gap-2.5">
        <span className="text-xl shrink-0" aria-hidden>
          🖼️
        </span>
        <p className="font-bold text-ink/60 text-sm flex-1 leading-snug">
          {legende ? `${legende} — ` : ""}
          média indisponible pour le moment.
        </p>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-display text-sm text-ink underline underline-offset-4 shrink-0"
        >
          Ouvrir
        </a>
      </div>
    );
  }

  if (isAudioUrl(url)) {
    return (
      <div className="rounded-2xl border-[3px] border-ink bg-white/70 shadow-[4px_4px_0_0_#111111] p-3">
        {titreAudio && <p className="font-display text-sm mb-2">{titreAudio}</p>}
        <audio
          src={url}
          controls
          preload="metadata"
          className="w-full"
          onError={() => setCasse(true)}
        />
      </div>
    );
  }

  if (isVideoUrl(url)) {
    return (
      <video
        src={url}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111] bg-ink"
        onError={() => setCasse(true)}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={legende ?? ""}
      loading="lazy"
      className="w-full rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_0_#111111]"
      onError={() => setCasse(true)}
    />
  );
}
