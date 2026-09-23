/* ASORC · nota académica — completamente aparte del XP.
 *
 * Una pregunta de UNA respuesta con k opciones a la vista puntúa:
 *
 *   correcta +1 · incorrecta −1/(k−1) · en blanco 0
 *
 * y así contestar completamente al azar vale 0 de media:
 *   (1/k)·(+1) + ((k−1)/k)·(−1/(k−1)) = 0
 *
 * k son las opciones que se MUESTRAN en esa ronda, no las del libro: el
 * simulacro ASORC enseña 3 (−0,50) y el resto de modos 4 (−0,33) o 5 (−0,25).
 *
 * Las de varias respuestas son otra cosa: se responde una combinación de
 * opciones y −1/(k−1) no neutraliza el azar. Mientras no se elija fórmula,
 * conservan su corrección de siempre —todo o nada, sin penalización: +1 si
 * marcas justo las correctas, 0 si no— y se registran como «multi». Las
 * abiertas se autocalifican: +1 si la das por buena, 0 si no.
 *
 * Pura, sin DOM: se prueba en node. No sabe nada de XP ni de rachas.
 */
'use strict';

(function (root) {

  /* Rejilla exacta. mcm(1..10) = 2520: cualquier 1/(k−1) con k ≤ 11 es un
   * múltiplo entero de 1/2520, así que redondeando cada suma a la rejilla
   * 1 − 1/3 − 1/3 − 1/3 da 0 exacto y no 5,5e−17 (que se pintaría «−0,00»). */
  const GRID = 2520;
  const snap = (x) => Math.round(x * GRID) / GRID;

  // Qué regla puntúa esta pregunta TAL Y COMO SE HA MOSTRADO.
  function ruleOf(view) {
    const q = view.q;
    if (q.type === 'open') return { kind: 'open', k: 0 };
    const k = view.shown.length;
    return { kind: q.type === 'multiple_response' ? 'multi' : 'single', k };
  }

  // Lo que resta un fallo en una pregunta de una respuesta con k opciones.
  const penalty = (k) => (k >= 2 ? 1 / (k - 1) : 0);

  function delta(result, kind, k) {
    if (result === 'correct') return 1;
    if (result === 'wrong' && kind === 'single') return -penalty(k);
    return 0;          // en blanco; y en varias/abiertas, fallar no resta
  }

  /* ------------------------------------------------------------ estado
   * points es el acumulado; log, una entrada por pregunta corregida:
   *   { id, result, kind, k, delta, after, picked?, order?, ms? }
   * picked, order y ms (lo marcado y el orden en pantalla, con las etiquetas
   * del libro, y el tiempo de respuesta) no puntúan: sirven para rehacer el
   * feed al reanudar y para el historial de tests.
   */
  function newState() { return { points: 0, log: [] }; }

  function push(st, a, d) {
    st.points = snap(st.points + d);
    const e = { id: String(a.id), result: a.result, kind: a.kind, k: a.k | 0,
                delta: d, after: st.points };
    if (Array.isArray(a.picked)) e.picked = a.picked.map(String);
    if (Array.isArray(a.order)) e.order = a.order.map(String);
    if (Number.isFinite(a.ms)) e.ms = Math.max(0, Math.round(a.ms));
    st.log.push(e);
    return e;
  }

  function record(st, a) {
    return push(st, a, delta(a.result, a.kind, a.k));
  }

  /* Lo guardado se respeta tal cual: los deltas son los que se vieron. El
   * acumulado se vuelve a sumar desde ellos, así que no puede desviarse. */
  function restore(o) {
    const st = newState();
    const log = o && Array.isArray(o.log) ? o.log : [];
    log.forEach((e) => {
      if (!e || typeof e.id !== 'string' || !e.result) return;
      const d = Number.isFinite(e.delta) ? e.delta : delta(e.result, e.kind, e.k);
      push(st, e, d);
    });
    return st;
  }

  function serialize(st) {
    return { points: st.points, log: st.log.map((e) => Object.assign({}, e)) };
  }

  /* ------------------------------------------------------------ recuento
   * ✓ correctas · ✗ falladas (incluye «a medias» de las abiertas) · ○ blancos.
   * plus/minus: lo que suman los aciertos y lo que restan los fallos.
   * byK: fallos de una respuesta según las opciones que se vieron.
   */
  function tally(st) {
    const t = {
      answered: 0, ok: 0, bad: 0, blank: 0,
      points: st.points, plus: 0, minus: 0, byK: {},
      single: { n: 0, ok: 0, bad: 0, blank: 0 },
      multi: { n: 0, ok: 0, bad: 0, blank: 0 },
      open: { n: 0, ok: 0, bad: 0, blank: 0 },
    };
    st.log.forEach((e) => {
      t.answered++;
      const g = t[e.kind] || t.single;
      g.n++;
      if (e.result === 'correct') { t.ok++; g.ok++; }
      else if (e.result === 'blank') { t.blank++; g.blank++; }
      else { t.bad++; g.bad++; }
      if (e.delta > 0) t.plus = snap(t.plus + e.delta);
      else if (e.delta < 0) {
        t.minus = snap(t.minus + e.delta);
        t.byK[e.k] = (t.byK[e.k] || 0) + 1;
      }
    });
    return t;
  }

  // Nota sobre 10 del examen completo: solo al final, sobre el total.
  const nota10 = (points, total) => (total > 0 ? Math.max(0, (points / total) * 10) : 0);

  /* ------------------------------------------------------------ formato
   * Coma decimal y signo menos de verdad, como el resto de la web. */
  const MINUS = '−';
  const clean = (x) => (Math.abs(x) < 0.005 ? 0 : x);
  function num(x) {                         // 5,67 · −1,50 · 0,00
    const v = clean(Number(x) || 0);
    return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(2).replace('.', ',');
  }
  function signed(x) {                      // +1,00 · −0,33 · 0,00
    const v = clean(Number(x) || 0);
    return (v > 0 ? '+' : '') + num(v);
  }
  function pct(frac) {                      // 55,6%
    const v = clean((Number(frac) || 0) * 100);
    return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(1).replace('.', ',') + '%';
  }
  const sign = (x) => { const v = clean(x); return v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero'; };

  const API = {
    GRID, snap, ruleOf, penalty, delta,
    newState, record, restore, serialize, tally, nota10,
    num, signed, pct, sign,
  };

  root.Academic = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
