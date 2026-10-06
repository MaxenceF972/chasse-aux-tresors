"use client";

import { useState } from "react";
import { charterRules } from "@/lib/game/charter";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

interface BriefingProps {
  /** Charte personnalisée (settings.charter), sinon la charte par défaut */
  charter?: string[];
  /** Ordre imposé par l'organisateur : toutes les équipes suivent le même sens. */
  ordreFixe?: boolean;
  /** Partie sans surveillance : personne ne répond en direct. */
  unattended?: boolean;
  /** Jeu en continu : chaque équipe part quand elle veut, avec son propre chrono. */
  continuous?: boolean;
}

/**
 * Le document d'accueil du lobby : le concept de la chasse, les règles et la
 * charte.
 *
 * Il ne demande PLUS aucune autorisation. Il en réclamait trois — position,
 * notifications, son — et l'écran de vérification du téléphone les
 * redemandait derrière. Deux endroits pour la même question, c'est un endroit
 * de trop : voir components/play/Preflight.tsx.
 */
export default function Briefing({ charter, ordreFixe, unattended, continuous }: BriefingProps) {
  const [open, setOpen] = useState(false);

  const regles = [
    ordreFixe
      ? {
          icon: "🗺️",
          title: "Un seul sens de parcours",
          text: "Toutes les équipes suivent le même parcours, dans le même ordre. Si une autre équipe occupe l'épreuve, laissez-lui le temps de finir : rien ne se perd.",
        }
      : {
          icon: "🗺️",
          title: "Chaque équipe a SA route",
          text: "Vous ne ferez pas les épreuves dans le même ordre que les autres : inutile de suivre une équipe, elle ne va pas au même endroit que vous.",
        },
    {
      icon: "🏷️",
      title: "Scanner les balises",
      text: unattended
        ? "Sur place, posez le DOS du téléphone sur la puce NFC, écran allumé : la validation s'ouvre toute seule. Rien ne vient ? Faites-le glisser doucement — le capteur est en haut sur iPhone, au milieu sur la plupart des Android. Balise abîmée ? Saisissez son code s'il est écrit dessus, sinon passez l'étape."
        : "Sur place, posez le DOS du téléphone sur la puce NFC, écran allumé : la validation s'ouvre toute seule. Rien ne vient ? Faites-le glisser doucement — le capteur est en haut sur iPhone, au milieu sur la plupart des Android. Balise abîmée ou introuvable ? Contactez le maître du jeu.",
    },
    {
      icon: "🧩",
      title: "Énigmes et mini-jeux",
      text: "Les réponses se tapent dans l'app. Ni les majuscules ni les accents ne comptent. Réfléchissez à plusieurs, c'est tout l'intérêt !",
    },
    {
      icon: "💡",
      title: "Coincés ? Les indices",
      text: "Chaque étape peut proposer des indices : certains deviennent gratuits après un délai, d'autres coûtent des minutes de pénalité. À utiliser en équipe, pas en panique.",
    },
    {
      icon: "🚪",
      title: "Vraiment bloqués ? Passez",
      text: "Le bouton « Passer l'étape » vous fait avancer contre une pénalité. Certaines épreuves sont rattrapables plus tard : les réussir annule la pénalité.",
    },
    {
      icon: "📶",
      title: "Pas de réseau ? Pas de panique",
      text: "Vos validations sont mémorisées sur le téléphone et repartent toutes seules dès que ça capte à nouveau. Continuez à jouer.",
    },
    unattended
      ? {
          icon: "🆘",
          title: "Un souci sur le terrain",
          text: "Le menu ☰ permet de signaler un problème (balise décollée, énigme qui bloque). Le message sera lu, mais ne l'attendez pas : personne n'est de garde pendant la partie. Si une étape vous bloque, passez-la et continuez.",
        }
      : {
          icon: "🆘",
          title: "Un souci sur le terrain",
          text: "Le menu ☰ permet d'écrire au maître du jeu à tout moment : balise introuvable, doute, pépin. Il reçoit le message immédiatement.",
        },
    continuous
      ? {
          icon: "⏱️",
          title: "Votre propre chrono",
          text: "Chaque équipe part quand elle est prête et court son propre temps : partir plus tard ne pénalise pas. Le classement compare les temps de parcours, pénalités comprises.",
        }
      : null,
    {
      icon: "🏁",
      title: "Le sprint final",
      text: "La dernière étape est la même pour tout le monde et se débloque quand tout le reste est validé. Le classement se joue au chrono (ou aux points) — pénalités comprises.",
    },
  ].filter((r): r is { icon: string; title: string; text: string } => r !== null);

  const rules = charterRules(charter);

  return (
    <>
      <Button full size="lg" variant="gold" onClick={() => setOpen(true)}>
        📋 BRIEFING — À LIRE AVANT DE PARTIR
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="📋 Briefing">
        <div className="space-y-5">
          {/* 0. Le réflexe qui évite 90 % des « on n'avait pas vu » : scroller.
              Vrai pour ce briefing comme pour chaque écran de la partie. */}
          <p className="rounded-xl border-[3px] border-ink bg-gold/15 p-3 font-bold text-sm leading-relaxed">
            ⬇️ <strong>Faites défiler chaque écran jusqu&apos;en bas</strong> — ce briefing comme
            toutes les pages de la partie. Les énoncés, les indices et les boutons continuent
            souvent sous ce que l&apos;écran affiche : c&apos;est comme ça qu&apos;on rate une
            information.
          </p>

          {/* 1. Le principe (la présentation de l'organisateur est déjà
              affichée en clair sur le lobby : inutile de la répéter ici) */}
          <section>
            <h3 className="font-display text-lg mb-2">🧭 Le principe</h3>
            <p className="font-bold text-ink/75 text-sm leading-relaxed">
              Vous formez une équipe et partez sur le terrain, téléphone en main. L&apos;app vous
              donne <strong>une étape à la fois</strong> : une énigme à résoudre, un mini-jeu à
              réussir, une balise à retrouver et à scanner, un lieu où se rendre, ou une photo à
              réaliser. Chaque réussite débloque la suivante, jusqu&apos;au trésor.
            </p>
            {ordreFixe ? (
              <p className="font-bold text-ink/75 text-sm leading-relaxed mt-2">
                Toutes les équipes font les mêmes épreuves, <strong>dans le même ordre</strong> :
                le parcours a un sens, suivez-le.
              </p>
            ) : (
              <p className="font-bold text-ink/75 text-sm leading-relaxed mt-2">
                Toutes les équipes font les mêmes épreuves, mais{" "}
                <strong>dans un ordre différent</strong> — impossible de se suivre, et le
                classement se joue vraiment sur ce que vous faites.
              </p>
            )}
          </section>

          {/* 2. Le téléphone : plus de réglages ICI, seulement ce qui ne se règle
              pas depuis une page web. Le reste se fait sur l'écran de
              vérification du téléphone. */}
          <section className="rounded-xl border-[3px] border-ink bg-white/60 p-3">
            <h3 className="font-display text-lg mb-1">📱 Ton téléphone</h3>
            <p className="font-bold text-ink/65 text-sm leading-relaxed mb-2">
              Avant le départ, le jeu vérifie ton téléphone (son, localisation, boussole,
              notifications) et te dit quoi faire si quelque chose manque. Tu peux aussi la
              relancer à tout moment depuis le menu ☰. D&apos;ici là, quatre choses que toi seul
              peux régler :
            </p>
            <ul className="space-y-1 font-bold text-ink/70 text-sm">
              <li>🔋 Batterie chargée — une chasse dure souvent 1 à 2 h avec l&apos;écran allumé.</li>
              <li>☀️ Luminosité au maximum : dehors, en plein soleil, ça change tout.</li>
              <li>🏷️ NFC activé sur Android (cherche « NFC » dans les Réglages). Sur iPhone, rien à faire.</li>
              <li>🔕 Pas de mode silencieux : sinon tu rateras les sons de la partie.</li>
            </ul>
          </section>

          {/* 3. Les règles */}
          <section>
            <h3 className="font-display text-lg mb-2">📖 Comment on joue</h3>
            <div className="space-y-3">
              {regles.map((rule) => (
                <div key={rule.title} className="flex gap-3">
                  <span className="text-2xl shrink-0" aria-hidden>
                    {rule.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display leading-tight">{rule.title}</p>
                    <p className="font-bold text-sm text-ink/70">{rule.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. La charte */}
          <section>
            <h3 className="font-display text-lg mb-2">🤝 La charte de l&apos;aventurier</h3>
            <ul className="space-y-2">
              {rules.map((rule, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-xl shrink-0" aria-hidden>
                    {rule.icon}
                  </span>
                  <div className="min-w-0">
                    {rule.title && (
                      <p className="font-display text-sm leading-tight">{rule.title}</p>
                    )}
                    <p className="font-bold text-ink/65 text-sm">{rule.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="font-display text-center text-leaf">Bonne chasse, moussaillons ! 🏴‍☠️</p>
          <Button full size="lg" variant="leaf" onClick={() => setOpen(false)}>
            ✅ J&apos;AI TOUT LU, JE SUIS PRÊT !
          </Button>
        </div>
      </Dialog>
    </>
  );
}
