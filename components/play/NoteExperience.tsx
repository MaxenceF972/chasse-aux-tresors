"use client";

import { useEffect, useState } from "react";
import { rpc, sb } from "@/lib/supabase/client";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

interface NoteExperienceProps {
  /** Équipe du joueur — sert à retrouver sa note s'il revient sur l'écran. */
  teamId: string;
}

/**
 * La note de l'aventure, de 1 à 5 étoiles — par JOUEUR, pas par équipe : dans
 * un groupe de quatre, la première personne à toucher l'écran déciderait pour
 * les trois autres.
 *
 * ELLE EST FAITE POUR ÊTRE VUE, et c'est tout l'enjeu : une note que personne
 * ne donne ne sert à rien. D'où sa place (juste sous le podium, avant les
 * photos et la liste complète), sa forme (une carte, pas trois lignes perdues
 * sur du noir) et son effort (deux gestes : on choisit, on valide).
 *
 * POURQUOI UNE VALIDATION, alors qu'un seul doigt serait plus court : sur un
 * écran qu'on fait défiler au pouce, un doigt qui glisse enregistrerait un avis
 * que personne n'a voulu donner — et sans retour, personne ne le saurait. Le
 * bouton n'apparaît qu'UNE FOIS UNE ÉTOILE CHOISIE : il ne pèse rien tant
 * qu'on n'a pas décidé.
 *
 * Elle se REPOSE : toucher une autre étoile fait revenir le bouton. Une note
 * qu'on ne peut donner qu'une fois se donne mal.
 */
export default function NoteExperience({ teamId }: NoteExperienceProps) {
  // `note` = ce que le doigt a choisi. `envoyee` = ce que la base connaît.
  // Les deux diffèrent exactement pendant qu'il reste quelque chose à valider.
  const [note, setNote] = useState<number | null>(null);
  const [envoyee, setEnvoyee] = useState<number | null>(null);
  const [survol, setSurvol] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState(false);

  // Une note déjà donnée doit se retrouver au rechargement, sinon l'écran
  // redemande ce qu'il a déjà, et le joueur croit que ça n'a pas marché.
  // La RLS le permet : un joueur lit les lignes de son équipe.
  useEffect(() => {
    if (!teamId) return;
    let vivant = true;
    void (async () => {
      const { data } = await sb().auth.getUser();
      const uid = data.user?.id;
      if (!uid) return;
      const res = await sb().from("players").select("rating").eq("auth_uid", uid).maybeSingle();
      if (vivant && res.data?.rating) {
        setNote(res.data.rating as number);
        setEnvoyee(res.data.rating as number);
      }
    })();
    return () => {
      vivant = false;
    };
  }, [teamId]);

  /** Choisir : rien ne part encore. */
  function choisir(n: number) {
    setNote(n);
    setErreur(false);
    sfx.tick();
    haptics.tap();
  }

  /** Valider : c'est ici, et seulement ici, que la note quitte le téléphone. */
  async function valider() {
    if (note == null) return;
    setBusy(true);
    setErreur(false);
    try {
      await rpc("rate_experience", { p_rating: note });
      setEnvoyee(note);
      sfx.success();
      haptics.success();
    } catch {
      setErreur(true);
    } finally {
      setBusy(false);
    }
  }

  const montre = survol ?? note ?? 0;
  const repondu = envoyee != null && envoyee === note && !erreur;

  const etoiles = (
    <div
      className="flex items-center justify-center gap-0.5"
      role="radiogroup"
      aria-label="Ta note, de 1 à 5 étoiles"
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={note === n}
          aria-label={`${n} sur 5`}
          onClick={() => choisir(n)}
          onPointerEnter={() => setSurvol(n)}
          onPointerLeave={() => setSurvol(null)}
          /* La cible au doigt reste large même quand l'étoile rétrécit : ce
             qu'on vise n'est pas ce qu'on voit. */
          className={`flex items-center justify-center active:scale-90 transition-transform ${
            repondu ? "w-11 h-11" : "w-12 h-12"
          }`}
        >
          <svg
            viewBox="0 0 24 24"
            className={repondu ? "w-7 h-7" : "w-10 h-10"}
            fill={n <= montre ? "#F5A623" : "none"}
            stroke={repondu ? (n <= montre ? "#111111" : "#EDE0C4") : "#111111"}
            strokeOpacity={n <= montre ? 1 : 0.5}
            strokeWidth="1.8"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.7l6.1-.9z" />
          </svg>
        </button>
      ))}
    </div>
  );

  // RÉPONDU : la carte s'efface en une ligne. Elle a obtenu ce qu'elle
  // demandait, et la place revient au classement. Les étoiles restent
  // touchables — en toucher une autre fait repasser en mode « à valider ».
  if (repondu) {
    return (
      <div className="my-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        {etoiles}
        <p className="font-bold text-parchment/60 text-sm">Merci, ton avis est enregistré ! 🙏</p>
      </div>
    );
  }

  return (
    <Card className="mt-2 mb-8 px-5 py-6 text-center">
      <p className="font-display text-sm text-gold-dark">⭐ TON AVIS</p>
      <p className="font-display text-2xl mt-1 leading-snug">
        Comment as-tu trouvé l&apos;aventure ?
      </p>
      <div className="mt-3">{etoiles}</div>

      {/* Le bouton n'existe qu'une fois une étoile choisie : tant qu'on n'a
          rien décidé, la carte ne réclame rien. */}
      {note != null && (
        <Button full size="lg" variant="gold" className="mt-4" disabled={busy} onClick={valider}>
          {busy ? "…" : envoyee != null ? "MODIFIER MA NOTE" : "VALIDER MA NOTE"}
        </Button>
      )}

      {/* La seule ligne sous les étoiles est FONCTIONNELLE : elle explique
          pourquoi l'écran attend. */}
      {note != null && (
        <p className="font-bold text-ink/50 text-xs mt-3 leading-relaxed">
          Rien n&apos;est envoyé tant que tu n&apos;as pas validé.
        </p>
      )}
      {erreur && (
        <p className="font-bold text-crimson text-xs mt-3">
          Note non enregistrée — réseau. Touche à nouveau « Valider ».
        </p>
      )}
    </Card>
  );
}
