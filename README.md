# test-ASORC — Banco de preguntas LPIC-2

Banco de estudio construido a partir de **todas** las preguntas que aparecen físicamente en
los dos libros de preparación LPIC-2 de este directorio, más una aplicación de terminal en
C++ para practicarlas.

**380 preguntas** extraídas y verificadas:

| Libro | Preguntas | Tipo |
|---|---|---|
| Sybex — *LPIC-2 Study Guide (Exam 201/202), 2nd Ed.* (Bresnahan & Blum) | 270 | 30 assessment test + 240 review questions |
| ENI — *Preparación para la certificación LPIC-2*, 2ª ed. (Bobillier) | 110 | 11 capítulos × 10 preguntas abiertas |

Los recuentos coinciden **exactamente** con las cifras que los propios libros declaran
(«the 240 questions from the review sections», «preguntas/respuestas (110 en total)»).
El detalle sección por sección está en [`extraction_report.md`](extraction_report.md).

## Interfaz web

```bash
./asorc-web          # local, con puente hacia progress.json
```

Arranca un servidor local y abre el navegador. Solo necesita `python3`.

**También funciona sin Python.** Todas las rutas del frontend son relativas, así que la web
se puede publicar como sitio estático (GitHub Pages) y sigue haciendo todo: cargar el banco,
responder, guardar progreso, salir, reanudar y ver estadísticas. Lo único que pierde es el
puente con `progress.json`, que es lo que lee la aplicación de terminal.

### Cómo está montada

```
navegador
   │
   ├── store.js   progreso, estadísticas y sesión a medias
   │     ├── BrowserStore        localStorage · SIEMPRE disponible
   │     ├── LocalServerStore    ./asorc-web · puente con progress.json
   │     └── Cloud (cloud.js)    Supabase · opcional
   │
   ├── dash.js    mapa de temas y métricas de progreso
   ├── logic.js   barajado, corrección, resaltado, troceado  (lógica pura)
   ├── game.js    XP, racha, hitos
   ├── fx.js      sonido y microinteracciones
   ├── burst.js   explicación por fragmentos
   └── app.js     presentación, feed y flujo
```

Los tres adaptadores son independientes: **el frontend funciona aunque los dos últimos no
existan**. Al arrancar se fusiona lo del navegador con lo del servidor local si lo hay, y la
fusión nunca pisa un dato más completo con uno más pobre.

### El panel de estudio

La pantalla de inicio es el mapa del banco: cuánto llevas, qué temas tocaste y qué te falta.

Dos métricas, y no se mezclan:

| | Cómo se calcula |
|---|---|
| **Completado** | preguntas **únicas** vistas ÷ preguntas disponibles. Responder 15 veces la misma pregunta sigue contando como **una** |
| **Acierto** | aciertos ÷ intentos con respuesta. Los blancos cuentan como vista, pero **no** como intento |

Se dice **acertadas**, no «dominadas»: acertar una vez no es dominar.

Cada tema muestra completado, vistas, acierto, falladas y marcadas. Al abrirlo salen cuatro
acciones —**CONTINUAR** (no vistas), **REPASAR FALLOS**, **SOLO MARCADAS**, **TODAS**— y el
tamaño de la ronda (5/10/20/50/todas), sin pantallas intermedias. Los contadores del panel
usan el mismo filtro que el botón, así que lo que promete es lo que sale. Con el `+` de cada
tarjeta se eligen varios temas y **MEZCLAR** crea una ronda combinada.

### Salir y reanudar

Durante una ronda hay un **← SALIR** discreto en la barra. No pregunta nada, porque no se
pierde nada: se guardan el modo, el orden exacto de las preguntas, el índice, el marcador y
el idioma. En el panel aparece **CONTINUAR SESIÓN · 12 / 50** con el tema, y **CONTINUAR**
vuelve al punto exacto sin rebarajar. **DESCARTAR** sí pide confirmación; las respuestas ya
dadas se conservan igualmente, porque se guardan una a una en el momento.

Está pensada como un juego de quiz: **pregunta → decisión → impacto → recompensa →
siguiente**, para que hacer «una más» cueste lo mínimo.

### El bucle

**Responder.** La pantalla es casi toda el reto: enunciado grande y respuestas como tarjetas
grandes con su letra A/B/C. Arriba, un marcador de videojuego: barra de progreso de 11 px con
esquinas redondeadas y tres grupos —🔥 racha, ⚡ XP, y posición más tiempo— con las cifras a
28–34 px y el cronómetro a 33–35 px en peso 800. En portátiles (≤1366 px) y en móvil se
recortan huecos y relleno, nunca los números, que no bajan de 24 px.

**Pantalla completa mientras no respondes.** La pregunta activa ocupa el viewport entero por
debajo del HUD (`min-height: calc(100dvh - var(--hud-h))`) y reparte el alto entre enunciado y
respuestas: nada amontonado arriba ni medio panel vacío abajo. Al contestar se compacta en
~240 ms y pasa a ser historial, con la explicación debajo. En móvil se renuncia al viewport
completo si el contenido necesita scroll.

**El enunciado no se pierde.** Queda pegado bajo el HUD mientras lees esa pregunta, así que
siempre sabes qué te estaban preguntando. Al corregir **no se hace scroll** hacia el veredicto,
la explicación ni el botón: lo único que se recoloca es la tarjeta, y solo si el enunciado se
había quedado por encima de la barra. Las opciones no desaparecen: se ven a la vez el
enunciado, lo que marcaste y cuál era la correcta.

**No hay plazo.** El cronómetro sube (`0s → 1s → 2s…`) y no interrumpe nunca: blanco hasta los
20 s, ámbar a partir de ahí, y a los 40 s un aviso discreto —*¿Atascado? Puedes marcarla con M
y seguir*— que no bloquea ni responde por ti. Una pregunta larga o de varias respuestas no se
contesta a la misma velocidad que «¿qué hace `lsmod`?», y un plazo fijo medía velocidad de
lectura, no conocimiento. El tiempo se sigue midiendo y guardando igual, que es lo que
alimenta los segundos por pregunta y la comparación entre rondas.

**Aprender.** La tarjeta correcta hace *pop* en verde con ✓ y la elegida por error se sacude
en rojo con ✗; al fallar, lo primero que aparece es **Correcta: …**. Debajo, bajo el rótulo
**💡 QUÉ TENÍAS QUE SABER**, la explicación contada en llano (ver más abajo). El botón **SIGUIENTE** domina la pantalla y se queda anclado abajo cuando la
explicación es larga, así que continuar está siempre a un clic. A los 60 s aparece un aviso
para marcarla y seguir, pero **nunca avanza solo**.

### El feed

La sesión es una sola columna que crece hacia abajo: cada pregunta se **añade** debajo de la
anterior y **ninguna se borra**. Al contestar, la corrección y la explicación se quedan fijas
en esa tarjeta y la siguiente pregunta aparece justo debajo, con un desplazamiento suave que
no bloquea el manual. Se puede subir a revisar cualquier pregunta de la sesión; si te alejas
de la activa aparece abajo a la derecha **↓ VOLVER A PREGUNTA ACTUAL**, y mientras estés
arriba leyendo nada te arrastra hacia abajo.

Solo la pregunta activa tiene temporizador, opciones pulsables, animaciones y teclado. Las
anteriores pasan a estado *completada* y se compactan a enunciado, tu respuesta, si acertaste
y la correcta; la explicación queda desplegada en la última y plegada en el resto, con
**▾ explicación** para abrirla o cerrarla. Una tarjeta completada ocupa unos 200 px, así que
100 preguntas son unas 26 pantallas y no 100.

La barra de arriba —racha, XP, posición y tiempo— queda anclada mientras recorres la sesión.

### Resaltado de lo que importa

El enunciado, las opciones, la idea y la frase de memorización pasan por
`highlightTechnicalText()`, que **escapa primero y marca después**, sobre posiciones calculadas
en el texto plano: nunca hace un `replace` sobre HTML, así que ni las rutas ni `<VirtualHost>`
se rompen.

Dos significados visuales, no uno:

| Estilo | Significa | Ejemplo |
|---|---|---|
| **subrayado ámbar** | «lee esto con cuidado» | *Elija todas*, *no es*, *NOT* |
| `monoespaciada con fondo` | «esto hay que reconocerlo» | `sysctl`, `/etc/fstab`, `<VirtualHost>`, `--gzip` |
| **negrita** | tecnología o sustantivo por el que se pregunta | **SSH**, **ServerName**, **kernel**, «¿Qué **comando**…» |

El vocabulario técnico **sale del propio banco** (las opciones de una sola palabra), no de una
lista inventada. Tope de 4 elementos por texto y ~30 % de los caracteres (45 % en la frase de
memorización, que es corta y densa); si algo se pasa, caen primero los de menos prioridad.

Medido sobre las 380: mediana de 2 marcas por enunciado, p90 de 3, nunca más de 4; 11,8 % del
texto marcado de mediana. **El texto nunca se altera** (0 de 380 al comparar ida y vuelta) y el
resaltado **no delata la respuesta**: la media de marcas por opción correcta e incorrecta
difiere en 0,000.

### Las explicaciones, en llano

Las explicaciones de los libros son correctas pero suenan a manual: «el éxito de un módulo
required no provoca la parada del tratamiento de la pila». La web no enseña ese texto de
entrada; enseña la misma idea contada como la contaría alguien de viva voz:

| Bloque | Qué es |
|---|---|
| **Idea** | una frase corta y memorizable arriba del todo (máx. 13 palabras), y una o dos más de apoyo |
| **Piensa en ello como…** | un modelo mental, solo cuando ayuda de verdad (19 de 380) |
| **Las otras** | una línea por distractor, citado por la letra **que estás viendo**, no la del libro |
| **Qué memorizar** | la frase que hay que llevarse, destacada al final |
| **▸ Ver explicación original** | el texto íntegro del libro, siempre a un clic |

Las 380 están escritas a mano en `tools/simple/*.json` y se fusionan en
`explanations_simple.json` con `python3 tools/simple/merge.py`. **`questions.json` no se toca:**
el texto original sigue ahí y es lo que muestra la aplicación de terminal. Si el archivo de
explicaciones no existe, la web enseña el texto del libro y funciona igual.

Salen un **50 % más cortas** de mediana; la primera frase tiene 8 palabras de mediana y la de
memorizar, 7. Con `T` (ver el original en inglés) se vuelve al texto del libro.

### Explicación: modo Ráfaga

Para no encontrarte un párrafo entero de golpe, la explicación se puede leer como subtítulos
de vídeo: **fragmentos semánticos de 4–10 palabras**, uno cada vez, nunca palabra a palabra.
Sobre el fragmento actual quedan los 2–3 anteriores, más pequeños y atenuados, para mirar
atrás sin perder el hilo.

- Arriba, la **idea en una línea** («SSH guarda las huellas de servidores en `~/.ssh/known_hosts`»),
  que es lo único que hay que retener.
- Ritmo inicial de unas 275 palabras/minuto, con `0.75× 1× 1.25× 1.5×` y más tiempo para los
  fragmentos con comandos, rutas o siglas.
- Si la explicación es corta no se anima nada: se muestra y ya.
- **▸ Ver explicación completa del libro** deja el texto original intacto y a mano; al quedar
  la tarjeta atrás, ese texto completo es lo que permanece.
- Se cambia entre **Ráfaga** y **Completa** en los ajustes de inicio, para poder compararlos.

### Progreso

| Elemento | Cómo funciona |
|---|---|
| **XP** | +10 por acierto y 0 si fallas, tardes lo que tardes. Es solo gamificación: no toca la nota |
| **En blanco** | 0 XP, y la racha **se queda como estaba**: no sube, pero tampoco se rompe. No cuenta como fallo |
| **Racha** | sube con cada acierto seguido y gana presencia visual a partir de 5 y de 10; cualquier fallo la rompe |
| **Hitos** | rachas de 5, 10, 15…, las 25/50/100 preguntas, y récord de precisión o de velocidad (contra tu propio histórico, no contra un límite). Celebración corta, nunca bloquea |
| **Barra** | avanza con cada respuesta; siempre se ve cuánto queda |

### Teclado

| Tecla | Acción |
|---|---|
| `A`…`E` o `1`…`5` | responder |
| `0` | dejar en blanco (solo donde esté permitido) |
| `Enter` | confirmar en preguntas de varias respuestas · **siguiente pregunta** |
| `Space` | pausa o reanuda la Ráfaga; si no está en marcha, siguiente |
| `←` `→` | fragmento anterior / siguiente de la Ráfaga |
| `T` | ver el original en inglés **sin cambiar el orden de las opciones** |
| `M` | marcar para repasar |
| `S` | sonido |
| `Esc` | terminar la ronda |

### Sonido

Tonos cortos generados con Web Audio (sin archivos): ascendente al acertar, grave al fallar,
arpegio en los hitos. Volumen bajo, se apaga con `S` o desde el botón de inicio y la
preferencia se recuerda.

### Al terminar

Pantalla de resultado con el marcador grande, el porcentaje, XP, mejor racha y segundos por
pregunta, más la comparación con tu ronda anterior (`↑ 7 % precisión`, `↓ 3,1 s/pregunta`).
Si has fallado, **REPASAR N FALLOS** lanza al momento una ronda solo con esas. El desglose por
tema y la comparación con/sin música quedan plegados en «Ver detalle».

### Dejar en blanco

En el simulacro **ASORC** fallar resta (−0,5) y no contestar no, así que saltar una pregunta es
una decisión legítima. Aparece un botón secundario discreto bajo las opciones, **DEJAR EN
BLANCO**, con la tecla `0`.

- Puntúa **0 XP** y no cuenta como fallo.
- **No rompe la racha:** se queda donde estaba. Tres aciertos, un blanco y otro acierto son
  racha de cuatro.
- Se corrige igual: ves la respuesta correcta y la explicación, que es a lo que se viene.
- Entra en **REPASAR N FALLOS**, que es justo donde interesa volver a verla.
- En las preguntas abiertas no sale, porque ya tienen **NI IDEA** en la autocalificación.

Fuera del simulacro no aparece salvo que lo pidas: el ajuste **Dejar en blanco** de la pantalla
de inicio tiene *Solo ASORC* (por defecto) y *Siempre*, y se recuerda entre sesiones.

> Pendiente: una simulación de examen **sin feedback**, que no enseñe la solución hasta
> terminar la ronda. Hoy todos los modos corrigen al momento.

### Modos

Sprint de 20, Sprint de 50, Solo ASORC, Solo falladas, No vistas, Marcadas, Por tema y Todas.
Las preguntas abiertas quedan fuera salvo que las pidas, porque se autocalifican y rompen el
ritmo.

Los avisos se ajustan con `?ambar=30&atascado=90&repasar=120` en la dirección: cuándo el
cronómetro pasa a ámbar, cuándo sugiere marcarla y seguir, y cuándo avisa de que llevas mucho
en la explicación. Ninguno interrumpe.

### Accesibilidad

Contraste WCAG AA verificado por `tools/test_contrast.py` sobre los colores reales del CSS
(26 parejas, mínimo 4,5:1 en texto normal y 3:1 en texto grande). Acierto y fallo no dependen
solo del color: llevan icono, borde y texto. `prefers-reduced-motion` elimina animaciones y
partículas. Todo es navegable por teclado con foco visible.

### Cómo está organizado

| Archivo | Responsabilidad |
|---|---|
| `web/js/logic.js` | lógica de quiz pura (barajado, mapeo de letras, frase clave, troceado, corrección) |
| `web/js/game.js` | XP, combo, hitos y récords |
| `web/js/fx.js` | sonido y microinteracciones |
| `web/js/burst.js` | reproductor de la explicación por fragmentos |
| `web/js/app.js` | presentación, feed y flujo |
| `web/server.py` | servidor local y puente con los archivos del proyecto |

### Dónde se guarda

| Archivo | Contenido |
|---|---|
| `progress.json` | **compartido con la app de terminal**, mismo esquema: lo que respondes en la web cuenta en «solo falladas» y «no vistas» del terminal, y al revés |
| `web_stats.json` | solo de la web: tiempos por pregunta, marcadas y registro de sesiones |

`questions.json` es la fuente de verdad y la web **nunca lo escribe**. Las métricas propias
van aparte porque la app de terminal reescribe `progress.json` desde su propio modelo y
descartaría cualquier campo que no conozca.

## Publicar en GitHub Pages

```bash
python3 tools/build_site.py          # arma _site/ y avisa si queda alguna ruta absoluta
```

El sitio se monta copiando `web/` a la raíz más `questions.json` y `explanations_simple.json`,
que es donde el frontend los busca. `server.py` no se publica (es el puente local); `config.js`
sí, porque solo lleva valores públicos. El build **aborta** si falta algún archivo que el
navegador necesita, si queda una ruta absoluta o si detecta algo con pinta de secreto.

```bash
python3 tools/test_site.py           # prueba el artefacto servido bajo /asorc-lpic-2/
```

Con `.github/workflows/pages.yml` basta con:

```
git push          →  GitHub Actions  →  GitHub Pages
```

En el repositorio: **Settings → Pages → Source: GitHub Actions**. Funciona bajo subdirectorio
(`https://usuario.github.io/repositorio/`) porque no hay ni una ruta absoluta; el test `[10]`
lo comprueba.

**Dónde se guarda el progreso en Pages:** en el `localStorage` del navegador, bajo las claves
`asorc.v2.progress`, `asorc.v2.stats`, `asorc.v2.session` y `asorc.v2.prefs`. Offline
funciona todo una vez cargada la página.

## Sincronizar entre dispositivos (opcional)

Sin configurar, la web dice discretamente *«Sincronización en la nube desactivada»* y no
molesta más. Para activarla:

1. Crea un proyecto en Supabase y ejecuta `supabase/schema.sql` en su editor SQL.
2. Pon la **URL** y la **anon/publishable key** en `web/config.js` (está versionado a
   propósito: esos dos valores son públicos). `web/config.example.js` queda como plantilla.
3. En la web: **☁ sincronizar** → tu correo → enlace mágico.

**Qué es público y qué no.** La URL y la anon key viajan en el JavaScript: son públicas por
diseño y no protegen nada. Quien protege los datos es **Supabase Auth + RLS**: cada tabla
tiene políticas `auth.uid() = user_id` para `select`, `insert`, `update` y `delete`, nada de
`using (true)`. **Nunca** pongas una `service_role` ahí; el código la rechaza si la detecta.

Los intentos se guardan como eventos con un **uid generado en el cliente**, así que
sincronizar dos veces no duplica nada. El progreso no se guarda: se reconstruye de los
intentos.

## Importar progreso anterior

- **En local** no hace falta hacer nada: al arrancar con `./asorc-web` se fusiona lo que haya
  en `progress.json` y `web_stats.json` con lo del navegador.
- **En Pages** o para mover datos entre navegadores: **Progreso → Importar…** acepta
  `progress.json`, `web_stats.json` o un archivo exportado. **Exportar** guarda todo en un
  JSON.

La fusión se queda siempre con el valor más alto de cada contador: importar un archivo vacío
o más pobre **no borra nada**.

## Qué NO se sube al repositorio

`.gitignore` excluye `progress.json`, `web_stats.json`, `.env*`, los PDF de los libros,
`tools/_work/`, el binario `asorc` y `_site/`. `web/config.js` **sí** se versiona: solo
contiene la URL del proyecto y la clave publishable, que son públicas por diseño. `questions.json` y `explanations_simple.json`
sí forman parte del proyecto: son el banco y su capa de explicaciones.

## Compilar y ejecutar

```bash
g++ -std=c++17 -O2 -Wall -Wextra -o asorc main.cc
./asorc
```

Sin dependencias externas: `main.cc` lleva su propio parser JSON.

```
./asorc [--questions questions.json] [--progress progress.json] [--lang es|en|bi] [--no-color]
```

## Idioma

Las 270 preguntas del libro Sybex están **traducidas al español** (enunciado, opciones y
explicación). El texto original en inglés se conserva intacto: la traducción vive en campos
paralelos `_es` y nunca sustituye al original.

| Modo | Qué muestra |
|---|---|
| **Español** *(por defecto)* | La traducción |
| Original en inglés | El texto literal del libro |
| Bilingüe | El español y debajo, atenuado, el original (se omite cuando coinciden, p. ej. un comando) |

Se cambia con la opción **10** del menú (queda guardado en `progress.json`) o con `--lang`.
**Durante una pregunta se puede pulsar `t`** para alternar español ↔ original inglés, tanto
antes de responder como al ver la corrección; las opciones **mantienen el mismo orden** al
cambiar de idioma. El libro ENI ya es español y no tiene versión inglesa: en modo inglés se
muestra el original con un aviso.

Se conservan literales los comandos, rutas, nombres de archivo, parámetros, protocolos,
paquetes y directivas (`mdadm`, `/etc/fstab`, `systemctl`, `RAID 5`, `LVM`, `BIND`,
`iptables`, `GRUB`…). Solo se traduce el lenguaje natural.

## Modos

| # | Modo |
|---|---|
| 1 | Todas las preguntas (aleatorio) |
| 2 | Solo preguntas tipo test |
| 3 | Solo preguntas abiertas |
| 4 | Por libro |
| 5 | Por capítulo / tema |
| 6 | Solo preguntas falladas anteriormente |
| 7 | Repaso de preguntas que todavía no he visto |
| 8 | **Simulacro ASORC** |
| 9 | Ver mi progreso |

En las preguntas tipo test se barajan tanto las preguntas como las opciones. Tras responder
se indica de inmediato si es correcta, cuál era la respuesta buena y la explicación del
libro. Como las opciones se barajan, las referencias del tipo «option C» / «la opción C» del
texto se reescriben a la letra que se está mostrando, para que la explicación siga cuadrando
en cualquiera de los dos idiomas.

En las preguntas abiertas se escribe la respuesta (línea vacía para terminar), después se
muestra la respuesta modelo del libro y uno se autocalifica **B**ien / **P**arcial / **M**al.

## Modo ASORC

- Las preguntas cerradas se muestran con **3 opciones (A/B/C)** y **una sola respuesta correcta**.
- Si la pregunta original ya cumple eso, se usa tal cual. Si tenía 4 o 5 opciones, se conserva
  la correcta y se eligen **dos distractores originales del libro** — nunca se inventan opciones
  y **nunca se altera la respuesta correcta**.
- Las preguntas con **varias respuestas correctas** (65) no se pueden reducir limpiamente a una
  sola, así que se marcan como `multiple_response` y quedan **fuera** del simulacro ASORC; se
  siguen preguntando íntegras, en su formato original, en el resto de modos.
- Preguntas disponibles en formato ASORC: **202**.

Puntuación: **correcta +1 · incorrecta −0,5 · en blanco 0** (dos fallos anulan un acierto).
Al terminar se muestran correctas, incorrectas, en blanco, puntuación neta, porcentaje y los
temas donde más se falla.

## Archivos

| Archivo | Contenido |
|---|---|
| `questions.json` | Fuente de verdad: las 380 preguntas con su texto y opciones originales |
| `progress.json` | Progreso (se crea al usar la app): veces vista, aciertos, fallos, blancos, parciales, última respuesta e idioma configurado |
| `main.cc` | Aplicación de terminal |
| `asorc-web` | Lanzador de la interfaz web |
| `web/` | Interfaz web (`server.py`, `index.html`, `styles.css`, `js/`) |
| `web_stats.json` | Métricas de la web (se crea al usarla) |
| `extraction_report.md` | Informe de verificación por libro y capítulo |
| `tools/` | Pipeline de extracción reproducible |

### Formato de `questions.json`

```jsonc
{
  "id": "SYBEX-CH08-RQ15",
  "book": "sybex",
  "page": "447",                  // etiqueta impresa ("xliii" en preliminares)
  "page_pdf": 503,
  "chapter": "Chapter 8: Directing DNS",
  "topic": "DNS",
  "type": "multiple_choice",      // multiple_choice | multiple_response | open
  "question": "…",                // copia fiel del enunciado del libro
  "original_options": [{"label": "A", "text": "CNAME"}, …],
  "correct_answer": ["E"],        // letras; en las abiertas, la respuesta del libro
  "explanation": "…",
  "source_answer": "…",           // bloque de respuesta literal del libro

  // --- traducción añadida; los campos de arriba no se tocan ---
  "translated": true,
  "question_es": "…",
  "original_options_es": [{"label": "A", "text": "CNAME"}, …],   // mismas etiquetas y orden
  "explanation_es": "…",

  "asorc": {
    "eligible": true,
    "kept_option_labels": ["A", "B", "E"],
    "correct_label": "E",
    "question": "…",              // enunciado sin «(Choose all that apply.)» si procede
    "question_es": "…"
  }
}
```

## Regenerar el banco desde los PDFs

```bash
./tools/extract.sh
```

Requiere `pdftotext` (poppler-utils) y `python3`. Es determinista: produce un
`questions.json` byte a byte idéntico. Rutas configurables con `ASORC_PDF1`, `ASORC_PDF2`,
`ASORC_WORK`.

`extract.sh` regenera solo la parte inglesa. Para volver a incorporar la traducción:

```bash
python3 tools/i18n/merge_es.py       # añade los campos _es y valida que no se pierda nada
```

La validación compara contra `tools/i18n/questions_en_only.backup.json`, la instantánea
previa a la traducción, y aborta si cambia el número de preguntas, algún ID, alguna opción
o alguna respuesta correcta.

## Comprobaciones

```bash
python3 tools/test_shuffle_integrity.py
```

Recorre las 267 preguntas cerradas y las 202 de formato ASORC **en los tres idiomas** y
verifica que la respuesta correcta que muestra la aplicación sigue siendo la misma opción
lógica del libro después de barajar.

```bash
python3 tools/test_web.py
```

Para la web: comprueba que `questions.json` no se modifica, ejecuta la lógica real de
`web/js/logic.js` sobre todo el banco (18 760 barajados) verificando que la opción correcta
no cambia nunca, prueba las reglas de XP, combo, hitos y récords, los cortes de frase y el
remapeo de letras, y valida que la API escribe en `progress.json` el esquema exacto que la
app de terminal sigue leyendo. Comprueba el resaltado: que no altere ni una palabra de los 380
enunciados y las 1250 opciones, que no inyecte HTML, que no pase de 4 marcas y que no dé
pistas sobre la respuesta correcta. También comprueba el andamiaje del feed: que la plantilla de
tarjeta no use `id` (habría uno por pregunta viva), que cada `$('…')` de `app.js` resuelva
contra la plantilla o contra un `id` real, y que sigan en pie las dos reglas de las que
depende el desplazamiento —el feed sin anclaje automático y las tarjetas completadas sin
transición de tamaño.

```bash
python3 tools/test_simple.py
```

Para las explicaciones en llano: que estén las 380, que cada una tenga idea y frase de
memorización, que no se pase de 5 frases ni de 13 palabras en la primera, que no aparezca
lenguaje de manual («se procede a», «la opción X es correcta»…) y, sobre todo, **que no haya
contenido inventado**: cada comando, ruta, archivo o sigla de la versión reescrita tiene que
estar también en el material del libro de esa misma pregunta.

```bash
python3 tools/test_contrast.py
```

Contraste WCAG AA de la interfaz web, leyendo los colores directamente de `web/styles.css`.
