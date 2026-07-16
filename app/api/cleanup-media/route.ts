import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Supprime tous les médias Storage d'une partie (appelé avant la suppression
 * de la partie elle-même — sinon les fichiers deviennent orphelins).
 */
export async function POST(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const admin = adminClient();
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Session invalide" }, { status: 401 });
    }

    const body = (await req.json()) as { game_id?: string };
    const gameId = body.game_id ?? "";
    if (!gameId) return NextResponse.json({ error: "Requête invalide" }, { status: 400 });

    const { data: game } = await admin
      .from("games")
      .select("id, created_by")
      .eq("id", gameId)
      .single();
    if (!game || game.created_by !== userData.user.id) {
      return NextResponse.json({ error: "Interdit" }, { status: 403 });
    }

    let removed = 0;
    // Les fichiers sont à plat sous {gameId}/ — on pagine par sécurité
    for (let page = 0; page < 20; page++) {
      const { data: files } = await admin.storage.from("media").list(gameId, {
        limit: 100,
        offset: 0, // toujours 0 : la liste rétrécit au fur et à mesure des suppressions
      });
      if (!files?.length) break;
      const paths = files.map((f) => `${gameId}/${f.name}`);
      const { error } = await admin.storage.from("media").remove(paths);
      if (error) break;
      removed += paths.length;
      if (files.length < 100) break;
    }

    return NextResponse.json({ removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
