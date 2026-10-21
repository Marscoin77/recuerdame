/* ============================================================
   audio.js — Grabación y reproducción de audio
   ============================================================ */

let mediaRecorder = null;
let chunks = [];
let stream = null;
let startedAt = 0;

export const Recorder = {
  supported() { return !!(navigator.mediaDevices && window.MediaRecorder); },

  /** Pide permiso y empieza a grabar. Devuelve true si arrancó. */
  async start() {
    if (!this.supported()) throw new Error("no-soportado");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    const mime = pickMime();
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRecorder.start();
    startedAt = Date.now();
    return true;
  },

  /** Para la grabación. Devuelve { blob, duration } */
  stop() {
    return new Promise((resolve, reject) => {
      if (!mediaRecorder) return reject(new Error("sin-grabacion"));
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        const duration = Math.round((Date.now() - startedAt) / 1000);
        cleanup();
        resolve({ blob, duration });
      };
      try { mediaRecorder.stop(); } catch (e) { cleanup(); reject(e); }
    });
  },

  cancel() {
    try { if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch {}
    cleanup();
  },

  isRecording() { return mediaRecorder && mediaRecorder.state === "recording"; },
  elapsed() { return startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0; },
};

function cleanup() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null; mediaRecorder = null; chunks = []; startedAt = 0;
}

function pickMime() {
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const m of opts) if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

/* ---------- Reproducción ---------- */
let currentAudio = null;

export function playBlob(blob, { onEnd } = {}) {
  stopPlayback();
  const url = URL.createObjectURL(blob);
  currentAudio = new window.Audio(url);
  currentAudio.onended = currentAudio.onerror = () => {
    URL.revokeObjectURL(url);
    currentAudio = null;
    onEnd && onEnd();
  };
  currentAudio.play().catch(() => { onEnd && onEnd(); });
  return currentAudio;
}

export function stopPlayback() {
  if (currentAudio) { try { currentAudio.pause(); } catch {} currentAudio = null; }
}

export function fmtDuration(sec) {
  sec = Math.max(0, sec | 0);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ":" + String(s).padStart(2, "0");
}
