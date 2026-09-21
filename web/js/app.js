/* ASORC · presentación y flujo.
 *
 * Aquí solo vive el pegamento: pintar, temporizar y persistir. La lógica del
 * quiz está en logic.js, la gamificación en game.js y los efectos en fx.js.
 * questions.json es de solo lectura; progress.json mantiene el esquema de la
 * aplicación de terminal.
 */
'use strict';

(function () {

const root = window;
const L = window.Logic, G = window.Game, FX = window.FX, B = window.Burst;
const ST = window.Store;

/* Todo relativo: la web tiene que funcionar igual servida desde ./asorc-web
 * que desde https://usuario.github.io/repositorio/. */
const BASE = './';

/* El feed tiene muchas preguntas vivas a la vez, así que los elementos de una
 * pregunta no pueden llevar id: van con data-el y se buscan dentro de la
 * tarjeta activa. Lo de fuera (HUD, inicio, resultado) sigue siendo por id. */
const CARD_EL = new Set([
  'q-top', 'q-topic', 'q-kind', 'q-lang', 'q-mark', 'q-res', 'q-text', 'recap', 'fold', 'fold-btn',
  'opts', 'multi', 'multi-hint', 'btn-confirm', 'skip', 'btn-skip', 'stuck',
  'learn', 'verdict', 'answer-line',
  'insight', 'nutshell', 'burst', 'burst-now', 'burst-past', 'burst-dots',
  'burst-toggle', 'burst-prev', 'burst-next', 'burst-speed', 'insight-more',
  'analogy', 'otras', 'memo',
  'full-expl', 'full-expl-body', 'insight-src', 'selfgrade', 'learn-cta',
  'btn-next', 'btn-mark', 'nudge',
]);
let card = null;                    // tarjeta de la pregunta activa

/* El enunciado pegajoso y los desplazamientos necesitan saber cuánto mide la
 * barra de arriba; el CSS lo lee de --hud-h. */
function hudHeight() {
  const hud = document.querySelector('.hud');
  const h = hud ? Math.round(hud.getBoundingClientRect().height) : 76;
  document.documentElement.style.setProperty('--hud-h', h + 'px');
  return h;
}
const inCard = (c, id) => (c ? c.querySelector(`[data-el="${id}"]`) : null);
const $ = (id) => (CARD_EL.has(id) ? inCard(card, id) : document.getElementById(id));

// Modo Ráfaga: se recuerda entre sesiones para poder compararlo con el normal.
const loadBurstPref = () => ST.prefs.burst !== false;
const saveBurstPref = (on) => { ST.prefs.burst = !!on; ST.guardarLocal(); };

// Dejar en blanco tiene sentido en el simulacro, donde fallar resta y no
// contestar no. Fuera de ahí solo aparece si lo pides.
const loadBlankPref = () => (ST.prefs.blank === 'siempre' ? 'siempre' : 'asorc');
const saveBlankPref = (v) => { ST.prefs.blank = v; ST.guardarLocal(); };

const QP = new URLSearchParams(location.search);
const clampSec = (v, def, lo, hi) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};
// No hay plazo para responder: el reloj sube y no interrumpe nunca. Estos dos
// números solo deciden cuándo el cronómetro pasa a ámbar y cuándo aparece un
// aviso discreto por si te has atascado.
const AMBER_SEC = clampSec(QP.get('ambar'), 20, 3, 600);
const STUCK_SEC = clampSec(QP.get('atascado'), 40, 5, 900);
const REVIEW_SEC = clampSec(QP.get('repasar'), 60, 5, 900);

const S = {
  bank: [],
  queue: [], i: 0, spec: null, sessionUid: null,
  lang: 'es',
  music: 'sin',
  includeOpen: false,
  lastMode: null,
  run: null,
  q: null,
  burstOn: true,
  blankWhen: 'asorc',
  lastDone: null,             // última tarjeta contestada (la única desplegada)
  simple: {},                 // explicaciones reescritas en llano, por id
  vocab: null,                // términos técnicos, sacados del propio banco
};

let player = null;          // reproductor de fragmentos (se crea al arrancar)

/* ===================================================================
 *  Estado persistente
 * =================================================================== */
// Los datos se piden por ruta relativa. En GitHub Pages son archivos sueltos;
// con ./asorc-web los sirve el servidor local desde la raíz del proyecto.
async function pideJSON(rutas) {
  for (const r of rutas) {
    try {
      const res = await fetch(BASE + r, { cache: 'no-cache' });
      if (res.ok) return await res.json();
    } catch (e) { /* siguiente */ }
  }
  return null;
}

async function loadAll() {
  const q = await pideJSON(['questions.json', 'api/questions']);
  if (!q || !q.questions) throw new Error('no se pudo leer questions.json');
  S.bank = q.questions;
  S.vocab = L.buildVocab(S.bank);

  // Si no están, se enseña el texto del libro: la web funciona igual.
  const simple = await pideJSON(['explanations_simple.json', 'api/simple']);
  if (simple && simple.explicaciones) S.simple = simple.explicaciones;

  const ns = new URLSearchParams(location.search).get('ns');
  await ST.init({ base: BASE, ns: ns ? 'asorc.test.' + ns : 'asorc.v2' });
  S.burstOn = loadBurstPref();
  S.blankWhen = loadBlankPref();
}

// En las abiertas no hace falta: ya tienen «NI IDEA» en la autocalificación.
const canBlank = () => !!S.q && S.q.view.q.type !== 'open'
  && (S.blankWhen === 'siempre' || !!(S.run && S.run.asorc));

const prog = (id) => ST.prog(id);
const wstat = (id) => ST.stat(id);

/* ===================================================================
 *  Modos
 * =================================================================== */
const MODES = [
  { key: 'sprint20', name: 'Sprint de 20', desc: 'la ronda corta', hero: true,
    pick: (qs) => L.shuffled(qs).slice(0, 20) },
  { key: 'sprint50', name: 'Sprint de 50', desc: 'la ronda larga',
    pick: (qs) => L.shuffled(qs).slice(0, 50) },
  { key: 'asorc', name: 'Solo ASORC', desc: '3 opciones, 1 correcta', asorc: true,
    filter: (q) => q.asorc && q.asorc.eligible, pick: (qs) => L.shuffled(qs) },
  { key: 'failed', name: 'Solo falladas', desc: 'las que se te resisten',
    filter: (q) => { const p = prog(q.id); return !!p && ((p.fallos | 0) > 0 || (p.parciales | 0) > 0); },
    pick: (qs) => L.shuffled(qs) },
  { key: 'unseen', name: 'No vistas', desc: 'terreno nuevo',
    filter: (q) => { const p = prog(q.id); return !p || (p.veces_vista | 0) === 0; },
    pick: (qs) => L.shuffled(qs) },
  { key: 'marked', name: 'Marcadas', desc: 'las que dejaste para repasar',
    filter: (q) => { const w = wstat(q.id); return !!w && w.marcada; },
    pick: (qs) => L.shuffled(qs) },
  { key: 'topic', name: 'Por tema', desc: 'elige el terreno', needsTopic: true,
    pick: (qs) => L.shuffled(qs) },
  { key: 'all', name: 'Todas', desc: 'el banco entero',
    pick: (qs) => L.shuffled(qs) },
];

function eligible(mode, topic) {
  return S.bank.filter((q) => {
    if (q.type === 'open' && !S.includeOpen) return false;
    if (mode.filter && !mode.filter(q)) return false;
    if (mode.needsTopic && topic && q.topic !== topic) return false;
    return true;
  });
}

/* ===================================================================
 *  Inicio
 * =================================================================== */
function showScreen(which) {
  ['home', 'play', 'done'].forEach((s) => { $(s).hidden = s !== which; });
  window.scrollTo(0, 0);
}

function renderHome() {
  if (root.Dash) root.Dash.pintar();
  const tr = S.bank.filter((q) => q.translated).length;
  $('home-sub').textContent =
    `${S.bank.length} preguntas · ${tr} en español · sin límite de tiempo`;

  const box = $('modes');
  box.innerHTML = '';
  MODES.forEach((m) => {
    const n = m.needsTopic ? eligible(m, null).length : eligible(m).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode' + (m.hero ? ' is-hero' : '');
    b.disabled = n === 0;
    const t = document.createElement('b');
    t.textContent = m.name;
    const s = document.createElement('span');
    if (n === 0) s.textContent = 'sin preguntas';
    else {
      const strong = document.createElement('span');
      strong.className = 'mode-n';
      strong.textContent = String(n);
      s.append(strong, ' · ' + m.desc);
    }
    b.append(t, s);
    b.addEventListener('click', () => (m.needsTopic ? renderTopics(m) : startRun(m, null)));
    box.appendChild(b);
  });
  $('topic-block').hidden = true;
}

function renderTopics(mode) {
  const counts = new Map();
  eligible(mode, null).forEach((q) => counts.set(q.topic, (counts.get(q.topic) || 0) + 1));
  const box = $('topics');
  box.innerHTML = '';
  [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).forEach(([t, c]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'topic';
    const nm = document.createElement('span');
    nm.textContent = t;
    const n = document.createElement('i');
    n.textContent = String(c);
    b.append(nm, n);
    b.addEventListener('click', () => startRun(mode, t));
    box.appendChild(b);
  });
  $('topic-block').hidden = false;
  $('topic-block').scrollIntoView({ behavior: FX.reduced() ? 'auto' : 'smooth', block: 'nearest' });
}

/* ===================================================================
 *  Ronda
 * =================================================================== */
function aviso(txt) {
  const e = $('home-error');
  e.textContent = txt;
  e.hidden = false;
}

// Un «spec» describe una ronda con lo justo para poder reconstruirla: de qué
// temas, con qué filtro, de qué tamaño. Es lo que se guarda al salir.
function poolDeSpec(spec) {
  let qs = S.bank.filter((q) => q.type !== 'open' || S.includeOpen);
  if (spec.topics && spec.topics.length) qs = qs.filter((q) => spec.topics.includes(q.topic));
  if (spec.asorc) qs = qs.filter((q) => q.asorc && q.asorc.eligible);
  if (spec.filter === 'unseen') qs = qs.filter((q) => !ST.vista(q.id));
  else if (spec.filter === 'failed') {
    qs = qs.filter((q) => { const p = ST.prog(q.id); return !!p && ((p.fallos | 0) + (p.parciales | 0)) > 0; });
  } else if (spec.filter === 'marked') qs = qs.filter((q) => ST.marcada(q.id));
  return qs;
}

function startSpec(spec) {
  const pool = poolDeSpec(spec);
  if (!pool.length) return aviso('No quedan preguntas con ese filtro.');
  let ids = L.shuffled(pool).map((q) => q.id);
  if (spec.size) ids = ids.slice(0, spec.size);
  arranca(spec, ids, 0, null);
}

function startRun(mode, topic, explicitQueue) {
  const pool = explicitQueue || eligible(mode, topic);
  if (!pool.length) return aviso('Ese modo no tiene preguntas ahora mismo.');
  const spec = {
    kind: 'mode', label: mode.name + (topic ? ' · ' + topic : ''),
    modeKey: mode.key || null, topics: topic ? [topic] : [],
    filter: null, size: null, asorc: !!mode.asorc,
  };
  const ordenadas = explicitQueue ? L.shuffled(pool) : mode.pick(pool);
  arranca(spec, ordenadas.map((q) => q.id), 0, null);
}

function arranca(spec, ids, desde, runGuardado) {
  $('home-error').hidden = true;
  FX.Sound.resume();

  const porId = new Map(S.bank.map((q) => [q.id, q]));
  S.queue = ids.map((id) => porId.get(id)).filter(Boolean);
  if (!S.queue.length) return aviso('Esa ronda ya no tiene preguntas.');
  S.spec = spec;
  S.i = Math.min(Math.max(0, desde | 0), S.queue.length);
  S.lastMode = { mode: { name: spec.label, asorc: spec.asorc, pick: (x) => x }, topic: null };
  S.run = runGuardado || G.newRun({
    total: S.queue.length, modeLabel: spec.label, music: S.music, asorc: !!spec.asorc,
  });
  S.run.total = S.queue.length;

  $('feed').innerHTML = '';          // ronda nueva, feed nuevo
  card = null;
  S.lastDone = null;
  if (player) { player.stop(); player = null; }

  $('tot-n').textContent = String(S.queue.length);
  $('xp-n').textContent = String(S.run.xp | 0);
  $('combo-n').textContent = String(S.run.combo | 0);
  $('chip-combo').dataset.lvl = '0';
  setTrack(S.run.answered / Math.max(1, S.queue.length));
  showScreen('play');
  window.scrollTo({ top: 0, behavior: 'auto' });
  guardarSesion();
  nextQuestion();
}

/* ------------------------- salir y reanudar ------------------------- */
// Al salir no se pierde nada: se guarda el orden exacto, el índice y el
// marcador. Las respuestas ya dadas están guardadas desde el momento en que
// se dieron, así que no hace falta confirmación para salir.
function serializaRun(r) {
  return {
    ok: r.ok, bad: r.bad, blank: r.blank, partial: r.partial, answered: r.answered,
    xp: r.xp, combo: r.combo, bestCombo: r.bestCombo,
    answerMs: r.answerMs, reviewMs: r.reviewMs,
    marked: [...r.marked], failed: r.failed.slice(),
    byTopic: [...r.byTopic.entries()],
    modeLabel: r.modeLabel, music: r.music, asorc: r.asorc, total: r.total,
    startedAt: r.startedAt,
  };
}

function deserializaRun(o) {
  const r = G.newRun({ total: o.total, modeLabel: o.modeLabel, music: o.music, asorc: o.asorc });
  Object.assign(r, {
    ok: o.ok | 0, bad: o.bad | 0, blank: o.blank | 0, partial: o.partial | 0,
    answered: o.answered | 0, xp: o.xp | 0, combo: o.combo | 0, bestCombo: o.bestCombo | 0,
    answerMs: o.answerMs | 0, reviewMs: o.reviewMs | 0,
    marked: new Set(o.marked || []), failed: (o.failed || []).slice(),
    byTopic: new Map(o.byTopic || []), startedAt: o.startedAt || Date.now(),
  });
  return r;
}

function guardarSesion() {
  if (!S.run || !S.queue.length) return;
  if (S.i >= S.queue.length) {
    ST.descartarSesion();
    if (CL && CL.sb && CL.estado !== 'error') CL.guardarPendiente(null);
    return;
  }
  ST.guardarSesion({
    uid: S.sessionUid || (S.sessionUid = 's' + Date.now().toString(36)),
    ts: Date.now(),
    spec: S.spec,
    ids: S.queue.map((q) => q.id),
    i: S.i,
    lang: S.lang,
    includeOpen: S.includeOpen,
    music: S.music,
    run: serializaRun(S.run),
  });
  if (CL && CL.sb && CL.estado !== 'error') CL.guardarPendiente(ST.session);
}

function salir() {
  stopTick();
  refrescaNube();
  if (player) { player.stop(); player = null; }
  guardarSesion();
  ST.sincronizar(null);
  S.q = null;
  renderHome();
  showScreen('home');
}

function reanudar() {
  const s = ST.session;
  if (!s || !s.ids) return;
  S.sessionUid = s.uid;
  S.lang = s.lang || 'es';
  if (s.includeOpen != null) S.includeOpen = !!s.includeOpen;
  if (s.music) S.music = s.music;
  arranca(s.spec || { kind: 'mode', label: 'Ronda', topics: [], asorc: false },
          s.ids, s.i | 0, deserializaRun(s.run || {}));
}

function setTrack(frac) {
  $('track-fill').style.transform = `scaleX(${Math.max(0, Math.min(1, frac))})`;
}

function nextQuestion() {
  if (S.i >= S.queue.length) return finishRun();
  const q = S.queue[S.i];
  const asorc = S.run.asorc && q.asorc && q.asorc.eligible;
  S.q = {
    view: L.buildView(q, asorc),
    picked: new Set(),
    phase: 1,
    result: null,
    t0: performance.now(),
    answerMs: 0,
    marked: !!(wstat(q.id) && wstat(q.id).marcada),
    done: false,
  };
  S.lang = 'es';
  newCard();
  renderQuestion();
  scrollToActive();
  watchActive();
  startAnswerTimer();
}

/* ===================================================================
 *  El feed
 * =================================================================== */

// Cada pregunta estrena tarjeta y se añade al final. Nada se borra.
function newCard() {
  const node = $('card-tpl').content.firstElementChild.cloneNode(true);
  $('feed').appendChild(node);
  card = node;

  inCard(card, 'btn-next').addEventListener('click', advance);
  inCard(card, 'btn-mark').addEventListener('click', toggleMark);
  inCard(card, 'btn-skip').addEventListener('click', leaveBlank);
  inCard(card, 'btn-confirm').addEventListener('click', () => {
    if (!S.q) return;
    if (S.q.view.q.type === 'open') revealOpen(); else submit();
  });
  const fb = inCard(card, 'fold-btn');
  fb.addEventListener('click', () => foldCard(fb.closest('.card'),
    fb.getAttribute('aria-expanded') !== 'true'));

  // Un reproductor de ráfaga por tarjeta: solo el de la activa llega a correr.
  player = new B.Player({
    now: inCard(card, 'burst-now'), past: inCard(card, 'burst-past'),
    dots: inCard(card, 'burst-dots'), toggle: inCard(card, 'burst-toggle'),
    prev: inCard(card, 'burst-prev'), next: inCard(card, 'burst-next'),
    speed: inCard(card, 'burst-speed'),
  });
  return card;
}

function foldCard(c, open) {
  if (!c) return;
  const fb = inCard(c, 'fold-btn');
  const fold = inCard(c, 'fold');
  if (!fb || !fold) return;
  fb.setAttribute('aria-expanded', open ? 'true' : 'false');
  fold.hidden = !open;
}

/* Congela la tarjeta: se queda con el enunciado, lo que respondí, si acerté y
 * la explicación del libro. Sin temporizador, sin ráfaga y sin botones. */
function completeCard() {
  const c = card;
  if (!c || !S.q) return;
  const v = S.q.view, lang = S.lang, r = S.q.result;

  if (player) { player.stop(); player = null; }

  // La ráfaga era para leer en caliente; al quedar atrás manda el texto quieto.
  // En llano se queda la explicación reescrita y el libro sigue en el desplegable;
  // sin ella, se queda el párrafo del libro.
  inCard(c, 'burst').hidden = true;
  const more = inCard(c, 'insight-more');
  const fijo = S.q.llano ? S.q.detail : S.q.mapped;
  more.innerHTML = fijo ? L.codify(fijo) : '';
  more.hidden = !fijo;
  inCard(c, 'full-expl').hidden = !S.q.llano;
  ['learn-cta', 'nudge', 'selfgrade', 'multi'].forEach((n) => { inCard(c, n).hidden = true; });
  c.querySelectorAll('button').forEach((b) => { if (!b.dataset.keep) b.disabled = true; });

  const tag = inCard(c, 'q-res');
  tag.textContent = r === 'correct' ? '✓ correcta'
    : r === 'partial' ? '≈ a medias'
    : r === 'blank' ? '○ en blanco' : '✗ fallada';
  tag.dataset.r = r;
  tag.hidden = false;
  c.dataset.r = r;

  const rec = inCard(c, 'recap');
  rec.innerHTML = '';
  const row = (kind, label, html) => {
    const p = document.createElement('p');
    p.className = 'recap-line';
    p.dataset.k = kind;
    const s1 = document.createElement('span');
    s1.textContent = label;
    const b = document.createElement('b');
    b.innerHTML = html;
    p.append(s1, b);
    rec.appendChild(p);
  };
  // Con varias correctas, cada una en su línea: si no, el separador entre
  // opciones se confunde con el que va entre la letra y el texto.
  const shownText = (o) => o.L + ' · ' + L.codify(lang === 'en' ? o.en : o.es);
  const list = (os) => os.map(shownText).join('</b><br><b>');

  if (v.q.type === 'open') {
    const word = { correct: 'Bien', partial: 'A medias', wrong: 'Mal', blank: 'Ni idea' }[r];
    row('mine', 'Te has puesto', word || '—');
  } else {
    const mine = v.shown.filter((o) => S.q.picked.has(o.L));
    row('mine', 'Tu respuesta', mine.length ? list(mine) : 'sin responder');
    if (r !== 'correct') {
      const right = v.shown.filter((o) => v.correctL.includes(o.L));
      row('right', 'Correcta', list(right));
    }
  }
  rec.hidden = false;

  inCard(c, 'fold-btn').hidden = false;
  c.classList.add('is-done');

  // Solo la última contestada se queda abierta: 20 preguntas abiertas serían
  // 20 pantallas de scroll.
  if (S.lastDone && S.lastDone !== c) foldCard(S.lastDone, false);
  S.lastDone = c;
}

/* --------------------------- scroll del feed --------------------------- */
// ¿Está la pregunta activa a la vista? Si no lo está, es que estoy repasando
// hacia arriba y nadie debe arrastrarme abajo.
function nearActive() {
  if (!card) return false;
  const r = card.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight;
}

let fixT = null;
function scrollToActive() {
  if (!card) return;
  const behavior = FX.reduced() ? 'auto' : 'smooth';
  padFeed();
  const hudH = hudHeight();
  const top = card.getBoundingClientRect().top + window.scrollY - hudH - 20;
  window.scrollTo({ top: Math.max(0, top), behavior });

  // Red de seguridad: si el diseño se asienta después del desplazamiento, se
  // corrige de golpe y sin animación, que a 20-60 px no se nota.
  clearTimeout(fixT);
  fixT = setTimeout(() => {
    if (!card || !nearActive()) return;
    const desvio = card.getBoundingClientRect().top - (hudHeight() + 20);
    if (Math.abs(desvio) > 6) window.scrollBy({ top: desvio, behavior: 'auto' });
  }, FX.reduced() ? 0 : 700);
}

/* Hueco al final del feed: justo el que falta para que la última tarjeta pueda
 * colocarse bajo la barra. Sin él el navegador topa con el fondo del documento
 * y la pregunta nueva se queda a media altura. */
function padFeed() {
  const feed = $('feed');
  const last = feed && feed.lastElementChild;
  if (!last) return;
  const hudH = hudHeight();
  const falta = innerHeight - hudH - 20 - last.getBoundingClientRect().height;
  feed.style.paddingBottom = Math.max(24, Math.ceil(falta)) + 'px';
}

let awayObs = null;
function watchActive() {
  const btn = $('to-active');
  if (awayObs) { awayObs.disconnect(); awayObs = null; }
  if (!card || !btn) return;
  if (typeof IntersectionObserver !== 'function') { btn.hidden = true; return; }
  btn.hidden = true;
  awayObs = new IntersectionObserver(([e]) => { btn.hidden = e.isIntersecting; },
    { threshold: 0 });
  awayObs.observe(card);
}

/* ------------------------------ fase 1 ------------------------------ */
function renderQuestion() {
  const v = S.q.view, q = v.q;

  $('idx-n').textContent = String(S.i + 1);
  $('q-topic').textContent = q.topic;
  $('q-kind').textContent = q.type === 'open' ? 'abierta'
    : (v.asorcMode ? 'ASORC' : (q.type === 'multiple_response' ? 'varias' : 'test'));
  $('q-lang').hidden = S.lang !== 'en';
  $('q-mark').hidden = !S.q.marked;
  $('q-text').innerHTML = L.highlightTechnicalText(L.stemOf(v, S.lang), { vocab: S.vocab });

  card.classList.remove('is-answered');
  $('learn').hidden = true;
  $('nudge').hidden = true;
  $('stuck').hidden = true;
  $('answer-line').hidden = true;
  $('selfgrade').hidden = true;
  $('learn-cta').hidden = false;

  const box = $('opts');
  box.innerHTML = '';
  box.hidden = false;
  box.classList.toggle('cols-2', v.shown.length >= 4);

  if (q.type === 'open') {
    box.hidden = true;
    $('skip').hidden = true;
    $('multi').hidden = false;
    $('multi-hint').textContent = 'Piensa la respuesta y compárala con la del libro.';
    $('btn-confirm').innerHTML = 'VER RESPUESTA <kbd>Space</kbd>';
    return;
  }

  $('skip').hidden = !canBlank();
  card.classList.toggle('no-opts', q.type === 'open');
  $('multi').hidden = q.type !== 'multiple_response';
  if (q.type === 'multiple_response') {
    $('multi-hint').textContent = 'Varias correctas. Marca todas.';
    $('btn-confirm').innerHTML = 'CONFIRMAR <kbd>Enter</kbd>';
  }

  v.shown.forEach((o) => {
    const txt = S.lang === 'en' ? o.en : o.es;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.dataset.l = o.L;
    const k = document.createElement('span');
    k.className = 'opt-k';
    k.textContent = o.L;
    const t = document.createElement('span');
    paintOption(t, txt);
    const m = document.createElement('span');
    m.className = 'opt-mark';
    m.setAttribute('aria-hidden', 'true');
    b.append(k, t, m);
    b.addEventListener('click', () => pick(o.L));
    box.appendChild(b);
  });
}

/* Una opción que ya es un comando o una ruta se enseña entera en monoespaciada;
 * una opción en prosa se marca por dentro. El resaltado no sabe cuál es la
 * correcta: solo mira la forma de las palabras. */
function paintOption(el, txt) {
  const tecnica = L.isTechnical(txt);
  el.className = 'opt-t' + (tecnica ? ' mono' : '');
  if (tecnica) el.textContent = txt;
  else el.innerHTML = L.highlightTechnicalText(txt, { vocab: S.vocab, max: 2 });
}

function pick(letter) {
  if (S.q.phase !== 1) return;
  FX.Sound.resume();
  const q = S.q.view.q;
  if (q.type === 'multiple_response') {
    if (S.q.picked.has(letter)) S.q.picked.delete(letter); else S.q.picked.add(letter);
    [...$('opts').children].forEach((el) => {
      el.classList.toggle('is-picked', S.q.picked.has(el.dataset.l));
    });
    return;
  }
  S.q.picked = new Set([letter]);
  submit();
}

/* ------------------------------ timers ------------------------------ */
let tickHandle = null;
const stopTick = () => { if (tickHandle) { clearInterval(tickHandle); tickHandle = null; } };

/* Cronómetro ascendente. Mide, colorea y —si te quedas mucho rato— sugiere
 * marcarla y seguir. Nunca responde por ti: el plazo penalizaba leer despacio,
 * no saber menos. */
function startAnswerTimer() {
  stopTick();
  const clock = $('clock');
  clock.dataset.state = 'calm';
  clock.textContent = '0';
  const t0 = performance.now();
  let lastWhole = 0;

  tickHandle = setInterval(() => {
    const el = (performance.now() - t0) / 1000;
    const whole = Math.floor(el);
    if (whole !== lastWhole) {
      lastWhole = whole;
      clock.textContent = String(whole);
    }
    clock.dataset.state = el >= AMBER_SEC ? 'warn' : 'calm';
    const stuck = $('stuck');
    if (stuck && el >= STUCK_SEC && stuck.hidden) {
      stuck.textContent = '¿Atascado? Puedes marcarla con M y seguir.';
      stuck.hidden = false;
    }
  }, 250);
}

function startReviewTimer() {
  stopTick();
  const clock = $('clock');
  clock.dataset.state = 'off';
  const t0 = performance.now();
  tickHandle = setInterval(() => {
    const el = (performance.now() - t0) / 1000;
    clock.textContent = String(Math.floor(el));
    if (el >= REVIEW_SEC && $('nudge').hidden) {
      $('nudge').textContent = REVIEW_SEC === 60
        ? 'Llevas 1 minuto aquí. Márcala para repasar y sigue.'
        : `Llevas ${REVIEW_SEC} s aquí. Márcala para repasar y sigue.`;
      $('nudge').hidden = false;
    }
  }, 200);
}

/* Dejarla en blanco: puntúa 0, no cuenta como fallo y la racha no se rompe.
 * Aun así se corrige y se explica, que es a lo que se viene. */
function leaveBlank() {
  if (!S.q || S.q.phase !== 1 || !canBlank()) return;
  stopTick();
  S.q.picked = new Set();
  S.q.answerMs = Math.round(performance.now() - S.q.t0);
  S.q.result = 'blank';
  enterLearn();
}

/* ------------------------------ corrección ------------------------------ */
function submit() {
  if (S.q.phase !== 1) return;
  if (S.q.view.q.type === 'multiple_response' && !S.q.picked.size) return;
  stopTick();
  // El tiempo de respuesta se sigue guardando igual: es lo que alimenta los
  // segundos por pregunta y la comparación entre rondas.
  S.q.answerMs = Math.round(performance.now() - S.q.t0);
  S.q.result = L.grade(S.q.picked, S.q.view.correctL);
  enterLearn();
}

function enterLearn() {
  const v = S.q.view;
  S.q.phase = 2;
  S.q.reviewT0 = performance.now();

  [...$('opts').children].forEach((el) => {
    const l = el.dataset.l;
    el.disabled = true;
    el.classList.remove('is-picked');
    const mark = el.querySelector('.opt-mark');
    if (v.correctL.includes(l)) { el.classList.add('is-ok'); mark.textContent = '✓'; }
    else if (S.q.picked.has(l)) { el.classList.add('is-bad'); mark.textContent = '✗'; }
    else el.classList.add('is-off');
  });
  $('multi').hidden = true;
  $('stuck').hidden = true;
  $('skip').hidden = true;

  const scored = G.score(S.run, S.q.result, S.q.answerMs, v.q.topic, v.q.id);
  S.q.gainedXp = scored.xp;

  // Un blanco no es un error: no suena a error.
  if (S.q.result === 'correct') FX.Sound.correct();
  else if (S.q.result !== 'blank') FX.Sound.wrong();
  updateHud(scored.xp);
  renderLearn();
  compact();
  scored.milestones.forEach((m, i) => setTimeout(() => FX.milestone(m), 260 + i * 420));
  startReviewTimer();
}

// Encoge el reto. La vista NO se mueve hacia el veredicto: el enunciado es el
// contexto y bajar a leer es más barato que perderlo de vista.
function compact() {
  card.classList.add('is-answered');
  if (!nearActive()) return;          // está mirando preguntas de antes: no tocar
  const behavior = FX.reduced() ? 'auto' : 'smooth';
  // El reto se encoge con una transición de 180 ms: medir antes de que acabe
  // da una geometría que ya no existe.
  setTimeout(() => { padFeed(); keepStemInView(behavior); }, FX.reduced() ? 0 : 210);
}

/* Lo único que se recoloca al corregir es la propia tarjeta, y solo si el
 * enunciado se había quedado por encima de la barra (pregunta larga en la que
 * bajaste a marcar la última opción). Nunca se desplaza hacia el veredicto, la
 * explicación ni el botón de continuar. */
function keepStemInView(behavior) {
  if (!card || !nearActive()) return;
  const hudH = hudHeight();
  const r = card.getBoundingClientRect();
  if (r.top >= hudH - 2) return;               // el enunciado ya se ve
  const y = r.top + window.scrollY - hudH - 20;
  window.scrollTo({ top: Math.max(0, y), behavior });
}

function updateHud(gained) {
  const r = S.run;
  const xpEl = $('xp-n');
  FX.countUp(xpEl, r.xp - (gained || 0), r.xp, 420);
  if (gained) FX.replay($('chip-xp'), 'is-pop');

  const c = $('chip-combo');
  $('combo-n').textContent = String(r.combo);
  c.dataset.lvl = r.combo >= 10 ? '3' : r.combo >= 5 ? '2' : r.combo >= 2 ? '1' : '0';
  if (r.combo >= 2) FX.replay(c, 'is-pop');
  setTrack(r.answered / Math.max(1, S.queue.length));
}

/* La explicación se cuenta como la contaría alguien de viva voz: la idea en
 * llano, el modelo mental si ayuda, por qué no valían las demás y la frase que
 * hay que llevarse. El texto del libro no se toca y queda entero bajo «Ver
 * explicación original». Si una pregunta todavía no tiene versión en llano, o
 * si estás leyendo el original en inglés, se enseña el texto del libro. */
// La idea y la frase de memorización son cortas y densas: ahí se permite algo
// más de marcado que en un enunciado.
const hl = (t) => L.highlightTechnicalText(t, { vocab: S.vocab, ratio: 0.45 });

function renderExplanation(mapped, answers) {
  if (player) player.stop();
  S.q.mapped = mapped;          // lo que se queda fijo cuando la tarjeta cierre

  const rec = S.simple[S.q.view.q.id];
  const llano = S.lang === 'es' && !!(rec && Array.isArray(rec.idea) && rec.idea.length);

  $('full-expl-body').innerHTML = L.codify(mapped);
  $('full-expl').open = false;

  let detail;
  if (llano) {
    $('nutshell').innerHTML = hl(rec.idea[0]);
    detail = rec.idea.slice(1).join(' ');
    renderAnalogy(rec.analogia);
    renderOtras(rec.otras);
    renderMemo(rec.memorizar);
  } else {
    const ns = L.nutshell(answers, mapped);
    $('nutshell').innerHTML = hl(ns.line || mapped);
    // Los fragmentos cuentan lo que la idea NO dice ya: si no, se lee dos veces
    // casi lo mismo.
    detail = L.conceptText(L.withoutSentence(mapped, ns.srcIndex));
    renderAnalogy(''); renderOtras(null); renderMemo('');
  }

  const pieces = L.chunks(detail || '');
  // Con explicaciones cortas no hay nada que animar: se muestran y ya.
  const useBurst = S.burstOn && pieces.length >= 2 &&
                   L.needsBurst($('nutshell').textContent, detail || '');

  $('burst').hidden = !useBurst;
  $('insight-more').hidden = useBurst || !detail;
  $('insight-more').innerHTML = useBurst || !detail ? '' : L.codify(detail);
  // En llano el desplegable siempre aporta (es el texto del libro); en el modo
  // antiguo solo si los fragmentos han sustituido al párrafo.
  $('full-expl').hidden = !llano && !useBurst;

  S.q.llano = llano;
  S.q.detail = detail;          // lo que se queda quieto al cerrar la tarjeta

  if (useBurst && player) {
    S.q.burstDone = false;
    player.start(pieces, () => { S.q.burstDone = true; });
  } else {
    S.q.burstDone = true;
  }
}

function renderAnalogy(text) {
  const el = $('analogy');
  if (!text) { el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = '<span class="analogy-tag">Piensa en ello como…</span> ' + L.codify(text);
  el.hidden = false;
}

// Las demás opciones se citan por la letra que se ve en pantalla, no por la del
// libro; y las que el modo ASORC ha dejado fuera no se mencionan.
function renderOtras(mapa) {
  const box = $('otras');
  box.innerHTML = '';
  const v = S.q.view;
  const filas = Object.keys(mapa || {})
    .map((lab) => ({ L: v.origToShown[lab], txt: mapa[lab] }))
    .filter((f) => !!f.L)
    .sort((a, b) => (a.L < b.L ? -1 : 1));
  if (!filas.length) { box.hidden = true; return; }

  const h = document.createElement('p');
  h.className = 'otras-h';
  h.textContent = 'Las otras';
  box.appendChild(h);
  filas.forEach((f) => {
    const p = document.createElement('p');
    p.className = 'otra';
    const k = document.createElement('span');
    k.className = 'otra-k';
    k.textContent = f.L;
    const t = document.createElement('span');
    t.className = 'otra-t';
    t.innerHTML = L.codify(f.txt);
    p.append(k, t);
    box.appendChild(p);
  });
  box.hidden = false;
}

function renderMemo(text) {
  const el = $('memo');
  if (!text) { el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = '<span class="memo-tag">Qué memorizar</span> ' + hl(text);
  el.hidden = false;
}

function renderLearn() {
  const v = S.q.view, r = S.q.result, lang = S.lang;

  const vd = $('verdict');
  vd.dataset.r = r;
  vd.innerHTML = '';
  const ico = document.createElement('span');
  ico.className = 'v-ico';
  const inner = document.createElement('span');
  inner.textContent = r === 'correct' ? '✓' : r === 'blank' ? '○' : '✗';
  ico.appendChild(inner);
  const word = document.createElement('span');
  word.textContent = r === 'correct' ? '¡PERFECTO!' : r === 'blank' ? 'SIN RESPUESTA' : 'FALLASTE';
  vd.append(ico, word);
  if (r === 'correct' && S.q.gainedXp) {
    const xp = document.createElement('span');
    xp.className = 'v-xp';
    xp.textContent = `+${S.q.gainedXp} XP`;
    vd.appendChild(xp);
  }

  // Línea de respuesta correcta: lo primero que hay que ver al fallar.
  const line = $('answer-line');
  if (r === 'correct') {
    line.hidden = true;
  } else {
    const texts = v.shown.filter((o) => v.correctL.includes(o.L))
      .map((o) => (lang === 'en' ? o.en : o.es));
    line.innerHTML = 'Correcta: <b>' + texts.map(L.codify).join('</b> · <b>') + '</b>';
    line.hidden = false;
  }

  const mapped = L.remapExplanation(L.explOf(v, lang), v.origToShown, v.droppedText);
  const answers = v.shown.filter((o) => v.correctL.includes(o.L))
    .map((o) => (lang === 'en' ? o.en : o.es));
  renderExplanation(mapped, answers);
  $('insight-src').textContent =
    `${v.q.chapter} · pág. ${v.q.page} · opción ${v.correctOrig.join(', ')} en el libro`;

  const mb = $('btn-mark');
  mb.classList.toggle('is-on', S.q.marked);
  mb.textContent = S.q.marked ? '★ MARCADA' : '★ REPASAR DESPUÉS';
  $('learn').hidden = false;
}

/* --------------------------- abiertas --------------------------- */
function revealOpen() {
  if (S.q.phase !== 1) return;
  stopTick();
  const q = S.q.view.q;
  S.q.answerMs = Math.round(performance.now() - S.q.t0);
  S.q.phase = 2;
  S.q.reviewT0 = performance.now();

  $('opts').hidden = true;
  $('multi').hidden = true;
  $('stuck').hidden = true;
  $('skip').hidden = true;

  const vd = $('verdict');
  vd.dataset.r = 'info';
  vd.innerHTML = '';
  const ico = document.createElement('span');
  ico.className = 'v-ico';
  const inner = document.createElement('span');
  inner.textContent = '◆';
  ico.appendChild(inner);
  const word = document.createElement('span');
  word.textContent = 'RESPUESTA';
  vd.append(ico, word);
  $('answer-line').hidden = true;

  const fill = L.fillOf(q, S.lang);
  const hasFill = typeof fill === 'string' && !!fill && q.book === 'sybex';
  renderExplanation(L.modelOf(q, S.lang), hasFill ? [fill] : []);
  if (hasFill && !S.simple[q.id]) $('nutshell').innerHTML = L.codify(fill);
  $('insight-src').textContent = `${q.chapter} · pág. ${q.page}`;

  $('learn-cta').hidden = true;
  const sg = $('selfgrade');
  sg.innerHTML = '';
  [['correct', 'BIEN', 'sg-ok'], ['partial', 'A MEDIAS', 'sg-mid'],
   ['wrong', 'MAL', 'sg-bad'], ['blank', 'NI IDEA', 'sg-bad']]
    .forEach(([g, label, cls], idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost ' + cls;
      b.textContent = `${idx + 1} · ${label}`;
      b.addEventListener('click', () => gradeOpen(g));
      sg.appendChild(b);
    });
  sg.hidden = false;

  $('learn').hidden = false;
  compact();
  startReviewTimer();
}

function gradeOpen(grade) {
  if (S.q.phase !== 2 || S.q.done) return;
  S.q.result = grade;
  const scored = G.score(S.run, grade, S.q.answerMs, S.q.view.q.topic, S.q.view.q.id);
  S.q.gainedXp = scored.xp;
  if (grade === 'correct') FX.Sound.correct();
  else if (grade !== 'blank') FX.Sound.wrong();
  updateHud(scored.xp);
  scored.milestones.forEach((m, i) => setTimeout(() => FX.milestone(m), 200 + i * 420));
  advance();
}

/* ------------------------------ avanzar ------------------------------ */
function advance() {
  if (!S.q || S.q.phase !== 2 || S.q.done) return;
  if (S.q.view.q.type === 'open' && !S.q.result) return;   // falta autocalificar
  S.q.done = true;
  stopTick();
  const reviewMs = Math.round(performance.now() - S.q.reviewT0);
  S.run.reviewMs += reviewMs;

  ST.registrar({
    id: S.q.view.q.id,
    result: S.q.result,
    answer: [...S.q.picked].map((l) => {
      const o = S.q.view.shown.find((x) => x.L === l);
      return o ? o.label : '';
    }).filter(Boolean).join(','),
    answerMs: S.q.answerMs,
    reviewMs,
    marked: S.q.marked,
  });
  if (S.q.marked) S.run.marked.add(S.q.view.q.id);
  ST.sincronizar(null);  // guardar por pregunta: el destino es local

  completeCard();
  S.i++;
  guardarSesion();
  nextQuestion();
}

function toggleMark() {
  if (!S.q) return;
  S.q.marked = !S.q.marked;
  ST.marcar(S.q.view.q.id, S.q.marked);
  const b = $('btn-mark');
  if (b && !$('learn').hidden) {
    b.classList.toggle('is-on', S.q.marked);
    b.textContent = S.q.marked ? '★ MARCADA' : '★ REPASAR DESPUÉS';
  }
  $('q-mark').hidden = !S.q.marked;
}

function toggleLang() {
  if (!S.q) return;
  const q = S.q.view.q;
  if (!q.translated) return;                    // ENI: no hay original inglés
  S.lang = S.lang === 'es' ? 'en' : 'es';
  // El orden barajado no se toca: solo cambia el texto.
  $('q-text').innerHTML = L.highlightTechnicalText(L.stemOf(S.q.view, S.lang), { vocab: S.vocab });
  $('q-lang').hidden = S.lang !== 'en';

  if (q.type !== 'open') {
    [...$('opts').children].forEach((el) => {
      const o = S.q.view.shown.find((x) => x.L === el.dataset.l);
      const txt = S.lang === 'en' ? o.en : o.es;
      paintOption(el.querySelector('.opt-t'), txt);
    });
  }
  if (S.q.phase === 2) {
    if (q.type === 'open') {
      const fill = L.fillOf(q, S.lang);
      const hasFill = typeof fill === 'string' && fill && q.book === 'sybex';
      renderExplanation(L.modelOf(q, S.lang), hasFill ? [fill] : []);
      if (hasFill && !(S.lang === 'es' && S.simple[q.id])) {
        $('nutshell').innerHTML = L.codify(fill);
      }
    } else {
      renderLearn();
    }
  }
}

/* ===================================================================
 *  Resultado
 * =================================================================== */
async function finishRun() {
  stopTick();
  S.sessionUid = null;
  const r = S.run;
  $('clock').dataset.state = 'off';

  const prevSession = G.lastSession(ST.stats.sesiones, r.music);
  const finals = G.finalMilestones(r, ST.stats.sesiones);
  await ST.cerrarRonda(G.sessionRecord(r));

  const pct = r.answered ? (r.ok / r.answered) * 100 : 0;
  const sec = r.answered ? r.answerMs / r.answered / 1000 : 0;

  // "Todas" + " COMPLETADO" sonaba agramatical: el encabezado se adapta.
  const isSprint = /sprint/i.test(r.modeLabel);
  $('done-eyebrow').textContent = isSprint
    ? 'SPRINT COMPLETADO'
    : 'RONDA COMPLETADA · ' + (r.modeLabel || '').toUpperCase();
  $('done-ok').textContent = String(r.ok);
  $('done-total').textContent = String(r.answered);
  $('done-pct').textContent = Math.round(pct) + '%';
  $('done-combo').textContent = String(r.bestCombo);
  $('done-sec').textContent = sec ? sec.toFixed(1).replace('.', ',') : '0';
  FX.countUp($('done-xp'), 0, r.xp, 800);

  // Comparación con la sesión anterior de la misma etiqueta
  const dl = $('done-deltas');
  dl.innerHTML = '';
  if (prevSession && prevSession.respondidas) {
    const pPct = prevSession.correctas / prevSession.respondidas * 100;
    const pSec = prevSession.ms_respuesta / prevSession.respondidas / 1000;
    const dPct = pct - pPct, dSec = sec - pSec;
    // Un delta que redondea a cero no es ni mejora ni empeoramiento: se omite
    // en vez de pintar un "↑ 0,0" engañoso.
    if (Math.abs(dPct) >= 1) {
      dl.appendChild(delta(dPct > 0 ? 'good' : 'bad',
        `${dPct > 0 ? '↑' : '↓'} ${Math.abs(dPct).toFixed(0)}% precisión`));
    }
    if (Math.abs(dSec) >= 0.1) {
      dl.appendChild(delta(dSec < 0 ? 'good' : 'bad',
        `${dSec < 0 ? '↓' : '↑'} ${Math.abs(dSec).toFixed(1).replace('.', ',')} s/pregunta`));
    }
  }
  finals.forEach((m) => dl.appendChild(delta('rec', `${m.icon} ${m.title}`)));

  // Repasar los fallos de esta ronda
  const fails = [...new Set(r.failed)];
  const fb = $('btn-fails');
  if (fails.length) {
    fb.hidden = false;
    fb.textContent = `REPASAR ${fails.length} FALLO${fails.length > 1 ? 'S' : ''}`;
    fb.onclick = () => {
      const qs = S.bank.filter((q) => fails.includes(q.id));
      startRun({ name: 'Repaso de fallos', asorc: r.asorc, pick: L.shuffled }, null, qs);
    };
  } else { fb.hidden = true; }

  $('d-ok').textContent = String(r.ok);
  $('d-bad').textContent = String(r.bad);
  $('d-blank').textContent = String(r.blank);
  $('d-marked').textContent = String(r.marked.size);
  $('d-read').textContent = r.answered ? (r.reviewMs / r.answered / 1000).toFixed(1).replace('.', ',') : '0';

  const tb = $('done-topics');
  tb.innerHTML = '';
  [...r.byTopic.entries()]
    .sort((a, b) => (a[1].ok / a[1].n) - (b[1].ok / b[1].n))
    .forEach(([name, t]) => {
      const p = Math.round((t.ok / t.n) * 100);
      const row = document.createElement('div');
      row.className = 'trow';
      const nm = document.createElement('span');
      nm.textContent = name;
      const bar = document.createElement('span');
      bar.className = 'tbar';
      const fillEl = document.createElement('i');
      fillEl.style.width = p + '%';
      fillEl.style.background = p >= 60 ? 'var(--ok)' : p >= 35 ? 'var(--warn)' : 'var(--bad)';
      bar.appendChild(fillEl);
      const num = document.createElement('span');
      num.className = 'tnum';
      num.textContent = `${t.ok}/${t.n}`;
      row.append(nm, bar, num);
      tb.appendChild(row);
    });

  renderMusic();
  showScreen('done');
  if (finals.length || pct >= 90) {
    setTimeout(() => FX.burst($('done-pct'), 46), 260);
    FX.Sound.milestone();
  }
}

function delta(kind, text) {
  const el = document.createElement('span');
  el.className = 'delta';
  el.dataset.d = kind;
  el.textContent = text;
  return el;
}

function renderMusic() {
  const acc = G.musicAggregate(ST.stats.sesiones);
  const box = $('music-cards');
  box.innerHTML = '';
  $('music-block').hidden = acc.sin.n + acc.con.n === 0;
  const both = acc.sin.n > 0 && acc.con.n > 0;

  const cards = [['sin', 'Sin música'], ['con', 'Con música']].map(([k, label]) => {
    const a = acc[k];
    return { k, label, a, pct: a.q ? (a.ok / a.q) * 100 : 0, sec: a.q ? a.ms / a.q / 1000 : 0 };
  });
  const bestPct = both ? (cards[0].pct >= cards[1].pct ? cards[0].k : cards[1].k) : null;

  cards.forEach((c) => {
    const el = document.createElement('div');
    el.className = 'mcard' + (c.k === bestPct ? ' is-best' : '');
    const h = document.createElement('h4');
    h.textContent = c.label;
    const dl = document.createElement('dl');
    [['sesiones', c.a.n], ['preguntas', c.a.q],
     ['acierto', c.a.q ? c.pct.toFixed(0) + '%' : '—'],
     ['s/pregunta', c.a.q ? c.sec.toFixed(1).replace('.', ',') : '—']]
      .forEach(([k, val]) => {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = String(val);
        dl.append(dt, dd);
      });
    el.append(h, dl);
    box.appendChild(el);
  });

  const note = document.createElement('p');
  note.className = 'mnote';
  if (!both) {
    note.textContent = 'Haz al menos una ronda con cada etiqueta para comparar.';
  } else {
    const dp = cards[1].pct - cards[0].pct;
    const ds = cards[1].sec - cards[0].sec;
    note.textContent =
      `Con música aciertas ${dp >= 0 ? '+' : ''}${dp.toFixed(1).replace('.', ',')} puntos y tardas ` +
      `${ds >= 0 ? '+' : '−'}${Math.abs(ds).toFixed(1).replace('.', ',')} s por pregunta. ` +
      (Math.abs(dp) < 3 && Math.abs(ds) < 1.5
        ? 'Aún es poca diferencia; sigue acumulando rondas.'
        : `Rindes mejor ${dp >= 0 ? 'con' : 'sin'} música.`);
  }
  box.appendChild(note);
}

/* ===================================================================
 *  Teclado
 * =================================================================== */
document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key;

  if (k === 's' || k === 'S') {
    ev.preventDefault();
    return setSound(FX.Sound.toggle());
  }
  if ($('play').hidden) return;

  if (k === 'Escape') { ev.preventDefault(); return finishRun(); }
  if (k === 't' || k === 'T') { ev.preventDefault(); return toggleLang(); }
  if (k === 'm' || k === 'M') { ev.preventDefault(); return toggleMark(); }
  if (!S.q) return;
  const q = S.q.view.q;

  if (S.q.phase === 1) {
    if (q.type === 'open') {
      if (k === ' ' || k === 'Enter') { ev.preventDefault(); revealOpen(); }
      return;
    }
    const up = k.toUpperCase();
    if (/^[A-H]$/.test(up) && S.q.view.shown.some((o) => o.L === up)) {
      ev.preventDefault();
      return pick(up);
    }
    if (/^[1-9]$/.test(k)) {
      const o = S.q.view.shown[Number(k) - 1];
      if (o) { ev.preventDefault(); return pick(o.L); }
    }
    if (k === '0' && canBlank()) { ev.preventDefault(); return leaveBlank(); }
    if (k === 'Enter' && q.type === 'multiple_response') { ev.preventDefault(); return submit(); }
    return;
  }

  if (S.q.phase === 2) {
    // Enter siempre pasa de pregunta, aunque la ráfaga siga en marcha.
    if (k === 'Enter') { ev.preventDefault(); return advance(); }

    const burstLive = player && !$('burst').hidden && player.list.length;
    if (burstLive) {
      if (k === 'ArrowRight') { ev.preventDefault(); player.next(); return; }
      if (k === 'ArrowLeft') { ev.preventDefault(); player.prev(); return; }
      // Mientras la explicación avanza sola, Space la pausa; una vez
      // terminada (o en pausa), recupera su papel de "siguiente pregunta".
      if (k === ' ' && player.playing) { ev.preventDefault(); player.pause(); return; }
    }

    if (q.type === 'open') {
      const map = { 1: 'correct', 2: 'partial', 3: 'wrong', 4: 'blank' };
      if (map[k]) { ev.preventDefault(); return gradeOpen(map[k]); }
      return;
    }
    if (k === ' ') { ev.preventDefault(); return advance(); }
  }
});

/* ===================================================================
 *  Arranque
 * =================================================================== */
function setSound(on) {
  const b = $('btn-sound');
  b.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('sound-icon').textContent = on ? '♪' : '♪';
}

/* ------------------------- nube (opcional) ------------------------- */
const CL = root.Cloud;

/* Sin cuentas: o hay nube y el progreso es el mismo en todas partes, o no la
 * hay y se estudia igual con lo guardado en este navegador. */
function pintaNube() {
  const est = CL ? CL.estado : 'solo-local';
  const sinc = est === 'sincronizado';
  $('cloud-label').textContent = sinc ? 'sincronizado' : 'solo local';
  $('btn-cloud').dataset.estado = est;
  $('cloud-state').textContent = sinc
    ? ('Progreso compartido con la nube.' + (CL.ultima
        ? ' Última vez: ' + new Date(CL.ultima).toLocaleTimeString() + '.' : ''))
    : ('Solo local. ' + ((CL && CL.error) || 'No hay nube configurada.'));
  ST.nube = (CL && CL.sb && est !== 'error') ? CL : null;
}

// Al volver al panel se mira si otro dispositivo ha avanzado, sin insistir.
let ultimoTraer = 0;
async function refrescaNube() {
  if (!CL || !CL.sb || CL.estado === 'error') return;
  if (Date.now() - ultimoTraer < 15000) return;
  ultimoTraer = Date.now();
  const r = await CL.sincronizar(ST);
  pintaNube();
  if (r.ok) renderHome();
}

/* ------------------------- importar / exportar ------------------------- */
function nota(txt) {
  const n = $('import-note');
  n.textContent = txt;
  n.hidden = false;
}

async function importarArchivos(files) {
  let prog = null, stats = null, leidos = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(await f.text());
      if (d.preguntas && d.schema_version) { prog = d; leidos++; }
      else if (d.preguntas && d.sesiones) { stats = d; leidos++; }
      else if (d.progress || d.stats) { prog = d.progress || prog; stats = d.stats || stats; leidos++; }
    } catch (e) { /* archivo que no es nuestro */ }
  }
  if (!leidos) return nota('Ese archivo no parece un progress.json ni un web_stats.json.');
  const r = ST.importar(prog, stats);
  renderHome();
  nota(`Importado: ${r.antes} → ${r.ahora} preguntas con progreso. No se ha perdido nada de lo que ya había.`);
}

function exportar() {
  const datos = ST.exportar();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }));
  a.download = 'asorc-progreso-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function wire() {
  $('btn-cloud').addEventListener('click', () => {
    const p = $('cloud-panel');
    p.hidden = !p.hidden;
    if (!p.hidden) pintaNube();
  });
  $('cloud-sync').addEventListener('click', async () => {
    $('cloud-state').textContent = 'Sincronizando…';
    ultimoTraer = Date.now();
    const r = await CL.sincronizar(ST);
    renderHome();
    pintaNube();
    if (!r.ok) $('cloud-state').textContent = 'No se pudo: ' + r.motivo;
  });
  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) importarArchivos([...e.target.files]);
    e.target.value = '';
  });
  $('btn-export').addEventListener('click', exportar);
  $('to-active').addEventListener('click', scrollToActive);
  $('btn-exit').addEventListener('click', salir);
  addEventListener('resize', () => { hudHeight(); padFeed(); });
  hudHeight();
  $('btn-home').addEventListener('click', () => { renderHome(); showScreen('home'); refrescaNube(); });
  $('btn-again').addEventListener('click', () => {
    if (S.lastMode) startRun(S.lastMode.mode, S.lastMode.topic);
  });
  $('btn-sound').addEventListener('click', () => {
    FX.Sound.resume();
    setSound(FX.Sound.toggle());
  });
  $('music-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-music]');
    if (!b) return;
    S.music = b.dataset.music;
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-on', c === b));
  });
  $('burst-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-burst]');
    if (!b) return;
    S.burstOn = b.dataset.burst === 'si';
    saveBurstPref(S.burstOn);
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-on', c === b));
  });
  $('blank-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-blank]');
    if (!b) return;
    S.blankWhen = b.dataset.blank;
    saveBlankPref(S.blankWhen);
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-on', c === b));
  });
  $('open-seg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    S.includeOpen = b.dataset.open === 'si';
    [...e.currentTarget.children].forEach((c) => c.classList.toggle('is-on', c === b));
    renderHome();
  });
  window.addEventListener('beforeunload', () => {
    if (S.run && S.q) guardarSesion();
    ST.volcarAlSalir(BASE);
  });
}

(async function main() {
  FX.Sound.init();
  setSound(FX.Sound.on);
  wire();
  [...$('burst-seg').children].forEach((c) =>
    c.classList.toggle('is-on', (c.dataset.burst === 'si') === S.burstOn));
  [...$('blank-seg').children].forEach((c) =>
    c.classList.toggle('is-on', c.dataset.blank === S.blankWhen));
  try {
    await loadAll();
    if (CL) {
      await CL.init();
      CL.alCambiar = () => pintaNube();
      pintaNube();
      // Nada más abrir se funde con la nube, sin pedir nada a nadie.
      if (CL.estado === 'sincronizado') {
        ultimoTraer = Date.now();
        CL.sincronizar(ST).then(() => { renderHome(); pintaNube(); });
      }
    }
    if (root.Dash) {
      root.Dash.init({
        bank: S.bank, store: ST,
        start: startSpec,
        pool: poolDeSpec,
        resume: reanudar,
        discard: () => ST.descartarSesion(),
      });
    }
    renderHome();
  } catch (e) {
    const box = $('home-error');
    box.textContent = 'No se pudo cargar el banco: ' + e.message +
      '. Arranca con ./asorc-web desde la carpeta del proyecto.';
    box.hidden = false;
  }
})();

})();
