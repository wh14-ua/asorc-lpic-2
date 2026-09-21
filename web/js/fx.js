/* ASORC · efectos — sonido y microinteracciones.
 *
 * Sonido con Web Audio API: sin archivos, sin descargas, volumen bajo y
 * desactivable. Las animaciones usan transform/opacity para no salirse de
 * los 60 fps, y se anulan con prefers-reduced-motion.
 */
'use strict';

(function (root, doc) {

  const reduced = () =>
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ sonido */
  const Sound = {
    on: true,
    volume: 0.18,
    ctx: null,

    init() {
      try {
        const saved = localStorage.getItem('asorc.sound');
        if (saved !== null) this.on = saved === '1';
      } catch (e) { /* almacenamiento bloqueado: se queda con el valor por defecto */ }
    },

    toggle() {
      this.on = !this.on;
      try { localStorage.setItem('asorc.sound', this.on ? '1' : '0'); } catch (e) {}
      if (this.on) this.blip([660, 880], 0.09);
      return this.on;
    },

    // El contexto solo puede crearse tras un gesto del usuario.
    resume() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return null;
        try { this.ctx = new AC(); } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },

    // Secuencia corta de tonos. dur = duración de cada nota.
    blip(freqs, dur = 0.1, type = 'triangle', vol = null) {
      if (!this.on) return;
      const ctx = this.resume();
      if (!ctx) return;
      const v = vol == null ? this.volume : vol;
      const t0 = ctx.currentTime;
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(f, t0 + i * dur);
        g.gain.setValueAtTime(0.0001, t0 + i * dur);
        g.gain.exponentialRampToValueAtTime(v, t0 + i * dur + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * dur + dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(t0 + i * dur);
        osc.stop(t0 + i * dur + dur + 0.02);
      });
    },

    correct()  { this.blip([523.25, 783.99], 0.085); },          // do → sol, ascendente
    wrong()    { this.blip([196, 146.83], 0.12, 'sawtooth', this.volume * 0.5); },
    milestone() { this.blip([523.25, 659.25, 783.99, 1046.5], 0.085); },
  };

  /* -------------------------------------------------------- animaciones */

  // Cuenta ascendente de un número. Devuelve una función para cancelarla.
  function countUp(el, from, to, ms = 420, fmt = (v) => String(Math.round(v))) {
    if (!el) return () => {};
    if (reduced() || from === to) { el.textContent = fmt(to); return () => {}; }
    const t0 = performance.now();
    let raf = 0;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);            // easeOutCubic
      el.textContent = fmt(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }

  // Reinicia una animación CSS aunque ya estuviera puesta.
  function replay(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  /* --------------------------------------------------------- partículas
   * Solo para hitos. Canvas de una sola pasada, se limpia al terminar.
   */
  const COLORS = ['#7C5CFF', '#24E08C', '#FFB224', '#FF5470', '#9E86FF'];

  function burst(originEl, count = 28) {
    if (reduced()) return;
    const cv = doc.getElementById('fx-canvas');
    if (!cv) return;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    cv.width = innerWidth * dpr;
    cv.height = innerHeight * dpr;
    cv.style.display = 'block';
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const r = originEl ? originEl.getBoundingClientRect() : null;
    const ox = r ? r.left + r.width / 2 : innerWidth / 2;
    const oy = r ? r.top + r.height / 2 : innerHeight / 3;

    const parts = Array.from({ length: count }, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = 4 + Math.random() * 7;
      return {
        x: ox, y: oy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3,
        w: 4 + Math.random() * 5, h: 7 + Math.random() * 7,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        life: 1,
      };
    });

    const t0 = performance.now();
    const DUR = 900;
    (function frame(now) {
      const p = (now - t0) / DUR;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      if (p >= 1) { cv.style.display = 'none'; return; }
      parts.forEach((q) => {
        q.vy += 0.34;                 // gravedad
        q.vx *= 0.99;
        q.x += q.vx; q.y += q.vy; q.rot += q.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - p);
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.fillStyle = q.c;
        ctx.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
        ctx.restore();
      });
      requestAnimationFrame(frame);
    })(t0);
  }

  /* ------------------------------------------------------------- toasts
   * Avisos breves de hito. Nunca bloquean: se apilan y se van solos.
   */
  function milestone(m) {
    const box = doc.getElementById('fx-toasts');
    if (!box) return;
    const el = doc.createElement('div');
    el.className = 'toast';
    el.innerHTML =
      `<span class="toast-icon">${m.icon || '★'}</span>` +
      `<span class="toast-title"></span>`;
    el.querySelector('.toast-title').textContent = m.title;
    box.appendChild(el);
    Sound.milestone();
    burst(el, m.kind === 'combo' && m.value >= 10 ? 40 : 26);
    const life = reduced() ? 1400 : 1700;
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 260);
    }, life);
  }

  const API = { Sound, countUp, replay, burst, milestone, reduced };
  root.FX = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
