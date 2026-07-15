/* TOYAH GAMES — service worker : cache statique + précache des médias d'énigmes */
const STATIC_CACHE = "toyah-static-v1";
const MEDIA_CACHE = "toyah-media-v1";

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

// Précache des médias de l'étape suivante (message envoyé par l'app)
self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "PRECACHE" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(MEDIA_CACHE).then((cache) =>
        Promise.allSettled(
          data.urls.map(async (url) => {
            const hit = await cache.match(url);
            if (!hit) await cache.add(url);
          })
        )
      )
    );
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const hit = await cache.match(request);
    if (hit) return hit;
    const home = await cache.match("/");
    if (home) return home;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Médias Supabase Storage → cache-first (précachés pour l'étape suivante)
  if (url.pathname.includes("/storage/v1/object/public/")) {
    event.respondWith(cacheFirst(request, MEDIA_CACHE));
    return;
  }

  if (url.origin === location.origin) {
    if (
      url.pathname.startsWith("/_next/static/") ||
      /\.(png|ico|webmanifest|woff2?)$/.test(url.pathname)
    ) {
      event.respondWith(cacheFirst(request, STATIC_CACHE));
      return;
    }
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
    }
  }
});
