/**
 * Génère les icônes de l'app (PWA + signet iPhone) à partir du logo officiel :
 * logo détouré (bords transparents rognés), centré sur fond parchemin.
 *   node scripts/make-icons.mjs   (ou : npm run icons)
 */
import sharp from "sharp";

const SRC = "public/logo-toyahtreasure.png";
const BG = "#EDE0C4";

async function icon(out, size, ratio) {
  const inner = Math.round(size * ratio);
  const logo = await sharp(SRC)
    .trim()
    .resize(inner, inner, { fit: "contain", background: BG })
    .png()
    .toBuffer();
  const m1 = Math.floor((size - inner) / 2);
  const m2 = Math.ceil((size - inner) / 2);
  await sharp(logo)
    .extend({ top: m1, bottom: m2, left: m1, right: m2, background: BG })
    .flatten({ background: BG }) // iOS rend le PNG transparent sur fond noir sinon
    .png()
    .toFile(out);
  console.log(`✅ ${out} (${size}px)`);
}

await icon("public/icons/apple-icon-180.png", 180, 0.86); // signet iPhone
await icon("public/icons/icon-192.png", 192, 0.86);
await icon("public/icons/icon-512.png", 512, 0.86);
// Maskable Android : le contenu doit tenir dans la zone sûre (~64 %)
await icon("public/icons/icon-512-maskable.png", 512, 0.64);
