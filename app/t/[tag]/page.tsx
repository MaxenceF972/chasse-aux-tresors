"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { ensureAnonSession, frError, isNetworkError, rpc } from "@/lib/supabase/client";
import { enqueueValidation } from "@/lib/game/offline-queue";
import { getPlayerSession } from "@/lib/game/session";
import { sfx } from "@/lib/game/sounds";
import { haptics } from "@/lib/game/haptics";
import SuccessOverlay from "@/components/play/SuccessOverlay";
import Button from "@/components/ui/Button";
import Spinner from "@/components/ui/Spinner";

type ScanState =
  | "loading"
  | "success"
  | "wrong"
  | "already"
  | "notjoined"
  | "notnfc"
  | "offline"
  | "test"
  | "error";

interface TagResult {
  ok: boolean;
  correct?: boolean;
  already?: boolean;
  finished?: boolean;
  error?: string;
  game_code?: string;
  test_mode?: boolean;
  step_title?: string;
}

/**
 * Page ouverte quand on pose le téléphone sur une puce NFC ou qu'on scanne le
 * QR d'une balise avec l'appareil photo : l'URL contient l'identifiant, le
 * serveur vérifie qu'il correspond bien à l'étape en cours de l'équipe.
 */
export default function TagScanPage() {
  const params = useParams<{ tag: string }>();
  const router = useRouter();
  const [state, setState] = useState<ScanState>("loading");
  const [finished, setFinished] = useState(false);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [testTitle, setTestTitle] = useState("");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current || !params.tag) return;
    ranRef.current = true;

    (async () => {
      try {
        await ensureAnonSession();
        const res = await rpc<TagResult>("validate_tag", {
          p_idem_key: crypto.randomUUID(),
          p_tag: decodeURIComponent(params.tag),
        });
        setGameCode(res.game_code ?? getPlayerSession()?.code ?? null);

        if (res.test_mode) {
          setTestTitle(res.step_title ?? "");
          setState("test");
          sfx.success();
          haptics.success();
        } else if (res.correct && !res.already) {
          setFinished(!!res.finished);
          setState("success");
          sfx.success();
          haptics.success();
          if (res.finished) sfx.fanfare();
        } else if (res.already) {
          setState("already");
        } else if (res.error === "NON_INSCRIT") {
          setState("notjoined");
        } else if (res.error === "ETAPE_PAS_BALISE") {
          setState("notnfc");
        } else if (res.error === "PARCOURS_TERMINE") {
          setFinished(true);
          setState("already");
        } else if (res.error) {
          setMessage(
            res.error === "PARTIE_EN_PAUSE"
              ? "La partie est en pause — patiente un instant !"
              : res.error === "PARTIE_NON_ACTIVE"
                ? "La partie n'est pas (ou plus) en cours."
                : res.error
          );
          setState("error");
        } else {
          setState("wrong");
          sfx.fail();
          haptics.fail();
        }
      } catch (err) {
        if (isNetworkError(err)) {
          await enqueueValidation({
            idem_key: crypto.randomUUID(),
            step_id: "",
            kind: "nfc",
            payload: { tag: decodeURIComponent(params.tag) },
            queued_at: Date.now(),
            fn: "validate_tag",
          }).catch(() => {});
          setGameCode(getPlayerSession()?.code ?? null);
          setState("offline");
        } else {
          setMessage(frError(err, "Erreur inconnue — réessaie"));
          setState("error");
        }
      }
    })();
  }, [params.tag]);

  const gameHref = gameCode ? `/play/${gameCode}/game` : "/";

  if (state === "loading") {
    return (
      <main className="min-h-dvh parchment-texture text-ink flex items-center justify-center">
        <Spinner label="Balise détectée… vérification !" />
      </main>
    );
  }

  if (state === "success") {
    return (
      <main className="min-h-dvh parchment-texture">
        <SuccessOverlay
          show
          finished={finished}
          onDone={() =>
            router.replace(finished && gameCode ? `/play/${gameCode}/final` : gameHref)
          }
        />
      </main>
    );
  }

  // Mode test organisateur : la balise fonctionne, rien n'est validé
  if (state === "test") {
    return (
      <main className="min-h-dvh bg-leaf text-parchment flex flex-col items-center justify-center gap-5 px-8 text-center">
        <motion.div
          initial={{ scale: 0, rotate: -15 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 14 }}
          className="text-7xl select-none"
        >
          🧪
        </motion.div>
        <h1 className="font-display text-3xl leading-tight">BALISE OK !</h1>
        <p className="font-bold max-w-sm text-parchment/90">
          Mode test : cette balise est bien reconnue et pointe vers l&apos;étape{" "}
          <span className="text-gold">« {testTitle} »</span>. Aucune validation enregistrée.
        </p>
        <Link href={gameCode ? `/org/games` : "/org/dashboard"} className="contents">
          <Button size="xl" variant="gold">✅ CONTINUER LES TESTS</Button>
        </Link>
      </main>
    );
  }

  const screens: Record<Exclude<ScanState, "loading" | "success" | "test">, {
    icon: string;
    title: string;
    text: string;
    danger?: boolean;
  }> = {
    wrong: {
      icon: "🙅",
      title: "MAUVAISE BALISE !",
      text: "Cette balise ne correspond pas à l'étape en cours de ton équipe. Chaque équipe suit sa propre route… continue la tienne !",
      danger: true,
    },
    already: {
      icon: "✅",
      title: finished ? "PARCOURS DÉJÀ TERMINÉ" : "DÉJÀ VALIDÉE",
      text: finished
        ? "Ton équipe a déjà trouvé le trésor — direction le classement !"
        : "Ton équipe a déjà validé cette étape. En route vers la suivante !",
    },
    notjoined: {
      icon: "🧭",
      title: "PAS ENCORE EMBARQUÉ ?",
      text: "Tu as trouvé une balise TOYAH GAMES ! Rejoins d'abord la partie avec le code fourni par l'organisateur, puis reviens scanner.",
    },
    notnfc: {
      icon: "🧩",
      title: "PAS SI VITE !",
      text: "Ton étape en cours n'est pas une balise à scanner — résous d'abord ton énigme actuelle !",
    },
    offline: {
      icon: "📶",
      title: "SCAN ENREGISTRÉ",
      text: "Pas de réseau ici… Ton scan est mémorisé et sera validé automatiquement dès que la connexion revient.",
    },
    error: {
      icon: "⚠️",
      title: "OUPS",
      text: message,
      danger: true,
    },
  };

  const screen = screens[state as Exclude<ScanState, "loading" | "success" | "test">];

  return (
    <main
      className={`min-h-dvh flex flex-col items-center justify-center gap-5 px-8 text-center ${
        screen.danger ? "bg-crimson text-parchment" : "parchment-texture text-ink"
      }`}
    >
      <motion.div
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 14 }}
        className="text-7xl select-none"
      >
        {screen.icon}
      </motion.div>
      <h1 className="font-display text-3xl leading-tight">{screen.title}</h1>
      <p className={`font-bold max-w-sm ${screen.danger ? "text-parchment/85" : "text-ink/70"}`}>
        {screen.text}
      </p>
      {state === "notjoined" ? (
        <Link href="/play" className="contents">
          <Button size="xl">🗺️ REJOINDRE LA PARTIE</Button>
        </Link>
      ) : (
        <Link href={finished && gameCode ? `/play/${gameCode}/final` : gameHref} className="contents">
          <Button size="xl" variant={screen.danger ? "gold" : "gold"}>
            {finished ? "🏅 VOIR LE CLASSEMENT" : "🗺️ RETOUR À MON ÉNIGME"}
          </Button>
        </Link>
      )}
    </main>
  );
}
