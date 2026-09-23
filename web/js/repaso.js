/* ASORC · repaso rápido — la sección del inicio y la pantalla de tarjetas.
 *
 * El mazo y cuándo vuelve cada tarjeta están en micro.js; el contenido, en
 * microcards.json. Aquí: pintar, elegir la tanda y recoger «la sabía / dudé /
 * no la sabía», que es lo que decide cuándo vuelve cada una.
 *
 * Recuperación activa: primero solo la pista; la respuesta, al pulsar o con
 * Space; y hasta que no dices cómo te fue, no se pasa a la siguiente.
 */
'use strict';

(function (root, doc) {

  const M = root.Micro;
  const $ = (id) => doc.getElementById(id);
  let ctx = null;      // { store, bank: Map, cards, resalta(txt), muestra(pantalla), volver(), alCambiar() }
  let ses = null;      // la tanda en curso

  const contenido = (id) => (ctx && ctx.cards && ctx.cards[id]) || null;
  // Solo cuentan las tarjetas que tienen contenido y cuya pregunta existe.
  const vale = (id) => !!contenido(id) && ctx.bank.has(id);
  const temaDe = (id) => { const q = ctx.bank.get(id); return q ? q.topic : ''; };
  // Comandos y rutas en monoespaciada, el resto en texto: el mismo resaltado
  // que la ronda. resalta() escapa antes de marcar.
  const pinta = (el, txt) => {
    if (ctx.resalta) el.innerHTML = ctx.resalta(txt);
    else el.textContent = txt;
  };

  const copiaContenido = (id) => M.conContenido(ctx.store.cards[id], contenido(id));

  /* Lo que ya habías fallado, dejado en blanco o marcado antes de que hubiera
   * repaso rápido entra también, y cada tarjeta se pone al día. */
  function prepara() {
    const st = ctx.store;
    const candidatas = [];
    ctx.bank.forEach((q, id) => {
      if (!vale(id)) return;
      const p = st.prog(id), s = st.stat(id);
      const fallos = p ? (p.fallos | 0) + (p.blancos | 0) + (p.parciales | 0) : 0;
      if (!fallos && !st.marcada(id)) return;
      const fallo = s && ['wrong', 'blank', 'partial'].includes(s.ultimo_resultado);
      candidatas.push({ id, fallos, ultimoFallo: fallo ? (Number(s.ultima_vez) || 0) * 1000 : 0 });
    });
    let cambios = M.siembra(st.cards, candidatas, Date.now()) > 0;
    Object.keys(st.cards).forEach((id) => { if (copiaContenido(id)) cambios = true; });
    if (cambios) st.guardarLocal();
  }

  /* Reloj de los eventos: nunca dos con el mismo milisegundo. Al rehacer el
   * mazo en otro dispositivo se ordenan por tiempo; con un empate decidiría
   * su id, que es aleatorio, y «fallo» y «la sabía» podrían cambiar de orden. */
  let ultimoAt = 0;
  const ahora = () => (ultimoAt = Math.max(Date.now(), ultimoAt + 1));

  /* Un evento para la tarjeta de esa pregunta: fallo, marca, sabia, dude o
   * nosabia. La crea si no existe y si existe la actualiza: nunca dos. */
  function anota(id, kind) {
    if (!ctx || !vale(id) || !M.KINDS.includes(kind)) return null;
    const nueva = !ctx.store.cards[id];
    const ev = { question_id: id, kind, at: ahora() };
    const t = M.aplica(ctx.store.cards, ev);
    copiaContenido(id);
    ctx.store.tarjetaEvento(ev);
    return { nueva, tarjeta: t };
  }

  /* ------------------------------------------------------------ inicio */
  const MODOS = [
    { modo: 'rapidas', n: 10, txt: '10 RÁPIDAS', main: true },
    { modo: 'rapidas', n: 20, txt: '20 RÁPIDAS' },
    { modo: 'todas', txt: 'TODAS' },
    { modo: 'hoy', txt: 'FALLADAS HOY' },
    { modo: 'marcadas', txt: 'MARCADAS' },
  ];

  const opciones = (spec) => ({
    now: Date.now(), n: spec.n || 0, tema: spec.tema, temaDe, vale,
    marcada: (id) => ctx.store.marcada(id),
  });
  const cuantas = (spec) => M.elige(ctx.store.cards, spec.modo, opciones(spec)).length;

  function boton(txt, n, principal, alPulsar) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'rq-mode' + (principal ? ' is-main' : '');
    b.disabled = !n;
    const t = doc.createElement('b');
    t.textContent = txt;
    const c = doc.createElement('span');
    c.textContent = String(n);
    b.append(t, c);
    b.addEventListener('click', alPulsar);
    return b;
  }

  let temasAbiertos = false;

  function pintaInicio() {
    if (!ctx) return;
    prepara();
    const mazo = ctx.store.cards, now = Date.now();
    const ids = Object.keys(mazo).filter(vale);
    const tocan = ids.filter((id) => M.tocaYa(mazo[id], now)).length;
    $('rq-home').dataset.vacio = ids.length ? 'no' : 'si';
    $('rq-home-sum').textContent = ids.length
      ? `${ids.length} tarjeta${ids.length > 1 ? 's' : ''} · ${tocan} para ahora`
      : 'Aún no hay tarjetas: entran solas cuando fallas, dejas en blanco o marcas una pregunta.';

    const box = $('rq-home-acts');
    box.innerHTML = '';
    MODOS.forEach((m) => {
      const n = cuantas(m);
      box.appendChild(boton(m.txt, n, m.main, () => abre(Object.assign({ etiqueta: m.txt.toLowerCase() }, m))));
    });
    const porTema = new Map();
    ids.forEach((id) => porTema.set(temaDe(id), (porTema.get(temaDe(id)) || 0) + 1));
    const bt = boton(temasAbiertos ? 'POR TEMA ▴' : 'POR TEMA ▾', porTema.size, false, () => {
      temasAbiertos = !temasAbiertos;
      pintaInicio();
    });
    bt.setAttribute('aria-expanded', temasAbiertos ? 'true' : 'false');
    box.appendChild(bt);

    const tb = $('rq-home-topics');
    tb.innerHTML = '';
    tb.hidden = !temasAbiertos || !porTema.size;
    [...porTema.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).forEach(([tema, n]) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'rq-topic';
      const nm = doc.createElement('span');
      nm.textContent = tema;
      const c = doc.createElement('i');
      c.textContent = String(n);
      b.append(nm, c);
      b.addEventListener('click', () => abre({ modo: 'tema', tema, etiqueta: tema }));
      tb.appendChild(b);
    });
  }

  /* ------------------------------------------------------------ tanda */
  function abre(spec) {
    const cola = M.elige(ctx.store.cards, spec.modo, opciones(spec));
    if (!cola.length) return;
    ses = { spec, cola, i: 0, veces: {}, fase: 'pista', cuenta: { sabia: 0, dude: 0, nosabia: 0 },
            aviso: '' };
    $('rq-modo').textContent = spec.etiqueta || '';
    ctx.muestra('micro');
    pintaTarjeta();
  }

  function pintaTarjeta() {
    if (ses.i >= ses.cola.length) return fin();
    const id = ses.cola[ses.i], c = contenido(id);
    $('rq-fin').hidden = true;
    $('rq-card').hidden = false;
    $('rq-card').dataset.fase = 'pista';
    $('rq-i').textContent = String(ses.i + 1);
    $('rq-n').textContent = String(ses.cola.length);
    $('rq-topic').textContent = temaDe(id);
    pinta($('rq-cue'), c.cue);
    $('rq-answer').textContent = '?';
    $('rq-contrast').hidden = true;
    $('rq-contrast').innerHTML = '';
    $('rq-mnemo').hidden = true;
    $('rq-show').hidden = false;
    $('rq-grade').hidden = true;
    $('rq-next').textContent = ses.aviso;
    $('rq-next').hidden = !ses.aviso;
    ses.fase = 'pista';
    $('rq-show').focus({ preventScroll: true });
  }

  function muestra() {
    if (!ses || ses.fase !== 'pista') return;
    const c = contenido(ses.cola[ses.i]);
    pinta($('rq-answer'), c.answer);
    const ul = $('rq-contrast');
    (c.contrast || []).forEach((ln) => {
      const li = doc.createElement('li');
      pinta(li, ln);
      ul.appendChild(li);
    });
    ul.hidden = !(c.contrast || []).length;
    $('rq-mnemo').textContent = c.mnemo || '';
    $('rq-mnemo').hidden = !c.mnemo;
    $('rq-card').dataset.fase = 'respuesta';
    $('rq-show').hidden = true;
    $('rq-grade').hidden = false;
    ses.fase = 'respuesta';
    // El foco va a la tarjeta, no a un botón: otro Space sin querer no puede
    // dar la tarjeta por sabida.
    $('rq-card').focus({ preventScroll: true });
  }

  // «vuelve en 10 min», «vuelve mañana», «vuelve en 16 días»
  function cuandoVuelve(t, now) {
    const ms = t.proxima - now;
    if (ms < M.DIA - 60 * M.MIN) return `vuelve en ${Math.max(1, Math.round(ms / M.MIN))} min`;
    const dias = Math.round(ms / M.DIA);
    return dias <= 1 ? 'vuelve mañana' : `vuelve en ${dias} días`;
  }

  function califica(g) {
    if (!ses || ses.fase !== 'respuesta' || !M.NOTAS.includes(g)) return;
    const id = ses.cola[ses.i];
    const r = anota(id, g);
    ses.cuenta[g]++;
    const otraVez = g === 'nosabia' && M.reencola(ses.cola, ses.i, id, ses.veces);
    ses.aviso = r ? 'La anterior ' + (otraVez ? 'vuelve en esta misma tanda' : cuandoVuelve(r.tarjeta, Date.now())) : '';
    ses.i++;
    if (ctx.alCambiar) ctx.alCambiar();
    pintaTarjeta();
  }

  function fin() {
    ses.fase = 'fin';
    $('rq-card').hidden = true;
    $('rq-fin').hidden = false;
    const k = ses.cuenta;
    const total = k.sabia + k.dude + k.nosabia;
    $('rq-fin-n').textContent =
      `${total} repasada${total === 1 ? '' : 's'} · ${k.sabia} la sabías · ${k.dude} dudaste · ${k.nosabia} no`;
    $('rq-otra').focus({ preventScroll: true });
  }

  function sal() {
    ses = null;
    ctx.volver();
  }

  // Teclado de la pantalla de repaso. Devuelve true si la tecla era suya.
  function tecla(ev) {
    if (!ses) return false;
    const k = ev.key;
    if (k === 'Escape') { ev.preventDefault(); sal(); return true; }
    if (ses.fase === 'pista' && (k === ' ' || k === 'Enter')) { ev.preventDefault(); muestra(); return true; }
    if (ses.fase === 'respuesta') {
      const g = { 1: 'sabia', 2: 'dude', 3: 'nosabia' }[k];
      if (g) { ev.preventDefault(); califica(g); return true; }
      // Space o Enter solo califican si has ido tú a un botón con el tabulador.
      if ((k === ' ' || k === 'Enter') && !(ev.target.closest && ev.target.closest('.rq-g'))) {
        ev.preventDefault();
        return true;
      }
    }
    return false;
  }

  function init(contexto) {
    ctx = contexto;
    $('rq-show').addEventListener('click', muestra);
    $('rq-grade').addEventListener('click', (e) => {
      const b = e.target.closest('[data-g]');
      if (b) califica(b.dataset.g);
    });
    $('rq-exit').addEventListener('click', sal);
    $('rq-volver').addEventListener('click', sal);
    $('rq-otra').addEventListener('click', () => { if (ses) abre(ses.spec); });
    return API;
  }

  const API = {
    init, pintaInicio, anota, prepara, abre, tecla,
    get sesion() { return ses; },
  };
  root.Repaso = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
