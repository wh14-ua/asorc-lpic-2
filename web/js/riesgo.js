/* ASORC · tests de recuperación — qué preguntas tienes más riesgo de fallar.
 *
 * Pura, sin DOM: se prueba en node. Es la ÚNICA fuente de estadísticas por
 * pregunta para elegir un test a partir de tu historial:
 *
 *   Store.intentos   el diario: cada intento con su hora, los de este
 *                    navegador y los que baja la nube de asorc_attempts, sin
 *                    repetidos (event_id).
 *   Store.progress   los contadores de siempre. Traen también lo que el
 *                    diario no tiene (lo de antes del diario, la app de
 *                    terminal): cuenta para los totales, pero sin hora.
 *
 *   estadisticas()   por question_id: intentos, aciertos, fallos, blancos,
 *                    a medias, acierto, acierto reciente, último intento,
 *                    último fallo, rachas, cambios ✓↔✗, tema, marcada y riesgo.
 *   selecciona()     las X preguntas de un criterio, sin repetir ninguna y
 *                    sin rellenar con otras que no lo cumplen.
 *
 * Solo ELIGE preguntas: la nota académica es la de academic.js, igual que
 * siempre. Cuánto pesa cada resultado como señal de debilidad:
 *
 *   correcta 0 · a medias 0,5 · en blanco 0,75 · incorrecta 1
 *
 * A medias es saber la mitad; en blanco, no saberla sin llegar a equivocarse.
 */
'use strict';

(function (root) {

  const DIA = 24 * 60 * 60 * 1000;
  const PESO = { correct: 0, partial: 0.5, blank: 0.75, wrong: 1 };
  const RESULTADOS = Object.keys(PESO);

  /* Con pocos intentos no se sabe gran cosa: el porcentaje de cada pregunta
   * parte de PRIOR intentos «imaginarios» con tu media de fallo. Así 1 fallo
   * de 1 intento no pasa por delante de 7 de 8. */
  const PRIOR = 3;
  const PRIOR_TEMA = 10;
  const VIDA_HIST = 10 * DIA;      // el historial pierde la mitad de su peso cada 10 días
  const VIDA_FALLO = 3 * DIA;      // lo «reciente» de un fallo, cada 3 días
  const SIN_FECHA = 0.35;          // un intento sin hora cuenta como uno viejo
  const TRAS_ACIERTO = 0.6;        // cada acierto posterior rebaja lo que pesa un fallo
  const ULTIMOS = [0.5, 0.3, 0.2]; // los tres últimos intentos; el último, más
  const VENTANA_RECIENTES = 14 * DIA;
  const RECIENTE_ETIQUETA = 3 * DIA;

  /* El riesgo es una media ponderada de señales entre 0 y 1: ninguna manda
   * sola. Lo que más pesa es cómo te va con ella (todo tu historial, con lo
   * viejo pesando menos, y sobre todo los últimos intentos). */
  const PESOS = {
    hist: 0.22,       // tu % de fallo, suavizado y con lo viejo pesando menos
    reciente: 0.24,   // los tres últimos intentos: la tendencia
    fallos: 0.12,     // cuántas veces la has fallado (escala logarítmica)
    cuando: 0.10,     // hace cuánto del último fallo (menos si luego la acertaste)
    racha: 0.08,      // fallos seguidos ahora mismo
    olvido: 0.10,     // la sabías y la has vuelto a fallar
    tema: 0.06,       // lo flojo que vas en su tema
    duda: 0.04,       // en blanco o a medias una y otra vez
    marca: 0.04,      // la marcaste para repasar
  };

  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const decae = (edad, vida) => Math.pow(0.5, Math.max(0, edad) / vida);
  const porId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const fallo = (r) => r !== 'correct';
  const SIMBOLO = { correct: '✓', wrong: '✗', blank: '○', partial: '◐' };

  /* Un intento con hora de verdad. Los «local:…» son histórico de antes de la
   * cola subido de golpe: su answered_at es la hora de subida, no la de
   * responder, así que cuentan como intentos sin hora. */
  const fechado = (e) => Number.isFinite(e.at) && e.at > 0 &&
    !String(e.event_id || '').startsWith('local:');

  const porHora = (a, b) => (a.at - b.at) ||
    (String(a.event_id) < String(b.event_id) ? -1 : String(a.event_id) > String(b.event_id) ? 1 : 0);

  // «Hoy» es el día del reloj de este navegador, no el de UTC.
  const mismoDia = (a, b) => !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();
  const diasEntre = (a, b) => {
    const dia = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    return Math.round((dia(b) - dia(a)) / DIA);
  };

  /* El diario agrupado por pregunta, sin repetidos: el mismo intento puede
   * llegar de aquí y de la nube, y lo que no tiene forma de intento se
   * ignora (la nube la puede escribir cualquiera con la URL). */
  function agrupa(intentos) {
    const vistos = new Set();
    const m = new Map();
    (intentos || []).forEach((e) => {
      if (!e || typeof e.question_id !== 'string' || !(e.result in PESO)) return;
      if (e.event_id != null) {
        const k = String(e.event_id);
        if (vistos.has(k)) return;
        vistos.add(k);
      }
      if (!m.has(e.question_id)) m.set(e.question_id, []);
      m.get(e.question_id).push(e);
    });
    return m;
  }

  /* ---------------------------------------------------- una pregunta */
  function una(q, eventos, p, s, now) {
    const fechados = [];
    const sinFecha = { correct: 0, wrong: 0, blank: 0, partial: 0 };
    eventos.forEach((e) => { if (fechado(e)) fechados.push(e); else sinFecha[e.result]++; });
    fechados.sort(porHora);

    // Totales: el diario o los contadores, lo que diga más (nunca se pierde
    // nada). Lo que solo está en los contadores no tiene hora.
    const cont = {
      correct: p ? p.aciertos | 0 : 0, wrong: p ? p.fallos | 0 : 0,
      blank: p ? p.blancos | 0 : 0, partial: p ? p.parciales | 0 : 0,
    };
    const total = {};
    RESULTADOS.forEach((r) => {
      const enDiario = sinFecha[r] + fechados.filter((e) => e.result === r).length;
      total[r] = Math.max(enDiario, cont[r]);
      sinFecha[r] += total[r] - enDiario;
    });
    // Sin nada fechado, al menos se sabe cuándo fue la última vez (stats).
    const ult = s && s.ultimo_resultado;
    if (!fechados.length && s && Number(s.ultima_vez) > 0 && ult in PESO && sinFecha[ult] > 0) {
      sinFecha[ult]--;
      fechados.push({ event_id: 'ultima', question_id: q.id, result: ult, at: Number(s.ultima_vez) * 1000 });
    }

    const seq = fechados.map((e) => e.result);
    const n = RESULTADOS.reduce((a, r) => a + total[r], 0);
    const fallos = total.wrong + total.blank + total.partial;
    const fallosPond = total.wrong + PESO.blank * total.blank + PESO.partial * total.partial;
    const respondidas = total.correct + total.wrong + total.partial;

    // El historial con lo viejo pesando menos: fallos y peso de cada intento.
    let fd = 0, nd = 0;
    fechados.forEach((e) => { const d = decae(now - e.at, VIDA_HIST); fd += PESO[e.result] * d; nd += d; });
    RESULTADOS.forEach((r) => { fd += PESO[r] * sinFecha[r] * SIN_FECHA; nd += sinFecha[r] * SIN_FECHA; });

    // La racha de fallos con la que acaba y la más larga.
    let racha = 0, rachaPond = 0;
    for (let i = seq.length - 1; i >= 0 && fallo(seq[i]); i--) { racha++; rachaPond += PESO[seq[i]]; }
    let maxRacha = 0, cur = 0, cambios = 0, dosSeguidas = false;
    seq.forEach((r, i) => {
      cur = fallo(r) ? cur + 1 : 0;
      maxRacha = Math.max(maxRacha, cur);
      if (i > 0 && fallo(r) !== fallo(seq[i - 1])) cambios++;
      if (i > 0 && !fallo(r) && !fallo(seq[i - 1])) dosSeguidas = true;
    });

    // Olvido: acaba en fallo y antes la acertabas. Lo que no tiene hora es
    // anterior al diario, así que sus aciertos también cuentan como «antes».
    const aciertosAntes = racha
      ? seq.slice(0, seq.length - racha).filter((r) => !fallo(r)).length + sinFecha.correct : 0;

    // Último fallo y cuántos aciertos lleva desde entonces.
    let ultimoFallo = 0, aciertosTras = 0;
    for (let i = fechados.length - 1; i >= 0; i--) {
      if (fallo(fechados[i].result)) { ultimoFallo = fechados[i].at; break; }
      aciertosTras++;
    }

    // Falladas recientemente: cada fallo de las dos últimas semanas, más
    // cuanto más reciente y menos si después la acertaste.
    let puntReciente = 0, fallosHoy = 0;
    fechados.forEach((e, i) => {
      if (!fallo(e.result)) return;
      if (mismoDia(e.at, now)) fallosHoy++;
      if (now - e.at > VENTANA_RECIENTES) return;
      const despues = fechados.slice(i + 1).filter((x) => !fallo(x.result)).length;
      puntReciente += PESO[e.result] * decae(now - e.at, VIDA_FALLO) * Math.pow(TRAS_ACIERTO, despues);
    });

    const ultimos = seq.slice(-ULTIMOS.length);
    return {
      id: q.id, tema: q.topic || '', tipo: q.type || '',
      intentos: n, correct: total.correct, wrong: total.wrong, blank: total.blank, partial: total.partial,
      fallos, fallosPond, respondidas,
      // acierto: el mismo del panel y del historial (aciertos ÷ respondidas;
      // los blancos no entran). dominio: con los pesos de arriba.
      acierto: respondidas ? total.correct / respondidas : null,
      dominio: n ? 1 - fallosPond / n : null,
      aciertoReciente: ultimos.length ? ultimos.filter((r) => !fallo(r)).length / ultimos.length : null,
      seq, sinFecha: RESULTADOS.reduce((a, r) => a + sinFecha[r], 0), sinFechaAciertos: sinFecha.correct,
      ultimo: seq.length ? seq[seq.length - 1] : (p && p.ultimo_resultado in PESO ? p.ultimo_resultado : null),
      ultimaVez: fechados.length ? fechados[fechados.length - 1].at : 0,
      ultimoFallo, aciertosTras, racha, rachaPond, maxRacha, cambios, dosSeguidas,
      aciertosAntes, olvidada: racha > 0 && aciertosAntes > 0,
      puntReciente, fallosHoy,
      marcada: !!(s && s.marcada),
      fd, nd,
    };
  }

  /* ---------------------------------------------------- señales y riesgo */
  function senales(x, media, t, now) {
    x.tasa = (x.fallosPond + PRIOR * media) / (x.intentos + PRIOR);   // sin mirar la fecha
    const hist = (x.fd + PRIOR * media) / (x.nd + PRIOR);
    // Los últimos intentos, el último pesando más; con pocos, se acercan al
    // historial para que un solo intento no lo decida todo.
    let num = 0, den = 0;
    x.seq.slice(-ULTIMOS.length).reverse().forEach((r, i) => { num += ULTIMOS[i] * PESO[r]; den += ULTIMOS[i]; });
    const reciente = (num + 0.4 * hist) / (den + 0.4);
    x.senales = {
      hist,
      reciente,
      fallos: Math.min(1, Math.log1p(x.fd) / Math.log(6)),
      cuando: x.ultimoFallo ? decae(now - x.ultimoFallo, VIDA_FALLO) * Math.pow(TRAS_ACIERTO, x.aciertosTras) : 0,
      racha: Math.min(1, x.rachaPond / 3),
      olvido: x.olvidada ? Math.min(1, x.aciertosAntes / 3) : 0,
      tema: t ? t.senal : 0.5,
      duda: Math.min(1, (x.blank + PESO.partial * x.partial) / 3),
      marca: x.marcada ? 1 : 0,
    };
    x.riesgo = Object.keys(PESOS).reduce((a, k) => a + PESOS[k] * x.senales[k], 0);
    x.temaAcierto = t ? t.acierto : null;
    x.temaDebil = !!t && t.debil;
  }

  /* estadisticas({ bank, intentos, progreso, stats, now })
   *   bank      las preguntas (array o Map); lo que no está en el banco no cuenta
   *   intentos  Store.intentos
   *   progreso  Store.progress.preguntas
   *   stats     Store.stats.preguntas
   * Devuelve { porId: Map, temas: Map, media, intentos, now }. */
  function estadisticas(e) {
    const o = e || {};
    const now = Number(o.now) || Date.now();
    const bank = o.bank instanceof Map ? [...o.bank.values()] : (o.bank || []);
    const prog = o.progreso || {}, stats = o.stats || {};
    const diario = agrupa(o.intentos);

    const porIdMap = new Map();
    bank.forEach((q) => {
      if (!q || !q.id || porIdMap.has(q.id)) return;
      porIdMap.set(q.id, una(q, diario.get(q.id) || [], prog[q.id], stats[q.id], now));
    });

    // Tu media de fallo: el punto de partida de las preguntas con pocos intentos.
    let F = 0, N = 0;
    porIdMap.forEach((x) => { F += x.fallosPond; N += x.intentos; });
    const media = N ? clamp(F / N, 0.15, 0.6) : 0.35;

    // Temas: el acierto es el del panel (aciertos ÷ respondidas); la
    // debilidad, con los mismos pesos y suavizada con tu media.
    const temas = new Map();
    porIdMap.forEach((x) => {
      if (!temas.has(x.tema)) temas.set(x.tema, { nombre: x.tema, n: 0, F: 0, correct: 0, respondidas: 0 });
      const t = temas.get(x.tema);
      t.n += x.intentos; t.F += x.fallosPond; t.correct += x.correct; t.respondidas += x.respondidas;
    });
    temas.forEach((t) => {
      t.acierto = t.respondidas ? t.correct / t.respondidas : null;
      t.debilidad = (t.F + PRIOR_TEMA * media) / (t.n + PRIOR_TEMA);
      t.debil = t.n > 0 && t.debilidad >= media;
      // 0,5 = como tu media; 1 = quince puntos peor o más.
      t.senal = t.n ? clamp(0.5 + (t.debilidad - media) / 0.3, 0, 1) : 0.5;
    });

    porIdMap.forEach((x) => senales(x, media, temas.get(x.tema), now));
    return { porId: porIdMap, temas, media, intentos: N, now };
  }

  /* ---------------------------------------------------- criterios */
  const nuncaDominada = (x) => x.intentos >= 3 && x.dominio <= 1 / 3 && !x.dosSeguidas;
  const inestable = (x) => x.seq.length >= 4 && x.cambios >= 2 && x.cambios / (x.seq.length - 1) >= 0.5;
  const casiDominada = (x) => x.intentos >= 3 && x.fallos > 0 && x.dominio >= 0.6 && x.ultimo === 'correct';
  const tramo = (x) => (x.fallos >= 5 ? 3 : x.fallos >= 3 ? 2 : 1);

  // Lo que prioriza cada criterio dentro de los que lo cumplen.
  const P = {
    olvido: (x, now) => Math.min(x.aciertosAntes, 5) + 0.8 * Math.min(x.racha, 3) +
      2 * (x.ultimoFallo ? decae(now - x.ultimoFallo, VIDA_FALLO) : 0),
    nunca: (x) => (1 - x.dominio) * Math.min(x.intentos, 8),
    inestable: (x) => 2 * x.cambios / (x.seq.length - 1) + 0.3 * Math.min(x.cambios, 6) +
      0.5 * (1 - Math.abs(2 * (x.acierto == null ? 0 : x.acierto) - 1)) + (fallo(x.ultimo) ? 0.3 : 0),
    // cerca del 80 % de dominio primero, y antes si el último desliz es reciente
    casi: (x, now) => 0.6 * Math.max(0, 1 - Math.abs(x.dominio - 0.8) / 0.25) +
      0.4 * (x.ultimoFallo ? decae(now - x.ultimoFallo, 7 * DIA) : 0),
  };

  const desempate = (a, b) => (b.ultimoFallo - a.ultimoFallo) || porId(a, b);
  const por = (f) => (a, b) => (f(b) - f(a)) || desempate(a, b);

  /* Cada criterio: quién lo cumple (vale) y en qué orden (orden). Todos
   * exigen haberla respondido alguna vez: sin historial no hay riesgo que
   * medir (para eso está «No vistas»). */
  const CRITERIOS = {
    mix: { vale: (x) => x.fallos > 0 || x.marcada, orden: por((x) => x.riesgo) },
    equilibrado: { vale: (x) => x.fallos > 0 || x.marcada, orden: por((x) => x.riesgo) },
    peor: { vale: (x) => x.fallos > 0, orden: (a, b) => (b.tasa - a.tasa) || (b.fallosPond - a.fallosPond) || desempate(a, b) },
    mas: { vale: (x) => x.fallos > 0,
      orden: (a, b) => (b.fallosPond - a.fallosPond) || (b.wrong - a.wrong) || desempate(a, b) },
    reincidentes: { vale: (x) => x.fallos >= 2,
      orden: (a, b) => (tramo(b) - tramo(a)) || (b.tasa - a.tasa) || (b.fallos - a.fallos) || desempate(a, b) },
    recientes: { vale: (x, now) => x.ultimoFallo > 0 && now - x.ultimoFallo <= VENTANA_RECIENTES,
      orden: por((x) => x.puntReciente) },
    olvidadas: { vale: (x) => x.olvidada, orden: (a, b, now) => (P.olvido(b, now) - P.olvido(a, now)) || desempate(a, b) },
    nunca: { vale: nuncaDominada, orden: por(P.nunca) },
    inestables: { vale: inestable, orden: por(P.inestable) },
    temas: { vale: (x) => x.fallos > 0 && x.temaDebil, orden: por((x) => x.riesgo) },
    casi: { vale: casiDominada, orden: (a, b, now) => (P.casi(b, now) - P.casi(a, now)) || desempate(a, b) },
    hoy: { vale: (x) => x.fallosHoy > 0, orden: (a, b) => (b.fallosHoy - a.fallosHoy) || (b.riesgo - a.riesgo) || desempate(a, b) },
  };

  /* Los criterios, en el orden en que se ofrecen: primero los más útiles. */
  const MODOS = [
    { key: 'mix', nombre: 'Mix inteligente', grupo: 'Recomendados', recomendado: true,
      desc: 'Prioriza las preguntas que tienes más riesgo de fallar según tu historial.',
      como: 'Seleccionadas según tus errores, frecuencia de fallo, recencia y debilidad por tema.' },
    { key: 'equilibrado', nombre: 'Mix equilibrado', grupo: 'Recomendados',
      desc: 'Las de más riesgo, pero repartidas entre temas para preparar un examen global.',
      como: 'Mismo riesgo que el mix inteligente, con un límite flexible de preguntas por tema.' },
    { key: 'peor', nombre: 'Peor porcentaje', grupo: 'Por tipo de error',
      desc: 'Las que más fallas en proporción. Con pocos intentos cuentan menos: 1 fallo de 1 no pesa como 7 de 8.',
      como: 'Ordenadas por tu porcentaje de fallo, ajustado según cuántas veces las has respondido.' },
    { key: 'mas', nombre: 'Más falladas', grupo: 'Por tipo de error',
      desc: 'Las que más veces has fallado, aunque otras veces las hayas acertado.',
      como: 'Ordenadas por número de fallos (a medias y en blanco cuentan algo menos).' },
    { key: 'reincidentes', nombre: 'Reincidentes', grupo: 'Por tipo de error',
      desc: 'Las que has fallado 2 veces o más: primero las de 5+, luego 3+ y luego 2+.',
      como: 'Solo preguntas falladas al menos dos veces; un fallo suelto no entra.' },
    { key: 'recientes', nombre: 'Falladas recientemente', grupo: 'Por tipo de error',
      desc: 'Tus fallos de las dos últimas semanas: cuanto más reciente, antes. Si luego la acertaste, pesa menos.',
      como: 'Ordenadas por lo reciente de sus fallos; el peso de cada fallo baja con los días.' },
    { key: 'olvidadas', nombre: 'Olvidadas', grupo: 'Por tipo de error',
      desc: 'Las que acertabas y has vuelto a fallar (✓ ✓ ✗): parecían aprendidas.',
      como: 'Acertadas antes y falladas en tu último intento.' },
    { key: 'nunca', nombre: 'Nunca dominadas', grupo: 'Por tipo de error',
      desc: 'Tres intentos o más y casi nunca la aciertas (✗ ✗ ✓ ✗).',
      como: 'Tres intentos o más, un tercio de acierto como mucho y nunca dos aciertos seguidos.' },
    { key: 'inestables', nombre: 'Inestables', grupo: 'Por tipo de error',
      desc: 'Aciertas y fallas alternando (✓ ✗ ✓ ✗): el concepto aún no está asentado.',
      como: 'Cuatro intentos o más que cambian a menudo entre acierto y fallo.' },
    { key: 'temas', nombre: 'Temas débiles', grupo: 'Por tipo de error',
      desc: 'Sobre todo de tus temas más flojos y, dentro de cada uno, las que peor llevas.',
      como: 'Repartidas entre tus temas por debajo de tu media, más preguntas cuanto más flojo el tema.' },
    { key: 'casi', nombre: 'Casi dominadas', grupo: 'Por tipo de error',
      desc: 'Aciertas la mayoría pero aún se te escapa alguna (✓ ✓ ✗ ✓): para dejarlas sólidas.',
      como: 'Tres intentos o más, al menos un 60 % de dominio y la última acertada.' },
    { key: 'hoy', nombre: 'Errores de hoy', grupo: 'Rápidos',
      desc: 'Solo las que has fallado, dejado en blanco o hecho a medias hoy.',
      como: 'Preguntas falladas hoy.' },
    { key: 'ultima', nombre: 'Errores de la última ronda', grupo: 'Rápidos',
      desc: 'Las falladas, a medias y en blanco de tu última ronda, en su mismo formato.',
      como: 'Los errores de tu última ronda terminada.' },
  ];
  const modo = (key) => MODOS.find((m) => m.key === key) || null;

  /* Mix equilibrado: el mismo orden por riesgo, con un tope flexible por tema.
   * Primero se respeta el tope entre las que tienen un riesgo cercano al de
   * la X-ésima; si aun así faltan, el tope se relaja: diversidad sí, pero sin
   * meter preguntas mucho menos relevantes por el mero hecho de ser de otro tema. */
  const topePorTema = (n) => Math.max(2, Math.ceil(n / 4));
  function equilibra(ordenadas, n) {
    const x = n || ordenadas.length;
    const tope = topePorTema(x);
    const suelo = ordenadas.length ? 0.7 * ordenadas[Math.min(x, ordenadas.length) - 1].riesgo : 0;
    const out = [], dentro = new Set(), cuenta = new Map();
    for (const c of ordenadas) {
      if (out.length >= x) break;
      if (c.riesgo < suelo || (cuenta.get(c.tema) || 0) >= tope) continue;
      out.push(c); dentro.add(c.id);
      cuenta.set(c.tema, (cuenta.get(c.tema) || 0) + 1);
    }
    for (const c of ordenadas) {
      if (out.length >= x) break;
      if (!dentro.has(c.id)) { out.push(c); dentro.add(c.id); }
    }
    return out.sort(CRITERIOS.mix.orden);
  }

  /* Temas débiles: los temas por debajo de tu media se reparten el test en
   * proporción a lo flojos que son (reparto D'Hondt), así que el peor aporta
   * más sin quedarse con todo; dentro de cada tema, por riesgo. Si un tema se
   * queda sin preguntas, sus plazas pasan a los demás. */
  function porTemas(cands, est, n) {
    const grupos = new Map();
    cands.slice().sort(CRITERIOS.temas.orden).forEach((c) => {
      if (!grupos.has(c.tema)) grupos.set(c.tema, []);
      grupos.get(c.tema).push(c);
    });
    const peso = (t) => Math.pow((est.temas.get(t) || { debilidad: 0 }).debilidad, 2);
    const usados = new Map([...grupos.keys()].map((t) => [t, 0]));
    const x = n || cands.length;
    const out = [];
    while (out.length < x) {
      let mejor = null, valor = -1;
      grupos.forEach((lista, t) => {
        const u = usados.get(t);
        if (u >= lista.length) return;
        const v = peso(t) / (u + 1);
        if (v > valor || (v === valor && t < mejor)) { valor = v; mejor = t; }
      });
      if (mejor == null) break;
      out.push(grupos.get(mejor)[usados.get(mejor)]);
      usados.set(mejor, usados.get(mejor) + 1);
    }
    return out;
  }

  /* ---------------------------------------------------- explicaciones */
  const pct = (f) => Math.round(f * 100) + '%';
  const plural = (k, uno, varios) => `${k} ${k === 1 ? uno : varios}`;

  // «4 fallos de 6» · «1 fallo, 2 en blanco de 4» · «3 a medias de 3»
  function recuento(x) {
    if (!x.intentos) return 'sin intentos registrados';
    const partes = [];
    if (x.wrong) partes.push(plural(x.wrong, 'fallo', 'fallos'));
    if (x.blank) partes.push(`${x.blank} en blanco`);
    if (x.partial) partes.push(`${x.partial} a medias`);
    if (!partes.length) partes.push('0 fallos');
    return `${partes.join(', ')} de ${x.intentos}`;
  }

  function haceCuanto(t, now) {
    const d = diasEntre(t, now);
    if (d <= 0) return 'hoy';
    if (d === 1) return 'ayer';
    if (d < 14) return `hace ${d} días`;
    if (d < 45) return `hace ${Math.round(d / 7)} semanas`;
    return 'hace más de un mes';
  }

  const secuencia = (x) => x.seq.slice(-6).map((r) => SIMBOLO[r]).join('');
  const nivel = (r) => (r >= 0.6 ? 'Prioridad alta' : r >= 0.4 ? 'Prioridad media' : 'Prioridad baja');

  /* Por qué ha entrado cada pregunta, en una línea que se entiende sin saber
   * nada de la fórmula: «Prioridad alta: 4 fallos de 6 · fallada ayer · tema
   * DNS 43%». Se guarda con la ronda para poder verlo luego en el historial. */
  function texto(key, x, now, extra) {
    const f = [];
    const hace = x.ultimoFallo ? haceCuanto(x.ultimoFallo, now) : null;
    const cuando = hace ? `fallada ${hace}` : null;
    const tema = x.temaAcierto != null ? `tema ${x.tema} ${pct(x.temaAcierto)}` : null;
    const bien = `${x.correct} de ${x.intentos} bien`;
    let pre;
    switch (key) {
      case 'peor':
        pre = 'Peor porcentaje';
        f.push(x.acierto == null ? 'sin acierto: solo en blanco' : `${pct(x.acierto)} de acierto`, recuento(x));
        break;
      case 'mas': pre = 'Más falladas'; f.push(recuento(x), cuando); break;
      case 'reincidentes':
        pre = 'Reincidente';
        f.push(recuento(x), x.racha >= 2 ? `${x.racha} seguidas mal` : null, cuando);
        break;
      case 'recientes': pre = 'Fallada recientemente'; f.push(cuando, recuento(x)); break;
      case 'olvidadas':
        pre = 'Olvidada';
        f.push(plural(x.aciertosAntes, 'acierto antes', 'aciertos antes'),
               x.racha > 1 ? `${x.racha} fallos recientes` : cuando,
               x.seq.length > 1 ? secuencia(x) : null);
        break;
      case 'nunca': pre = 'Nunca dominada'; f.push(bien, x.seq.length > 1 ? secuencia(x) : null); break;
      case 'inestables': pre = 'Inestable'; f.push(secuencia(x), plural(x.cambios, 'cambio', 'cambios')); break;
      case 'temas': pre = 'Tema débil'; f.push(tema, recuento(x)); break;
      case 'casi': pre = 'Casi dominada'; f.push(bien, hace ? `último fallo ${hace}` : null); break;
      case 'hoy':
        pre = 'Fallada hoy';
        f.push(x.fallosHoy > 1 ? `${x.fallosHoy} veces hoy` : null, recuento(x));
        break;
      case 'ultima':
        pre = 'Error de la última ronda';
        f.push(extra ? { wrong: 'fallada', blank: 'en blanco', partial: 'a medias' }[extra] : null, recuento(x));
        break;
      default:
        pre = nivel(x.riesgo);
        f.push(recuento(x), cuando, x.racha >= 2 ? `${x.racha} seguidas mal` : null,
               x.olvidada ? plural(x.aciertosAntes, 'acierto antes', 'aciertos antes') : null,
               x.temaDebil ? tema : null, x.marcada ? 'marcada' : null);
    }
    const hechos = f.filter(Boolean);
    return hechos.length ? `${pre}: ${hechos.join(' · ')}` : pre;
  }

  /* Qué tipo de riesgo es cada pregunta, sea cual sea el criterio que la
   * eligió: para el resumen «riesgo atacado» del final. */
  const ETIQUETAS = {
    reincidente: ['reincidente', 'reincidentes'],
    reciente: ['fallada hace poco', 'falladas hace poco'],
    olvidada: ['olvidada', 'olvidadas'],
    nunca: ['nunca dominada', 'nunca dominadas'],
    inestable: ['inestable', 'inestables'],
    casi: ['casi dominada', 'casi dominadas'],
    tema: ['de tema débil', 'de temas débiles'],
    marcada: ['marcada', 'marcadas'],
  };
  function etiquetas(x, now) {
    const out = [];
    if (x.fallos >= 2) out.push('reincidente');
    if (x.ultimoFallo && now - x.ultimoFallo <= RECIENTE_ETIQUETA) out.push('reciente');
    if (x.olvidada) out.push('olvidada');
    if (nuncaDominada(x)) out.push('nunca');
    if (inestable(x)) out.push('inestable');
    if (casiDominada(x)) out.push('casi');
    if (x.temaDebil && x.fallos > 0) out.push('tema');
    if (x.marcada) out.push('marcada');
    return out;
  }

  const redondea = (v) => Math.round(v * 1000) / 1000;
  function motivo(key, x, now, rank, extra) {
    return { rank, risk: redondea(x.riesgo), tags: etiquetas(x, now), text: texto(key, x, now, extra) };
  }

  /* ---------------------------------------------------- elegir
   * selecciona(key, { est, candidatas, n, sesiones, enBanco })
   *   est          lo que devuelve estadisticas()
   *   candidatas   ids que pasan tus filtros (abiertas, formato, temas):
   *                los da Logic.pool, la misma regla que el resto de rondas
   *   n            cuántas; 0 = todas las que cumplan
   *   sesiones     Store.stats.sesiones (solo para «errores de la última ronda»)
   * Nunca repite una pregunta y nunca rellena con otras que no cumplen el
   * criterio: si no llega a n, devuelve las que hay y «disponibles» lo dice. */
  function selecciona(key, o) {
    const m = modo(key);
    if (!m) throw new Error('criterio desconocido: ' + key);
    const est = o.est, now = est.now;
    const n = Math.max(0, Math.floor(Number(o.n) || 0));
    if (key === 'ultima') return deUltimaRonda(o, n);

    const c = CRITERIOS[key];
    const vistos = new Set();
    const cands = [];
    (o.candidatas || []).forEach((id) => {
      if (vistos.has(id)) return;
      vistos.add(id);
      const x = est.porId.get(id);
      if (x && x.intentos > 0 && c.vale(x, now)) cands.push(x);
    });

    let elegidas;
    if (key === 'equilibrado') elegidas = equilibra(cands.sort(c.orden), n);
    else if (key === 'temas') elegidas = porTemas(cands, est, n);
    else elegidas = cands.sort((a, b) => c.orden(a, b, now)).slice(0, n || cands.length);

    const motivos = {};
    elegidas.forEach((x, i) => { motivos[x.id] = motivo(key, x, now, i + 1); });
    return { modo: key, nombre: m.nombre, ids: elegidas.map((x) => x.id), disponibles: cands.length,
             pedidas: n, motivos };
  }

  /* Errores de la última ronda terminada: sus falladas, a medias y en
   * blanco, una vez cada una, en el formato de aquella ronda. */
  const ERROR = ['wrong', 'partial', 'blank'];
  function ultimaRonda(sesiones) {
    return (sesiones || []).filter((s) => s && typeof s === 'object' && Array.isArray(s.attempts))
      .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0))[0] || null;
  }

  function deUltimaRonda(o, n) {
    const est = o.est, now = est.now;
    const s = ultimaRonda(o.sesiones);
    const base = { modo: 'ultima', nombre: modo('ultima').nombre, ids: [], disponibles: 0, pedidas: n,
                   motivos: {}, ronda: null };
    if (!s) return base;
    base.ronda = { modo: String(s.modo || 'Ronda'), ts: Number(s.ts) || 0, asorc: !!s.asorc };
    const vistos = new Set(), errores = [];
    s.attempts.forEach((a) => {
      if (!a || typeof a.question_id !== 'string' || !ERROR.includes(a.result)) return;
      if (vistos.has(a.question_id)) return;
      const x = est.porId.get(a.question_id);
      if (!x || (o.enBanco && !o.enBanco(a.question_id))) return;
      vistos.add(a.question_id);
      errores.push({ x, result: a.result });
    });
    // Si hay más errores que plazas, primero los de más riesgo.
    const elegidos = errores.slice().sort((a, b) => CRITERIOS.mix.orden(a.x, b.x)).slice(0, n || errores.length);
    elegidos.forEach((e, i) => { base.motivos[e.x.id] = motivo('ultima', e.x, now, i + 1, e.result); });
    base.ids = elegidos.map((e) => e.x.id);
    base.disponibles = errores.length;
    return base;
  }

  /* ---------------------------------------------------- lo que se guarda
   * Con la ronda viaja cómo se eligió, en el mismo payload JSONB de
   * asorc_sessions (sin tabla ni columna nueva). sel es lo de selecciona()
   * más filtros y hora; ids, el orden en que se preguntaron. */
  function registro(sel, ids) {
    return {
      selection_mode: sel.modo,
      planned_question_ids: (ids || sel.ids || []).slice(),
      selection_metadata: {
        version: 1,
        label: sel.nombre,
        requested: sel.pedidas | 0,
        available: sel.disponibles | 0,
        selected: (ids || sel.ids || []).length,
        generated_at: new Date(Number(sel.generado) || Date.now()).toISOString(),
        filters: sel.filtros || {},
        reasons: sel.motivos || {},
      },
    };
  }

  /* Riesgo atacado: cuántas de cada tipo había en el test y cuántas has
   * acertado ahora. log es el de academic.js (id, result). */
  function atacado(sel, log) {
    const motivos = (sel && sel.motivos) || {};
    const ids = Object.keys(motivos);
    const ahora = new Map((log || []).map((e) => [e.id, e.result]));
    const tipos = new Map();
    ids.forEach((id) => {
      (motivos[id].tags || []).forEach((t) => {
        if (!ETIQUETAS[t]) return;
        const v = tipos.get(t) || { tag: t, n: 0, ok: 0 };
        v.n++;
        if (ahora.get(id) === 'correct') v.ok++;
        tipos.set(t, v);
      });
    });
    const orden = Object.keys(ETIQUETAS);
    return {
      total: ids.length,
      contestadas: ids.filter((id) => ahora.has(id)).length,
      ok: ids.filter((id) => ahora.get(id) === 'correct').length,
      tipos: [...tipos.values()].sort((a, b) => (b.n - a.n) || (orden.indexOf(a.tag) - orden.indexOf(b.tag))),
    };
  }

  const nombreEtiqueta = (t, n) => (ETIQUETAS[t] ? ETIQUETAS[t][n === 1 ? 0 : 1] : t);

  const API = {
    DIA, PESO, PESOS, PRIOR, VIDA_HIST, VIDA_FALLO, VENTANA_RECIENTES, MODOS, ETIQUETAS,
    estadisticas, selecciona, modo, registro, atacado, etiquetas, nombreEtiqueta, topePorTema,
    ultimaRonda, mismoDia, haceCuanto, recuento, texto,
  };

  root.Riesgo = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);
