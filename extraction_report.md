# Informe de extracción — Banco de preguntas LPIC-2

_Generado: 2026-09-20_

Este informe documenta la fase de verificación exigida: para cada sección que contiene preguntas se indica **cuántas debería haber** (recuento independiente hecho directamente sobre el PDF, sin usar el extractor) y **cuántas se han extraído**.

## 1. Libros analizados

| # | Archivo | Título | Autor(es) | Idioma | Págs. PDF |
|---|---------|--------|-----------|--------|-----------|
| 1 | `LPIC-2-Linux-inglés.pdf` | LPIC-2: Linux Professional Institute Certification Study Guide (Exam 201 / Exam 202), 2nd Ed. | Bresnahan & Blum (Sybex) | inglés | 771 |
| 2 | `lpic-2-linux.pdf` | Preparación para la certificación LPIC-2 (exámenes LPI 201 y LPI 202), 2ª ed. | Sébastien Bobillier (ENI) | español | 351 |

**Método de extracción.** `pdftotext -layout` (Poppler) sobre el texto embebido de ambos PDFs — ninguno es escaneado, por lo que no hace falta OCR. El texto se procesa por páginas con marcadores `<<<PDFPAGE n>>>` para conservar la página física de cada pregunta. Para los huecos de las preguntas *fill-in-the-blank* se usa además `pdftotext -bbox-layout`, porque un hueco al final de línea desaparece del volcado de texto plano y solo es detectable por las coordenadas de las palabras.

## 2. Libro 1 — Sybex (inglés)

### 2.1 Cifra declarada por el propio libro

> «Sample Tests — All of the questions in this book are included, including the assessment test at the end of this introduction and **the 240 questions from the review sections at the end of each chapter**.» (Introduction, pág. xxvii — pág. PDF 29)

Esto fija el objetivo: **30** (assessment test) **+ 240** (review questions) = **270**.

### 2.2 Recuento por sección

| Capítulo | Sección | Págs. PDF | Esperadas | Extraídas | Respuestas | Estado |
|---|---|---|---|---|---|---|
| Assessment Test | `assessment_test` | 45-50 | 30 | 30 | 30 | OK |
| Chapter 1: Starting a System | `review_questions` | 89-92 | 20 | 20 | 20 | OK |
| Chapter 2: Maintaining the System | `review_questions` | 145-148 | 20 | 20 | 20 | OK |
| Chapter 3: Mastering the Kernel | `review_questions` | 191-194 | 20 | 20 | 20 | OK |
| Chapter 4: Managing the Filesystem | `review_questions` | 251-254 | 20 | 20 | 20 | OK |
| Chapter 5: Administering Advanced Storage Devices | `review_questions` | 323-326 | 20 | 20 | 20 | OK |
| Chapter 6: Navigating Network Services | `review_questions` | 366-369 | 20 | 20 | 20 | OK |
| Chapter 7: Organizing Email Services | `review_questions` | 422-426 | 20 | 20 | 20 | OK |
| Chapter 8: Directing DNS | `review_questions` | 503-506 | 20 | 20 | 20 | OK |
| Chapter 9: Offering Web Services | `review_questions` | 549-552 | 20 | 20 | 20 | OK |
| Chapter 10: Sharing Files | `review_questions` | 633-636 | 20 | 20 | 20 | OK |
| Chapter 11: Managing Network Clients | `review_questions` | 671-674 | 20 | 20 | 20 | OK |
| Chapter 12: Setting Up System Security | `review_questions` | 707-710 | 20 | 20 | 20 | OK |
| **TOTAL** | | | **270** | **270** | **270** | **OK** |

Las numeraciones de cada sección son secuencias completas 1..N sin huecos (comprobado ítem por ítem). Cada pregunta tiene su respuesta correspondiente en *Appendix: Answers to Review Questions* (págs. PDF 711-745) o en *Answers to Assessment Test* (págs. PDF 51-56).

## 3. Libro 2 — ENI (español)

### 3.1 Cifra declarada por el propio libro

> «Una parte de comprobación de los conocimientos adquiridos escrita en forma de preguntas/respuestas (**110 en total**).» (Prólogo — pág. PDF 3)

### 3.2 Recuento por sección

| Capítulo | Sección | Pág. PDF | Esperadas | Extraídas | Respuestas | Estado |
|---|---|---|---|---|---|---|
| Capítulo 1: Administración del almacenamiento | `preguntas_respuestas` | 47 | 10 | 10 | 10 | OK |
| Capítulo 2: Arranque del sistema | `preguntas_respuestas` | 76 | 10 | 10 | 10 | OK |
| Capítulo 3: Administración de la red local | `preguntas_respuestas` | 110 | 10 | 10 | 10 | OK |
| Capítulo 4: Autentificación de usuarios | `preguntas_respuestas` | 138 | 10 | 10 | 10 | OK |
| Capítulo 5: Compartición de archivos | `preguntas_respuestas` | 163 | 10 | 10 | 10 | OK |
| Capítulo 6: Resolución de nombres DNS | `preguntas_respuestas` | 196 | 10 | 10 | 10 | OK |
| Capítulo 7: Servidor web Apache | `preguntas_respuestas` | 229 | 10 | 10 | 10 | OK |
| Capítulo 8: Correo electrónico | `preguntas_respuestas` | 256 | 10 | 10 | 10 | OK |
| Capítulo 9: Protección de redes | `preguntas_respuestas` | 282 | 10 | 10 | 10 | OK |
| Capítulo 10: Asegurar las comunicaciones | `preguntas_respuestas` | 304 | 10 | 10 | 10 | OK |
| Capítulo 11: Compilación de aplicaciones y del kernel Linux | `preguntas_respuestas` | 333 | 10 | 10 | 10 | OK |
| **TOTAL** | | | **110** | **110** | **110** | **OK** |

Las 110 preguntas del libro 2 son **abiertas**: el libro las plantea en «1. Preguntas» y da la respuesta modelo en «2. Respuestas». Se verificó que los 110 bloques de respuesta repiten literalmente su pregunta (similitud ≥ 0,90 en los 110 casos), lo que confirma el emparejamiento pregunta↔respuesta.

## 4. Comprobaciones de exhaustividad

| Comprobación | Resultado |
|---|---|
| Libro 1: páginas con «(Choose/Select all that apply / the best answer…)» **fuera** de los rangos mapeados | 0 |
| Libro 2: preguntas con formato `N ¿…?` **fuera** de las 11 secciones de preguntas | 0 |
| IDs únicos | 380 / 380 |
| Preguntas cerradas sin respuesta correcta registrada | 0 |
| Preguntas abiertas sin respuesta modelo | 0 |
| Letras de respuesta que no existen entre las opciones | 0 |
| Artefactos de codificación (`\ufffd`, `(cid:`) | 0 |

### Verificación de fidelidad carácter a carácter

Además del recuento, se comprobó automáticamente que **cada** texto guardado aparece realmente en la página del PDF de la que dice proceder (comparación normalizada: sin espacios, acentos ni signos):

| Elemento | Verificados | No hallados en su página |
|---|---|---|
| Enunciados de pregunta | 380 | 0 |
| Opciones de respuesta | 1250 | 0 |
| Explicaciones / respuestas modelo | 380 | 0 |

Es decir, ninguna pregunta, opción ni explicación del banco es inventada ni ha sido reescrita: todas se localizan en el texto del PDF de origen.

### Secciones del índice que contienen preguntas

Se recorrió el índice de ambos libros. Las secciones con preguntas son exactamente:

- **Libro 1**: *Assessment Test* (1) + *Review Questions* al final de cada uno de los 12 capítulos (12) = 13 secciones.
- **Libro 2**: *Comprobación de los conocimientos adquiridos: preguntas/respuestas* al final de 11 de los 12 capítulos = 11 secciones. El capítulo introductorio («Introducción», montaje del laboratorio) no tiene sección de preguntas.

### Material excluido deliberadamente (y por qué)

| Material | Libro | Motivo |
|---|---|---|
| *Practice Exams* (2 × 72 preguntas) y *Electronic Flashcards* (300+) | 1 | **No están en el PDF.** El libro dice explícitamente que residen en el *online test bank* de Sybex. No se han inventado. |
| *Exercises* (ejercicios prácticos guiados) | 1 | Son laboratorios paso a paso, no preguntas evaluables. |
| *Exam Essentials* | 1 | Resúmenes de repaso en prosa, no preguntas. |
| *Trabajos prácticos* | 2 | Laboratorios prácticos multi-paso con «Operaciones» y «Comandos útiles», no preguntas con respuesta. |

## 5. Composición del banco

| Métrica | Valor |
|---|---|
| Total de preguntas | **380** |
| Libro 1 (Sybex, inglés) | 270 |
| Libro 2 (ENI, español) | 110 |
| `multiple_choice` (1 respuesta correcta) | 202 |
| `multiple_response` (varias correctas) | 65 |
| `open` (abiertas / rellenar hueco) | 113 |
| Elegibles para el modo ASORC de 3 opciones | 202 |

### Preguntas por tema

| Tema | Libro 1 | Libro 2 | Total |
|---|---|---|---|
| Evaluación general (Assessment Test) | 30 | 0 | 30 |
| Arranque del sistema | 20 | 10 | 30 |
| Kernel y compilación | 20 | 10 | 30 |
| Servicios de red | 20 | 10 | 30 |
| Correo electrónico | 20 | 10 | 30 |
| DNS | 20 | 10 | 30 |
| Servidor web | 20 | 10 | 30 |
| Compartición de archivos | 20 | 10 | 30 |
| Clientes de red y autenticación | 20 | 10 | 30 |
| Mantenimiento del sistema | 20 | 0 | 20 |
| Sistemas de archivos | 20 | 0 | 20 |
| Almacenamiento avanzado (RAID/LVM) | 20 | 0 | 20 |
| Seguridad del sistema | 20 | 0 | 20 |
| Almacenamiento y sistemas de archivos | 0 | 10 | 10 |
| Seguridad de red | 0 | 10 | 10 |
| Seguridad de las comunicaciones | 0 | 10 | 10 |

## 6. Modo ASORC

Reglas aplicadas (ninguna altera la respuesta correcta):

1. **Pregunta con 1 sola respuesta correcta y ≤ 3 opciones** → se usa tal cual.
2. **Pregunta con 1 sola respuesta correcta y 4-5 opciones** → se conserva la opción correcta y se eligen **2 distractores originales** del propio libro. Nunca se inventan opciones.
3. **Pregunta con varias respuestas correctas** → queda marcada como `multiple_response`, **fuera** del modo ASORC de 3 opciones, y se sigue preguntando en su formato original en los demás modos.
4. **Preguntas abiertas** → se preguntan como abiertas y después se muestra la respuesta modelo del libro.

| Origen | Nº preguntas |
|---|---|
| 4 opciones → 3 | 84 |
| 5 opciones → 3 | 118 |
| **Total ASORC** | **202** |

**Criterio de selección de distractores** (determinista y reproducible): de las opciones incorrectas originales se puntúan y eligen las dos más parecidas a la correcta, combinando (a) misma *forma* superficial (ruta, comando, indicador, número, frase), (b) similitud de trigramas y de secuencia, (c) longitud parecida y (d) si la explicación del libro razona explícitamente sobre esa opción. Así la pregunta sigue discriminando en vez de volverse trivial.

**Nota sobre el enunciado.** En 6 preguntas el enunciado original terminaba en «(Choose all that apply.)» aunque el libro solo da **una** respuesta correcta. Para el modo ASORC se guarda un enunciado sin esa coletilla en `asorc.question` (que contradiría el formato de respuesta única); el enunciado literal del libro se conserva intacto en el campo `question`.

## 7. Secciones dudosas o con incidencias

| Incidencia | Alcance | Resolución |
|---|---|---|
| Huecos de *fill-in-the-blank* al final de línea invisibles en el texto plano | Libro 1: `SYBEX-AT-09`, `SYBEX-AT-28` | Recuperados con coordenadas de palabras (`-bbox-layout`) y verificados contra el PDF. |
| Palabras partidas por guión de final de línea (`author- ity`) | Ambos libros | Reunidas comparando en el corpus completo la frecuencia de la forma unida frente a la forma con guión, para no destruir guiones legítimos (`read-only`, `well-known`). |
| Numeración de páginas del *Assessment Test* | Libro 1 | Es preliminar en números romanos (xliii-xlviii); el campo `page` los guarda como tal en lugar de números negativos. |
| Assessment Test sin capítulo asociado | Libro 1 | El libro no mapea sus 30 preguntas a capítulos concretos, así que se agrupan bajo el tema «Evaluación general». No se ha inventado una asignación por capítulo. |
| Página divisoria de parte («The LPI 202 · Part · Exam II», pág. PDF 371) absorbida al final de la última opción del capítulo 6 | Libro 1: `SYBEX-CH06-RQ20` opción E | Detectado por la verificación de fidelidad. Se ajustó el rango del capítulo 6 a las págs. PDF 366-369 y se añadió un filtro para las páginas divisorias. |

No queda ninguna sección con recuento discrepante.

## 8. Traducción al español

Las **270 preguntas del libro Sybex** se han traducido al español: enunciado, opciones y explicación. Las 110 del libro ENI ya estaban en español.

| Elemento traducido | Cantidad |
|---|---|
| Enunciados | 270 |
| Opciones | 1250 |
| Explicaciones / respuestas modelo | 270 |

**El texto original en inglés no se modifica ni se elimina.** La traducción se guarda en campos paralelos (`question_es`, `original_options_es`, `explanation_es`, `asorc.question_es`), con las mismas etiquetas de opción y en el mismo orden.

### Criterio de traducción

Se traduce el lenguaje natural y se conservan **literales** los comandos, rutas, nombres de archivo, parámetros, opciones de línea de comandos, protocolos, paquetes y directivas (`mdadm`, `/etc/fstab`, `systemctl`, `RAID 5`, `LVM`, `BIND`, `iptables`, `GRUB`, `AuthUserFile`, `passdb backend`…), porque son la forma que hay que reconocer en el examen. Tampoco se traduce el contenido literal de archivos de configuración. Terminología usada: *filesystem* → sistema de archivos, *bootloader* → cargador de arranque, *disk striping* → distribución por bandas, *parity* → paridad, *mount point* → punto de montaje, *kernel* → kernel/núcleo según el contexto.

De las 1250 opciones, la mayoría son tokens puramente técnicos que se mantienen idénticos; solo se traduce la prosa.

### Validación automática tras traducir

| Comprobación | Resultado |
|---|---|
| Nº de preguntas sigue siendo 380 | 380 |
| IDs únicos e intactos | 380 |
| Enunciados, opciones y respuestas correctas originales sin modificar | verificado |
| Opciones `_es` con las mismas etiquetas y el mismo orden | verificado |
| Opciones originales / opciones traducidas | 1250 / 1250 |

`tools/i18n/merge_es.py` compara contra `questions_en_only.backup.json` — la instantánea previa a la traducción, generada por una extracción limpia — y aborta si cambia el número de preguntas, algún ID, alguna opción o alguna respuesta correcta. Se comprobó con pruebas negativas que la validación detecta de verdad los tres casos (quitar una opción, alterar una respuesta correcta y borrar una pregunta). Además, `tools/test_shuffle_integrity.py` ejecuta la aplicación sobre las 267 preguntas cerradas y las 202 de formato ASORC **en los tres idiomas** y comprueba que la respuesta correcta mostrada sigue siendo la misma opción lógica del libro después de barajar.

## 9. Conclusión

Se han extraído **380 preguntas** (270 + 110). Los recuentos por sección, obtenidos de forma independiente sobre el PDF, coinciden **exactamente** con los extraídos y con las cifras que los propios libros declaran (240 review questions en el libro 1; 110 preguntas en el libro 2). No hay huecos en ninguna secuencia de numeración ni preguntas detectadas fuera de las secciones mapeadas.
