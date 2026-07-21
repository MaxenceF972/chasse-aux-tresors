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
