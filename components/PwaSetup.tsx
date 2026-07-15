"use client";

import { useEffect } from "react";

export default function PwaSetup() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* PWA optionnelle — l'app fonctionne sans */
      });
    }
  }, []);
  return null;
}
