/* ASORC · capa de juego — XP, combo, hitos y récords.
 *
 * Es gamificación pura: NO toca la nota académica ni lo que se guarda en
 * progress.json. Vive aparte de la lógica del quiz a propósito.
 *
 * El tiempo se mide y se acumula (run.answerMs) para poder comparar la
 * velocidad entre rondas, pero no da ni quita XP.
 */
'use strict';

(function (root) {

  // El XP no mira el reloj: no hay límite de tiempo que superar, así que
  // premiar la rapidez sería premiar leer deprisa, no saber la respuesta.
  const XP_OK = 10;         // acierto
  const COMBO_STEPS = [5, 10, 15, 20, 25, 30, 40, 50];
  const COUNT_STEPS = [25, 50, 100];

  function newRun(opts) {
    return {
      total: opts.total || 0,
      modeLabel: opts.modeLabel || '',
      music: opts.music || 'sin',
      asorc: !!opts.asorc,

      ok: 0, bad: 0, blank: 0, partial: 0,
      answered: 0,
      xp: 0,
      combo: 0, bestCombo: 0,
      answerMs: 0, reviewMs: 0,
      marked: new Set(),
      failed: [],                 // ids fallados en esta ronda
      byTopic: new Map(),
      startedAt: Date.now(),
    };
  }

  // Devuelve {xp, combo, milestones:[...]} para una respuesta.
  function score(run, result, answerMs, topic, qid) {
    let xp = 0;

    if (result === 'correct') {
      xp = XP_OK;
      run.ok++;
      run.combo++;
      run.bestCombo = Math.max(run.bestCombo, run.combo);
    } else if (result === 'blank') {
      // Dejarla en blanco es una decisión, no un fallo: puntúa 0 y la racha se
      // queda como estaba (ni sube ni se rompe). Sí entra en «repasar fallos»,
      // que es justo donde interesa volver a verla.
      run.blank++;
      if (qid) run.failed.push(qid);
    } else {
      // 'wrong' y 'partial' rompen la racha
      run.bad++;
      run.combo = 0;
      if (qid) run.failed.push(qid);
    }

    run.xp += xp;
    run.answered++;
    run.answerMs += answerMs;

    const t = run.byTopic.get(topic) || { ok: 0, n: 0 };
    t.n++;
    if (result === 'correct') t.ok++;
    run.byTopic.set(topic, t);

    const milestones = [];
    if (result === 'correct' && COMBO_STEPS.includes(run.combo)) {
      milestones.push({ kind: 'combo', value: run.combo,
                        title: `RACHA DE ${run.combo}`, icon: '🔥' });
    }
    if (COUNT_STEPS.includes(run.answered)) {
      milestones.push({ kind: 'count', value: run.answered,
                        title: `${run.answered} PREGUNTAS`, icon: '🏁' });
    }
    return { xp, milestones };
  }

  /* ------------------------------------------------------------ récords
   * Se calculan sobre el histórico de sesiones que ya guarda web_stats.json,
   * sin añadir nada al esquema.
   */
  function records(sessions, minAnswered = 5) {
    let bestPct = null, bestSec = null;
    (sessions || []).forEach((s) => {
      if (!s.respondidas || s.respondidas < minAnswered) return;
      const pct = (s.correctas || 0) / s.respondidas * 100;
      const sec = (s.ms_respuesta || 0) / s.respondidas / 1000;
      if (bestPct === null || pct > bestPct) bestPct = pct;
      if (sec > 0 && (bestSec === null || sec < bestSec)) bestSec = sec;
    });
    return { bestPct, bestSec };
  }

  // Hitos que solo se pueden saber al cerrar la ronda.
  function finalMilestones(run, sessions, minAnswered = 5) {
    const out = [];
    if (run.answered < minAnswered) return out;
    const { bestPct, bestSec } = records(sessions, minAnswered);
    const pct = run.ok / run.answered * 100;
    const sec = run.answerMs / run.answered / 1000;
    if (bestPct !== null && pct > bestPct + 0.01) {
      out.push({ kind: 'record-pct', value: pct,
                 title: 'RÉCORD DE PRECISIÓN', icon: '🎯' });
    }
    if (bestSec !== null && sec > 0 && sec < bestSec - 0.01) {
      out.push({ kind: 'record-speed', value: sec,
                 title: 'RÉCORD DE VELOCIDAD', icon: '⚡' });
    }
    return out;
  }

  // Comparación con la sesión anterior de la misma etiqueta de música.
  function lastSession(sessions, music) {
    const ses = (sessions || []).filter(
      (s) => (s.musica || 'sin') === music && s.respondidas);
    return ses.length ? ses[ses.length - 1] : null;
  }

  function musicAggregate(sessions) {
    const acc = { sin: { n: 0, ok: 0, q: 0, ms: 0 },
                  con: { n: 0, ok: 0, q: 0, ms: 0 } };
    (sessions || []).forEach((s) => {
      if (!s.respondidas) return;
      const k = s.musica === 'con' ? 'con' : 'sin';
      acc[k].n++;
      acc[k].ok += s.correctas | 0;
      acc[k].q += s.respondidas | 0;
      acc[k].ms += s.ms_respuesta | 0;
    });
    return acc;
  }

  function sessionRecord(run) {
    return {
      ts: Math.floor(Date.now() / 1000),
      modo: run.modeLabel,
      musica: run.music,
      respondidas: run.answered,
      correctas: run.ok,
      falladas: run.bad,
      blancos: run.blank,
      ms_respuesta: run.answerMs,
      ms_explicacion: run.reviewMs,
      marcadas: run.marked.size,
      // para el historial de tests (las rondas de antes no los traen)
      xp: run.xp,
      mejor_racha: run.bestCombo,
    };
  }

  const API = {
    XP_OK, COMBO_STEPS, COUNT_STEPS,
    newRun, score, records, finalMilestones,
    lastSession, musicAggregate, sessionRecord,
  };

  root.Game = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
