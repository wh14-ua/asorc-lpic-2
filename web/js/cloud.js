/* ASORC · sincronización con Supabase, sin cuentas.
 *
 * Decisión deliberada: no hay Auth, ni correo, ni enlaces mágicos, ni usuarios.
 * Hay UN progreso y lo comparten todos los navegadores que abran la web. El
 * navegador entra con el rol anon usando la publishable key y las políticas de
 * supabase/schema.sql son públicas a propósito.
 *
 * El riesgo está asumido: quien descubra la URL puede leer o cambiar el
 * progreso. Lo que se guarda es cuántas preguntas de LPIC-2 llevas acertadas.
 *
 * Aquí NUNCA entra una sb_secret_ ni una service_role: saltan RLS.
 *
 * El navegador manda en local: localStorage funciona siempre y sin red. La nube
 * es un espejo que se funde al abrir y después de cada respuesta.
 */
'use strict';

(function (root) {

  const CDN = 'https://esm.sh/@supabase/supabase-js@2';
  const PENDIENTE_ID = 'main';          // una única ronda a medias, global

  const Cloud = {
    cfg: null,
    sb: null,
    estado: 'solo-local',   // solo-local | sincronizado | error
    error: null,
    ultima: 0,
    alCambiar: null,

    configurada() {
      const c = root.ASORC_CONFIG;
      return !!(c && c.supabaseUrl && c.supabaseAnonKey);
    },

    _estado(e, err) {
      this.estado = e;
      this.error = err || null;
      if (this.alCambiar) this.alCambiar(e);
    },

    async init() {
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
        const r = await this.sb.from('asorc_attempts').select('uid').limit(1);
        if (r.error) {
          this._estado('error', this._mensaje(r.error));
          return this;
        }
        this._estado('sincronizado');
      } catch (e) {
        this._estado('error', 'No se pudo cargar el cliente: ' + e.message);
      }
      return this;
    },

    _mensaje(err) {
      const c = err.code || '';
      if (c === '42P01' || c === 'PGRST205') {
        return 'Faltan las tablas. Pega supabase/schema.sql en el editor SQL de Supabase.';
      }
      if (c === '42501') {
        return 'RLS no deja al rol anon. Vuelve a ejecutar supabase/schema.sql.';
      }
      if (c === '22P02' || c === '23502' || c === 'PGRST204') {
        // Columnas del esquema anterior (uid como uuid, propietario obligatorio).
        return 'Las tablas son del esquema anterior. Pega supabase/schema.sql en el editor SQL de Supabase.';
      }
      return (c ? c + ': ' : '') + (err.message || 'error desconocido');
    },

    /* ------------------------------------------------------------ subir */
    async empujar(cambios) {
      if (!this.sb || this.estado === 'error') return false;
      try {
        const filas = (cambios.updates || []).map((u) => ({
          uid: u.uid, question_id: u.id, result: u.result,
          answer: u.answer || '', answer_ms: u.answerMs | 0,
          review_ms: u.reviewMs | 0, marked: !!u.marked,
        })).filter((f) => f.uid);
        if (filas.length) {
          const r = await this.sb.from('asorc_attempts')
            .upsert(filas, { onConflict: 'uid', ignoreDuplicates: true });
          if (r.error) throw r.error;
        }
        const marcas = Object.keys(cambios.marks || {}).map((id) => ({
          question_id: id, marked: !!cambios.marks[id], updated_at: new Date().toISOString(),
        }));
        if (marcas.length) {
          const r = await this.sb.from('asorc_marks')
            .upsert(marcas, { onConflict: 'question_id' });
          if (r.error) throw r.error;
        }
        if (cambios.session) {
          const r = await this.sb.from('asorc_sessions')
            .upsert([{ uid: cambios.session.uid, payload: cambios.session }],
                    { onConflict: 'uid', ignoreDuplicates: true });
          if (r.error) throw r.error;
        }
        this.ultima = Date.now();
        if (this.estado !== 'sincronizado') this._estado('sincronizado');
        return true;
      } catch (e) {
        this._estado('error', this._mensaje(e));
        return false;
      }
    },

    // La ronda a medias es una sola fila global.
    async guardarPendiente(sesion) {
      if (!this.sb || this.estado === 'error') return false;
      try {
        const r = await this.sb.from('asorc_pending').upsert([{
          id: PENDIENTE_ID, payload: sesion || null, updated_at: new Date().toISOString(),
        }], { onConflict: 'id' });
        if (r.error) throw r.error;
        return true;
      } catch (e) { return false; }
    },

    /* ------------------------------------------------------------ bajar */
    // El progreso no se guarda: se reconstruye sumando los intentos.
    async traer() {
      if (!this.sb || this.estado === 'error') return null;
      const [a, m, s, p] = await Promise.all([
        this.sb.from('asorc_attempts').select('*').order('created_at', { ascending: true }),
        this.sb.from('asorc_marks').select('*'),
        this.sb.from('asorc_sessions').select('*'),
        this.sb.from('asorc_pending').select('*').eq('id', PENDIENTE_ID).maybeSingle(),
      ]);
      if (a.error) throw a.error;

      const P = root.StoreInternals;
      const progress = P.VACIO_PROG(), stats = P.VACIO_STATS();
      (a.data || []).forEach((r) => {
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
        t.ultima_vez = Math.floor(new Date(r.created_at).getTime() / 1000);
        stats.preguntas[r.question_id] = t;
      });
      (m.data || []).forEach((r) => {
        const t = Object.assign(P.filaStats(), stats.preguntas[r.question_id] || {});
        t.marcada = !!r.marked;
        stats.preguntas[r.question_id] = t;
      });
      stats.sesiones = (s.data || []).map((r) => r.payload).filter(Boolean);
      const pendiente = p && p.data ? p.data.payload : null;
      return { progress, stats, pendiente };
    },

    /* --------------------------------------------------------- fusionar */
    /* Lo que este navegador sabe y la nube no, sube; lo que la nube sabe y este
     * navegador no, baja. La fusión del Store se queda con lo más completo, así
     * que da igual el orden y repetirla no cambia nada. */
    async sincronizar(store, opciones) {
      const o = opciones || {};
      if (!this.sb || this.estado === 'error') {
        return { ok: false, motivo: this.error || 'sin conexión' };
      }
      try {
        // 1 · el histórico local se expresa como intentos con uid determinista:
        //     subirlo dos veces no crea filas nuevas.
        const filas = [];
        const pr = store.progress.preguntas;
        Object.keys(pr).forEach((id) => {
          const q = pr[id], s = store.stats.preguntas[id] || {};
          [['correct', q.aciertos], ['wrong', q.fallos],
           ['blank', q.blancos], ['partial', q.parciales]].forEach(([res, n]) => {
            for (let i = 1; i <= (n | 0); i++) {
              filas.push({
                uid: `local:${id}:${res}:${i}`, question_id: id, result: res,
                answer: res === q.ultimo_resultado ? (q.ultima_respuesta || '') : '',
                answer_ms: i === 1 ? (s.ms_ultimo | 0) : 0, review_ms: 0,
                marked: !!s.marcada,
              });
            }
          });
        });
        for (let i = 0; i < filas.length; i += 500) {
          const r = await this.sb.from('asorc_attempts')
            .upsert(filas.slice(i, i + 500), { onConflict: 'uid', ignoreDuplicates: true });
          if (r.error) throw r.error;
        }
        // 2 · las marcas locales
        const marcas = Object.keys(store.stats.preguntas)
          .filter((id) => store.stats.preguntas[id].marcada)
          .map((id) => ({ question_id: id, marked: true }));
        if (marcas.length) {
          const r = await this.sb.from('asorc_marks').upsert(marcas, { onConflict: 'question_id' });
          if (r.error) throw r.error;
        }
        // 3 · y lo que estuviera en la cola
        await this.empujar({ updates: store.pendientes.updates, marks: store.pendientes.marks });
        store.pendientes = { updates: [], marks: {} };

        // 4 · ahora se baja todo y se funde
        const remoto = await this.traer();
        if (remoto) {
          store.importar(remoto.progress, remoto.stats);
          // La ronda a medias: si aquí no hay ninguna, se adopta la de la nube.
          if (!store.session && remoto.pendiente && !o.sinPendiente) {
            store.guardarSesion(remoto.pendiente);
          } else if (store.session) {
            await this.guardarPendiente(store.session);
          }
        }
        this.ultima = Date.now();
        this._estado('sincronizado');
        return { ok: true, subidas: filas.length };
      } catch (e) {
        this._estado('error', this._mensaje(e));
        return { ok: false, motivo: this.error };
      }
    },
  };

  root.Cloud = Cloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cloud;

})(typeof window !== 'undefined' ? window : globalThis);
