/**
 * Charte de l'aventurier : règles que le capitaine accepte au nom de son
 * équipe. L'organisateur peut la remplacer par ses propres règles
 * (settings.charter, une règle par ligne) — sinon celle-ci s'applique.
 */

export interface CharterRule {
  icon: string;
  title: string;
  text: string;
}

export const DEFAULT_CHARTER: CharterRule[] = [
  {
    icon: "🏷️",
    title: "Respecter les balises",
    text: "Ne pas récupérer, déplacer, cacher ni abîmer les balises. Elles servent aux autres équipes.",
  },
  {
    icon: "🤝",
    title: "Respecter les autres équipes",
    text: "Jouer fair-play : pas de sabotage, pas de suivi d'une autre équipe, pas de triche.",
  },
  {
    icon: "🚗",
    title: "Priorité à la sécurité",
    text: "Zéro alcool au volant. Respecter le code de la route et les règles des lieux traversés.",
  },
  {
    icon: "🌿",
    title: "Respecter les lieux",
    text: "Ne pas dégrader l'environnement ni les propriétés privées. On ne laisse aucune trace.",
  },
  {
    icon: "📱",
    title: "Rester prudent en marchant",
    text: "Lever les yeux de l'écran, surveiller la circulation, garder le groupe ensemble.",
  },
];

export const DEFAULT_CHARTER_LINES = DEFAULT_CHARTER.map((r) => `${r.title} : ${r.text}`);

/** Règles à afficher : celles de l'organisateur si définies, sinon la charte par défaut. */
export function charterRules(custom: string[] | undefined | null): CharterRule[] {
  const lines = (custom ?? []).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return DEFAULT_CHARTER;
  return lines.map((line) => {
    const [title, ...rest] = line.split(":");
    return rest.length
      ? { icon: "📜", title: title.trim(), text: rest.join(":").trim() }
      : { icon: "📜", title: "", text: line };
  });
}
