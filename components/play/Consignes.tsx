"use client";

import { charterRules } from "@/lib/game/charter";
import Button from "@/components/ui/Button";

interface ConsignesProps {
  /** Charte de l'organisateur (settings.charter), sinon la charte par défaut. */
  charter?: string[];
  /**
   * Fourni : c'est l'écran de départ, un bouton conclut la lecture.
   * Absent : c'est une carte posée dans le lobby, à lire en attendant.
   */
  onContinuer?: () => void;
}

/**
 * La charte de l'aventurier — l'écran que TOUT LE MONDE croise avant de partir.
 *
 * Jusqu'ici, seul le capitaine la voyait : il la coche en créant l'équipe. Les
 * coéquipiers qui rejoignent ne passaient par aucun écran qui la montre, et un
 * départ solo (jeu en continu) n'a pas de création d'équipe du tout. Un joueur
 * pouvait donc faire toute la chasse sans avoir lu une seule règle de sécurité.
 *
 * D'où un écran, pas un bouton, monté depuis la vérification du téléphone —
 * le passage commun à tous les départs, et le seul qui soit AVANT le chrono :
 * personne ne doit payer en minutes sa lecture des règles de sécurité.
 */
export default function Consignes({ charter, onContinuer }: ConsignesProps) {
  const regles = charterRules(charter);

  return (
    <section>
      <p className="font-display text-sm text-gold-dark">📜 AVANT DE PARTIR</p>
      <h2 className="font-display text-3xl leading-tight mt-1">La charte de l&apos;aventurier</h2>
      <p className="font-bold text-ink/65 text-sm leading-relaxed mt-2">
        Quelques règles pour que la chasse se passe bien pour tout le monde — et en toute
        sécurité. Une minute de lecture, et c&apos;est parti !
      </p>

      <ul className="mt-5 space-y-3">
        {regles.map((regle, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="text-2xl shrink-0" aria-hidden>
              {regle.icon}
            </span>
            <div className="min-w-0">
              {regle.title && (
                <p className="font-display text-base leading-tight">{regle.title}</p>
              )}
              <p className="font-bold text-ink/65 text-sm leading-relaxed">{regle.text}</p>
            </div>
          </li>
        ))}
      </ul>

      {onContinuer && (
        <Button full size="lg" variant="leaf" className="mt-6" onClick={onContinuer}>
          ✅ J&apos;AI LU LA CHARTE
        </Button>
      )}
    </section>
  );
}
