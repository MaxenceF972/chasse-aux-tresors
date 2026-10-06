import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

/**
 * Marqueur d'une configuration absente — reconnu par app/error.tsx, qui en
 * fait un écran lisible au lieu de « Application error ».
 */
export const CONFIG_MANQUANTE = "CONFIG_SUPABASE_MANQUANTE";

/** L'URL du projet est-elle exploitable ? (protocole http/https et hôte). */
function estUrlValide(valeur: string): boolean {
  try {
    const u = new URL(valeur.trim());
    return (u.protocol === "https:" || u.protocol === "http:") && !!u.hostname;
  } catch {
    return false;
  }
}

/** Client Supabase singleton (navigateur). */
export function sb(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // Ces deux variables sont GRAVÉES DANS LE BUNDLE À LA CONSTRUCTION : les
    // renseigner chez l'hébergeur ne suffit pas, il faut reconstruire. Sans ce
    // garde-fou, supabase-js lève « supabaseUrl is required » au premier rendu
    // et la page devient noire, sans rien qui explique quoi corriger.
    if (!url || !key) {
      const manquantes = [
        !url && "NEXT_PUBLIC_SUPABASE_URL",
        !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      ]
        .filter(Boolean)
        .join(" et ");
      throw new Error(
        `${CONFIG_MANQUANTE} : ${manquantes} absente(s) de la construction. Renseigne-la dans l'hébergeur PUIS relance un déploiement — ces valeurs sont figées au build, pas lues à l'exécution.`
      );
    }
    // Présente ne veut pas dire correcte. Le collage dans l'interface d'un
    // hébergeur mange volontiers le premier caractère : « ttps://… » au lieu
    // de « https://… ». supabase-js répond alors « Invalid supabaseUrl » en
    // anglais, sans montrer la valeur fautive — on la montre ici.
    if (!estUrlValide(url)) {
      throw new Error(
        `${CONFIG_MANQUANTE} : NEXT_PUBLIC_SUPABASE_URL vaut « ${url} », ce n'est pas une URL. Attendu : https://xxxxxxxx.supabase.co (Supabase → Project Settings → API → Project URL). Vérifie qu'aucun caractère ne manque au début, ni guillemet ni espace à la fin — et vérifie la clé du même coup.`
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return _client;
}

/**
 * Garantit une session (anonyme si besoin) — les joueurs n'ont pas de compte,
 * mais le RLS et le Realtime exigent un auth.uid().
 */
export async function ensureAnonSession(): Promise<SupabaseClient> {
  const client = sb();
  const { data } = await client.auth.getSession();
  if (!data.session) {
    const { error } = await client.auth.signInAnonymously();
    if (error) {
      throw new Error(
        error.message.toLowerCase().includes("anonymous")
          ? "Les connexions anonymes ne sont pas activées sur le projet Supabase (Authentication → Sign In / Up)."
          : error.message
      );
    }
  }
  return client;
}

/** Appel RPC typé : lève une Error si Supabase renvoie une erreur. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Une erreur de fetch réseau (offline) — à distinguer d'un refus serveur. */
export function isNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch|network|failed to fetch|load failed|timeout/i.test(msg);
}

/**
 * Les codes que lèvent les fonctions SQL, en français.
 *
 * `frError` finissait par un `return raw` : un code brut du genre
 * PARTIE_NON_ACTIVE ou EQUIPE_PLEINE s'affichait tel quel, en capitales, au
 * milieu d'une partie. Ce n'est ni lisible ni rassurant. Ce qui n'est pas
 * listé ici et qui a la FORME d'un code (capitales et tirets bas) est remplacé
 * par le message de repli : mieux vaut une phrase vague qu'un jeton de base
 * de données.
 */
const CODES_SQL: Record<string, string> = {
  NON_INSCRIT: "Tu ne participes pas à cette chasse.",
  INTERDIT: "Cette action ne t'est pas permise.",
  NON_AUTORISE: "Cette chasse ne t'est pas ouverte.",
  PARTIE_INTROUVABLE: "Aucune chasse ne porte ce code.",
  PARTIE_PAS_OUVERTE: "La chasse n'est pas encore ouverte — ça démarre bientôt !",
  PARTIE_EN_PAUSE: "La chasse est en pause — elle reprend dans un instant.",
  PARTIE_NON_ACTIVE: "La chasse n'est plus en cours.",
  PARTIE_TERMINEE: "Cette chasse est terminée.",
  PARTIE_DEJA_LANCEE:
    "La chasse a déjà commencé : les inscriptions sont fermées. Pour rejoindre ton équipe, demande son code à ton capitaine.",
  AUCUNE_EQUIPE: "Aucune équipe n'a rejoint le lobby.",
  POOL_TROP_PETIT:
    "Pas assez d'énigmes dans le pool aléatoire : il en faut au moins autant que d'équipes.",
  EQUIPE_INTROUVABLE: "Cette équipe n'existe plus.",
  EQUIPE_PLEINE: "Cette équipe est complète.",
  EQUIPE_DEJA_PARTIE:
    "Cette équipe est déjà partie — demande-lui son code d'équipe pour la rejoindre.",
  EQUIPE_DEJA_ARRIVEE: "Cette équipe a terminé sa chasse.",
  MAX_EQUIPES_ATTEINT: "La chasse a atteint son nombre maximum d'équipes.",
  CODE_EQUIPE_INVALIDE: "Ce code d'équipe ne correspond à aucune équipe.",
  NOM_EQUIPE_REQUIS: "Donne un nom à ton équipe.",
  PSEUDO_REQUIS: "Indique ton prénom ou ton pseudo.",
  NOM_REQUIS: "Un nom est nécessaire.",
  MESSAGE_VIDE: "Ton message est vide.",
  AUCUNE_ETAPE: "Cette chasse n'a encore aucune épreuve.",
  ETAPE_INVALIDE: "Cette épreuve n'est pas celle en cours.",
  ETAPE_VERROUILLEE: "Cette balise appartient à une autre épreuve.",
  ETAPE_PHOTO: "Cette épreuve se valide en envoyant une photo.",
  ETAPE_PAS_PHOTO: "Cette épreuve n'attend pas de photo.",
  ETAPE_PAS_BALISE: "Cette épreuve ne se valide pas avec une balise.",
  ETAPE_PAS_BONUS: "Cette épreuve n'est pas une énigme bonus.",
  ETAPE_INTROUVABLE: "Cette épreuve n'existe plus.",
  ETAPE_INTROUVABLE_OU_FAITE: "Cette épreuve n'existe plus ou est déjà faite.",
  PARCOURS_TERMINE: "Ton équipe a déjà bouclé le parcours.",
  PAS_PARTIE: "Ton équipe n'est pas encore partie.",
  PAS_RATTRAPABLE: "Cette épreuve ne se rattrape pas.",
  PAS_EN_RATTRAPAGE: "Cette épreuve n'est pas à rattraper.",
  GROUPE_ORDRE: "Ces épreuves s'enchaînent dans l'ordre : termine d'abord la précédente.",
  TROP_RAPIDE: "Trop rapide pour être vrai — rejoue l'épreuve.",
  TIMER_PAS_ECOULE: "Le temps de cette épreuve n'est pas encore écoulé.",
  PAS_DE_TIMER: "Cette épreuve n'a pas de limite de temps.",
  INDICE_INTROUVABLE: "Cet indice n'existe pas.",
  INDICE_PAS_ENCORE: "Cet indice n'est pas encore disponible.",
  REPONSE_VIDE: "Écris ta réponse avant de valider.",
  POSITION_INDISPONIBLE: "Position introuvable — vérifie la localisation du téléphone.",
  URL_INVALIDE: "Ce fichier n'a pas pu être enregistré.",
  ORG_COMPTE_REQUIS: "Cette action demande un compte organisateur.",
  NOTE_INVALIDE: "Choisis une note entre 1 et 5 étoiles.",
  EMAIL_INVALIDE: "Cette adresse e-mail n'a pas l'air valide.",
  DEJA_PROPRIETAIRE: "C'est déjà toi qui organises cette chasse.",
  BONUS_INTROUVABLE: "Ce bonus n'existe plus.",
  DEJA_ANNULE: "Ce bonus est déjà annulé.",
  TRANSITION_INVALIDE: "Ce changement d'état n'est pas possible maintenant.",
};

/** Un jeton du genre PARTIE_NON_ACTIVE — jamais un vrai message. */
const RESSEMBLE_A_UN_CODE = /^[A-Z][A-Z0-9_]{4,}$/;

/**
 * Message d'erreur lisible par un humain : traduit les erreurs techniques
 * courantes (réseau coupé, session expirée, anti-spam) qui sortent en anglais
 * de Supabase/fetch, et les codes SQL du jeu. À utiliser à l'AFFICHAGE
 * uniquement — jamais avant les tests logiques sur le message brut (codes
 * INTERDIT, *_fkey, etc.).
 */
export function frError(err: unknown, fallback = "Une erreur est survenue — réessaie."): string {
  const raw =
    err instanceof Error
      ? err.message
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "";
  if (!raw) return fallback;
  if (/fetch|network|load failed|timeout/i.test(raw))
    return "Pas de réseau — vérifie ta connexion et réessaie.";
  if (/jwt|refresh token/i.test(raw) && /expired|invalid|not found|missing/i.test(raw))
    return "Session expirée — recharge la page.";
  if (/security purposes|rate limit/i.test(raw))
    return "Trop de tentatives — patiente quelques secondes et réessaie.";

  const nu = raw.trim().replace(/\.$/, "");
  if (CODES_SQL[nu]) return CODES_SQL[nu];
  for (const [code, phrase] of Object.entries(CODES_SQL)) {
    if (raw.includes(code)) return phrase;
  }
  if (RESSEMBLE_A_UN_CODE.test(nu)) return fallback;
  return raw;
}

/**
 * Toutes les lignes d'une requête, par pages.
 *
 * PostgREST PLAFONNE le nombre de lignes rendues par une requête. Tant qu'une
 * table reste petite, on ne le voit jamais ; `team_routes`, elle, grossit en
 * ÉQUIPES × ÉTAPES — trente-cinq équipes à trente épreuves et le plafond tombe.
 *
 * Ce qui rend la panne sournoise : la requête n'échoue pas. Elle rend les
 * premières lignes et se tait. Sur le tableau de bord, les équipes dont le
 * parcours n'était pas dans le lot affichaient « 0/0 » et pas une case — des
 * équipes ARRIVÉES, avec leur temps à côté. On lit une base cassée, alors que
 * la base est intacte et que c'est le transport qui a coupé.
 *
 * `requete` reçoit les bornes d'une page et doit poser un ORDRE STABLE :
 * sans `order`, deux pages peuvent se recouvrir et en oublier d'autres.
 */
export async function toutesLesLignes<T>(
  requete: (
    de: number,
    a: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  taille = 1000
): Promise<T[]> {
  const tout: T[] = [];
  // Garde-fou : une erreur de pagination ne doit pas tourner à la boucle
  // infinie sur le téléphone de quelqu'un. 200 pages = 200 000 lignes, très
  // au-delà de ce qu'une partie peut produire.
  for (let page = 0; page < 200; page++) {
    const { data, error } = await requete(page * taille, page * taille + taille - 1);
    if (error || !data) break;
    tout.push(...data);
    if (data.length < taille) break;
  }
  return tout;
}
