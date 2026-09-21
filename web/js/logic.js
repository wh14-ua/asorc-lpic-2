/* ASORC · lógica de quiz — pura, sin DOM.
 *
 * Es la parte probada: barajado estable, mapeo de letras y selección de la
 * frase clave. No toca questions.json ni el estado persistente.
 * Se puede cargar en node para las pruebas.
 */
'use strict';

(function (root) {

  const LETTERS = 'ABCDEFGH';

  /* ------------------------------------------------------------- texto */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Rutas y modificadores de línea de comandos en monoespaciada: son justo
  // lo que hay que reconocer en el examen.
  const CODE_RE = /(^|[\s([«"'])((?:\/[\w.@+-]+(?:\/[\w.@+-]+)*\/?)|(?:--?[A-Za-z][\w-]*))(?=$|[\s.,;:)\]»"'])/g;

  function codify(plain) {
    return esc(plain).replace(CODE_RE, (m, pre, tok) => `${pre}<code>${tok}</code>`);
  }

  // ¿el texto de una opción es un token puramente técnico?
  /* ============================================================ resaltado
   * Marca lo que decide la respuesta y poco más. Se calculan posiciones sobre
   * el TEXTO PLANO y solo al final se escapa y se envuelve: nunca se hace un
   * replace sobre HTML ya generado, que es como se rompen las rutas y las
   * etiquetas tipo <VirtualHost>.
   *
   * Dos significados visuales, no uno:
   *   subrayado ámbar → «lee esto con cuidado» (negación, formato de respuesta)
   *   monoespaciada con fondo → «esto hay que reconocerlo» (comando, ruta)
   */

  // Opciones de una palabra que no son términos técnicos aunque lo parezcan.
  const HL_STOP = new Set(['ninguno', 'ninguna', 'ninguno.', 'todas', 'todos', 'ambos',
    'ambas', 'nada', 'sí', 'si', 'no', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete',
    'verdadero', 'falso', 'correcto', 'correcta', 'incorrecto', 'incorrecta', 'otro',
    'otra', 'none', 'all', 'both', 'true', 'false', 'yes', 'nothing', 'two', 'three']);

  // El vocabulario técnico sale del propio banco: son las opciones de una sola
  // palabra. Así no hay que inventarse una lista de comandos.
  function buildVocab(bank) {
    const v = new Set();
    (bank || []).forEach((q) => {
      const grupos = [q.original_options, q.original_options_es];
      grupos.forEach((g) => (g || []).forEach((o) => {
        const t = String(o && o.text || '').trim();
        if (!t || /\s/.test(t)) return;
        if (t.length < 2 || t.length > 40) return;
        if (HL_STOP.has(t.toLowerCase().replace(/[.,;:]$/, ''))) return;
        v.add(t.replace(/[.,;:]$/, ''));
      }));
    });
    return v;
  }

  const HL_RULES = [
    // 1 · «lee esto con cuidado»
    // Solo el núcleo: subrayar la frase entera es mucho subrayado y se come
    // el presupuesto de marcado del resto del enunciado.
    { cls: 'warn', pri: 1, re: /\bElija\s+todas\b/gi },
    { cls: 'warn', pri: 1, re: /\bChoose\s+all\b/gi },
    { cls: 'warn', pri: 1, re: /\bElija (?:dos|las dos)\b/gi },
    { cls: 'warn', pri: 1, re: /\bChoose two\b/gi },
    { cls: 'warn', pri: 1, re: /\bRellene\b/gi },
    { cls: 'warn', pri: 1, re: /\bNOT?\b/g },
    { cls: 'warn', pri: 1,
      re: /\bno\b(?=\s+(?:es|son|se|puede|pueden|debe|deben|hace|hacen|tiene|tienen|existe|existen|requiere|funciona|vale|sirve)\b)/gi },
    { cls: 'warn', pri: 1, re: /\bexcept(?:o)?\b/gi },
    { cls: 'warn', pri: 1, re: /\bincorrect[ao]s?\b/gi },
    { cls: 'warn', pri: 1, re: /\bfals[ao]s?\b/gi },

    // 1b · el sustantivo por el que se pregunta: «¿Qué COMANDO…?»
    { cls: 'term', pri: 2.8, g: 1,
      re: /\b(?:qu[eé]|cu[aá]l(?:es)?|which|what)\s+(?:de\s+(?:los|las)\s+siguientes\s+)?(comandos?|archivos?|ficheros?|directivas?|utilidad(?:es)?|opci[oó]n(?:es)?|par[aá]metros?|ajustes?|m[oó]dulos?|programas?|servicios?|demonios?|carpetas?|directorios?|puertos?|protocolos?|herramientas?|niveles?|sistemas? de archivos)\b/gi },
    // «el comando sdparm», «la utilidad rndc»: el sustantivo delata que lo que
    // viene detrás es un nombre técnico, aunque no esté en el vocabulario.
    { cls: 'code', pri: 1.8, g: 1,
      re: /\b(?:comando|utilidad|programa|archivo|fichero|directiva|m[oó]dulo|demonio|paquete|script)\s+([a-z][\w.-]{2,})\b/g,
      // «el comando sysctl» sí; «el comando permite» no. Un verbo español no
      // lleva puntuación ni dígitos y no está en el vocabulario del banco.
      ok: (t, vocab) => /[._/-]|\d/.test(t) || (vocab && vocab.has(t)) },
    // 1c · términos que son el tema de la pregunta, no palabras corrientes
    { cls: 'term', pri: 2.45,
      re: /\b(?:kernel|swap|runlevel|firmware|shell|hostname|host|daemon|tarball|striping|paridad|parity)\b/gi },
    { cls: 'term', pri: 2.45,
      re: /\b(?:Debian|Ubuntu|CentOS|Red\s+Hat|Linux|Unix|Windows|Apache|Nginx|Samba|Postfix|Dovecot|Courier|Squid|Snort|Kerberos|Active\s+Directory|Master\s+Boot\s+Record)\b/g },

    // 2 · «esto hay que reconocerlo»
    { cls: 'code', pri: 2, re: /<\/?[A-Za-z][\w]*>/g },
    { cls: 'code', pri: 2, re: /(?:~)?(?:\/[\w.~+-]+)+\/?/g },
    { cls: 'code', pri: 2, re: /\$[A-Za-z_]\w*(?:\/[\w.~+-]+)*/g },
    { cls: 'code', pri: 2, re: /\b[\w-]+_[\w.-]+\b/g },
    { cls: 'code', pri: 2, re: /\b[\w-]+\.[A-Za-z][\w.-]*\b/g },
    { cls: 'code', pri: 2, re: /(?<=^|[\s(¿"«·])--?[A-Za-z][\w-]*/g },
    { cls: 'code', pri: 2.6, re: /\b[a-z]{2,}\d{1,2}\b/g },      // ext4, md0, eth2

    // 3 · tecnologías y directivas
    { cls: 'term', pri: 3, re: /\bIPv[46]\b/g },
    { cls: 'term', pri: 3, re: /\b[A-Z]{2,}\d*\b/g },
    { cls: 'term', pri: 3, re: /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]*)+\b/g },

    // 4 · números con significado
    { cls: 'num', pri: 4,
      re: /\b(?:RAID|nivel(?:es)? de ejecución|runlevel|puerto|port|opción|option)\s+\d+\b/gi },
    { cls: 'num', pri: 4, re: /\b\d+(?:[.,]\d+)?\s?(?:bits?|MiB|GiB|KiB|[KMG]B)\b/gi },
  ];

  const HL_WORD = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][\w./~+$-]*/g;

  function hlClassFor(w) {
    if (/[/_$]/.test(w) || /^[.-]/.test(w) || /\w\.\w/.test(w)) return 'code';
    if (/^\d+$/.test(w)) return 'num';
    if (/^[A-Z]{2,}\d*$/.test(w)) return 'term';
    if (/^[A-Z][a-z]+(?:[A-Z]\w*)+$/.test(w)) return 'term';
    if (/^[A-Z][a-z]+$/.test(w)) return 'term';        // Snort, Samba, Apache

    return 'code';                    // comando pelado: sysctl, lsmod, mount…
  }

  function highlightTechnicalText(text, opts) {
    const s = String(text == null ? '' : text);
    if (!s) return '';
    const o = opts || {};
    const vocab = o.vocab || null;
    const max = o.max == null ? 4 : o.max;
    const ratio = o.ratio == null ? 0.3 : o.ratio;

    const spans = [];
    HL_RULES.forEach((rule) => {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(s)) !== null) {
        if (!m[0]) { rule.re.lastIndex++; continue; }
        // Algunas reglas marcan solo un grupo: en «¿Qué comando…» interesa
        // «comando», no el «¿Qué» que lo precede.
        const g = rule.g || 0;
        if (g && m[g] == null) continue;
        if (rule.ok && !rule.ok(g ? m[g] : m[0], vocab)) continue;
        const a = g ? m.index + m[0].indexOf(m[g]) : m.index;
        const txt = g ? m[g] : m[0];
        let b = a + txt.length;
        // El punto final de la frase no forma parte de la ruta: «known_hosts.»
        // sobra el punto, pero «smb.conf» lo necesita.
        while (b > a + 1 && /[.,;:]/.test(s[b - 1]) && (b >= s.length || /\s/.test(s[b]))) b--;
        spans.push({ a, b, cls: rule.cls, pri: rule.pri });
      }
    });
    if (vocab && vocab.size) {
      HL_WORD.lastIndex = 0;
      let m;
      while ((m = HL_WORD.exec(s)) !== null) {
        const w = m[0];
        if (!vocab.has(w)) continue;
        spans.push({ a: m.index, b: m.index + w.length, cls: hlClassFor(w), pri: 2.5 });
      }
    }
    if (!spans.length) return esc(s);

    // Sin solapes: gana la prioridad y, a igualdad, el más largo.
    spans.sort((x, y) => x.pri - y.pri || (y.b - y.a) - (x.b - x.a) || x.a - y.a);
    const keep = [];
    spans.forEach((sp) => {
      if (keep.some((k) => sp.a < k.b && k.a < sp.b)) return;
      keep.push(sp);
    });

    // Ni demasiados ni media frase: los de menos prioridad caen primero.
    keep.sort((x, y) => x.pri - y.pri || x.a - y.a);
    const palabras = s.trim().split(/\s+/).length;
    const tope = palabras > 6 ? Math.floor(s.length * ratio) : s.length;
    const elegidos = [];
    let usado = 0;
    for (const sp of keep) {
      if (elegidos.length >= max) break;
      const largo = sp.b - sp.a;
      if (usado + largo > tope && elegidos.length) continue;
      elegidos.push(sp);
      usado += largo;
    }

    elegidos.sort((x, y) => x.a - y.a);
    let out = '', i = 0;
    elegidos.forEach((sp) => {
      out += esc(s.slice(i, sp.a));
      const trozo = esc(s.slice(sp.a, sp.b));
      out += sp.cls === 'code'
        ? `<code class="hl-code">${trozo}</code>`
        : `<span class="hl-${sp.cls}">${trozo}</span>`;
      i = sp.b;
    });
    return out + esc(s.slice(i));
  }

  function isTechnical(t) {
    const s = String(t).trim();
    if (!s) return false;
    if (!/\s/.test(s)) return true;
    return /^[\w./~$*-]+(\s+[-\w./~$*=]+)*$/.test(s) && s.split(/\s+/).length <= 5;
  }

  function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ------------------------------------------- reescritura de las letras
   * El libro dice «option C» / «la opción C», pero las opciones se barajan.
   * Se traducen esas referencias a la letra que se ve en pantalla; una opción
   * que el modo ASORC no muestra se cita por su texto.
   */
  const REF_WORDS = ['option', 'answer', 'opciones', 'opción', 'respuesta'];
  const isAlnum = (ch) => !!ch && /[0-9A-Za-zÀ-ÿ]/.test(ch);

  function remapExplanation(text, origToShown, droppedText) {
    if (!text) return '';
    const mapLetter = (L) => {
      if (origToShown[L]) return origToShown[L];
      if (droppedText[L] != null) {
        const t = droppedText[L];
        return '«' + (t.length > 34 ? t.slice(0, 34) + '…' : t) + '»';
      }
      return L;
    };

    let out = '';
    let i = 0;
    const low = text.toLowerCase();

    while (i < text.length) {
      let hit = null;
      const boundaryL = i === 0 || !isAlnum(text[i - 1]);
      if (boundaryL) {
        for (const w of REF_WORDS) {
          if (low.startsWith(w, i)) { hit = w; break; }
        }
      }
      if (!hit) { out += text[i++]; continue; }

      let j = i + hit.length;
      if (hit !== 'opciones' && (text[j] === 's' || text[j] === 'S')) j++;
      if (isAlnum(text[j])) { out += text[i++]; continue; }   // p.ej. "optional"

      const head = text.slice(i, j);
      let tail = '', k = j, got = false;

      for (;;) {
        const save = k;
        let sep = '';
        while (k < text.length && (text[k] === ' ' || text[k] === ',')) sep += text[k++];
        if (low.startsWith('and ', k)) { sep += 'and '; k += 4; }
        else if ((text[k] === 'y' || text[k] === 'Y') && text[k + 1] === ' ') { sep += text[k] + ' '; k += 2; }
        while (k < text.length && text[k] === ' ') sep += text[k++];

        const c = text[k];
        if (c >= 'A' && c <= 'E' && !isAlnum(text[k + 1])) {
          tail += sep + mapLetter(c);
          k++;
          got = true;
          // rango "A through D" -> lista de letras mostradas
          const save2 = k;
          let m = k;
          while (text[m] === ' ') m++;
          if (low.startsWith('through ', m)) {
            m += 8;
            while (text[m] === ' ') m++;
            const c2 = text[m];
            if (c2 >= 'A' && c2 <= 'E' && !isAlnum(text[m + 1]) && c2 > c) {
              for (let ch = c.charCodeAt(0) + 1; ch <= c2.charCodeAt(0); ch++) {
                const L = String.fromCharCode(ch);
                tail += (L === c2 ? ' y ' : ', ') + mapLetter(L);
              }
              k = m + 1;
            } else { k = save2; }
          }
          continue;
        }
        k = save;
        break;
      }

      if (!got) { out += text[i++]; continue; }
      out += head + tail;
      i = k;
    }
    return out;
  }

  /* --------------------------------------------------- frase clave
   * La idea que hay que memorizar: la frase del libro que dice por qué la
   * correcta es correcta. Se muestra grande y se quita del cuerpo.
   */
  const POSITIVE = /\b(correct(a|o)?|acertad|is the (right|best|correct))\b/i;
  const NEGATIVE = /\b(incorrect|errón|equivocad|wrong)\b/i;
  // "Por tanto, la opción C es la respuesta correcta." no enseña nada por sí
  // sola: es un veredicto, no el dato que hay que memorizar.
  const VERDICT_ONLY = /^(por (lo )?tanto|as[ií] que|thus|therefore|so)?[,\s]*(la |el )?(opci[oó]n|option|answer|respuesta)\s+[A-E]\b[^.]{0,70}\.?$/i;

  // Corta por frases, pero SOLO en un punto seguido de espacio o de fin de
  // texto. Si no, "/etc/resolv.conf" o "version 4.5" partirían la frase por la
  // mitad, que es justo lo que pasaba antes.
  function sentences(text) {
    const s = String(text);
    const out = [];
    let start = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '.' && (i + 1 >= s.length || /\s/.test(s[i + 1]))) {
        out.push(s.slice(start, i + 1).trim());
        start = i + 1;
      }
    }
    if (start < s.length) out.push(s.slice(start).trim());
    return out.filter(Boolean);
  }

  // Devuelve el índice de la frase clave dentro de `parts`.
  function keyIndex(parts, letters) {
    const named = [];
    parts.forEach((p, i) => {
      if (!POSITIVE.test(p) || NEGATIVE.test(p)) return;
      if (letters.some((L) => new RegExp(`\\b${L}\\b`).test(p))) named.push(i);
    });
    if (named.length) return named[0];
    for (let i = 0; i < parts.length; i++) {
      if (POSITIVE.test(parts[i]) && !NEGATIVE.test(parts[i])) return i;
    }
    return 0;
  }

  function keySentence(text, letters) {
    const parts = sentences(text);
    if (!parts.length) return '';
    const i = keyIndex(parts, letters);
    // Si la frase elegida solo dicta el veredicto, se arrastra la siguiente,
    // que suele traer el hecho aprovechable.
    if (VERDICT_ONLY.test(parts[i]) && parts[i + 1]) {
      return parts[i] + ' ' + parts[i + 1];
    }
    return parts[i];
  }

  // Quita la frase clave del cuerpo, esté donde esté (si no, saldría dos veces).
  function splitExplanation(mapped, correctLabels) {
    const parts = sentences(mapped);
    if (!parts.length) return { key: '', rest: mapped };
    const i = keyIndex(parts, correctLabels);
    const take = (VERDICT_ONLY.test(parts[i]) && parts[i + 1]) ? [i, i + 1] : [i];
    const key = take.map((k) => parts[k]).join(' ');
    // El cuerpo se arma desde los índices, no buscando la cadena: así la frase
    // clave nunca aparece dos veces aunque cambie el espaciado.
    const rest = parts.filter((_, k) => !take.includes(k)).join(' ');
    return { key, rest };
  }

  /* =================================================================
   *  Modo Ráfaga: idea corta + explicación por fragmentos
   * ================================================================= */

  // Coletilla de veredicto: "..., así que la opción C es correcta."
  const VERDICT_TAIL =
    /[,;]?\s*(?:y\s+)?(?:as[ií]\s+que|por\s+(?:lo\s+)?tanto|por\s+eso|de\s+ah[ií]\s+que|lo\s+que\s+hace|con\s+lo\s+que|so|thus|therefore|hence|making|which\s+makes?)\s+(?:que\s+)?(?:la\s+|el\s+)?(?:opci[oó]n|option|answer|respuesta)\s+[A-H]\b[^.]*\.?\s*$/i;
  // También al principio: "La opción C es correcta porque ..."
  const VERDICT_HEAD =
    /^\s*(?:por\s+(?:lo\s+)?tanto|as[ií]\s+que|thus|therefore|so)?[,\s]*(?:la\s+|el\s+)?(?:opci[oó]n|option|answer|respuesta)\s+[A-H]\b\s*(?:es|is)\s+(?:la\s+|una?\s+|the\s+|an?\s+)?(?:respuesta\s+|answer\s+|elecci[oó]n\s+|choice\s+|opci[oó]n\s+)?(?:correcta|correcto|correct|right|best|acertada)[,\s]*(?:porque|ya\s+que|puesto\s+que|debido\s+a\s+que|because|since|as)?\s*/i;

  const CONNECTOR_HEAD =
    /^\s*(?:y|e|o|u|pero|mas|que|porque|pues|ya\s+que|and|or|but|that|because|since|which|who)\s+/i;
  // Palabras vacías que dejarían la frase colgando si se corta ahí
  const DANGLING_TAIL =
    /[\s,]+(?:en|de|del|de\s+la|a|al|para|por|con|sin|sobre|desde|hasta|como|y|e|o|u|el|la|los|las|un|una|su|sus|in|on|at|to|for|from|with|of|the|a|an|its|and|or)\s*$/i;

  // Veredicto que no nombra la letra: "..., así que todas son incorrectas."
  const VERDICT_TAIL_BARE =
    /[,;]?\s*(?:y\s+)?(?:as[ií]\s+que|por\s+(?:lo\s+)?tanto|por\s+eso|so|thus|therefore|hence)\s+(?:todas?\s+|ambas?\s+|ninguna\s+|tambi[eé]n\s+|no\s+)*(?:son|es|ser[ií]an?|are|is)\s+(?:todas?\s+|tambi[eé]n\s+)?(?:una\s+)?(?:elecci[oó]n\s+|opci[oó]n\s+|respuesta\s+|choice\s+|answer\s+)?(?:in)?correct[ao]?s?[^.]*\.?\s*$/i;

  function stripVerdict(t) {
    let out = String(t || '').trim();
    out = out.replace(VERDICT_TAIL, '');
    out = out.replace(VERDICT_TAIL_BARE, '');
    out = out.replace(VERDICT_HEAD, '');
    return out.trim();
  }

  function trimDangling(t) {
    let out = String(t || '').trim().replace(/[.,;:]+$/, '');
    let prev = null;
    while (prev !== out) { prev = out; out = out.replace(DANGLING_TAIL, ''); }
    return out.replace(CONNECTOR_HEAD, '').trim();
  }

  const wordsOf = (t) => String(t || '').trim().split(/\s+/).filter(Boolean);

  /* Mayúscula inicial, pero NUNCA sobre el término de la respuesta: `sysctl`
   * y `mkswap` son nombres de comando y "Sysctl" sería sencillamente falso. */
  function upperFirst(t, keep) {
    const s = String(t || '').trim();
    if (!s) return s;
    const first = s.split(/\s+/)[0];
    const keepFirst = keep ? String(keep).split(/\s+/)[0] : '';
    if (keepFirst && first.replace(/[.,;:)]+$/, '') === keepFirst) return s;
    if (/^[\/~.$-]/.test(first) || /[_\/]/.test(first) || /^[a-z]+[A-Z0-9]/.test(first)) return s;
    return s[0].toLocaleUpperCase('es') + s.slice(1);
  }

  function capWords(t, max) {
    const w = wordsOf(t);
    if (w.length <= max) return t.trim();
    return trimDangling(w.slice(0, max).join(' '));
  }

  // ¿merece salir como término destacado en monoespaciada?
  function isTerm(t) {
    const s = String(t || '').trim();
    if (!s || s.length > 42) return false;
    return isTechnical(s) || wordsOf(s).length <= 3;
  }

  /* La idea en una línea. Se saca del propio libro: nada inventado, solo
   * recortado. El término (ruta, comando…) se deja DENTRO de la frase, que es
   * como se lee natural: "se listan en /etc/resolv.conf mediante nameserver".
   * `term` sale aparte solo para poder resaltarlo. */
  /* "El módulo pam_ldap.so usa..." -> "pam_ldap.so usa...": el sustantivo
   * genérico delante del término no aporta y roba espacio a la idea. */
  const GENERIC_HEAD =
    /^\s*(?:el|la|los|las|un|una|the|a|an)\s+(?:m[oó]dulo|comando|archivo|fichero|directiva|utilidad|programa|opci[oó]n|pol[ií]tica|estilo|ajuste|par[aá]metro|paquete|servicio|protocolo|proceso|demonio|daemon|command|file|directive|utility|program|option|policy|setting|package|service|protocol)s?\s+/i;

  function nutshell(answerTexts, explanation, maxWords = 10) {
    const answers = (answerTexts || []).map((a) => String(a).trim()).filter(Boolean);
    const expl = String(explanation || '').trim();
    const terms = answers.filter(isTerm);

    if (!expl) return { line: answers.join(' · '), terms, srcIndex: -1 };

    // Se puntúan todas las frases y se descartan las que solo dictan veredicto
    // ("La opción D también es correcta"): no enseñan nada.
    const parts = sentences(expl);
    const cands = parts.map((raw, i) => {
      const clean = trimDangling(stripInlineRefs(stripVerdict(raw)));
      const n = wordsOf(clean).length;
      let score = n >= 5 ? Math.min(n, 16) : -10;
      if (isVerdictish(clean)) score -= 30;
      if (answers[0] && clean.includes(answers[0])) score += 14;
      if (techCount(clean)) score += 4;
      score -= i * 0.6;                    // a igualdad, la primera manda
      return { clean, score, i };
    });
    cands.sort((a, b) => b.score - a.score);
    const best = cands[0] && cands[0].score > -20 ? cands[0] : null;
    const srcIndex = best ? best.i : keyIndex(parts, []);
    let base = best ? best.clean : stripVerdict(parts[srcIndex] || parts[0] || expl);

    // Si la respuesta aparece, quedarse con la cláusula que la contiene: es la
    // que la define. Se descarta si queda demasiado corta para decir algo.
    const needle = answers[0];
    if (needle && base.includes(needle)) {
      const clauses = base.split(/\s*(?:,|;|\s+y\s+|\s+and\s+|\s+pero\s+|\s+but\s+)\s*/)
        .filter(Boolean);
      const hit = clauses.find((c) => c.includes(needle));
      if (hit && wordsOf(hit).length >= 5) base = hit;
    }

    let line = trimDangling(stripInlineRefs(stripVerdict(base)));
    // Quitar el sustantivo genérico solo si justo detrás viene el término.
    const head = line.match(GENERIC_HEAD);
    const firstTok = needle ? needle.split(/\s+/)[0] : '';
    if (head && firstTok && line.slice(head[0].length).startsWith(firstTok)) {
      line = line.slice(head[0].length);
    }
    line = capClause(line, maxWords, 2, needle || '');
    if (wordsOf(line).length < 3) {
      line = capClause(trimDangling(stripInlineRefs(stripVerdict(parts[srcIndex] || expl))),
                       maxWords, 2, needle || '');
    }
    line = upperFirst(line, needle);
    return { line, terms, srcIndex };
  }

  /* El texto sin la frase de la que salió la idea: es lo que se cuenta luego
   * en fragmentos, para no repetir lo mismo dos veces. */
  function withoutSentence(text, idx) {
    const parts = sentences(text);
    if (idx == null || idx < 0 || idx >= parts.length) return text;
    return parts.filter((_, i) => i !== idx).join(' ').trim();
  }

  /* Recorta a `max` palabras sin dejar la frase a medias: si faltan pocas para
   * terminar, se dejan; si no, se corta en el último límite de cláusula.
   * `keep` (la ruta o comando de la respuesta) nunca se queda fuera: sería
   * justo la palabra que hay que recordar. */
  function capClause(t, max, slack = 4, keep = '') {
    const w = wordsOf(t);
    if (w.length <= max + slack) return trimDangling(t);

    let limit = max;
    if (keep) {
      const at = w.findIndex((x) => x.replace(/[.,;:)]+$/, '').includes(keep));
      if (at >= 0 && at + 1 > limit) limit = Math.min(at + 1, max + 8);
    }
    const head = w.slice(0, limit);
    if (limit >= w.length) return trimDangling(head.join(' '));
    // Si lo último conservado es el propio término, los puntos suspensivos
    // solo ensucian: la idea ya está completa.
    if (keep && head[head.length - 1] && head[head.length - 1].includes(keep)) {
      return trimDangling(head.join(' '));
    }
    for (let i = head.length - 1; i >= Math.min(5, head.length - 1); i--) {
      if (/[,;:]$/.test(head[i])) return trimDangling(head.slice(0, i + 1).join(' '));
    }
    return trimDangling(head.join(' ')) + '…';
  }

  /* ¿La frase solo dicta el veredicto? Menciona una opción, no trae ningún
   * token técnico y es corta: no aporta nada memorizable. */
  function isVerdictish(t) {
    const s = String(t || '');
    if (!/(opci[oó]n|option|answer|respuesta)\s+[A-H]\b/i.test(s)) return false;
    if (techCount(s)) return false;
    return wordsOf(s).length <= 11;
  }

  // "El archivo X, opción A, contiene…" -> en una idea corta eso solo estorba.
  const INLINE_REF =
    /\s*[,(]\s*(?:la[s]?\s+|el\s+|los\s+)?(?:opci[oó]n(?:es)?|option[s]?|answer[s]?|respuesta[s]?)\s+[A-H](?:\s*(?:,|y|e|and|o|or)\s*[A-H])*\s*(?:[,)]|(?=\s))/gi;
  function stripInlineRefs(t) {
    return String(t || '')
      // Si la referencia iba entre paréntesis se borra entera; si iba entre
      // comas, se conserva una sola coma.
      .replace(INLINE_REF, (m) => (m.trim().startsWith('(') ? ' ' : ', '))
      .replace(/\s*,\s*,/g, ',')
      .replace(/,\s*(?=[,.;:)])/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .trim();
  }

  /* Texto para la ráfaga: el contenido del libro sin las coletillas de
   * veredicto ("así que la opción B es incorrecta"). En formato subtítulo no
   * enseñan nada —las tarjetas ya muestran cuál falló— y el texto íntegro
   * sigue disponible en "Ver explicación completa del libro". */
  function conceptText(text) {
    return sentences(text)
      .map((p) => trimDangling(stripInlineRefs(stripVerdict(p))))
      .filter((p) => wordsOf(p).length >= 4 && !isVerdictish(p))
      .map((p) => (/[.!?]$/.test(p) ? p : p + '.'))
      .join(' ')
      .trim();
  }

  /* Trocea la explicación en fragmentos semánticos de 4–10 palabras,
   * cortando por puntuación y por conectores, nunca palabra a palabra. */
  const BREAK_BEFORE = new Set([
    'y', 'e', 'o', 'u', 'pero', 'porque', 'pues', 'aunque', 'mientras', 'cuando',
    'si', 'que', 'donde', 'para', 'con', 'sin', 'desde', 'hasta', 'sobre', 'según',
    'and', 'or', 'but', 'because', 'while', 'when', 'if', 'that', 'which', 'where',
    'so', 'thus', 'with', 'without', 'from', 'until', 'about', 'for',
  ]);

  // Determinantes y preposiciones: cortar justo detrás deja el fragmento
  // colgando ("...contra los" / "sistemas").
  const NO_END = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'lo',
    'de', 'en', 'a', 'con', 'por', 'para', 'sin', 'sobre', 'su', 'sus', 'mi',
    'y', 'e', 'o', 'u', 'que', 'se', 'no', 'es', 'como', 'más', 'así', 'asi',
    'ya', 'ni', 'muy', 'tan', 'cada', 'este', 'esta', 'ese', 'esa',
    'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'with', 'its', 'and',
    'or', 'is', 'are', 'as', 'by', 'at', 'from', 'that',
  ]);
  const bare = (w) => String(w).toLowerCase()
    .replace(/^[¿¡("«]+/, '').replace(/[.,;:)"»!?]+$/, '');

  function chunks(text, min = 4, max = 10) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const words = raw.split(/\s+/).filter(Boolean);
    const out = [];
    let cur = [];

    const flush = () => { if (cur.length) { out.push(cur.join(' ')); cur = []; } };

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const next = words[i + 1];
      cur.push(w);
      const endsClause = /[.,;:]$/.test(w);
      const nextBreaks = next && BREAK_BEFORE.has(
        next.toLowerCase().replace(/^[¿¡("«]+/, '').replace(/[.,;:)"»]+$/, ''));

      // Tampoco cortar tras una letra suelta de opción ("Las opciones A, C" | "y E").
      const loneLetter = /^[A-H]$/.test(bare(w).toUpperCase()) && bare(w).length === 1;
      const endsBadly = (NO_END.has(bare(w)) && !endsClause) || loneLetter;
      if (cur.length >= max && !endsBadly) { flush(); continue; }
      if (cur.length >= max + 2) { flush(); continue; }   // tope duro
      if (cur.length >= min && (endsClause || nextBreaks) && !endsBadly) { flush(); }
    }
    flush();

    // Une los restos demasiado cortos con el fragmento anterior.
    const merged = [];
    for (const c of out) {
      const n = wordsOf(c).length;
      if (n < min && merged.length && wordsOf(merged[merged.length - 1]).length + n <= max + 3) {
        merged[merged.length - 1] += ' ' + c;
      } else {
        merged.push(c);
      }
    }
    return merged;
  }

  // Tokens que piden un respiro extra: rutas, comandos, opciones, siglas.
  const TECH_TOKEN = /(^|[\s(«"'])(\/[\w.@+-]*|--?[A-Za-z][\w-]+|[A-Z]{2,}|[\w.-]+\.(?:conf|cfg|d|so|log|json|sh|c|h)|\w+_\w+)(?=$|[\s.,;:)»"'])/g;

  function techCount(t) {
    const m = String(t || '').match(TECH_TOKEN);
    return m ? m.length : 0;
  }

  /* Duración de un fragmento: proporcional a su longitud, con tiempo extra
   * por cada token técnico. `speed` 0.75–1.5 (mayor = más rápido). */
  function chunkDuration(chunk, { wpm = 275, speed = 1, min = 650, max = 3800 } = {}) {
    const n = wordsOf(chunk).length;
    const base = (n / wpm) * 60000;
    const extra = techCount(chunk) * 220;
    const d = Math.min(max, Math.max(min, base + extra));
    return Math.round(d / (speed || 1));
  }

  /* ¿Hace falta animar? Con explicaciones cortas, no. */
  function needsBurst(gist, rest, minWords = 22) {
    return wordsOf(rest).length >= minWords;
  }

  /* ------------------------------------------------------------- vista
   * Baraja UNA vez. Al cambiar de idioma solo cambia el texto: el orden y
   * las letras en pantalla se mantienen.
   */
  function buildView(q, asorcMode) {
    let opts = q.original_options || [];
    if (asorcMode && q.asorc && q.asorc.eligible) {
      const keep = new Set(q.asorc.kept_option_labels || []);
      opts = opts.filter((o) => keep.has(o.label));
    }
    const esByLabel = {};
    (q.original_options_es || []).forEach((o) => { esByLabel[o.label] = o.text; });

    const shown = shuffled(opts).map((o, idx) => ({
      label: o.label,                 // etiqueta original del libro
      L: LETTERS[idx],                // letra que se ve en pantalla
      n: idx + 1,                     // índice 1..n (tecla numérica)
      en: o.text,
      es: esByLabel[o.label] || o.text,
    }));

    const correctOrig = asorcMode && q.asorc && q.asorc.eligible
      ? [q.asorc.correct_label]
      : (Array.isArray(q.correct_answer) ? q.correct_answer.slice() : []);

    const origToShown = {};
    shown.forEach((o) => { origToShown[o.label] = o.L; });
    const droppedText = {};
    (q.original_options || []).forEach((o) => {
      if (!origToShown[o.label]) droppedText[o.label] = esByLabel[o.label] || o.text;
    });

    const correct = shown.filter((o) => correctOrig.includes(o.label));

    return {
      q, asorcMode, shown, correctOrig, origToShown, droppedText,
      correctL: correct.map((o) => o.L),
      correctN: correct.map((o) => o.n),
    };
  }

  const stemOf = (v, lang) => {
    const q = v.q;
    if (v.asorcMode && q.asorc) {
      const s = lang === 'en' ? q.asorc.question : (q.asorc.question_es || q.asorc.question);
      if (s) return s;
    }
    return lang === 'en' ? q.question : (q.question_es || q.question);
  };
  const explOf = (v, lang) =>
    lang === 'en' ? v.q.explanation : (v.q.explanation_es || v.q.explanation);
  const modelOf = (q, lang) =>
    lang === 'en' ? (q.model_answer || q.source_answer)
                  : (q.model_answer_es || q.model_answer || q.source_answer);
  const fillOf = (q, lang) =>
    lang === 'en' ? q.correct_answer : (q.correct_answer_es || q.correct_answer);

  /* --------------------------------------------------------- corrección */
  // Compara el conjunto marcado con el correcto (misma regla que la terminal).
  function grade(pickedLetters, correctLetters) {
    const got = [...pickedLetters].sort();
    const want = [...correctLetters].sort();
    if (!got.length) return 'blank';
    if (got.length === want.length && got.every((v, i) => v === want[i])) return 'correct';
    return 'wrong';
  }

  const API = {
    LETTERS, esc, codify, isTechnical, shuffled,
    highlightTechnicalText, buildVocab,
    remapExplanation, keySentence, splitExplanation, sentences,
    buildView, stemOf, explOf, modelOf, fillOf, grade,
    nutshell, chunks, chunkDuration, needsBurst, stripVerdict, trimDangling,
    capClause, isTerm, stripInlineRefs, isVerdictish, withoutSentence, conceptText,
  };

  root.Logic = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
