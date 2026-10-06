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
 * Toutes les lignes d'une lecture, page par page — et une ERREUR arrête tout.
 *
 * Ici une liste incomplète n'est pas un affichage dégradé : un fichier qu'une
 * copie utilise encore passerait pour orphelin, et serait effacé. Or PostgREST
 * plafonne chaque réponse en silence (1000 lignes chez Supabase) : sans
 * pagination, passé ce nombre d'étapes sur l'ensemble des parties, des
 * références sortaient du compte. On avance de ce qui a été RENDU, pas de ce
 * qui a été demandé : un plafond serveur plus bas ne fait rien sauter.
 */
async function toutes<T>(
  page: (
    de: number,
    a: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const tout: T[] = [];
  for (let n = 0, de = 0; n < 1000; n++) {
    const { data, error } = await page(de, de + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) return tout;
    tout.push(...data);
    de += data.length;
  }
  throw new Error("Lecture interrompue : trop de lignes à relever");
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

    // Une lecture qui échoue fait tout échouer AVANT la moindre suppression :
    // mieux vaut des fichiers orphelins qu'une chasse vivante sans ses médias.
    const autresEtapes = await toutes<{ id: string; media_urls: string[] | null }>((de, a) =>
      admin.from("steps").select("id, media_urls").neq("game_id", gameId).order("id").range(de, a)
    );
    for (const row of autresEtapes) for (const url of row.media_urls ?? []) garder(url);

    // Indices illustrés des étapes des AUTRES parties.
    for (let i = 0; i < autresEtapes.length; i += 200) {
      const { data: secrets, error } = await admin
        .from("step_secrets")
        .select("hints")
        .in("step_id", autresEtapes.slice(i, i + 200).map((e) => e.id));
      if (error) throw new Error(error.message);
      for (const row of secrets ?? []) {
        for (const hint of (row.hints as { media_url?: unknown }[] | null) ?? []) {
          garder(hint?.media_url);
        }
      }
    }

    // Photos d'épreuve des autres parties (une copie hérite du dossier, pas des
    // photos — mais une URL recopiée à la main ne doit pas non plus sauter).
    // Seules celles qui pointent dans CE dossier : inutile de relire toutes
    // les photos de toutes les parties.
    const autresPhotos = await toutes<{ url: string }>((de, a) =>
      admin
        .from("submissions")
        .select("url")
        .neq("game_id", gameId)
        .like("url", `%/${gameId}/%`)
        .order("id")
        .range(de, a)
    );
    for (const row of autresPhotos) garder(row.url);

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
