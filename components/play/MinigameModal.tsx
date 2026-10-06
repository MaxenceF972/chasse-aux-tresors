"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MinigameKind } from "@/lib/types";
import type { MiniGameResult } from "@/components/minigames/types";
import { MINIGAMES } from "@/components/minigames/registry";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

interface MinigameModalProps {
  kind: MinigameKind;
  config: Record<string, unknown>;
  seed: string;
  onClose: () => void;
  /** true = validation acceptée (le modal se ferme côté parent) */
  onComplete: (result: MiniGameResult) => Promise<boolean>;
  /** Partie sans surveillance : on ne promet pas l'aide d'un maître du jeu. */
  unattended?: boolean;
}

/**
 * LE VERDICT DU SERVEUR EST CONSOMMÉ ICI, ET PAS DANS LES MINI-JEUX.
 *
 * La plupart des jeux appellent `onComplete(...)` sans attendre sa réponse :
 * quand le serveur refusait — partie mise en pause, étape modifiée entre-temps,
 * session expirée, réseau qui lâche — le plateau restait figé sur son écran de
 * victoire, sans un mot et sans issue. Un Hanoï à six disques, c'est cent
 * vingt-six tapes perdues.
 *
 * Le rattrapage vit ici parce que le modal est le SEUL consommateur de
 * `onComplete`, et parce que les deux familles de jeux ne veulent pas la même
 * chose d'un refus :
 *
 * - `needsAnswer: true` (César, Cadenas) — un refus VEUT DIRE « mauvaise
 *   réponse ». Le jeu s'en sert pour secouer le champ et laisser réessayer :
 *   on ne s'en mêle pas.
 * - `needsAnswer: false` (tous les autres) — le jeu est gagné, il n'y a rien
 *   à corriger. Un refus est forcément un ennui de machine, et la seule action
 *   utile est de renvoyer la même victoire.
 */
export default function MinigameModal({
  kind,
  config,
  seed,
  onClose,
  onComplete,
  unattended = false,
}: MinigameModalProps) {
  // Écran d'intro : le jeu (et son chrono interne) ne démarre qu'au GO,
  // le temps de lire les règles tranquillement.
  const [started, setStarted] = useState(false);
  // Victoire que le serveur a refusée, gardée telle quelle pour la renvoyer
  // à l'identique — le score et la durée sont ceux du jeu, pas de l'attente.
  const [refus, setRefus] = useState<MiniGameResult | null>(null);
  const [renvois, setRenvois] = useState(0);
  const [renvoiEnCours, setRenvoiEnCours] = useState(false);
  const [abandonDemande, setAbandonDemande] = useState(false);
  const panneauRef = useRef<HTMLDivElement>(null);

  const def = MINIGAMES[kind];
  const juge = def?.needsAnswer === false;

  const verdict = useCallback(
    async (result: MiniGameResult) => {
      let ok = false;
      try {
        ok = await onComplete(result);
      } catch {
        ok = false;
      }
      if (!ok && juge) setRefus(result);
      return ok;
    },
    [onComplete, juge]
  );

  // Le plateau peut être long : sur un téléphone, un message posé en tête de
  // panneau se retrouve hors de l'écran. On l'amène sous les yeux.
  useEffect(() => {
    if (refus) panneauRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [refus]);

  async function renvoyer() {
    if (!refus || renvoiEnCours) return;
    setRenvoiEnCours(true);
    let ok = false;
    try {
      ok = await onComplete(refus);
    } catch {
      ok = false;
    }
    setRenvoiEnCours(false);
    if (ok) setRefus(null);
    else setRenvois((n) => n + 1);
  }

  if (!def) {
    return (
      <Dialog open onClose={onClose} title="Mini-jeu">
        <p className="font-bold text-crimson">Mini-jeu inconnu : {kind}</p>
      </Dialog>
    );
  }

  // Une fois le jeu lancé, le voile ne ferme plus rien : il reste toujours une
  // bande tactile au-dessus du panneau, et un doigt qui s'y pose effaçait une
  // partie en cours sans rien demander. La croix, elle, demande confirmation.
  const fermeture = started && !refus ? () => setAbandonDemande(true) : onClose;

  return (
    <Dialog open onClose={fermeture} dismissible={!started} title={`${def.icon} ${def.name}`}>
      {refus && (
        <div
          ref={panneauRef}
          role="alert"
          className="mb-4 rounded-2xl border-[3px] border-ink bg-gold/30 p-4 space-y-3"
        >
          <p className="font-display text-sm text-leaf">🏆 ÉPREUVE GAGNÉE !</p>
          <p className="font-display text-xl leading-tight">
            Mais ta réussite n&apos;a pas pu être enregistrée.
          </p>
          <p className="font-bold text-sm text-ink/70 leading-relaxed">
            Tu as bien terminé le jeu — c&apos;est l&apos;envoi qui n&apos;est pas passé. La
            partie est peut-être en pause, ou le réseau a lâché au mauvais moment. Ta victoire est
            gardée : appuie pour la renvoyer.
          </p>
          <Button full size="lg" variant="leaf" onClick={renvoyer} disabled={renvoiEnCours}>
            {renvoiEnCours ? "Envoi…" : "🔁 RENVOYER MA RÉUSSITE"}
          </Button>
          {renvois >= 2 && (
            <p className="font-bold text-sm text-ink/60 leading-relaxed">
              {unattended
                ? "Toujours rien : l'incident est de notre côté, pas une erreur de ta part. Ferme cette fenêtre et prends « Bloqués ? Passer l'étape » — un mini-jeu se rattrape plus tard, et la pénalité saute quand tu le réussis."
                : "Toujours rien : l'incident est de notre côté, pas une erreur de ta part. Ferme cette fenêtre et préviens le maître du jeu (menu ☰) — il peut valider l'épreuve à ta place. Ou prends « Bloqués ? Passer l'étape » : un mini-jeu se rattrape plus tard, et la pénalité saute quand tu le réussis."}
            </p>
          )}
        </div>
      )}

      {/* La demande de confirmation se pose AU-DESSUS du plateau, elle ne le
          remplace pas : démonter le composant pour poser la question ferait
          perdre la partie qu'on est justement en train de protéger. */}
      {abandonDemande && (
        <div className="mb-4 rounded-2xl border-[3px] border-ink bg-crimson/10 p-4 space-y-3">
          <p className="font-display text-xl leading-tight">Quitter le mini-jeu ?</p>
          <p className="font-bold text-sm text-ink/70 leading-relaxed">
            Ta partie en cours sera perdue et il faudra la reprendre depuis le début.
          </p>
          <div className="flex gap-2">
            <Button full size="md" variant="leaf" onClick={() => setAbandonDemande(false)}>
              CONTINUER
            </Button>
            <Button full size="md" variant="outline-crimson" onClick={onClose}>
              QUITTER
            </Button>
          </div>
        </div>
      )}

      {started ? (
        <def.Component config={config} seed={seed} onComplete={verdict} />
      ) : (
        <div className="space-y-4 text-center py-2">
          <div className="text-6xl">{def.icon}</div>
          <p className="font-bold text-ink/80 text-lg leading-snug">{def.description}</p>
          <p className="font-bold text-ink/50 text-sm">
            Prenez le temps de lire — le jeu démarre quand vous appuyez sur GO.
          </p>
          <Button full size="xl" onClick={() => setStarted(true)}>
            🚀 GO !
          </Button>
        </div>
      )}
    </Dialog>
  );
}
