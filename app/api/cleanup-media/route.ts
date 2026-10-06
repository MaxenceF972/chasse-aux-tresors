import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cheminStorage } from "@/lib/game/storage";

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

    // UNE PARTIE DUPLIQUÉE POINTE SUR LE DOSSIER DE L'ORIGINAL.
    //
    // org_duplicate_game recopie les URLs telles quelles : la copie de la
    // saison prochaine référence encore `{partie d'origine}/xxx.webp`. Effacer
    // l'original, c'est donc crever les médias d'une chasse bien vivante.
    //
    // Il faut relever TOUT ce qui peut porter une URL, et pas seulement les
    // médias d'énoncé. C'est ce qui manquait : les indices vivent dans
    // step_secrets.hints, et les photos d'épreuve dans submissions. Un indice
    // illustré d'une partie dupliquée disparaissait à la suppression de son
    // original — l'équipe se retrouvait devant un cadre vide.
    const shared = new Set<string>();
    const garder = (url: unknown) => {
      // Lecture partagée avec la duplication (lib/game/storage.ts). L'ancienne
      // cherchait « /{id}/ » n'importe où dans l'URL : un identifiant apparu
      // dans un nom de fichier ou un paramètre passait pour un dossier.
      const chemin = cheminStorage(url);
      if (chemin && chemin.startsWith(`${gameId}/`)) shared.add(chemin);
    };

    const { data: otherSteps } = await admin
      .from("steps")
      .select("id, media_urls")
      .neq("game_id", gameId);
    const autresEtapes = (otherSteps ?? []) as { id: string; media_urls: string[] | null }[];
    for (const row of autresEtapes) for (const url of row.media_urls ?? []) garder(url);

    // Indices illustrés des étapes des AUTRES parties.
    for (let i = 0; i < autresEtapes.length; i += 200) {
      const { data: secrets } = await admin
        .from("step_secrets")
        .select("hints")
        .in("step_id", autresEtapes.slice(i, i + 200).map((e) => e.id));
      for (const row of secrets ?? []) {
        for (const hint of (row.hints as { media_url?: unknown }[] | null) ?? []) {
          garder(hint?.media_url);
        }
      }
    }

    // Photos d'épreuve des autres parties (une copie hérite du dossier, pas des
    // photos — mais une URL recopiée à la main ne doit pas non plus sauter).
    const { data: autresPhotos } = await admin
      .from("submissions")
      .select("url")
      .neq("game_id", gameId)
      .not("url", "is", null);
    for (const row of autresPhotos ?? []) garder(row.url);

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
