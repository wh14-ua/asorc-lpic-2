/* ASORC · persistencia.
 *
 * Tres capas, y solo la primera es obligatoria:
 *
 *   BrowserStore        localStorage. Siempre funciona, también en GitHub Pages.
 *   LocalServerStore    el servidor de ./asorc-web. Es el puente con
 *                       progress.json y, por tanto, con la app de terminal.
 *   Cloud (cloud.js)    sincronización entre navegadores, en segundo plano.
 *
 * El esquema de «progreso» es el MISMO que usa la aplicación de terminal, para
 * que los dos sigan leyéndose. Lo que la terminal no conoce (tiempos, marcas,
 * sesiones) vive aparte, en «stats». El mazo de repaso rápido, en «cards».
 *
 * PRIMERO LO LOCAL. Responder una pregunta escribe en localStorage y sigue. La
 * nube nunca está en el camino: lo que hay que mandarle se apunta en una cola
 * (Outbox) y se manda cuando se pueda. Si la red falla, la cola espera.
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
    ms_ultimo: 0, ms_mejor: 0, marcada: false, marcada_ts: 0,
    ultimo_resultado: '', ultima_vez: 0,
  });

  /* ---------------------------------------------------------------- fusión
   * Los contadores son históricos: se queda con lo más alto. Eso es correcto
   * porque la nube guarda INTENTOS, no sumas: antes de bajar nada se sube todo
   * lo de aquí, así que lo remoto siempre contiene a lo local (cloud.js se
   * ocupa de no invertir ese orden).
   *
   * La marca de repaso no es un contador sino un estado que se puede quitar,
   * así que se decide por su marca de tiempo: gana el último que la tocó.
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
      // Desmarcar tiene que poder viajar: manda el reloj, no el «sí» de nadie.
      // Ojo con «| 0» aquí: una fecha en milisegundos no cabe en 32 bits.
      const tx = Number(x.marcada_ts) || 0, ty = Number(y.marcada_ts) || 0;
      if (tx || ty) {
        r.marcada = !!(ty >= tx ? y : x).marcada;
        r.marcada_ts = Math.max(tx, ty);
      } else {
        r.marcada = !!(x.marcada || y.marcada);   // datos viejos, sin reloj
        r.marcada_ts = 0;
      }
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
      leer, escribir,
      async cargar() {
        return {
          progress: leer('progress', VACIO_PROG()),
          stats: leer('stats', VACIO_STATS()),
          session: leer('session', null),
          prefs: leer('prefs', {}),
          cards: leer('cards', {}),
        };
      },
      async guardar(estado) {
        escribir('progress', estado.progress);
        escribir('stats', estado.stats);
        escribir('prefs', estado.prefs);
        escribir('cards', estado.cards || {});
        if (estado.session) escribir('session', estado.session);
        else { try { localStorage.removeItem(k('session')); } catch (e) {} }
      },
      async borrarTodo() {
        ['progress', 'stats', 'session', 'prefs', 'cards', 'syncQueue', 'seed'].forEach((x) => {
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

  /* --------------------------------------------------- C · cola de salida
   * Lo que la nube todavía no ha confirmado. Vive en localStorage, así que
   * sobrevive a cerrar el navegador, a quedarse sin red y a recargar.
   *
   * Un evento solo se borra de aquí cuando Supabase confirma que lo tiene.
   * Como cada uno lleva su propio identificador, mandarlo dos veces no
   * duplica nada (lo garantiza la clave primaria del otro lado).
   *
   * Hay dos clases de evento:
   *   intento, ronda, tarjeta   son hechos, se acumulan: van todos.
   *   marca, pendiente          son estados, solo importa el último: se funden.
   */
  function Outbox(ns) {
    const clave = ns + '.syncQueue';
    const TOPE = 5000;

    const leer = () => {
      try {
        const v = JSON.parse(localStorage.getItem(clave) || '[]');
        return Array.isArray(v) ? v : [];
      } catch (e) { return []; }
    };
    const escribir = (v) => {
      try { localStorage.setItem(clave, JSON.stringify(v)); } catch (e) {}
    };

    // Clave de fusión: dos eventos con la misma clave son el mismo estado.
    const fusionable = (e) => {
      if (e.tipo === 'marca') return 'marca:' + e.payload.question_id;
      if (e.tipo === 'pendiente') return 'pendiente';
      return null;                       // los hechos no se funden
    };

    const funde = (lista) => {
      const ultimo = new Map();
      lista.forEach((e, i) => { const k = fusionable(e); if (k) ultimo.set(k, i); });
      const out = lista.filter((e, i) => {
        const k = fusionable(e);
        return !k || ultimo.get(k) === i;
      });
      return out.length > TOPE ? out.slice(out.length - TOPE) : out;
    };

    return {
      clave,
      // Se relee siempre de localStorage: puede haber otra pestaña abierta.
      lista() { return leer(); },
      tamano() { return leer().length; },
      anadir(tipo, payload) {
        const ev = { id: uid(), tipo, payload, creado: Date.now() };
        escribir(funde(leer().concat([ev])));
        return ev;
      },
      quitar(ids) {
        const fuera = new Set(ids);
        escribir(leer().filter((e) => !fuera.has(e.id)));
      },
      vaciar() { escribir([]); },
    };
  }

  /* ---------------------------------------------------------------- fachada */
  const Store = {
    ns: 'asorc.v2',
    progress: VACIO_PROG(),
    stats: VACIO_STATS(),
    session: null,
    prefs: {},
    cards: {},              // mazo de repaso rápido, por question_id (micro.js)
    local: null,            // LocalServerStore si lo hay
    browser: null,
    outbox: null,           // cola hacia la nube, la vacía cloud.js
    pendientes: { updates: [], marks: {} },   // cola hacia el servidor local

    async init(opts) {
      const o = opts || {};
      this.ns = o.ns || this.ns;
      this.browser = BrowserStore(this.ns);
      this.outbox = Outbox(this.ns);
      const base = o.base || './';

      const b = await this.browser.cargar();
      this.progress = b.progress; this.stats = b.stats;
      this.session = b.session; this.prefs = b.prefs || {};
      this.cards = b.cards && typeof b.cards === 'object' ? b.cards : {};

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
    // Una respuesta. Se aplica ya en memoria y en localStorage para que nada
    // espere a la red, y se encola para el servidor local y para la nube.
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
      if (u.marked != null && !!u.marked !== !!s.marcada) {
        s.marcada = !!u.marked;
        s.marcada_ts = Date.now();
      }
      this.stats.preguntas[u.id] = s;

      // Identificador propio del intento: mandarlo dos veces no duplica.
      u.uid = u.uid || uid();
      this.pendientes.updates.push(u);
      this.encolar('intento', {
        event_id: u.uid,
        question_id: u.id,
        result: u.result || '',
        answer: u.answer || '',
        answer_ms: u.answerMs | 0,
        review_ms: u.reviewMs | 0,
        marked: !!u.marked,
        answered_at: new Date().toISOString(),
      });
      this.guardarLocal();
    },

    marcar(id, on) {
      const s = Object.assign(filaStats(), this.stats.preguntas[id] || {});
      s.marcada = !!on;
      s.marcada_ts = Date.now();
      this.stats.preguntas[id] = s;
      this.pendientes.marks[id] = !!on;
      this.encolar('marca', {
        question_id: id, marked: !!on, updated_at: new Date(s.marcada_ts).toISOString(),
      });
      this.guardarLocal();
    },

    /* Un evento de repaso rápido: fallo, marca, sabía, dudé o no sabía. Quien
     * llama ya lo ha aplicado al mazo (micro.js); aquí se guarda y se apunta
     * para la nube con su propio identificador, así que reenviarlo no duplica. */
    tarjetaEvento(ev) {
      ev.event_id = ev.event_id || uid();
      this.encolar('tarjeta', {
        event_id: ev.event_id,
        question_id: ev.question_id,
        kind: ev.kind,
        event_at: new Date(ev.at).toISOString(),
      });
      this.guardarLocal();
      return ev;
    },

    cerrarRonda(registro) {
      if (registro) {
        registro.uid = registro.uid || uid();
        this.stats.sesiones.push(registro);
        this.encolar('ronda', { uid: registro.uid, payload: registro });
      }
      this.session = null;
      this.encolar('pendiente', { payload: null, updated_at: new Date().toISOString() });
      this.guardarLocal();
      return this.sincronizar(registro || null);
    },

    guardarSesion(s) {
      this.session = s;
      this.encolar('pendiente', { payload: s, updated_at: new Date().toISOString() });
      this.guardarLocal();
    },

    descartarSesion() {
      this.session = null;
      this.encolar('pendiente', { payload: null, updated_at: new Date().toISOString() });
      this.guardarLocal();
    },

    encolar(tipo, payload) {
      if (this.outbox) this.outbox.anadir(tipo, payload);
    },

    pendientesNube() { return this.outbox ? this.outbox.tamano() : 0; },

    guardarLocal() { if (this.browser) this.browser.guardar(this); },

    // Empuja lo pendiente al servidor local (el puente con la terminal). La
    // nube no pasa por aquí: tiene su propia cola, que no se pierde si falla.
    async sincronizar(sesion) {
      const cambios = {
        updates: this.pendientes.updates,
        marks: this.pendientes.marks,
        session: sesion || null,
      };
      const hay = cambios.updates.length || Object.keys(cambios.marks).length || sesion;
      if (!hay) return false;
      this.pendientes = { updates: [], marks: {} };
      if (!this.local) return false;
      return await this.local.empujar(cambios);
    },

    // Para el cierre de pestaña: sin await y sin perder nada. La cola de la
    // nube no necesita nada aquí, ya está escrita en localStorage.
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
    importar(progress, stats, cards) {
      const antes = Object.keys(this.progress.preguntas).length;
      this.progress = fusionaProgreso(this.progress, progress || VACIO_PROG());
      this.stats = fusionaStats(this.stats, stats || VACIO_STATS());
      // El mazo se funde con la misma regla: gana la tarjeta que sabe más.
      if (cards && typeof cards === 'object' && root.Micro) {
        this.cards = root.Micro.fusiona(this.cards, cards);
      }
      this.guardarLocal();
      return { antes, ahora: Object.keys(this.progress.preguntas).length };
    },

    exportar() {
      return { progress: this.progress, stats: this.stats, prefs: this.prefs, cards: this.cards };
    },

  };

  // Identificador de evento generado en cliente: sincronizar dos veces no
  // puede duplicar nada.
  function uid() {
    const c = root.crypto;
    if (c && c.randomUUID) return c.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  root.Store = Store;
  root.StoreInternals = {
    VACIO_PROG, VACIO_STATS, filaProg, filaStats,
    fusionaProgreso, fusionaStats, BrowserStore, LocalServerStore, Outbox, uid,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Store, ...root.StoreInternals };
  }

})(typeof window !== 'undefined' ? window : globalThis);
