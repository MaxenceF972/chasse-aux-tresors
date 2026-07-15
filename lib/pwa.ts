/** Demande au service worker de mettre en cache les médias de l'étape suivante. */
export function precacheUrls(urls: string[]) {
  if (typeof navigator === "undefined" || !urls.length) return;
  const ctrl = navigator.serviceWorker?.controller;
  if (ctrl) {
    ctrl.postMessage({ type: "PRECACHE", urls });
  } else {
    // Pas de SW (dev, premier chargement) → préchargement navigateur simple
    urls.forEach((u) => {
      const img = new Image();
      img.src = u;
    });
  }
}
