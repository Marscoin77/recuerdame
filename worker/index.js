/**
 * RecuérdaME — Cloudflare Worker
 *
 * Sirve la PWA (binding ASSETS, configurado en wrangler.toml) y expone una
 * pequeña API de sincronización en /api/* respaldada por Workers KV
 * (binding AUDIO_KV). Usamos KV tanto para los metadatos como para los
 * audios; con prefijos de clave distintos:
 *   - "space:<CODE>"        → JSON con los recordatorios (sin audio)
 *   - "<CODE>/<audioId>"    → archivo de audio grabado
 *
 * Modelo de sincronización (sencillo a propósito):
 *   Un "espacio" se identifica por un CÓDIGO. El móvil sube su estado con
 *   PUT /api/sync/:code y otro dispositivo lo descarga con GET /api/sync/:code.
 *
 * Nota: se eligió KV en vez de D1 porque el límite diario de escrituras de
 * D1 es de toda la cuenta y puede agotarse por otros proyectos.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors() },
  });

const cors = () => ({
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,PUT,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type",
});

// Código legible, evita caracteres ambiguos (0/O, 1/I).
function newCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s.slice(0, 4) + "-" + s.slice(4);
}
const cleanCode = (c) => (c || "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9);
const spaceKey = (code) => "space:" + cleanCode(code);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    if (!pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    try {
      if (pathname === "/api/health") return json({ ok: true, ts: Date.now() });

      // Crear un espacio nuevo → devuelve un código libre
      if (pathname === "/api/pair" && request.method === "POST") {
        let code;
        for (let i = 0; i < 5; i++) {
          code = newCode();
          const exists = await env.AUDIO_KV.get(spaceKey(code));
          if (!exists) break;
        }
        const now = Date.now();
        await env.AUDIO_KV.put(spaceKey(code), JSON.stringify({ notes: [], created: now, updated: now }));
        return json({ code });
      }

      // Sincronización del JSON de recordatorios
      const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9-]+)$/);
      if (syncMatch) {
        const code = cleanCode(syncMatch[1]);
        if (request.method === "GET") {
          const raw = await env.AUDIO_KV.get(spaceKey(code), { type: "json" });
          if (!raw) return json({ error: "no_existe" }, 404);
          return json({ code, updated: raw.updated || 0, notes: raw.notes || [] });
        }
        if (request.method === "PUT") {
          const body = await request.json().catch(() => null);
          if (!body || !Array.isArray(body.notes)) return json({ error: "formato" }, 400);
          const now = Date.now();
          await env.AUDIO_KV.put(spaceKey(code), JSON.stringify({ notes: body.notes, updated: now }));
          return json({ ok: true, updated: now });
        }
      }

      // Audios en KV:  /api/audio/:code/:id
      const audioMatch = pathname.match(/^\/api\/audio\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/);
      if (audioMatch) {
        const key = cleanCode(audioMatch[1]) + "/" + audioMatch[2];
        if (request.method === "PUT") {
          const buf = await request.arrayBuffer();
          const ct = request.headers.get("content-type") || "audio/webm";
          await env.AUDIO_KV.put(key, buf, { metadata: { ct } });
          return json({ ok: true });
        }
        if (request.method === "GET") {
          const { value, metadata } = await env.AUDIO_KV.getWithMetadata(key, { type: "arrayBuffer" });
          if (!value) return new Response("no audio", { status: 404, headers: cors() });
          const headers = new Headers(cors());
          headers.set("content-type", (metadata && metadata.ct) || "audio/webm");
          headers.set("cache-control", "public, max-age=31536000");
          return new Response(value, { headers });
        }
        if (request.method === "DELETE") {
          await env.AUDIO_KV.delete(key);
          return json({ ok: true });
        }
      }

      return json({ error: "ruta_desconocida" }, 404);
    } catch (err) {
      return json({ error: "servidor", detail: String(err) }, 500);
    }
  },
};
