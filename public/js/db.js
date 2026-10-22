/* ============================================================
   db.js — Almacenamiento local con IndexedDB
   Guarda notas (metadatos), audios (Blobs), ajustes y
   subcategorías. Todo funciona sin conexión.
   ============================================================ */

const DB_NAME = "recuerdame";
const DB_VERSION = 1;
let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("notes")) {
        const s = db.createObjectStore("notes", { keyPath: "id" });
        s.createIndex("section", "section", { unique: false });
      }
      if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("subs")) db.createObjectStore("subs", { keyPath: "id" });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = "readonly") {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function all(store) {
  return tx(store).then((s) => done(s.getAll()));
}

/* ---------- Notas ---------- */
export const Notes = {
  all: () => all("notes"),
  async get(id) { return done((await tx("notes")).get(id)); },
  async put(note) { return done((await tx("notes", "readwrite")).put(note)); },
  async remove(id) { return done((await tx("notes", "readwrite")).delete(id)); },
};

/* ---------- Audio (Blobs) ---------- */
export const Audio = {
  async put(id, blob) { return done((await tx("audio", "readwrite")).put({ id, blob })); },
  async get(id) {
    const row = await done((await tx("audio")).get(id));
    return row ? row.blob : null;
  },
  async remove(id) { return done((await tx("audio", "readwrite")).delete(id)); },
};

/* ---------- Subcategorías de "Otros" ---------- */
export const Subs = {
  all: () => all("subs"),
  async put(sub) { return done((await tx("subs", "readwrite")).put(sub)); },
  async remove(id) { return done((await tx("subs", "readwrite")).delete(id)); },
};

/* ---------- Ajustes ---------- */
const DEFAULT_SETTINGS = {
  contrast: "normal",
  font: "1",
  haptics: true,
  voiceConfirm: true,
  autoPlay: true,
  tutorialDone: false,
  emName: "",
  emPhone: "",
  syncCode: null,
  role: "owner",      // "owner" (el mayor) | "caregiver" (familiar que cuida)
  push: false,        // avisos en segundo plano activados en este dispositivo
};

export const Settings = {
  async load() {
    const rows = await all("settings");
    const map = { ...DEFAULT_SETTINGS };
    rows.forEach((r) => { map[r.key] = r.value; });
    return map;
  },
  async set(key, value) { return done((await tx("settings", "readwrite")).put({ key, value })); },
};

/* ---------- Utilidad: id único ---------- */
export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "x" + Date.now() + Math.random().toString(16).slice(2));
}
