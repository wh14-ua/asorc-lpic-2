# Microtarjetas de repaso rápido · guía de estilo

Una microtarjeta es una **asociación mínima** para recuperar de memoria:

```
pista corta  →  respuesta corta
```

no *pregunta completa → párrafo completo*. En el examen gran parte de la memoria es
literalmente asociación rápida: «NFS, listar y aplicar exportaciones → `exportfs`».

Hay **una tarjeta por pregunta** y es estable: se escribe una vez aquí, en
`tools/micro/*.json`, y `tools/micro/merge.py` las une en `microcards.json`. La web no
se inventa tarjetas en caliente: cuando fallas, dejas en blanco o marcas una pregunta,
su tarjeta entra en tu repaso.

## Formato

Un archivo por lote, con los mismos lotes que `tools/simple/`
(`python3 tools/micro/material.py` los lista):

```json
{
 "SYBEX-AT-21": {
  "cue": "exportaciones NFS: listarlas y aplicarlas",
  "answer": "exportfs",
  "contrast": ["showmount → quién monta qué", "rpcinfo → servicios RPC"],
  "mnemo": "…"
 }
}
```

| Campo | Qué es | Límite |
|---|---|---|
| `cue` | la pista mínima que dispara el recuerdo | 2–8 palabras (máx. 8) |
| `answer` | lo que hay que recuperar | una línea: ≤ 55 caracteres; hasta 90 solo si es conceptual y no cabe sin perder el sentido |
| `contrast` | opcional: con qué se confunde y qué es de verdad, `X → Y` | 0–4 líneas de ≤ 48 caracteres |
| `mnemo` | opcional: lo que dice el propio nombre (`showmount = show mounts`) | ≤ 48 caracteres |

## Cómo se escribe

1. **Si cabe en «X → Y», va en «X → Y».** La tarjeta entera ya es pista → respuesta; el
   contraste también: `required → marca el fallo y sigue`.
2. **Dirección.** Casi siempre *concepto → término*, que es como pregunta el examen
   («¿qué comando…?» → `modprobe`). Si la pregunta es «¿qué hace X?», al revés:
   *término → significado*.
3. **La pista no delata la respuesta.** Si todo lo técnico de la respuesta ya está en la
   pista, no queda nada que recordar.
4. **Respuesta literal** para comandos, rutas, archivos, directivas y valores: `main.cf`,
   `/proc/mdstat`, `2`. Varios elementos, con ` + `: `sendmail + mailq + newaliases`.
5. **Varias respuestas correctas**: la respuesta lista las correctas si son pocas y cortas;
   si sobra una, el contraste dice por qué sobra (`iostat → E/S por dispositivo, no procesos`).
6. **Preguntas negativas** («¿cuál NO…?»): la pista lo dice con NO en mayúsculas o, mejor,
   la tarjeta afirma el hecho positivo que hay que recordar.
7. **Abiertas y conceptuales**: la respuesta es el núcleo de la respuesta modelo, en una
   línea. Si no se puede reducir sin perder el significado, frase más larga pero breve.
   **Nunca se fuerza una mala simplificación.**
8. **Contraste solo si ayuda**: distractores reales que se confunden de verdad. Los que el
   libro da por inventados («/proc/kernel está inventado») o los absurdos no se contrastan.
9. **`mnemo` solo si el nombre lo dice literalmente** (`SOA = start of authority`,
   `showmount = show mounts`). Nada de etimologías dudosas; si no está claro, no se pone.
10. **Español**, conservando los términos técnicos como los usa el material (NFS, runlevel,
    virtual host, loopback…). Sin punto final. Sin «la opción C»: las letras se barajan.

## No se inventa nada

Todo lo técnico de la tarjeta —comando, ruta, archivo, directiva, opción, número, sigla o
nombre propio— tiene que estar en el material de **esa** pregunta: enunciado, opciones,
respuesta, explicación del libro o explicación en llano. Las palabras corrientes, las del
propio banco. `python3 tools/test_micro.py <lote>` lo comprueba y dice qué sobra.

## Ejemplos aprobados

| Pregunta | cue | answer | contrast |
|---|---|---|---|
| SYBEX-AT-21 | exportaciones NFS: listarlas y aplicarlas | exportfs | showmount → quién monta qué · rpcinfo → servicios RPC · nfsstat → estadísticas NFS |
| SYBEX-CH09-RQ11 | dominio de un host virtual | ServerName | DocumentRoot → la carpeta · NameVirtualHost → IP del servidor físico · \<VirtualHost\> → el bloque entero |
| SYBEX-CH01-RQ15 | nivel de ejecución por defecto en Debian | 2 | 5 → gráfico por defecto en Red Hat · 1 → monousuario · 0 → apaga · 6 → reinicia |
| SYBEX-CH11-RQ13 | PAM: corta en seco si falla | requisite | required → marca el fallo y sigue · sufficient → basta si acierta · optional → no bloquea nada |
| SYBEX-CH01-RQ19 | partición que no monta por errores | fsck | mount → acopla · umount → retira · init / telinit → nivel de ejecución |
| SYBEX-AT-26 | Postfix: emulación de sendmail | sendmail + mailq + newaliases | procmail → recetas de cada usuario · mbox → un buzón, un archivo |
| SYBEX-CH04-RQ10 | crear una imagen ISO | mkisofs | cdrecord → la graba en el disco · mkfs → crea sistemas de archivos · mount -t iso9660 → la monta |
| SYBEX-CH05-RQ03 | ¿RAID por software soportado? | /proc/mdstat | /dev/md0 → el array · /etc/mdadm/mdadm.conf → configuración · /dev/mapper → Device Mapper |
| SYBEX-CH07-RQ04 | Postfix: cómo se procesa el correo | main.cf | master.cf → los procesos · /etc/aliases → alias · /var/log/maillog → el registro |
| SYBEX-CH03-RQ12 | cargar un módulo sin saber su archivo | modprobe | insmod → necesita el archivo · rmmod → elimina · lsmod → lista |
| SYBEX-CH12-RQ07 | OpenVAS: simular ataques conocidos | NVT (Network Vulnerability Tests) | NVD → define vulnerabilidades, no simula · interfaz web → manejar OpenVAS |
| SYBEX-CH02-RQ05 | lo cambiado desde la última completa | incremental o diferencial | incremental → desde la última copia · diferencial → desde la última completa |
| SYBEX-CH06-RQ09 | aplicaciones locales hablando entre sí | loopback (bucle local) | MAC → hardware de la tarjeta · hostname → para conexiones remotas |
| SYBEX-AT-01 | info de procesos: los cuatro | lsof + pstree + netstat + pmap | iostat → E/S por dispositivo, no procesos |
| SYBEX-CH08-RQ15 | registro que abre la zona | SOA | NS → servidor de nombres · CNAME → alias · PTR → búsqueda inversa · *mnemo:* SOA = start of authority |
| ENI-CH05-Q02 | compartir /etc/exports sin el servicio NFS | exportfs -a | — |
| ENI-CH09-Q02 | parámetro de sysctl | ruta bajo /proc/sys con puntos en vez de barras | /etc/sysctl.conf → lo permanente, al arrancar |
| ENI-CH01-Q02 | disco que ocupa un pseudosistema de archivos | ninguno: vive en memoria | — |
