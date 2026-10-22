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
- **Avisos en segundo plano** (Web Push): llegan a su hora **aunque la app esté cerrada**, enviados desde el servidor (Cloudflare Cron).
- **Modo cuidador / familia**: un familiar puede, desde su móvil, **añadir recordatorios a distancia** a la persona mayor (mismo código de la nube). Si un recordatorio marcado como **importante** no se confirma, el familiar recibe un aviso.
- **Mis recordatorios**: lista de próximos y de hechos.
- Pensado para +55: **letra ajustable** (Normal/Grande/Enorme), **alto contraste**, **vibración**, **confirmación por voz**, **tutorial hablado**, **deshacer** al borrar y **botón de llamada rápida a la familia**.
- **Funciona sin conexión** (PWA instalable en la pantalla de inicio).
- **Copia en la nube** opcional (multi-dispositivo) mediante un código, con **sincronización automática** y **fusión sin pérdida de datos** (gana la versión más reciente de cada nota; los borrados se propagan con *tombstones*).

## Tecnología

- **Front**: PWA en HTML/CSS/JS puro (sin framework), módulos ES. IndexedDB para notas y audios. Service Worker para uso sin conexión, instalación y recepción de push.
- **APIs del navegador**: MediaRecorder (grabación), SpeechRecognition (dictado), SpeechSynthesis (voz), Notifications + TimestampTrigger (avisos locales), Push API + VAPID (avisos en segundo plano), Vibration (háptica).
- **Backend/infra**: **Cloudflare Workers** (sirve la PWA + API de sincronización + envío de push), **Workers KV** (metadatos, audios y suscripciones push) y **Cron Trigger** (cada minuto, dispara los avisos vencidos).
- **Web Push sin dependencias**: el cifrado del contenido (`aes128gcm`, RFC 8188/8291) y la firma VAPID (JWT ES256, RFC 8292) están implementados con la Web Crypto API en `worker/push.js` (no hace falta ninguna librería de npm).

## Estructura

```
public/            La PWA (lo que se sirve al navegador)
  index.html
  css/styles.css
  js/{app,db,audio,speech,reminders,sync}.js
  sw.js  manifest.webmanifest  icons/
  js/{app,db,audio,speech,reminders,sync,push}.js
worker/
  index.js         Worker: sirve assets + API /api/* + Cron (avisos push)
  push.js          Web Push (cifrado aes128gcm + VAPID) con Web Crypto
wrangler.toml      Config de Cloudflare (Worker + KV + assets + Cron + VAPID)
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

Recursos ya creados en la cuenta de Cloudflare: Worker `recuerdame`, KV `AUDIO_KV` y Cron Trigger (`* * * * *`).

**Claves de Web Push (VAPID).** La pública y el responsable van en `wrangler.toml`
(`[vars] VAPID_PUBLIC`, `VAPID_SUBJECT`). La privada se guarda como secreto —
nunca en el repo:

```bash
wrangler secret put VAPID_PRIVATE_JWK   # pega el JWK privado (EC P-256)
```

Para generar un par nuevo: `node -e` con `crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"])`, exportando la pública en `raw` (base64url) y la privada en `jwk`.

## Sincronización (cómo funciona)

En Ajustes → "Copia en la nube" → **Crear copia** genera un código (p. ej. `7K2P-9QX`). Ese móvil sube sus recordatorios y audios a la nube. En otro dispositivo, "Tengo un código" descarga todo. Gana siempre la versión más reciente de cada nota.

> Nota de privacidad: el código es la única llave de acceso a esa copia. Es suficiente para uso personal, pero no es cifrado de extremo a extremo. Ver el informe para mejoras previstas.

## Limitaciones conocidas (web vs. app nativa)

- Los **avisos en segundo plano** usan ahora **Web Push** desde el servidor (Cron de Cloudflare). Para que lleguen con la app cerrada hay que **activarlos** en Ajustes y, en iPhone, tener la app **instalada** en la pantalla de inicio (requiere iOS 16.4+). En escritorio y Android funcionan con el navegador instalado.
- El dictado y la voz dependen del navegador (mejor en Chrome/Edge).
- La sincronización en la nube no es cifrado de extremo a extremo: el código es la llave de acceso a la copia.

## Estado y pruebas

Verificado con pruebas automáticas (Playwright, micrófono simulado) y tests de criptografía:

- **Chromium**: flujo completo (grabar → título → aviso → guardar), **el aviso salta a su hora** y reproduce el audio, "Hecho" lo archiva, copia y restauración, y **funcionamiento sin conexión**.
- **WebKit (motor de Safari/iPhone) y Firefox**: carga, navegación, cambio de fuente y **modo familiar** (rol + banner) sin errores.
- **Accesibilidad**: auditoría axe-core (WCAG 2.0/2.1 AA) con **0 violaciones**, incluidos los ajustes nuevos y el modo alto contraste.
- **Web Push (servidor)**: test de ida y vuelta del cifrado `aes128gcm` (se descifra el mensaje original) y verificación de la firma VAPID ES256; y una prueba end-to-end de la lógica del Cron (simula KV, intercepta el envío, **descifra el push** y comprueba que llega al destinatario correcto —mayor vs. familiar— y que **no se duplica**).
- **Sincronización**: comprobado en vivo que el *merge* del servidor **no borra** notas de otro dispositivo al subir una lista parcial.

> El único eslabón que no puede probarse sin un teléfono real es la **entrega final** del push a través del servicio de Google/Mozilla hasta el dispositivo; se confirma instalando la app y activando los avisos.

## Licencia

MIT.
