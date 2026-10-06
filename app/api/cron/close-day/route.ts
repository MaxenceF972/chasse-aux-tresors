import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fermeture du soir — pour les parties qui l'ont demandée (`auto_close`).
 *
 * Une chasse en continu ouverte au public n'a souvent personne pour cliquer
 * « terminer » à l'heure : sans ce passage quotidien, la partie de lundi
 * tourne encore le jeudi et le classement du jour ne veut plus rien dire.
 *
 * Déclenchée par le cron de Vercel (voir vercel.json). La fenêtre exacte
 * importe peu : close_expired_games() décide elle-même, dans le fuseau de
 * chaque partie, et se rappelle sans dommage.
 *
 * Appelable aussi à la main pendant la mise en service :
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/close-day
 */
export async function GET(req: NextRequest) {
  // Vercel envoie ce jeton de lui-même dès que CRON_SECRET existe. Sans le
  // secret configuré, la route reste ouverte — elle ne fait que fermer des
  // parties expirées, mais autant ne pas laisser ça traîner : le message
  // ci-dessous le rappelle dans la réponse.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { error: "Configuration Supabase absente côté serveur" },
      { status: 500 }
    );
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("close_expired_games");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ...(data as object),
    ...(secret ? {} : { avertissement: "CRON_SECRET non défini : route non protégée." }),
  });
}
