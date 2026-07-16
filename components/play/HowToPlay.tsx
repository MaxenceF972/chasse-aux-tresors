"use client";

import { useState } from "react";
import Dialog from "@/components/ui/Dialog";

const RULES = [
  {
    icon: "🗺️",
    title: "Suis ta route",
    text: "Chaque équipe a son propre parcours — inutile de suivre les autres, ils ne vont pas au même endroit !",
  },
  {
    icon: "🏷️",
    title: "Scanne les balises",
    text: "Sur place, pose ton téléphone sur la puce NFC — ou scanne le QR avec l'appareil photo. Balise abîmée ? Saisis le code imprimé.",
  },
  {
    icon: "🧩",
    title: "Résous énigmes & mini-jeux",
    text: "Réponds directement dans l'app. Les majuscules et les accents ne comptent pas. Réfléchissez à plusieurs !",
  },
  {
    icon: "💡",
    title: "Coincés ? Les indices",
    text: "Chaque indice peut coûter des minutes de pénalité — à débloquer en équipe, pas en panique. L'organisateur peut aussi vous envoyer un coup de pouce.",
  },
  {
    icon: "📶",
    title: "Pas de réseau ? Pas de panique",
    text: "Tes validations sont mémorisées et repartent toutes seules dès que ça capte à nouveau.",
  },
  {
    icon: "🏁",
    title: "Le sprint final",
    text: "La dernière étape est la même pour tout le monde : elle se débloque quand tout le reste est validé. Le chrono (et les pénalités) font le classement !",
  },
];

/** Les règles du jeu, à consulter en attendant le lancement. */
export default function HowToPlay() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="w-full text-center font-bold text-parchment/70 underline py-2.5"
        onClick={() => setOpen(true)}
      >
        📖 Comment jouer ?
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="📖 Comment jouer">
        <div className="space-y-4">
          {RULES.map((rule) => (
            <div key={rule.title} className="flex gap-3">
              <span className="text-3xl shrink-0" aria-hidden>
                {rule.icon}
              </span>
              <div>
                <p className="font-display leading-tight">{rule.title}</p>
                <p className="font-bold text-sm text-ink/70">{rule.text}</p>
              </div>
            </div>
          ))}
          <p className="font-display text-center text-leaf pt-1">Bonne chasse, moussaillons ! 🏴‍☠️</p>
        </div>
      </Dialog>
    </>
  );
}
