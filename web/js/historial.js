/* ASORC · historial de tests — cada ronda cerrada, pregunta a pregunta.
 *
 * Las rondas cerradas ya se guardan (ST.stats.sesiones) y viajan a la nube en
 * asorc_sessions, con payload JSONB. Desde ahora cada ronda nueva lleva
 * además, en ese mismo payload, qué pasó en cada pregunta:
 *
 *   attempts: [{ question_id, result, answer, scoreDelta, scoreAfter,
 *                answerMs, topic }]
 *
 * Ni el enunciado ni las opciones se copian: salen de questions.json por
 * question_id. Lo que sí se guarda es lo que marcaste (answer, con las
 * etiquetas del libro), porque eso no se puede reconstruir.
 *
 * Los intentos de asorc_attempts no llevan ronda, así que las sesiones de
 * antes no tienen detalle: aparecen igual, pero no se reconstruyen por fechas
 * ni se les inventa ninguna asociación.
 *
 * Arriba, lo puro (se prueba en node); abajo, la pantalla.
 */
'use strict';

(function (root, doc) {

  /* ================================================================ puro */

  // Identificador de una sesión: su uid o, en las viejas, la misma clave con
  // la que store.js las funde.
  const clave = (s) => (s && s.uid) || `${s && s.ts}|${(s && s.modo) || ''}|${(s && s.respondidas) || 0}`;
  const tieneDetalle = (s) => !!s && Array.isArray(s.attempts);
  // Solo lo que tiene forma de intento: la nube la puede escribir cualquiera.
  const validos = (s) => s.attempts.filter((a) => a && typeof a.question_id === 'string');

  /* Lo que la ronda añade a su registro de sesión: formato, tamaño, puntos
   * y, por pregunta, lo mínimo para rehacerla. temaDe(id) viene del banco. */
  function detalle(run, temaDe, total) {
    const log = (run && run.academic && run.academic.log) || [];
    return {
      asorc: !!(run && run.asorc),
      total: total | 0,
      puntos: run && run.academic ? run.academic.points : 0,
      attempts: log.map((e) => ({
        question_id: e.id,
        result: e.result,
        answer: (e.picked || []).join(','),
        scoreDelta: e.delta,
        scoreAfter: e.after,
        answerMs: e.ms | 0,
        topic: temaDe(e.id) || '',
      })),
    };
  }

  // Más reciente primero.
  const ordenadas = (sesiones) => (sesiones || []).slice().sort((a, b) => (b.ts | 0) - (a.ts | 0));

  /* Las sesiones de un tema: las nuevas que tienen alguna pregunta de ese
   * tema y, de las viejas, solo las que se lanzaron para ese tema (su etiqueta
   * es el tema, o lo incluye en una mezcla «A + B»). Un sprint viejo no se
   * sabe qué temas tocó, así que no sale. */
  function deTema(sesiones, tema) {
    return ordenadas(sesiones).filter((s) => (tieneDetalle(s)
      ? validos(s).some((a) => a.topic === tema)
      : String(s.modo || '').split(' + ').includes(tema)));
  }

  // Los intentos a enseñar: todos o, desde el historial de un tema, los suyos.
  function intentos(s, o) {
    if (!tieneDetalle(s)) return [];
    const tema = o && o.tema;
    return tema ? validos(s).filter((a) => a.topic === tema) : validos(s);
  }

  const FALLO = ['wrong', 'partial'];
  const FILTROS = {
    todas: () => true,
    falladas: (a) => FALLO.includes(a.result),
    acertadas: (a) => a.result === 'correct',
    blanco: (a) => a.result === 'blank',
  };
  const filtra = (lista, f) => lista.filter(FILTROS[f] || FILTROS.todas);
  const cuenta = (lista) => Object.fromEntries(Object.keys(FILTROS).map((f) => [f, filtra(lista, f).length]));

  const unicas = (ids) => [...new Set(ids)];
  // REPASAR ESTAS FALLADAS: solo las falladas (a medias cuenta como fallada).
  const paraRepasar = (lista) => unicas(filtra(lista, 'falladas').map((a) => a.question_id));
  // REPETIR TEST: las mismas preguntas y en el mismo orden.
  const paraRepetir = (lista) => unicas(lista.map((a) => a.question_id));

  /* ============================================================ pantalla */

  const $ = (id) => doc.getElementById(id);
  let ctx = null;     // { store, bank: Map, simple, A, resalta, codifica, muestra, volver, repasar, repetir }
  let vista = null;   // { s, tema, filtro }
  let cuantas = 8;    // filas visibles en el inicio

  // Lo que viene de una sesión (la nube la puede escribir cualquiera con la
  // URL) nunca entra en HTML sin escapar.
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function el(tag, cls, txt) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  // «hoy · 18:32», «ayer · 09:10», «23 sep 2026 · 18:32»
  function cuando(ts) {
    const d = new Date((Number(ts) || 0) * 1000);
    const hoy = new Date();
    const ayer = new Date(hoy.getTime() - 86400000);
    const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoy.toDateString()) return `hoy · ${hora}`;
    if (d.toDateString() === ayer.toDateString()) return `ayer · ${hora}`;
    return `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${hora}`;
  }

  const segundos = (ms) => ((Number(ms) || 0) / 1000).toFixed(1).replace('.', ',') + ' s';

  // ✓ 11 ✗ 6 ○ 3, de una sesión entera o de sus intentos de un tema.
  function marcador(n) {
    const box = el('span', 'hs-marc');
    [['ok', '✓', n.ok, 'correctas'], ['bad', '✗', n.bad, 'falladas'], ['blank', '○', n.blank, 'en blanco']]
      .forEach(([k, ico, v, nombre]) => {
        const c = el('span', 'hs-m hs-m-' + k);
        c.title = nombre;
        c.append(el('span', 'hs-m-ico', ico), el('b', null, String(v | 0)));
        box.appendChild(c);
      });
    return box;
  }

  function numeros(s, lista) {
    if (lista) {
      const c = cuenta(lista);
      return { ok: c.acertadas, bad: c.falladas, blank: c.blanco };
    }
    return { ok: s.correctas | 0, bad: s.falladas | 0, blank: s.blancos | 0 };
  }

  function fila(s, tema) {
    const b = el('button', 'hist-row');
    b.type = 'button';
    const lista = tema && tieneDetalle(s) ? intentos(s, { tema }) : null;
    // Una ronda que se dejó a medias (Esc) dice cuántas llegaste a contestar.
    const hechas = tieneDetalle(s) ? validos(s).length : 0;
    const modo = (s.modo || 'Ronda') + (s.total && hechas < s.total ? ` · ${hechas} de ${s.total}` : '');
    b.append(el('span', 'hist-when', cuando(s.ts)), el('span', 'hist-modo', modo),
             marcador(numeros(s, lista)));
    const pts = el('span', 'hist-pts');
    if (!tieneDetalle(s)) {
      pts.textContent = 'sin detalle';
      pts.classList.add('is-old');
    } else if (lista) {
      pts.textContent = `${lista.length} de este tema`;
    } else {
      pts.textContent = `${ctx.A.num(s.puntos)} / ${s.total || s.attempts.length}`;
      pts.title = 'Puntos netos sobre el total de preguntas';
    }
    b.append(pts, el('span', 'hist-go', '›'));
    b.addEventListener('click', () => abre(clave(s), { tema }));
    return b;
  }

  /* El historial de la pantalla de inicio. */
  function pintaInicio() {
    if (!ctx) return;
    const todas = ordenadas(ctx.store.stats.sesiones);
    const box = $('hist-rows');
    box.innerHTML = '';
    $('hist-empty').hidden = todas.length > 0;
    todas.slice(0, cuantas).forEach((s) => {
      const li = el('li');
      li.appendChild(fila(s));
      box.appendChild(li);
    });
    const mas = $('hist-more');
    mas.hidden = todas.length <= cuantas;
    mas.textContent = `VER MÁS · ${todas.length - cuantas} más`;
  }

  /* El historial de un tema, dentro de su panel (dash.js). */
  function pintaTema(box, tema) {
    if (!ctx || !box) return;
    const lista = deTema(ctx.store.stats.sesiones, tema);
    box.appendChild(el('p', 'tpanel-hist-h', 'Historial de este tema'));
    if (!lista.length) {
      box.appendChild(el('p', 'tpanel-hist-empty', 'Aún no hay rondas con preguntas de este tema.'));
      return;
    }
    const ol = el('ol', 'hist-rows is-compact');
    lista.slice(0, 5).forEach((s) => {
      const li = el('li');
      li.appendChild(fila(s, tema));
      ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  /* ------------------------------------------------------------ una sesión */
  function abre(k, o) {
    const s = (ctx.store.stats.sesiones || []).find((x) => clave(x) === k);
    if (!s) return;
    vista = { s, tema: (o && o.tema) || null, filtro: 'todas', abiertas: new Set() };
    pintaSesion();
    ctx.muestra('hist');
  }

  function pintaSesion() {
    const { s, tema } = vista;
    const lista = intentos(s, { tema });
    $('hs-when').textContent = `${cuando(s.ts)}${s.musica === 'con' ? ' · con música' : ''}`;
    $('hs-title').textContent = s.modo || 'Ronda';
    $('hs-tema').hidden = !tema;
    $('hs-tema').textContent = tema ? `Solo las preguntas de «${tema}»` : '';

    const sum = $('hs-sum');
    sum.innerHTML = '';
    sum.appendChild(marcador(numeros(s, tema ? lista : null)));
    if (tieneDetalle(s) && !tema) {
      const total = s.total || s.attempts.length;
      const p = el('span', 'hs-nota');
      const b = el('b', null, ctx.A.num(s.puntos));
      b.dataset.sign = ctx.A.sign(s.puntos);
      p.append('Puntos netos ', b, ` / ${total} · nota ${ctx.A.num(ctx.A.nota10(s.puntos, total))} / 10`);
      sum.appendChild(p);
    }
    if (s.respondidas) {
      sum.appendChild(el('span', 'hs-sec', `${segundos((s.ms_respuesta | 0) / s.respondidas)} por pregunta`));
    }

    const viejo = !tieneDetalle(s);
    $('hs-old').hidden = !viejo;
    $('hs-tools').hidden = viejo;
    $('hs-list').innerHTML = '';
    $('hs-empty').hidden = viejo || lista.length > 0;
    if (viejo) return;

    // Filtros con su cuenta
    const c = cuenta(lista);
    const fb = $('hs-filtros');
    fb.innerHTML = '';
    [['todas', 'TODAS'], ['falladas', 'FALLADAS'], ['acertadas', 'ACERTADAS'], ['blanco', 'EN BLANCO']]
      .forEach(([f, txt]) => {
        const b = el('button', 'seg-btn' + (vista.filtro === f ? ' is-on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', vista.filtro === f ? 'true' : 'false');
        b.append(txt + ' ', el('span', 'hs-f-n', String(c[f])));
        b.disabled = !c[f];
        b.addEventListener('click', () => { vista.filtro = f; pintaSesion(); });
        fb.appendChild(b);
      });

    const rep = paraRepasar(lista), todasId = paraRepetir(lista);
    $('hs-repasar').disabled = !rep.length;
    $('hs-repasar').textContent = `REPASAR ESTAS FALLADAS · ${rep.length}`;
    $('hs-repetir').disabled = !todasId.length;
    $('hs-repetir').textContent = `REPETIR TEST · ${todasId.length}`;

    const ol = $('hs-list');
    filtra(lista, vista.filtro).forEach((a) => ol.appendChild(pregunta(a)));
  }

  /* ------------------------------------------------------------ una pregunta */
  const RES = { correct: ['✓', 'correcta'], wrong: ['✗', 'fallada'], blank: ['○', 'en blanco'],
                partial: ['≈', 'a medias'] };
  const AUTO = { correct: 'Bien', partial: 'A medias', wrong: 'Mal', blank: 'Ni idea' };

  const opcionesEs = (q) => {
    const es = {};
    (q.original_options_es || []).forEach((o) => { es[o.label] = o.text; });
    return (q.original_options || []).map((o) => ({ label: o.label, text: es[o.label] || o.text }));
  };

  function correctasDe(q, asorc) {
    if (asorc && q.asorc && q.asorc.eligible) return [q.asorc.correct_label];
    return Array.isArray(q.correct_answer) ? q.correct_answer : [];
  }

  function linea(label, html, k) {
    const p = el('p', 'recap-line');
    p.dataset.k = k;
    const b = el('b');
    b.innerHTML = html;
    p.append(el('span', null, label), b);
    return p;
  }

  function pregunta(a) {
    const q = ctx.bank.get(a.question_id);
    const li = el('li', 'hq');
    li.dataset.r = a.result;
    if (!q) {
      li.appendChild(el('p', 'hq-q', `${a.question_id}: ya no está en el banco.`));
      return li;
    }
    const cab = el('div', 'hq-head');
    cab.setAttribute('role', 'button');
    cab.tabIndex = 0;

    const top = el('div', 'hq-top');
    const tag = el('span', 'tag tag-res', RES[a.result] ? RES[a.result].join(' ') : a.result);
    tag.dataset.r = a.result;
    const led = el('span', 'ledger');
    led.dataset.sign = ctx.A.sign(a.scoreDelta);
    const tot = el('b', null, ctx.A.num(a.scoreAfter));
    const after = el('span', 'ledger-after');
    after.append('total ', tot);
    after.title = 'Acumulado después de esta pregunta';
    led.append(tag, el('b', 'ledger-delta', ctx.A.signed(a.scoreDelta)), after);
    top.append(el('span', 'hq-meta', `${a.topic || q.topic} · ${segundos(a.answerMs)}`), led);

    const enun = el('p', 'hq-q');
    const asorc = vista.s.asorc && q.asorc && q.asorc.eligible;
    const stem = asorc ? (q.asorc.question_es || q.asorc.question) : (q.question_es || q.question);
    enun.innerHTML = ctx.resalta(stem || '');

    const recap = el('div', 'recap');
    if (q.type === 'open') {
      recap.appendChild(linea('Te pusiste', AUTO[a.result] || '—', 'mine'));
    } else {
      const ops = opcionesEs(q);
      const txt = (l) => {
        const o = ops.find((x) => x.label === l);
        return o ? `${o.label} · ${ctx.codifica(o.text)}` : esc(l);
      };
      const mias = String(a.answer || '').split(',').filter(Boolean);
      recap.appendChild(linea('Tu respuesta', mias.length ? mias.map(txt).join('</b><br><b>') : 'sin responder', 'mine'));
      if (a.result !== 'correct') {
        recap.appendChild(linea('Correcta', correctasDe(q, asorc).map(txt).join('</b><br><b>'), 'right'));
      }
    }
    const toggle = el('span', 'hq-toggle', 'explicación');
    cab.append(top, enun, recap, toggle);

    const mas = el('div', 'hq-more');
    const abierta = vista.abiertas.has(a.question_id);
    mas.hidden = !abierta;
    cab.setAttribute('aria-expanded', abierta ? 'true' : 'false');
    if (abierta) explicacion(mas, q, a, asorc);
    const alterna = () => {
      const ya = !mas.hidden;
      if (ya) vista.abiertas.delete(a.question_id); else vista.abiertas.add(a.question_id);
      if (!ya && !mas.childElementCount) explicacion(mas, q, a, asorc);
      mas.hidden = ya;
      cab.setAttribute('aria-expanded', ya ? 'false' : 'true');
    };
    cab.addEventListener('click', alterna);
    cab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alterna(); }
    });
    li.append(cab, mas);
    return li;
  }

  /* La explicación de una pregunta del historial: sus opciones con las letras
   * del libro (que son las que cita la explicación original), la versión en
   * llano y, desplegable, el texto del libro. */
  function explicacion(box, q, a, asorc) {
    if (q.type !== 'open') {
      const correctas = correctasDe(q, asorc);
      const mias = String(a.answer || '').split(',').filter(Boolean);
      const ul = el('ul', 'hq-opts');
      opcionesEs(q).forEach((o) => {
        const li = el('li', 'hq-opt');
        const ok = correctas.includes(o.label), mia = mias.includes(o.label);
        li.dataset.k = ok ? 'ok' : mia ? 'bad' : 'off';
        if (asorc && q.asorc && !(q.asorc.kept_option_labels || []).includes(o.label)) li.classList.add('is-fuera');
        const t = el('span', 'hq-opt-t');
        t.innerHTML = `<b>${o.label}</b> · ${ctx.codifica(o.text)}`;
        li.append(el('span', 'hq-opt-m', ok ? '✓' : mia ? '✗' : ''), t);
        if (mia) li.appendChild(el('span', 'hq-opt-tuya', 'tu respuesta'));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    const r = ctx.simple[q.id];
    const ins = el('div', 'insight');
    ins.appendChild(el('p', 'insight-eyebrow', '💡 QUÉ TENÍAS QUE SABER'));
    if (r && Array.isArray(r.idea) && r.idea.length) {
      const n = el('p', 'nutshell');
      n.innerHTML = ctx.resalta(r.idea[0]);
      ins.appendChild(n);
      if (r.idea.length > 1) {
        const m = el('p', 'insight-more');
        m.innerHTML = ctx.codifica(r.idea.slice(1).join(' '));
        ins.appendChild(m);
      }
      if (r.analogia) {
        const an = el('p', 'analogy');
        an.innerHTML = '<span class="analogy-tag">Piensa en ello como…</span> ' + ctx.codifica(r.analogia);
        ins.appendChild(an);
      }
      const otras = Object.keys(r.otras || {}).sort();
      if (otras.length) {
        const box2 = el('div', 'otras');
        box2.appendChild(el('p', 'otras-h', 'Las otras'));
        otras.forEach((lab) => {
          const p = el('p', 'otra');
          const t = el('span', 'otra-t');
          t.innerHTML = ctx.codifica(r.otras[lab]);
          p.append(el('span', 'otra-k', lab), t);
          box2.appendChild(p);
        });
        ins.appendChild(box2);
      }
      if (r.memorizar) {
        const mm = el('p', 'memo');
        mm.innerHTML = '<span class="memo-tag">Qué memorizar</span> ' + ctx.resalta(r.memorizar);
        ins.appendChild(mm);
      }
    } else {
      ins.appendChild(el('p', 'insight-more', 'Esta pregunta aún no tiene explicación en llano.'));
    }
    const libro = q.type === 'open'
      ? (q.model_answer_es || q.correct_answer_es || q.model_answer || q.source_answer || q.explanation_es || q.explanation)
      : (q.explanation_es || q.explanation);
    const det = el('details', 'full-expl');
    det.appendChild(el('summary', null, 'Ver explicación original'));
    const body = el('p', 'full-expl-body');
    body.innerHTML = ctx.codifica(libro || '');
    det.appendChild(body);
    ins.appendChild(det);
    ins.appendChild(el('p', 'insight-src', `${q.chapter} · pág. ${q.page}`));
    box.appendChild(ins);
  }

  function tecla(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); ctx.volver(); return true; }
    return false;
  }

  function init(contexto) {
    ctx = contexto;
    $('hist-more').addEventListener('click', () => { cuantas += 20; pintaInicio(); });
    $('hs-back').addEventListener('click', () => ctx.volver());
    $('hs-repasar').addEventListener('click', () => {
      if (!vista) return;
      const ids = paraRepasar(intentos(vista.s, { tema: vista.tema }));
      if (ids.length) ctx.repasar(ids, !!vista.s.asorc, vista.s.modo || 'Ronda');
    });
    $('hs-repetir').addEventListener('click', () => {
      if (!vista) return;
      const ids = paraRepetir(intentos(vista.s, { tema: vista.tema }));
      if (ids.length) ctx.repetir(ids, !!vista.s.asorc, vista.s.modo || 'Ronda');
    });
    return API;
  }

  const API = {
    // puro
    clave, tieneDetalle, detalle, ordenadas, deTema, intentos, filtra, cuenta,
    paraRepasar, paraRepetir, FILTROS: Object.keys(FILTROS),
    // pantalla
    init, pintaInicio, pintaTema, abre, tecla,
  };
  root.Historial = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
