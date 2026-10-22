/* ============================================================
   native.js — Puente con la app nativa (Capacitor)
   Cuando RecuérdaME corre DENTRO del APK (no en un navegador),
   los avisos se programan como notificaciones del propio móvil,
   que suenan a la hora exacta aunque la app esté cerrada y sin
   internet. En la web normal este módulo no hace nada.
   ============================================================ */

const Cap = typeof window !== "undefined" ? window.Capacitor : null;

/** ¿Estamos dentro del APK nativo? */
export const isNativeApp = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());

// Proxy al plugin nativo de notificaciones locales (solo si hay bridge).
let LN = null;
if (isNativeApp && typeof Cap.registerPlugin === "function") {
  try { LN = Cap.registerPlugin("LocalNotifications"); } catch { LN = null; }
}

const CHANNEL = "recuerdame";

/** id numérico estable a partir del id de la nota (string). */
function nid(id) {
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2000000000) + 1;
}

export const Native = {
  isApp: isNativeApp,

  /** Pide permiso de notificaciones y prepara el canal y el "al tocar". */
  async init(onOpenNote) {
    if (!LN) return;
    try { await LN.requestPermissions(); } catch {}
    try {
      await LN.createChannel({
        id: CHANNEL, name: "Recordatorios",
        description: "Avisos de tus recordatorios",
        importance: 5, visibility: 1, vibration: true,
      });
    } catch {}
    try {
      await LN.addListener("localNotificationActionPerformed", (a) => {
        const id = a && a.notification && a.notification.extra && a.notification.extra.noteId;
        if (id && onOpenNote) onOpenNote(id);
      });
    } catch {}
    // Si la app se abrió desde una notificación que quedó pendiente.
    try {
      const d = await LN.getDeliveredNotifications();
      void d;
    } catch {}
  },

  /** Reprograma TODAS las notificaciones a partir de las notas actuales. */
  async sync(notes) {
    if (!LN) return;
    // Borrar las que ya teníamos programadas (evita duplicados).
    try {
      const pend = await LN.getPending();
      const list = (pend && pend.notifications) || [];
      if (list.length) await LN.cancel({ notifications: list.map((n) => ({ id: n.id })) });
    } catch {}

    const out = [];
    for (const n of notes) {
      const r = n.reminder;
      if (!r || r.done || n.deleted || !r.at) continue;
      const repeats = r.repeat && r.repeat !== "none";
      const at = new Date(r.at);
      // Si la hora ya pasó y no se repite, no tiene sentido programarla.
      if (at.getTime() <= Date.now() && !repeats) continue;
      // Si se repite pero quedó en el pasado, avanzar hasta el futuro.
      while (repeats && at.getTime() <= Date.now()) {
        if (r.repeat === "daily") at.setDate(at.getDate() + 1);
        else if (r.repeat === "weekly") at.setDate(at.getDate() + 7);
        else at.setMonth(at.getMonth() + 1);
      }
      const notif = {
        id: nid(n.id),
        title: "🔔 " + (n.title || "Recordatorio"),
        body: "Toca para escuchar tu recordatorio",
        smallIcon: "ic_stat_icon",
        channelId: CHANNEL,
        extra: { noteId: n.id },
        schedule: { at, allowWhileIdle: true },
      };
      if (repeats) {
        notif.schedule.repeats = true;
        notif.schedule.every = r.repeat === "daily" ? "day" : r.repeat === "weekly" ? "week" : "month";
      }
      out.push(notif);
    }
    if (out.length) {
      try { await LN.schedule({ notifications: out }); } catch (e) { try { console.warn("LN.schedule", e); } catch {} }
    }
  },
};
