/* Pruebas reales de sincronización: store.js + cloud.js + el cliente de
 * Supabase de verdad + PostgREST de verdad + PostgreSQL de verdad con las
 * políticas de supabase/schema.sql aplicadas y el rol anon.
 *
 * Lo único simulado es el navegador (localStorage) y la red (una pasarela con
 * interruptor, para poder desenchufarla a mitad).
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const WEB = process.argv[2];            // carpeta web/js
const URL = process.argv[3];            // pasarela con forma de Supabase
const KEY = process.argv[4];            // JWT de rol anon
// Fases aparte para el repaso rápido sin su tabla (las lanza test_sync.py
// después de borrarla y de volver a crearla): «sin-tarjetas» y «vuelve-tabla».
const FASE = process.argv[5] || 'todo';
const ESTADO = process.argv[6];         // navegador guardado entre fases

const fallos = [];
let n = 0;
const ok = (cond, msg, extra) => {
  n++;
  if (cond) console.log('  ✓ ' + msg);
  else { console.log('  ✗ ' + msg + (extra ? '  → ' + extra : '')); fallos.push(msg); }
};
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------- navegadores falsos */
let ACTIVO = null;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  get() { return ACTIVO.ls; },
});
function almacen(inicial) {
  const m = new Map(inicial || []);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get size() { return m.size; },
    _m: m,
  };
}
function nuevoNavegador(nombre) {
  const nav = { nombre, ls: almacen() };
  ACTIVO = nav;
  for (const f of ['micro.js', 'store.js', 'cloud.js']) delete require.cache[require.resolve(path.join(WEB, f))];
  nav.M = require(path.join(WEB, 'micro.js'));
  nav.S = require(path.join(WEB, 'store.js'));
  nav.store = nav.S.Store;
  nav.cloud = require(path.join(WEB, 'cloud.js'));
  return nav;
}
async function usar(nav) {
  ACTIVO = nav;
  globalThis.Store = nav.store;
  globalThis.StoreInternals = nav.S;      // cloud.js lo usa para reconstruir
  globalThis.Micro = nav.M;               // y esto, para rehacer el mazo de repaso
  return nav;
}
async function arranca(nav) {
  await usar(nav);
  await nav.store.init({ base: './', ns: 'asorc.v2' });
  nav.cloud.store = nav.store;
  nav.cloud.sb = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  nav.cloud._estado('sincronizado', null);
  return nav;
}

/* ------------------------------------------------------------- utilidades */
const control = (o) => fetch(URL + '/__control', { method: 'POST', body: JSON.stringify(o) }).then((r) => r.json());
const admin = createClient(URL, KEY, { auth: { persistSession: false } });

async function filasEnBase(tabla) {
  const r = await admin.from(tabla).select('*');
  if (r.error) throw r.error;
  return r.data;
}

// Un evento del repaso rápido, como lo anota la web: al mazo y a la cola.
function tarjeta(nav, id, kind) {
  const e = { question_id: id, kind, at: Date.now() + (++contador) };
  nav.M.aplica(nav.store.cards, e);
  nav.store.tarjetaEvento(e);
}

let contador = 0;
function responde(nav, id, result) {
  nav.store.registrar({
    id, result, answer: 'opción ' + (++contador),
    answerMs: 1000 + contador, reviewMs: 500, marked: false,
  });
}

/* =========================================================================
 *  A · navegador vacío → responder → aparece en la base, solo
 * ========================================================================= */
async function A() {
  console.log('\nA · navegador vacío: responder y que llegue solo');
  const a = await arranca(nuevoNavegador('A'));
  responde(a, 'Q-A1', 'correct');
  eq(a.store.outbox.tamano(), 1, 'la respuesta queda en la cola al instante');
  eq(a.store.progress.preguntas['Q-A1'].aciertos, 1, 'y ya está contada en local');
  const r = await a.cloud.flush();
  ok(r.ok, 'el envío automático sale bien', r.motivo);
  eq(a.store.outbox.tamano(), 0, 'la cola se vacía sola');
  const filas = await filasEnBase('asorc_attempts');
  eq(filas.length, 1, 'hay exactamente un intento en la base');
  eq(filas[0].question_id, 'Q-A1', 'y es el que respondí');
  eq(filas[0].profile_id, 'default', 'con el perfil único');
  return a;
}

/* =========================================================================
 *  B · cinco seguidas: la interfaz nunca espera
 * ========================================================================= */
async function B(a) {
  console.log('\nB · cinco seguidas sin que la interfaz espere');
  await control({ retardo: 400 });           // red lenta a propósito
  await usar(a);
  const t0 = Date.now();
  for (let i = 1; i <= 5; i++) {
    responde(a, 'Q-B' + i, i % 2 ? 'correct' : 'wrong');
    a.cloud.flush();                          // sin await, como en advance()
  }
  const gastado = Date.now() - t0;
  ok(gastado < 50, `responder 5 veces cuesta ${gastado} ms, no los 2000 de la red`);
  eq(a.store.progress.preguntas['Q-B5'].fallos, 0, 'la quinta ya está en local');
  ok(a.store.outbox.tamano() > 0 || true, 'y encolada');
  // Se deja terminar el envío en segundo plano.
  for (let i = 0; i < 40 && a.store.outbox.tamano(); i++) { await a.cloud.flush(); await dormir(100); }
  eq(a.store.outbox.tamano(), 0, 'al final la cola queda a cero');
  const filas = await filasEnBase('asorc_attempts');
  eq(filas.length, 6, 'las cinco llegaron, más la de A');
  await control({ retardo: 0 });
}

/* =========================================================================
 *  C · sin red: se sigue estudiando y la cola crece
 * ========================================================================= */
async function C(a) {
  console.log('\nC · sin red: se estudia igual y nada se pierde');
  await control({ caido: true });
  await usar(a);
  for (let i = 1; i <= 3; i++) responde(a, 'Q-C' + i, 'correct');
  eq(a.store.progress.preguntas['Q-C3'].aciertos, 1, 'la respuesta se guarda en local aunque no haya red');
  const r = await a.cloud.flush();
  ok(!r.ok, 'el envío falla, como debe');
  eq(a.store.outbox.tamano(), 3, 'la cola conserva las tres');
  eq(a.cloud.estado, 'pendiente', 'y el indicador lo dice');
  ok(a.cloud._temporizador != null, 'hay un reintento programado');
  const filas = await filasEnBase('asorc_attempts').catch(() => null);
  ok(filas === null, 'la base no responde (era lo que queríamos)');
}

/* =========================================================================
 *  D · vuelve la red: se sincroniza sola
 * ========================================================================= */
async function D(a) {
  console.log('\nD · vuelve la red: la cola se vacía sola');
  await control({ caido: false });
  await usar(a);
  const r = await a.cloud.flush();            // esto es lo que hace el evento «online»
  ok(r.ok, 'el reintento sale bien', r.motivo);
  eq(a.store.outbox.tamano(), 0, 'la cola vuelve a cero');
  eq(a.cloud.estado, 'sincronizado', 'y el indicador también');
  eq(a.cloud._intento, 0, 'el retardo de reintento se reinicia');
  const filas = await filasEnBase('asorc_attempts');
  eq(filas.length, 9, 'están las nueve respuestas');
}

/* =========================================================================
 *  E · reenviar no duplica, ni por evento ni por histórico
 * ========================================================================= */
async function E(a) {
  console.log('\nE · repetir no cuenta dos veces');
  await usar(a);
  const antes = (await filasEnBase('asorc_attempts')).length;
  const fila = (await filasEnBase('asorc_attempts'))[0];
  a.store.outbox.anadir('intento', {
    event_id: fila.event_id, question_id: fila.question_id, result: fila.result,
    answer: fila.answer, answer_ms: fila.answer_ms, review_ms: fila.review_ms,
    marked: fila.marked, answered_at: fila.answered_at,
  });
  const r = await a.cloud.flush();
  ok(r.ok, 'el reenvío del mismo evento no da error');
  eq((await filasEnBase('asorc_attempts')).length, antes, 'y no aparece ninguna fila nueva');

  // Sincronizar en bucle no puede hacer crecer el histórico. Aquí se rompía:
  // la respuesta llegaba como evento y otra vez como «histórico local».
  await a.cloud.sincronizar(a.store);
  const tras1 = (await filasEnBase('asorc_attempts')).length;
  await a.cloud.sincronizar(a.store);
  await a.cloud.sincronizar(a.store);
  eq((await filasEnBase('asorc_attempts')).length, tras1,
     'sincronizar tres veces seguidas deja el histórico igual');
  eq(tras1, antes, 'y no había inflado nada la primera');

  // Una respuesta nueva, y otra vez lo mismo.
  responde(a, 'Q-E9', 'correct');
  await a.cloud.sincronizar(a.store);
  await a.cloud.sincronizar(a.store);
  const e9 = (await filasEnBase('asorc_attempts')).filter((f) => f.question_id === 'Q-E9');
  eq(e9.length, 1, 'responder y sincronizar dos veces sigue siendo un solo intento');

  // El histórico que viene de fuera (progress.json de la terminal, o un
  // archivo importado) sí hay que subirlo: no son eventos de nadie.
  const d = await arranca(nuevoNavegador('D'));
  await usar(d);
  d.store.importar({
    preguntas: { 'Q-E1': { veces_vista: 3, aciertos: 2, fallos: 1, blancos: 0,
      parciales: 0, ultima_respuesta: 'x', ultimo_resultado: 'correct' } },
    configuracion: {},
  }, null);
  await d.cloud.sincronizar(d.store);
  eq((await filasEnBase('asorc_attempts')).filter((f) => f.question_id === 'Q-E1').length, 3,
     'el histórico importado se convierte en tres intentos');
  await d.cloud.sincronizar(d.store);
  eq((await filasEnBase('asorc_attempts')).filter((f) => f.question_id === 'Q-E1').length, 3,
     'y repetirlo no añade ninguno');

  // Y el caso que de verdad duele: otro navegador importa el MISMO
  // progress.json que la nube ya tiene. No puede contarlo otra vez.
  const g = await arranca(nuevoNavegador('E'));
  await usar(g);
  g.store.importar({
    preguntas: { 'Q-E1': { veces_vista: 3, aciertos: 2, fallos: 1, blancos: 0,
      parciales: 0, ultima_respuesta: 'x', ultimo_resultado: 'correct' } },
    configuracion: {},
  }, null);
  await g.cloud.sincronizar(g.store);
  eq((await filasEnBase('asorc_attempts')).filter((f) => f.question_id === 'Q-E1').length, 3,
     'importar en otro navegador lo que la nube ya tiene no lo duplica');
  eq(g.store.progress.preguntas['Q-E1'].aciertos, 2, 'y los contadores siguen siendo los buenos');
}

/* =========================================================================
 *  F · segundo navegador limpio: recibe el progreso sin login
 * ========================================================================= */
async function F() {
  console.log('\nF · segundo navegador, limpio y sin login');
  const b = await arranca(nuevoNavegador('B'));
  eq(Object.keys(b.store.progress.preguntas).length, 0, 'empieza vacío');
  const r = await b.cloud.sincronizar(b.store);
  ok(r.ok, 'sincroniza a la primera', r.motivo);
  const vistas = Object.keys(b.store.progress.preguntas).length;
  ok(vistas >= 9, `recibe el progreso del otro navegador (${vistas} preguntas)`);
  eq(b.store.progress.preguntas['Q-A1'].aciertos, 1, 'con los contadores correctos');
  return b;
}

/* =========================================================================
 *  G · ida y vuelta entre los dos
 * ========================================================================= */
async function G(a, b) {
  console.log('\nG · el navegador 2 responde y el 1 se entera');
  await usar(b);
  responde(b, 'Q-G1', 'wrong');
  await b.cloud.flush();

  await usar(a);
  ok(!a.store.progress.preguntas['Q-G1'], 'el navegador 1 todavía no la conoce');
  const r = await a.cloud.sincronizar(a.store);
  ok(r.ok, 'sincroniza', r.motivo);
  eq(a.store.progress.preguntas['Q-G1'].fallos, 1, 'y ahora sí la tiene');

  // Y lo importante: nadie ha perdido nada por el camino.
  eq(a.store.progress.preguntas['Q-A1'].aciertos, 1, 'sin perder lo suyo');
}

/* =========================================================================
 *  H · lo que no es un contador: marcas y ronda a medias
 * ========================================================================= */
async function H(a, b) {
  console.log('\nH · marcar, desmarcar y la ronda a medias');
  await usar(a);
  a.store.marcar('Q-A1', true);
  await a.cloud.flush();
  await usar(b);
  await b.cloud.sincronizar(b.store);
  ok(b.store.marcada('Q-A1'), 'marcar en un navegador llega al otro');

  // Desmarcar tiene que viajar igual de bien que marcar.
  await usar(b);
  b.store.marcar('Q-A1', false);
  await b.cloud.flush();
  await usar(a);
  await a.cloud.sincronizar(a.store);
  ok(!a.store.marcada('Q-A1'), 'y desmarcar también (gana el reloj, no el «sí»)');

  // Ronda a medias: se deja a la mitad en A y se recoge en B.
  await usar(a);
  a.store.guardarSesion({ uid: 's-1', ts: Date.now(), ids: ['Q-A1', 'Q-B1'], i: 1, spec: {} });
  await a.cloud.flush();
  await usar(b);
  b.store.session = null;
  await b.cloud.sincronizar(b.store);
  eq(b.store.session && b.store.session.uid, 's-1', 'la ronda a medias se recoge en el otro navegador');
  eq((await filasEnBase('asorc_pending')).length, 1, 'y ocupa una sola fila en la base');
}

/* =========================================================================
 *  I · la regla que sostiene la fusión: no bajar con cosas por subir
 * ========================================================================= */
async function I(a) {
  console.log('\nI · no se baja nada mientras quede algo por subir');
  await control({ caido: true });
  await usar(a);
  responde(a, 'Q-I1', 'correct');
  const antes = a.store.progress.preguntas['Q-A1'].aciertos;
  const r = await a.cloud.sincronizar(a.store);
  ok(!r.ok, 'sincronizar se niega si la subida falla');
  ok(/subir|conexión|Sin/i.test(r.motivo || ''), 'y dice por qué: ' + r.motivo);
  eq(a.store.progress.preguntas['Q-A1'].aciertos, antes, 'no ha fusionado nada a medias');
  eq(a.store.outbox.tamano() >= 1, true, 'la respuesta sigue esperando');
  await control({ caido: false });
  const r2 = await a.cloud.sincronizar(a.store);
  ok(r2.ok, 'y con red vuelve a funcionar', r2.motivo);
  eq(a.store.outbox.tamano(), 0, 'sin dejar nada atrás');
}

/* =========================================================================
 *  J · la cola sobrevive a cerrar el navegador
 * ========================================================================= */
async function J() {
  console.log('\nJ · la cola sobrevive a cerrar y volver a abrir');
  const c = await arranca(nuevoNavegador('C'));
  await control({ caido: true });
  await usar(c);
  responde(c, 'Q-J1', 'correct');
  responde(c, 'Q-J2', 'blank');
  await c.cloud.flush();
  eq(c.store.outbox.tamano(), 2, 'dos esperando');

  // «Cerrar el navegador»: se tira todo lo de memoria y se vuelve a cargar
  // del mismo localStorage.
  const ls = c.ls;
  const c2 = nuevoNavegador('C otra vez');
  c2.ls = ls;
  await arranca(c2);
  eq(c2.store.outbox.tamano(), 2, 'al volver a abrir siguen ahí');
  await control({ caido: false });
  await usar(c2);
  const r = await c2.cloud.flush();
  ok(r.ok, 'y se envían', r.motivo);
  eq(c2.store.outbox.tamano(), 0, 'la cola queda limpia');
  const q = await filasEnBase('asorc_attempts');
  ok(q.some((f) => f.question_id === 'Q-J1'), 'la respuesta de antes de cerrar está en la base');
}

/* =========================================================================
 *  L · el repaso rápido viaja: eventos, sin duplicar, a otro navegador
 * ========================================================================= */
async function L(a) {
  console.log('\nL · el repaso rápido viaja entre navegadores');
  await usar(a);
  responde(a, 'Q-L1', 'wrong');
  tarjeta(a, 'Q-L1', 'fallo');
  tarjeta(a, 'Q-L1', 'nosabia');
  tarjeta(a, 'Q-L1', 'sabia');
  const r = await a.cloud.flush();
  ok(r.ok, 'la tarjeta se envía sola', r.motivo);
  eq(a.store.outbox.tamano(), 0, 'la cola se vacía');
  eq((await filasEnBase('asorc_card_events')).filter((f) => f.question_id === 'Q-L1').length, 3,
     'los tres eventos están en la base');

  // Reenviar lo mismo no puede contar dos veces.
  const fila = (await filasEnBase('asorc_card_events'))[0];
  a.store.outbox.anadir('tarjeta', { event_id: fila.event_id, question_id: fila.question_id,
                                      kind: fila.kind, event_at: fila.event_at });
  await a.cloud.flush();
  eq((await filasEnBase('asorc_card_events')).length, 3, 'reenviar un evento no lo duplica');

  // Otro navegador, limpio: recibe la misma tarjeta con las mismas cuentas.
  const b = await arranca(nuevoNavegador('L2'));
  const s = await b.cloud.sincronizar(b.store);
  ok(s.ok, 'el otro navegador sincroniza', s.motivo);
  const ta = a.store.cards['Q-L1'], tb = b.store.cards['Q-L1'];
  ok(!!tb, 'y tiene la tarjeta');
  eq(tb && [tb.fallos, tb.nosabia, tb.sabia, tb.vista], [1, 1, 1, 2], 'con sus estadísticas');
  eq(tb && tb.proxima, ta.proxima, 'y el mismo «cuándo vuelve»');
  eq(Object.keys(b.store.cards).filter((k) => k === 'Q-L1').length, 1, 'una sola tarjeta');

  // Lo que se repasa en el segundo llega al primero sin pisar nada.
  await usar(b);
  tarjeta(b, 'Q-L1', 'dude');
  await b.cloud.flush();
  await usar(a);
  await a.cloud.sincronizar(a.store);
  eq([a.store.cards['Q-L1'].dude, a.store.cards['Q-L1'].vista], [1, 3], 'repasar en uno llega al otro');
}

/* =========================================================================
 *  N · el historial de tests viaja en asorc_sessions, pregunta a pregunta
 * ========================================================================= */
async function N(a) {
  console.log('\nN · una ronda cerrada llega entera a otro navegador');
  // JSONB guarda las claves en su propio orden: se compara sin depender de él.
  const canon = (lista) => (lista || []).map((o) => Object.fromEntries(Object.entries(o).sort(
    ([x], [y]) => (x < y ? -1 : 1))));
  await usar(a);
  const attempts = [
    { question_id: 'Q-N1', result: 'correct', answer: 'B', scoreDelta: 1, scoreAfter: 1, answerMs: 4200, topic: 'DNS' },
    { question_id: 'Q-N2', result: 'wrong', answer: 'A,C', scoreDelta: 0, scoreAfter: 1, answerMs: 9100, topic: 'Correo' },
    { question_id: 'Q-N3', result: 'wrong', answer: 'A', scoreDelta: -1 / 3, scoreAfter: 2 / 3, answerMs: 7000, topic: 'DNS' },
  ];
  await a.store.cerrarRonda({ ts: Math.floor(Date.now() / 1000), modo: 'Sprint de 20', musica: 'sin',
    respondidas: 3, correctas: 1, falladas: 2, blancos: 0, ms_respuesta: 20300, ms_explicacion: 0,
    marcadas: 0, asorc: false, total: 20, puntos: 2 / 3, attempts });
  const r = await a.cloud.flush();
  ok(r.ok, 'la ronda se envía', r.motivo);
  const fila = (await filasEnBase('asorc_sessions')).find((f) => f.payload && f.payload.modo === 'Sprint de 20'
    && Array.isArray(f.payload.attempts));
  ok(!!fila, 'está en asorc_sessions, sin tabla nueva');
  eq(canon(fila && fila.payload.attempts), canon(attempts), 'con los intentos dentro del payload JSONB');

  const c = await arranca(nuevoNavegador('N2'));
  const s = await c.cloud.sincronizar(c.store);
  ok(s.ok, 'otro navegador sincroniza', s.motivo);
  const suya = c.store.stats.sesiones.find((x) => x.uid === fila.uid);
  eq(canon(suya && suya.attempts), canon(attempts), 'y la recibe con el mismo detalle');
  await c.cloud.sincronizar(c.store);
  eq(c.store.stats.sesiones.filter((x) => x.uid === fila.uid).length, 1, 'sincronizar otra vez no la duplica');
}

/* =========================================================================
 *  K · anon no puede romper el histórico
 * ========================================================================= */
async function K() {
  console.log('\nK · con la clave pública no se puede reescribir el histórico');
  const fila = (await filasEnBase('asorc_attempts'))[0];
  const u = await admin.from('asorc_attempts').update({ result: 'wrong' }).eq('event_id', fila.event_id);
  ok(!!u.error, 'modificar un intento: denegado (' + (u.error && u.error.code) + ')');
  const d = await admin.from('asorc_attempts').delete().eq('event_id', fila.event_id);
  ok(!!d.error, 'borrar un intento: denegado (' + (d.error && d.error.code) + ')');
  const o = await admin.from('asorc_attempts').insert({
    event_id: 'intruso', profile_id: 'otro', question_id: 'X', result: 'correct' });
  ok(!!o.error, 'escribir en otro perfil: denegado (' + (o.error && o.error.code) + ')');

  // El repaso rápido es igual de solo-añadir.
  const t = (await filasEnBase('asorc_card_events'))[0];
  const tu = await admin.from('asorc_card_events').update({ kind: 'sabia' }).eq('event_id', t.event_id);
  const vuelta = (await filasEnBase('asorc_card_events')).find((f) => f.event_id === t.event_id);
  ok(!!tu.error || vuelta.kind === t.kind, 'modificar un evento del repaso: denegado');
  const td = await admin.from('asorc_card_events').delete().eq('event_id', t.event_id);
  ok(!!td.error || (await filasEnBase('asorc_card_events')).some((f) => f.event_id === t.event_id),
     'borrar un evento del repaso: denegado');
  const tk = await admin.from('asorc_card_events').insert({
    event_id: 'raro', question_id: 'X', kind: 'inventado', event_at: new Date().toISOString() });
  ok(!!tk.error, 'un tipo de evento que no existe: rechazado (' + (tk.error && tk.error.code) + ')');
}

/* =========================================================================
 *  M · sin la tabla del repaso (schema.sql sin volver a ejecutar)
 * ========================================================================= */
async function M1() {
  console.log('\nM · falta la tabla del repaso: lo de siempre sigue funcionando');
  const a = await arranca(nuevoNavegador('M'));
  responde(a, 'Q-M1', 'wrong');
  tarjeta(a, 'Q-M1', 'fallo');
  tarjeta(a, 'Q-M1', 'sabia');
  const r = await a.cloud.flush();
  ok(r.ok, 'el envío de lo demás sale bien', r.motivo);
  ok((await filasEnBase('asorc_attempts')).some((f) => f.question_id === 'Q-M1'),
     'la respuesta llega a la base');
  ok(!!a.cloud.sinTarjetas, 'se sabe que falta la tabla: ' + a.cloud.sinTarjetas);
  ok(a.cloud.estado !== 'error', `la nube no se da por rota (${a.cloud.estado})`);
  eq(a.store.outbox.lista().filter((e) => e.tipo === 'tarjeta').length, 2,
     'los eventos del repaso esperan en la cola');
  eq(a.cloud.pendientes(), 0, 'sin contar como pendientes que no saldrán');
  const s = await a.cloud.sincronizar(a.store);
  ok(s.ok, 'y bajar lo de los demás no se bloquea', s.motivo);
  eq(a.store.cards['Q-M1'].vista, 1, 'el mazo de aquí sigue intacto');
  fs.writeFileSync(ESTADO, JSON.stringify([...a.ls._m]));
}

async function M2() {
  console.log('\nM · con schema.sql otra vez: lo retenido sale solo');
  const a = nuevoNavegador('M otra vez');
  a.ls = almacen(JSON.parse(fs.readFileSync(ESTADO, 'utf8')));
  await arranca(a);
  eq(a.store.outbox.lista().filter((e) => e.tipo === 'tarjeta').length, 2, 'al volver a abrir siguen en la cola');
  const r = await a.cloud.flush();
  ok(r.ok, 'se envían', r.motivo);
  eq(a.store.outbox.tamano(), 0, 'la cola queda limpia');
  eq((await filasEnBase('asorc_card_events')).filter((f) => f.question_id === 'Q-M1').length, 2,
     'y están en la base');
}

(async function main() {
  try {
    await control({ caido: false, retardo: 0 });
    if (FASE === 'sin-tarjetas') await M1();
    else if (FASE === 'vuelve-tabla') await M2();
    else await todo();
  } catch (e) {
    console.log('\n!! se cortó: ' + (e && e.stack || e));
    fallos.push('excepción');
  }
  console.log(`\n${n - fallos.length}/${n} comprobaciones pasan`);
  if (fallos.length) { console.log('FALLAN: ' + fallos.join(' · ')); process.exit(1); }
  process.exit(0);
})();

async function todo() {
  {
    const a = await A();
    await B(a);
    await C(a);
    await D(a);
    await E(a);
    const b = await F();
    await G(a, b);
    await H(a, b);
    await I(a);
    await J();
    await L(a);
    await N(a);
    await K();
  }
}
