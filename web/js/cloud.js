/* ASORC · sincronización con Supabase, sin cuentas y en segundo plano.
 *
 * Decisión deliberada: no hay Auth, ni correo, ni enlaces mágicos, ni usuarios.
 * Hay UN progreso, el del perfil 'default', y lo comparten todos los
 * navegadores que abran la web. Se entra con el rol anon usando la publishable
 * key, y las políticas de supabase/schema.sql son públicas a propósito.
 *
 * El riesgo está asumido: quien descubra la URL puede leer o cambiar el
 * progreso. Lo que se guarda es cuántas preguntas de LPIC-2 llevas acertadas.
 *
 * Aquí NUNCA entra una sb_secret_ ni una service_role: saltan RLS.
 *
 * ------------------------------------------------------------------------
 * CÓMO FUNCIONA
 *
 * Estudiar nunca espera a la red. Responder escribe en localStorage y apunta
 * un evento en la cola (store.outbox). Esto de aquí vacía esa cola cuando
 * puede: al responder, al volver la conexión, al abrir, o pasado un rato si
 * algo falló. Un evento solo se borra de la cola cuando Supabase confirma que
 * lo tiene, y como cada uno lleva identificador propio, mandarlo dos veces no
 * cuenta dos veces.
 *
 * El histórico son EVENTOS, no sumas: asorc_attempts es un registro de
 * intentos y los contadores del panel se derivan sumándolo. Por eso dos
 * dispositivos que estudian a la vez no se pisan.
 *
 * Regla que sostiene todo lo anterior: no se baja nada mientras quede algo
 * por subir. Si se bajara antes, la fusión (que se queda con el contador más
 * alto) podría dar por buena una cuenta que aún no incluye lo de este
 * navegador. Ver `sincronizar`.
 */
'use strict';

(function (root) {

  const CDN = 'https://esm.sh/@supabase/supabase-js@2';
  const PERFIL = 'default';      // único perfil: no hay usuarios
  const PENDIENTE_ID = 'main';   // una única ronda a medias, global
  const LOTE = 500;              // filas por petición al subir
  const PAGINA = 1000;           // filas por petición al bajar
  // Reintentos espaciados: ni insistir cada segundo ni rendirse.
  const ESPERAS = [2000, 5000, 15000, 60000, 300000];

  const Cloud = {
    cfg: null,
    sb: null,
    store: null,
    // solo-local · sincronizando · sincronizado · pendiente · sin-conexion · error
    estado: 'solo-local',
    error: null,
    ultima: 0,
    alCambiar: null,

    _enVuelo: null,
    _otraVez: false,
    _intento: 0,
    _temporizador: null,

    configurada() {
      const c = root.ASORC_CONFIG;
      return !!(c && c.supabaseUrl && c.supabaseAnonKey);
    },

    pendientes() {
      return this.store && this.store.outbox ? this.store.outbox.tamano() : 0;
    },

    viva() { return !!this.sb && this.estado !== 'error'; },

    _estado(e, err) {
      const antes = this.estado, antesN = this._ultimoN;
      this.estado = e;
      this._ultimoN = this.pendientes();
      if (err !== undefined) this.error = err;
      if (this.alCambiar && (antes !== e || antesN !== this._ultimoN)) this.alCambiar(e);
    },

    /* ------------------------------------------------------------ arranque */
    async init(store) {
      this.store = store || null;
      if (!this.configurada()) {
        this._estado('solo-local', 'Sin configurar: falta web/config.js.');
        return this;
      }
      this.cfg = root.ASORC_CONFIG;
      if (/sb_secret_|service_role/i.test(this.cfg.supabaseAnonKey || '')) {
        this._estado('error', 'Esa clave no es pública. Usa la publishable, nunca la secret.');
        return this;
      }
      try {
        const mod = await import(/* webpackIgnore: true */ CDN);
        this.sb = mod.createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        });
        // Una lectura de prueba dice si las tablas existen y si anon puede leer.
        const r = await this.sb.from('asorc_attempts').select('event_id').limit(1);
        if (r.error) {
          this._estado('error', this._mensaje(r.error));
          return this;
        }
        this._estado(this.pendientes() ? 'pendiente' : 'sincronizado', null);
      } catch (e) {
        this._estado('error', 'No se pudo cargar el cliente: ' + e.message);
      }
      return this;
    },

    // Avisos que se entienden sin abrir la consola.
    _mensaje(err) {
      const c = err.code || '';
      const m = err.message || '';
      if (c === '42P01' || c === 'PGRST205') {
        return 'Faltan las tablas. Pega supabase/schema.sql en el editor SQL de Supabase.';
      }
      if (c === '42501') {
        return 'RLS no deja al rol anon. Vuelve a ejecutar supabase/schema.sql.';
      }
      if (c === '42703' || c === 'PGRST204' || c === '22P02' || c === '23502') {
        return 'Las tablas son del esquema anterior. Pega supabase/schema.sql en el editor SQL de Supabase.';
      }
      if (/fetch failed|Failed to fetch|Load failed|NetworkError|ECONNREFUSED|network/i.test(m)) {
        return 'Sin conexión.';
      }
      return (c ? c + ': ' : '') + (m || 'error desconocido');
    },

    /* --------------------------------------------------------- escuchas
     * La cola se vacía sola: cuando vuelve la red, cuando se vuelve a mirar
     * la pestaña y, si algo falló, cuando toca el siguiente reintento.
     */
    escuchar() {
      if (this._escuchando || typeof addEventListener !== 'function') return;
      this._escuchando = true;
      addEventListener('online', () => {
        this._intento = 0;                 // vuelve la red: sin penalización
        // Si al abrir no había red, el cliente ni llegó a crearse.
        if (!this.sb && this.configurada()) {
          this.init(this.store).then(() => this.flush());
          return;
        }
        this.flush();
      });
      addEventListener('offline', () => {
        if (this.pendientes()) this._estado('sin-conexion');
      });
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden && this.pendientes()) this.flush();
        });
      }
    },

    _programar() {
      if (this._temporizador) return;
      const espera = ESPERAS[Math.min(this._intento, ESPERAS.length - 1)];
      this._intento++;
      this._temporizador = setTimeout(() => {
        this._temporizador = null;
        this.flush();
      }, espera);
      if (this._temporizador && this._temporizador.unref) this._temporizador.unref();
    },

    _cancelar() {
      if (this._temporizador) { clearTimeout(this._temporizador); this._temporizador = null; }
      this._intento = 0;
    },

    /* ------------------------------------------------------------ vaciar
     * Manda lo que haya en la cola. No lanza nunca y no bloquea a nadie:
     * quien la llama puede ignorar el resultado.
     */
    flush(opciones) {
      if (this._enVuelo) { this._otraVez = true; return this._enVuelo; }
      this._enVuelo = this._flush(opciones || {}).then((r) => {
        this._enVuelo = null;
        if (this._otraVez) { this._otraVez = false; this.flush(); }
        return r;
      }, () => { this._enVuelo = null; return { ok: false }; });
      return this._enVuelo;
    },

    async _flush(o) {
      const st = this.store;
      if (!st || !st.outbox) return { ok: false, motivo: 'sin cola' };
      const cola = st.outbox.lista();
      if (!cola.length) {
        if (this.viva()) { this._cancelar(); this._estado('sincronizado', null); }
        return { ok: true, enviados: 0 };
      }
      if (!this.viva()) { this._estado(this.estado === 'error' ? 'error' : 'solo-local'); return { ok: false, motivo: this.error }; }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this._estado('sin-conexion');
        return { ok: false, motivo: 'sin conexión' };
      }

      this._estado('sincronizando');
      const grupos = { intento: [], marca: [], ronda: [], pendiente: [] };
      cola.forEach((e) => { if (grupos[e.tipo]) grupos[e.tipo].push(e); });

      const hechos = [];
      let fallo = null;

      const envia = async (nombre, fn) => {
        if (!grupos[nombre].length || fallo) return;
        try {
          await fn(grupos[nombre]);
          grupos[nombre].forEach((e) => hechos.push(e.id));
        } catch (e) { fallo = e; }
      };

      await envia('intento', async (evs) => {
        const filas = evs.map((e) => Object.assign({ profile_id: PERFIL }, e.payload));
        for (let i = 0; i < filas.length; i += LOTE) {
          const r = await this.sb.from('asorc_attempts')
            .upsert(filas.slice(i, i + LOTE), { onConflict: 'event_id', ignoreDuplicates: true });
          if (r.error) throw r.error;
        }
      });
      await envia('marca', async (evs) => {
        const filas = evs.map((e) => Object.assign({ profile_id: PERFIL }, e.payload));
        const r = await this.sb.from('asorc_marks')
          .upsert(filas, { onConflict: 'profile_id,question_id' });
        if (r.error) throw r.error;
      });
      await envia('ronda', async (evs) => {
        const filas = evs.map((e) => ({
          uid: e.payload.uid, profile_id: PERFIL, payload: e.payload.payload,
        }));
        const r = await this.sb.from('asorc_sessions')
          .upsert(filas, { onConflict: 'uid', ignoreDuplicates: true });
        if (r.error) throw r.error;
      });
      await envia('pendiente', async (evs) => {
        const ultimo = evs[evs.length - 1];        // solo importa el último
        const r = await this.sb.from('asorc_pending').upsert([{
          id: PENDIENTE_ID, profile_id: PERFIL,
          payload: ultimo.payload.payload || null,
          updated_at: ultimo.payload.updated_at || new Date().toISOString(),
        }], { onConflict: 'id' });
        if (r.error) throw r.error;
      });

      if (hechos.length) st.outbox.quitar(hechos);

      if (fallo) {
        const msg = this._mensaje(fallo);
        // Un esquema equivocado no se arregla reintentando; la red sí.
        const recuperable = !/tablas|RLS/i.test(msg);
        this._estado(recuperable ? 'pendiente' : 'error', msg);
        if (recuperable) this._programar();
        return { ok: false, enviados: hechos.length, motivo: msg };
      }

      this._cancelar();
      this.ultima = Date.now();
      this._estado('sincronizado', null);
      return { ok: true, enviados: hechos.length };
    },

    /* ------------------------------------------------------------ bajar
     * El progreso no se guarda sumado: se reconstruye a partir de los
     * intentos. PostgREST sirve mil filas por petición, así que se pagina.
     */
    async _todas(tabla, orden) {
      const out = [];
      for (let desde = 0; ; desde += PAGINA) {
        let q = this.sb.from(tabla).select('*').eq('profile_id', PERFIL);
        if (orden) q = q.order(orden, { ascending: true });
        const r = await q.range(desde, desde + PAGINA - 1);
        if (r.error) throw r.error;
        out.push(...(r.data || []));
        if (!r.data || r.data.length < PAGINA) break;
      }
      return out;
    },

    // Un intento suma a los contadores. Lo usan tanto lo que se baja como lo
    // que se acaba de subir, para no tener que volver a bajarlo.
    _acumula(progress, stats, r) {
      const P = root.StoreInternals;
      const q = Object.assign(P.filaProg(), progress.preguntas[r.question_id] || {});
      q.veces_vista++;
      if (r.result === 'correct') q.aciertos++;
      else if (r.result === 'wrong') q.fallos++;
      else if (r.result === 'blank') q.blancos++;
      else if (r.result === 'partial') q.parciales++;
      q.ultima_respuesta = r.answer || q.ultima_respuesta || '';
      q.ultimo_resultado = r.result;
      progress.preguntas[r.question_id] = q;

      const t = Object.assign(P.filaStats(), stats.preguntas[r.question_id] || {});
      t.respuestas++;
      t.ms_respuesta_total += r.answer_ms | 0;
      t.ms_explicacion_total += r.review_ms | 0;
      if (r.answer_ms) t.ms_ultimo = r.answer_ms | 0;
      if (r.answer_ms > 0 && (!t.ms_mejor || r.answer_ms < t.ms_mejor)) t.ms_mejor = r.answer_ms | 0;
      t.ultimo_resultado = r.result;
      const cuando = r.answered_at || r.created_at;
      if (cuando) {
        t.ultima_vez = Math.max(t.ultima_vez | 0, Math.floor(new Date(cuando).getTime() / 1000));
      }
      stats.preguntas[r.question_id] = t;
    },

    async traer() {
      if (!this.viva()) return null;
      const [intentos, marcas, sesiones, pend] = await Promise.all([
        this._todas('asorc_attempts', 'answered_at'),
        this._todas('asorc_marks'),
        this._todas('asorc_sessions', 'created_at'),
        this.sb.from('asorc_pending').select('*').eq('id', PENDIENTE_ID).maybeSingle(),
      ]);

      const P = root.StoreInternals;
      const progress = P.VACIO_PROG(), stats = P.VACIO_STATS();
      intentos.forEach((r) => this._acumula(progress, stats, r));
      marcas.forEach((r) => {
        const t = Object.assign(P.filaStats(), stats.preguntas[r.question_id] || {});
        t.marcada = !!r.marked;
        t.marcada_ts = r.updated_at ? new Date(r.updated_at).getTime() : 0;
        stats.preguntas[r.question_id] = t;
      });
      stats.sesiones = sesiones.map((r) => r.payload).filter(Boolean);
      const pendiente = pend && pend.data ? pend.data.payload : null;
      return { progress, stats, pendiente };
    },

    /* ------------------------------------------------- histórico de fuera
     * Lo que este navegador sabe y la nube no: el progreso de la app de
     * terminal que llega por progress.json, o un archivo importado. No son
     * eventos, así que hay que convertirlos en intentos.
     *
     * La diferencia se calcula contra lo que la nube tiene AHORA MISMO, no
     * contra una cuenta guardada aquí. Así no hay contabilidad que se pueda
     * desincronizar: si la nube ya tiene tres aciertos de una pregunta y
     * aquí hay tres, no se manda nada; si aquí hay cinco, se mandan dos.
     * Vale para arreglar solo un desajuste anterior, y repetirlo no duplica.
     */
    _diferencia(store, remoto) {
      const filas = [];
      const pr = store.progress.preguntas;
      const rp = (remoto && remoto.progress.preguntas) || {};
      Object.keys(pr).forEach((id) => {
        const q = pr[id], s = store.stats.preguntas[id] || {}, r = rp[id] || {};
        [['correct', 'aciertos'], ['wrong', 'fallos'],
         ['blank', 'blancos'], ['partial', 'parciales']].forEach(([res, campo]) => {
          const hay = r[campo] | 0;
          for (let i = hay + 1; i <= (q[campo] | 0); i++) {
            filas.push({
              event_id: `local:${id}:${res}:${i}`, profile_id: PERFIL,
              question_id: id, result: res,
              answer: res === q.ultimo_resultado ? (q.ultima_respuesta || '') : '',
              answer_ms: i === hay + 1 ? (s.ms_ultimo | 0) : 0, review_ms: 0,
              marked: !!s.marcada,
            });
          }
        });
      });
      return filas;
    },

    async _subirIntentos(filas) {
      for (let i = 0; i < filas.length; i += LOTE) {
        const r = await this.sb.from('asorc_attempts')
          .upsert(filas.slice(i, i + LOTE), { onConflict: 'event_id', ignoreDuplicates: true });
        if (r.error) throw r.error;
      }
    },

    /* --------------------------------------------------------- fusionar
     * Primero sube, después baja. Nunca al revés: ver la cabecera.
     */
    async sincronizar(store, opciones) {
      const o = opciones || {};
      store = store || this.store;
      if (!this.viva()) return { ok: false, motivo: this.error || 'sin nube' };
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this._estado('sin-conexion');
        return { ok: false, motivo: 'sin conexión' };
      }

      // 1 · la cola. Si queda algo sin subir, NO se baja: lo remoto no
      //     contendría a lo local y fusionar dejaría cuentas cortas.
      const subida = await this._flush({});
      if (!subida.ok || store.outbox.tamano()) {
        return { ok: false, motivo: subida.motivo || 'quedan cambios por subir' };
      }

      try {
        this._estado('sincronizando');
        // 2 · lo que hay arriba
        const remoto = await this.traer();
        if (!remoto) return { ok: false, motivo: 'sin respuesta' };

        // 3 · el histórico que la nube no conoce, si lo hay
        const filas = this._diferencia(store, remoto);
        if (filas.length) {
          await this._subirIntentos(filas);
          filas.forEach((f) => this._acumula(remoto.progress, remoto.stats, f));
        }

        // 4 · fusionar: a estas alturas lo remoto contiene a lo local
        store.importar(remoto.progress, remoto.stats);
        // La ronda a medias: si aquí no hay ninguna, se adopta la de la nube.
        if (!store.session && remoto.pendiente && !o.sinPendiente) {
          store.session = remoto.pendiente;
          store.guardarLocal();
        }
        this.ultima = Date.now();
        this._estado('sincronizado', null);
        return { ok: true, subidas: filas.length };
      } catch (e) {
        const msg = this._mensaje(e);
        this._estado(/tablas|RLS/i.test(msg) ? 'error' : 'pendiente', msg);
        return { ok: false, motivo: msg };
      }
    },
  };

  root.Cloud = Cloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cloud;

})(typeof window !== 'undefined' ? window : globalThis);
