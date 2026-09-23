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
   ├── academic.js  la nota: +1 / −1/(k−1) / 0, aparte del XP  (lógica pura)
   ├── micro.js   repaso rápido: el mazo y cuándo vuelve cada tarjeta  (lógica pura)
   ├── repaso.js  repaso rápido: sección del inicio y pantalla de tarjetas
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

También se guarda la nota: los puntos, y de cada pregunta contestada su resultado, cuánto
sumó o restó y el acumulado tras ella. Al reanudar, lo ya contestado vuelve al feed como
historial —enunciado, tu respuesta, la correcta y su línea de nota, con las mismas letras
que viste— y el marcador sale idéntico. Una pregunta ya corregida cuenta aunque salgas, cierres
la pestaña o pulses `Esc` antes de **SIGUIENTE**: al volver se sigue por la próxima, sin
repetirla ni sumarla dos veces.

Está pensada como un juego de quiz: **pregunta → decisión → impacto → recompensa →
siguiente**, para que hacer «una más» cueste lo mínimo.

### El bucle

**Responder.** La pantalla es casi toda el reto: enunciado grande y respuestas como tarjetas
grandes con su letra A/B/C. Arriba, un marcador de videojuego: barra de progreso de 11 px con
esquinas redondeadas y tres grupos —🔥 racha, ⚡ XP, y posición más tiempo— con las cifras a
28–34 px y el cronómetro a 33–35 px en peso 800. Debajo, en su propia fila, la nota:
`✓ 11  ✗ 6  ○ 2 │ PUNTOS 8,25 / 19 respondidas · neto 43,4%` (ver [La nota](#la-nota)). En
portátiles (≤1366 px) y en móvil se recortan huecos y relleno, nunca los números; en móvil la
nota se queda en ✓ ✗ ○ y puntos sobre respondidas.

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

Cada tarjeta contestada lleva arriba a la derecha su línea de nota —`✗ fallada  −0,33  total
5,67`—, fuera de lo que se pliega: al subir por el feed se leen en columna y se ve pregunta a
pregunta cómo se ha llegado a la nota actual. El nodo guarda además `data-result`,
`data-score-delta` y `data-score-after`.

La barra de arriba —racha, XP, posición, tiempo y la fila de la nota— queda anclada mientras
recorres la sesión.

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

### La nota

La nota académica va **completamente aparte del XP**: otra regla, otro estado en la ronda
(`run.academic`: puntos y una entrada por pregunta) y otra fila del HUD. Vive en
`web/js/academic.js`, que es lógica pura y no sabe nada de XP ni de rachas.

**Una respuesta** (con `k` opciones a la vista):

| | Puntos |
|---|---|
| correcta | +1 |
| incorrecta | −1/(k−1) |
| en blanco | 0 |

Así contestar completamente al azar vale 0 de media: `(1/k)·1 − ((k−1)/k)·1/(k−1) = 0`. La
`k` es la de las opciones **que se muestran en esa ronda**, no la del libro: el simulacro ASORC
enseña 3 (**−0,50**, el +1 / −0,5 / 0 de siempre) y el resto de modos 4 (**−0,33**) o 5
(**−0,25**). No hay una penalización media para todo el test: cada pregunta resta la suya.

La suma es exacta: se lleva sobre una rejilla de 1/2520 (divisible por cualquier `k − 1` hasta
10), así que una correcta y tres fallos de 4 opciones dan 0,00 y no −0,00.

**Varias respuestas** (65 preguntas, todas de Sybex). No se les aplica −1/(k−1): la respuesta
es una combinación de opciones y esa fórmula no neutraliza el azar. Conservan su corrección de
siempre —todo o nada: +1 si marcas justo las correctas, 0 si no, sin penalización— y llevan la
etiqueta **puntuación múltiple**. Se cuentan aparte para poder cambiarles la fórmula.

**Abiertas.** Se autocalifican: +1 si la das por buena, 0 si no.

**Durante la ronda** se ve `PUNTOS 6,67 / 12 respondidas · neto 55,6%`: puntos, sobre cuántas
has contestado (en blanco incluidas) y el rendimiento neto. **No** hay nota sobre 10 mientras
juegas: en la pregunta 3 de 20 saldría artificialmente baja. Al contestar, la tarjeta dice en
grande *✓ CORRECTA +1,00 · Acumulado después de esta pregunta: 6,67 puntos* y la regla que
se le aplicó (*4 opciones · acierto +1 · fallo −0,33 · en blanco 0*).

**Al terminar**, el bloque **NOTA**: correctas, falladas y en blanco con lo que suma o resta
cada grupo, los **puntos netos sobre el total de preguntas** de la ronda y, además, la **nota
sobre 10** = `max(0, puntos / total · 10)`. Debajo, de dónde sale lo restado
(*2 × −0,50 (3 opciones) · 1 × −0,33 (4 opciones)*). Si terminas antes con `Esc`, las que no
llegaste a ver salen como *sin contestar* y cuentan 0, como en un examen.

### Repaso rápido

Muchas preguntas de LPIC-2 se reducen a una asociación: qué comando, qué archivo, qué
directiva. En vez de releer párrafos, cada pregunta tiene una **microtarjeta**:

```
NFS: utilidades que muestran los recursos
↓
exportfs + showmount

mount.nfs → monta desde el cliente
rpcinfo → servicios RPC
smbstatus → conexiones de Samba
```

**Pista corta → respuesta corta**, no pregunta completa → párrafo. Cada tarjeta tiene `cue`
(la pista, 2–8 palabras), `answer` (lo que hay que recuperar, una línea), `contrast` (hasta
cuatro distractores reales en formato `X → Y`, solo si ayudan) y, a veces, `mnemo` cuando el
propio nombre lo dice (`SOA = start of authority`, `-l = listen`).

**Cuándo entra una tarjeta.** Al fallar una pregunta, dejarla en blanco, autocalificarse
«mal» o «a medias» en una abierta, o marcarla para repasar. Al final de la explicación sale
discreto **⚡ Añadida a repaso rápido**, sin interrumpir nada. Lo que ya tenías fallado o
marcado de antes también entra. **Una pregunta = una tarjeta estable**: el mazo va por
`question_id`, así que repetirla actualiza sus estadísticas y nunca crea otra.

**⚡ REPASO RÁPIDO**, en el inicio: **10 rápidas**, **20 rápidas**, **todas**, **falladas
hoy**, **marcadas** y **por tema**. La tarjeta enseña primero solo la pista y un `?`; la
respuesta y el contraste salen al pulsar o con `Space`. Luego hay que decir cómo te fue —
**LA SABÍA** (`1`), **DUDÉ** (`2`), **NO LA SABÍA** (`3`)— y eso decide cuándo vuelve:

| Respuesta | Vuelve |
|---|---|
| no la sabía | a los 10 minutos, y otra vez en la misma tanda (como mucho dos) |
| dudé | mañana, sin subir de nivel |
| la sabía | cada vez más tarde: 3, 7, 16, 35 y 90 días |
| fallarla en una ronda | ya: vuelve al principio |

Las tandas empiezan por lo que toca, lo más flojo y lo más fallado delante.

**De dónde salen.** Las 380 están escritas de antemano en `tools/micro/*.json` (un lote por
capítulo, con la guía de estilo en `tools/micro/GUIA.md`) y `tools/micro/merge.py` las une en
`microcards.json`. La web no las inventa en caliente: así cada pregunta tiene siempre la
misma. **No se inventa nada**: todo comando, ruta, archivo, directiva, número o sigla de una
tarjeta está en el material de esa pregunta (enunciado, opciones, explicación del libro o en
llano), y `tools/test_micro.py` lo comprueba. `questions.json` no se toca.

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
| `Space` / `Enter` | repaso rápido: mostrar la respuesta |
| `1` `2` `3` | repaso rápido: la sabía · dudé · no la sabía |

### Sonido

Tonos cortos generados con Web Audio (sin archivos): ascendente al acertar, grave al fallar,
arpegio en los hitos. Volumen bajo, se apaga con `S` o desde el botón de inicio y la
preferencia se recuerda.

### Al terminar

Pantalla de resultado con el marcador grande de aciertos, el bloque **NOTA** (puntos netos
sobre el total y nota sobre 10, ver [La nota](#la-nota)), XP, mejor racha y segundos por
pregunta, más la comparación con tu ronda anterior (`↑ 7 % precisión`, `↓ 3,1 s/pregunta`).
Si has fallado, **REPASAR N FALLOS** lanza al momento una ronda solo con esas. El desglose por
tema y la comparación con/sin música quedan plegados en «Ver detalle».

### Dejar en blanco

Fallar resta en la nota (−0,5 en el simulacro **ASORC**, −1/(k−1) en general) y no contestar
no, así que saltar una pregunta es una decisión legítima. Aparece un botón secundario discreto
bajo las opciones, **DEJAR EN BLANCO**, con la tecla `0`.

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
| `web/js/academic.js` | la nota: +1 / −1/(k−1) / 0 por pregunta, exacta y aparte del XP |
| `web/js/micro.js` | repaso rápido: el mazo como eventos, cuándo vuelve cada tarjeta, modos |
| `web/js/repaso.js` | repaso rápido: sección del inicio, pantalla de tarjetas y teclado |
| `web/js/fx.js` | sonido y microinteracciones |
| `web/js/burst.js` | reproductor de la explicación por fragmentos |
| `web/js/app.js` | presentación, feed y flujo |
| `web/server.py` | servidor local y puente con los archivos del proyecto |

### Dónde se guarda

| Archivo | Contenido |
|---|---|
| `progress.json` | **compartido con la app de terminal**, mismo esquema: lo que respondes en la web cuenta en «solo falladas» y «no vistas» del terminal, y al revés |
| `web_stats.json` | solo de la web: tiempos por pregunta, marcadas y registro de sesiones |
| `localStorage` · `cards` | el mazo de repaso rápido: por pregunta, su pista, respuesta y contraste, veces vista, sabía / dudé / no sabía, último repaso y cuándo vuelve |

`questions.json` es la fuente de verdad y la web **nunca lo escribe**. Las métricas propias
van aparte porque la app de terminal reescribe `progress.json` desde su propio modelo y
descartaría cualquier campo que no conozca.

## Publicar en GitHub Pages

```bash
python3 tools/build_site.py          # arma _site/ y avisa si queda alguna ruta absoluta
```

El sitio se monta copiando `web/` a la raíz más `questions.json`, `explanations_simple.json` y
`microcards.json`, que es donde el frontend los busca. `server.py` no se publica (es el puente local); `config.js`
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
`asorc.v2.progress`, `asorc.v2.stats`, `asorc.v2.session`, `asorc.v2.prefs` y `asorc.v2.cards`. Offline
funciona todo una vez cargada la página.

## Sincronizar entre dispositivos

**Sin cuentas.** Hay **un solo progreso** —el del perfil `default`— y lo comparten todos los
navegadores que abran la web: portátil, móvil, incógnito. Se abre la URL y se estudia.

Para activarla:

1. Pega `supabase/schema.sql` en el editor SQL de tu proyecto de Supabase.
2. Pon la **URL** y la **publishable key** en `web/config.js` (versionado a propósito).

No hay ningún tercer paso. **No hace falta pulsar «SINCRONIZAR AHORA»**: se puede estudiar
una ronda entera sin tocarlo. Ese botón es el reintento a mano y el diagnóstico.

### Cómo va

Primero lo local, siempre. Responder escribe en `localStorage` y la pantalla avanza; lo que
hay que mandar se apunta en una cola y sale por detrás. Nada de lo que haces espera a la red:

```
respondo
  └─ localStorage          inmediato
  └─ pantalla, XP, feed    inmediato
  └─ cola de envío         inmediato
       └─ Supabase         cuando se pueda
```

La cola vive en `localStorage` bajo `asorc.v2.syncQueue` y sobrevive a quedarse sin red, a
cerrar el navegador y a recargar. **Un evento solo se borra cuando Supabase confirma que lo
tiene.** Si falla, se reintenta: a los 2 s, 5 s, 15 s, 1 min y 5 min, y además en cuanto
vuelve la conexión, al volver a mirar la pestaña, al abrir la web o al pulsar el botón.

Se sincroniza sola después de cada respuesta, al marcar o desmarcar para repasar, al dejar
una en blanco, al salir de una ronda y al terminarla.

El indicador de la cabecera dice en qué punto está, y ocupa lo que ocupa un botón:

| | |
|---|---|
| ☁ sincronizado | todo enviado |
| ☁ sincronizando… | mandando ahora mismo |
| ☁ 3 cambios pendientes | esperando; se reintenta solo |
| ⚠ sin conexión | se guarda aquí y se envía al volver |
| ☁ solo local | no hay nube configurada, o falta ejecutar el esquema |

### Por qué no se duplica nada

El histórico son **eventos, no sumas**: `asorc_attempts` es un registro de intentos y los
contadores del panel se derivan sumándolo. Cada intento lleva un `event_id` generado en el
cliente y la clave primaria está en ese campo, así que reenviar el mismo evento —porque la
red falló a mitad y hubo reintento— no puede contar dos veces.

El progreso que ya existía antes de la cola (el de `progress.json` de la terminal, o un
archivo importado) no son eventos, así que se convierten en intentos con identificador
reproducible, `local:<pregunta>:<resultado>:<n>`. Para no contar dos veces lo que ya viaja
como evento, el navegador lleva la cuenta de qué parte del histórico está arriba y solo manda
la diferencia.

Y la regla de la que depende toda la fusión: **no se baja nada mientras quede algo por
subir.** Si se bajara antes, la fusión —que se queda con el contador más alto— podría dar por
buena una cuenta que aún no incluye lo de este navegador.

Lo que no es un contador sino un estado que se puede quitar —la marca de repaso, la ronda a
medias— se resuelve por marca de tiempo: gana el cambio más reciente, y quien llega tarde se
descarta en la base de datos con un disparador, no en el cliente, así que da igual quién
sincronice primero. Por eso **desmarcar** viaja igual de bien que marcar.

### Decisión deliberada sobre seguridad

El navegador entra con el rol `anon` y **no hay autenticación**, así que **quien descubra la
URL puede leer o cambiar el progreso compartido**. Es un riesgo asumido a conciencia: lo que
se guarda es cuántas preguntas de LPIC-2 llevas acertadas, no una cuenta bancaria. A cambio
no hay login, ni correos, ni sesiones que caduquen, ni un progreso distinto por navegador.

Aun así los permisos son los mínimos que la web necesita, y eso sí acota el daño:

- RLS **activada** en las cinco tablas, nunca desactivada como atajo.
- Políticas explícitas por operación, atadas al perfil fijo `profile_id = 'default'`.
- El histórico es de **solo añadir**: con la clave pública no se puede modificar ni borrar un
  intento ya registrado.
- **Ninguna tabla concede `DELETE`.**
- `GRANT` mínimos: se revoca todo y se concede solo `select`/`insert` (y `update` donde hace
  falta pisar un estado).

La clave que viaja al navegador es la **publishable**. Una `sb_secret_` o una `service_role`
saltarían RLS y tendrían permisos de administrador sobre toda la base de datos: nunca deben
estar en una web, y `cloud.js` las rechaza si las detecta.

### El esquema

`supabase/schema.sql` es **idempotente**: se puede volver a ejecutar entero desde el editor
SQL sin romper lo que ya hay. No borra tablas ni datos, y si encuentra el esquema anterior
—el que llevaba `user_id`— lo migra conservando las filas.

| Tabla | Qué es | Clave |
|---|---|---|
| `asorc_attempts` | el histórico, un intento por fila | `event_id` del cliente |
| `asorc_marks` | marcas de repaso | `(profile_id, question_id)` |
| `asorc_sessions` | rondas terminadas | `uid` del cliente |
| `asorc_pending` | la ronda a medias, una sola fila | `id = 'main'` |
| `asorc_card_events` | repaso rápido: fallo, marca, sabía, dudé, no sabía; un evento por fila | `event_id` del cliente |

**Si ya tenías la nube montada, vuelve a pegar `schema.sql`** para crear `asorc_card_events`.
Mientras no lo hagas, todo lo demás se sincroniza igual: los eventos del repaso esperan en la
cola de este navegador (sin contarse como pendientes que no saldrán) y se envían solos en
cuanto la tabla existe. El panel de la nube lo avisa. Ojo: al insertar en una tabla que no
existe, PostgREST 12 contesta 404 **con el cuerpo vacío**, así que se detecta por el estado.

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
contiene la URL del proyecto y la clave publishable, que son públicas por diseño.
`questions.json`, `explanations_simple.json` y `microcards.json` sí forman parte del
proyecto: son el banco, su capa de explicaciones y sus microtarjetas.

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
| `explanations_simple.json` | Explicaciones en llano (desde `tools/simple/`) |
| `microcards.json` | Microtarjetas de repaso rápido, una por pregunta (desde `tools/micro/`) |
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

Y la nota: que un fallo reste exactamente −0,50 / −0,33 / −0,25 con 3 / 4 / 5 opciones, que
una correcta y `k − 1` fallos den **0 exacto** en cualquier orden, que 200 000 respuestas al
azar (con 3, 4, 5 y mezcladas, y sobre las vistas reales del banco) tengan media ≈ 0, que la
`k` sea la de las opciones mostradas (3 en ASORC), que las de varias respuestas no resten, que
guardar y reanudar deje cada delta y cada acumulado idénticos, y que el XP y la nota no se
toquen entre sí.

```bash
python3 tools/test_sync.py
```

La sincronización, de punta a punta y contra una base de datos de verdad. Levanta
PostgreSQL, le aplica `supabase/schema.sql` (dos veces, para comprobar que es idempotente),
pone delante PostgREST con el rol `anon` y una pasarela que se puede desenchufar a mitad, y
sobre eso corre `web/js/store.js` y `web/js/cloud.js` sin tocarlos, con el cliente oficial de
Supabase. Comprueba lo que no se puede comprobar de otra forma: que una respuesta llega sola,
que responder cinco seguidas no espera a la red, que sin red no se pierde nada y la cola
crece, que al volver la red se vacía sola, que reenviar un evento no duplica, que un segundo
navegador limpio recibe el progreso sin login, que lo de uno llega al otro, que desmarcar
viaja, y que con la clave pública no se puede reescribir ni borrar el histórico. También el
repaso rápido: que sus eventos llegan, que reenviarlos no duplica, que otro navegador rehace
la misma tarjeta con el mismo «cuándo vuelve» y que son de solo añadir. Y el caso de quien
no ha vuelto a ejecutar `schema.sql`: borra la tabla del repaso a mitad de prueba, comprueba
que todo lo demás se sigue sincronizando y que, al volver a aplicar el esquema, lo retenido
sale solo.

Necesita `initdb`, `docker`, `node` y el cliente: `cd tools && npm install @supabase/supabase-js`.
Si falta algo se salta y lo dice. **Nunca toca el Supabase real ni tu progreso**: todo vive en
un directorio temporal que se borra al terminar.

```bash
python3 tools/test_simple.py
```

Para las explicaciones en llano: que estén las 380, que cada una tenga idea y frase de
memorización, que no se pase de 5 frases ni de 13 palabras en la primera, que no aparezca
lenguaje de manual («se procede a», «la opción X es correcta»…) y, sobre todo, **que no haya
contenido inventado**: cada comando, ruta, archivo o sigla de la versión reescrita tiene que
estar también en el material del libro de esa misma pregunta.

```bash
python3 tools/test_micro.py
```

Las microtarjetas: una por pregunta y sin claves repetidas, pista de 8 palabras como mucho,
respuesta de una línea, contraste en formato `X → Y`, sin citar letras de opción (se
barajan), sin que la pista ya diga la respuesta y siempre sobre la respuesta correcta. Y
**nada inventado**: cada comando, ruta, archivo, directiva, número, sigla o nombre propio
tiene que estar en el material de esa pregunta, y cada palabra corriente en algún sitio del
banco. Con un lote suelto (`python3 tools/test_micro.py tools/micro/b05-sybex-ch05.json`)
sirve para escribirlas. `test_web.py` prueba además el mazo: que repetir una pregunta no
duplica su tarjeta, que conserva la misma pista, cuándo vuelve cada una, los modos (por
tema, falladas hoy, marcadas, 10 y 20 rápidas), que el mismo conjunto de eventos da el mismo
mazo en cualquier orden, que fusionar no pierde nada y que tras recargar sigue igual.

```bash
python3 tools/test_contrast.py
```

Contraste WCAG AA de la interfaz web, leyendo los colores directamente de `web/styles.css`.
