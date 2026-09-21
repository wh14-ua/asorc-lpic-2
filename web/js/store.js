/* ASORC · persistencia.
 *
 * Tres capas, y solo la primera es obligatoria:
 *
 *   BrowserStore        localStorage. Siempre funciona, también en GitHub Pages.
 *   LocalServerStore    el servidor de ./asorc-web. Es el puente con
 *                       progress.json y, por tanto, con la app de terminal.
 *   SupabaseStore       sincronización opcional entre dispositivos.
 *
 * El esquema de «progreso» es el MISMO que usa la aplicación de terminal, para
 * que los dos sigan leyéndose. Lo que la terminal no conoce (tiempos, marcas,
 * sesiones) vive aparte, en «stats».
 *
 * Regla de fusión: nunca se pisa un dato más completo con uno más pobre.
 */
'use strict';

(function (root) {

  const VACIO_PROG = () => ({
    schema_version: 1, app: 'test-ASORC', preguntas: {}, configuracion: { idioma: 'es' },
  });
  const VACIO_STATS = () => ({ preguntas: {}, sesiones: [] });

  const filaProg = () => ({
    veces_vista: 0, aciertos: 0, fallos: 0, blancos: 0, parciales: 0,
    ultima_respuesta: '', ultimo_resultado: '',
  });
  const filaStats = () => ({
    respuestas: 0, ms_respuesta_total: 0, ms_explicacion_total: 0,
    ms_ultimo: 0, ms_mejor: 0, marcada: false, ultimo_resultado: '', ultima_vez: 0,
  });

  /* ---------------------------------------------------------------- fusión
   * Se queda con lo más alto de cada contador y con el resultado más reciente.
   * Así da igual el orden en que lleguen navegador, servidor local y nube.
   */
  function fusionaProgreso(a, b) {
    const out = VACIO_PROG();
    out.configuracion = Object.assign({}, a.configuracion, b.configuracion);
    const ids = new Set([...Object.keys(a.preguntas || {}), ...Object.keys(b.preguntas || {})]);
    ids.forEach((id) => {
      const x = Object.assign(filaProg(), a.preguntas[id] || {});
      const y = Object.assign(filaProg(), b.preguntas[id] || {});
      const r = filaProg();
      ['veces_vista', 'aciertos', 'fallos', 'blancos', 'parciales'].forEach((k) => {
        r[k] = Math.max(x[k] | 0, y[k] | 0);
      });
      const gana = (y.veces_vista | 0) >= (x.veces_vista | 0) ? y : x;
      r.ultima_respuesta = gana.ultima_respuesta || x.ultima_respuesta || y.ultima_respuesta || '';
      r.ultimo_resultado = gana.ultimo_resultado || x.ultimo_resultado || y.ultimo_resultado || '';
      out.preguntas[id] = r;
    });
    return out;
  }

  function fusionaStats(a, b) {
    const out = VACIO_STATS();
    const ids = new Set([...Object.keys(a.preguntas || {}), ...Object.keys(b.preguntas || {})]);
    ids.forEach((id) => {
      const x = Object.assign(filaStats(), a.preguntas[id] || {});
      const y = Object.assign(filaStats(), b.preguntas[id] || {});
      const r = filaStats();
      ['respuestas', 'ms_respuesta_total', 'ms_explicacion_total'].forEach((k) => {
        r[k] = Math.max(x[k] | 0, y[k] | 0);
      });
      const nuevo = (y.ultima_vez | 0) >= (x.ultima_vez | 0) ? y : x;
      r.ultima_vez = Math.max(x.ultima_vez | 0, y.ultima_vez | 0);
      r.ms_ultimo = nuevo.ms_ultimo | 0;
      r.ultimo_resultado = nuevo.ultimo_resultado || '';
      const mejores = [x.ms_mejor, y.ms_mejor].filter((v) => v > 0);
      r.ms_mejor = mejores.length ? Math.min.apply(null, mejores) : 0;
      r.marcada = !!(x.marcada || y.marcada);
      out.preguntas[id] = r;
    });
    // Las sesiones son eventos con id propio: se unen sin duplicar.
    const vistas = new Map();
    [...(a.sesiones || []), ...(b.sesiones || [])].forEach((s) => {
      const k = s.uid || (String(s.ts) + '|' + (s.modo || '') + '|' + (s.respondidas || 0));
      if (!vistas.has(k)) vistas.set(k, s);
    });
    out.sesiones = [...vistas.values()].sort((p, q) => (p.ts | 0) - (q.ts | 0));
    return out;
  }

  /* ------------------------------------------------- A · navegador (siempre) */
  function BrowserStore(ns) {
    const k = (x) => ns + '.' + x;
    const leer = (x, def) => {
      try {
        const v = localStorage.getItem(k(x));
        return v ? JSON.parse(v) : def;
      } catch (e) { return def; }
    };
    const escribir = (x, v) => {
      try { localStorage.setItem(k(x), JSON.stringify(v)); return true; } catch (e) { return false; }
    };
    return {
      nombre: 'navegador',
      async cargar() {
        return {
          progress: leer('progress', VACIO_PROG()),
          stats: leer('stats', VACIO_STATS()),
          session: leer('session', null),
          prefs: leer('prefs', {}),
        };
      },
      async guardar(estado) {
        escribir('progress', estado.progress);
        escribir('stats', estado.stats);
        escribir('prefs', estado.prefs);
        if (estado.session) escribir('session', estado.session);
        else { try { localStorage.removeItem(k('session')); } catch (e) {} }
      },
      async borrarTodo() {
        ['progress', 'stats', 'session', 'prefs'].forEach((x) => {
          try { localStorage.removeItem(k(x)); } catch (e) {}
        });
      },
    };
  }

  /* ------------------------------- B · servidor local (puente con terminal) */
  function LocalServerStore(base) {
    const url = (p) => base + p;
    return {
      nombre: 'servidor local',
      async disponible() {
        // El puente con progress.json solo tiene sentido en local. Fuera de
        // ahí ni se pregunta, para no dejar un 404 en la consola del sitio.
        const h = root.location ? root.location.hostname : '';
        const enLocal = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '';
        if (!enLocal) return false;
        try {
          const r = await fetch(url('api/state'), { cache: 'no-store' });
          return r.ok;
        } catch (e) { return false; }
      },
      async cargar() {
        const r = await fetch(url('api/state'), { cache: 'no-store' });
        if (!r.ok) throw new Error('sin servidor');
        const st = await r.json();
        return { progress: st.progress || VACIO_PROG(), stats: st.stats || VACIO_STATS() };
      },
      // El servidor acumula con su propio esquema; se le mandan solo los
      // cambios, que es lo que la app de terminal necesita ver.
      async empujar(cambios) {
        try {
          const r = await fetch(url('api/state'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cambios),
          });
          return r.ok;
        } catch (e) { return false; }
      },
    };
  }

  /* ---------------------------------------------------------------- fachada */
  const Store = {
    ns: 'asorc.v2',
    progress: VACIO_PROG(),
    stats: VACIO_STATS(),
    session: null,
    prefs: {},
    local: null,            // LocalServerStore si lo hay
    browser: null,
    nube: null,             // SupabaseStore si está configurado
    pendientes: { updates: [], marks: {} },

    async init(opts) {
      const o = opts || {};
      this.ns = o.ns || this.ns;
      this.browser = BrowserStore(this.ns);
      const base = o.base || './';

      const b = await this.browser.cargar();
      this.progress = b.progress; this.stats = b.stats;
      this.session = b.session; this.prefs = b.prefs || {};

      const srv = LocalServerStore(base);
      if (await srv.disponible()) {
        this.local = srv;
        try {
          const s = await srv.cargar();
          // El servidor puede traer progreso de la app de terminal que el
          // navegador no conoce: se funde, nunca se descarta.
          this.progress = fusionaProgreso(this.progress, s.progress);
          this.stats = fusionaStats(this.stats, s.stats);
          await this.browser.guardar(this);
        } catch (e) { /* si falla, seguimos con lo del navegador */ }
      }
      return this;
    },

    /* --------------------------------------------------------- consultas */
    prog(id) { return this.progress.preguntas[id] || null; },
    stat(id) { return this.stats.preguntas[id] || null; },
    vista(id) {
      const p = this.progress.preguntas[id];
      return !!p && (p.veces_vista | 0) > 0;
    },
    marcada(id) {
      const s = this.stats.preguntas[id];
      return !!(s && s.marcada);
    },

    /* --------------------------------------------------------- escrituras */
    // Una respuesta. Se aplica ya en memoria para que el panel no espere a
    // la red, y se encola para el servidor local y la nube.
    registrar(u) {
      const p = Object.assign(filaProg(), this.progress.preguntas[u.id] || {});
      p.veces_vista = (p.veces_vista | 0) + 1;
      if (u.result === 'correct') p.aciertos++;
      else if (u.result === 'wrong') p.fallos++;
      else if (u.result === 'blank') p.blancos++;
      else if (u.result === 'partial') p.parciales++;
      p.ultima_respuesta = u.answer || '';
      p.ultimo_resultado = u.result || '';
      this.progress.preguntas[u.id] = p;

      const s = Object.assign(filaStats(), this.stats.preguntas[u.id] || {});
      s.respuestas = (s.respuestas | 0) + 1;
      s.ms_respuesta_total += u.answerMs | 0;
      s.ms_explicacion_total += u.reviewMs | 0;
      s.ms_ultimo = u.answerMs | 0;
      if (u.answerMs > 0 && (!s.ms_mejor || u.answerMs < s.ms_mejor)) s.ms_mejor = u.answerMs | 0;
      s.ultimo_resultado = u.result || '';
      s.ultima_vez = Math.floor(Date.now() / 1000);
      if (u.marked != null) s.marcada = !!u.marked;
      this.stats.preguntas[u.id] = s;

      // Identificador propio del intento: sincronizar dos veces no duplica.
      u.uid = u.uid || uid();
      this.pendientes.updates.push(u);
      this.guardarLocal();
    },

    marcar(id, on) {
      const s = Object.assign(filaStats(), this.stats.preguntas[id] || {});
      s.marcada = !!on;
      this.stats.preguntas[id] = s;
      this.pendientes.marks[id] = !!on;
      this.guardarLocal();
    },

    cerrarRonda(registro) {
      if (registro) {
        registro.uid = registro.uid || uid();
        this.stats.sesiones.push(registro);
      }
      this.session = null;
      this.guardarLocal();
      return this.sincronizar(registro || null);
    },

    guardarSesion(s) { this.session = s; this.guardarLocal(); },
    descartarSesion() { this.session = null; this.guardarLocal(); },

    guardarLocal() { if (this.browser) this.browser.guardar(this); },

    // Empuja lo pendiente al servidor local (y, si existe, a la nube).
    async sincronizar(sesion) {
      const cambios = {
        updates: this.pendientes.updates,
        marks: this.pendientes.marks,
        session: sesion || null,
      };
      const hay = cambios.updates.length || Object.keys(cambios.marks).length || sesion;
      if (!hay) return false;
      this.pendientes = { updates: [], marks: {} };
      let ok = false;
      if (this.local) ok = await this.local.empujar(cambios);
      if (this.nube) { try { await this.nube.empujar(cambios); } catch (e) {} }
      return ok;
    },

    // Para el cierre de pestaña: sin await y sin perder nada.
    volcarAlSalir(base) {
      const c = this.pendientes;
      if (!this.local || (!c.updates.length && !Object.keys(c.marks).length)) return;
      try {
        navigator.sendBeacon((base || './') + 'api/state',
          new Blob([JSON.stringify(c)], { type: 'application/json' }));
        this.pendientes = { updates: [], marks: {} };
      } catch (e) {}
    },

    /* ------------------------------------------------------- importación */
    // §27: nunca sobrescribir lo más completo con lo más pobre.
    importar(progress, stats) {
      const antes = Object.keys(this.progress.preguntas).length;
      this.progress = fusionaProgreso(this.progress, progress || VACIO_PROG());
      this.stats = fusionaStats(this.stats, stats || VACIO_STATS());
      this.guardarLocal();
      return { antes, ahora: Object.keys(this.progress.preguntas).length };
    },

    exportar() {
      return { progress: this.progress, stats: this.stats, prefs: this.prefs };
    },
  };

  // Identificador de evento generado en cliente: sincronizar dos veces no
  // puede duplicar nada (§26).
  function uid() {
    const c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  root.Store = Store;
  root.StoreInternals = {
    VACIO_PROG, VACIO_STATS, filaProg, filaStats,
    fusionaProgreso, fusionaStats, BrowserStore, LocalServerStore, uid,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Store, ...root.StoreInternals };
  }

})(typeof window !== 'undefined' ? window : globalThis);
