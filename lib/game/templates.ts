/**
 * Modèles de parcours prêts à l'emploi : créés en un clic depuis le dashboard,
 * puis personnalisables dans l'éditeur (les balises reçoivent des identifiants
 * neufs à l'instanciation).
 */
import type { Hint, MinigameKind, StepType } from "@/lib/types";
import { caesarShift } from "@/components/minigames/Caesar";
import { encodeMorse } from "@/components/minigames/Morse";

export interface TemplateStep {
  type: StepType;
  title: string;
  body?: string;
  minigame?: { kind: MinigameKind; config: Record<string, unknown> };
  answers?: string[];
  hints?: Hint[];
  is_common?: boolean;
  is_final?: boolean;
}

export interface GameTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  audience: string;
  steps: TemplateStep[];
}

export const GAME_TEMPLATES: GameTemplate[] = [
  {
    id: "anniversaire",
    name: "Anniversaire enfants",
    icon: "🎂",
    description: "8 étapes faciles et rythmées : énigmes simples, mini-jeux visuels, 2 balises à cacher.",
    audience: "7–12 ans · ~45 min",
    steps: [
      {
        type: "text",
        title: "Le mot magique",
        body: "Je suis grand le matin, tout petit à midi, et je grandis encore le soir. **Qui suis-je ?**",
        answers: ["l'ombre", "une ombre", "ombre"],
        hints: [{ text: "Regarde par terre quand il y a du soleil…", penalty_sec: 60 }],
      },
      {
        type: "nfc",
        title: "La cachette du jardin",
        body: "Cherchez la balise cachée **près de quelque chose qui arrose** ! 💦",
        hints: [{ text: "Là où le tuyau dort…", penalty_sec: 60 }],
      },
      {
        type: "minigame",
        title: "Les lanternes du goûter",
        minigame: { kind: "lanterns", config: { size: 4, scramble: 5 } },
      },
      {
        type: "minigame",
        title: "Le memory des pirates",
        minigame: { kind: "memory", config: { image_urls: [] } },
      },
      {
        type: "text",
        title: "Compte bien !",
        body: "Un fermier a 17 moutons. Tous meurent **sauf 9**. Combien en reste-t-il ?",
        answers: ["9", "neuf"],
      },
      {
        type: "minigame",
        title: "Le singe savant",
        minigame: { kind: "chimp", config: { start: 3, rounds: 3 } },
        is_common: true,
      },
      {
        type: "nfc",
        title: "Le repaire secret",
        body: "La dernière balise se cache **là où on range les jeux** !",
      },
      {
        type: "text",
        title: "Le trésor !",
        body: "Le trésor est gardé par celui qui fête quelque chose aujourd'hui… **Quel âge a-t-il/elle ?** (le gâteau connaît la réponse 🎂)",
        answers: ["8", "9", "10", "11", "12"],
        is_final: true,
      },
    ],
  },
  {
    id: "teambuilding",
    name: "Team building",
    icon: "💼",
    description: "9 étapes qui font réfléchir : logique, déduction, code, coordination. 2 balises.",
    audience: "Adultes · ~1h15",
    steps: [
      {
        type: "minigame",
        title: "Briefing chiffré",
        minigame: { kind: "caesar", config: { ciphertext: caesarShift("MISSION ACCEPTEE", 5), shift: 5, mode: "wheel" } },
        answers: ["mission acceptee"],
        body: "Un message intercepté ouvre la mission. À vos roues !",
      },
      {
        type: "nfc",
        title: "Point de rendez-vous Alpha",
        body: "La balise Alpha est **là où l'on affiche les nouvelles**.",
        hints: [{ text: "Panneau, tableau… ça vous parle ?", penalty_sec: 120 }],
      },
      {
        type: "minigame",
        title: "Le coffre du DAF",
        minigame: { kind: "lock", config: { digits: 4, clues: ["Le 1er chiffre = nombre d'étages du bâtiment", "Les 2 derniers = l'année de création de la boîte (2 derniers chiffres)"] } },
        answers: ["0000"],
        hints: [{ text: "Adaptez les indices à votre lieu dans l'éditeur !", penalty_sec: 60 }],
      },
      {
        type: "minigame",
        title: "Mastermind du comité",
        minigame: { kind: "mastermind", config: { slots: 4, colors: 6 } },
        is_common: true,
      },
      {
        type: "text",
        title: "L'énigme du consultant",
        body: "Je parle toutes les langues sans en apprendre aucune. **Qui suis-je ?**",
        answers: ["l'echo", "un echo", "echo"],
      },
      {
        type: "minigame",
        title: "Transmission radio",
        minigame: { kind: "morse", config: { pattern: encodeMorse("BUDGET VALIDE"), unit_ms: 140, show_chart: true } },
        answers: ["budget valide"],
      },
      {
        type: "nfc",
        title: "Point de rendez-vous Bravo",
        body: "La balise Bravo attend **près de la machine la plus utilisée de l'entreprise** ☕.",
      },
      {
        type: "minigame",
        title: "La pièce truquée du CE",
        minigame: { kind: "balance", config: { coins: 9, weighings: 2 } },
      },
      {
        type: "minigame",
        title: "Sprint final : audit express",
        minigame: { kind: "cascade", config: { steps: 6, speed_ms: 2000 } },
        is_final: true,
      },
    ],
  },
  {
    id: "soiree",
    name: "Soirée entre amis",
    icon: "🌙",
    description: "8 étapes corsées : crypto, labyrinthe dans le brouillard, mémoire… 2 balises.",
    audience: "Ados/adultes · ~1h",
    steps: [
      {
        type: "text",
        title: "L'énigme d'ouverture",
        body: "Plus j'ai de gardiens, moins je suis gardé. Plus j'ai de trous, plus je retiens. **Qui suis-je ?**",
        answers: ["le filet", "un filet", "filet"],
        hints: [{ text: "On me lance à la mer…", penalty_sec: 120 }],
      },
      {
        type: "minigame",
        title: "Le brouillard",
        minigame: { kind: "maze", config: { size: 11, fog: true } },
      },
      {
        type: "nfc",
        title: "La planque n°1",
        body: "Balise cachée **sous quelque chose qui éclaire sans électricité**.",
      },
      {
        type: "minigame",
        title: "Code éclair",
        minigame: { kind: "flashcode", config: { rounds: 5 } },
        is_common: true,
      },
      {
        type: "minigame",
        title: "Message de minuit",
        minigame: { kind: "caesar", config: { ciphertext: caesarShift("RENDEZ VOUS AU POINT D EAU", 13), shift: 13, mode: "expert" } },
        answers: ["rendez vous au point d eau"],
      },
      {
        type: "minigame",
        title: "La tour interdite",
        minigame: { kind: "hanoi", config: { disks: 5 } },
      },
      {
        type: "nfc",
        title: "La planque n°2",
        body: "Dernière balise : **là où les clés aiment se perdre**.",
      },
      {
        type: "minigame",
        title: "Le coffre final",
        minigame: { kind: "lock", config: { digits: 5, clues: ["Additionnez les chiffres trouvés sur les balises…", "Personnalisez ces indices dans l'éditeur !"] } },
        answers: ["00000"],
        is_final: true,
      },
    ],
  },
];
