/* ============================================================
   push.js — Avisos en segundo plano (Web Push)
   Suscribe el navegador al servicio de push y registra la
   suscripción en el servidor, ligada al código del espacio.
   El Worker (Cron) envía el aviso a su hora aunque la app esté
   cerrada. Mejora progresiva: si el navegador no lo soporta,
   todo lo demás sigue funcionando.
   ============================================================ */

const API = "";

export const Push = {
  supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  },

  /** ¿Hay una suscripción activa en este navegador? */
  async isSubscribed() {
    if (!this.supported()) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      return !!sub;
    } catch { return false; }
  },

  /** Clave pública VAPID del servidor (con respaldo local). */
  async vapidKey() {
    try {
      const r = await fetch(API + "/api/push/key");
      const { key } = await r.json();
      if (key) return key;
    } catch {}
    return "BPA_pYlaFfg9RoisjdbqHl9I3z99dGDfszaEDgaoql5pOT9pWNiI2i_cdPYBsa3y8vgIHhERk-T9joSgv_TZUtg";
  },

  /**
   * Activa los avisos en segundo plano para este dispositivo.
   * @param {string} code  código del espacio en la nube
   * @param {string} role  "owner" (el mayor) | "caregiver" (familiar)
   * @returns {Promise<"ok"|"denied"|"unsupported"|"error">}
   */
  async enable(code, role = "owner") {
    if (!this.supported()) return "unsupported";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return "denied";
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const key = urlB64ToUint8Array(await this.vapidKey());
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const r = await fetch(API + "/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, role, subscription: sub.toJSON() }),
      });
      return r.ok ? "ok" : "error";
    } catch (e) {
      return "error";
    }
  },

  /** Desactiva los avisos en segundo plano en este dispositivo. */
  async disable(code) {
    if (!this.supported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(API + "/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } catch {}
  },

  /** Re-registra la suscripción (por si el servidor la perdió). */
  async refresh(code, role = "owner") {
    if (!(await this.isSubscribed())) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(API + "/api/push/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, role, subscription: sub.toJSON() }),
        }).catch(() => {});
      }
    } catch {}
  },
};

function urlB64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
