import type { Metadata, Viewport } from "next";
import { Lilita_One, Nunito } from "next/font/google";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";
import Toaster from "@/components/ui/Toaster";

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
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${lilita.variable} ${nunito.variable}`}>
      <body className="min-h-dvh antialiased">
        <PwaSetup />
        <Toaster />
        {children}
      </body>
    </html>
  );
}
