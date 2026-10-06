import type { Metadata, Viewport } from "next";
import { Lilita_One, Nunito } from "next/font/google";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";
import Toaster from "@/components/ui/Toaster";
import Motion from "@/components/ui/Motion";

const lilita = Lilita_One({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-lilita",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://toyah-games.app"),
  title: "TOYAH GAMES — Chasse au trésor",
  description:
    "Chasse au trésor en temps réel : crée ton parcours, cache tes balises, et que la meilleure équipe gagne !",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "TOYAH GAMES",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/icon-192.png?v=2",
    // Signet iPhone : logo TOYAH TREASURE sur parchemin (généré par scripts/make-icons.mjs)
    apple: "/icons/apple-icon-180.png",
  },
  // Aperçu des liens partagés (WhatsApp, iMessage, réseaux) : logo sur parchemin
  openGraph: {
    type: "website",
    siteName: "TOYAH GAMES",
    title: "TOYAH GAMES — Chasse au trésor",
    description:
      "Chasse au trésor en temps réel : crée ton parcours, cache tes balises, et que la meilleure équipe gagne !",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "TOYAH TREASURE" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TOYAH GAMES — Chasse au trésor",
    description:
      "Chasse au trésor en temps réel : crée ton parcours, cache tes balises, et que la meilleure équipe gagne !",
    images: ["/og-v2.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  // LE ZOOM RESTE PERMIS. Il était coupé (`maximumScale: 1`,
  // `userScalable: false`) pour empêcher iOS de zoomer tout seul quand on
  // touche un champ — ce qu'il ne fait qu'en dessous de 16 px, et les champs
  // du jeu sont à 16 px ou plus. Le prix, lui, était réel : un joueur presbyte
  // ne pouvait plus agrandir un code de balise ou un énoncé, en plein soleil.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${lilita.variable} ${nunito.variable}`}>
      <body className="min-h-dvh antialiased">
        <Motion>
          <PwaSetup />
          <Toaster />
          {children}
        </Motion>
        {/* PWA iPhone (barre d'état translucide) : fond opaque derrière l'heure
            et la batterie — sinon texte blanc illisible sur les pages claires.
            Hauteur nulle hors mode signet : invisible partout ailleurs. */}
        <div
          aria-hidden
          className="fixed inset-x-0 top-0 h-[env(safe-area-inset-top)] bg-ink z-[90] pointer-events-none print:hidden"
        />
      </body>
    </html>
  );
}
