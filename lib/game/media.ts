import { sb } from "@/lib/supabase/client";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

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
 * Ré-encodage vidéo best-effort (MediaRecorder à ~1,8 Mbps) : divise
 * généralement le poids par 3 à 10. Lecture en temps réel → réservé aux
 * clips ≤ 4 min ; en cas d'échec ou de navigateur non compatible,
 * l'original est envoyé tel quel.
 */
async function compressVideo(file: File): Promise<{ blob: Blob; ext: string; type: string } | null> {
  try {
    if (typeof MediaRecorder === "undefined") return null;
    if (file.size < 12 * 1024 * 1024) return null; // déjà raisonnable

    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) return null;

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("metadata"));
        setTimeout(() => reject(new Error("timeout")), 10000);
      });
      if (!isFinite(video.duration) || video.duration > 240) return null;

      const capturable = video as HTMLVideoElement & { captureStream?: () => MediaStream };
      const stream = capturable.captureStream?.();
      if (!stream) return null;

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 1_800_000,
        audioBitsPerSecond: 96_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
      });

      recorder.start(1000);
      await video.play();
      await new Promise<void>((resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = () => reject(new Error("lecture"));
        setTimeout(() => reject(new Error("timeout")), (video.duration + 30) * 1000);
      });
      recorder.stop();
      await stopped;

      const out = new Blob(chunks, { type: mime.split(";")[0] });
      if (out.size === 0 || out.size >= file.size) return null;
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      return { blob: out, ext, type: mime.split(";")[0] };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
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
    const compressed = await compressVideo(file);
    if (compressed) {
      blob = compressed.blob;
      ext = compressed.ext;
      contentType = compressed.type;
    }
    if (blob.size > MAX_VIDEO_BYTES) {
      throw new Error(
        "Vidéo trop lourde (max 50 Mo) — coupe-la ou compresse-la depuis la galerie du téléphone"
      );
    }
  } else if (file.type.startsWith("audio/")) {
    if (file.size > MAX_AUDIO_BYTES) {
      throw new Error("Fichier audio trop lourd (max 20 Mo)");
    }
  } else {
    throw new Error("Format non supporté (image, vidéo ou audio uniquement)");
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

export function isAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|$)/i.test(url);
}

/** Upload de la photo d'une épreuve photo (joueur, compressée WebP). */
export async function uploadSubmissionPhoto(gameId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Photo uniquement !");
  const blob = await compressImage(file, 1400, 0.8);

  const { data: sess } = await sb().auth.getSession();
  const accessToken = sess.session?.access_token;
  if (!accessToken) throw new Error("Session expirée");

  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ game_id: gameId, ext: "webp", purpose: "submission" }),
  });
  const json = (await res.json()) as { path?: string; token?: string; error?: string };
  if (!res.ok || !json.path || !json.token) {
    throw new Error(json.error ?? "Upload refusé");
  }

  const { error } = await sb()
    .storage.from("media")
    .uploadToSignedUrl(json.path, json.token, blob, { contentType: "image/webp" });
  if (error) throw new Error(error.message);

  return sb().storage.from("media").getPublicUrl(json.path).data.publicUrl;
}
