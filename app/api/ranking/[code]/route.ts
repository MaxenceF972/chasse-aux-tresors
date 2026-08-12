import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Classement d'une partie, en accès PUBLIC (aucune authentification).
 *
 * Sert la page de partage /r/[code] : les proches qui ne jouent pas doivent
 * pouvoir suivre le classement sans créer de compte ni rejoindre la partie.
 * On passe par la clé service_role côté serveur — jamais exposée au client —
 * et on ne renvoie que ce que get_ranking expose déjà aux participants :
 * noms d'équipes, scores, récompenses, photos à l'honneur. Aucune énigme,
 * aucune réponse, aucune position GPS.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const clean = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) {
    return NextResponse.json({ error: "CODE_INVALIDE" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data, error } = await admin.rpc("get_ranking", { p_code: clean });
  if (error) {
    return NextResponse.json({ error: "INDISPONIBLE" }, { status: 500 });
  }
  if (!data || (data as { error?: string }).error) {
    return NextResponse.json({ error: "PARTIE_INTROUVABLE" }, { status: 404 });
  }

  // Un court cache CDN suffit à encaisser une salve de spectateurs sans que
  // le classement paraisse figé.
  return NextResponse.json(data, {
    headers: { "cache-control": "public, s-maxage=10, stale-while-revalidate=30" },
  });
}
