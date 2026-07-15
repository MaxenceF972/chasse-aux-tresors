"use client";

import { useState } from "react";

/**
 * Affiche /logo.png si présent dans public/, sinon un lettrage de secours
 * dans le style TOYAH (display + contours).
 */
export default function Logo({ className = "w-56" }: { className?: string }) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <div className={`${className} text-center select-none`}>
        <div className="font-display text-5xl text-parchment text-cartoon-outline -rotate-3">
          TOYAH
        </div>
        <div className="font-display text-2xl text-gold tracking-[0.3em] mt-1">GAMES</div>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="TOYAH GAMES"
      className={`${className} h-auto drop-shadow-[0_6px_0_rgba(0,0,0,0.4)]`}
      onError={() => setMissing(true)}
    />
  );
}
