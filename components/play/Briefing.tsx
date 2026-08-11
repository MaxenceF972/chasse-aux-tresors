"use client";

import { useEffect, useState } from "react";
import { charterRules } from "@/lib/game/charter";
import { getGeoConsent, isMuted, setGeoConsent, setMuted, type GeoConsent } from "@/lib/game/prefs";
import { enablePush, isPushEnabled, pushSupported } from "@/lib/push";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";

interface BriefingProps {
  /** Charte personnalisée (settings.charter), sinon la charte par défaut */
  charter?: string[];
}

const RULES = [
  {
    icon: "🗺️",
    title: "Chaque équipe a SA route",
    text: "Vous ne ferez pas les épreuves dans le même ordre que les autres : inutile de suivre une équipe, elle ne va pas au même endroit que vous.",
  },
  {
    icon: "🏷️",
    title: "Scanner les balises",
    text: "Sur place, posez le haut du téléphone sur la puce NFC, écran allumé : la validation s'ouvre toute seule. Balise abîmée ou introuvable ? Saisissez le code imprimé à côté.",
  },
  {
    icon: "🧩",
    title: "Énigmes et mini-jeux",
    text: "Les réponses se tapent dans l'app. Ni les majuscules ni les accents ne comptent. Réfléchissez à plusieurs, c'est tout l'intérêt !",
  },
  {
    icon: "💡",
    title: "Coincés ? Les indices",
    text: "Chaque étape peut proposer des indices : certains deviennent gratuits après un délai, d'autres coûtent des minutes de pénalité. À utiliser en équipe, pas en panique.",
  },
  {
    icon: "🚪",
    title: "Vraiment bloqués ? Passez",
    text: "Le bouton « Passer l'étape » vous fait avancer contre une pénalité. Certaines épreuves sont rattrapables plus tard : les réussir annule la pénalité.",
  },
  {
    icon: "📶",
    title: "Pas de réseau ? Pas de panique",
    text: "Vos validations sont mémorisées sur le téléphone et repartent toutes seules dès que ça capte à nouveau. Continuez à jouer.",
  },
  {
    icon: "🆘",
    title: "Un souci sur le terrain",
    text: "Le menu ☰ permet d'écrire au maître du jeu à tout moment : balise introuvable, doute, pépin. Il reçoit le message immédiatement.",
  },
  {
    icon: "🏁",
    title: "Le sprint final",
    text: "La dernière étape est la même pour tout le monde et se débloque quand tout le reste est validé. Le classement se joue au chrono (ou aux points) — pénalités comprises.",
  },
];

/**
 * Le document d'accueil du lobby : le concept de la chasse, les règles, la
 * charte, et surtout un vrai réglage du téléphone — les permissions se
 * demandent ICI, au calme, plutôt qu'en pleine course sur le terrain.
 */
export default function Briefing({ charter }: BriefingProps) {
  const [open, setOpen] = useState(false);
  const [muted, setMutedState] = useState(false);
  const [geo, setGeo] = useState<GeoConsent>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [pushState, setPushState] = useState<"off" | "on" | "busy">("off");
  const [pushError, setPushError] = useState<string | null>(null);

  // Relit les réglages à chaque ouverture : ils peuvent changer ailleurs
  useEffect(() => {
    if (!open) return;
    setMutedState(isMuted());
    setGeo(getGeoConsent());
    void isPushEnabled().then((on) => setPushState(on ? "on" : "off"));
  }, [open]);

  /** Déclenche la vraie demande d'autorisation du navigateur, ici et maintenant. */
  function askGeo() {
    setGeoError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoError("Ce téléphone ne propose pas la localisation.");
      return;
    }
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => {
        setGeoConsent("granted");
        setGeo("granted");
        setGeoBusy(false);
        haptics.success();
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Refusé. Autorise la localisation pour ce site dans les réglages du téléphone, puis réessaie."
            : "Position introuvable pour l'instant — réessaie dehors, ça marchera sur le terrain."
        );
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  const rules = charterRules(charter);

  return (
    <>
      <Button full size="lg" variant="gold" onClick={() => setOpen(true)}>
        📋 BRIEFING — À LIRE AVANT DE PARTIR
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="📋 Briefing">
        <div className="space-y-5">
          {/* 1. Le principe (la présentation de l'organisateur est déjà
              affichée en clair sur le lobby : inutile de la répéter ici) */}
          <section>
            <h3 className="font-display text-lg mb-2">🧭 Le principe</h3>
            <p className="font-bold text-ink/75 text-sm leading-relaxed">
              Vous formez une équipe et partez sur le terrain, téléphone en main. L&apos;app vous
              donne <strong>une étape à la fois</strong> : une énigme à résoudre, un mini-jeu à
              réussir, une balise à retrouver et à scanner, un lieu où se rendre, ou une photo à
              réaliser. Chaque réussite débloque la suivante, jusqu&apos;au trésor.
            </p>
            <p className="font-bold text-ink/75 text-sm leading-relaxed mt-2">
              Toutes les équipes font les mêmes épreuves, mais{" "}
              <strong>dans un ordre différent</strong> — impossible de se suivre, et le classement
              se joue vraiment sur ce que vous faites.
            </p>
          </section>

          {/* 2. Le téléphone — les réglages se font ICI */}
          <section className="rounded-xl border-[3px] border-ink bg-white/60 p-3">
            <h3 className="font-display text-lg mb-1">📱 Prépare ton téléphone</h3>
            <p className="font-bold text-ink/55 text-xs mb-3">
              Fais-le maintenant, pendant que tu es au calme et connecté.
            </p>

            <div className="space-y-2.5">
              {/* Son */}
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 font-bold text-sm">
                    🔊 Sons &amp; vibrations
                    <span className="block text-ink/50 text-xs">
                      Ils confirment chaque validation et chaque récompense.
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={muted ? "outline" : "leaf"}
                    className="shrink-0"
                    onClick={() => {
                      const next = !muted;
                      setMuted(next);
                      setMutedState(next);
                      if (!next) {
                        sfx.pop();
                        haptics.scan();
                      }
                    }}
                  >
                    {muted ? "ACTIVER" : "✅ ACTIVÉS"}
                  </Button>
                </div>
                {!muted && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1.5"
                      onClick={() => {
                        sfx.success();
                        haptics.success();
                      }}
                    >
                      ▶️ TESTER LE SON
                    </Button>
                    <p className="font-bold text-crimson text-xs mt-1.5 leading-snug">
                      ⚠️ Tu n&apos;entends rien ? Ton téléphone est en <strong>mode silencieux</strong> :
                      sur iPhone, bascule le petit bouton sur la tranche gauche ; sur Android,
                      monte le volume « multimédia ». Sans ça, tu rateras les sons de toute la
                      partie.
                    </p>
                  </>
                )}
              </div>

              {/* Position */}
              <div className="border-t-2 border-ink/10 pt-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 font-bold text-sm">
                    📍 Localisation
                    <span className="block text-ink/50 text-xs">
                      Indispensable pour les étapes « rendez-vous à un lieu », et le maître du jeu
                      vous retrouve en cas de pépin. Invisible pour les autres équipes.
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={geo === "granted" ? "leaf" : "gold"}
                    className="shrink-0"
                    disabled={geoBusy}
                    onClick={askGeo}
                  >
                    {geoBusy ? "…" : geo === "granted" ? "✅ OK" : "AUTORISER"}
                  </Button>
                </div>
                {geoError && (
                  <p className="font-bold text-crimson text-xs mt-1">{geoError}</p>
                )}
              </div>

              {/* Notifications */}
              {pushSupported() && (
                <div className="border-t-2 border-ink/10 pt-2.5">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 font-bold text-sm">
                      🔔 Notifications
                      <span className="block text-ink/50 text-xs">
                        Pour recevoir les messages du maître du jeu même écran éteint.
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant={pushState === "on" ? "leaf" : "gold"}
                      className="shrink-0"
                      disabled={pushState !== "off"}
                      onClick={async () => {
                        setPushState("busy");
                        setPushError(null);
                        const res = await enablePush();
                        if (res.ok) {
                          setPushState("on");
                          haptics.success();
                        } else {
                          setPushState("off");
                          setPushError(res.error ?? null);
                        }
                      }}
                    >
                      {pushState === "on" ? "✅ OK" : pushState === "busy" ? "…" : "AUTORISER"}
                    </Button>
                  </div>
                  {pushError && <p className="font-bold text-crimson text-xs mt-1">{pushError}</p>}
                </div>
              )}

              {/* Conseils non réglables */}
              <div className="border-t-2 border-ink/10 pt-2.5">
                <p className="font-bold text-sm mb-1">🔋 Et aussi, avant de partir :</p>
                <ul className="space-y-1 font-bold text-ink/70 text-sm">
                  <li>• Batterie chargée — une chasse dure souvent 1 à 2 h avec l&apos;écran allumé.</li>
                  <li>• NFC activé (Android : Réglages → Connexions). Sur iPhone, rien à faire.</li>
                  <li>• Garde cette page ouverte : l&apos;app empêche l&apos;écran de s&apos;éteindre pendant la partie.</li>
                  <li>• Mets la luminosité au maximum : dehors, en plein soleil, ça change tout.</li>
                </ul>
              </div>
            </div>
          </section>

          {/* 3. Les règles */}
          <section>
            <h3 className="font-display text-lg mb-2">📖 Comment on joue</h3>
            <div className="space-y-3">
              {RULES.map((rule) => (
                <div key={rule.title} className="flex gap-3">
                  <span className="text-2xl shrink-0" aria-hidden>
                    {rule.icon}
                  </span>
                  <div className="min-w-0">
                    <p className="font-display leading-tight">{rule.title}</p>
                    <p className="font-bold text-sm text-ink/70">{rule.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. La charte */}
          <section>
            <h3 className="font-display text-lg mb-2">🤝 La charte de l&apos;aventurier</h3>
            <ul className="space-y-2">
              {rules.map((rule, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-xl shrink-0" aria-hidden>
                    {rule.icon}
                  </span>
                  <div className="min-w-0">
                    {rule.title && (
                      <p className="font-display text-sm leading-tight">{rule.title}</p>
                    )}
                    <p className="font-bold text-ink/65 text-sm">{rule.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="font-display text-center text-leaf">Bonne chasse, moussaillons ! 🏴‍☠️</p>
          <Button full size="lg" variant="leaf" onClick={() => setOpen(false)}>
            ✅ J&apos;AI TOUT LU, JE SUIS PRÊT !
          </Button>
        </div>
      </Dialog>
    </>
  );
}
