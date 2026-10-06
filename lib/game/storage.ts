/**
 * Le chemin d'un fichier dans le bucket, lu depuis son URL publique.
 *
 * Deux routes serveur en ont besoin — le nettoyage à la suppression d'une
 * partie, et la copie des médias à la duplication — et elles n'avaient pas la
 * même lecture : l'une cherchait « /{id de partie}/ » n'importe où dans l'URL,
 * ce qui confond un identifiant apparaissant ailleurs (un nom de fichier, un
 * paramètre) avec le dossier. Une seule lecture, ici, testée.
 *
 * Module PUR : aucun import, donc utilisable des deux côtés sans traîner un
 * client Supabase dans un bundle.
 */

const BUCKET = "media";

/**
 * Rend `{dossier}/{fichier}` pour une URL publique du bucket, `null` pour
 * toute autre URL (média externe, chaîne vide, valeur d'un autre type).
 * La chaîne de requête est retirée, et le chemin est décodé — Storage sert des
 * URLs percent-encodées, la base garde le nom réel.
 */
export function cheminStorage(url: unknown, bucket = BUCKET): string | null {
  if (typeof url !== "string") return null;
  const marqueur = `/storage/v1/object/public/${bucket}/`;
  const i = url.indexOf(marqueur);
  if (i < 0) return null;
  const brut = url.slice(i + marqueur.length).split("?")[0];
  if (!brut) return null;
  try {
    return decodeURIComponent(brut);
  } catch {
    return brut; // URL mal encodée : mieux vaut le chemin brut que rien
  }
}

/** Le fichier appartient-il au dossier de CETTE partie ? */
export function appartientA(url: unknown, gameId: string, bucket = BUCKET): boolean {
  const chemin = cheminStorage(url, bucket);
  return chemin !== null && chemin.startsWith(`${gameId}/`);
}
