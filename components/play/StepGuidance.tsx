"use client";

import { useState } from "react";
import type { StepContent, StepType } from "@/lib/types";
import { normalizeThresholds } from "@/lib/game/hotcold";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import GpsCompass from "./GpsCompass";
import GpsHotCold from "./GpsHotCold";
import RdvMap from "./RdvMap";

interface StepGuidanceProps {
  step: {
    id: string;
    type: StepType;
    content: StepContent;
    gps_target?: { lat: number; lng: number; radius: number } | null;
  };
}

/**
 * Guidage vers le lieu d'une épreuve qui N'EST PAS une balise GPS (énigme,
 * balise NFC, mini-jeu, photo) : carte, boussole ou chaud/froid, au choix de
 * l'organisateur. Arriver ne valide rien — ça dit juste « vous êtes au bon
 * endroit, cherchez ! », et la validation reste l'épreuve elle-même.
 *
 * Boussole et chaud/froid n'affichent JAMAIS la carte : c'est tout l'intérêt.
 */
export default function StepGuidance({ step }: StepGuidanceProps) {
  const [arrived, setArrived] = useState(false);
  // Arrivé → on replie le guidage : il a fait son travail, et il cesse de
  // pomper la batterie pendant que l'équipe fouille. Relançable d'un bouton.
  const [showGuide, setShowGuide] = useState(true);

  // La balise GPS gère son propre guidage (l'arrivée y VALIDE l'étape)
  if (step.type === "gps") return null;

  const rdv = step.content.rdv;
  const mode = step.content.gps_guidance;
  const guidance =
    mode === "compass" || mode === "hotcold" ? mode : rdv ? "map" : null;
  if (!guidance) return null;

  function markArrived() {
    if (arrived) return;
    setArrived(true);
    setShowGuide(false);
    sfx.pop();
    haptics.success();
  }

  // Carte : le lieu est montré en clair, avec l'itinéraire
  if (guidance === "map") {
    if (!rdv) return null;
    return (
      <div className="rounded-2xl border-[3px] border-ink bg-gold p-3 shadow-[4px_4px_0_0_#111111] space-y-2">
        <p className="font-display text-lg">📍 POINT DE RENDEZ-VOUS</p>
        <RdvMap lat={rdv.lat} lng={rdv.lng} />
        <div className="flex items-center justify-between gap-2">
          <p className="font-bold text-ink/70 text-sm">
            L&apos;épreuve se joue à cet endroit — cherchez sur place !
          </p>
          <a
            href={`https://maps.google.com/?q=${rdv.lat},${rdv.lng}`}
            target="_blank"
            rel="noreferrer"
            className="contents"
          >
            <Button size="sm" variant="outline" className="shrink-0">
              🧭 ITINÉRAIRE
            </Button>
          </a>
        </div>
      </div>
    );
  }

  const arrivedBanner = arrived ? (
    <>
      <p className="rounded-xl border-[3px] border-ink bg-leaf px-3 py-2 text-center font-display text-parchment">
        🎯 VOUS Y ÊTES — CHERCHEZ SUR PLACE !
      </p>
      {!showGuide && (
        <Button full size="sm" variant="outline" onClick={() => setShowGuide(true)}>
          🔁 RELANCER LE GUIDAGE
        </Button>
      )}
    </>
  ) : null;

  // Boussole : flèche + distance, sans carte
  if (guidance === "compass") {
    const target = step.gps_target ?? null;
    return (
      <div className="rounded-2xl border-[3px] border-ink bg-gold p-3 shadow-[4px_4px_0_0_#111111] space-y-2">
        <p className="font-display text-lg">🧭 LE LIEU DE L&apos;ÉPREUVE</p>
        {target ? (
          <>
            {showGuide && (
              <GpsCompass
                target={target}
                onUpdate={(_lat, _lng, d) => {
                  if (d <= target.radius) markArrived();
                }}
                withinLabel="Vous y êtes ! Cherchez sur place 🔎"
              />
            )}
            {arrivedBanner}
            {showGuide && (
              <p className="font-bold text-ink/70 text-sm">
                Suivez la flèche jusqu&apos;au lieu : c&apos;est là que se joue l&apos;épreuve.
              </p>
            )}
          </>
        ) : (
          <p className="font-bold text-ink/70 text-sm">
            Guidage boussole indisponible sur ce téléphone — l&apos;énoncé vous mène au lieu,
            et le maître du jeu peut vous aider.
          </p>
        )}
      </div>
    );
  }

  // Chaud / froid : thermomètre seul, la position du lieu reste secrète
  return (
    <div className="rounded-2xl border-[3px] border-ink bg-gold p-3 shadow-[4px_4px_0_0_#111111] space-y-2">
      <p className="font-display text-lg">🔥 CHAUD OU FROID ?</p>
      {showGuide && (
        <GpsHotCold
          stepId={step.id}
          thresholds={normalizeThresholds(
            step.content.gps_hotcold_thresholds,
            step.content.gps_hotcold_range
          )}
          onPosition={() => {}}
          onWithin={markArrived}
          withinLabel="Vous y êtes ! Cherchez sur place 🔎"
        />
      )}
      {arrivedBanner}
      {showGuide && (
        <p className="font-bold text-ink/70 text-sm">
          Le thermomètre chauffe en approchant du lieu de l&apos;épreuve. Ni carte ni direction :
          à vous de fouiller.
        </p>
      )}
    </div>
  );
}
