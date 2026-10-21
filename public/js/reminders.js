/* ============================================================
   reminders.js — Cálculo de fechas y textos de recordatorios
   (funciones puras; la programación/disparo vive en app.js)
   ============================================================ */

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** Traduce los botones rápidos a un timestamp. */
export function quickWhenToTs(when) {
  const now = new Date();
  switch (when) {
    case "1h": return Date.now() + HOUR;
    case "3h": return Date.now() + 3 * HOUR;
    case "tomorrow9": {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.getTime();
    }
    default: return null;
  }
}

/** Avanza una fecha según la repetición (daily/weekly/monthly). */
export function advance(ts, repeat) {
  const d = new Date(ts);
  if (repeat === "daily") d.setDate(d.getDate() + 1);
  else if (repeat === "weekly") d.setDate(d.getDate() + 7);
  else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
  else return null;
  // Si por lo que sea sigue en el pasado, sigue avanzando.
  let next = d.getTime();
  while (next <= Date.now()) {
    const dd = new Date(next);
    if (repeat === "daily") dd.setDate(dd.getDate() + 1);
    else if (repeat === "weekly") dd.setDate(dd.getDate() + 7);
    else dd.setMonth(dd.getMonth() + 1);
    next = dd.getTime();
  }
  return next;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
  "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function hhmm(d) { return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0"); }

/** Texto humano y cercano: "Hoy a las 18:30", "Mañana a las 9:00", "En 2 horas"... */
export function humanWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diff = ts - Date.now();
  const sameDay = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  if (diff < 0) return "Ya pasó · " + shortDate(d);
  if (diff < HOUR) { const m = Math.max(1, Math.round(diff / MIN)); return "En " + m + (m === 1 ? " minuto" : " minutos"); }
  if (sameDay) return "Hoy a las " + hhmm(d);
  if (isTomorrow) return "Mañana a las " + hhmm(d);
  if (diff < 7 * DAY) return capitalize(DIAS[d.getDay()]) + " a las " + hhmm(d);
  return shortDate(d);
}

export function shortDate(d) {
  return d.getDate() + " de " + MESES[d.getMonth()] + " · " + hhmm(d);
}

export function repeatLabel(repeat) {
  return { daily: "Cada día", weekly: "Cada semana", monthly: "Cada mes" }[repeat] || "";
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
