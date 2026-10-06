/**
 * Le diagnostic du téléphone, en toutes lettres.
 *
 * Ici, rien qui touche au navigateur : uniquement le VOCABULAIRE du diagnostic
 * — ce qu'on vérifie, comment le dire, et quoi faire quand ça ne va pas. Le
 * module est donc testable sans DOM, et c'est voulu : la marche à suivre
 * donnée à un joueur qui n'arrive pas à jouer est du contenu, pas du décor,
 * et du contenu, ça se relit et ça se teste.
 *
 * Deux règles de rédaction, qui viennent du terrain :
 *
 *  - Aucune étape ne fait sortir de l'application. Un lien qui ouvre les
 *    réglages n'existe pas sur iOS depuis le web, et un lien inconnu au milieu
 *    d'un jeu inquiète plus qu'il n'aide. On décrit le chemin, le joueur le
 *    suit.
 *  - Les chemins sont écrits tels qu'ils s'affichent sur l'appareil, en
 *    français, dans l'ordre où on les touche. « Réglages → Safari → Position »,
 *    pas « autorise la géolocalisation ».
 */

export type Plateforme = "ios" | "android" | "autre";

/**
 * iPadOS 13+ se déclare « Macintosh » dans son user-agent : depuis Safari, un
 * iPad est indistinguable d'un Mac par la chaîne seule. Ce sont les points de
 * contact qui tranchent — d'où le second argument (navigator.maxTouchPoints).
 */
export function plateforme(ua: string, pointsTactiles = 0): Plateforme {
  const s = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  if (/macintosh|mac os x/.test(s) && pointsTactiles > 1) return "ios";
  if (/android/.test(s)) return "android";
  return "autre";
}

export type Navigateur = "safari" | "chrome" | "firefox" | "samsung" | "edge" | "autre";

/**
 * Le NAVIGATEUR, et pas seulement le système.
 *
 * Le système ne suffit pas à dire où se règle une autorisation. Sur iPhone,
 * l'instruction « touche aA à côté de l'adresse » ne vaut que pour Safari :
 * dans Chrome ou Firefox, ce bouton n'existe pas, et le joueur cherche
 * quelque chose d'introuvable — ce qui est pire que pas d'instruction.
 *
 * L'ORDRE DES TESTS COMPTE, et c'est tout le piège de cette fonction : sur
 * iOS tous les navigateurs sont WebKit et se déclarent « Safari », la plupart
 * se déclarent aussi « Chrome ». On va donc du plus spécifique au plus
 * général, et Safari n'est reconnu qu'en dernier, par élimination.
 */
export function navigateur(ua: string): Navigateur {
  const s = ua.toLowerCase();
  // Edge se déclare différemment sur chaque système : EdgiOS sur iPhone,
  // EdgA sur Android, Edg sur ordinateur. Les trois avant Chrome, dont il
  // porte aussi le nom.
  if (/edgios|edga\/|\bedg\//.test(s)) return "edge";
  if (/crios/.test(s)) return "chrome";
  if (/fxios/.test(s)) return "firefox";
  if (/samsungbrowser/.test(s)) return "samsung";
  if (/firefox|\bfxios\b/.test(s)) return "firefox";
  if (/chrome|chromium/.test(s)) return "chrome";
  if (/safari/.test(s)) return "safari";
  return "autre";
}

/** Le nom du navigateur tel qu'il s'écrit dans les réglages du téléphone. */
const NOM_NAVIGATEUR: Record<Navigateur, string> = {
  safari: "Safari",
  chrome: "Chrome",
  firefox: "Firefox",
  samsung: "Samsung Internet",
  edge: "Edge",
  autre: "ton navigateur",
};

/** Ce qu'on vérifie avant de lâcher une équipe sur le terrain. */
export type Sujet =
  | "reseau"
  | "position"
  | "boussole"
  | "nfc"
  | "photo"
  | "son"
  | "memoire";

/**
 * `encours` = la vérification tourne. `inconnu` = on ne PEUT pas savoir depuis
 * une page web (le mode silencieux d'un iPhone, par exemple) : le dire est plus
 * honnête que d'afficher une coche verte au hasard.
 */
export type Etat = "ok" | "encours" | "refus" | "degrade" | "absent" | "inconnu";

export interface Remede {
  /** Ce qui ne va pas, du point de vue du joueur. Une phrase. */
  constat: string;
  /** La marche à suivre. Une action par ligne, dans l'ordre, sans jargon. */
  etapes: string[];
}

/** Nom et raison d'être de chaque vérification, côté joueur. */
export const LIBELLES: Record<Sujet, { titre: string; pourquoi: string }> = {
  reseau: {
    titre: "Connexion",
    pourquoi: "Pour recevoir les épreuves et envoyer tes réponses.",
  },
  position: {
    titre: "Localisation",
    pourquoi: "Pour les étapes où il faut se rendre quelque part, et pour la boussole.",
  },
  boussole: {
    titre: "Boussole",
    pourquoi: "Elle indique la direction à prendre. La distance suffit sans elle.",
  },
  nfc: {
    titre: "Lecture des balises",
    pourquoi: "Les balises se valident en posant le téléphone dessus.",
  },
  photo: {
    titre: "Appareil photo",
    pourquoi: "Pour les épreuves photo.",
  },
  son: {
    titre: "Son et vibrations",
    pourquoi: "Ils confirment chaque bonne réponse.",
  },
  memoire: {
    titre: "Mémoire du navigateur",
    pourquoi: "Elle retient ton équipe si l'écran s'éteint ou si l'onglet se ferme.",
  },
};

const REESSAYER = "Reviens ici et touche « Réessayer ».";
const reessayerEnSuite = (debut: string) => `${debut} reviens ici et touche « Réessayer ».`;

/**
 * Localisation refusée — le cas de loin le plus fréquent, et celui qui a trois
 * verrous distincts sur iPhone : le site, Safari, et le service du système.
 * On les donne dans l'ordre du plus probable au plus rare, sinon on envoie
 * quelqu'un fouiller trois écrans pour rien.
 */
export function remedePosition(
  p: Plateforme,
  cause: "refus" | "introuvable" | "absent",
  nav: Navigateur = "autre"
): Remede {
  if (cause === "absent") {
    return {
      constat: "Ce navigateur ne donne pas la position.",
      etapes: [
        "Ouvre le jeu dans Safari (iPhone) ou Chrome (Android) plutôt que dans l'application où tu es.",
        "Sinon, les étapes « rendez-vous à un lieu » se passeront de la distance : repère-toi avec l'énoncé.",
      ],
    };
  }
  if (cause === "introuvable") {
    return {
      constat: "Le téléphone cherche encore le satellite.",
      etapes: [
        "Sors du bâtiment ou approche-toi d'une fenêtre : sous un toit, le GPS met longtemps.",
        "Coupe le mode économie d'énergie, qui ralentit la localisation.",
        reessayerEnSuite("Patiente une dizaine de secondes, puis"),
      ],
    };
  }
  const constat = "La localisation est refusée pour ce site.";
  const SERVICE_IOS =
    "Vérifie enfin Réglages → Confidentialité et sécurité → Service de localisation : il doit être activé.";

  if (p === "ios") {
    // Safari, et lui seul, a le bouton « aA ». Les autres navigateurs iOS
    // sont du WebKit dans une autre coquille : l'autorisation se joue au
    // niveau de l'APPLICATION, dans les réglages de l'iPhone.
    if (nav === "safari" || nav === "autre") {
      return {
        constat,
        etapes: [
          "Dans Safari, touche « aA » à côté de l'adresse du site (en bas de l'écran sur la plupart des iPhone).",
          "« Réglages du site web » → Position → Autoriser.",
          "Si Position n'apparaît pas : Réglages de l'iPhone → Safari (dans « Apps » sur iOS 18) → Position → Demander.",
          SERVICE_IOS,
          REESSAYER,
        ],
      };
    }
    return {
      constat,
      etapes: [
        "Le plus rapide : ouvre le jeu dans Safari, où l'autorisation se règle en deux touches.",
        `Pour rester ici : Réglages de l'iPhone → ${NOM_NAVIGATEUR[nav]} → Position → Autoriser.`,
        `Puis, dans ${NOM_NAVIGATEUR[nav]}, touche l'icône à gauche de l'adresse et autorise la position pour ce site.`,
        SERVICE_IOS,
        REESSAYER,
      ],
    };
  }

  if (p === "android") {
    return {
      constat,
      etapes: [
        // « en haut » était faux sur Samsung Internet et sur Chrome réglé en
        // barre basse, où l'adresse est en bas de l'écran.
        "Touche l'icône à gauche de l'adresse du site — en haut de l'écran, ou en bas selon le navigateur.",
        nav === "firefox"
          ? "Cadenas → Autorisations → Position → Autoriser."
          : "Autorisations → Position → Autoriser.",
        "Vérifie que la Localisation du téléphone est allumée : balaie depuis le haut de l'écran, l'icône doit être en surbrillance.",
        REESSAYER,
      ],
    };
  }

  // Ordinateur. Les chemins n'ont rien de commun d'un navigateur à l'autre :
  // une consigne générique y envoie chercher au hasard.
  if (nav === "chrome" || nav === "edge" || nav === "samsung") {
    return {
      constat,
      etapes: [
        "Clique sur l'icône à gauche de l'adresse (un cadenas ou deux curseurs).",
        "« Paramètres du site » → Position → Autoriser.",
        reessayerEnSuite("Recharge la page, puis"),
      ],
    };
  }
  if (nav === "firefox") {
    return {
      constat,
      etapes: [
        "Clique sur le cadenas à gauche de l'adresse.",
        "Efface le blocage de la position : Firefox la redemandera.",
        reessayerEnSuite("Recharge la page, puis"),
      ],
    };
  }
  if (nav === "safari") {
    return {
      constat,
      etapes: [
        "Menu Safari → Réglages pour ce site web.",
        "Position → Autoriser.",
        reessayerEnSuite("Recharge la page, puis"),
      ],
    };
  }
  return {
    constat,
    etapes: [
      "Ouvre les autorisations du site depuis la barre d'adresse du navigateur.",
      reessayerEnSuite("Autorise la position, puis"),
    ],
  };
}

/**
 * LOCALISATION APPROXIMATIVE — le piège de la journée.
 *
 * iOS sait ne donner qu'une position « approximative » : le navigateur répond
 * normalement, la distance s'affiche, tout a l'air de marcher — sauf que le
 * rayon d'incertitude est de plusieurs kilomètres. L'aiguille ne s'affiche
 * alors jamais (`relevementUtile` refuse d'inventer une direction), et le
 * serveur ne dira jamais que l'équipe est arrivée. L'étape devient
 * impossible, sans un seul message d'erreur nulle part.
 *
 * C'est le seul cas où « ça marche » est un mensonge, donc le seul qu'il faut
 * détecter et nommer AVANT le départ.
 */
export function remedePrecision(p: Plateforme, precisionM: number): Remede {
  const km = (Math.round(precisionM / 100) / 10).toLocaleString("fr-FR");
  const constat = `Le téléphone ne donne qu'une position approximative, à ${km} km près.`;
  if (p === "ios") {
    return {
      constat,
      etapes: [
        "Réglages de l'iPhone → Confidentialité et sécurité → Service de localisation.",
        "Descends jusqu'à « Sites web Safari » et choisis « Lorsque l'app est active ».",
        "Active « Position précise » juste en dessous.",
        REESSAYER,
      ],
    };
  }
  if (p === "android") {
    return {
      constat,
      etapes: [
        "Réglages → Position → Services de localisation → Précision de la localisation Google : active-la.",
        "Sors à découvert quelques secondes, le temps que le satellite soit capté.",
        REESSAYER,
      ],
    };
  }
  return {
    constat,
    etapes: [
      "Autorise la position précise pour ce site dans les réglages du navigateur.",
      REESSAYER,
    ],
  };
}

/**
 * Les balises. Sur iPhone comme sur Android, c'est le SYSTÈME qui lit la puce
 * dès qu'on approche le téléphone, et le lien qu'elle porte ouvre le jeu tout
 * seul — la page n'y est pour rien. Sur Android, le NFC peut être coupé.
 *
 * Le code de secours n'est cité qu'au CONDITIONNEL : l'organisateur peut en
 * définir un pour chaque balise (step_secrets.manual_code), mais rien ne dit
 * qu'il l'a écrit dessus. L'annoncer sans condition enverrait chercher un
 * numéro qui n'existe peut-être pas.
 */
export function remedeNfc(p: Plateforme): Remede {
  if (p === "android") {
    // Le constat NE PARLE PAS du navigateur, et c'est le fond de l'affaire :
    // ce n'est pas la page qui lit la balise, c'est le système. `NDEFReader`
    // ne dit que si la PAGE pourrait la lire elle-même — ce dont un joueur n'a
    // aucun besoin. S'y fier annonçait « ce navigateur ne lit pas les
    // balises » à un téléphone qui les lit parfaitement, dès lors qu'il
    // n'était pas sous Chrome.
    return {
      constat: "Impossible de savoir depuis une page web si ce téléphone lit les balises.",
      etapes: [
        "C'est le système qui les lit, pas le jeu : pose le dos du téléphone sur la balise, elle s'ouvre toute seule.",
        "Vérifie que le NFC est allumé : balaie depuis le haut de l'écran, ou cherche « NFC » dans les Réglages — le chemin exact change d'une marque à l'autre.",
        "Si ce téléphone n'a pas de NFC : si un code est écrit sur la balise, tu pourras le saisir à la main ; sinon, tu pourras passer l'étape et continuer le parcours.",
      ],
    };
  }
  return {
    constat: "Ce navigateur ne lit pas les balises tout seul.",
    etapes: [
      "Si un code est écrit sur la balise, tu pourras le saisir à la main ; sinon, tu pourras passer l'étape et continuer le parcours.",
    ],
  };
}

/**
 * La boussole. Sur iPhone elle a son propre interrupteur, séparé de la
 * position — « Mouvement et orientation ». Beaucoup d'appareils Android n'ont
 * simplement pas de magnétomètre : ce n'est pas une panne, et le jeu tourne
 * sans. Le texte le dit, pour ne pas envoyer chercher un réglage inexistant.
 */
export function remedeBoussole(
  p: Plateforme,
  cause: "refus" | "absent",
  nav: Navigateur = "autre"
): Remede {
  if (p === "ios" && cause === "refus") {
    // « Mouvement et orientation » est un réglage de SAFARI. Il n'existe pas
    // pour les autres navigateurs iOS : les y envoyer ferait fouiller un
    // écran de réglages vide. On dit la vérité, et on rappelle que le jeu
    // tourne sans boussole.
    if (nav !== "safari" && nav !== "autre") {
      return {
        constat: "L'accès à l'orientation est refusé.",
        etapes: [
          "Ce réglage n'existe que pour Safari sur iPhone : ouvre le jeu dans Safari si tu veux l'aiguille.",
          "Sinon, rien à régler : le jeu affichera la distance qui te sépare du lieu, et elle suffit.",
        ],
      };
    }
    return {
      constat: "L'accès à l'orientation est refusé.",
      etapes: [
        "Réglages de l'iPhone → Safari (dans « Apps » sur iOS 18).",
        "Active « Mouvement et orientation ».",
        "Reviens ici et recharge la page.",
      ],
    };
  }
  if (cause === "refus") {
    return {
      constat: "L'accès à l'orientation est refusé.",
      etapes: [
        "Ouvre les autorisations du site depuis la barre d'adresse.",
        "Autorise les capteurs de mouvement, puis recharge la page.",
      ],
    };
  }
  return {
    constat: "Ce téléphone n'a pas de boussole.",
    etapes: [
      "Rien à régler : le jeu affichera la distance qui te sépare du lieu, et elle suffit.",
      "Marche quelques mètres : si la distance descend, tu vas dans le bon sens.",
    ],
  };
}

/**
 * Le mode silencieux ne se lit PAS depuis une page web. On ne peut donc que
 * faire entendre un son et demander. C'est aussi la seule vérification où
 * le joueur est le capteur.
 */
export function remedeSon(p: Plateforme): Remede {
  if (p === "ios") {
    return {
      constat: "L'iPhone est en mode silencieux.",
      etapes: [
        "Sur la tranche gauche, bascule le petit interrupteur (ou appuie sur le bouton Action, selon le modèle).",
        "Monte le volume avec les boutons de tranche pendant que le jeu est affiché.",
        "Touche « Écouter à nouveau » pour vérifier.",
      ],
    };
  }
  if (p === "android") {
    return {
      constat: "Le volume multimédia est au minimum.",
      etapes: [
        "Appuie sur un bouton de volume, puis sur la flèche à côté du curseur.",
        "Monte le curseur « Multimédia » — c'est celui-là, pas la sonnerie.",
        "Touche « Écouter à nouveau » pour vérifier.",
      ],
    };
  }
  return {
    constat: "Aucun son ne sort.",
    etapes: ["Monte le volume de l'appareil, puis touche « Écouter à nouveau »."],
  };
}

export function remedeReseau(): Remede {
  return {
    constat: "Le téléphone n'a plus de réseau.",
    etapes: [
      "Réactive les données mobiles ou le Wi-Fi.",
      "Coupe le mode Avion s'il est allumé.",
      "Tu peux partir quand même : le jeu garde tes validations et les envoie tout seul dès que ça capte.",
    ],
  };
}

/**
 * Navigation privée : le stockage local est fermé, l'équipe ne survivra pas à
 * la fermeture de l'onglet. Sur une chasse qui dure une heure, l'écran
 * s'éteint, quelqu'un prend un appel — et l'équipe est perdue. Ça se répare en
 * une manipulation, à condition de le savoir AVANT de partir.
 */
export function remedeMemoire(p: Plateforme): Remede {
  if (p === "ios") {
    return {
      constat: "Tu joues en navigation privée.",
      etapes: [
        "En bas à droite de Safari, touche le bouton des onglets.",
        "Touche « Privée » en bas, puis choisis un groupe d'onglets normal.",
        "Rouvre le jeu et saisis à nouveau le code de la partie.",
      ],
    };
  }
  return {
    constat: "Tu joues en navigation privée.",
    etapes: [
      "Ferme la fenêtre de navigation privée et rouvre le jeu dans un onglet normal.",
      "Saisis à nouveau le code de la partie.",
    ],
  };
}

export function remedePhoto(): Remede {
  return {
    constat: "Ce navigateur n'ouvre pas l'appareil photo.",
    etapes: [
      "Ouvre le jeu dans Safari (iPhone) ou Chrome (Android).",
      "Tu pourras aussi choisir une image déjà prise dans la galerie.",
    ],
  };
}

export interface Constat {
  sujet: Sujet;
  etat: Etat;
}

/**
 * Le verdict d'ensemble, et surtout ce qu'il NE dit pas : une boussole absente
 * ou un mode silencieux ne retiennent personne. Seules la connexion et la
 * position changent vraiment ce qu'on peut faire du parcours, et même elles ne
 * bloquent pas le départ — le bouton reste, son libellé change.
 */
export function verdict(constats: Constat[]): "encours" | "pret" | "partiel" {
  if (constats.some((c) => c.etat === "encours")) return "encours";
  const essentiels: Sujet[] = ["reseau", "position"];
  const bancal = constats.some((c) => essentiels.includes(c.sujet) && c.etat !== "ok");
  return bancal ? "partiel" : "pret";
}

/** Les sujets à corriger, dans l'ordre où on veut les lire : ennuis d'abord. */
export function aRegler(constats: Constat[]): Constat[] {
  const poids: Record<Etat, number> = {
    refus: 0,
    degrade: 1,
    absent: 2,
    inconnu: 3,
    encours: 4,
    ok: 5,
  };
  return constats
    .filter((c) => c.etat !== "ok" && c.etat !== "encours")
    .sort((a, b) => poids[a.etat] - poids[b.etat]);
}
