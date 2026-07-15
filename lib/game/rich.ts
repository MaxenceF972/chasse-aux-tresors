/**
 * Mini-rendu "texte riche" pour les énoncés : échappe le HTML puis
 * applique **gras**, *italique* et les sauts de ligne. Suffisant et sûr.
 */
export function renderRich(text: string): string {
  const escaped = (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br/>");
}
