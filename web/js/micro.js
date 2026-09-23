/* ASORC · repaso rápido — el mazo de microtarjetas, sin DOM.
 *
 * Una pregunta = una tarjeta estable. El contenido (pista → respuesta y
 * contraste) está escrito de antemano en microcards.json; aquí solo vive el
 * MAZO: qué preguntas han entrado en tu repaso y cómo las llevas.
 *
 * Entra una tarjeta cuando fallas su pregunta, la dejas en blanco o la marcas.
 * Si ya estaba, se actualiza: nunca hay dos tarjetas de la misma pregunta,
 * porque el mazo va por question_id.
 *
 * Todo lo que le pasa a una tarjeta es un EVENTO { event_id, question_id,
 * kind, at }. El estado es aplicar esos eventos en orden: así la nube guarda
 * hechos y no sumas, y dos dispositivos llegan al mismo mazo.
 *
 * Cuándo vuelve a salir, sin algoritmo complejo:
 *   NO LA SABÍA → pronto: a los 10 minutos (y en la misma tanda, un poco después)
 *   DUDÉ        → después: mañana, sin subir de nivel
 *   LA SABÍA    → mucho menos: a 3, 7, 16, 35 y 90 días según la vayas sabiendo
 *   fallarla en una ronda la devuelve al principio: toca ya.
 */
'use strict';

(function (root) {

  const MIN = 60 * 1000, DIA = 24 * 60 * MIN;
  const PRONTO = 10 * MIN;
  const DESPUES = DIA;
  const PASOS = [3, 7, 16, 35, 90].map((d) => d * DIA);
  const KINDS = ['fallo', 'marca', 'sabia', 'dude', 'nosabia'];
  const NOTAS = ['sabia', 'dude', 'nosabia'];

  function nueva(at, por) {
    return {
      alta: at, por,                  // cuándo y por qué entró
      fallos: 0, ultimoFallo: 0,      // fallos y blancos en rondas (eventos)
      previos: 0,                     // fallos de antes del repaso rápido (historial)
      vista: 0, sabia: 0, dude: 0, nosabia: 0,
      ultima: 0,                      // último repaso
      proxima: at,                    // cuándo toca
      nivel: 0,                       // 0 = recién fallada o no la sabías
    };
  }

  /* Aplica un evento a la tarjeta de su pregunta; si no existe, la crea.
   * Devuelve la tarjeta, o null si el evento no vale. */
  function aplica(mazo, ev) {
    const id = ev && ev.question_id;
    const at = Number(ev && ev.at);
    if (!id || !KINDS.includes(ev.kind) || !Number.isFinite(at)) return null;
    let t = mazo[id];
    if (!t) {
      t = nueva(at, ev.kind === 'fallo' || ev.kind === 'marca' ? ev.kind : 'historial');
      mazo[id] = t;
    }
    if (ev.kind === 'fallo') {
      t.fallos++;
      t.ultimoFallo = Math.max(t.ultimoFallo, at);
      t.nivel = 0;
      t.proxima = Math.min(t.proxima, at);          // la fallaste: toca ya
    } else if (ev.kind === 'marca') {
      t.proxima = Math.min(t.proxima, at);          // la marcaste para repasar
    } else {
      t.vista++;
      t[ev.kind]++;
      t.ultima = Math.max(t.ultima, at);
      if (ev.kind === 'nosabia') { t.nivel = 0; t.proxima = at + PRONTO; }
      else if (ev.kind === 'dude') { t.proxima = at + DESPUES; }
      else {
        t.nivel = Math.min(t.nivel + 1, PASOS.length);
        t.proxima = at + PASOS[t.nivel - 1];
      }
    }
    return t;
  }

  const porId = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  /* El mazo a partir de sus eventos, en orden de tiempo (y de id a igualdad):
   * mismos eventos, mismo mazo, lleguen en el orden que lleguen. */
  function reconstruye(eventos) {
    const mazo = {};
    (eventos || []).slice()
      .sort((a, b) => (Number(a.at) - Number(b.at)) || porId(String(a.event_id), String(b.event_id)))
      .forEach((ev) => aplica(mazo, ev));
    return mazo;
  }

  /* Dos versiones del mazo (la de aquí y la de la nube): de cada tarjeta se
   * queda la que sabe más —más eventos: repasos y fallos—, a igualdad la más
   * reciente. Nunca se pisa una tarjeta más completa con una más pobre. Lo
   * que viene del historial (previos, último fallo, alta) se une aparte: no
   * son eventos y no deben decidir cuál gana. */
  const peso = (t) => (t.vista | 0) + (t.fallos | 0);
  function fusiona(a, b) {
    const out = {};
    new Set([...Object.keys(a || {}), ...Object.keys(b || {})]).forEach((id) => {
      const x = a && a[id], y = b && b[id];
      if (!x || !y) { out[id] = Object.assign({}, x || y); return; }
      const gana = peso(y) !== peso(x) ? (peso(y) > peso(x) ? y : x)
        : ((y.ultima || 0) >= (x.ultima || 0) ? y : x);
      const t = Object.assign({}, gana);
      t.previos = Math.max(x.previos | 0, y.previos | 0);
      t.ultimoFallo = Math.max(Number(x.ultimoFallo) || 0, Number(y.ultimoFallo) || 0);
      const primera = (Number(x.alta) || 0) <= (Number(y.alta) || 0) ? x : y;
      t.alta = primera.alta;
      t.por = primera.por;
      out[id] = t;
    });
    return out;
  }

  /* Lo que ya habías fallado, dejado en blanco o marcado antes de que
   * existiera el repaso rápido también tiene tarjeta. Cada dispositivo lo
   * deduce de tu progreso, que ya se sincroniza: no hace falta mandarlo. */
  function siembra(mazo, candidatas, at) {
    let n = 0;
    (candidatas || []).forEach((c) => {
      if (!c || !c.id || mazo[c.id]) return;
      const t = nueva(at, 'historial');
      t.previos = c.fallos | 0;
      t.ultimoFallo = Number(c.ultimoFallo) || 0;
      mazo[c.id] = t;
      n++;
    });
    return n;
  }

  /* ------------------------------------------------------------ elegir
   * Primero las que tocan (las más flojas y más falladas delante), después
   * las que tocarán antes. Orden total: la misma tanda cada vez. */
  function urgencia(mazo, now) {
    return (a, b) => {
      const x = mazo[a], y = mazo[b];
      const tx = x.proxima <= now, ty = y.proxima <= now;
      if (tx !== ty) return tx ? -1 : 1;
      if (tx) {
        const fx = x.fallos + (x.previos | 0), fy = y.fallos + (y.previos | 0);
        return (x.nivel - y.nivel) || (fy - fx) || (x.proxima - y.proxima) || porId(a, b);
      }
      return (x.proxima - y.proxima) || porId(a, b);
    };
  }

  const mismoDia = (a, b) => !!a && new Date(a).toDateString() === new Date(b).toDateString();

  /* Modos: 'rapidas' (con n = 10 o 20), 'todas', 'hoy' (falladas hoy),
   * 'marcadas' y 'tema'. o = { now, n, tema, temaDe(id), marcada(id), vale(id) } */
  function elige(mazo, modo, o) {
    const now = o.now;
    let ids = Object.keys(mazo || {});
    if (o.vale) ids = ids.filter(o.vale);
    if (modo === 'hoy') ids = ids.filter((id) => mismoDia(mazo[id].ultimoFallo, now));
    else if (modo === 'marcadas') ids = ids.filter((id) => !!(o.marcada && o.marcada(id)));
    else if (modo === 'tema') ids = ids.filter((id) => o.temaDe && o.temaDe(id) === o.tema);
    ids.sort(urgencia(mazo, now));
    return o.n ? ids.slice(0, o.n) : ids;
  }

  const tocaYa = (t, now) => t.proxima <= now;

  /* La tarjeta guardada lleva su pista, su respuesta y su contraste, copiados
   * del contenido de esa pregunta (microcards.json): la misma pregunta tiene
   * siempre la misma tarjeta y, si el archivo mejora, el mazo se pone al día
   * sin perder lo repasado. Devuelve true si algo cambió. */
  function conContenido(t, c) {
    if (!t || !c) return false;
    const antes = JSON.stringify([t.cue, t.answer, t.contrast, t.mnemo]);
    t.cue = String(c.cue || '');
    t.answer = String(c.answer || '');
    t.contrast = (c.contrast || []).map(String);
    if (c.mnemo) t.mnemo = String(c.mnemo); else delete t.mnemo;
    return antes !== JSON.stringify([t.cue, t.answer, t.contrast, t.mnemo]);
  }

  /* Tras «NO LA SABÍA», la misma tarjeta vuelve en esta tanda a las pocas
   * tarjetas; como mucho dos veces, para no atascarse en una. */
  const REPITE_TRAS = 3, REPITE_MAX = 2;
  function reencola(cola, pos, id, veces) {
    if ((veces[id] | 0) >= REPITE_MAX) return false;
    veces[id] = (veces[id] | 0) + 1;
    cola.splice(Math.min(cola.length, pos + 1 + REPITE_TRAS), 0, id);
    return true;
  }

  const API = {
    MIN, DIA, PRONTO, DESPUES, PASOS, KINDS, NOTAS, REPITE_TRAS, REPITE_MAX,
    nueva, aplica, reconstruye, fusiona, siembra, elige, urgencia, mismoDia, tocaYa, reencola,
    conContenido,
  };

  root.Micro = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
