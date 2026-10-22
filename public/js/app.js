/* ============================================================
   app.js — Lógica principal de RecuérdaME
   ============================================================ */

import { Notes, Audio, Subs, Settings, uid } from "./db.js";
import { Recorder, playBlob, stopPlayback, fmtDuration } from "./audio.js";
import { Dictation, Voice } from "./speech.js";
import { quickWhenToTs, advance, humanWhen, shortDate, repeatLabel, MIN } from "./reminders.js";
import { Sync } from "./sync.js";
import { Push } from "./push.js";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SECTIONS = {
  salud: { label: "Salud", emoji: "🏥", c: "#1E7A3C", bg: "#E4F4EB" },
  casa:  { label: "Casa",  emoji: "🏠", c: "#C05800", bg: "#FDEEDE" },
  ocio:  { label: "Ocio",  emoji: "🎭", c: "#7B2D9A", bg: "#F2E5FB" },
  otros: { label: "Otros", emoji: "⭐", c: "#1558A8", bg: "#E3EDFC" },
};

const state = {
  settings: null,
  screen: "home",
  section: null,
  sub: null,            // {id,name,emoji} cuando estamos dentro de una subcategoría
  stack: [],
  pending: null,        // grabación pendiente de guardar { blob, duration, when, repeat, preAlert, reRecordId }
  remindersTab: "upcoming",
  alertQueue: [],
  alertActive: false,
};

/* =========================================================
   ARRANQUE
   ========================================================= */
async function init() {
  try {
    state.settings = await Settings.load();
  } catch (e) {
    // Si el almacenamiento falla (p. ej. modo privado), no dejamos la
    // pantalla en blanco: avisamos con un mensaje claro y grande.
    showFatal("No puedo guardar datos en este navegador. Prueba a abrir la app en Chrome y sin modo incógnito.");
    return;
  }
  applyTheme();
  bindGlobal();
  bindSection();
  bindReminders();
  bindSettings();
  bindDialog();

  registerSW();
  setupInstall();
  await renderHome().catch(() => {});
  startReminderLoop();

  // Si los avisos en segundo plano estaban activos, re-registramos la
  // suscripción por si el servidor la hubiera perdido.
  if (state.settings.push && state.settings.syncCode) {
    Push.refresh(state.settings.syncCode, state.settings.role || "owner").catch(() => {});
  }

  // Atajos del manifest (?go=salud)
  const go = new URLSearchParams(location.search).get("go");
  if (go && SECTIONS[go]) openSection(go);
  else if (go === "reminders") openReminders();

  if (!state.settings.tutorialDone) startTutorial();
}

function showFatal(msg) {
  const m = $("#main");
  if (m) m.innerHTML = `<div class="screen"><p class="empty-hint" style="margin-top:3rem">⚠️<br/>${esc(msg)}</p></div>`;
}

/* =========================================================
   TEMA (contraste, fuente) + color de sección
   ========================================================= */
function applyTheme() {
  const html = document.documentElement;
  html.setAttribute("data-contrast", state.settings.contrast || "normal");
  html.setAttribute("data-font", state.settings.font || "1");
}
function setSectionColor(section) {
  const meta = SECTIONS[section] || SECTIONS.salud;
  document.documentElement.style.setProperty("--c", meta.c);
  document.documentElement.style.setProperty("--bg", meta.bg);
  const tc = $('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", meta.c);
}
function resetColor() {
  document.documentElement.style.setProperty("--c", "#1E7A3C");
  document.documentElement.style.setProperty("--bg", "#E4F4EB");
  const tc = $('meta[name="theme-color"]');
  if (tc) tc.setAttribute("content", "#1E7A3C");
}

/* =========================================================
   NAVEGACIÓN
   ========================================================= */
function show(screen) {
  $$(".screen").forEach((s) => (s.hidden = s.dataset.screen !== screen));
  state.screen = screen;
  const atHome = screen === "home";
  $("#backBtn").hidden = atHome;
  $("#brand").style.visibility = atHome ? "visible" : "visible";
  window.scrollTo(0, 0);
}
function pushNav() { state.stack.push({ screen: state.screen, section: state.section, sub: state.sub }); }
function goBack() {
  stopPlayback(); Voice.stop();
  const prev = state.stack.pop();
  if (!prev || prev.screen === "home") { goHome(); return; }
  state.section = prev.section; state.sub = prev.sub;
  if (prev.screen === "section") { renderSection(); show("section"); setSectionColor(prev.section); }
  else if (prev.screen === "subs") { renderSubs(); show("subs"); setSectionColor("otros"); }
  else { goHome(); }
}
function goHome() {
  state.stack = []; state.section = null; state.sub = null;
  resetColor(); renderHome(); show("home");
}

/* =========================================================
   INICIO
   ========================================================= */
async function renderHome() {
  // Modo súper simple: un solo botón grande en lugar de las 4 categorías.
  const simple = state.settings.simple === true;
  $("#homeGrid").hidden = simple;
  $("#homeSimple").hidden = !simple;
  $("#homeTitle").textContent = simple ? "Toca para grabar" : "¿Qué quieres recordar?";

  // badge de próximos
  const notes = (await Notes.all()).filter((n) => !n.deleted);
  const upcoming = notes.filter((n) => n.reminder && !n.reminder.done && n.reminder.at > Date.now());
  const badge = $("#remindersBadge");
  badge.hidden = upcoming.length === 0;
  badge.textContent = upcoming.length;
  // botón de emergencia
  const em = $("#emergencyBtn");
  if (state.settings.emPhone) {
    em.hidden = false;
    em.querySelector(".wide-text").textContent = state.settings.emName
      ? "Llamar a " + state.settings.emName : "Llamar a mi familia";
  } else em.hidden = true;

  // banner de modo cuidador
  const banner = $("#careBanner");
  if (state.settings.role === "caregiver" && state.settings.syncCode) {
    banner.hidden = false;
    banner.innerHTML = `👨‍👩‍👧 Estás ayudando a tu familiar.
      <span class="care-sub">Lo que grabes aquí le llegará a su móvil. Código: ${esc(state.settings.syncCode)}</span>`;
  } else if (state.settings.role === "caregiver") {
    banner.hidden = false;
    banner.innerHTML = `👨‍👩‍👧 Modo familiar
      <span class="care-sub">Ve a Ajustes → Familia y escribe el código de la persona a la que cuidas.</span>`;
  } else banner.hidden = true;
}

/* =========================================================
   SUBCATEGORÍAS (dentro de "Otros")
   ========================================================= */
async function openOtros() {
  pushNav();
  state.section = "otros";
  setSectionColor("otros");
  await renderSubs();
  show("subs");
}
async function renderSubs() {
  const subs = await Subs.all();
  const grid = $("#subsGrid");
  grid.innerHTML = "";
  subs.forEach((s) => {
    const b = document.createElement("button");
    b.className = "tile sub";
    b.style.cssText = "--c:#1558A8;--bg:#E3EDFC";
    b.innerHTML = `<span class="tile-emoji">${s.emoji || "⭐"}</span><span class="tile-label">${esc(s.name)}</span>`;
    b.addEventListener("click", () => openSection("otros", s));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); askDeleteSub(s); });
    grid.appendChild(b);
  });
  if (!subs.length) {
    const p = document.createElement("p");
    p.className = "empty-hint";
    p.innerHTML = "Crea tus propios apartados.<br/>Por ejemplo: Nietos, Viajes, Compras…";
    grid.appendChild(p);
  }
}

/* =========================================================
   PANTALLA DE SECCIÓN (grabar + notas)
   ========================================================= */
function openSection(section, sub = null) {
  pushNav();
  state.section = section;
  state.sub = sub;
  state.pending = null;
  setSectionColor(section);
  resetRecordUI();
  $("#saveForm").hidden = true;
  renderSection();
  show("section");
}
async function renderSection() {
  const meta = SECTIONS[state.section];
  const title = state.sub ? `${state.sub.emoji || "⭐"} ${state.sub.name}` : `${meta.emoji} ${meta.label}`;
  $("#sectionTitle").textContent = title;

  const notes = (await Notes.all())
    .filter((n) => !n.deleted && n.section === state.section && (state.sub ? n.sub === state.sub.id : !n.sub))
    .sort((a, b) => sortNotes(a, b));

  const grid = $("#notesGrid");
  grid.innerHTML = "";
  notes.forEach((n) => grid.appendChild(noteCard(n)));
  $("#notesHeading").hidden = notes.length === 0;
  $("#emptyHint").hidden = notes.length !== 0;
}
function sortNotes(a, b) {
  const ar = a.reminder && !a.reminder.done ? a.reminder.at : null;
  const br = b.reminder && !b.reminder.done ? b.reminder.at : null;
  if (ar && br) return ar - br;
  if (ar) return -1;
  if (br) return 1;
  return b.createdAt - a.createdAt;
}
function noteCard(n) {
  const b = document.createElement("button");
  b.className = "note-card" + (n.done ? " done" : "");
  const emoji = n.emoji || (SECTIONS[n.section] || SECTIONS.salud).emoji;
  let when = "";
  if (n.reminder && !n.reminder.done) {
    const over = n.reminder.at < Date.now();
    when = `<span class="note-when ${over ? "over" : ""}">${over ? "⏰ " : "🔔 "}${humanWhen(n.reminder.at)}</span>`;
  }
  b.innerHTML = `<span class="note-emoji">${n.done ? "✅" : emoji}</span>
    <span class="note-title">${esc(n.title || "Sin título")}</span>${when}`;
  b.addEventListener("click", () => openNoteDetail(n));
  return b;
}

/* =========================================================
   GRABACIÓN
   ========================================================= */
function bindSection() {
  $("#recordBtn").addEventListener("click", toggleRecord);
  $("#redoBtn").addEventListener("click", startRecording);
  $("#previewPlay").addEventListener("click", previewPlay);
  $("#dictateBtn").addEventListener("click", dictateTitle);
  $("#cancelSaveBtn").addEventListener("click", cancelSave);
  $("#saveBtn").addEventListener("click", saveNote);

  $("#whenQuick").addEventListener("click", onWhenClick);
  $("#repeatBox").addEventListener("click", onRepeatClick);
  $("#whenDate").addEventListener("change", onCustomWhen);
  $("#whenTime").addEventListener("change", onCustomWhen);
}

let recTimer = null;
async function toggleRecord() {
  if (Recorder.isRecording()) return stopRecording();
  startRecording();
}
async function startRecording() {
  haptic();
  try {
    if (Recorder.isRecording()) await Recorder.stop();
    await Recorder.start();
  } catch (e) {
    return openDialog({ emoji: "🎤", title: "No puedo usar el micrófono. Revisa los permisos del navegador.", okText: "Entendido", hideCancel: true });
  }
  const btn = $("#recordBtn");
  btn.classList.add("recording");
  $("#recordEmoji").textContent = "⏹️";
  $("#recordLabel").textContent = "Pulsa para parar";
  const t = $("#recordTime"); t.hidden = false; t.textContent = "0:00";
  $("#saveForm").hidden = true;
  recTimer = setInterval(() => { t.textContent = fmtDuration(Recorder.elapsed()); }, 250);
}
async function stopRecording() {
  haptic();
  clearInterval(recTimer);
  let result;
  try { result = await Recorder.stop(); } catch { resetRecordUI(); return; }
  resetRecordUI();
  if (!result || result.duration < 1) {
    openDialog({ emoji: "🎤", title: "La grabación fue muy corta. Inténtalo otra vez.", okText: "Vale", hideCancel: true });
    return;
  }
  state.pending = { blob: result.blob, duration: result.duration, when: null, repeat: "none", preAlert: false,
    reRecordId: state.pending?.reRecordId || null, title: state.pending?.title || "" };
  showSaveForm();
}
function resetRecordUI() {
  clearInterval(recTimer);
  const btn = $("#recordBtn");
  btn.classList.remove("recording");
  $("#recordEmoji").textContent = "🎙️";
  $("#recordLabel").textContent = "Pulsa para grabar";
  $("#recordTime").hidden = true;
}
function showSaveForm() {
  const f = $("#saveForm");
  f.hidden = false;
  $("#noteTitle").value = state.pending?.title || "";
  $$("#whenQuick .chip").forEach((c) => c.classList.toggle("active", c.dataset.when === "none"));
  $("#whenCustom").hidden = true;
  $("#repeatBox").hidden = true;
  $("#preAlert").checked = false;
  $("#impAlert").checked = false;
  f.scrollIntoView({ behavior: "smooth", block: "center" });
  $("#noteTitle").focus();
}
function previewPlay() {
  if (!state.pending) return;
  haptic();
  playBlob(state.pending.blob);
}

/* ---- Dictado del título ---- */
function dictateTitle() {
  if (!Dictation.supported()) {
    openDialog({ emoji: "🎤", title: "Tu navegador no permite dictar. Escribe el título con el teclado.", okText: "Vale", hideCancel: true });
    return;
  }
  const btn = $("#dictateBtn");
  Dictation.listen({
    onStart: () => { btn.classList.add("listening"); btn.textContent = "🔴"; },
    onEnd: () => { btn.classList.remove("listening"); btn.textContent = "🎤"; },
    onResult: (text) => { $("#noteTitle").value = text; },
    onError: () => { btn.classList.remove("listening"); btn.textContent = "🎤"; },
  });
}

/* ---- Selección de cuándo avisar ---- */
function onWhenClick(e) {
  const chip = e.target.closest(".chip"); if (!chip) return;
  haptic();
  $$("#whenQuick .chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  const when = chip.dataset.when;
  if (when === "custom") {
    $("#whenCustom").hidden = false;
    const d = new Date(Date.now() + 60 * MIN);
    $("#whenDate").value = toDateInput(d);
    $("#whenTime").value = toTimeInput(d);
    state.pending.when = d.getTime();
    $("#repeatBox").hidden = false;
  } else {
    $("#whenCustom").hidden = true;
    state.pending.when = quickWhenToTs(when); // null para "none"
    $("#repeatBox").hidden = when === "none";
  }
}
function onCustomWhen() {
  const d = $("#whenDate").value, t = $("#whenTime").value || "09:00";
  if (!d) return;
  const ts = new Date(d + "T" + t).getTime();
  if (!isNaN(ts)) state.pending.when = ts;
}
function onRepeatClick(e) {
  const chip = e.target.closest(".chip[data-repeat]");
  if (!chip) return;
  haptic();
  $$("#repeatBox .chip").forEach((c) => c.classList.remove("active"));
  chip.classList.add("active");
  state.pending.repeat = chip.dataset.repeat;
}

function cancelSave() {
  state.pending = null;
  $("#saveForm").hidden = true;
  resetRecordUI();
}

/* ---- Guardar ---- */
async function saveNote() {
  if (!state.pending) return;
  haptic();
  const title = ($("#noteTitle").value || "").trim() || "Recordatorio de voz";
  const preAlert = $("#preAlert").checked;
  const important = $("#impAlert").checked;
  const when = $("#repeatBox").hidden ? null : state.pending.when;

  let note;
  if (state.pending.reRecordId) {
    note = await Notes.get(state.pending.reRecordId);
  }
  if (!note) {
    note = {
      id: uid(),
      section: state.section,
      sub: state.sub ? state.sub.id : null,
      emoji: state.sub ? state.sub.emoji : SECTIONS[state.section].emoji,
      createdAt: Date.now(),
      done: false,
    };
  }
  note.title = title;
  note.updatedAt = Date.now();
  note.cloudAudio = false; // audio cambió → re-subir en la próxima sync

  // Guardar audio
  const audioId = note.audioId || uid();
  await Audio.put(audioId, state.pending.blob);
  note.audioId = audioId;
  note.audioDuration = state.pending.duration;

  // Recordatorio
  if (when && when > Date.now()) {
    note.reminder = { at: when, repeat: state.pending.repeat || "none", preAlert, important, done: false, lastFired: 0, lastPre: 0 };
    await ensureNotificationPermission();
  } else {
    note.reminder = null;
  }

  await Notes.put(note);
  state.pending = null;
  $("#saveForm").hidden = true;
  resetRecordUI();
  await renderSection();
  scheduleAll();

  speakConfirm(when ? "Guardado. Te avisaré " + humanWhen(when).toLowerCase() : "Tu recordatorio se ha guardado");
  toast(when ? "✅ Guardado · aviso " + humanWhen(when).toLowerCase() : "✅ Guardado");
  autoSync();
}

/* =========================================================
   DETALLE DE UNA NOTA
   ========================================================= */
function openNoteDetail(n) {
  stopPlayback();
  const meta = SECTIONS[n.section] || SECTIONS.salud;
  const emoji = n.done ? "✅" : (n.emoji || meta.emoji);
  let sub = "";
  if (n.reminder && !n.reminder.done) {
    sub = `<p class="dialog-when">🔔 ${humanWhen(n.reminder.at)}${n.reminder.repeat !== "none" ? " · " + repeatLabel(n.reminder.repeat) : ""}</p>`;
  }
  const html = `
    <span class="dialog-emoji">${emoji}</span>
    <h2 class="dialog-title">${esc(n.title)}</h2>
    ${sub}
    <div class="note-detail-actions">
      <button class="play-btn huge" id="ndPlay">▶️ Escuchar</button>
      <button class="chip" id="ndShare" style="min-height:64px">📲 Enviar a la familia</button>
      <button class="chip" id="ndDone" style="min-height:64px">${n.done ? "↩️ Marcar como pendiente" : "✅ Marcar como hecho"}</button>
      <button class="chip" id="ndRerec" style="min-height:64px">🎙️ Grabar de nuevo</button>
      <button class="cancel-btn" id="ndDelete" style="min-height:64px">🗑️ Borrar</button>
    </div>`;
  openCustomDialog(html, (root, close) => {
    root.querySelector("#ndPlay").addEventListener("click", async () => {
      const blob = await Audio.get(n.audioId);
      if (blob) playBlob(blob); else toast("No encuentro el audio");
    });
    root.querySelector("#ndShare").addEventListener("click", () => shareNote(n));
    root.querySelector("#ndDone").addEventListener("click", async () => {
      await toggleDone(n); close(); renderSection(); renderHome();
    });
    root.querySelector("#ndRerec").addEventListener("click", async () => {
      close();
      let sub = null;
      if (n.sub) { const subs = await Subs.all(); sub = subs.find((x) => x.id === n.sub) || null; }
      openSection(n.section, sub);               // navega a la sección (pone pending=null)
      state.pending = { reRecordId: n.id, title: n.title };
      startRecording();
    });
    root.querySelector("#ndDelete").addEventListener("click", () => { close(); deleteNoteWithUndo(n); });
  });
}
async function toggleDone(n) {
  n.done = !n.done;
  n.updatedAt = Date.now();
  if (n.done && n.reminder && n.reminder.repeat !== "none") {
    // recurrente: al marcar hecho, pasa a la siguiente vez en vez de desactivar
    const next = advance(n.reminder.at, n.reminder.repeat);
    if (next) { n.reminder.at = next; n.reminder.lastFired = 0; n.reminder.lastPre = 0; n.done = false; }
  } else if (n.done && n.reminder) {
    n.reminder.done = true;
  }
  await Notes.put(n);
  scheduleAll();
  autoSync();
}

async function deleteNoteWithUndo(n) {
  // Borrado "blando" (tombstone): así la eliminación también se sincroniza
  // y la nota no reaparece al traer datos de la nube.
  n.deleted = true;
  n.updatedAt = Date.now();
  if (n.reminder) n.reminder.done = true;
  await Notes.put(n);
  await renderSection(); renderHome();
  let undone = false;
  toast("🗑️ Borrado", {
    actionText: "Deshacer",
    onAction: async () => {
      undone = true;
      n.deleted = false;
      if (n.reminder && n.reminder.at > Date.now()) n.reminder.done = false;
      n.updatedAt = Date.now();
      await Notes.put(n);
      await renderSection(); renderHome(); scheduleAll(); autoSync();
    },
    onGone: async () => { if (!undone) autoSync(); },
  });
  scheduleAll();
}

/* =========================================================
   COMPARTIR CON LA FAMILIA (WhatsApp / hoja de compartir)
   ========================================================= */
async function shareNote(n) {
  haptic();
  const blob = n.audioId ? await Audio.get(n.audioId) : null;
  const text = `🔊 RecuérdaME — ${n.title || "Nota de voz"}`;
  // 1) Compartir el audio como archivo (abre WhatsApp y similares en el móvil)
  if (blob && navigator.canShare) {
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([blob], `recordatorio.${ext}`, { type: blob.type || "audio/webm" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: "RecuérdaME", text }); return; }
      catch (e) { if (e && e.name === "AbortError") return; }
    }
  }
  // 2) Compartir solo texto
  if (navigator.share) {
    try { await navigator.share({ title: "RecuérdaME", text }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  // 3) Último recurso: abrir WhatsApp con el texto
  window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
}

/* =========================================================
   INSTALAR EN EL MÓVIL (PWA)
   ========================================================= */
let deferredInstall = null;
function setupInstall() {
  const btn = $("#installBtn");
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) { btn.hidden = true; return; }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e; btn.hidden = false;
  });
  window.addEventListener("appinstalled", () => { btn.hidden = true; deferredInstall = null; toast("✅ ¡Instalada!"); });

  btn.addEventListener("click", async () => {
    haptic();
    if (deferredInstall) {
      deferredInstall.prompt();
      await deferredInstall.userChoice.catch(() => {});
      deferredInstall = null; btn.hidden = true;
    } else {
      openDialog({
        emoji: "📲",
        title: 'Para instalarla: pulsa el botón "Compartir" de tu navegador y elige "Añadir a pantalla de inicio".',
        okText: "Entendido", hideCancel: true,
      });
    }
  });

  // iOS/iPadOS no lanza beforeinstallprompt: mostramos el botón con instrucciones.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) btn.hidden = false;
}

/* =========================================================
   RECORDATORIOS: programación y disparo
   ========================================================= */
let loopTimer = null;
let pullTimer = null;
function startReminderLoop() {
  scheduleAll();
  clearInterval(loopTimer);
  loopTimer = setInterval(checkDue, 15000);
  // Trae cambios de la nube periódicamente (modo familia / varios móviles).
  clearInterval(pullTimer);
  pullTimer = setInterval(autoPull, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkDue(); autoPull(); } });
  window.addEventListener("focus", () => { checkDue(); autoPull(); });
  checkDue();
  autoPull();
}

async function scheduleAll() {
  // Programa notificaciones del sistema (si el navegador lo permite) para
  // que suenen aunque la app esté cerrada. Es una mejora progresiva.
  if (!("serviceWorker" in navigator) || !("TimestampTrigger" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.getNotifications({ includeTriggered: true });
    existing.forEach((nf) => nf.tag && nf.tag.startsWith("rem-") && nf.close());
    const notes = await Notes.all();
    for (const n of notes) {
      if (n.reminder && !n.reminder.done && !n.deleted && n.reminder.at > Date.now()) {
        reg.showNotification("🔔 " + (n.title || "Recordatorio"), {
          tag: "rem-" + n.id,
          body: "Toca para escuchar tu recordatorio",
          icon: "./icons/icon-192.png",
          badge: "./icons/icon-192.png",
          showTrigger: new TimestampTrigger(n.reminder.at),
          data: { noteId: n.id },
        }).catch(() => {});
      }
    }
  } catch {}
}

async function checkDue() {
  const notes = await Notes.all();
  const now = Date.now();
  for (const n of notes) {
    const r = n.reminder;
    if (!r || r.done || n.deleted) continue;
    // aviso previo
    if (r.preAlert) {
      const pre = r.at - 30 * MIN;
      if (pre <= now && now < r.at && r.lastPre !== r.at) {
        r.lastPre = r.at; await Notes.put(n);
        notifySystem("⏰ Pronto: " + n.title, "Dentro de 30 minutos");
      }
    }
    // aviso principal
    if (r.at <= now && r.lastFired !== r.at) {
      r.lastFired = r.at;
      await Notes.put(n);
      enqueueAlert(n);
    }
  }
  if (!state.alertActive) nextAlert();
  renderHome();
  if (state.screen === "reminders") renderReminders();
}

function enqueueAlert(n) { if (!state.alertQueue.find((x) => x.id === n.id)) state.alertQueue.push(n); }
function nextAlert() {
  if (state.alertActive || !state.alertQueue.length) return;
  const n = state.alertQueue.shift();
  showAlert(n);
}
async function showAlert(n) {
  state.alertActive = true;
  const meta = SECTIONS[n.section] || SECTIONS.salud;
  $("#alertEmoji").textContent = n.emoji || meta.emoji;
  $("#alertTitle").textContent = n.title || "Recordatorio";
  $("#reminderAlert").hidden = false;
  haptic([200, 100, 200]);
  notifySystem("🔔 " + (n.title || "Recordatorio"), "Es la hora de tu recordatorio");

  const blob = n.audioId ? await Audio.get(n.audioId) : null;
  const playNow = () => blob && playBlob(blob);
  if (state.settings.autoPlay && blob) setTimeout(playNow, 400);
  else if (!blob) Voice.speak(n.title || "Tienes un recordatorio");

  $("#alertPlay").onclick = () => { haptic(); playNow(); };
  $("#alertDone").onclick = async () => { await resolveAlert(n, true); };
  $("#alertSnooze").onclick = async () => { await resolveAlert(n, false); };

  // Reaviso: si no se confirma, insistir (vibrar + notificar) hasta 3 veces.
  state.nudgeCount = 0;
  clearInterval(state.nudgeTimer);
  state.nudgeTimer = setInterval(() => {
    if (!state.alertActive || state.nudgeCount >= 3) { clearInterval(state.nudgeTimer); return; }
    state.nudgeCount++;
    haptic([250, 120, 250]);
    notifySystem("🔔 Sigue pendiente: " + (n.title || "Recordatorio"), "Toca para verlo y escucharlo.");
  }, 90000);
}
async function resolveAlert(n, doneIt) {
  stopPlayback(); Voice.stop();
  clearInterval(state.nudgeTimer);
  $("#reminderAlert").hidden = true;
  state.alertActive = false;
  const fresh = await Notes.get(n.id);
  if (fresh && fresh.reminder) {
    if (doneIt) {
      if (fresh.reminder.repeat !== "none") {
        const next = advance(fresh.reminder.at, fresh.reminder.repeat);
        fresh.reminder.at = next; fresh.reminder.lastFired = 0; fresh.reminder.lastPre = 0;
      } else {
        fresh.reminder.done = true; fresh.done = true;
      }
    } else {
      // posponer 10 minutos
      fresh.reminder.at = Date.now() + 10 * MIN;
      fresh.reminder.lastFired = 0;
      toast("⏰ Te lo recuerdo en 10 minutos");
    }
    fresh.updatedAt = Date.now();
    await Notes.put(fresh);
  }
  scheduleAll(); renderHome(); autoSync();
  if (state.screen === "section") renderSection();
  setTimeout(() => { state.alertActive = false; nextAlert(); }, 300);
}

function notifySystem(title, body) {
  try {
    if ("Notification" in window && Notification.permission === "granted" && navigator.serviceWorker?.controller) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.showNotification(title, { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png" }));
    }
  } catch {}
}
async function ensureNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  } catch {}
}

/* =========================================================
   PANTALLA "MIS RECORDATORIOS"
   ========================================================= */
function bindReminders() {
  $("#remindersBtn").addEventListener("click", openReminders);
  $("#emergencyBtn").addEventListener("click", () => {
    if (state.settings.emPhone) location.href = "tel:" + state.settings.emPhone;
  });
  $("#remindersSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    $$("#remindersSeg .seg-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state.remindersTab = b.dataset.tab;
    renderReminders();
  });
}
function openReminders() { pushNav(); resetColor(); renderReminders(); show("reminders"); }

async function renderReminders() {
  const notes = (await Notes.all()).filter((n) => !n.deleted);
  const list = $("#remindersList");
  list.innerHTML = "";
  let rows;
  if (state.remindersTab === "upcoming") {
    rows = notes.filter((n) => n.reminder && !n.reminder.done)
      .sort((a, b) => a.reminder.at - b.reminder.at);
  } else {
    rows = notes.filter((n) => n.done || (n.reminder && n.reminder.done))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  $("#remindersEmpty").hidden = rows.length !== 0;
  $("#remindersEmpty").textContent = state.remindersTab === "upcoming"
    ? "No tienes recordatorios próximos." : "Aún no hay nada hecho.";

  let lastGroup = null;
  rows.forEach((n) => {
    if (state.remindersTab === "upcoming" && n.reminder) {
      const g = dayGroup(n.reminder.at);
      if (g !== lastGroup) {
        lastGroup = g;
        const h = document.createElement("div");
        h.className = "rem-group";
        h.textContent = g;
        list.appendChild(h);
      }
    }
    const meta = SECTIONS[n.section] || SECTIONS.salud;
    const row = document.createElement("div");
    row.className = "rem-row" + (n.done ? " done" : "");
    const over = n.reminder && n.reminder.at < Date.now() && !n.reminder.done;
    const when = n.reminder ? `<span class="rem-time ${over ? "over" : ""}">${n.done ? "Hecho" : humanWhen(n.reminder.at)}</span>` : "";
    row.innerHTML = `<span class="rem-emoji">${n.done ? "✅" : (n.emoji || meta.emoji)}</span>
      <div class="rem-body"><div class="rem-title">${esc(n.title)}</div>${when}</div>
      <button class="rem-play" aria-label="Escuchar">▶️</button>`;
    row.querySelector(".rem-play").addEventListener("click", async (e) => {
      e.stopPropagation();
      const blob = await Audio.get(n.audioId);
      if (blob) playBlob(blob);
    });
    row.addEventListener("click", () => openNoteDetail(n));
    list.appendChild(row);
  });
}

/* =========================================================
   AJUSTES
   ========================================================= */
function bindSettings() {
  $("#settingsBtn").addEventListener("click", openSettings);

  $("#screen-settings").querySelector(".seg").addEventListener("click", async (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    await setSetting("font", b.dataset.font); applyTheme(); markFontButtons();
  });
  $("#setContrast").addEventListener("change", async (e) => {
    await setSetting("contrast", e.target.checked ? "high" : "normal"); applyTheme();
  });
  $("#setHaptics").addEventListener("change", (e) => setSetting("haptics", e.target.checked));
  $("#setVoice").addEventListener("change", (e) => setSetting("voiceConfirm", e.target.checked));
  $("#setAutoplay").addEventListener("change", (e) => setSetting("autoPlay", e.target.checked));
  $("#setPush").addEventListener("change", (e) => togglePush(e.target.checked));
  $("#pushTest").addEventListener("click", testPush);
  $("#setSimple").addEventListener("change", async (e) => {
    await setSetting("simple", e.target.checked);
    haptic();
    toast(e.target.checked ? "😊 Modo súper simple activado" : "Modo normal");
  });
  $("#roleSeg").addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn[data-role]"); if (!b) return;
    changeRole(b.dataset.role);
  });
  $("#setEmName").addEventListener("change", (e) => setSetting("emName", e.target.value.trim()));
  $("#setEmPhone").addEventListener("change", (e) => setSetting("emPhone", e.target.value.trim()));

  $("#exportBtn").addEventListener("click", exportData);
  $("#importBtn").addEventListener("click", importData);
  $("#importFile").addEventListener("change", onImportFile);
  $("#tutorialAgainBtn").addEventListener("click", () => { show("home"); startTutorial(); });
}
async function setSetting(key, value) { state.settings[key] = value; await Settings.set(key, value); }

function openSettings() {
  pushNav(); resetColor();
  const s = state.settings;
  $("#setContrast").checked = s.contrast === "high";
  $("#setHaptics").checked = s.haptics !== false;
  $("#setVoice").checked = s.voiceConfirm !== false;
  $("#setAutoplay").checked = s.autoPlay !== false;
  $("#setSimple").checked = s.simple === true;
  $("#setEmName").value = s.emName || "";
  $("#setEmPhone").value = s.emPhone || "";
  markFontButtons();
  renderSyncBox();
  markRoleButtons();
  refreshPushToggle();
  show("settings");
}
function markRoleButtons() {
  const role = state.settings.role || "owner";
  $$("#roleSeg .seg-btn[data-role]").forEach((b) => b.classList.toggle("active", b.dataset.role === role));
  $("#roleHint").textContent = role === "caregiver"
    ? "Este móvil ayuda a otra persona. Escribe su código en «Copia en la nube» y lo que grabes le llegará a su móvil."
    : "Este móvil es tuyo. Si quieres que un familiar te ayude a distancia, comparte tu código de «Copia en la nube».";
}
async function refreshPushToggle() {
  const el = $("#setPush");
  if (!Push.supported()) { el.checked = false; el.disabled = true; $("#pushTest").hidden = true; $("#pushHint").textContent = "Este navegador no permite avisos en segundo plano. Prueba a instalar la app en el móvil (Chrome en Android, o Safari en iPhone con iOS 16.4 o superior)."; return; }
  el.disabled = false;
  const sub = await Push.isSubscribed();
  el.checked = sub;
  // El botón de prueba solo tiene sentido si los avisos están activos.
  $("#pushTest").hidden = !sub;
}

/* Botón «Probar un aviso»: comprueba la entrega real del push a este móvil. */
async function testPush() {
  const code = state.settings.syncCode;
  if (!code) return toast("Primero activa los avisos en segundo plano");
  haptic();
  toast("Enviando aviso de prueba…");
  const res = await Push.test(code);
  if (res === "ok") {
    toast("✅ Aviso enviado. Debería aparecer en unos segundos.");
  } else if (res === "no_sub") {
    toast("Activa primero los avisos en segundo plano");
    refreshPushToggle();
  } else {
    toast("No se pudo enviar el aviso de prueba");
  }
}
function markFontButtons() {
  $$("#screen-settings .seg-btn[data-font]").forEach((b) =>
    b.classList.toggle("active", b.dataset.font === (state.settings.font || "1")));
}

/* ---- Caja de sincronización ---- */
function renderSyncBox() {
  const box = $("#syncBox");
  const code = state.settings.syncCode;
  if (code) {
    box.innerHTML = `
      <div class="sync-code">${esc(code)}</div>
      <p class="setting-hint">Tu copia está activa. Apunta este código: en otro móvil, instala RecuérdaME y escríbelo para ver tus recordatorios.</p>
      <div class="when-quick">
        <button class="chip" id="syncNow">⬆️ Guardar ahora</button>
        <button class="chip" id="syncPull">⬇️ Traer de la nube</button>
      </div>`;
    $("#syncNow").addEventListener("click", doPush);
    $("#syncPull").addEventListener("click", () => doPull(code));
  } else {
    box.innerHTML = `
      <div class="when-quick">
        <button class="chip" id="syncCreate">☁️ Crear copia en la nube</button>
        <button class="chip" id="syncJoin">🔑 Tengo un código</button>
      </div>`;
    $("#syncCreate").addEventListener("click", createSync);
    $("#syncJoin").addEventListener("click", joinSync);
  }
}
async function createSync() {
  if (!navigator.onLine) return toast("Sin conexión a internet");
  toast("Creando copia…");
  try {
    const code = await Sync.pair();
    await Sync.push(code);
    state.settings.syncCode = code;
    renderSyncBox();
    openDialog({ emoji: "☁️", title: "Copia creada. Tu código es " + code + ". Apúntalo para usarlo en otro móvil.", okText: "Vale", hideCancel: true });
    Voice.speak("Copia creada");
  } catch { toast("No se pudo crear la copia"); }
}
async function doPush() {
  if (!navigator.onLine) return toast("Sin conexión");
  toast("Guardando en la nube…");
  try { await Sync.push(state.settings.syncCode); toast("☁️ Guardado en la nube"); }
  catch { toast("No se pudo guardar"); }
}
async function doPull(code) {
  if (!navigator.onLine) return toast("Sin conexión");
  toast("Trayendo de la nube…");
  try {
    const { added } = await Sync.pull(code);
    await renderHome();
    toast(added ? `⬇️ ${added} recordatorio(s) nuevos` : "Todo al día");
  } catch { toast("No encuentro esa copia"); }
}
function joinSync() {
  openDialog({
    emoji: "🔑", title: "Escribe el código de tu copia", input: true, placeholder: "Ej: 7K2P-9QX",
    okText: "Conectar",
    onOk: async (val) => {
      if (!val) return;
      try {
        const { total } = await Sync.pull(val.toUpperCase().trim());
        state.settings.syncCode = val.toUpperCase().trim();
        await setSetting("syncCode", state.settings.syncCode);
        if (state.settings.push) await Push.enable(state.settings.syncCode, state.settings.role || "owner");
        renderSyncBox(); await renderHome();
        openDialog({ emoji: "✅", title: `Conectado. Tienes ${total} recordatorio(s).`, okText: "Vale", hideCancel: true });
      } catch { toast("No encuentro esa copia"); }
    },
  });
}
let syncTimer = null;
function autoSync() {
  if (!state.settings.syncCode || !navigator.onLine) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => Sync.push(state.settings.syncCode).catch(() => {}), 2500);
}

/* Trae cambios de la nube y refresca la pantalla (modo familia / varios móviles). */
let pulling = false;
async function autoPull() {
  if (pulling || !state.settings.syncCode || !navigator.onLine) return;
  pulling = true;
  try {
    const { added } = await Sync.pull(state.settings.syncCode);
    if (added) {
      scheduleAll();
      await renderHome();
      if (state.screen === "section") renderSection();
      if (state.screen === "reminders") renderReminders();
    }
  } catch {} finally { pulling = false; }
}

/* Asegura que existe un código de espacio (lo crea si hace falta). */
async function ensureSyncCode() {
  if (state.settings.syncCode) return state.settings.syncCode;
  if (!navigator.onLine) return null;
  const code = await Sync.pair();
  await Sync.push(code);
  state.settings.syncCode = code;
  await setSetting("syncCode", code);
  renderSyncBox();
  return code;
}

/* Interruptor de avisos en segundo plano (Web Push). */
async function togglePush(on) {
  const el = $("#setPush");
  if (!on) {
    await Push.disable(state.settings.syncCode);
    await setSetting("push", false);
    $("#pushTest").hidden = true;
    toast("🔕 Avisos en segundo plano desactivados");
    return;
  }
  if (!Push.supported()) { el.checked = false; return; }
  toast("Activando avisos…");
  let code;
  try { code = await ensureSyncCode(); } catch { code = null; }
  if (!code) { el.checked = false; return toast("Necesito conexión para activar los avisos"); }
  const res = await Push.enable(code, state.settings.role || "owner");
  if (res === "ok") {
    await setSetting("push", true);
    $("#pushTest").hidden = false;
    toast("🔔 Listo: te avisaré aunque la app esté cerrada");
    speakConfirm("Avisos activados");
  } else if (res === "denied") {
    el.checked = false;
    openDialog({ emoji: "🔔", title: "Para recibir avisos, tu navegador debe permitir las notificaciones. Búscalo en los ajustes del navegador y actívalas.", okText: "Entendido", hideCancel: true });
  } else {
    el.checked = false;
    toast("No se pudieron activar los avisos");
  }
}

/* Cambio de rol (mío / cuido a alguien). */
async function changeRole(role) {
  if (role === state.settings.role) return;
  await setSetting("role", role);
  markRoleButtons();
  haptic();
  if (role === "caregiver" && !state.settings.syncCode) {
    openDialog({
      emoji: "👨‍👩‍👧", title: "Escribe el código de la persona a la que vas a ayudar",
      input: true, placeholder: "Ej: 7K2P-9QX", okText: "Conectar",
      onOk: async (val) => {
        if (!val) return;
        try {
          const code = val.toUpperCase().trim();
          const { total } = await Sync.pull(code);
          state.settings.syncCode = code;
          await setSetting("syncCode", code);
          renderSyncBox();
          if (state.settings.push) await Push.enable(code, "caregiver");
          await renderHome();
          openDialog({ emoji: "✅", title: `Conectado. Tu familiar tiene ${total} recordatorio(s). Lo que grabes le llegará.`, okText: "Vale", hideCancel: true });
        } catch { toast("No encuentro esa persona. Revisa el código."); }
      },
    });
  } else if (state.settings.push && state.settings.syncCode) {
    await Push.refresh(state.settings.syncCode, role);
  }
  await renderHome();
  toast(role === "caregiver" ? "👨‍👩‍👧 Modo familiar activado" : "✅ Este móvil vuelve a ser el tuyo");
}

async function exportData() {
  toast("Preparando copia…");
  const notes = await Notes.all();
  const subs = await Subs.all();
  const audios = {};
  for (const n of notes) {
    if (n.audioId && !audios[n.audioId]) {
      const blob = await Audio.get(n.audioId);
      if (blob) audios[n.audioId] = await blobToDataURL(blob);
    }
  }
  const data = { app: "RecuérdaME", version: 1, exportadoEl: new Date().toISOString(), notas: notes, subs, audios };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `recuerdame-copia-${stamp}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("💾 Copia guardada (" + notes.length + " recordatorios)");
}

function importData() { $("#importFile").click(); }
async function onImportFile(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast("Ese archivo no es una copia válida"); }
  if (!data || !Array.isArray(data.notas)) return toast("Ese archivo no es una copia válida");
  let n = 0;
  // audios
  const audios = data.audios || {};
  for (const [id, dataUrl] of Object.entries(audios)) {
    try { if (!(await Audio.get(id))) await Audio.put(id, await (await fetch(dataUrl)).blob()); } catch {}
  }
  // subcategorías
  for (const s of (data.subs || [])) { try { await Subs.put(s); } catch {} }
  // notas (gana la más reciente)
  const local = new Map((await Notes.all()).map((x) => [x.id, x]));
  for (const note of data.notas) {
    const ex = local.get(note.id);
    if (!ex || (note.updatedAt || 0) >= (ex.updatedAt || 0)) { await Notes.put(note); if (!ex) n++; }
  }
  await renderHome(); scheduleAll(); renderSyncBox();
  speakConfirm("Copia restaurada");
  openDialog({ emoji: "✅", title: `Copia restaurada. ${n} recordatorio(s) añadidos.`, okText: "Vale", hideCancel: true });
}

function blobToDataURL(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

/* =========================================================
   TUTORIAL
   ========================================================= */
const TUTO = [
  { emoji: "👋", title: "¡Hola!", text: "Esto es RecuérdaME. Te ayuda a no olvidar nada usando tu propia voz." },
  { emoji: "🔴", title: "Graba con tu voz", text: "Entra en un apartado y pulsa el botón rojo grande. Di lo que quieras recordar." },
  { emoji: "🔔", title: "Te avisamos", text: "Elige cuándo quieres el aviso. A esa hora sonará tu propia voz." },
  { emoji: "⚙️", title: "A tu gusto", text: "En Ajustes puedes hacer la letra más grande y poner alto contraste." },
];
let tutoIdx = 0;
function startTutorial() {
  tutoIdx = 0;
  $("#tutorial").hidden = false;
  renderTuto();
  $("#tutoNext").onclick = () => { tutoIdx++; if (tutoIdx >= TUTO.length) endTutorial(); else renderTuto(); };
  $("#tutoSkip").onclick = endTutorial;
}
function renderTuto() {
  const t = TUTO[tutoIdx];
  $("#tutoEmoji").textContent = t.emoji;
  $("#tutoTitle").textContent = t.title;
  $("#tutoText").textContent = t.text;
  const dots = $("#tutoDots"); dots.innerHTML = "";
  TUTO.forEach((_, i) => { const s = document.createElement("span"); if (i === tutoIdx) s.className = "on"; dots.appendChild(s); });
  $("#tutoNext").textContent = tutoIdx === TUTO.length - 1 ? "¡Empezar! ✅" : "Siguiente ▶️";
  Voice.speak(t.title + ". " + t.text);
}
async function endTutorial() {
  $("#tutorial").hidden = true;
  Voice.stop();
  await setSetting("tutorialDone", true);
  // Buen momento (gesto del usuario) para pedir permiso de avisos.
  ensureNotificationPermission();
}

/* =========================================================
   DIÁLOGOS Y TOASTS
   ========================================================= */
function bindDialog() {
  $("#dialog").addEventListener("click", (e) => { if (e.target.id === "dialog") closeDialog(); });
}
let dialogOnOk = null;
function openDialog({ emoji = "❓", title, okText = "Sí", cancelText = "No", input = false, placeholder = "", hideCancel = false, onOk = null }) {
  $("#dialogEmoji").textContent = emoji;
  $("#dialogTitle").textContent = title;
  const inp = $("#dialogInput");
  inp.hidden = !input; inp.value = ""; inp.placeholder = placeholder;
  $("#dialogEmojis").hidden = true;
  $("#dialogOk").textContent = okText;
  $("#dialogCancel").textContent = cancelText;
  $("#dialogCancel").style.display = hideCancel ? "none" : "";
  dialogOnOk = onOk;
  $("#dialog").hidden = false;
  if (input) setTimeout(() => inp.focus(), 50);
  $("#dialogOk").onclick = () => { const v = inp.value; closeDialog(); dialogOnOk && dialogOnOk(input ? v : true); };
  $("#dialogCancel").onclick = closeDialog;
}
function closeDialog() { $("#dialog").hidden = true; dialogOnOk = null; }

// Diálogo con HTML a medida (detalle de nota, etc.)
function openCustomDialog(innerHTML, setup) {
  const card = $("#dialog").querySelector(".dialog-card");
  const prev = card.innerHTML;
  card.innerHTML = innerHTML;
  $("#dialog").hidden = false;
  const onBg = (e) => { if (e.target.id === "dialog") close(); };
  const close = () => {
    $("#dialog").hidden = true;
    $("#dialog").removeEventListener("click", onBg);
    card.innerHTML = prev;
  };
  $("#dialog").addEventListener("click", onBg);
  setup(card, close);
}

/* ---- Subcategorías ---- */
function addSubFlow() {
  const EMOJIS = ["⭐", "🧑‍🤝‍🧑", "👶", "✈️", "🛒", "🐕", "🎵", "📖", "💊", "🍽️", "⚽", "🌳", "🎂", "💻", "🙏", "💰"];
  let sel = EMOJIS[0];
  const html = `
    <span class="dialog-emoji">➕</span>
    <h2 class="dialog-title">Nuevo apartado</h2>
    <div class="dialog-emojis" style="display:flex">${EMOJIS.map((e, i) =>
      `<button data-e="${e}" class="${i === 0 ? "sel" : ""}">${e}</button>`).join("")}</div>
    <div class="title-row" style="margin-top:.6rem">
      <input class="title-input" id="subName" placeholder="Nombre (ej: Nietos)" />
      <button class="mic-btn" id="subMic">🎤</button>
    </div>
    <div class="dialog-actions">
      <button class="cancel-btn" id="subCancel">Cancelar</button>
      <button class="save-btn" id="subSave">Crear</button>
    </div>`;
  openCustomDialog(html, (root, close) => {
    root.querySelectorAll(".dialog-emojis button").forEach((b) =>
      b.addEventListener("click", () => {
        root.querySelectorAll(".dialog-emojis button").forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel"); sel = b.dataset.e;
      }));
    root.querySelector("#subMic").addEventListener("click", () => {
      Dictation.listen({ onResult: (t) => (root.querySelector("#subName").value = t) });
    });
    root.querySelector("#subCancel").addEventListener("click", close);
    root.querySelector("#subSave").addEventListener("click", async () => {
      const name = (root.querySelector("#subName").value || "").trim();
      if (!name) return;
      await Subs.put({ id: uid(), name, emoji: sel, createdAt: Date.now() });
      close(); renderSubs();
    });
  });
}
function askDeleteSub(s) {
  openDialog({
    emoji: s.emoji, title: `¿Borrar el apartado "${s.name}"?`, okText: "Sí, borrar", cancelText: "No",
    onOk: async () => { await Subs.remove(s.id); renderSubs(); },
  });
}

/* ---- Toast con deshacer ---- */
let toastTimer = null;
function toast(text, { actionText, onAction, onGone, ms = 4000 } = {}) {
  const el = $("#toast");
  $("#toastText").textContent = text;
  const btn = $("#toastAction");
  clearTimeout(toastTimer);
  if (actionText) {
    btn.hidden = false; btn.textContent = actionText;
    btn.onclick = () => { clearTimeout(toastTimer); el.hidden = true; onAction && onAction(); };
  } else btn.hidden = true;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; onGone && onGone(); }, ms);
}

/* =========================================================
   EVENTOS GLOBALES + UTILIDADES
   ========================================================= */
function bindGlobal() {
  $("#backBtn").addEventListener("click", goBack);
  $("#brand").addEventListener("click", () => { if (state.screen !== "home") goHome(); });
  $$(".tile[data-section]").forEach((t) =>
    t.addEventListener("click", () => {
      const s = t.dataset.section;
      if (s === "otros") openOtros(); else openSection(s);
    }));
  $("#simpleRecord").addEventListener("click", () => openSection("otros"));
  $("#addSubBtn").addEventListener("click", addSubFlow);
  $("#reminderAlert").addEventListener("click", (e) => { if (e.target.id === "reminderAlert") { /* no cerrar por fuera */ } });
}

function haptic(pattern = 20) {
  if (state.settings?.haptics !== false && navigator.vibrate) { try { navigator.vibrate(pattern); } catch {} }
}
function speakConfirm(text) {
  if (state.settings?.voiceConfirm !== false) Voice.speak(text);
}
function esc(s) { return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function dayGroup(ts) {
  const now = new Date();
  const d = new Date(ts);
  if (ts < Date.now()) return "⏰ Pasados";
  if (d.toDateString() === now.toDateString()) return "Hoy";
  const tom = new Date(now); tom.setDate(now.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return "Mañana";
  if (ts - Date.now() < 7 * 24 * 3600 * 1000) return "Esta semana";
  return "Más adelante";
}
function toDateInput(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function toTimeInput(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function pad(n) { return String(n).padStart(2, "0"); }

function registerSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data?.type === "open-note" && e.data.noteId) openNoteById(e.data.noteId);
    });
  }
}
async function openNoteById(id) {
  let n = await Notes.get(id);
  // Si llega un aviso de una nota que aún no tenemos (p. ej. la añadió un
  // familiar), la traemos de la nube antes de mostrarla.
  if (!n && state.settings.syncCode && navigator.onLine) {
    try { await Sync.pull(state.settings.syncCode); n = await Notes.get(id); } catch {}
  }
  if (n && !n.deleted) { enqueueAlert(n); if (!state.alertActive) nextAlert(); }
}

init();
