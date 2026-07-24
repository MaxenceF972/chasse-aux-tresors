/* TOYAH GAMES — service worker : cache statique + précache des médias d'énigmes.
   Incrémente la VERSION à chaque changement de stratégie : l'activation purge
   les anciens caches (sinon assets non hashés périmés servis indéfiniment). */
const VERSION = "v2";
const STATIC_CACHE = `toyah-static-${VERSION}`;
const MEDIA_CACHE = `toyah-media-${VERSION}`;
const STATIC_MAX_ENTRIES = 150;
const MEDIA_MAX_ENTRIES = 80;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => ![STATIC_CACHE, MEDIA_CACHE].includes(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Notifications push (messages de l'organisateur)
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* payload non-JSON */
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "TOYAH GAMES", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      vibrate: [80, 40, 80],
      data: { url: data.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Précache des médias de l'étape suivante (message envoyé par l'app)
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "PRECACHE" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then(async (cache) => {
        await Promise.allSettled(
          data.urls.map(async (url) => {
            const hit = await cache.match(url);
            if (!hit) await cache.add(url);
          })
        );
        await trimCache(MEDIA_CACHE, MEDIA_MAX_ENTRIES);
      })
    );
  }
});

/** Borne un cache aux N entrées les plus récentes (keys() = ordre d'insertion). */
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)));
}

/**
 * Sert une requête Range depuis une réponse complète en cache (206 Partial).
 * Sans ça, Safari/iOS reçoit un 200 complet pour un Range → lecture vidéo/audio
 * cassée dès que le média vient du cache.
 */
async function rangeResponse(request, fullResponse) {
  if (fullResponse.status === 0) return fullResponse; // opaque : impossible à découper
  const rangeHeader = request.headers.get("range") || "";
  const m = /bytes=(\d+)-(\d+)?/.exec(rangeHeader);
  if (!m) return fullResponse;
  const buf = await fullResponse.arrayBuffer();
  const total = buf.byteLength;
  const start = Number(m[1]);
  const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${total}` },
    });
  }
  const sliced = buf.slice(start, end + 1);
  return new Response(sliced, {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": fullResponse.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Length": String(sliced.byteLength),
      "Accept-Ranges": "bytes",
    },
  });
}

/** Médias Supabase : cache d'abord, Range servi en 206 depuis le cache. */
async function mediaResponse(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(request.url);
  const isRange = request.headers.has("range");
  if (hit) return isRange ? rangeResponse(request, hit.clone()) : hit;
  if (isRange) return fetch(request); // partiel : passe-plat, on ne cache pas un morceau
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    await cache.put(request, response.clone());
    void trimCache(MEDIA_CACHE, MEDIA_MAX_ENTRIES);
  }
  return response;
}

/** Assets hashés Next (immuables) : cache-first pur. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    void trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
  }
  return response;
}

/** Assets NON hashés (logo, icônes, manifest, polices) : servis du cache mais
    rafraîchis en arrière-plan — un déploiement finit toujours par être visible. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (hit) return hit;
  const fresh = await refresh;
  return fresh || Response.error();
}

/** Page hors-ligne honnête : ne surtout PAS servir la home pour une autre URL
    (un scan de balise hors réseau afficherait l'accueil et semblerait perdu). */
function offlinePage() {
  return new Response(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hors-ligne — TOYAH GAMES</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#111111;color:#EDE0C4;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
main{max-width:420px}h1{color:#F5A623;font-size:2rem;margin-bottom:8px}p{font-weight:600;line-height:1.5}
button{margin-top:20px;padding:14px 24px;border-radius:14px;border:3px solid #111;background:#F5A623;color:#111;font-weight:800;font-size:16px;box-shadow:3px 3px 0 0 #000}</style></head>
<body><main><h1>📡 Hors-ligne</h1>
<p>Pas de réseau pour l'instant.<br/>Si tu viens de poser le téléphone sur une balise, pas de panique : reconnecte-toi puis réessaie — les validations déjà faites partiront toutes seules au retour du réseau.</p>
<button onclick="location.reload()">🔄 Réessayer</button></main></body></html>`,
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

/** Navigations : réseau d'abord, cache exact ensuite, page hors-ligne sinon. */
async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      void trimCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
    }
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    return offlinePage();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Médias Supabase Storage → cache-first + Range 206 (précachés pour l'étape suivante)
  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(mediaResponse(request));
    return;
  }

  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/_next/static/")) {
      event.respondWith(cacheFirst(request)); // fichiers hashés : immuables
      return;
    }
    if (/\.(png|ico|webmanifest|woff2?)$/.test(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request)); // non hashés : rafraîchis
      return;
    }
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
    }
  }
});
