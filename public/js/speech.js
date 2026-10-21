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
let voicesReady = false;
function ensureVoices() {
  if (voicesReady || !window.speechSynthesis) return;
  speechSynthesis.getVoices();
  voicesReady = true;
}

export const Voice = {
  supported() { return !!window.speechSynthesis; },

  speak(text, { rate = 0.95, onEnd } = {}) {
    if (!window.speechSynthesis) { onEnd && onEnd(); return; }
    ensureVoices();
    try { speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "es-ES";
    u.rate = rate;        // un poco más lento, mejor para mayores
    u.pitch = 1;
    const v = speechSynthesis.getVoices().find((x) => /es(-|_)ES/i.test(x.lang)) ||
              speechSynthesis.getVoices().find((x) => /^es/i.test(x.lang));
    if (v) u.voice = v;
    if (onEnd) u.onend = onEnd;
    speechSynthesis.speak(u);
  },

  stop() { try { window.speechSynthesis && speechSynthesis.cancel(); } catch {} },
};

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
