/* ASORC · panel de estudio.
 *
 * La pantalla de inicio deja de ser un menú de modos y pasa a ser el mapa del
 * banco: cuánto llevas, por dónde vas y qué te falta. Los modos rápidos siguen
 * estando, debajo.
 *
 * Dos métricas distintas, y no se mezclan:
 *   COMPLETADO = preguntas ÚNICAS vistas ÷ preguntas disponibles.
 *                Repetir una pregunta no sube este número.
 *   ACIERTO    = aciertos ÷ intentos con respuesta (los blancos no cuentan
 *                como intento de responder).
 */
'use strict';

(function (root, doc) {

  let ctx = null;          // { bank, store, start, resume, discard }
  const $ = (id) => doc.getElementById(id);
  const el = (tag, cls, txt) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };

  const TAMANOS = [5, 10, 20, 50, 0];      // 0 = todas
  const seleccion = new Set();             // temas marcados para mezclar
  let abierto = null;                      // tema con el panel desplegado

  /* ------------------------------------------------------------ métricas */
  function resumen(preguntas) {
    const st = ctx.store;
    let vistas = 0, aciertos = 0, fallos = 0, parciales = 0, blancos = 0,
        marcadas = 0, conFallo = 0;
    preguntas.forEach((q) => {
      const p = st.prog(q.id);
      if (p && (p.veces_vista | 0) > 0) vistas++;
      if (p) {
        aciertos += p.aciertos | 0;
        fallos += p.fallos | 0;
        parciales += p.parciales | 0;
        blancos += p.blancos | 0;
        if ((p.fallos | 0) + (p.parciales | 0) > 0) conFallo++;
      }
      if (st.marcada(q.id)) marcadas++;
    });
    const intentos = aciertos + fallos + parciales;
    return {
      total: preguntas.length, vistas, noVistas: preguntas.length - vistas,
      aciertos, fallos, parciales, blancos, marcadas, conFallo, intentos,
      completado: preguntas.length ? vistas / preguntas.length : 0,
      acierto: intentos ? aciertos / intentos : null,
    };
  }

  function temas() {
    const m = new Map();
    ctx.bank.forEach((q) => {
      if (!m.has(q.topic)) m.set(q.topic, []);
      m.get(q.topic).push(q);
    });
    return [...m.entries()]
      .map(([nombre, qs]) => ({ nombre, qs, r: resumen(qs) }))
      .sort((a, b) => b.qs.length - a.qs.length || a.nombre.localeCompare(b.nombre));
  }

  const pct = (x) => Math.round((x || 0) * 100) + '%';

  function barra(frac, cls) {
    const b = el('div', 'bar ' + (cls || ''));
    const f = el('span');
    f.style.width = Math.round((frac || 0) * 100) + '%';
    b.appendChild(f);
    return b;
  }

  /* ------------------------------------------------------------ cabecera */
  function pintaCabecera() {
    const r = resumen(ctx.bank);
    $('hero-seen').textContent = String(r.vistas);
    $('hero-total').textContent = String(r.total);
    $('hero-pct').textContent = pct(r.completado);
    $('hero-fill').style.width = pct(r.completado);
    $('c-ok').textContent = String(r.aciertos);
    $('c-bad').textContent = String(r.fallos + r.parciales);
    $('c-mark').textContent = String(r.marcadas);
    $('c-new').textContent = String(r.noVistas);
    $('hero-acc').textContent = r.acierto == null ? '—' : pct(r.acierto);
    $('hero-tries').textContent = String(r.intentos);
  }

  /* ---------------------------------------------------- sesión pendiente */
  function pintaReanudar() {
    const s = ctx.store.session;
    const box = $('resume');
    if (!s || !s.ids || s.i == null || s.i >= s.ids.length) { box.hidden = true; return; }
    $('resume-count').textContent = `${s.i} / ${s.ids.length}`;
    $('resume-label').textContent = s.spec && s.spec.label ? s.spec.label : 'Ronda en curso';
    box.hidden = false;
  }

  /* -------------------------------------------------------------- temas */
  function pintaTemas() {
    const grid = $('topic-grid');
    grid.innerHTML = '';
    temas().forEach((t) => {
      const card = el('article', 'tcard');
      if (seleccion.has(t.nombre)) card.classList.add('is-picked');
      card.dataset.topic = t.nombre;

      const head = el('header', 'tcard-head');
      const h = el('h3', null, t.nombre);
      const p = el('span', 'tcard-pct', pct(t.r.completado));
      head.append(h, p);

      const sel = el('button', 'tcard-sel');
      sel.type = 'button';
      sel.setAttribute('aria-pressed', seleccion.has(t.nombre) ? 'true' : 'false');
      sel.setAttribute('aria-label', 'Añadir ' + t.nombre + ' a la mezcla');
      sel.textContent = seleccion.has(t.nombre) ? '✓' : '+';
      sel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (seleccion.has(t.nombre)) seleccion.delete(t.nombre); else seleccion.add(t.nombre);
        pintaTemas(); pintaMezcla();
      });

      const linea = el('p', 'tcard-line');
      linea.append(el('b', null, `${t.r.vistas} / ${t.r.total}`), doc.createTextNode(' vistas'));
      const linea2 = el('p', 'tcard-sub');
      linea2.textContent = (t.r.acierto == null ? 'sin intentos' : pct(t.r.acierto) + ' acierto')
        + ` · ${t.r.conFallo} falladas · ${t.r.marcadas} para repasar`;

      card.append(sel, head, barra(t.r.completado), linea, linea2);
      card.addEventListener('click', () => abrirTema(t.nombre));
      if (abierto === t.nombre) card.appendChild(panelTema(t));
      grid.appendChild(card);
    });
  }

  function abrirTema(nombre) {
    abierto = abierto === nombre ? null : nombre;
    pintaTemas();
    if (abierto) {
      const c = doc.querySelector(`.tcard[data-topic="${CSS.escape(abierto)}"]`);
      if (c) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  let tamano = 20;

  function panelTema(t) {
    const p = el('div', 'tpanel');
    p.addEventListener('click', (e) => e.stopPropagation());

    const tam = el('div', 'tpanel-sizes');
    TAMANOS.forEach((n) => {
      const b = el('button', 'chip-size' + (n === tamano ? ' is-on' : ''), n ? String(n) : 'Todas');
      b.type = 'button';
      b.addEventListener('click', () => { tamano = n; pintaTemas(); });
      tam.appendChild(b);
    });

    const acc = el('div', 'tpanel-acts');
    // Se cuenta con el MISMO filtro que aplicará el botón (por ejemplo, las
    // abiertas están fuera salvo que las hayas activado): si no, el panel
    // promete preguntas que luego no salen.
    const cuenta = (filtro) => ctx.pool({ topics: [t.nombre], filter: filtro }).length;
    const nuevas = cuenta('unseen'), falladas = cuenta('failed'),
          marcadas = cuenta('marked'), todas = cuenta('all');

    const boton = (txt, sub, filtro, primario, activo) => {
      const b = el('button', 'tact' + (primario ? ' is-main' : ''));
      b.type = 'button';
      b.disabled = !activo;
      b.append(el('b', null, txt), el('span', null, sub));
      b.addEventListener('click', () => ctx.start({
        kind: 'topic', label: t.nombre, topics: [t.nombre], filter: filtro, size: tamano,
      }));
      return b;
    };
    acc.append(
      boton('CONTINUAR', `${nuevas} no vistas`, 'unseen', nuevas > 0, nuevas > 0),
      boton('REPASAR FALLOS', `${falladas} falladas`, 'failed', false, falladas > 0),
      boton('SOLO MARCADAS', `${marcadas} marcadas`, 'marked', false, marcadas > 0),
      boton('TODAS', `${todas} preguntas`, 'all', nuevas === 0, todas > 0),
    );
    p.append(tam, acc);
    return p;
  }

  function pintaMezcla() {
    const bar = $('mix-bar');
    if (!seleccion.size) { bar.hidden = true; return; }
    const lista = [...seleccion];
    const qs = ctx.bank.filter((q) => seleccion.has(q.topic));
    $('mix-text').textContent = `${lista.length} tema${lista.length > 1 ? 's' : ''} · ${qs.length} preguntas`;
    bar.hidden = false;
  }

  /* ------------------------------------------------------------- arranque */
  // Para poder medir sin navegador: configurar() solo fija el contexto.
  function configurar(contexto) { ctx = contexto; }

  function init(contexto) {
    configurar(contexto);

    $('resume-go').addEventListener('click', () => ctx.resume());
    $('resume-drop').addEventListener('click', () => {
      if (!confirm('¿Descartar la ronda a medias? Las respuestas ya dadas se conservan.')) return;
      ctx.discard();
      pintar();
    });
    $('mix-go').addEventListener('click', () => {
      const lista = [...seleccion];
      ctx.start({ kind: 'mix', label: lista.join(' + '), topics: lista, filter: 'all', size: tamano });
    });
    $('mix-clear').addEventListener('click', () => { seleccion.clear(); pintaTemas(); pintaMezcla(); });
    return API;
  }

  function pintar() {
    if (!ctx) return;
    pintaCabecera();
    pintaReanudar();
    pintaTemas();
    pintaMezcla();
  }

  const API = { init, configurar, pintar, resumen, temas, get seleccion() { return [...seleccion]; } };
  root.Dash = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
