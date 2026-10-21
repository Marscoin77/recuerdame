/**
 * RecuérdaME — Cloudflare Worker
 *
 * Sirve la PWA (binding ASSETS, configurado en wrangler.toml) y expone una
 * pequeña API de sincronización en /api/* respaldada por:
 *   - D1  (binding DB)        → metadatos de los recordatorios (JSON)
 *   - KV  (binding AUDIO_KV)  → los archivos de audio grabados
 *
 * Modelo de sincronización (sencillo a propósito):
 *   Un "espacio" se identifica por un CÓDIGO. El móvil sube su estado con
 *   PUT /api/sync/:code y otro dispositivo lo descarga con GET /api/sync/:code.
 *   Los audios se suben/descargan por separado para no inflar el JSON.
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") return new Response(null, { headers: cors() });

    // Las rutas que no son /api las sirve el binding de assets automáticamente,
    // pero por robustez delegamos explícitamente si llegara aquí.
    if (!pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    try {
      // Salud del servicio
      if (pathname === "/api/health") return json({ ok: true, ts: Date.now() });

      // Crear un espacio nuevo → devuelve un código libre
      if (pathname === "/api/pair" && request.method === "POST") {
        let code;
        for (let i = 0; i < 5; i++) {
          code = newCode();
          const exists = await env.DB.prepare("SELECT code FROM spaces WHERE code = ?").bind(code).first();
          if (!exists) break;
        }
        const now = Date.now();
        await env.DB.prepare("INSERT INTO spaces (code, data, created, updated) VALUES (?, ?, ?, ?)")
          .bind(code, "[]", now, now).run();
        return json({ code });
      }

      // Sincronización del JSON de recordatorios
      const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9-]+)$/);
      if (syncMatch) {
        const code = cleanCode(syncMatch[1]);
        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT data, updated FROM spaces WHERE code = ?").bind(code).first();
          if (!row) return json({ error: "no_existe" }, 404);
          return json({ code, updated: row.updated, notes: JSON.parse(row.data || "[]") });
        }
        if (request.method === "PUT") {
          const body = await request.json().catch(() => null);
          if (!body || !Array.isArray(body.notes)) return json({ error: "formato" }, 400);
          const now = Date.now();
          const data = JSON.stringify(body.notes);
          const res = await env.DB.prepare("UPDATE spaces SET data = ?, updated = ? WHERE code = ?")
            .bind(data, now, code).run();
          if (!res.meta.changes) {
            // crear si no existía (el usuario escribió un código a mano)
            await env.DB.prepare("INSERT INTO spaces (code, data, created, updated) VALUES (?, ?, ?, ?)")
              .bind(code, data, now, now).run();
          }
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
