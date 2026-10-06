"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import {
  plateforme,
  remedePosition,
  remedePrecision,
  type Plateforme,
  type Remede,
} from "@/lib/game/diagnostic";

interface GeoManquanteProps {
  cause: "refus" | "introuvable" | "absent";
  /** Relance la lecture de position. Absent = rien à réessayer ici. */
  onReessayer?: () => void;
}

/**
 * Ce qu'on affiche à la place d'une étape de terrain quand la position manque.
 *
 * Les trois composants de terrain (boussole, chaud/froid, balise silencieuse)
 * écrivaient chacun leur phrase, et chacun laissait tourner son cadran
 * par-dessous : un cercle qui « cherche le signal » sous un message disant que
 * la localisation est refusée, c'est-à-dire un appareil qui affirme chercher ce
 * qu'on vient de lui interdire. On enlève le cadran, et on donne la marche à
 * suivre — la vraie, celle de lib/game/diagnostic.ts, écrite pour l'appareil
 * qu'on a dans la main.
 */
export default function GeoManquante({ cause, onReessayer }: GeoManquanteProps) {
  // Lu après le montage : `navigator` n'existe pas au rendu serveur, et un
  // texte qui change entre les deux ferait crier React.
  const [plat, setPlat] = useState<Plateforme>("autre");
  useEffect(() => {
    setPlat(plateforme(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  return (
    <div className="rounded-2xl border-[3px] border-ink bg-white/70 p-4">
      <p className="font-display text-sm text-crimson">📍 LOCALISATION</p>
      <MarcheASuivre remede={remedePosition(plat, cause)} />
      {onReessayer && (
        <Button size="sm" variant="outline" className="mt-3" onClick={onReessayer}>
          🔄 Réessayer
        </Button>
      )}
      <p className="font-bold text-ink/50 text-xs leading-relaxed mt-3">
        Tu peux continuer sans : repère-toi avec l&apos;énoncé, ou passe l&apos;étape.
      </p>
    </div>
  );
}

/**
 * L'avertissement qui manquait le plus.
 *
 * Une position approximative laisse TOUT fonctionner en apparence — la
 * distance s'affiche, elle change même quand on marche — mais l'étape ne peut
 * pas se valider et l'aiguille ne s'affichera jamais. Le joueur tourne alors
 * en rond, persuadé de mal chercher, jusqu'à passer l'étape avec pénalité.
 * C'est le seul écran de terrain où il faut interrompre le jeu pour parler
 * d'un réglage.
 */
export function PositionApproximative({ precisionM }: { precisionM: number }) {
  const [plat, setPlat] = useState<Plateforme>("autre");
  useEffect(() => {
    setPlat(plateforme(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  return (
    <div className="rounded-xl border-[3px] border-crimson bg-white/70 p-3 mt-3 text-left">
      <p className="font-display text-sm text-crimson">⚠️ POSITION APPROXIMATIVE</p>
      <MarcheASuivre remede={remedePrecision(plat, precisionM)} />
      <p className="font-bold text-ink/50 text-xs leading-relaxed mt-3">
        Sans ça, l&apos;étape ne pourra pas se valider, même sur place.
      </p>
    </div>
  );
}

function MarcheASuivre({ remede }: { remede: Remede }) {
  return (
    <>
      <p className="font-display text-lg leading-snug mt-1.5">{remede.constat}</p>
      <ol className="mt-2.5 space-y-1.5">
        {remede.etapes.map((e, i) => (
          <li key={i} className="flex gap-2 font-bold text-ink/70 text-sm leading-relaxed">
            <span className="font-display text-gold-dark tabular-nums shrink-0">{i + 1}.</span>
            <span>{e}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
