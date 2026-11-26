'use strict';
// Shared kit for subgame renderers: step tracker, action cue, live scoreboard, popups, particle bursts, shake, tweens.
// Every renderer uses the same pieces, so all 16 games read the same way: where am I (steps), what do I do (cue),
// how is everyone doing (board), what just happened (pop, burst, shake).
(() => {
  const { esc, fx2, now, tone } = RH;
  const CALM = matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ---- Particles: one fixed canvas over everything, only animates while particles live ----
  let fxc = null, fxx = null, parts = [], raf = 0;
  function canvas() {
    if (fxc) return;
    fxc = document.createElement('canvas'); fxc.id = 'fxc'; document.body.appendChild(fxc);
    fxx = fxc.getContext('2d');
    const size = () => { const k = Math.min(2, devicePixelRatio || 1); fxc.width = innerWidth * k; fxc.height = innerHeight * k; fxx.setTransform(k, 0, 0, k, 0, 0); };
    addEventListener('resize', size); size();
  }
  function loop() {
    raf = 0; if (!parts.length) { fxx.clearRect(0, 0, innerWidth, innerHeight); return; }
    fxx.clearRect(0, 0, innerWidth, innerHeight);
    const t = performance.now();
    parts = parts.filter(p => t - p.t0 < p.life);
    for (const p of parts) {
      const k = (t - p.t0) / p.life, dt = Math.min(.05, (t - (p.lt || p.t0)) / 1000); p.lt = t;
      p.vy += p.g * dt; p.vx *= .985; p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
      fxx.save(); fxx.globalAlpha = Math.min(1, (1 - k) * 1.6); fxx.translate(p.x, p.y); fxx.rotate(p.r); fxx.fillStyle = p.c;
      if (p.kind === 'spark') { fxx.beginPath(); fxx.arc(0, 0, p.s * (1 - k * .7), 0, RH.TAU); fxx.fill(); }
      else if (p.kind === 'coin') { fxx.scale(Math.cos(p.r * 3), 1); fxx.beginPath(); fxx.arc(0, 0, p.s, 0, RH.TAU); fxx.fill(); fxx.strokeStyle = '#7a5410'; fxx.lineWidth = 1.5; fxx.stroke(); }
      else fxx.fillRect(-p.s, -p.s * .45, p.s * 2, p.s * .9);
      fxx.restore();
    }
    raf = requestAnimationFrame(loop);
  }
  // burst(x, y, opts): confetti at screen coords. opts: colors, n, kind (confetti, spark, coin), power, up
  function burst(x, y, o = {}) {
    if (CALM) return; canvas();
    const cols = o.colors || ['#ffe58a', '#e6c673', '#ff6b5b', '#4fd68a', '#8ab8ff', '#fff'], n = o.n || 40, pw = o.power || 420, t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const a = (o.up ? -Math.PI / 2 : 0) + (o.up ? (Math.random() - .5) * 1.8 : Math.random() * RH.TAU), v = pw * (.35 + Math.random() * .75);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (o.up ? 0 : pw * .35), g: o.kind === 'spark' ? 300 : 900, r: Math.random() * 6, vr: (Math.random() - .5) * 14,
        s: o.kind === 'spark' ? 2 + Math.random() * 3 : o.kind === 'coin' ? 5 + Math.random() * 3 : 3 + Math.random() * 4, c: cols[i % cols.length], kind: o.kind || 'confetti', t0, life: 900 + Math.random() * 900 });
    }
    if (parts.length > 600) parts.splice(0, parts.length - 600);
    if (!raf) raf = requestAnimationFrame(loop);
  }
  const center = e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const burstAt = (e, o) => { if (e) { const [x, y] = center(e); burst(x, y, o); } };
  // Screen point of a canvas world coordinate (canvas width W world units)
  const canvasPt = (c, x, y, W, H) => { const r = c.getBoundingClientRect(); return [r.left + x / W * r.width, r.top + y / (H || W) * r.height]; };

  // ---- Floating text ----
  function pop(x, y, text, o = {}) {
    const d = document.createElement('div');
    d.className = 'kpop ' + (o.kind || ''); d.textContent = text;
    d.style.left = x + 'px'; d.style.top = y + 'px';
    if (o.color) d.style.setProperty('--c', o.color);
    if (o.size) d.style.fontSize = o.size + 'px';
    document.body.appendChild(d); setTimeout(() => d.remove(), o.ms || 1500);
  }
  const popAt = (e, text, o) => { if (e) { const [x, y] = center(e); pop(x, y, text, o); } };
  function shake(e, big) { if (!e || CALM) return; e.classList.remove('kshake', 'kshake2'); void e.offsetWidth; e.classList.add(big ? 'kshake2' : 'kshake'); }
  function flash(e, cls = 'kflash') { if (!e) return; e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); }

  // ---- Step tracker: where the game is ----
  function steps(el, names, i) {
    const k = names.join('|') + ':' + i; if (el.dataset.k === k) return; el.dataset.k = k;
    el.className = 'ksteps';
    el.innerHTML = names.map((n, j) => `<span class="${j < i ? 'done' : j === i ? 'on' : ''}"><b>${j + 1}</b>${esc(n)}</span>`).join('<i></i>');
  }

  // ---- Cue: what you should do right now. kind: you (your move, pulses), wait, good, bad, info ----
  function cue(el, big, small = '', kind = 'info') {
    const k = big + '|' + small + '|' + kind; if (el.dataset.k === k) return; el.dataset.k = k;
    const fresh = el.dataset.kind !== kind || el.dataset.big !== big; el.dataset.kind = kind; el.dataset.big = big;
    el.className = 'kcue ' + kind;
    el.innerHTML = `<b>${esc(big)}</b>${small ? `<small>${esc(small)}</small>` : ''}`;
    if (fresh) flash(el, 'kin');
    if (fresh && kind === 'you') tone(760, .12, .05);
  }

  // ---- Scoreboard: one chip per player, values tween, changes pop ----
  // rows: [{ id, name, color, val (number, multiplier), txt (instead of val), sub, tag, me, turn, out, win }]
  function board(el, rows, o = {}) {
    el.classList.add('kboard');
    const seen = new Set();
    rows.forEach((r, i) => {
      seen.add(r.id);
      let d = el.querySelector(`[data-id="${CSS.escape(r.id)}"]`);
      if (!d) {
        d = document.createElement('div'); d.dataset.id = r.id; d.className = 'kp';
        d.innerHTML = '<i></i><span class="nm"></span><b class="v"></b><small class="sb"></small><em class="tg"></em>';
        el.appendChild(d);
      }
      d.style.setProperty('--c', r.color); d.style.order = i;
      d.classList.toggle('me', !!r.me); d.classList.toggle('turn', !!r.turn); d.classList.toggle('out', !!r.out); d.classList.toggle('win', !!r.win);
      d.querySelector('.nm').textContent = r.name;
      const v = d.querySelector('.v');
      if (r.val !== undefined && r.val !== null) {
        const old = d._v;
        if (old === undefined) { v.textContent = fx2(r.val) + 'x'; }
        else if (old !== r.val) {
          tween(v, old, r.val, 600, x => fx2(x) + 'x');
          const diff = r.val - old;
          if (o.pops !== false && Math.abs(diff) >= .01) { popAt(v, (diff > 0 ? '+' : '') + fx2(diff) + 'x', { kind: diff > 0 ? 'good' : 'bad' }); flash(d, diff > 0 ? 'kup' : 'kdown'); }
        }
        d._v = r.val;
      } else { v.textContent = r.txt || ''; d._v = undefined; }
      d.querySelector('.sb').textContent = r.sub || '';
      const tg = d.querySelector('.tg'); tg.textContent = r.tag || ''; tg.hidden = !r.tag;
    });
    el.querySelectorAll('.kp').forEach(d => { if (!seen.has(d.dataset.id)) d.remove(); });
  }
  function tween(e, a, b, ms, f) {
    const t0 = performance.now(); cancelAnimationFrame(e._tw);
    const step = () => { const k = Math.min(1, (performance.now() - t0) / ms), q = 1 - Math.pow(1 - k, 3); e.textContent = f(a + (b - a) * q); if (k < 1) e._tw = requestAnimationFrame(step); };
    step();
  }
  // True only the first time a key is seen in this game instance: fire effects once per event.
  const once = (st, k) => { st._once = st._once || {}; if (st._once[k]) return false; st._once[k] = 1; return true; };
  // Standard game frame: steps, cue, stage, actions, board
  const frame = (extra = '') => `<div class="ksteps"></div><div class="kcue"></div>${extra}`;

  // ---- Canvas bits ----
  // Wheel tick: plays the flapper tick when the rotation passes a segment
  function wheelTick(st, rot, live) {
    const s = Math.floor(rot + .5);
    if (live && st._seg !== undefined && s !== st._seg) {
      const t = performance.now(); if (!st._tt || t - st._tt > 28) { st._tt = t; if (window.Sfx) Sfx.play('flapper-tick', { vol: .55 }); }
    }
    st._seg = s;
  }
  function glowText(x, s, px, py, size, col = '#fff', glow = '#000') {
    x.save(); x.shadowColor = glow; x.shadowBlur = 14; x.fillStyle = col; RH.heft(x, size, 3); x.textAlign = 'center'; x.textBaseline = 'middle'; RH.htext(x, s, px, py); x.restore();
  }
  // Countdown number drawn big in the middle of a canvas
  function bigCount(x, n, cx, cy, size = 120) {
    const f = n % 1, k = Math.ceil(n);
    x.save(); x.globalAlpha = Math.min(1, f * 2 + .2); x.translate(cx, cy); x.scale(1 + (1 - f) * .4, 1 + (1 - f) * .4);
    glowText(x, k, 0, 0, size, '#ffe58a', '#000'); x.restore();
  }

  RH.K = { burst, burstAt, canvasPt, pop, popAt, shake, flash, steps, cue, board, tween, once, frame, center, wheelTick, glowText, bigCount, CALM };
})();
