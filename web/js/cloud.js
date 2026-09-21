/* ASORC · sincronización opcional con Supabase.
 *
 * Todo aquí es prescindible: si no hay configuración, la aplicación funciona
 * igual y solo se ve un aviso discreto. Nunca hay pantalla de login al entrar.
 *
 * Seguridad: en el navegador solo viven la URL del proyecto y la clave
 * publishable/anon, que son PÚBLICAS por diseño. Quien protege los datos es
 * Supabase Auth + RLS (cada fila lleva user_id = auth.uid()). Aquí no entra
 * jamás una service_role ni ningún secreto.
 */
'use strict';

(function (root) {

  const CDN = 'https://esm.sh/@supabase/supabase-js@2';

  const Cloud = {
    cfg: null,
    sb: null,
    user: null,
    estado: 'desactivada',   // desactivada | desconectado | conectado | error
    error: null,

    configurada() {
      const c = root.ASORC_CONFIG;
      return !!(c && c.supabaseUrl && c.supabaseAnonKey);
    },

    async init() {
      if (!this.configurada()) { this.estado = 'desactivada'; return this; }
      this.cfg = root.ASORC_CONFIG;
      if (/service_role|secret/i.test(this.cfg.supabaseAnonKey || '')) {
        this.estado = 'error';
        this.error = 'Esa clave no es pública. Usa la anon/publishable, nunca la service_role.';
        return this;
      }
      try {
        const mod = await import(/* webpackIgnore: true */ CDN);
        this.sb = mod.createClient(this.cfg.supabaseUrl, this.cfg.supabaseAnonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        const { data } = await this.sb.auth.getSession();
        this.user = data && data.session ? data.session.user : null;
        this.estado = this.user ? 'conectado' : 'desconectado';
        this.sb.auth.onAuthStateChange((_e, ses) => {
          this.user = ses ? ses.user : null;
          this.estado = this.user ? 'conectado' : 'desconectado';
          if (this.alCambiar) this.alCambiar(this.estado);
        });
      } catch (e) {
        this.estado = 'error';
        this.error = 'No se pudo cargar el cliente de Supabase: ' + e.message;
      }
      return this;
    },

    async entrar(email) {
      if (!this.sb) throw new Error('sincronización no configurada');
      const { error } = await this.sb.auth.signInWithOtp({
        email, options: { emailRedirectTo: root.location.href.split('#')[0] },
      });
      if (error) throw error;
      return true;
    },

    async salir() { if (this.sb) await this.sb.auth.signOut(); },

    /* ---- envío: idempotente por el uid que genera el cliente ---- */
    async empujar(cambios) {
      if (!this.sb || !this.user) return false;
      const uid = this.user.id;
      const intentos = (cambios.updates || []).map((u) => ({
        uid: u.uid, user_id: uid, question_id: u.id, result: u.result,
        answer: u.answer || '', answer_ms: u.answerMs | 0, review_ms: u.reviewMs | 0,
        marked: !!u.marked,
      }));
      if (intentos.length) {
        await this.sb.from('asorc_attempts')
          .upsert(intentos, { onConflict: 'uid', ignoreDuplicates: true });
      }
      const marcas = Object.keys(cambios.marks || {}).map((id) => ({
        user_id: uid, question_id: id, marked: !!cambios.marks[id], updated_at: new Date().toISOString(),
      }));
      if (marcas.length) {
        await this.sb.from('asorc_marks').upsert(marcas, { onConflict: 'user_id,question_id' });
      }
      if (cambios.session) {
        await this.sb.from('asorc_sessions')
          .upsert([{ uid: cambios.session.uid, user_id: uid, payload: cambios.session }],
                  { onConflict: 'uid', ignoreDuplicates: true });
      }
      return true;
    },

    async guardarPendiente(sesion) {
      if (!this.sb || !this.user) return false;
      await this.sb.from('asorc_pending').upsert([{
        user_id: this.user.id, payload: sesion || null, updated_at: new Date().toISOString(),
      }], { onConflict: 'user_id' });
      return true;
    },

    /* ---- descarga: el progreso se RECONSTRUYE de los intentos ---- */
    async traer() {
      if (!this.sb || !this.user) return null;
      const [a, m, s] = await Promise.all([
        this.sb.from('asorc_attempts').select('*').order('created_at', { ascending: true }),
        this.sb.from('asorc_marks').select('*'),
        this.sb.from('asorc_sessions').select('*'),
      ]);
      if (a.error) throw a.error;
      const P = root.StoreInternals;
      const progress = P.VACIO_PROG(), stats = P.VACIO_STATS();
      (a.data || []).forEach((r) => {
        const p = Object.assign(P.filaProg(), progress.preguntas[r.question_id] || {});
        p.veces_vista++;
        if (r.result === 'correct') p.aciertos++;
        else if (r.result === 'wrong') p.fallos++;
        else if (r.result === 'blank') p.blancos++;
        else if (r.result === 'partial') p.parciales++;
        p.ultima_respuesta = r.answer || '';
        p.ultimo_resultado = r.result;
        progress.preguntas[r.question_id] = p;

        const t = Object.assign(P.filaStats(), stats.preguntas[r.question_id] || {});
        t.respuestas++;
        t.ms_respuesta_total += r.answer_ms | 0;
        t.ms_explicacion_total += r.review_ms | 0;
        t.ms_ultimo = r.answer_ms | 0;
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
      return { progress, stats };
    },

    // Todo el progreso local sube y todo lo de la nube baja: la fusión del
    // Store se queda siempre con lo más completo.
    async sincronizarTodo(store) {
      if (!this.sb || !this.user) return { ok: false, motivo: 'sin sesión' };
      const local = store.exportar();
      const subidas = [];
      Object.keys(local.progress.preguntas).forEach((id) => {
        const p = local.progress.preguntas[id];
        const s = local.stats.preguntas[id] || {};
        // Un intento resumen por pregunta, con uid estable: si ya está, no se
        // duplica; si no, la nube recibe el histórico local.
        subidas.push({
          uid: 'local:' + this.user.id + ':' + id,
          user_id: this.user.id, question_id: id,
          result: p.ultimo_resultado || 'correct',
          answer: p.ultima_respuesta || '',
          answer_ms: s.ms_ultimo | 0, review_ms: 0, marked: !!s.marcada,
        });
      });
      if (subidas.length) {
        await this.sb.from('asorc_attempts')
          .upsert(subidas, { onConflict: 'uid', ignoreDuplicates: true });
      }
      const remoto = await this.traer();
      if (remoto) store.importar(remoto.progress, remoto.stats);
      return { ok: true, subidas: subidas.length };
    },
  };

  root.Cloud = Cloud;
  if (typeof module !== 'undefined' && module.exports) module.exports = Cloud;

})(typeof window !== 'undefined' ? window : globalThis);
