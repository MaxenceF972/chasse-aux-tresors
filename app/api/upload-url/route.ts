import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const ALLOWED_EXT = new Set([
  "webp", "jpg", "jpeg", "png", "gif",
  "mp4", "webm", "mov", "m4v",
  "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba",
]);
// Garde-fous anti-abus des photos d'épreuve.
//
// Il n'y en avait qu'un : 400 fichiers pour TOUTE la partie, comptés dans le
// Storage — photos refusées comprises, et sans jamais rien libérer. Sur une
// chasse qui tourne plusieurs jours devant des centaines de visiteurs, le
// plafond tombe en pleine journée et il tombe pour TOUT LE MONDE À LA FOIS :
// une équipe qui envoie ses photos en boucle prive toutes les autres des
// leurs. Le plafond qui protège vraiment est celui par équipe.
const MAX_PHOTOS_PAR_EQUIPE = 60;
const MAX_PHOTOS_PAR_PARTIE = 5000;

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
      return NextResponse.json({ error: "Session expirée — recharge la page." }, { status: 401 });
    }

    const body = (await req.json()) as { game_id?: string; ext?: string; purpose?: string };
    const gameId = body.game_id ?? "";
    const ext = (body.ext ?? "").toLowerCase();
    const purpose = body.purpose === "submission" ? "submission" : "media";
    if (!gameId || !ALLOWED_EXT.has(ext)) {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    // Nom du fichier d'une photo d'épreuve : il porte l'équipe (voir plus bas).
    let prefixePhoto = "sub-";
    if (purpose === "submission") {
      // Épreuve photo : le joueur doit appartenir à la partie (images uniquement)
      if (!["webp", "jpg", "jpeg", "png"].includes(ext)) {
        return NextResponse.json({ error: "Image uniquement" }, { status: 400 });
      }
      const { data: player } = await admin
        .from("players")
        .select("id, team_id")
        .eq("auth_uid", userData.user.id)
        .eq("game_id", gameId)
        .maybeSingle();
      if (!player) {
        return NextResponse.json(
          { error: "Tu ne participes pas à cette partie." },
          { status: 403 }
        );
      }

      // DEUX PLAFONDS, deux façons de compter.
      //
      // Par équipe : les FICHIERS déposés, pas les lignes de `submissions`.
      // L'URL signée s'obtient AVANT l'envoi, et la ligne n'apparaît qu'à
      // submit_photo : compter les lignes laissait un client demander des URL
      // en boucle, déposer, ne jamais déclarer — sans aucune limite. Le nom
      // du fichier porte l'équipe, ce qui ramène le compte à une liste courte
      // (au plus MAX_PHOTOS_PAR_EQUIPE + 1 entrées).
      //
      // Par partie : les photos déclarées (`submissions`, indexé). Lister des
      // milliers de fichiers à chaque photo serait lent, et le plafond par
      // équipe borne déjà ce qu'un client peut déposer sans le déclarer.
      const equipeId = (player as { team_id: string | null }).team_id;
      if (equipeId) {
        prefixePhoto = `sub-${equipeId}-`;
        const { data: deposes } = await admin.storage
          .from("media")
          .list(gameId, { limit: MAX_PHOTOS_PAR_EQUIPE + 1, search: `sub-${equipeId}` });
        if ((deposes?.length ?? 0) >= MAX_PHOTOS_PAR_EQUIPE) {
          return NextResponse.json(
            { error: "Ton équipe a atteint son nombre maximum de photos." },
            { status: 429 }
          );
        }
      }
      const { count: total } = await admin
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("game_id", gameId)
        .not("url", "is", null);
      if ((total ?? 0) >= MAX_PHOTOS_PAR_PARTIE) {
        return NextResponse.json(
          { error: "Limite de photos atteinte pour cette partie." },
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
        ? `${gameId}/${prefixePhoto}${crypto.randomUUID()}.${ext}`
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
