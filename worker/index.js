/**
 * RecuérdaME — Cloudflare Worker
 *
 * Sirve la PWA (binding ASSETS) y expone la API en /api/* respaldada por
 * Workers KV (binding AUDIO_KV). Además, con un Cron Trigger (cada minuto)
 * envía avisos push aunque la app esté cerrada.
 *
 * Claves en KV:
 *   "space:<CODE>"      → JSON { notes, updated }  (recordatorios, sin audio)
 *   "<CODE>/<audioId>"  → archivo de audio grabado
 *   "subs:<CODE>"       → JSON [ { endpoint, keys, role, added } ]  (push)
 *   "fired:<CODE>"      → JSON { "<clave>": ts }  (evita avisos duplicados)
 *   "pushidx"           → JSON [ "<CODE>", ... ]  (espacios con push activo)
 *
 * Se usa KV (no D1) porque el límite diario de escrituras de D1 es de toda
 * la cuenta y puede agotarse por otros proyectos.
 */

import { sendPush } from "./push.js";

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
const subsKey = (code) => "subs:" + cleanCode(code);
const firedKey = (code) => "fired:" + cleanCode(code);

const MIN = 60 * 1000;

/* Fusiona dos listas de notas por id, gana la de updatedAt más reciente. */
function mergeNotes(a, b) {
  const map = new Map();
  for (const n of a || []) if (n && n.id) map.set(n.id, n);
  for (const n of b || []) {
    if (!n || !n.id) continue;
    const ex = map.get(n.id);
    if (!ex || (n.updatedAt || 0) >= (ex.updatedAt || 0)) map.set(n.id, n);
  }
  return [...map.values()];
}

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

      // Clave pública VAPID para que el cliente se suscriba a push.
      if (pathname === "/api/push/key") return json({ key: env.VAPID_PUBLIC || null });

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

      // Alta de suscripción push:  { code, subscription, role }
      if (pathname === "/api/push/subscribe" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.code || !body.subscription || !body.subscription.endpoint)
          return json({ error: "formato" }, 400);
        const code = cleanCode(body.code);
        const role = body.role === "caregiver" ? "caregiver" : "owner";
        const list = (await env.AUDIO_KV.get(subsKey(code), { type: "json" })) || [];
        const filtered = list.filter((s) => s.endpoint !== body.subscription.endpoint);
        filtered.push({ endpoint: body.subscription.endpoint, keys: body.subscription.keys, role, added: Date.now() });
        await env.AUDIO_KV.put(subsKey(code), JSON.stringify(filtered));
        // Índice de espacios con push
        const idx = (await env.AUDIO_KV.get("pushidx", { type: "json" })) || [];
        if (!idx.includes(code)) { idx.push(code); await env.AUDIO_KV.put("pushidx", JSON.stringify(idx)); }
        return json({ ok: true, subs: filtered.length });
      }

      // Baja de suscripción push:  { code, endpoint }
      if (pathname === "/api/push/unsubscribe" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        if (!body || !body.code || !body.endpoint) return json({ error: "formato" }, 400);
        const code = cleanCode(body.code);
        const list = (await env.AUDIO_KV.get(subsKey(code), { type: "json" })) || [];
        await env.AUDIO_KV.put(subsKey(code), JSON.stringify(list.filter((s) => s.endpoint !== body.endpoint)));
        return json({ ok: true });
      }

      // Sincronización del JSON de recordatorios (merge sin pérdida de datos)
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
          const prev = (await env.AUDIO_KV.get(spaceKey(code), { type: "json" })) || { notes: [] };
          // Merge por id (gana el más reciente): evita que un dispositivo que
          // aún no se ha sincronizado borre notas de otro al subir su lista.
          const merged = mergeNotes(prev.notes, body.notes);
          const now = Date.now();
          await env.AUDIO_KV.put(spaceKey(code), JSON.stringify({ notes: merged, updated: now }));
          return json({ ok: true, updated: now, notes: merged });
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

  /* ============================================================
     CRON — cada minuto: enviar avisos push de recordatorios vencidos
     ============================================================ */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
};

export async function runReminders(env) {
  if (!env.VAPID_PRIVATE_JWK) return; // push no configurado todavía
  const idx = (await env.AUDIO_KV.get("pushidx", { type: "json" })) || [];
  const now = Date.now();
  const GRACE = 20 * MIN;       // margen para "no confirmado" (familia)
  const STALE = 60 * MIN;       // no disparar avisos principales más viejos que esto

  for (const code of idx) {
    try {
      const subs = (await env.AUDIO_KV.get(subsKey(code), { type: "json" })) || [];
      if (!subs.length) continue;
      const space = await env.AUDIO_KV.get(spaceKey(code), { type: "json" });
      if (!space || !Array.isArray(space.notes)) continue;

      const fired = (await env.AUDIO_KV.get(firedKey(code), { type: "json" })) || {};
      const owners = subs.filter((s) => s.role !== "caregiver");
      const carers = subs.filter((s) => s.role === "caregiver");
      const dead = new Set();   // endpoints caducados a limpiar
      let changed = false;

      const fire = async (targets, key, payload) => {
        if (!targets.length || fired[key]) return;
        for (const s of targets) {
          const r = await sendPush(s, payload, env).catch(() => ({ ok: false, status: 0 }));
          if (r.status === 404 || r.status === 410) dead.add(s.endpoint);
        }
        fired[key] = now; changed = true;
      };

      for (const n of space.notes) {
        const r = n.reminder;
        if (!r || r.done || n.done || n.deleted) continue;
        const at = r.at || 0;

        // Aviso previo (30 min antes)
        if (r.preAlert && at - 30 * MIN <= now && now < at) {
          await fire(owners, `${n.id}:${at}:pre`, {
            kind: "pre", noteId: n.id,
            title: "⏰ Pronto: " + (n.title || "Recordatorio"),
            body: "Dentro de 30 minutos", urgency: "normal",
          });
        }

        // Aviso principal (a la hora; dentro de la última hora para no revivir viejos)
        if (at <= now && now - at < STALE) {
          await fire(owners, `${n.id}:${at}`, {
            kind: "main", noteId: n.id,
            title: "🔔 " + (n.title || "Recordatorio"),
            body: "Es la hora. Toca para escuchar tu recordatorio.",
          });
        }

        // Aviso a la familia si un recordatorio IMPORTANTE no se confirma
        if (r.important && carers.length && at + GRACE <= now && now - at < STALE + GRACE) {
          await fire(carers, `${n.id}:${at}:unc`, {
            kind: "unconfirmed", noteId: n.id,
            title: "⚠️ Sin confirmar: " + (n.title || "Recordatorio"),
            body: "Tu familiar aún no ha confirmado este recordatorio importante.",
          });
        }
      }

      // Limpiar suscripciones caducadas
      if (dead.size) {
        const alive = subs.filter((s) => !dead.has(s.endpoint));
        await env.AUDIO_KV.put(subsKey(code), JSON.stringify(alive));
      }
      // Guardar marcas de disparo (podando las de más de 2 días)
      if (changed) {
        const cutoff = now - 2 * 24 * 60 * MIN;
        for (const k of Object.keys(fired)) if (fired[k] < cutoff) delete fired[k];
        await env.AUDIO_KV.put(firedKey(code), JSON.stringify(fired));
      }
    } catch { /* un espacio con error no debe parar el resto */ }
  }
}
