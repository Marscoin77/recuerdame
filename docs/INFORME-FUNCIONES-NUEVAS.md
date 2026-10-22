# RecuérdaME — Avisos en segundo plano + Modo familia 🌙

*22 de octubre de 2026. Me pediste ir "a full" con las opciones 1 y 2. Hecho.*

Resumen en una línea: **la app ya puede avisar aunque esté cerrada, y un familiar puede ayudar a distancia.** Todo desplegado, en tu GitHub y probado hasta donde se puede sin un móvil delante.

- 📱 App: **https://recuerdame.adriagimenez238.workers.dev**
- 💾 Código: https://github.com/Marscoin77/recuerdame

---

## 1. Avisos aunque la app esté cerrada (opción 1, camino A: Web Push)

Antes, el aviso solo era 100% fiable con la app abierta o usada hace poco. Ahora **el servidor envía el aviso a su hora** aunque la app lleve días cerrada.

Cómo funciona por dentro (por si te interesa): monté el envío de avisos "push" **sin ninguna librería externa**, con la criptografía oficial (cifrado del mensaje y firma de seguridad VAPID) hecha a mano sobre Cloudflare. Un **reloj automático (Cron) revisa cada minuto** tus recordatorios y manda el aviso al móvil en el momento justo. Incluye el **aviso previo de 30 minutos**.

**Para activarlo (importante):**
1. Abre la app en el móvil e **instálala** en la pantalla de inicio.
   - iPhone: necesita iOS 16.4 o superior y tenerla instalada.
2. Entra en **Ajustes → "Avisarme aunque la app esté cerrada"** y enciende el interruptor.
3. Acepta el permiso de notificaciones cuando lo pida.

A partir de ahí, aunque cierres la app, el aviso llegará solo.

## 2. Modo cuidador / familia (opción 2)

Ahora un familiar (p. ej. una hija o un hijo) puede **ayudar a distancia**:

- En **Ajustes → Familia**, el familiar elige **"Cuido a alguien"** y escribe el **código** de la persona mayor (el mismo de "Copia en la nube").
- Lo que el familiar grabe o programe **le aparece solo en el móvil del mayor** (se sincroniza automáticamente, sin pulsar nada).
- Al guardar un recordatorio puedes marcarlo como **⚠️ "Importante: avisar a mi familia si no lo confirmo"**. Si el mayor no lo confirma pasados unos minutos, **el familiar recibe un aviso**.

También mejoré la seguridad de los datos: al sincronizar ya **no se pierden recordatorios** aunque dos móviles suban cosas distintas, y cuando borras algo, el borrado también se sincroniza (antes podía "reaparecer").

---

## 3. Cómo lo he comprobado (con honestidad)

- ✅ **Criptografía del push**: test que cifra un mensaje y lo vuelve a descifrar igual, y que verifica la firma de seguridad. 9/9 correcto.
- ✅ **El "cartero" automático (Cron)**: prueba completa simulando el servidor — **descifra el aviso** y confirma que el principal y el previo van al mayor, el de "sin confirmar" va al familiar, no se disparan avisos viejos y **no se duplican**. 15/15 correcto.
- ✅ **En vivo**: los nuevos enlaces del servidor responden y la sincronización **no borra** datos de otro móvil.
- ✅ **Safari (iPhone), Firefox y Chrome**: la app, el cambio de letra y el modo familiar funcionan sin errores.
- ✅ **Accesibilidad** (WCAG AA): 0 problemas, también en los ajustes nuevos.
- ✅ El recordatorio normal sigue saltando a su hora y archivándose.

**Lo único que no puedo probar yo**: la **entrega final** del aviso a través de Google/Apple hasta tu teléfono. Eso se confirma en 1 minuto instalando la app y activando los avisos (punto 1). Si al hacerlo no te llega, dímelo y lo afino.

---

## 4. Añadido después, en modo automático (ya hecho ✅)

Dos de los detalles que tenía apuntados, dentro de la línea de "simple para mayores":

- **🔔 Botón "Probar un aviso"** (Ajustes, cuando los avisos están activos): manda un aviso real a tu móvil al instante. Sirve para **comprobar en 1 minuto que las notificaciones llegan de verdad** — justo el único punto que yo no podía verificar sin un teléfono delante. Pulsas y debería aparecer el aviso en unos segundos.
- **😊 Modo súper simple** (Ajustes): la pantalla de inicio pasa a mostrar **un único botón enorme "Grabar un recordatorio"**, sin los 4 apartados. Para quien le cuesta elegir. "Mis recordatorios" y la llamada a la familia siguen ahí. Se activa y desactiva cuando quieras.

Ambas probadas (test de extremo a extremo + accesibilidad AA, 0 problemas), desplegadas y en GitHub.

## 5. Lo que queda (tu decisión)

- **Foto opcional en el recordatorio**: útil (p. ej. foto de la pastilla o de la persona a la que llamar), pero es lo único que añade algo de complejidad (hacer la foto, guardarla y sincronizarla). **No la he metido a propósito**, para no complicar la app sin tu visto bueno. Si la quieres, la hago.
- **Opción B (app nativa Android, Google Play)**: sigue siendo el gran salto para avisos 100% garantizados con pantalla bloqueada. Necesita cuenta de desarrollador de Google (25 € una vez). Dime si arrancamos.
- **Dominio propio** (p. ej. *recuerdame.app*): si quieres, lo preparo con Cloudflare.

Cuando quieras, seguimos. 🎙️❤️
