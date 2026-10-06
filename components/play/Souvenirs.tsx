"use client";

import { useCallback, useEffect, useState } from "react";
import { sb } from "@/lib/supabase/client";
import type { TeamPhoto } from "@/lib/types";
import { showToast } from "@/components/ui/Toaster";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface SouvenirsProps {
  gameId: string;
  teamId: string;
  /** Code de la partie — sert à nommer l'archive. */
  code: string;
  /**
   * Photos déjà servies par `get_ranking`. Absentes (SQL pas encore
   * ré-appliqué) ou non fournies : le composant les charge lui-même.
   */
  photos?: TeamPhoto[];
}

/**
 * Les photos souvenir de MON équipe : celles des épreuves photo, à revoir et
 * à emporter à la fin.
 *
 * Elles se chargent DIRECTEMENT depuis `submissions` quand le classement ne
 * les fournit pas. La RLS le permet déjà — `submissions_select` laisse un
 * joueur lire celles de son équipe — donc l'écran ne dépend d'aucune version
 * du schéma.
 *
 * UN SEUL ENDROIT les affiche : le classement, entre le podium et la liste
 * complète. Pas l'écran de jeu : il porte l'épreuve en cours, et une galerie
 * qui s'allonge à chaque étape finirait par pousser l'énigme hors de l'écran.
 *
 * Sans photo, le composant ne rend RIEN plutôt qu'un cadre vide : il se
 * trouve au milieu du classement, où un bloc creux se verrait.
 */
export default function Souvenirs({ gameId, teamId, code, photos }: SouvenirsProps) {
  const [propres, setPropres] = useState<TeamPhoto[]>([]);
  const [zip, setZip] = useState(false);

  const charger = useCallback(async () => {
    if (!teamId) return;
    const { data } = await sb()
      .from("submissions")
      .select("id, url, created_at, step_id, status")
      .eq("game_id", gameId)
      .eq("team_id", teamId)
      .not("url", "is", null)
      .neq("status", "rejected")
      .order("created_at");
    const lignes = (data ?? []) as { id: string; url: string; created_at: string; step_id: string }[];
    if (!lignes.length) {
      setPropres([]);
      return;
    }
    // Le titre de l'étape est un confort, pas une condition : un joueur ne lit
    // que les étapes de son parcours déjà faites, ce qui couvre le cas normal.
    const { data: etapes } = await sb()
      .from("steps")
      .select("id, title")
      .in("id", [...new Set(lignes.map((l) => l.step_id))]);
    const titres = new Map((etapes ?? []).map((e) => [e.id as string, e.title as string]));
    setPropres(
      lignes.map((l) => ({
        id: l.id,
        url: l.url,
        step_title: titres.get(l.step_id) ?? "Photo souvenir",
        created_at: l.created_at,
      }))
    );
  }, [gameId, teamId]);

  const fournies = photos && photos.length > 0;
  useEffect(() => {
    if (!fournies) void charger();
  }, [fournies, charger]);

  const liste = fournies ? photos! : propres;
  if (!teamId || !liste.length) return null;

  return (
    <div className="mb-8">
      <h2 className="font-display text-2xl text-gold text-center -rotate-1">
        📸 {liste.length > 1 ? `VOS ${liste.length} PHOTOS SOUVENIRS` : "VOTRE PHOTO SOUVENIR"}
      </h2>
      <p className="text-center font-bold text-parchment/50 text-xs mt-1 mb-4 leading-relaxed">
        Visibles par ton équipe seulement. Télécharge-les : elles disparaîtront avec la partie.
      </p>

      <div className={liste.length > 1 ? "grid grid-cols-2 gap-3" : ""}>
        {liste.map((photo) => (
          <Card key={photo.id} className="p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.step_title}
              className="w-full rounded-xl border-2 border-ink"
              loading="lazy"
            />
            <div className="flex items-center gap-2 mt-2">
              <p className="font-display text-sm flex-1 min-w-0 truncate">{photo.step_title}</p>
              <button
                type="button"
                onClick={() => telechargerPhoto(photo)}
                aria-label={`Télécharger la photo « ${photo.step_title} »`}
                className="shrink-0 w-10 h-10 rounded-xl border-[3px] border-ink bg-gold font-display inline-flex items-center justify-center shadow-[2px_2px_0_0_#111111] active:translate-y-[1px]"
              >
                ⬇️
              </button>
            </div>
          </Card>
        ))}
      </div>

      {liste.length > 1 && (
        <Button
          full
          variant="parchment"
          className="mt-4"
          disabled={zip}
          onClick={async () => {
            setZip(true);
            try {
              await telechargerToutes(liste, code);
            } finally {
              setZip(false);
            }
          }}
        >
          {zip ? "Préparation…" : "⬇️ TOUT TÉLÉCHARGER"}
        </Button>
      )}
    </div>
  );
}

/**
 * Enregistre une photo sur le téléphone.
 *
 * Passe par un blob plutôt que par un simple lien : l'attribut `download` est
 * IGNORÉ pour une URL d'un autre domaine, et les photos sont servies depuis le
 * stockage Supabase — un lien direct ouvrirait l'image au lieu de la garder.
 * Si le fetch échoue (hors ligne, CORS), on ouvre l'image : un appui long
 * permet encore de l'enregistrer, ce qui vaut mieux que rien.
 */
async function telechargerPhoto(photo: TeamPhoto) {
  try {
    const blob = await (await fetch(photo.url)).blob();
    const url = URL.createObjectURL(blob);
    declencher(url, nomFichier(photo));
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch {
    window.open(photo.url, "_blank");
  }
}

/** Toutes les photos en une archive — sur un téléphone, une par une est long. */
async function telechargerToutes(photos: TeamPhoto[], code: string) {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    let ajoutees = 0;
    await Promise.all(
      photos.map(async (photo) => {
        try {
          zip.file(nomFichier(photo), await (await fetch(photo.url)).blob());
          ajoutees += 1;
        } catch {
          /* photo inaccessible — les autres partent quand même */
        }
      })
    );
    if (!ajoutees) {
      showToast("Photos inaccessibles — réessaie avec du réseau.", "error");
      return;
    }
    const url = URL.createObjectURL(await zip.generateAsync({ type: "blob" }));
    declencher(url, `souvenirs-${code}.zip`);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (ajoutees < photos.length) {
      const manquantes = photos.length - ajoutees;
      showToast(
        manquantes > 1
          ? `${manquantes} photos n'ont pas pu être ajoutées.`
          : "1 photo n'a pas pu être ajoutée.",
        "info"
      );
    }
  } catch {
    showToast("Téléchargement impossible — enregistre-les une par une.", "error");
  }
}

function nomFichier(photo: TeamPhoto): string {
  const propre = photo.step_title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 40)
    .replace(/^-|-$/g, "");
  return `${propre || "souvenir"}-${photo.id.slice(0, 6)}.webp`;
}

function declencher(url: string, nom: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
