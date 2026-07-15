/**
 * Normalisation d'une réponse — DOIT rester le miroir exact de
 * public.normalize_answer() côté SQL : minuscules, sans accents,
 * uniquement [a-z0-9].
 */
export function normalizeAnswer(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}
