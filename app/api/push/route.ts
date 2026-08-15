import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Envoie une notification push aux devices d'une équipe (message de
 * l'organisateur). Complète le toast temps réel : vibre même app fermée.
 */
export async function POST(req: NextRequest) {
  try {
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      return NextResponse.json({ error: "Push non configuré" }, { status: 501 });
    }
    webpush.setVapidDetails("mailto:maxence.fortier@gmail.com", pub, priv);

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

    const admin = adminClient();
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return NextResponse.json({ error: "Session invalide" }, { status: 401 });
    }

    const body = (await req.json()) as {
      team_id?: string;
      game_id?: string;
      message?: string;
      kind?: string;
    };
    const teamId = body.team_id ?? "";
    const gameId = body.game_id ?? "";
    const message = (body.message ?? "").slice(0, 300);
    if ((!teamId && !gameId) || !message) {
      return NextResponse.json({ error: "Requête invalide" }, { status: 400 });
    }

    // Le caller doit être l'organisateur — de la partie visée (message général)
    // ou de celle à laquelle l'équipe appartient (message privé).
    let game: { created_by: string; code: string } | null = null;
    if (gameId) {
      const { data } = await admin
        .from("games")
        .select("created_by, code")
        .eq("id", gameId)
        .single();
      game = data as typeof game;
    } else {
      const { data: team } = await admin
        .from("teams")
        .select("id, game_id, games!inner(created_by, code)")
        .eq("id", teamId)
        .single();
      game = (team as { games?: { created_by: string; code: string } } | null)?.games ?? null;
    }
    if (!game || game.created_by !== userData.user.id) {
      return NextResponse.json({ error: "Interdit" }, { status: 403 });
    }

    const query = admin.from("push_subscriptions").select("auth_uid, subscription");
    const { data: subs } = gameId
      ? await query.eq("game_id", gameId)
      : await query.eq("team_id", teamId);

    const title = gameId
      ? body.kind === "alert"
        ? "🚨 ALERTE"
        : body.kind === "warning"
          ? "⚠️ Avertissement"
          : "📣 Annonce"
      : "📨 Message de l'organisateur";

    let sent = 0;
    await Promise.allSettled(
      (subs ?? []).map(async (row) => {
        try {
          await webpush.sendNotification(
            row.subscription as webpush.PushSubscription,
            JSON.stringify({
              title,
              body: message,
              url: `/play/${game!.code}/game`,
            })
          );
          sent++;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // abonnement mort → nettoyage
            await admin.from("push_subscriptions").delete().eq("auth_uid", row.auth_uid);
          }
        }
      })
    );

    return NextResponse.json({ sent });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
