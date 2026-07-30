const CACHE = "note-v2.1";
const ASSETS = [
  "index.html",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;

  if (request.mode === "navigate") {
    e.respondWith(
      caches.match("index.html").then((cached) => {
        const refresh = fetch("index.html")
          .then((response) => {
            caches
              .open(CACHE)
              .then((c) => c.put("index.html", response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || refresh;
      }),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fresh;
    }),
  );
});
