/* RecuérdaME — Service Worker
   Cachea la app para que funcione sin conexión y abre la nota
   correcta cuando se toca una notificación de recordatorio. */

const CACHE = "recuerdame-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/audio.js",
  "./js/speech.js",
  "./js/reminders.js",
  "./js/sync.js",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // La API siempre a la red (no cachear sincronización ni audios en la nube).
  if (url.pathname.startsWith("/api/")) return;

  // App shell: primero caché, luego red (y se guarda copia).
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// Al tocar una notificación → abrir la app y mostrar la nota.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const noteId = e.notification.data && e.notification.data.noteId;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.focus();
          if (noteId) client.postMessage({ type: "open-note", noteId });
          return;
        }
      }
      return self.clients.openWindow("./" + (noteId ? "?note=" + noteId : ""));
    })
  );
});
