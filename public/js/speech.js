/* ============================================================
   speech.js — Dictado (reconocimiento) y voz (síntesis)
   Ambos con degradación elegante si el navegador no los tiene.
   ============================================================ */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const Dictation = {
  supported() { return !!SR; },
  _rec: null,

  /** Escucha una frase y la devuelve por onResult. */
  listen({ onResult, onStart, onEnd, onError } = {}) {
    if (!SR) { onError && onError("no-soportado"); return; }
    const rec = new SR();
    rec.lang = "es-ES";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.continuous = false;
    rec.onstart = () => onStart && onStart();
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript.trim();
      onResult && onResult(capitalize(text));
    };
    rec.onerror = (e) => onError && onError(e.error || "error");
    rec.onend = () => { this._rec = null; onEnd && onEnd(); };
    this._rec = rec;
    try { rec.start(); } catch { onError && onError("ya-activo"); }
  },

  stop() { if (this._rec) { try { this._rec.stop(); } catch {} } },
};

/* ---------- Voz (Text-To-Speech) ---------- */
let bestVoice = null;

/* Puntúa una voz en español: cuanto más alto, mejor calidad percibida. */
function scoreVoice(v) {
  const name = (v.name || "").toLowerCase();
  const lang = (v.lang || "").toLowerCase();
  if (!/^es/.test(lang)) return -1;           // solo español
  let s = 0;
  if (/natural|neural/.test(name)) s += 100;  // Microsoft Online (Natural) — las mejores
  if (/google/.test(name)) s += 60;           // Google español (Android/Chrome) — muy buena
  if (v.localService === false) s += 25;       // voces en la nube suelen sonar mejor
  if (/es-es|es_es/.test(lang)) s += 20;       // español de España
  else if (/es-us|es-mx|es-419/.test(lang)) s += 8;
  // Preferir voces femeninas: suelen entenderse mejor para mayores.
  if (/elvira|helena|laura|sabina|paloma|lucia|mónica|monica|female|hembra|mujer/.test(name)) s += 10;
  // Penalizar las robóticas clásicas.
  if (/microsoft (helena|sabina) desktop|espeak|pico|compact/.test(name)) s -= 30;
  return s;
}

function pickVoice() {
  if (!window.speechSynthesis) return null;
  const voices = speechSynthesis.getVoices() || [];
  let best = null, bestScore = -1;
  for (const v of voices) {
    const sc = scoreVoice(v);
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return bestScore >= 0 ? best : null;
}

function refreshVoice() { bestVoice = pickVoice(); }
if (window.speechSynthesis) {
  refreshVoice();
  // Las voces pueden cargarse de forma asíncrona.
  try { speechSynthesis.addEventListener("voiceschanged", refreshVoice); } catch {}
}

export const Voice = {
  supported() { return !!window.speechSynthesis; },

  speak(text, { rate = 0.95, onEnd } = {}) {
    if (!window.speechSynthesis) { onEnd && onEnd(); return; }
    try { speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    if (!bestVoice) refreshVoice();
    const v = bestVoice;
    u.voice = v || null;
    u.lang = (v && v.lang) || "es-ES";
    u.rate = rate;        // un poco más lento, mejor para mayores
    u.pitch = 1;
    if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
  },

  stop() { try { window.speechSynthesis && speechSynthesis.cancel(); } catch {} },
};

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
