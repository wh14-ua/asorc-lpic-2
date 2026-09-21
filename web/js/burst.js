/* ASORC · Modo Ráfaga — la explicación como subtítulos de vídeo.
 *
 * Muestra fragmentos semánticos de 4–10 palabras, no palabra a palabra, y deja
 * encima los 3 últimos atenuados para poder mirar atrás sin perder el hilo
 * (encima y no debajo porque el botón de continuar está anclado al pie).
 * No toca el contenido: solo trocea la explicación que ya existe.
 */
'use strict';

(function (root, doc) {

  const L = root.Logic;
  const FX = root.FX;

  const SPEEDS = [0.75, 1, 1.25, 1.5];
  const HISTORY = 3;

  function loadSpeed() {
    try {
      const v = Number(localStorage.getItem('asorc.burstSpeed'));
      if (SPEEDS.includes(v)) return v;
    } catch (e) { /* almacenamiento bloqueado */ }
    return 1;
  }
  function saveSpeed(v) {
    try { localStorage.setItem('asorc.burstSpeed', String(v)); } catch (e) {}
  }

  function Player(els) {
    this.els = els;              // {now, past, dots, toggle, prev, next, speed}
    this.list = [];
    this.i = -1;
    this.timer = null;
    this.dueAt = 0;
    this.left = 0;
    this.playing = false;
    this.speed = loadSpeed();
    this.onEnd = null;
    this._wire();
  }

  Player.prototype._wire = function () {
    const e = this.els;
    if (e.toggle) e.toggle.addEventListener('click', () => this.toggle());
    if (e.prev) e.prev.addEventListener('click', () => this.prev());
    if (e.next) e.next.addEventListener('click', () => this.next());
    if (e.speed) {
      e.speed.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-sp]');
        if (!b) return;
        this.setSpeed(Number(b.dataset.sp));
      });
    }
    this._paintSpeed();
  };

  Player.prototype._paintSpeed = function () {
    const e = this.els;
    if (!e.speed) return;
    [...e.speed.querySelectorAll('[data-sp]')].forEach((b) => {
      b.classList.toggle('is-on', Number(b.dataset.sp) === this.speed);
      b.setAttribute('aria-pressed', Number(b.dataset.sp) === this.speed ? 'true' : 'false');
    });
  };

  Player.prototype.setSpeed = function (v) {
    if (!SPEEDS.includes(v)) return;
    this.speed = v;
    saveSpeed(v);
    this._paintSpeed();
    if (this.playing) {           // reprograma lo que queda con el nuevo ritmo
      this._clear();
      this._schedule();
    }
  };

  Player.prototype.start = function (chunks, onEnd) {
    this.stop();
    this.list = chunks || [];
    this.onEnd = onEnd || null;
    this.i = -1;
    this._renderDots();
    if (!this.list.length) return;

    if (FX.reduced()) {
      // Sin animación: se pintan todos los fragmentos de golpe.
      this.i = this.list.length - 1;
      this._renderStatic();
      this.playing = false;
      this._paintToggle();
      if (this.onEnd) this.onEnd();
      return;
    }
    this.playing = true;
    this._paintToggle();
    this.next();
  };

  Player.prototype._clear = function () {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  };

  Player.prototype._schedule = function () {
    this._clear();
    if (!this.playing || this.i >= this.list.length - 1) return;
    const ms = this.left > 0
      ? this.left
      : L.chunkDuration(this.list[this.i], { speed: this.speed });
    this.dueAt = performance.now() + ms;
    this.left = 0;
    this.timer = setTimeout(() => this.next(), ms);
  };

  Player.prototype.next = function () {
    this._clear();
    if (this.i >= this.list.length - 1) {
      this.playing = false;
      this._paintToggle();
      if (this.onEnd) this.onEnd();
      return false;
    }
    this.i++;
    this.left = 0;
    this._render();
    if (this.i >= this.list.length - 1) {
      this.playing = false;
      this._paintToggle();
      if (this.onEnd) this.onEnd();
    } else if (this.playing) {
      this._schedule();
    }
    return true;
  };

  Player.prototype.prev = function () {
    this._clear();
    if (this.i <= 0) return false;
    this.i--;
    this.left = 0;
    this._render();
    if (this.playing) this._schedule();
    return true;
  };

  Player.prototype.pause = function () {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) {
      this.left = Math.max(120, this.dueAt - performance.now());
      this._clear();
    }
    this._paintToggle();
  };

  Player.prototype.resume = function () {
    if (this.playing || !this.list.length) return;
    if (this.i >= this.list.length - 1) return;      // ya terminó
    this.playing = true;
    this._paintToggle();
    this._schedule();
  };

  Player.prototype.toggle = function () {
    if (this.playing) this.pause(); else this.resume();
  };

  Player.prototype.finished = function () {
    return !this.list.length || this.i >= this.list.length - 1;
  };

  Player.prototype.stop = function () {
    this._clear();
    this.playing = false;
    this.list = [];
    this.i = -1;
    this.left = 0;
    if (this.els.now) this.els.now.innerHTML = '';
    if (this.els.past) this.els.past.innerHTML = '';
    if (this.els.dots) this.els.dots.innerHTML = '';
  };

  Player.prototype._paintToggle = function () {
    const t = this.els.toggle;
    if (!t) return;
    const done = this.finished();
    t.textContent = done ? '↻' : (this.playing ? '❚❚' : '▶');
    t.setAttribute('aria-label', done ? 'Repetir' : (this.playing ? 'Pausa' : 'Reanudar'));
    if (done) t.onclick = () => { this.i = -1; this.playing = true; this.next(); };
  };

  Player.prototype._render = function () {
    const e = this.els;
    if (e.now) {
      e.now.innerHTML = L.codify(this.list[this.i] || '');
      FX.replay(e.now, 'is-in');
    }
    if (e.past) {
      const from = Math.max(0, this.i - HISTORY);
      const past = this.list.slice(from, this.i);   // el más antiguo arriba: se lee en orden
      e.past.innerHTML = '';
      past.forEach((c, k) => {
        const p = doc.createElement('p');
        p.className = 'burst-old';
        // el más lejano, más apagado
        p.dataset.depth = String(past.length - k);
        p.innerHTML = L.codify(c);
        e.past.appendChild(p);
      });
    }
    this._renderDots();
  };

  Player.prototype._renderStatic = function () {
    const e = this.els;
    if (e.now) e.now.innerHTML = L.codify(this.list[0] || '');
    if (e.past) {
      e.past.innerHTML = '';
      this.list.slice(1).forEach((c) => {
        const p = doc.createElement('p');
        p.className = 'burst-old';
        p.dataset.depth = '1';
        p.innerHTML = L.codify(c);
        e.past.appendChild(p);
      });
    }
    this._renderDots();
  };

  Player.prototype._renderDots = function () {
    const d = this.els.dots;
    if (!d) return;
    d.innerHTML = '';
    if (!this.list.length) return;
    this.list.forEach((_, k) => {
      const s = doc.createElement('i');
      s.className = 'bdot' + (k <= this.i ? ' is-done' : '') + (k === this.i ? ' is-now' : '');
      d.appendChild(s);
    });
    const n = doc.createElement('span');
    n.className = 'bcount';
    n.textContent = `${Math.max(1, this.i + 1)}/${this.list.length}`;
    d.appendChild(n);
  };

  root.Burst = { Player, SPEEDS, loadSpeed };

})(typeof window !== 'undefined' ? window : globalThis,
   typeof document !== 'undefined' ? document : null);
