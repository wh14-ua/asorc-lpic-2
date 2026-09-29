/* ASORC · tests de recuperación — la sección del inicio.
 *
 * Qué preguntas entran y por qué lo decide riesgo.js; las candidatas salen de
 * la misma regla que el resto de rondas (Logic.pool: abiertas, formato ASORC
 * y los temas que tengas elegidos con +). Aquí solo se pinta, se recuerda lo
 * elegido y se lanza la ronda, que después es una ronda como cualquier otra:
 * nota, XP, racha, historial y repasar fallos.
 *
 * La sección nunca se queda a medias: los controles se pintan antes de
 * calcular nada. Mientras llega el historial de la nube dice «Cargando
 * historial…» y app.js la vuelve a pintar al terminar la sincronización;
 * sin diario, lo que se puede calcular con los contadores funciona igual.
 */
'use strict';

(function (root, doc) {

  const R = root.Riesgo;
  const $ = (id) => doc.getElementById(id);
  const TAMANOS = [10, 20, 30, 50];
  let ctx = null;     // { store, bank, pool(spec), temas(), abiertas(), cargando(), arranca(spec, ids) }
  let porId = new Map();

  /* ------------------------------------------------------------ ajustes
   * Tamaño, criterio y formato se recuerdan en este navegador, como el resto
   * de ajustes del inicio. */
  function elegido() {
    const p = (ctx.store.prefs && ctx.store.prefs.recupera) || {};
    const n = Math.floor(Number(p.n));
    return {
      n: n > 0 ? Math.min(n, ctx.bank.length) : 20,
      otro: !!p.otro,
      modo: R.modo(p.modo) ? p.modo : 'mix',
      asorc: !!p.asorc,
    };
  }

  function guarda(cambios) {
    ctx.store.prefs.recupera = Object.assign(elegido(), cambios);
    ctx.store.guardarLocal();
    pintaInicio();
  }

  /* ------------------------------------------------------------ cálculo */
  // Las estadísticas de todo el banco y las candidatas que pasan tus filtros.
  function calcula(o) {
    const st = ctx.store;
    const est = R.estadisticas({
      bank: ctx.bank, intentos: st.intentos, progreso: st.progress.preguntas,
      stats: st.stats.preguntas, now: Date.now(),
    });
    const temas = ctx.temas ? ctx.temas() : [];
    const candidatas = ctx.pool({ topics: temas, asorc: !!o.asorc, filter: null }).map((q) => q.id);
    return { est, temas, candidatas };
  }

  const elige = (modo, n, c) => R.selecciona(modo, {
    est: c.est, candidatas: c.candidatas, n, sesiones: ctx.store.stats.sesiones,
    enBanco: (id) => porId.has(id),
  });

  /* «Mix inteligente · 20 preguntas»: así se llama la ronda en el historial. */
  function etiqueta(sel, n, asorc) {
    return `${sel.nombre} · ${n} pregunta${n === 1 ? '' : 's'}` + (asorc && sel.modo !== 'ultima' ? ' · ASORC' : '');
  }

  /* Elige y lanza. El orden en que salen se baraja, como en el resto de
   * rondas; la prioridad de cada una queda en sus motivos (rank). */
  function empieza(o) {
    const c = calcula(o);
    const sel = elige(o.modo, o.n, c);
    if (!sel.ids.length) { pintaInicio(); return false; }
    const ids = root.Logic.shuffled(sel.ids);
    // Los errores de la última ronda salen en el formato de aquella ronda.
    const asorc = o.modo === 'ultima' ? !!(sel.ronda && sel.ronda.asorc) : !!o.asorc;
    const smart = {
      modo: sel.modo, nombre: sel.nombre, pedidas: sel.pedidas, disponibles: sel.disponibles,
      motivos: sel.motivos, generado: Date.now(),
      filtros: o.modo === 'ultima' ? { ronda: sel.ronda }
        : { abiertas: !!(ctx.abiertas && ctx.abiertas()), asorc, temas: c.temas },
      opciones: { modo: o.modo, n: o.n, asorc: !!o.asorc },
    };
    ctx.arranca({ kind: 'smart', label: etiqueta(sel, ids.length, asorc), topics: [], filter: null,
                  size: null, asorc, smart }, ids);
    return true;
  }

  // OTRO TEST: el mismo criterio, elegido otra vez con tu historial de ahora.
  function repite(smart) {
    const o = (smart && smart.opciones) || {};
    return empieza({ modo: R.modo(o.modo) ? o.modo : 'mix', n: o.n || 20, asorc: !!o.asorc });
  }

  /* ------------------------------------------------------------ pintar */
  function el(tag, cls, txt) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }

  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function cuandoFue(ts) {
    const d = new Date((Number(ts) || 0) * 1000), hoy = new Date();
    const hora = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (R.mismoDia(d.getTime(), hoy.getTime())) return `hoy ${hora}`;
    if (R.mismoDia(d.getTime(), hoy.getTime() - R.DIA)) return `ayer ${hora}`;
    return `${d.getDate()} ${MESES[d.getMonth()]} ${hora}`;
  }

  function pintaTamanos(o) {
    const box = $('rec-sizes');
    box.replaceChildren();
    const chip = (txt, on, alPulsar) => {
      const b = el('button', 'chip-size' + (on ? ' is-on' : ''), txt);
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', alPulsar);
      box.appendChild(b);
    };
    TAMANOS.forEach((n) => chip(String(n), !o.otro && o.n === n, () => guarda({ n, otro: false })));
    chip('Personalizado', o.otro, () => {
      guarda({ otro: true });
      $('rec-otro').focus();
    });
    $('rec-otro-box').hidden = !o.otro;
    if (doc.activeElement !== $('rec-otro')) $('rec-otro').value = String(o.n);
    $('rec-otro').max = String(ctx.bank.length);
  }

  // El selector, con cuántas preguntas hay para cada criterio. Sin cálculo
  // (el historial aún no ha llegado), los criterios salen igual, sin número.
  function pintaCriterios(o, cuentas) {
    const sel = $('rec-modo');
    sel.replaceChildren();
    const grupos = new Map();
    R.MODOS.forEach((m) => {
      if (!grupos.has(m.grupo)) {
        const g = el('optgroup');
        g.label = m.grupo;
        grupos.set(m.grupo, g);
        sel.appendChild(g);
      }
      const n = cuentas ? cuentas.get(m.key) : null;
      const op = el('option', null, `${m.nombre}${m.recomendado ? ' (recomendado)' : ''}` + (n == null ? '' : ` · ${n}`));
      op.value = m.key;
      op.selected = m.key === o.modo;
      grupos.get(m.grupo).appendChild(op);
    });
  }

  // Qué filtros se están aplicando, para que ningún número sorprenda.
  function filtros(o, c) {
    const f = [ctx.abiertas && ctx.abiertas() ? 'con abiertas' : 'sin abiertas'];
    if (o.asorc) f.push('formato ASORC');
    if (c.temas.length) f.push(c.temas.length === 1 ? `solo ${c.temas[0]}` : `solo ${c.temas.length} temas elegidos`);
    return f.join(' · ');
  }

  function disponibilidad(o, s, c) {
    const avail = $('rec-avail');
    avail.dataset.corto = 'no';
    if (o.modo === 'ultima') {
      if (!s.ronda) return 'Aún no has terminado ninguna ronda con detalle de preguntas.';
      const cual = `«${s.ronda.modo}», ${cuandoFue(s.ronda.ts)}`;
      if (!s.disponibles) return `Tu última ronda (${cual}) no tuvo errores.`;
      const n = s.ids.length;
      return `${s.disponibles} error${s.disponibles === 1 ? '' : 'es'} en tu última ronda (${cual})` +
        (n < s.disponibles ? `: el test tendrá los ${n} de más riesgo.` : '.') +
        ` En su formato${s.ronda.asorc ? ' ASORC' : ''}; aquí no cuentan tus filtros.`;
    }
    if (!s.disponibles) {
      return (o.modo === 'hoy' ? 'Hoy no has fallado ninguna pregunta' : 'No hay preguntas para este criterio') +
        ` con tus filtros (${filtros(o, c)}).`;
    }
    if (s.disponibles < o.n) {
      avail.dataset.corto = 'si';
      return `Hay ${s.disponibles} pregunta${s.disponibles === 1 ? '' : 's'} disponible${s.disponibles === 1 ? '' : 's'} ` +
        `para este criterio: el test tendrá ${s.disponibles}, sin rellenar con otras. (${filtros(o, c)})`;
    }
    return `Hay ${s.disponibles} preguntas disponibles para este criterio; el test tendrá ${o.n}. (${filtros(o, c)})`;
  }

  // El formato (Normal / ASORC) no depende del historial.
  function pintaFormato(o) {
    const fmt = $('rec-fmt');
    fmt.setAttribute('aria-disabled', o.modo === 'ultima' ? 'true' : 'false');
    [...fmt.children].forEach((b) => {
      const on = (b.dataset.fmt === 'asorc') === o.asorc;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.disabled = o.modo === 'ultima';
    });
  }

  // Los criterios que necesitan la hora de cada intento lo dicen si falta.
  function avisoHoras(m, c, cargando) {
    if (!m.horas || !R.faltanHoras(c.est)) return '';
    return cargando
      ? ' Este criterio necesita la fecha de cada intento: se completa en cuanto termine de cargar tu historial.'
      : ' Parte de tu historial no tiene fecha (es de antes del diario o de la app de terminal): aquí solo cuentan los intentos con fecha.';
  }

  function pintaInicio() {
    if (!ctx || !doc || !$('rec-home')) return;
    const o = elegido();
    const cargando = !!(ctx.cargando && ctx.cargando());
    // Los controles, siempre y antes de calcular nada: aunque el historial
    // aún no haya llegado o el cálculo falle, la sección no se queda vacía.
    pintaTamanos(o);
    pintaFormato(o);
    let c = null, cuentas = null, s = null, error = null;
    try {
      c = calcula(o);
      cuentas = new Map(R.MODOS.map((m) => [m.key, elige(m.key, 0, c).disponibles]));
      s = elige(o.modo, o.n, c);
    } catch (e) {
      error = e;
      cuentas = null;
      if (root.console) root.console.error('[tests de recuperación]', e);
    }
    const hay = !error && c.est.intentos > 0;
    $('rec-home').dataset.vacio = hay || cargando || error ? 'no' : 'si';
    pintaCriterios(o, hay ? cuentas : null);
    const m = R.modo(o.modo);
    $('rec-desc').textContent = m.desc + (o.modo === 'equilibrado'
      ? ` Como mucho ${R.topePorTema(o.n)} de un mismo tema, salvo que no haya más.` : '');

    const go = $('rec-go'), avail = $('rec-avail');
    avail.dataset.corto = 'no';
    if (error) {
      $('rec-sum').textContent = 'no se pudo leer tu historial';
      avail.textContent = `No se pudieron calcular los criterios (${error.message}). Recarga la página.`;
      go.disabled = true;
      go.textContent = 'NO DISPONIBLE';
      return;
    }
    if (!hay) {
      $('rec-sum').textContent = cargando ? 'Cargando historial…'
        : 'Aún no hay historial: en cuanto respondas preguntas, aquí salen las que más se te resisten.';
      avail.textContent = cargando ? 'Cargando historial… en cuanto llegue, cada criterio dice cuántas preguntas tiene.' : '';
      go.disabled = true;
      go.textContent = cargando ? 'CARGANDO HISTORIAL…' : 'EMPEZAR TEST';
      return;
    }
    $('rec-sum').textContent = `según tus ${c.est.intentos} intentos` + (cargando ? ' · cargando el resto de tu historial…' : '');
    avail.textContent = disponibilidad(o, s, c) + avisoHoras(m, c, cargando);
    go.disabled = !s.ids.length;
    go.textContent = s.ids.length ? `EMPEZAR TEST · ${s.ids.length}` : 'SIN PREGUNTAS PARA ESTE CRITERIO';
  }

  // Para poder probarlo sin navegador: configurar() solo fija el contexto.
  function configurar(contexto) {
    ctx = contexto;
    porId = new Map(ctx.bank.map((q) => [q.id, q]));
    return API;
  }

  function init(contexto) {
    configurar(contexto);
    // Un index.html viejo en la caché del navegador no trae la sección: nada que cablear.
    if (!$('rec-home')) return API;
    $('rec-modo').addEventListener('change', (e) => guarda({ modo: e.target.value }));
    $('rec-fmt').addEventListener('click', (e) => {
      const b = e.target.closest('[data-fmt]');
      if (b && !b.disabled) guarda({ asorc: b.dataset.fmt === 'asorc' });
    });
    $('rec-otro').addEventListener('change', (e) => {
      const n = Math.floor(Number(e.target.value));
      if (n >= 1) guarda({ n: Math.min(n, ctx.bank.length), otro: true });
      else pintaInicio();
    });
    $('rec-go').addEventListener('click', () => empieza(elegido()));
    return API;
  }

  const API = { init, configurar, pintaInicio, empieza, repite, etiqueta };
  root.Recupera = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
