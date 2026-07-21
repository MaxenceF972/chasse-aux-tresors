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

    // Une partie dupliquée référence les médias du dossier de l'original :
    // on préserve tout fichier encore utilisé par les étapes d'une autre partie.
    const shared = new Set<string>();
    const { data: otherSteps } = await admin
      .from("steps")
      .select("media_urls")
      .neq("game_id", gameId);
    for (const row of otherSteps ?? []) {
      for (const url of (row.media_urls as string[] | null) ?? []) {
        const idx = url.indexOf(`/${gameId}/`);
        if (idx >= 0) shared.add(`${gameId}/${url.slice(idx + gameId.length + 2).split("?")[0]}`);
      }
    }

    let removed = 0;
    let offset = 0; // les fichiers préservés restent en tête de liste
    // Les fichiers sont à plat sous {gameId}/ — on pagine par sécurité
    for (let page = 0; page < 40; page++) {
      const { data: files } = await admin.storage.from("media").list(gameId, {
        limit: 100,
        offset,
      });
      if (!files?.length) break;
      const paths = files.map((f) => `${gameId}/${f.name}`);
      const toRemove = paths.filter((p) => !shared.has(p));
      offset += paths.length - toRemove.length;
      if (toRemove.length) {
        const { error } = await admin.storage.from("media").remove(toRemove);
        if (error) break;
        removed += toRemove.length;
      }
      if (files.length < 100) break;
    }

    return NextResponse.json({ removed, preserved: shared.size });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
