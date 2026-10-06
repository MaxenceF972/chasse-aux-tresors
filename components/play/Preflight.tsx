"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import Consignes from "@/components/play/Consignes";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import {
  LIBELLES,
  aRegler,
  navigateur,
  plateforme,
  remedeBoussole,
  remedeMemoire,
  remedeNfc,
  remedePhoto,
  remedePosition,
  remedePrecision,
  remedeReseau,
  remedeSon,
  verdict,
  type Constat,
  type Etat,
  type Plateforme,
  type Remede,
  type Sujet,
} from "@/lib/game/diagnostic";
import {
  capteurRepond,
  demanderOrientation,
  demanderPosition,
  enLigne,
  etatPositionSansDemander,
  memoireDisponible,
  orientationAccordee,
  orientationDemandeGeste,
  photoDisponible,
} from "@/lib/game/permissions";
import { getGeoConsent, isMuted, setGeoConsent, setMuted } from "@/lib/game/prefs";
import { enablePush, isPushEnabled, pushSupported } from "@/lib/push";

interface PreflightProps {
  /**
   * La vérification est terminée. C'est l'appelant qui note qu'elle est
   * passée — y compris, au départ, quand elle est passée en la sautant : une
   * vérification qu'on peut refuser mais qui revient à chaque écran est
   * exactement le harcèlement qu'on démonte ici.
   */
  onTermine: () => void;
  /** Refermer sans avoir vérifié (contextes « lobby » et « menu »). */
  onFermer?: () => void;
  /** Charte de l'organisateur (settings.charter), sinon la charte par défaut. */
  charter?: string[];
  /**
   * D'où l'on vient, ce qui décide des libellés et de la charte :
   *  - « depart » (défaut) : juste avant le chrono — charte, puis vérification,
   *    et le bouton final lance la partie ;
   *  - « lobby » : en attendant le lancement — charte, vérification, retour ;
   *  - « menu » : rouvert en pleine partie pour retrouver un réglage perdu —
   *    pas de charte, on ne fait pas relire un règlement déjà accepté.
   */
  contexte?: "depart" | "lobby" | "menu";
  /**
   * Montrer la charte d'abord. Par défaut : partout sauf depuis le menu.
   * L'écran de jeu l'éteint au coup d'envoi d'un départ groupé : le chrono
   * tourne déjà, le capitaine l'a acceptée au lobby, et la relire coûterait
   * des minutes à chaque téléphone.
   */
  avecCharte?: boolean;
}

const PICTO: Record<Sujet, string> = {
  reseau: "📶",
  position: "📍",
  boussole: "🧭",
  nfc: "🏷️",
  photo: "📸",
  son: "🔊",
  memoire: "💾",
};

/** Ordre de lecture : ce qui empêche de jouer d'abord, le confort ensuite. */
const ORDRE: Sujet[] = ["reseau", "position", "boussole", "nfc", "photo", "son", "memoire"];

/**
 * Au-delà, ce n'est plus une position : c'est un quartier. Le seuil est haut
 * exprès — un premier point capté sous un toit tourne autour de 100 m, et
 * traiter ça de panne ferait douter tout le monde pour rien. La localisation
 * approximative d'iOS, elle, rend des kilomètres.
 */
const PRECISION_INUTILISABLE_M = 1000;

interface Ligne {
  etat: Etat;
  /** Précision du lieu, ou mention (« par le téléphone ») à côté de l'état. */
  detail?: string;
  precisionM?: number;
  remede?: Remede;
}

/**
 * La vérification du téléphone, avant de partir.
 *
 * Elle existe pour une raison très concrète : les fenêtres système du
 * téléphone. Elles citent l'adresse du site entre guillemets, elles arrivent
 * sans prévenir, et quand elles tombent au milieu d'une épreuve — par-dessus
 * un cadran qui cherche un signal qu'il n'aura jamais — elles se lisent comme
 * un piège. Quelques joueurs touchent « Ne pas autoriser » par réflexe, et
 * jouent le reste du parcours amputés d'une moitié du jeu sans comprendre
 * pourquoi.
 *
 * D'où la mise en scène, qui est le fond du travail ici :
 *
 *  1. On ANNONCE. Un écran dit ce que le téléphone va demander, dans quel
 *     ordre, et pourquoi. Une fenêtre attendue n'est plus une alerte.
 *  2. On demande TOUT D'UN COUP, à l'arrêt, une seule fois par partie.
 *  3. On rend un état lisible, et pour chaque chose qui cloche, la marche à
 *     suivre exacte — sans jamais faire sortir de l'application.
 *  4. On ne bloque personne. Le bouton de départ est toujours là ; c'est son
 *     libellé qui change.
 *
 * Le reste du jeu ne demande plus rien : voir lib/game/permissions.ts.
 */
export default function Preflight({
  onTermine,
  onFermer,
  charter,
  contexte = "depart",
  avecCharte = contexte !== "menu",
}: PreflightProps) {
  const [etape, setEtape] = useState<"consignes" | "annonce" | "liste">(
    avecCharte ? "consignes" : "annonce"
  );
  const depart = contexte === "depart";
  const [plat, setPlat] = useState<Plateforme>("autre");
  const [lignes, setLignes] = useState<Record<Sujet, Ligne>>({
    reseau: { etat: "encours" },
    position: { etat: "encours" },
    boussole: { etat: "encours" },
    nfc: { etat: "encours" },
    photo: { etat: "encours" },
    son: { etat: "inconnu" },
    memoire: { etat: "encours" },
  });
  const [sonJoue, setSonJoue] = useState(false);
  const [partage, setPartage] = useState<"granted" | "denied" | null>(null);
  const [push, setPush] = useState<"off" | "on" | "busy">("off");
  const [pushErreur, setPushErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<Sujet | null>(null);

  const poser = useCallback((sujet: Sujet, ligne: Ligne) => {
    setLignes((prev) => ({ ...prev, [sujet]: ligne }));
  }, []);

  // Les vérifications muettes du montage tournent une seconde et demie (elles
  // écoutent le magnétomètre). Un appui rapide sur « Vérifier » lancerait les
  // vraies demandes par-dessus, et la réponse muette, arrivant après, écraserait
  // le résultat obtenu. Ce drapeau les fait taire dès que le vrai travail
  // commence.
  const lanceRef = useRef(false);

  useEffect(() => {
    setPlat(plateforme(navigator.userAgent, navigator.maxTouchPoints));
    setPartage(getGeoConsent());
    void isPushEnabled().then((on) => setPush(on ? "on" : "off"));
  }, []);

  /* Les vérifications MUETTES : aucune fenêtre système, on peut les lancer au
     montage. Elles remplissent déjà la moitié de la liste. */
  const verifierMuet = useCallback(async () => {
    const p = plateforme(navigator.userAgent, navigator.maxTouchPoints);
    const n = navigateur(navigator.userAgent);
    poser("reseau", enLigne() ? { etat: "ok" } : { etat: "refus", remede: remedeReseau() });
    poser(
      "memoire",
      memoireDisponible() ? { etat: "ok" } : { etat: "refus", remede: remedeMemoire(p) }
    );
    poser("photo", photoDisponible() ? { etat: "ok" } : { etat: "absent", remede: remedePhoto() });
    /* LES BALISES SONT LUES PAR LE SYSTÈME, pas par la page — sur Android
       comme sur iPhone. Le lien que porte la puce ouvre le navigateur tout
       seul. Sur iPhone, la réponse est oui par construction. Sur Android, on
       ne PEUT pas savoir (aucune API web ne dit si l'appareil a une puce NFC
       ni si elle est allumée) : on répond « à vérifier », plutôt qu'une croix
       fausse ou une coche verte au hasard. */
    poser(
      "nfc",
      p === "ios"
        ? { etat: "ok", detail: "par le téléphone" }
        : p === "android"
          ? { etat: "inconnu", remede: remedeNfc(p) }
          : { etat: "absent", remede: remedeNfc(p) }
    );

    // La position, sans rien demander : le navigateur répond parfois déjà.
    const dejaVu = await etatPositionSansDemander();
    if (!lanceRef.current) {
      if (dejaVu === "ok") poser("position", { etat: "ok" });
      else if (dejaVu === "refus")
        poser("position", { etat: "refus", remede: remedePosition(p, "refus", n) });
      else poser("position", { etat: "inconnu" });
    }

    // La boussole : accordée à un passage précédent, ou pas d'autorisation à
    // donner sur cet appareil — dans les deux cas on peut écouter tout de suite.
    if (!orientationDemandeGeste() || orientationAccordee()) {
      const repond = await capteurRepond();
      if (!lanceRef.current) {
        poser(
          "boussole",
          repond ? { etat: "ok" } : { etat: "absent", remede: remedeBoussole(p, "absent", n) }
        );
      }
    } else {
      poser("boussole", { etat: "inconnu" });
    }
  }, [poser]);

  useEffect(() => {
    void verifierMuet();
  }, [verifierMuet]);

  /** La position, pour de bon — c'est ici que la fenêtre système apparaît. */
  const verifierPosition = useCallback(async () => {
    const p = plateforme(navigator.userAgent, navigator.maxTouchPoints);
    const n = navigateur(navigator.userAgent);
    poser("position", { etat: "encours" });
    const lec = await demanderPosition();
    if (lec.etat === "ok") {
      // Une position rendue mais inexploitable est le seul cas où « ça marche »
      // ment : on la range parmi les choses à régler, pas parmi les coches.
      if (lec.precisionM != null && lec.precisionM > PRECISION_INUTILISABLE_M) {
        poser("position", { etat: "degrade", remede: remedePrecision(p, lec.precisionM) });
      } else {
        poser("position", { etat: "ok", precisionM: lec.precisionM ?? undefined });
      }
    } else {
      poser("position", {
        etat: lec.cause === "refus" ? "refus" : "absent",
        remede: remedePosition(p, lec.cause ?? "introuvable", n),
      });
    }
  }, [poser]);

  /** La boussole, pour de bon. iPhone : l'appui de l'utilisateur est obligatoire. */
  const verifierBoussole = useCallback(async () => {
    const p = plateforme(navigator.userAgent, navigator.maxTouchPoints);
    const n = navigateur(navigator.userAgent);
    poser("boussole", { etat: "encours" });
    const rep = await demanderOrientation();
    if (rep === "ok") poser("boussole", { etat: "ok" });
    else
      poser("boussole", {
        etat: rep === "refus" ? "refus" : "absent",
        remede: remedeBoussole(p, rep === "refus" ? "refus" : "absent", n),
      });
  }, [poser]);

  /**
   * L'appui unique qui déclenche les deux fenêtres, dans cet ordre.
   * L'orientation d'abord : c'est la seule des deux que Safari refuse hors
   * d'un appui, et l'attendre laisse la seconde fenêtre s'ouvrir proprement
   * derrière.
   */
  async function lancerLesDemandes() {
    lanceRef.current = true;
    setEtape("liste");
    await verifierBoussole();
    await verifierPosition();
  }

  function ecouter() {
    if (isMuted()) setMuted(false);
    sfx.success();
    haptics.success();
    setSonJoue(true);
  }

  async function activerPush() {
    setPush("busy");
    setPushErreur(null);
    const res = await enablePush();
    if (res.ok) {
      setPush("on");
      haptics.success();
    } else {
      setPush("off");
      setPushErreur(res.error ?? null);
    }
  }

  const constats: Constat[] = ORDRE.map((s) => ({ sujet: s, etat: lignes[s].etat }));
  const etatGeneral = verdict(constats);
  const soucis = aRegler(constats);

  /* ----------------------------------------------------------- la charte */

  if (etape === "consignes") {
    return (
      <Cadre>
        <Consignes charter={charter} onContinuer={() => setEtape("annonce")} />
      </Cadre>
    );
  }

  /* ------------------------------------------------------------- l'annonce */

  if (etape === "annonce") {
    const deuxFenetres = orientationDemandeGeste() && !orientationAccordee();
    return (
      <Cadre>
        <p className="font-display text-sm text-gold-dark">📱 AVANT DE PARTIR</p>
        <h1 className="font-display text-3xl leading-tight mt-1">
          Une minute pour vérifier ton téléphone
        </h1>
        <p className="font-bold text-ink/65 text-sm leading-relaxed mt-3">
          La chasse se joue dehors, sur l&apos;écran que tu tiens. Deux ou trois réglages
          décident de ce que tu pourras faire — autant s&apos;en occuper maintenant, au calme,
          plutôt qu&apos;au pied d&apos;une balise.
        </p>

        <div className="mt-5 rounded-2xl border-[3px] border-ink bg-white/60 p-4">
          <p className="font-display text-lg leading-snug">
            {deuxFenetres
              ? "Ton téléphone va poser deux questions."
              : "Ton téléphone va poser une question."}
          </p>
          <p className="font-bold text-ink/65 text-sm leading-relaxed mt-1.5">
            {deuxFenetres
              ? "D'abord l'accès au mouvement, pour la boussole. Puis l'accès à la position, pour les étapes où il faut se rendre quelque part. Réponds oui aux deux !"
              : "L'accès à ta position, pour les étapes où il faut se rendre quelque part. Réponds oui !"}
          </p>
          <p className="font-bold text-ink/45 text-xs leading-relaxed mt-2">
            Ces fenêtres viennent du téléphone, pas du jeu : elles citent l&apos;adresse du site
            entre guillemets. Rien ne quitte l&apos;appareil, et tu pourras tout revoir depuis le
            menu ☰.
          </p>
        </div>

        <Button full size="lg" variant="gold" className="mt-6" onClick={lancerLesDemandes}>
          📱 VÉRIFIER MON TÉLÉPHONE
        </Button>
        <Button
          full
          size="md"
          variant="outline"
          className="mt-3"
          onClick={depart ? onTermine : (onFermer ?? onTermine)}
        >
          {depart ? "Partir sans vérifier" : contexte === "lobby" ? "Plus tard" : "Fermer"}
        </Button>
      </Cadre>
    );
  }

  /* --------------------------------------------------------------- la liste */

  return (
    <Cadre>
      <p className="font-display text-sm text-gold-dark">📱 VÉRIFICATION</p>
      <h1 className="font-display text-2xl leading-tight mt-1">
        {etatGeneral === "encours"
          ? "Vérification en cours…"
          : etatGeneral === "pret"
            ? "Tout est prêt ! 🎉"
            : soucis.length === 1
              ? "Une chose à régler"
              : `${soucis.length} choses à régler`}
      </h1>
      {etatGeneral === "partiel" && (
        <p className="font-bold text-ink/65 text-sm leading-relaxed mt-2">
          Rien ne t&apos;empêche de partir : la chasse reste jouable. Tu perdras seulement
          l&apos;aide correspondante.
        </p>
      )}

      <div className="mt-4 rounded-2xl border-[3px] border-ink bg-white/60 px-3">
        {ORDRE.map((sujet) => {
          const l = lignes[sujet];
          const lib = LIBELLES[sujet];
          const deplie = ouvert === sujet;
          const remede = sujet === "son" && sonJoue && l.etat !== "ok" ? remedeSon(plat) : l.remede;
          return (
            <div key={sujet} className="border-t-2 border-ink/10 py-3 first:border-t-0">
              <button
                type="button"
                onClick={() => remede && setOuvert(deplie ? null : sujet)}
                className="w-full flex items-start gap-3 text-left"
                aria-expanded={remede ? deplie : undefined}
              >
                <span className="text-xl shrink-0 mt-0.5" aria-hidden>
                  {PICTO[sujet]}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block font-display leading-snug">{lib.titre}</span>
                  <span className="block font-bold text-ink/50 text-xs leading-relaxed mt-0.5">
                    {lib.pourquoi}
                  </span>
                </span>
                <Etiquette etat={l.etat} detail={l.detail} precisionM={l.precisionM} />
              </button>

              {/* Le son ne se mesure pas : c'est l'oreille du joueur le capteur. */}
              {sujet === "son" && l.etat !== "ok" && (
                <div className="pl-9 mt-2">
                  <Button size="sm" variant="outline" onClick={ecouter}>
                    {sonJoue ? "▶️ Écouter à nouveau" : "▶️ Écouter"}
                  </Button>
                  {sonJoue && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <Button size="sm" variant="leaf" onClick={() => poser("son", { etat: "ok" })}>
                        ✅ Je l&apos;entends
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setOuvert("son")}>
                        Je n&apos;entends rien
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {remede && (
                <div className="pl-9 mt-2">
                  {!deplie ? (
                    <button
                      type="button"
                      onClick={() => setOuvert(sujet)}
                      className="font-bold text-crimson text-sm text-left underline underline-offset-4"
                    >
                      {remede.constat} Voir comment faire.
                    </button>
                  ) : (
                    <div className="rounded-xl border-2 border-ink/20 bg-parchment/60 p-3">
                      <p className="font-display text-sm leading-snug">{remede.constat}</p>
                      <ol className="mt-2 space-y-1.5">
                        {remede.etapes.map((e, i) => (
                          <li
                            key={i}
                            className="flex gap-2 font-bold text-ink/70 text-sm leading-relaxed"
                          >
                            <span className="font-display text-gold-dark tabular-nums shrink-0">
                              {i + 1}.
                            </span>
                            <span>{e}</span>
                          </li>
                        ))}
                      </ol>
                      {(sujet === "position" || sujet === "boussole" || sujet === "reseau") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2.5"
                          onClick={() => {
                            setOuvert(null);
                            if (sujet === "position") void verifierPosition();
                            else if (sujet === "boussole") void verifierBoussole();
                            else void verifierMuet();
                          }}
                        >
                          🔄 Réessayer
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Le partage de position avec l'organisateur : un choix, posé ici, une
          fois. Il s'affichait jusqu'ici en bandeau PAR-DESSUS l'énigme en
          cours — une question de vie privée par-dessus une épreuve, au moment
          exact où on ne veut pas y penser. */}
      <div className="mt-4 rounded-2xl border-[3px] border-ink bg-white/60 p-4">
        <p className="font-display leading-snug">📍 Partager ta position avec l&apos;organisateur ?</p>
        <p className="font-bold text-ink/55 text-sm leading-relaxed mt-1">
          Il te retrouve sur sa carte en cas de pépin. Les autres équipes ne voient rien, et le
          partage s&apos;arrête à la fin de la partie.
        </p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          <Button
            size="sm"
            variant={partage === "granted" ? "leaf" : "outline"}
            onClick={() => {
              setGeoConsent("granted");
              setPartage("granted");
            }}
          >
            {partage === "granted" ? "✅ Oui, d'accord" : "Oui, d'accord"}
          </Button>
          <Button
            size="sm"
            variant={partage === "denied" ? "leaf" : "outline"}
            onClick={() => {
              setGeoConsent("denied");
              setPartage("denied");
            }}
          >
            {partage === "denied" ? "✅ Non merci" : "Non merci"}
          </Button>
        </div>
      </div>

      {/* Les messages de l'organisateur même écran éteint : facultatif, et
          proposé seulement si le push est configuré sur ce déploiement. */}
      {pushSupported() && (
        <div className="mt-4 rounded-2xl border-[3px] border-ink bg-white/60 p-4">
          <div className="flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="block font-display leading-snug">🔔 Notifications</span>
              <span className="block font-bold text-ink/55 text-sm leading-relaxed">
                Pour recevoir les messages de l&apos;organisateur même écran éteint.
              </span>
            </span>
            <Button
              size="sm"
              variant={push === "on" ? "leaf" : "gold"}
              className="shrink-0"
              disabled={push !== "off"}
              onClick={activerPush}
            >
              {push === "on" ? "✅ OK" : push === "busy" ? "…" : "AUTORISER"}
            </Button>
          </div>
          {pushErreur && <p className="font-bold text-crimson text-xs mt-1">{pushErreur}</p>}
        </div>
      )}

      <Button
        full
        size="lg"
        variant={etatGeneral === "pret" ? "leaf" : "gold"}
        className="mt-6"
        disabled={etatGeneral === "encours" && !depart}
        onClick={onTermine}
      >
        {contexte === "lobby"
          ? "✅ C'EST NOTÉ — RETOUR AU LOBBY"
          : contexte === "menu"
            ? "FERMER"
            : etatGeneral === "pret"
              ? "🚀 C'EST PARTI !"
              : "PARTIR QUAND MÊME"}
      </Button>
    </Cadre>
  );
}

/** Le cadre commun : une seule colonne, sur le parchemin du jeu. */
function Cadre({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh parchment-texture text-ink">
      <div className="max-w-lg mx-auto px-5 pt-safe-page pb-safe-page">{children}</div>
    </main>
  );
}

const ETIQUETTES: Record<Etat, { texte: string; classe: string }> = {
  ok: { texte: "✅ prêt", classe: "text-leaf" },
  degrade: { texte: "⚠️ approximatif", classe: "text-crimson" },
  encours: { texte: "…", classe: "text-ink/40" },
  refus: { texte: "❌ refusé", classe: "text-crimson" },
  absent: { texte: "⚠️ absent", classe: "text-crimson" },
  inconnu: { texte: "❔ à vérifier", classe: "text-ink/50" },
};

function Etiquette({
  etat,
  detail,
  precisionM,
}: {
  etat: Etat;
  detail?: string;
  precisionM?: number;
}) {
  const e = ETIQUETTES[etat];
  const suite = precisionM != null ? `à ${Math.round(precisionM)} m près` : (detail ?? null);
  return (
    <span className={`shrink-0 font-bold text-xs text-right tabular-nums ${e.classe}`}>
      {e.texte}
      {suite && <span className="block text-ink/45">{suite}</span>}
    </span>
  );
}
