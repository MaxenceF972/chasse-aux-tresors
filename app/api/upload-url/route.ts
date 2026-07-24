import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ALLOWED_EXT = new Set([
  "webp", "jpg", "jpeg", "png", "gif",
  "mp4", "webm", "mov", "m4v",
  "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac",
]);
// Garde-fou anti-abus : plafond de photos d'épreuve par partie (les joueurs
// anonymes ne doivent pas pouvoir remplir le Storage en boucle).
const MAX_SUBMISSIONS_PER_GAME = 400;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Délivre une URL d'upload signée vers le bucket `media`, réservée à
 * l'organisateur de la partie. Les octets partent ensuite directement du
 * client vers Supabase Storage (pas de limite de body serveur, pas de
 * dépendance aux policies RLS de storage.objects).
 */
export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const admin = adminClient();
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Session invalide — reconnecte-toi" }, { status: 401 });
    }

    const body = (await req.json()) as { game_id?: string; ext?: string; purpose?: string };
    const gameId = body.game_id ?? "";
    const ext = (body.ext ?? "").toLowerCase();
    const purpose = body.purpose === "submission" ? "submission" : "media";
    if (!gameId || !ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    if (purpose === "submission") {
      // Épreuve photo : le joueur doit appartenir à la partie (images uniquement)
      if (!["webp", "jpg", "jpeg", "png"].includes(ext)) {
        return NextResponse.json({ error: "Image uniquement" }, { status: 400 });
      }
      const { data: player } = await admin
        .from("players")
        .select("id")
        .eq("auth_uid", userData.user.id)
        .eq("game_id", gameId)
        .maybeSingle();
      if (!player) {
        return NextResponse.json({ error: "Tu ne participes pas à cette partie" }, { status: 403 });
      }
      // Plafond global de photos par partie (anti-abus Storage)
      const { data: existing } = await admin.storage
        .from("media")
        .list(gameId, { limit: MAX_SUBMISSIONS_PER_GAME + 1, search: "sub-" });
      if ((existing?.length ?? 0) >= MAX_SUBMISSIONS_PER_GAME) {
        return NextResponse.json(
          { error: "Limite de photos atteinte pour cette partie" },
          { status: 429 }
        );
      }
    } else {
      const { data: game } = await admin
        .from("games")
        .select("id, created_by")
        .eq("id", gameId)
        .single();
      if (!game || game.created_by !== userData.user.id) {
        return NextResponse.json(
          { error: "Seul l'organisateur de la partie peut envoyer des médias" },
          { status: 403 }
        );
      }
    }

    // Auto-réparation : crée le bucket s'il n'existe pas encore
    await admin.storage.createBucket("media", {
      public: true,
      fileSizeLimit: 52428800,
      allowedMimeTypes: ["image/*", "video/*", "audio/*"],
    });

    const path =
      purpose === "submission"
        ? `${gameId}/sub-${crypto.randomUUID()}.${ext}`
        : `${gameId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await admin.storage.from("media").createSignedUploadUrl(path);
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Création de l'URL d'upload impossible" },
        { status: 500 }
      );
    }

    return NextResponse.json({ path: data.path, token: data.token });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
