import type { Metadata } from "next";
import { createClient } from "@supabase/supabase-js";
import type { RankingData } from "@/lib/types";
import PublicRanking from "./PublicRanking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Classement d'une partie, lu côté serveur (clé service_role, jamais exposée). */
async function fetchRanking(code: string): Promise<RankingData | null> {
  const clean = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(clean)) return null;
  try {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data, error } = await admin.rpc("get_ranking", { p_code: clean });
    if (error || !data || (data as { error?: string }).error) return null;
    return data as RankingData;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const data = await fetchRanking(code);
  const name = data?.game?.name;
  const title = name ? `Classement — ${name}` : "Classement — TOYAH GAMES";
  const description = name
    ? `Le classement de « ${name} », chasse au trésor TOYAH GAMES.`
    : "Le classement d'une chasse au trésor TOYAH GAMES.";
  return {
    title,
    description,
    // Page publique mais pas destinée aux moteurs : on la partage par lien.
    robots: { index: false, follow: false },
    openGraph: { title, description },
  };
}

/**
 * Page de partage du classement : ouverte à tous, sans compte ni inscription.
 * Le premier rendu vient du serveur (affichage immédiat, aperçu de lien
 * correct), puis la page se rafraîchit d'elle-même côté client.
 */
export default async function PublicRankingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const initial = await fetchRanking(code);
  return <PublicRanking code={code.toUpperCase()} initial={initial} />;
}
