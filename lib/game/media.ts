import { sb } from "@/lib/supabase/client";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/** Compression côté client : redimensionne à 1600px max et convertit en WebP. */
export async function compressImage(file: File, maxDim = 1600, quality = 0.82): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality)
  );
  if (!blob) throw new Error("Compression de l'image impossible");
  return blob;
}

/**
 * Upload d'un média d'énigme vers Supabase Storage (bucket public `media`).
 * L'autorisation passe par /api/upload-url (URL signée, vérification que le
 * caller est bien l'organisateur) puis les octets partent directement du
 * client vers Storage.
 */
export async function uploadMedia(gameId: string, file: File): Promise<string> {
  let blob: Blob = file;
  let ext = (file.name.split(".").pop() || "bin").toLowerCase();
  let contentType = file.type;

  if (file.type.startsWith("image/")) {
    blob = await compressImage(file);
    ext = "webp";
    contentType = "image/webp";
  } else if (file.type.startsWith("video/")) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error("Vidéo trop lourde (maximum 50 Mo)");
    }
  } else {
    throw new Error("Format non supporté (image ou vidéo uniquement)");
  }

  const { data: sess } = await sb().auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) throw new Error("Session expirée — reconnecte-toi.");

  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ game_id: gameId, ext }),
  });
  const json = (await res.json()) as { path?: string; token?: string; error?: string };
  if (!res.ok || !json.path || !json.token) {
    throw new Error(json.error ?? "Autorisation d'upload refusée");
  }

  const { error } = await sb()
    .storage.from("media")
    .uploadToSignedUrl(json.path, json.token, blob, { contentType });
  if (error) throw new Error(error.message);

  return sb().storage.from("media").getPublicUrl(json.path).data.publicUrl;
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);
}
