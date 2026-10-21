# RecuérdaME 🎙️❤️

**Recordatorios con tu propia voz, para personas mayores (+55).**

App web (PWA) extremadamente sencilla: pulsas un botón grande, grabas con tu voz lo que quieres recordar, eliges cuándo avisarte y a esa hora **suena tu propia voz**. Pensada para quien tiene dificultad para ver o manejar el móvil.

🔗 **En vivo:** https://recuerdame.adriagimenez238.workers.dev

---

## Qué hace

- **Grabar con la voz** — botón rojo enorme, grabación con un toque.
- **Dictar el título** por voz (o escribirlo).
- **4 apartados**: Salud 🏥 · Casa 🏠 · Ocio 🎭 · Otros ⭐ (con subcategorías propias).
- **Avisos** a la hora elegida: en 1 h, en 3 h, mañana, u otra fecha; **repetición** diaria / semanal / mensual y **aviso previo** 30 min antes.
- A la hora del aviso: **suena tu audio**, vibración y notificación. Botón **Hecho** o **posponer 10 min**.
- **Mis recordatorios**: lista de próximos y de hechos.
- Pensado para +55: **letra ajustable** (Normal/Grande/Enorme), **alto contraste**, **vibración**, **confirmación por voz**, **tutorial hablado**, **deshacer** al borrar y **botón de llamada rápida a la familia**.
- **Funciona sin conexión** (PWA instalable en la pantalla de inicio).
- **Copia en la nube** opcional (multi-dispositivo) mediante un código.

## Tecnología

- **Front**: PWA en HTML/CSS/JS puro (sin framework), módulos ES. IndexedDB para notas y audios. Service Worker para uso sin conexión e instalación.
- **APIs del navegador**: MediaRecorder (grabación), SpeechRecognition (dictado), SpeechSynthesis (voz), Notifications + TimestampTrigger (avisos), Vibration (háptica).
- **Backend/infra**: **Cloudflare Workers** (sirve la PWA + API de sincronización) y **Workers KV** (metadatos de recordatorios y audios).

## Estructura

```
public/            La PWA (lo que se sirve al navegador)
  index.html
  css/styles.css
  js/{app,db,audio,speech,reminders,sync}.js
  sw.js  manifest.webmanifest  icons/
worker/
  index.js         Worker: sirve assets + API /api/*
wrangler.toml      Config de Cloudflare (Worker + KV + assets)
scripts/make-icons.mjs
```

## Desarrollo

```bash
npm install            # solo para generar iconos (sharp)
npm run serve          # servidor estático local en :8080 (sin backend)
npm run dev            # wrangler dev (con D1/KV locales)
```

## Despliegue (Cloudflare)

```bash
npm run deploy         # wrangler deploy → publica Worker + PWA
```

Recursos ya creados en la cuenta de Cloudflare: Worker `recuerdame` y KV `AUDIO_KV`.

## Sincronización (cómo funciona)

En Ajustes → "Copia en la nube" → **Crear copia** genera un código (p. ej. `7K2P-9QX`). Ese móvil sube sus recordatorios y audios a la nube. En otro dispositivo, "Tengo un código" descarga todo. Gana siempre la versión más reciente de cada nota.

> Nota de privacidad: el código es la única llave de acceso a esa copia. Es suficiente para uso personal, pero no es cifrado de extremo a extremo. Ver el informe para mejoras previstas.

## Limitaciones conocidas (web vs. app nativa)

- Los avisos con la app **cerrada** dependen de `TimestampTrigger`, disponible solo en algunos navegadores (Chrome/Edge en Android). Con la app abierta o en segundo plano reciente, funcionan siempre. Para avisos 100% fiables en segundo plano haría falta app nativa o Web Push con servidor.
- El dictado y la voz dependen del navegador (mejor en Chrome/Edge).

## Estado y pruebas

Verificado con pruebas automáticas (Playwright, micrófono simulado):

- **Chromium**: flujo completo (grabar → título → aviso → guardar), **el aviso salta a su hora** y reproduce el audio, "Hecho" lo archiva, copia y restauración, y **funcionamiento sin conexión**.
- **WebKit (motor de Safari/iPhone) y Firefox**: carga y navegación sin errores; degradación correcta donde no hay dictado/grabación.
- **Accesibilidad**: auditoría axe-core (WCAG 2.0/2.1 AA) con **0 violaciones**, incluido el modo alto contraste.

## Licencia

MIT.
