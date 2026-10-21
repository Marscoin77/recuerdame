/* ============================================================
   sync.js — Copia / sincronización en la nube (Cloudflare)
   Sube los metadatos (D1) y los audios (R2) asociados a un
   código. Pensado para no perder datos y usarlos en otro móvil.
   ============================================================ */

import { Notes, Audio, Settings } from "./db.js";

const API = ""; // misma raíz: el Worker sirve la PWA y la API

export const Sync = {
  available() { return navigator.onLine; },

  /** Crea un código nuevo en el servidor. */
  async pair() {
    const r = await fetch(API + "/api/pair", { method: "POST" });
    if (!r.ok) throw new Error("pair");
    const { code } = await r.json();
    await Settings.set("syncCode", code);
    return code;
  },

  /** Sube todas las notas + audios a la nube. */
  async push(code) {
    code = norm(code);
    const notes = await Notes.all();
    // Subir audios que aún no estén en la nube (marcamos con flag cloudAudio)
    for (const n of notes) {
      if (n.audioId && !n.cloudAudio) {
        const blob = await Audio.get(n.audioId);
        if (blob) {
          const r = await fetch(`${API}/api/audio/${code}/${n.audioId}`, {
            method: "PUT",
            headers: { "content-type": blob.type || "audio/webm" },
            body: blob,
          });
          if (r.ok) { n.cloudAudio = true; await Notes.put(n); }
        }
      }
    }
    const payload = notes.map(stripBlobs);
    const r = await fetch(`${API}/api/sync/${code}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: payload }),
    });
    if (!r.ok) throw new Error("push");
    return (await r.json()).updated;
  },

  /** Descarga de la nube y fusiona con lo local (gana lo más reciente). */
  async pull(code) {
    code = norm(code);
    const r = await fetch(`${API}/api/sync/${code}`);
    if (r.status === 404) throw new Error("no_existe");
    if (!r.ok) throw new Error("pull");
    const { notes: remote } = await r.json();
    const localList = await Notes.all();
    const local = new Map(localList.map((n) => [n.id, n]));
    let added = 0;

    for (const rn of remote) {
      const ln = local.get(rn.id);
      if (!ln || (rn.updatedAt || 0) > (ln.updatedAt || 0)) {
        // Descargar audio si falta en local
        if (rn.audioId && !(await Audio.get(rn.audioId))) {
          try {
            const ar = await fetch(`${API}/api/audio/${code}/${rn.audioId}`);
            if (ar.ok) await Audio.put(rn.audioId, await ar.blob());
          } catch {}
        }
        rn.cloudAudio = true;
        await Notes.put(rn);
        if (!ln) added++;
      }
    }
    await Settings.set("syncCode", code);
    return { total: remote.length, added };
  },
};

function stripBlobs(n) {
  const { ...copy } = n;
  return copy; // las notas ya no llevan el Blob dentro; el audio va en R2
}
function norm(c) { return (c || "").toUpperCase().trim(); }
