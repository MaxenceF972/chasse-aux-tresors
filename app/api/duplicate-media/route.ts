import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cheminStorage } from "@/lib/game/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

const BUCKET = "media";

interface Hint {
  media_url?: unknown;
  [k: string]: unknown;
}

/**
 * REND UNE PARTIE DUPLIQUÉE AUTONOME.
 *
 * `org_duplicate_game` recopie les URLs telles quelles : la copie pointe donc
 * sur le dossier Storage de l'ORIGINALE. Ça fonctionne — tant que l'originale
 * existe. C'est une corde tendue entre deux parties, et c'est elle qui a lâché
 * la première fois : supprimer l'originale crevait les images de la copie.
 *
 * Le trou a été bouché dans le nettoyage, mais la dépendance restait, muette et
 * invisible dans l'interface. Ici on la coupe : chaque fichier référencé par la
 * copie est recopié dans SON dossier, et les URLs sont réécrites. Après quoi
 * supprimer n'importe quelle partie est sans conséquence pour les autres, sans
 * avoir à croire sur parole un compteur de références.
 *
 * Best-effort assumé : un fichier introuvable (déjà perdu, ou URL externe) est
 * laissé tel quel plutôt que de faire échouer la duplication entière. Le compte
 * est renvoyé, l'appelant le dit à l'organisateur.
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

    const { data: steps } = await admin
      .from("steps")
      .select("id, media_urls")
      .eq("game_id", gameId);
    const etapes = (steps ?? []) as { id: string; media_urls: string[] | null }[];
    if (!etapes.length) return NextResponse.json({ copied: 0, rewritten: 0, missing: 0 });

    const { data: secrets } = await admin
      .from("step_secrets")
      .select("step_id, hints")
      .in(
        "step_id",
        etapes.map((e) => e.id)
      );
    const secretsRows = (secrets ?? []) as { step_id: string; hints: Hint[] | null }[];

    // Une seule copie par fichier, même s'il est cité par trois étapes.
    const aCopier = new Set<string>();
    const recenser = (url: unknown) => {
      const chemin = cheminStorage(url);
      if (chemin && !chemin.startsWith(`${gameId}/`)) aCopier.add(chemin);
    };
    for (const e of etapes) for (const u of e.media_urls ?? []) recenser(u);
    for (const s of secretsRows) for (const h of s.hints ?? []) recenser(h?.media_url);

    if (aCopier.size === 0) {
      return NextResponse.json({ copied: 0, rewritten: 0, missing: 0, already: true });
    }

    // ancien chemin -> nouvelle URL publique
    const nouvelle = new Map<string, string>();
    let manquants = 0;
    for (const ancien of aCopier) {
      const nom = ancien.split("/").pop() ?? "";
      if (!nom) continue;
      const cible = `${gameId}/${nom}`;
      const { error } = await admin.storage.from(BUCKET).copy(ancien, cible);
      if (error) {
        // Déjà copié par un essai précédent ? On garde la nouvelle URL. Sinon
        // le fichier a disparu : on laisse l'ancienne, qui n'est pas pire.
        const { data: existe } = await admin.storage
          .from(BUCKET)
          .list(gameId, { limit: 1, search: nom });
        if (!existe?.length) {
          manquants++;
          continue;
        }
      }
      nouvelle.set(ancien, admin.storage.from(BUCKET).getPublicUrl(cible).data.publicUrl);
    }

    const reecrire = (url: unknown): string | null => {
      const chemin = cheminStorage(url);
      return chemin ? (nouvelle.get(chemin) ?? null) : null;
    };

    let reecrits = 0;
    for (const e of etapes) {
      const avant = e.media_urls ?? [];
      const apres = avant.map((u) => reecrire(u) ?? u);
      if (apres.some((u, i) => u !== avant[i])) {
        await admin.from("steps").update({ media_urls: apres }).eq("id", e.id);
        reecrits += apres.length;
      }
    }
    for (const s of secretsRows) {
      const avant = s.hints ?? [];
      let change = false;
      const apres = avant.map((h) => {
        const u = reecrire(h?.media_url);
        if (!u) return h;
        change = true;
        return { ...h, media_url: u };
      });
      if (change) {
        await admin.from("step_secrets").update({ hints: apres }).eq("step_id", s.step_id);
        reecrits++;
      }
    }

    return NextResponse.json({ copied: nouvelle.size, rewritten: reecrits, missing: manquants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur serveur" },
      { status: 500 }
    );
  }
}
