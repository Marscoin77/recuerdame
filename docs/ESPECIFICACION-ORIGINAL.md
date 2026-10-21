# RecuérdaME — CLAUDE.md

> App de audio-recordatorios para personas mayores (+60 años)  
> Estado: prototipo web funcional → objetivo: app nativa React Native + Expo

---

## 1. Concepto central

App **extremadamente simple** diseñada para personas mayores que tienen dificultad para ver o manejar el móvil. El flujo principal es:

1. **Pulsar un botón grande** → grabar audio con tu propia voz
2. Decir el título por voz (SpeechRecognition) o escribirlo
3. Elegir cuándo te queremos avisar
4. A la hora programada → **suena tu propio audio** como recordatorio

La app sustituye notas escritas, listas de papel y recordatorios que se olvidan.

---

## 2. Estado actual del prototipo web

- **Artifact publicado:** https://claude.ai/artifact/PrA4BEPLgvMTKjMt6eWaf6 (versión 2)
- **Stack web:** HTML/CSS/JS puro + Claude `db` capability para persistencia
- **4 secciones:** Salud 🏥 · Casa 🏠 · Ocio y Actividades 🎭 · Otros ⭐
- **Funcionalidades implementadas:**
  - Grabación de audio (MediaRecorder API)
  - Dictado de título por voz (SpeechRecognition, `es-ES`)
  - Notas guardadas como cuadros grandes (grid 2 columnas)
  - Recordatorios con `setTimeout` + Notification API
  - Sección "Otros" con subcategorías personalizables (emoji + nombre por voz)
  - Reproductor de audio integrado en cada nota
  - Persistencia en `localStorage` + fallback a Claude `db`

---

## 3. Diseño actual

### Principios de diseño
- **Iconos enormes** en el centro de pantalla (no en barra inferior)
- Botones mínimo 90×90px, idealmente 120–140px
- Tipografía grande (mínimo 1rem en etiquetas, 1.4rem en títulos)
- Colores con alto contraste, un color por sección
- Cuadrados de notas 1:1 aspect-ratio, tan grandes como sea posible (grid 2 cols)

### Paleta de colores
| Sección   | Color principal | Fondo claro |
|-----------|----------------|-------------|
| Salud     | `#1E7A3C`       | `#E4F4EB`   |
| Casa      | `#C05800`       | `#FDEEDE`   |
| Ocio      | `#7B2D9A`       | `#F2E5FB`   |
| Otros     | `#1558A8`       | `#E3EDFC`   |
| Grabar    | `#C41A1A`       | `#FDEAEA`   |

### Estructura de pantallas
```
[TOPBAR: logo + título + botón volver]
[TABS: 4 pestañas con icono + etiqueta]
─────────────────────────────────────
INICIO → 4 cuadros grandes (home-grid 2×2)
  ↓ tap
SECCIÓN → botón grabar grande arriba
          + formulario título (voz o teclado)
          + fecha/hora recordatorio
          + grid de notas guardadas (cuadros 2 col)

OTROS → grid de subcategorías personalizables
  ↓ tap categoría
OTROS/SUBCATEGORÍA → igual que sección normal
```

---

## 4. Roadmap: App Nativa (React Native + Expo)

### Stack recomendado
- **React Native** con **Expo SDK** (managed workflow)
- `expo-av` → grabación y reproducción de audio
- `expo-notifications` → notificaciones push en segundo plano (clave para recordatorios)
- `expo-speech` → síntesis de voz (leer recordatorios en voz alta)
- `expo-contacts` → acceso a agenda para pestaña Familia
- `@react-native-async-storage/async-storage` → persistencia local
- **Supabase** o **Firebase** → sincronización en la nube (opcional, para multi-dispositivo)

### Por qué nativo vs web
| Feature | Web (actual) | Nativa |
|---------|-------------|--------|
| Notificaciones en segundo plano | ❌ Solo si app abierta | ✅ Siempre |
| Audio al bloquear pantalla | ❌ | ✅ |
| Acceso a contactos | ❌ | ✅ |
| WhatsApp intent/share | ❌ | ✅ Android directo |
| Publicar en App Store/Play | ❌ | ✅ |
| Instalable en pantalla inicio | PWA limitada | ✅ Nativa |

---

## 5. Pestaña Familia (WhatsApp) — diseño pendiente

### Limitaciones técnicas importantes
- **WhatsApp NO tiene API oficial** para envíos automáticos sin interacción
- En **Android**: `Intent` abre WhatsApp con contacto y mensaje pre-escrito → un toque para enviar
- En **iOS**: Share Sheet abre WhatsApp con el audio adjunto → un toque para enviar
- Para **envío 100% automático** se necesitaría WhatsApp Business API (de pago, ~50-100€/mes)

### Flujo propuesto (app nativa)
1. Pestaña 🧑‍🤝‍🧑 **Familia** en la app
2. Lista de contactos favoritos con foto grande (de la agenda del móvil)
3. Para cada contacto: grabar audio + programar cuándo enviarlo
4. A la hora programada → notificación push → un toque → abre WhatsApp con el audio listo
5. Otro toque para confirmar envío

### Alternativa futura
- Usar **Twilio** o **360dialog** (WhatsApp Business API) para envío 100% automático
- Precio: desde ~0.05€/mensaje + suscripción mensual

---

## 6. Ideas de mejora visual y UX

### Alta prioridad
- [ ] **Modo alto contraste** (toggle en settings) — fondo negro, texto blanco, bordes muy gruesos
- [ ] **Tamaño de fuente ajustable** — slider en ajustes: Normal / Grande / Muy grande
- [ ] **Vibración al pulsar** botones importantes (haptic feedback en nativa)
- [ ] **Confirmación por audio** al guardar una nota ("Tu nota se ha guardado")
- [ ] **Reproducción automática** del audio del recordatorio al abrir la notificación

### Mejoras de usabilidad
- [ ] **Tutorial de bienvenida** con voz — guía paso a paso la primera vez
- [ ] **Botón de pánico/emergencias** configurable (llamar a familiar directo)
- [ ] **Notas recurrentes** — "todos los lunes", "cada mes"
- [ ] **Búsqueda por voz** dentro de las notas guardadas
- [ ] **Vista lista** alternativa a los cuadros (para quien prefiere ver más notas)
- [ ] **Editar nota** sin borrar — re-grabar audio manteniendo fecha/título

### Mejoras de recordatorios
- [ ] **Recordatorio previo** — avisar 30 min antes del evento además de en el momento
- [ ] **Repetir recordatorio** si no se confirma (cada 5 min hasta 3 veces)
- [ ] **Historial** de recordatorios pasados con marca "cumplido"
- [ ] **Vista semanal/mensual** de todos los recordatorios (tipo calendario simple)

### Ideas de monetización / mercado
- [ ] **Versión gratuita**: 10 notas guardadas, sin sincronización
- [ ] **Versión Premium** (~2.99€/mes): notas ilimitadas, sincronización multi-dispositivo, recordatorios recurrentes
- [ ] **Versión Familia** (~4.99€/mes): permite a familiares ver y añadir notas para el mayor (cuidadores)
- [ ] **Público objetivo secundario**: personas con deterioro cognitivo leve (Alzheimer inicial) — diferenciador fuerte en tiendas
- [ ] **Canales de distribución**: residencias de mayores, asociaciones de alzheimer, médicos de familia, farmacias

### Nombre y marca
- **RecuérdaME** — nombre ya elegido, funciona bien en español
- Icono de app: micrófono grande con corazón o persona mayor
- Slogan: *"Tu voz, tu memoria"* o *"Recuerda con tu propia voz"*
- Colores de marca: verde salud como color primario de la app

---

## 7. Arquitectura técnica (nativa)

```
recuerdame/
├── app/
│   ├── (tabs)/
│   │   ├── salud.tsx
│   │   ├── casa.tsx
│   │   ├── ocio.tsx
│   │   ├── otros.tsx
│   │   └── familia.tsx       ← nuevo
│   └── _layout.tsx
├── components/
│   ├── BigRecordButton.tsx    ← botón grabar reutilizable
│   ├── NoteCard.tsx           ← cuadro de nota
│   ├── HomeGrid.tsx           ← 4 cuadros de inicio
│   ├── SaveForm.tsx           ← formulario título + fecha
│   └── ContactCard.tsx        ← para pestaña familia
├── hooks/
│   ├── useAudioRecorder.ts
│   ├── useReminders.ts
│   └── useContacts.ts
├── store/
│   └── notesStore.ts          ← Zustand o Context
└── utils/
    ├── whatsapp.ts            ← deep link builder
    └── notifications.ts
```

---

## 8. Próximos pasos concretos

1. **Decidir plataforma inicial**: ¿solo Android primero, o iOS también? (iOS requiere Mac para publicar)
2. **Inicializar Expo**: `npx create-expo-app recuerdame --template`
3. **Migrar lógica web → nativa**: grabación, notas, recordatorios
4. **Implementar pestaña Familia** con contactos de la agenda
5. **Beta testing** con personas reales +60 años para ajustar tamaños y flujos
6. **Publicar en Google Play** primero (más rápido y barato que App Store)

---

*Generado en sesión Claude — octubre 2026*
