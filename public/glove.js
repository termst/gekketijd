'use strict';
// Gekke Tijd: the Glove. A 2.5D white glove that hovers over the game, spins the wheel and reacts to everything.
//
// Rendering: a small 3D skeleton (palm slab, 4 fingers x 3 phalanges, 3 thumb bones, cuff with a fading sleeve)
// is rotated (roll, yaw, pitch), projected with weak perspective, depth sorted and shaded with gradients.
// Every joint, the orientation, the screen position, the depth (z) and the scale are damped springs, so any pose
// blends into any other. Depth drives scale, blur, shadow offset and the HUD layer the canvas sits in.
//
// Behaviour: a director runs one cancellable async action at a time (idle, reaction, wheel spin).
// Every choice (action, corner, force, path, spot, variant) goes through an anti repetition picker.
//
// Page API: Glove.init(adapter), Glove.room(info), Glove.emit(type, data), Glove.spin(sp, remain), Glove.spinGo(info).
const Glove = (() => {
  const TAU = Math.PI * 2, PI = Math.PI, CALM = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const rnd = (a, b) => a + Math.random() * (b - a), chance = p => Math.random() < p, sgn = () => Math.random() < .5 ? -1 : 1;
  const any = a => a[Math.floor(Math.random() * a.length)], hyp = Math.hypot, now = () => performance.now();
  const wrapA = a => ((a + PI) % TAU + TAU) % TAU - PI;
  const E = {
    lin: t => t, sine: t => .5 - .5 * Math.cos(PI * t), out: t => 1 - (1 - t) ** 3, in: t => t * t * t,
    cubic: t => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
    expo: t => t >= 1 ? 1 : 1 - 2 ** (-10 * t),
    back: t => { const c = 2.1, d = c + 1; return 1 + d * (t - 1) ** 3 + c * (t - 1) ** 2; },
    // move, hold, move, hold: robotic and uncanny
    stutter: t => { const n = 5, u = Math.min(t * n, n - 1e-6), i = Math.floor(u), f = u - i; return (i + (f < .38 ? E.cubic(f / .38) : 1)) / n; },
    // creeps, then lunges
    lurch: t => t < .62 ? .14 * E.sine(t / .62) : .14 + .86 * E.out((t - .62) / .38),
  };
  const CANCEL = { cancelled: true };

  // ---------------------------------------------------------------- Skeleton (hand units, wrist at origin)
  // Identity: back of a right hand faces the viewer (+z), fingers up (-y), thumb on the left (-x).
  const MCP = [[-.29, -.9, 0], [-.09, -.96, 0], [.12, -.93, 0], [.31, -.83, 0]];
  const LEN = [[.46, .29, .25], [.5, .32, .27], [.47, .3, .25], [.37, .24, .21]];
  const RAD = [[.135, .127, .12], [.14, .131, .123], [.134, .126, .12], [.123, .116, .11]];
  const CMC = [-.27, -.2, -.04], TLEN = [.4, .33, .28], TRAD = [.165, .148, .136];
  const PALM = [[-.33, .04], [-.1, .08], [.14, .07], [.33, .02], [.41, -.3], [.43, -.62], [.37, -.86], [.17, -.99], [-.08, -1.03], [-.31, -.98], [-.43, -.74], [-.44, -.44], [-.4, -.14]];
  const PERSP = .14;
  // P: 20 numbers. Finger i: [spread, curl1, curl2, curl3] at 4i. Thumb at 16: [abduction, opposition, flex1, flex2].
  function skel(P) {
    const F = [];
    for (let i = 0; i < 4; i++) {
      const s = P[i * 4], dx = Math.sin(s), dy = -Math.cos(s), pts = [MCP[i]];
      let th = 0, p = MCP[i];
      for (let j = 0; j < 3; j++) { th += P[i * 4 + 1 + j]; const c = Math.cos(th), sn = Math.sin(th), L = LEN[i][j]; p = [p[0] + dx * c * L, p[1] + dy * c * L, p[2] - sn * L]; pts.push(p); }
      F.push(pts);
    }
    const a = P[16], o = P[17], co = Math.cos(o), so = Math.sin(o);
    const d1 = [-Math.sin(a) * co, -Math.cos(a) * co, -so];
    let b = [.85, -.2, -.5]; const dd = b[0] * d1[0] + b[1] * d1[1] + b[2] * d1[2];
    b = [b[0] - d1[0] * dd, b[1] - d1[1] * dd, b[2] - d1[2] * dd]; const bl = hyp(...b) || 1; b = b.map(v => v / bl);
    const T = [CMC]; let p = [CMC[0] + d1[0] * TLEN[0], CMC[1] + d1[1] * TLEN[0], CMC[2] + d1[2] * TLEN[0]]; T.push(p);
    let th = 0;
    for (let j = 1; j < 3; j++) { th += P[17 + j]; const c = Math.cos(th), sn = Math.sin(th), L = TLEN[j]; p = [p[0] + (d1[0] * c + b[0] * sn) * L, p[1] + (d1[1] * c + b[1] * sn) * L, p[2] + (d1[2] * c + b[2] * sn) * L]; T.push(p); }
    return { F, T };
  }
  // R = Rz(roll) * Ry(yaw) * Rx(pitch). Positive pitch tips the fingers toward the viewer.
  function rot(v, cr, sr, cy, sy, cp, sp) {
    let [x, y, z] = v, t;
    t = y * cp + z * sp; z = -y * sp + z * cp; y = t;
    t = x * cy + z * sy; z = -x * sy + z * cy; x = t;
    t = x * cr - y * sr; y = x * sr + y * cr; x = t;
    return [x, y, z];
  }
  function rotM(r, yw, p) { const a = [Math.cos(r), Math.sin(r), Math.cos(yw), Math.sin(yw), Math.cos(p), Math.sin(p)]; return [...rot([1, 0, 0], ...a), ...rot([0, 1, 0], ...a), ...rot([0, 0, 1], ...a)]; }
  const mulM = (M, p) => [M[0] * p[0] + M[3] * p[1] + M[6] * p[2], M[1] * p[0] + M[4] * p[1] + M[7] * p[2], M[2] * p[0] + M[5] * p[1] + M[8] * p[2]];

  // ---------------------------------------------------------------- Poses
  const mk = (f, t) => [...f[0], ...f[1], ...f[2], ...f[3], ...t];
  const FF = [[-.06, 1.55, 1.8, 1.0], [0, 1.58, 1.82, 1.0], [.05, 1.6, 1.85, 1.0], [.1, 1.62, 1.85, 1.0]], TUCK = [.4, 1.02, .52, .62];
  const EXT = s => [s, .02, .04, .02];
  const POSES = {
    relax: mk([[-.12, .22, .28, .16], [-.02, .28, .32, .18], [.09, .34, .36, .2], [.2, .42, .4, .22]], [.62, .32, .12, .2]),
    open: mk([[-.24, .04, .04, .02], [-.06, .02, .03, .02], [.1, .04, .05, .03], [.3, .07, .06, .04]], [1.0, .12, 0, .05]),
    flat: mk([[-.08, .02, .02, .01], [-.02, .01, .02, .01], [.04, .02, .02, .01], [.1, .03, .03, .02]], [.55, .1, 0, .05]),
    splay: mk([[-.42, -.2, .12, .32], [-.1, -.15, .16, .36], [.18, -.12, .22, .38], [.5, -.08, .28, .42]], [1.3, 0, -.1, .3]),
    claw: mk([[-.3, .55, .95, .75], [-.06, .6, 1.0, .8], [.14, .66, 1.0, .8], [.38, .72, 1.05, .85]], [.95, .55, .45, .55]),
    grip: mk([[-.14, .95, 1.15, .8], [-.03, 1.0, 1.2, .85], [.07, 1.05, 1.2, .85], [.18, 1.1, 1.25, .9]], [.7, .75, .45, .5]),
    hook: mk([[-.08, .3, 1.45, 1.1], [0, .32, 1.5, 1.1], [.07, .34, 1.5, 1.1], [.15, .38, 1.5, 1.1]], [.5, .5, .3, .4]),
    fist: mk(FF, [.42, 1.05, .55, .65]),
    point: mk([EXT(-.05), FF[1], FF[2], FF[3]], TUCK),
    thumb: mk(FF, [1.45, .05, -.05, 0]),
    middle: mk([[-.02, 1.6, 1.85, 1.05], [0, 0, .03, .02], [.02, 1.62, 1.88, 1.05], FF[3]], TUCK),
    gun: mk([EXT(-.06), FF[1], FF[2], FF[3]], [1.3, 0, -.05, 0]),
    ok: mk([[-.1, .75, .95, .62], [0, .12, .12, .08], [.14, .16, .14, .1], [.32, .2, .16, .1]], [.75, .85, .32, .42]),
    pinch: mk([[-.1, .62, .55, .42], [-.02, .7, .9, .6], [.06, .8, 1.0, .7], [.16, .9, 1.05, .75]], [.78, .8, .25, .3]),
    limp: mk([[-.08, .5, .6, .4], [0, .55, .65, .42], [.08, .6, .68, .44], [.16, .66, .7, .46]], [.4, .4, .3, .35]),
    snap: mk([[-.1, .7, .8, .5], [0, .5, .6, .4], [.08, 1.2, 1.4, .9], [.16, 1.3, 1.5, .9]], [.6, .9, .2, .2]),
    rub: mk([[-.05, .55, .5, .3], [.03, .6, .5, .3], [.08, 1.3, 1.5, .9], [.14, 1.4, 1.6, .9]], [.6, .95, .2, .25]),
  };
  for (let n = 0; n <= 5; n++) POSES['n' + n] = mk([0, 1, 2, 3].map(i => i < Math.min(n, 4) ? EXT([-.22, -.06, .1, .28][i]) : FF[i]), n === 5 ? [1.05, .1, 0, .05] : TUCK);
  POSES.peace = POSES.n2;
  // Local contact points of a pose (cached)
  const tipCache = {};
  function tipOf(pose, which) {
    const key = pose + ':' + which; if (tipCache[key]) return tipCache[key];
    const { F, T } = skel(POSES[pose] || POSES.relax), avg = (a, b) => a.map((v, i) => (v + b[i]) / 2);
    const out = { index: F[0][3], middle: F[1][3], ring: F[2][3], pinky: F[3][3], thumb: T[3], knuck: [0, -1.06, -.06], palm: [0, -.55, 0], mid: [0, -.85, 0], grip: avg(F[1][2], F[2][2]), hook: F[1][2], pinch: avg(F[0][3], T[3]), tips: avg(F[1][3], F[2][3]) }[which] || [0, -.85, 0];
    return tipCache[key] = out;
  }

  // ---------------------------------------------------------------- Springs and rig
  class Spr {
    constructor(x, k, z) { this.x = this.t = x; this.v = 0; this.k = k; this.z = z; }
    step(dt) { const w = Math.sqrt(this.k), d = 2 * this.z * w, n = Math.max(1, Math.ceil(dt * w / .3)), h = dt / n; for (let i = 0; i < n; i++) { this.v += (this.k * (this.t - this.x) - d * this.v) * h; this.x += this.v * h; } }
    to(t, k, z) { this.t = t; if (k) this.k = k; if (z) this.z = z; }
    toA(t, k, z) { this.to(this.x + wrapA(t - this.x), k, z); }
  }
  const KP = 70;
  const rig = {
    x: new Spr(0, KP, .9), y: new Spr(0, KP, .9), z: new Spr(.2, 28, 1), roll: new Spr(0, 60, .8), yaw: new Spr(0, 45, .85), pitch: new Spr(0, 45, .85),
    sc: new Spr(1, 120, .55), hov: new Spr(1, 6, 1), trem: new Spr(0, 20, 1),
    P: POSES.relax.map(v => new Spr(v, 70, .78)), pose: 'relax', lock: null, lockTok: null, over: false, bank: .8,
  };
  const off = { x: 0, y: 0, z: 0, roll: 0, P: new Float32Array(20) };
  const SPRINGS = [rig.x, rig.y, rig.z, rig.roll, rig.yaw, rig.pitch, rig.sc, rig.hov, rig.trem, ...rig.P];
  function setPose(name, k = 70, jit = .05) {
    const a = POSES[name]; if (!a) return; rig.pose = name;
    a.forEach((v, i) => rig.P[i].to(v + (i % 4 ? rnd(-jit, jit) : rnd(-jit, jit) * .5), k));
  }
  function setFinger(i, c, k = 200) { for (let j = 0; j < 3; j++) if (c[j] != null) rig.P[i * 4 + 1 + j].to(c[j], k); }
  function setThumb(t, k = 200) { t.forEach((v, j) => v != null && rig.P[16 + j].to(v, k)); }

  // ---------------------------------------------------------------- Page state
  let A = null, cv, g, fxc, fg, Hb, hb, Cb, cb, dpr = 1, W = 1, Hh = 1, S0 = 60, T = 0, lastT = 0, started = false, HAS_FILTER = false;
  let fxDirty = false, layer = '', lastSk = null, lastPos = [0, 0];
  const st = { phase: 'betting', round: -1, endsAt: 0, allReady: false, agit: .25, prepRound: -2, countRound: -2, spinT0: 0, spinA0: 0, spinEnd: 0, spinPlan: null, lastReact: 0, players: 0, overlay: false };
  const $ = s => document.querySelector(s);
  const SEL = {
    table: '#table', header: 'header', say: '#say', clock: '#clock', hist: '#hist span', people: '#people .pl', tickets: '.house', lit: '.house.lit', hit: '.house.hit',
    coins: '.coin', go: '#go', win: '#win', bal: '#bal', buttons: 'header .btn, #quay .btn', medal: '.medal', box: '#bonus.on #box', stage: '#stage',
  };
  function visRect(e) { const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < Hh && r.left < W && (e.offsetParent !== null || getComputedStyle(e).position === 'fixed') ? r : null; }
  function pickEl(name) { const list = [...document.querySelectorAll(SEL[name] || name)].map(e => visRect(e)).filter(Boolean); return list.length ? any(list) : null; }
  const wheel = () => { try { return A && A.wheel ? A.wheel() : null; } catch { return null; } };
  const overlayOn = () => !!$('#bonus.on');

  // ---------------------------------------------------------------- Anti repetition
  // Weighted pick that punishes recent picks hard and frequent picks softly.
  const bags = {};
  function pick(name, items, mem = 7) {
    const b = bags[name] = bags[name] || [], REC = [.02, .14, .38, .6, .78, .9];
    const list = items.map(it => typeof it === 'string' ? [it, 1] : it).filter(it => it[1] > 0);
    if (!list.length) return null;
    const sc = list.map(([id, w]) => { const i = b.indexOf(id), n = b.filter(x => x === id).length; return w * (i < 0 ? 1 : REC[i] ?? .95) * .82 ** n; });
    let r = Math.random() * sc.reduce((a, v) => a + v, 0), id = list[list.length - 1][0];
    for (let i = 0; i < list.length; i++) { r -= sc[i]; if (r <= 0) { id = list[i][0]; break; } }
    b.unshift(id); if (b.length > mem) b.length = mem;
    return id;
  }
  // Spot memory: candidates far from recent spots win.
  const spots = [];
  function freshSpot(gen, n = 8) {
    let best = null, bs = -1;
    for (let i = 0; i < n; i++) { const p = gen(); let d = W; for (const q of spots) d = Math.min(d, hyp(p[0] - q[0], p[1] - q[1])); d *= rnd(.75, 1.25); if (d > bs) { bs = d; best = p; } }
    spots.unshift(best); if (spots.length > 6) spots.length = 6; return best;
  }
  const stageSpot = () => [rnd(.2, .8) * W, rnd(.2, .58) * Hh];
  const anySpot = () => [rnd(.08, .92) * W, rnd(.14, .86) * Hh];
  function pathPick(calm) {
    const a = st.agit, c = calm ?? (1 - a);
    return pick('path', [['arc', 1.2], ['s', 1], ['swoop', .7 + c * .5], ['loop', .25 + c * .4], ['direct', .4 + a], ['stutter', .1 + a * .9], ['lurch', .15 + a * .7], ['dive', .55]]);
  }

  // ---------------------------------------------------------------- Projection helpers
  const scaleAt = z => S0 * (1 + .42 * clamp(z, -1.2, 1.3));
  function solveRoll(local, ang, yaw, pitch) { const q = mulM(rotM(0, yaw, pitch), local); return ang - Math.atan2(q[1], q[0]); }
  function wristFor(local, sx, sy, roll, yaw, pitch, z) {
    const q = mulM(rotM(roll, yaw, pitch), local), f = 1 / (1 - q[2] * PERSP), s = scaleAt(z) * rig.sc.t;
    return [sx - q[0] * s * f, sy - q[1] * s * f];
  }
  // Screen position of a local point on the hand as it is drawn right now.
  function screenOf(local) {
    const M = rotM(rig.roll.x + off.roll, rig.yaw.x, rig.pitch.x), q = mulM(M, local), f = 1 / (1 - q[2] * PERSP), s = scaleAt(rig.z.x + off.z) * rig.sc.x;
    return [rig.x.x + off.x + q[0] * s * f, rig.y.x + off.y + q[1] * s * f];
  }
  function liveTip(which) {
    if (!lastSk) return lastPos;
    const p = { index: lastSk.F[0][3], middle: lastSk.F[1][3], thumb: lastSk.T[3], tips: lastSk.F[1][3] }[which];
    return screenOf(p || tipOf(rig.pose, which));
  }

  // ---------------------------------------------------------------- Runtime: cancellable actions
  let cur = null, mv = null;
  const waits = [], queue = [];
  function kill(tok) {
    if (!tok || tok.dead) return; tok.dead = true;
    for (let i = waits.length - 1; i >= 0; i--) if (waits[i].tok === tok) { waits[i].rej(CANCEL); waits.splice(i, 1); }
    if (mv && mv.tok === tok) { mv.rej(CANCEL); mv = null; }
    if (rig.lockTok === tok) unlock();
    rig.trem.to(0); breath = 1;
  }
  function run(name, fn, pri = 0, d) {
    if (cur && cur.pri > pri) return false;
    if (cur) kill(cur);
    const tok = { name, pri, dead: false, t0: now() }; cur = tok;
    const c = ctx(tok);
    Promise.resolve().then(() => fn(c, d)).catch(e => { if (e !== CANCEL) console.error(e); }).finally(() => { if (cur === tok) cur = null; kill(tok); });
    return true;
  }
  function go(tok, x, y, o = {}) {
    if (tok.dead) return Promise.reject(CANCEL);
    return new Promise((res, rej) => {
      if (mv) mv.res();
      const x0 = rig.x.x, y0 = rig.y.x, dx = x - x0, dy = y - y0, d = hyp(dx, dy) || 1, nx = -dy / d, ny = dx / d;
      const style = o.path || 'arc', side = o.side || sgn(), bend = (o.bend ?? rnd(.14, .42)) * d * side;
      const at = (u, b) => [x0 + dx * u + nx * b, y0 + dy * u + ny * b];
      let c1, c2, ease = o.ease, zArc = o.zArc || 0;
      switch (style) {
        case 'direct': case 'stutter': case 'lurch': c1 = at(1 / 3, 0); c2 = at(2 / 3, 0); break;
        case 's': c1 = at(.3, bend); c2 = at(.7, -bend); break;
        case 'swoop': c1 = at(.05, bend * 1.4); c2 = at(1.25, bend * .5); break;
        case 'loop': c1 = at(1.05, bend * 1.9); c2 = at(-.05, bend * 1.9); break;
        case 'dive': c1 = at(.3, bend * .6); c2 = at(.7, bend * .6); zArc = zArc || -rnd(.9, 1.4); break;
        default: c1 = at(.25, bend); c2 = at(.75, bend);
      }
      if (!ease) ease = style === 'stutter' ? 'stutter' : style === 'lurch' ? 'lurch' : 'sine';
      let speed = (o.speed || 520) * (CALM ? .5 : 1) * (1 + st.agit * .35);
      const dur = o.dur ? o.dur * (CALM ? 1.6 : 1) : clamp(d / speed, .22, 3) * 1000 * (style === 'loop' ? 1.5 : 1);
      rig.x.k = rig.y.k = o.k || KP; rig.x.z = rig.y.z = o.damp || .9;
      if (o.z != null || zArc) rig.z.k = o.zk || 28;
      rig.bank = o.bank ?? .8;
      mv = { tok, x0, y0, c1, c2, x, y, t0: now(), dur, ease: E[ease] || E.sine, z0: rig.z.t, z1: o.z ?? rig.z.t, zArc, res, rej };
    });
  }
  function lock(tok, fn) { rig.lock = fn; rig.lockTok = tok; }
  function unlock() { rig.lock = null; rig.lockTok = null; }
  let breath = 1;
  function ctx(tok) {
    const chk = () => { if (tok.dead) throw CANCEL; };
    const c = {
      tok,
      wait: ms => { chk(); return new Promise((res, rej) => waits.push({ at: now() + ms * (CALM ? 1.3 : 1), res, rej, tok })); },
      until: (fn, ms = 6e4) => { chk(); return new Promise((res, rej) => waits.push({ at: now() + ms, fn, res, rej, tok })); },
      // calls fn(u) every frame for ms, u eased 0..1
      tween: (ms, fn, ease = E.sine) => { chk(); const t0 = now(); return new Promise((res, rej) => waits.push({ at: t0 + ms, each: () => fn(ease(clamp((now() - t0) / ms, 0, 1))), res, rej, tok })); },
      go: (x, y, o) => { chk(); return go(tok, x, y, o); },
      // move so that a local point of the current/target pose lands on screen point (sx, sy)
      goPt: (which, sx, sy, o = {}) => { chk(); const z = o.z ?? rig.z.t, w = wristFor(Array.isArray(which) ? which : tipOf(rig.pose, which), sx, sy, rig.roll.t, rig.yaw.t, rig.pitch.t, z); return go(tok, w[0], w[1], { ...o, z }); },
      pose: (n, k, j) => { chk(); setPose(n, k, j); },
      finger: (i, cc, k) => { chk(); setFinger(i, cc, k); },
      thumb: (t, k) => { chk(); setThumb(t, k); },
      orient: (r, y, p, k = 80) => { chk(); if (r != null) rig.roll.toA(r, k); if (y != null) rig.yaw.toA(y, k); if (p != null) rig.pitch.to(p, k); },
      aim: (which, ang, yaw, pitch, k = 80) => { chk(); const r = solveRoll(tipOf(rig.pose, which), ang, yaw, pitch); c.orient(r, yaw, pitch, k); return r; },
      depth: (z, k = 28) => { chk(); rig.z.to(z, k); },
      scale: (s, k = 120) => { chk(); rig.sc.to(s, k); },
      hov: v => rig.hov.to(v), trem: v => rig.trem.to(v, 40), breath: v => { breath = v; },
      over: v => { rig.over = !!v; },
      lock: fn => { chk(); lock(tok, fn); }, unlock,
      burst: (x, y, kind, p) => burst(x, y, kind, p),
      tip: liveTip, screenOf,
      soft: () => { rig.x.k = rig.y.k = KP; rig.x.z = rig.y.z = .9; rig.z.k = 28; rig.bank = .8; },
    };
    return c;
  }

  // ---------------------------------------------------------------- Particles (impact only, never moves the UI)
  const parts = [];
  const FXC = ['#FFF4DC', '#FFF0B8', '#F2C65A', '#ffffff', '#e8e4ff'];
  function burst(x, y, kind = 'impact', p = 1) {
    if (CALM && kind !== 'tap') p *= .4;
    const add = o => parts.push({ age: 0, ...o });
    if (kind === 'impact') {
      add({ t: 'ring', x, y, r0: 6, r1: 70 * p + 20, life: .32, w: 5 });
      add({ t: 'ring', x, y, r0: 2, r1: 40 * p + 12, life: .22, w: 3, c: '#F2C65A' });
      const n = Math.round(9 + 6 * p);
      for (let i = 0; i < n; i++) { const a = TAU * i / n + rnd(-.2, .2), s = rnd(260, 620) * (.6 + p * .5); add({ t: 'streak', x, y, a, s, len: rnd(14, 30) * p + 6, life: rnd(.16, .28) }); }
      for (let i = 0; i < 7 + 5 * p; i++) { const a = rnd(0, TAU), s = rnd(120, 520) * p; add({ t: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, g: 900, s: rnd(5, 11), life: rnd(.35, .7), rot: rnd(0, TAU), vr: rnd(-8, 8), c: any(FXC) }); }
      for (let i = 0; i < 5 + 3 * p; i++) { const a = rnd(0, TAU), s = rnd(30, 140); add({ t: 'dust', x: x + Math.cos(a) * 8, y: y + Math.sin(a) * 8, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rnd(8, 18) * (.7 + p * .4), life: rnd(.35, .6) }); }
      for (let i = 0; i < 4 + 3 * p; i++) { const a = rnd(0, TAU), s = rnd(200, 480); add({ t: 'chip', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 200, g: 1300, s: rnd(4, 7), life: rnd(.5, .8), rot: rnd(0, TAU), vr: rnd(-14, 14) }); }
    } else if (kind === 'tap') {
      add({ t: 'ring', x, y, r0: 3, r1: 22 * p + 8, life: .2, w: 2.5 });
      for (let i = 0; i < 3; i++) { const a = -PI / 2 + rnd(-1.3, 1.3), s = rnd(120, 260); add({ t: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 600, s: rnd(3, 6), life: rnd(.2, .35), rot: 0, vr: rnd(-6, 6), c: any(FXC) }); }
    } else if (kind === 'knock') {
      add({ t: 'ring', x, y, r0: 10, r1: 90 * p, life: .45, w: 3, c: '#e8e4ff' });
      add({ t: 'ring', x, y, r0: 4, r1: 55 * p, life: .32, w: 2 });
    } else if (kind === 'snap' || kind === 'crack') {
      const n = kind === 'snap' ? 7 : 3;
      for (let i = 0; i < n; i++) { const a = TAU * i / n + rnd(-.3, .3); add({ t: 'streak', x, y, a, s: rnd(160, 300), len: rnd(8, 16) * p, life: rnd(.12, .2) }); }
      if (kind === 'snap') add({ t: 'spark', x, y, vx: 0, vy: -40, g: 0, s: 14 * p, life: .3, rot: 0, vr: 3, c: '#fffbe8' });
    } else if (kind === 'grab') {
      for (let i = 0; i < 4 + 4 * p; i++) { const a = rnd(0, TAU), s = rnd(40, 150) * (.5 + p); add({ t: 'dust', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rnd(6, 12) * (.6 + p * .6), life: rnd(.3, .5) }); }
    } else if (kind === 'whoosh') {
      for (let i = 0; i < 6; i++) add({ t: 'streak', x: x + rnd(-20, 20), y: y + rnd(-20, 20), a: p, s: rnd(500, 900), len: rnd(30, 60), life: rnd(.15, .25) });
    } else if (kind === 'speed') {
      add({ t: 'line', x, y, a: p, len: rnd(30, 70), life: .16 });
    }
  }
  function drawFx(dt) {
    if (!parts.length && !fxDirty) return;
    fg.setTransform(1, 0, 0, 1, 0, 0); fg.clearRect(0, 0, fxc.width, fxc.height); fxDirty = parts.length > 0;
    fg.setTransform(dpr, 0, 0, dpr, 0, 0); fg.lineCap = 'round'; fg.lineJoin = 'round';
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i]; q.age += dt; const u = q.age / q.life; if (u >= 1) { parts.splice(i, 1); continue; }
      if (q.vx != null) { q.vy += (q.g || 0) * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= .97; q.vy *= q.g ? 1 : .97; }
      if (q.vr) q.rot += q.vr * dt;
      fg.globalAlpha = 1 - u * u;
      if (q.t === 'ring') { fg.beginPath(); fg.arc(q.x, q.y, lerp(q.r0, q.r1, E.out(u)), 0, TAU); fg.lineWidth = q.w * (1 - u) + .5; fg.strokeStyle = q.c || '#FFF4DC'; fg.stroke(); }
      else if (q.t === 'streak' || q.t === 'line') {
        const d = q.t === 'line' ? 0 : q.s * q.age, l = q.len * (1 - u * .6), cx = Math.cos(q.a), sy = Math.sin(q.a);
        fg.beginPath(); fg.moveTo(q.x + cx * d, q.y + sy * d); fg.lineTo(q.x + cx * (d + l), q.y + sy * (d + l));
        fg.lineWidth = q.t === 'line' ? 2 : 3.5 * (1 - u) + 1; fg.strokeStyle = q.t === 'line' ? 'rgba(255,244,220,.55)' : '#FFF4DC'; fg.stroke();
      } else if (q.t === 'spark') {
        const s = q.s * (1 - u * .5); fg.save(); fg.translate(q.x, q.y); fg.rotate(q.rot); fg.beginPath();
        fg.moveTo(0, -s); fg.quadraticCurveTo(0, 0, s, 0); fg.quadraticCurveTo(0, 0, 0, s); fg.quadraticCurveTo(0, 0, -s, 0); fg.quadraticCurveTo(0, 0, 0, -s);
        fg.fillStyle = q.c; fg.fill(); fg.lineWidth = 1.2; fg.strokeStyle = '#2b1606'; fg.stroke(); fg.restore();
      } else if (q.t === 'dust') { fg.globalAlpha = (1 - u) * .55; fg.beginPath(); fg.arc(q.x, q.y, q.r * (1 + u * 1.2), 0, TAU); fg.fillStyle = '#efeaff'; fg.fill(); }
      else if (q.t === 'chip') { fg.save(); fg.translate(q.x, q.y); fg.rotate(q.rot); fg.fillStyle = '#F2C65A'; fg.fillRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); fg.lineWidth = 1; fg.strokeStyle = '#2b1606'; fg.strokeRect(-q.s / 2, -q.s / 4, q.s, q.s / 2); fg.restore(); }
    }
    fg.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Renderer
  const LX = -.53, LY = -.85, LINE = 'rgba(43,22,40,.92)', SIDE = '#a49cbc';
  let M = null, Sc = 60, OX = 0, OY = 0;
  function P3(p) { const q = mulM(M, p), f = 1 / (1 - q[2] * PERSP); return [OX + q[0] * Sc * f, OY + q[1] * Sc * f, q[2], f]; }
  function capPath(c, ax, ay, ar, bx, by, br) {
    const dx = bx - ax, dy = by - ay, d = hyp(dx, dy); c.beginPath();
    if (d <= Math.abs(ar - br) + .5) { const r = Math.max(ar, br); c.arc(ar >= br ? ax : bx, ar >= br ? ay : by, r, 0, TAU); return; }
    const phi = Math.atan2(dy, dx), al = Math.acos(clamp((ar - br) / d, -1, 1));
    c.arc(ax, ay, ar, phi + al, phi - al + TAU); c.arc(bx, by, br, phi - al, phi + al); c.closePath();
  }
  function capFill(c, ax, ay, ar, bx, by, br) {
    const dx = bx - ax, dy = by - ay, d = hyp(dx, dy), r = Math.max(ar, br), mx = (ax + bx) / 2, my = (ay + by) / 2;
    if (d < r * .7) {
      const gr = c.createRadialGradient(mx + LX * r * .42, my + LY * r * .42, r * .05, mx, my, r * 1.05);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.45, '#ebe9f2'); gr.addColorStop(.85, '#b7afcb'); gr.addColorStop(1, '#9a91b3'); return gr;
    }
    let nx = -dy / d, ny = dx / d; if (nx * LX + ny * LY < 0) { nx = -nx; ny = -ny; }
    const gr = c.createLinearGradient(mx + nx * r, my + ny * r, mx - nx * r, my - ny * r);
    gr.addColorStop(0, '#f1f0f7'); gr.addColorStop(.2, '#ffffff'); gr.addColorStop(.52, '#e8e6f0'); gr.addColorStop(.8, '#b4acc8'); gr.addColorStop(.92, '#968eb0'); gr.addColorStop(1, '#c4bce6');
    return gr;
  }
  function smoothPath(c, pts) {
    c.beginPath(); const n = pts.length;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!i) { const z = pts[n - 1]; c.moveTo((z[0] + a[0]) / 2, (z[1] + a[1]) / 2); } c.quadraticCurveTo(a[0], a[1], m[0], m[1]); }
    c.closePath();
  }
  function ensure(cvs, w, h) { if (cvs.width < w || cvs.height < h) { cvs.width = Math.max(cvs.width, Math.ceil(w * 1.2)); cvs.height = Math.max(cvs.height, Math.ceil(h * 1.2)); } }

  function render() {
    const z = rig.z.x + off.z; Sc = scaleAt(z) * rig.sc.x;
    OX = rig.x.x + off.x; OY = rig.y.x + off.y; lastPos = [OX, OY];
    M = rotM(rig.roll.x + off.roll, rig.yaw.x, rig.pitch.x);
    const P = rig.P.map((s, i) => s.x + off.P[i]), sk = skel(P); lastSk = sk;
    const lw = Math.max(1.3, Sc * .028), items = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = (x, y, r = 0) => { if (x - r < x0) x0 = x - r; if (y - r < y0) y0 = y - r; if (x + r > x1) x1 = x + r; if (y + r > y1) y1 = y + r; };
    const cap = (a, b, ra, rb, bias) => { const Ap = P3(a), Bp = P3(b), r0 = ra * Sc * Ap[3], r1 = rb * Sc * Bp[3]; grow(Ap[0], Ap[1], r0); grow(Bp[0], Bp[1], r1); items.push({ k: (Ap[2] + Bp[2]) / 2 + bias, A: Ap, B: Bp, ra: r0, rb: r1 }); };
    sk.F.forEach((pts, i) => { for (let j = 0; j < 3; j++) cap(pts[j], pts[j + 1], RAD[i][j], RAD[i][j] * .97, j * .002); });
    for (let j = 0; j < 3; j++) cap(sk.T[j], sk.T[j + 1], TRAD[j], TRAD[j] * .96, j * .002 + (j ? 0 : -.02));
    const slices = [-.13, 0, .13].map(lz => { const pts = PALM.map(([x, y]) => P3([x, y, lz])); pts.forEach(p => grow(p[0], p[1])); return { lz, pts, k: P3([0, -.5, lz])[2] }; }).sort((a, b) => a.k - b.k);
    items.push({ k: P3([0, -.5, 0])[2] - .03, palm: true });
    const cuA = P3([0, -.05, 0]), cuB = P3([0, .3, 0]), cuC = P3([0, 1.55, 0]);
    grow(cuA[0], cuA[1], .34 * Sc * cuA[3]); grow(cuC[0], cuC[1], .48 * Sc * cuC[3]);
    items.push({ k: P3([0, .25, 0])[2] - .06, cuff: true });
    items.sort((a, b) => a.k - b.k);
    const pad = lw * 2 + 3; x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    const bw = Math.min(x1 - x0, W * 2), bh = Math.min(y1 - y0, Hh * 2), pw = Math.ceil(bw * dpr), ph = Math.ceil(bh * dpr);
    ensure(Hb, pw, ph); ensure(Cb, pw, ph);
    hb.setTransform(1, 0, 0, 1, 0, 0); hb.clearRect(0, 0, pw + 2, ph + 2); hb.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr);
    hb.lineJoin = 'round';
    const backView = M[8] > 0;
    for (const it of items) {
      if (it.palm) drawPalm(hb, slices, backView, lw);
      else if (it.cuff) drawCuff(cuA, cuB, cuC, lw, x0, y0, pw, ph);
      else { const { A: a, B: b, ra, rb } = it; capPath(hb, a[0], a[1], ra, b[0], b[1], rb); hb.lineWidth = lw * 2; hb.strokeStyle = LINE; hb.stroke(); hb.fillStyle = capFill(hb, a[0], a[1], ra, b[0], b[1], rb); hb.fill(); }
    }
    // composite: clear last frame, shadow, hand
    // full clear: a dirty rect misses pixels when blur, shadow or a resize changes the footprint
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    const e = clamp((z + 1) / 2.2, 0, 1), sdx = S0 * (.08 + e * .5), sdy = S0 * (.14 + e * .75), blur = .5 + e * e * 20, sa = .78 - e * .3;
    const OFF = cv.width + pw + 50;
    g.save(); g.shadowColor = `rgba(11,2,7,${sa.toFixed(3)})`; g.shadowBlur = blur * dpr; g.shadowOffsetX = OFF + sdx * dpr; g.shadowOffsetY = sdy * dpr;
    g.drawImage(Hb, 0, 0, pw, ph, x0 * dpr - OFF, y0 * dpr, pw, ph); g.restore();
    const far = clamp(-z - .35, 0, 1), near = clamp(z - .85, 0, 1), bl = far * 3.2 + near * 2.4;
    if (HAS_FILTER && (bl > .15 || far > 0)) g.filter = `blur(${(bl * dpr).toFixed(2)}px) brightness(${(1 - far * .22).toFixed(3)}) saturate(${(1 - far * .3).toFixed(3)})`;
    g.drawImage(Hb, 0, 0, pw, ph, x0 * dpr, y0 * dpr, pw, ph);
    if (HAS_FILTER) g.filter = 'none';
  }
  function drawPalm(c, slices, backView, lw) {
    const near = slices[slices.length - 1];
    for (const s of slices) { smoothPath(c, s.pts); c.lineWidth = lw * 2; c.strokeStyle = LINE; c.stroke(); }
    for (const s of slices) {
      smoothPath(c, s.pts);
      if (s !== near) { c.fillStyle = SIDE; c.fill(); continue; }
      let mx = 0, my = 0, r = 0; s.pts.forEach(p => { mx += p[0]; my += p[1]; }); mx /= s.pts.length; my /= s.pts.length; s.pts.forEach(p => r = Math.max(r, hyp(p[0] - mx, p[1] - my)));
      const gr = c.createRadialGradient(mx + LX * r * .35, my + LY * r * .35, r * .05, mx, my, r * 1.1);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(.42, '#efedf5'); gr.addColorStop(.78, '#c8c1d9'); gr.addColorStop(1, '#9c93b5');
      c.fillStyle = gr; c.fill();
    }
    // details on the visible face: stitched seams on the back, creases on the palm
    const lz = near.lz, line = (pts, w, col) => { c.beginPath(); pts.forEach((p, i) => { const q = P3([p[0], p[1], lz]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }); c.lineWidth = w; c.strokeStyle = col; c.stroke(); };
    c.lineCap = 'round';
    if (lz > 0) {
      [[-.17, -.3, -.2, -.8], [.03, -.32, .02, -.84], [.22, -.3, .23, -.76]].forEach(([ax, ay, bx, by]) => {
        const seg = [[ax, ay], [(ax + bx) / 2 + .015, (ay + by) / 2], [bx, by]];
        line(seg, lw * 1.1, 'rgba(120,108,150,.55)'); line(seg.map(([x, y]) => [x + .028, y]), lw * .7, 'rgba(255,255,255,.75)');
      });
    } else {
      line([[-.36, -.62], [-.1, -.56], [.12, -.6], [.36, -.7]], lw * .9, 'rgba(120,108,150,.5)');
      line([[-.3, -.36], [-.05, -.42], [.18, -.5]], lw * .8, 'rgba(120,108,150,.42)');
    }
  }
  function drawCuff(a, b, c2, lw, x0, y0, pw, ph) {
    const c = cb; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, pw + 2, ph + 2); c.setTransform(dpr, 0, 0, dpr, -x0 * dpr, -y0 * dpr); c.lineJoin = 'round';
    const seg = (p, q, r0, r1) => { const ra = r0 * Sc * p[3], rb = r1 * Sc * q[3]; capPath(c, p[0], p[1], ra, q[0], q[1], rb); c.lineWidth = lw * 2; c.strokeStyle = LINE; c.stroke(); c.fillStyle = capFill(c, p[0], p[1], ra, q[0], q[1], rb); c.fill(); };
    seg(b, c2, .35, .47); seg(a, b, .31, .335);
    // rolled hem
    c.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24 * TAU, q = P3([Math.cos(t) * .345, .3, Math.sin(t) * .345]); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
    c.lineWidth = Sc * .085 + lw * 2; c.strokeStyle = LINE; c.stroke(); c.lineWidth = Sc * .085; c.strokeStyle = '#ebe8f3'; c.stroke();
    // fade the sleeve into nothing
    c.globalCompositeOperation = 'destination-in';
    const gr = c.createLinearGradient(b[0], b[1], c2[0], c2[1]); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.15, 'rgba(0,0,0,.95)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr; c.fillRect(x0 - 10, y0 - 10, pw / dpr + 20, ph / dpr + 20); c.globalCompositeOperation = 'source-over';
    hb.save(); hb.setTransform(1, 0, 0, 1, 0, 0); hb.drawImage(Cb, 0, 0, pw, ph, 0, 0, pw, ph); hb.restore();
  }

  // ---------------------------------------------------------------- Layers: weave between HUD layers by depth
  // deep: behind the wheel and the HUD. mid: over the wheel, under the HUD. front: over everything.
  // While a bonus game is open the glove always sits over its overlay: under it, the overlay's backdrop blur
  // samples stale canvas frames in Chromium and leaves ghost trails of the hand.
  function setLayer() {
    if (overlayOn()) { if (layer !== 'over') { layer = 'over'; cv.style.zIndex = 12; cv.dataset.layer = 'over'; } return; }
    const z = rig.z.x, h = .05, b1 = -.42, b2 = .02;
    let L = layer === 'over' ? 'front' : layer || 'front';
    if (L === 'deep') { if (z > b1 + h) L = z > b2 + h ? 'front' : 'mid'; }
    else if (L === 'mid') { if (z < b1 - h) L = 'deep'; else if (z > b2 + h) L = 'front'; }
    else if (z < b2 - h) L = z < b1 - h ? 'deep' : 'mid';
    const zi = L === 'deep' ? -1 : L === 'mid' ? 3 : 12;
    if (L + zi !== layer + cv.style.zIndex) { layer = L; cv.style.zIndex = zi; cv.dataset.layer = L; }
  }

  // ---------------------------------------------------------------- Frame loop
  function frame(ts) {
    requestAnimationFrame(frame);
    const t = ts / 1000, dt = Math.min(.05, Math.max(.001, t - (lastT || t))); lastT = t; T = t;
    const tn = now();
    for (let i = waits.length - 1; i >= 0; i--) {
      const w = waits[i]; if (w.each) w.each();
      if ((w.fn && w.fn()) || tn >= w.at) { waits.splice(i, 1); w.res(); }
    }
    director();
    motion(dt);
    procedural(dt);
    for (const s of SPRINGS) s.step(dt);
    if (rig.lock) { const p = rig.lock(); if (p) { rig.x.x = rig.x.t = p[0]; rig.y.x = rig.y.t = p[1]; } }
    render(); setLayer(); drawFx(dt);
  }
  let lockPrev = null, lockVel = [0, 0];
  function motion(dt) {
    if (rig.lock) {
      const p = [rig.x.x, rig.y.x];
      if (lockPrev) { const vx = (p[0] - lockPrev[0]) / dt, vy = (p[1] - lockPrev[1]) / dt; lockVel = [lockVel[0] * .5 + vx * .5, lockVel[1] * .5 + vy * .5]; }
      lockPrev = p; return;
    }
    lockPrev = null;
    if (!mv) return;
    const u = clamp((now() - mv.t0) / mv.dur, 0, 1), e = mv.ease(u), v = 1 - e;
    const bx = v * v * v * mv.x0 + 3 * v * v * e * mv.c1[0] + 3 * v * e * e * mv.c2[0] + e * e * e * mv.x;
    const by = v * v * v * mv.y0 + 3 * v * v * e * mv.c1[1] + 3 * v * e * e * mv.c2[1] + e * e * e * mv.y;
    rig.x.t = bx; rig.y.t = by;
    rig.z.t = lerp(mv.z0, mv.z1, E.sine(u)) + mv.zArc * Math.sin(PI * u);
    if (u >= 1) { const r = mv.res; mv = null; r(); }
  }
  function procedural(dt) {
    const hv = rig.hov.x, t = T, ag = st.agit, tr = rig.trem.x + Math.max(0, ag - .55) * .5;
    st.agit = lerp(st.agit, .25, dt * .04);
    off.x = (Math.sin(t * .83 + 1.3) * .6 + Math.sin(t * 1.91) * .4) * S0 * .07 * hv;
    off.y = (Math.sin(t * 1.27) * .7 + Math.sin(t * 2.3 + .4) * .3) * S0 * .09 * hv;
    off.z = Math.sin(t * .53) * .035 * hv;
    // banking into the motion and secondary drag on the fingers
    const vx = rig.x.v, vy = rig.y.v, spd = hyp(vx, vy);
    let roll = Math.sin(t * .71 + .5) * .05 * hv + clamp(vx / 2600, -.32, .32) * rig.bank;
    const fr = rig.roll.x, fx = Math.sin(fr), fy = -Math.cos(fr), along = clamp((vx * fx + vy * fy) / (S0 * 30), -1, 1);
    for (let i = 0; i < 4; i++) {
      const ph = t * 1.6 - i * .55;
      off.P[i * 4 + 1] = Math.sin(ph) * .05 * hv * breath - along * .28 * (1 - i * .08);
      off.P[i * 4 + 2] = Math.sin(ph - .5) * .045 * hv * breath - along * .16;
      off.P[i * 4 + 3] = Math.sin(ph - 1) * .03 * hv * breath;
    }
    off.P[18] = Math.sin(t * 1.3) * .04 * breath; off.P[16] = Math.sin(t * .9) * .03 * breath;
    if (tr > .01) {
      off.x += (Math.random() - .5) * tr * S0 * .05; off.y += (Math.random() - .5) * tr * S0 * .05; roll += (Math.random() - .5) * tr * .07;
      for (let i = 0; i < 20; i++) if (i % 4) off.P[i] += (Math.random() - .5) * tr * .14;
    }
    off.roll = roll;
    // random twitches: more when agitated
    if (!CALM && Math.random() < dt * (.12 + ag * 1.1)) { const i = Math.floor(Math.random() * 5); rig.P[i === 4 ? 18 : i * 4 + 1 + Math.floor(Math.random() * 2)].v += rnd(-7, 7) * (.5 + ag); }
    // speed lines on fast moves
    if (!CALM && spd > 1900 && Math.random() < .6) { const a = Math.atan2(vy, vx) + PI; burst(rig.x.x + rnd(-1, 1) * S0 * .6, rig.y.x - S0 * .8 + rnd(-1, 1) * S0 * .6, 'speed', a); }
  }

  // ---------------------------------------------------------------- Gesture helpers
  // Move to a stage spot showing a pose; `which` local point is aimed at screen angle `ang`.
  async function show(c, o) {
    c.over(!!o.over); c.pose(o.pose, o.pk || 120);
    const roll = c.aim(o.which || 'mid', o.ang ?? -PI / 2, o.yaw ?? 0, o.pitch ?? 0, o.ok || 90);
    const at = o.at || freshSpot(stageSpot), z = o.z ?? .45;
    const w = wristFor(tipOf(o.pose, 'mid'), at[0], at[1], roll, o.yaw ?? 0, o.pitch ?? 0, z);
    const p = o.path || pathPick();
    await c.go(w[0], w[1], { z, speed: o.speed || 950, path: p, ease: o.ease, k: o.k || 120 });
    return { roll, at, z };
  }
  async function bob(c, n, amp, ms, axis = [0, 1]) {
    const x = rig.x.t, y = rig.y.t;
    for (let i = 0; i < n; i++) {
      await c.go(x + axis[0] * amp, y + axis[1] * amp, { dur: ms, path: 'direct', ease: 'out', k: 400, bank: 0 });
      await c.go(x, y, { dur: ms * 1.1, path: 'direct', ease: 'cubic', k: 300, bank: 0 });
    }
  }
  async function rock(c, n, amp, ms, base) {
    for (let i = 0; i < n; i++) { c.orient(base + amp, null, null, 260); await c.wait(ms); c.orient(base - amp, null, null, 260); await c.wait(ms); }
    c.orient(base, null, null, 120);
  }
  // Fingertip taps on a rect
  async function tapAt(c, tx, ty, n = 2, o = {}) {
    c.over(!!o.over); c.pose('point', 180);
    const ang = o.ang ?? rnd(.2, .8) * PI, yaw = o.yaw ?? rnd(-.3, .4), pitch = o.pitch ?? -.35, z = o.z ?? .2;
    c.aim('index', ang, yaw, pitch, 140);
    const back = S0 * (o.back || .7), hx = tx - Math.cos(ang) * back, hy = ty - Math.sin(ang) * back;
    await c.goPt('index', hx, hy, { speed: o.speed || 1100, path: o.path || any(['arc', 's', 'swoop']), z });
    for (let i = 0; i < n; i++) {
      await c.goPt('index', tx, ty, { dur: rnd(70, 110), ease: 'in', k: 900, path: 'direct', bank: 0, z });
      c.burst(tx, ty, 'tap', o.p || 1);
      await c.goPt('index', hx, hy, { dur: rnd(120, 190), ease: 'out', k: 500, path: 'direct', bank: 0, z });
      if (i < n - 1) await c.wait(rnd(30, 160));
    }
  }
  async function tapEl(c, name, n, o) { const r = pickEl(name); if (!r) return false; await tapAt(c, r.left + r.width * rnd(.3, .7), r.top + r.height * rnd(.3, .65), n, o); return true; }
  async function pointAt(c, tx, ty, o = {}) {
    c.over(!!o.over); c.pose('point', 140);
    const from = o.from ?? Math.atan2(ty - rig.y.x, tx - rig.x.x) + rnd(-.6, .6), dist = S0 * (o.dist || rnd(1.6, 2.6));
    const yaw = o.yaw ?? rnd(-.4, .4), pitch = o.pitch ?? rnd(-.2, .25), z = o.z ?? .35;
    c.aim('index', from, yaw, pitch, 110);
    await c.goPt('index', tx - Math.cos(from) * dist, ty - Math.sin(from) * dist, { speed: o.speed || 1000, path: pathPick(), z });
    if (o.jab) for (let i = 0; i < o.jab; i++) {
      const p = [tx - Math.cos(from) * dist * .65, ty - Math.sin(from) * dist * .65];
      await c.goPt('index', p[0], p[1], { dur: 110, path: 'direct', ease: 'out', k: 600, bank: 0, z });
      await c.goPt('index', tx - Math.cos(from) * dist, ty - Math.sin(from) * dist, { dur: 160, path: 'direct', k: 400, bank: 0, z });
    }
  }
  async function punch(c, tx, ty, o = {}) {
    c.over(!!o.over); c.pose('fist', 260); st.agit = Math.min(1, st.agit + .15);
    const p = o.p ?? rnd(.7, 1.2), from = o.from ?? Math.atan2(ty - rig.y.x, tx - rig.x.x) + rnd(-.5, .5), z = o.z ?? .45;
    const yaw = o.yaw ?? any([0, .5, -.5, PI * .85]), pitch = rnd(-.25, .2);
    c.aim('knuck', from, yaw, pitch, 180);
    // rear back, shake, strike, recoil
    const back = S0 * rnd(1.8, 2.6) * p;
    await c.goPt('knuck', tx - Math.cos(from) * back, ty - Math.sin(from) * back, { speed: 1300, path: any(['arc', 's', 'swoop']), z: z + .2, ease: 'cubic' });
    c.trem(.6 * p); await c.wait(rnd(120, 320)); c.trem(0);
    c.scale(1.08, 300);
    await c.goPt('knuck', tx, ty, { dur: rnd(90, 140), path: 'direct', ease: 'in', k: 1100, damp: .7, bank: 0, z });
    c.burst(tx, ty, 'impact', p); c.scale(.94, 500);
    await c.goPt('knuck', tx - Math.cos(from) * S0 * .55, ty - Math.sin(from) * S0 * .55, { dur: 190, path: 'direct', ease: 'out', k: 500, bank: 0, z });
    c.scale(1, 120); c.soft();
  }
  function screenTargets() {
    const out = []; ['go', 'coins', 'tickets', 'hist', 'say', 'buttons', 'people', 'medal'].forEach(n => { const r = pickEl(n); if (r) out.push([n, r]); }); return out;
  }
  const centerOf = r => [r.left + r.width * rnd(.35, .65), r.top + r.height * rnd(.35, .65)];
  function wheelPt(rf = rnd(.3, .85), ang = rnd(0, TAU)) { const w = wheel(); return w ? [w.x + Math.cos(ang) * w.r * rf, w.y + Math.sin(ang) * w.r * rf] : null; }
  const towardViewer = () => [W * rnd(.32, .68), Hh * rnd(.28, .5)];

  // ---------------------------------------------------------------- Gestures and reactions
  const R = {
    async thumbsUp(c, d = {}) {
      const yaw = PI + rnd(-.7, .7) * sgn();
      await show(c, { pose: 'thumb', which: 'thumb', ang: -PI / 2 + rnd(-.25, .25), yaw, pitch: rnd(-.2, .25), z: rnd(.45, .8), over: d.over, speed: 1100 });
      await bob(c, 1 + Math.floor(rnd(0, 3)), -S0 * rnd(.25, .45), rnd(110, 170));
      if (chance(.4)) { c.scale(1.15, 200); await c.wait(220); c.scale(1, 120); }
      await c.wait(rnd(350, 700));
    },
    async thumbsDown(c, d = {}) {
      const yaw = PI + rnd(-.6, .6);
      await show(c, { pose: 'thumb', which: 'thumb', ang: -PI / 2, yaw, pitch: 0, z: rnd(.5, .8), over: d.over, speed: 900 });
      await c.wait(rnd(150, 350));
      // slow arena turn from up to down
      const r0 = rig.roll.t; await c.tween(rnd(700, 1100), u => rig.roll.to(r0 + PI * u, 140), E.cubic);
      await bob(c, 2, S0 * .35, 150);
      await c.wait(rnd(300, 600));
    },
    async wag(c, d = {}) {
      await show(c, { pose: 'point', which: 'index', ang: -PI / 2, yaw: any([0, PI]) + rnd(-.3, .3), pitch: .1, z: .55, over: d.over });
      await rock(c, 3 + Math.floor(rnd(0, 3)), rnd(.22, .34), rnd(130, 180), rig.roll.t);
      await c.wait(250);
    },
    async pointPlayer(c, d = {}) {
      c.pose('point', 150); c.over(!!d.over);
      const at = towardViewer(), yaw = rnd(-.35, .35), pitch = rnd(1.05, 1.3), roll = rnd(-.5, .5);
      c.orient(roll, yaw, pitch, 90);
      const w = wristFor(tipOf('point', 'mid'), at[0], at[1], roll, yaw, pitch, .8);
      await c.go(w[0], w[1], { z: .8, speed: 900, path: pathPick() });
      for (let i = 0; i < (d.jabs || 2); i++) { c.depth(1.05, 300); c.scale(1.1, 400); await c.wait(140); c.depth(.8, 200); c.scale(1, 200); await c.wait(200); }
      await c.wait(rnd(250, 500));
    },
    async laughPoint(c, d) {
      await R.pointPlayer(c, { jabs: 1, ...d });
      c.trem(.2); const y = rig.y.t;
      for (let i = 0; i < 7; i++) { await c.go(rig.x.t, y + (i % 2 ? -1 : 1) * S0 * .16, { dur: 85, path: 'direct', k: 800, bank: 0 }); }
      c.trem(0); await c.wait(300);
    },
    async fingerGuns(c, d = {}) {
      c.pose('gun', 160); c.over(!!d.over);
      const at = towardViewer(), yaw = rnd(.3, .7) * sgn(), pitch = rnd(.9, 1.15), roll = rnd(-.4, .2);
      c.orient(roll, yaw, pitch, 90);
      const w = wristFor(tipOf('gun', 'mid'), at[0], at[1], roll, yaw, pitch, .7);
      await c.go(w[0], w[1], { z: .7, speed: 1000, path: pathPick() });
      for (let i = 0; i < 1 + Math.floor(rnd(1, 3)); i++) {
        c.thumb([1.3, .9, null, null], 900); await c.wait(70);
        const tp = c.tip('index'); c.burst(tp[0], tp[1], 'snap', .8);
        c.orient(null, null, pitch - .55, 600); c.depth(.55, 300); await c.wait(130);
        c.thumb([1.3, 0], 300); c.orient(null, null, pitch, 200); c.depth(.7, 100); await c.wait(rnd(180, 300));
      }
      // blow the smoke off
      c.orient(rig.roll.t - .5, null, .2, 80); await c.go(rig.x.t, rig.y.t - S0 * .6, { dur: 400, path: 'arc' }); await c.wait(300);
    },
    async ok(c, d = {}) {
      await show(c, { pose: 'ok', which: 'middle', ang: -PI / 2 + rnd(-.3, .3), yaw: PI + rnd(-.3, .3), pitch: rnd(-.1, .2), z: .55, over: d.over });
      await bob(c, 2, S0 * .12, 120, [1, 0]); await c.wait(rnd(400, 700));
    },
    async fistPump(c, d = {}) {
      await show(c, { pose: 'fist', which: 'knuck', ang: -PI / 2, yaw: rnd(1, 1.4) * sgn(), pitch: 0, z: .55, over: d.over, speed: 1200 });
      const n = 2 + Math.floor(rnd(0, 3)); st.agit = Math.min(1, st.agit + .1);
      for (let i = 0; i < n; i++) { await c.go(rig.x.t, rig.y.t - S0 * .7, { dur: 110, path: 'direct', ease: 'out', k: 700, bank: 0 }); c.scale(1.1, 500); await c.go(rig.x.t, rig.y.t + S0 * .7, { dur: 150, path: 'direct', k: 400, bank: 0 }); c.scale(1, 200); }
      await c.wait(300);
    },
    async jazz(c, d = {}) {
      await show(c, { pose: 'splay', which: 'middle', ang: -PI / 2 + rnd(-.4, .4), yaw: PI + rnd(-.2, .2), pitch: .2, z: .7, over: d.over, speed: 1300 });
      c.trem(1.4); c.scale(1.08, 200);
      const r0 = rig.roll.t; await c.tween(rnd(900, 1300), u => rig.roll.to(r0 + Math.sin(u * TAU * 5) * .18, 500), E.lin);
      c.trem(0); c.scale(1, 100); await c.wait(250);
    },
    async shrug(c, d = {}) {
      await show(c, { pose: 'open', which: 'mid', ang: -PI / 2 + rnd(-.6, .6), yaw: PI, pitch: -rnd(.9, 1.2), z: .45, over: d.over });
      await bob(c, 1, -S0 * .45, 200);
      await rock(c, 2, .16, 220, rig.roll.t); await c.wait(rnd(200, 500));
    },
    async beckon(c, d = {}) {
      await show(c, { pose: 'point', which: 'mid', ang: -PI / 2 - rnd(.1, .5), yaw: PI + rnd(-.3, .3), pitch: -rnd(.5, .9), z: .5, over: d.over, speed: 700 });
      const all = chance(.35);
      for (let i = 0; i < 3 + Math.floor(rnd(0, 3)); i++) {
        if (all) for (let f = 0; f < 4; f++) c.finger(f, [1.2, 1.5, .9], 260); else c.finger(0, [1.1, 1.5, 1.0], 280);
        await c.wait(rnd(180, 240));
        if (all) for (let f = 0; f < 4; f++) c.finger(f, [.05, .05, .03], 220); else c.finger(0, [.02, .04, .02], 220);
        await c.wait(rnd(200, 260));
      }
    },
    async wave(c, d = {}) {
      await show(c, { pose: 'open', which: 'middle', ang: -PI / 2, yaw: PI + rnd(-.25, .25), pitch: rnd(0, .2), z: .5, over: d.over });
      await rock(c, 3, rnd(.25, .4), rnd(170, 230), rig.roll.t); await c.wait(200);
    },
    async snapPoint(c, d = {}) {
      await show(c, { pose: 'snap', which: 'mid', ang: -PI / 2 + rnd(-.3, .3), yaw: rnd(.5, 1) * sgn(), pitch: .1, z: .5, over: d.over });
      c.trem(.3); await c.wait(rnd(250, 450)); c.trem(0);
      c.finger(1, [1.55, 1.75, 1.0], 1600); c.thumb([.95, .15, -.1, 0], 1600);
      await c.wait(40); const tp = c.tip('thumb'); c.burst(tp[0], tp[1], 'snap', 1.1);
      await c.wait(200);
      const r = d.target ? d.target : pickEl(d.el || 'tickets') || pickEl('table');
      if (r) await pointAt(c, ...centerOf(r), { over: d.over, jab: 1 }); else await c.wait(400);
    },
    async rubMoney(c, d = {}) {
      await show(c, { pose: 'rub', which: 'tips', ang: -PI / 2 + rnd(-.4, .4), yaw: PI * rnd(.7, .9) * sgn(), pitch: .15, z: .5, over: d.over });
      const n = 8 + Math.floor(rnd(0, 6));
      for (let i = 0; i < n; i++) { c.thumb([i % 2 ? .45 : .8, .95], 700); await c.wait(70); }
      await c.wait(200);
    },
    async patWin(c) {
      const r = pickEl('win') || pickEl('bal') || pickEl('say'); if (!r) return R.thumbsUp(c);
      const [tx, ty] = [r.left + r.width / 2, r.top + r.height * .4];
      c.pose('flat', 120); c.aim('palm', PI / 2 + rnd(-.3, .3), 0, -.95, 90);
      await c.goPt('palm', tx, ty - S0 * .5, { speed: 900, z: .15, path: pathPick() });
      for (let i = 0; i < 3; i++) { await c.goPt('palm', tx, ty, { dur: 90, ease: 'in', k: 900, path: 'direct', bank: 0 }); c.burst(tx, ty, 'tap', 1.3); await c.goPt('palm', tx, ty - S0 * .45, { dur: 150, ease: 'out', k: 500, path: 'direct', bank: 0 }); }
    },
    async presentTable(c) {
      const r = pickEl('table'); if (!r) return R.wave(c);
      const side = sgn(), y = r.top - S0 * rnd(1, 1.8), x0 = W / 2 - side * W * .32, x1 = W / 2 + side * W * rnd(.05, .25);
      c.pose('open', 90); c.orient(side > 0 ? -PI * .3 : PI * .3, PI, -.85, 60);
      await c.goPt('mid', x0, y - S0, { speed: 800, z: .4, path: 'arc' });
      await c.goPt('mid', x1, y, { dur: 1300, path: 'arc', bend: .3, side: -1, z: .55, ease: 'cubic' });
      c.orient(rig.roll.t + side * .3, null, -1.1, 60); await c.wait(rnd(400, 700));
    },
    async drum(c, d = {}) {
      const r = d.r || pickEl(any(['say', 'table', 'hist'])) || pickEl('table'); if (!r) return;
      const tx = r.left + r.width * rnd(.25, .75), ty = r.top + 2;
      c.over(!!d.over); c.pose('relax', 100); c.aim('tips', PI / 2, rnd(-.15, .15), -.8, 90);
      await c.goPt('tips', tx, ty, { speed: d.fast ? 1400 : 800, z: .15, path: pathPick() });
      c.hov(.25);
      const reps = d.reps || 3 + Math.floor(rnd(0, 4)), sp = d.fast ? 40 : rnd(60, 95);
      for (let k = 0; k < reps; k++) for (const f of [3, 2, 1, 0]) {
        c.finger(f, [.95, .6, .3], 900); await c.wait(sp); c.finger(f, [.22, .3, .16], 500);
        if (f === 0 && chance(.5)) { const tp = c.tip('index'); c.burst(tp[0], tp[1], 'tap', .5); }
      }
      c.hov(1); await c.wait(sp * 3); c.pose('relax', 100);
    },
    async drumroll(c, d) { await R.drum(c, { fast: true, reps: 7 + Math.floor(rnd(0, 4)), r: pickEl('say') || pickEl('box'), ...d }); },
    async punchEl(c, d = {}) {
      const list = screenTargets(); const t = d.r ? ['x', d.r] : list.length ? any(list) : null;
      if (!t) return R.punchAir(c);
      await punch(c, ...centerOf(t[1]), { over: d.over });
      if (chance(.35)) await punch(c, ...centerOf(t[1]), { over: d.over, p: rnd(.8, 1.3) });
      await c.wait(200);
    },
    async punchWheel(c) { const p = wheelPt(rnd(.4, .9)); if (!p) return R.punchEl(c); await punch(c, p[0], p[1], { p: rnd(1, 1.4), z: .3 }); await c.wait(250); },
    async punchHud(c) { const r = pickEl(any(['say', 'hist', 'go', 'clock', 'people'])); return r ? R.punchEl(c, { r }) : R.punchAir(c); },
    async punchAir(c, d = {}) { const n = 1 + Math.floor(rnd(0, 3)); for (let i = 0; i < n; i++) { const p = freshSpot(anySpot); await punch(c, p[0], p[1], { p: rnd(.6, 1), over: d.over }); } },
    async palmNo(c, d = {}) {
      await show(c, { pose: 'flat', which: 'middle', ang: -PI / 2, yaw: PI, pitch: .1, z: .5, over: d.over });
      const x = rig.x.t; for (let i = 0; i < 4; i++) await c.go(x + (i % 2 ? -1 : 1) * S0 * .5, rig.y.t, { dur: 160, path: 'direct', k: 400, bank: 1.2 });
      await c.go(x, rig.y.t, { dur: 160, path: 'direct' });
    },
    async pointWheel(c) { const w = wheel(); if (!w) return R.thumbsUp(c); await pointAt(c, w.x, w.y - w.r * .8, { jab: 1 + Math.floor(rnd(0, 2)), dist: rnd(2, 3) }); await c.wait(300); },
    async pointPeople(c) { const r = pickEl('people'); if (!r) return R.wave(c); await tapAt(c, ...centerOf(r), 2, { ang: rnd(-.8, -.2) * PI }); },
    async pointHit(c) { const r = pickEl('hit'); if (!r) return R.pointWheel(c); await pointAt(c, ...centerOf(r), { jab: 2 }); },
    async tapTickets(c) { if (!(await tapEl(c, 'tickets', 2 + Math.floor(rnd(0, 2))))) await R.beckon(c); if (chance(.5)) await tapEl(c, 'tickets', 1); },
    async tapClock(c) { if (!(await tapEl(c, 'clock', 3, { ang: rnd(.3, .7) * PI }))) await R.drum(c); },
    async nodTap(c, d = {}) { if (d.el) { const r = visRect(d.el); if (r) return tapAt(c, ...centerOf(r), 1, { ang: rnd(.25, .75) * PI }); } return tapEl(c, 'lit', 1); },
    async quickThumb(c) { await show(c, { pose: 'thumb', which: 'thumb', ang: -PI / 2, yaw: PI + rnd(-.6, .6), pitch: .1, z: .4, speed: 1300 }); await bob(c, 1, -S0 * .3, 110); await c.wait(250); },
    async quickOk(c) { await show(c, { pose: 'ok', which: 'middle', ang: -PI / 2, yaw: PI, pitch: .1, z: .4, speed: 1300 }); await c.wait(500); },
    async peace(c, d = {}) { await show(c, { pose: 'peace', which: 'middle', ang: -PI / 2 + rnd(-.3, .3), yaw: any([0, PI]), pitch: .1, z: .5, over: d.over }); await bob(c, 1, -S0 * .2, 140); await c.wait(500); },
    async countUp(c) { await show(c, { pose: 'n1', which: 'middle', ang: -PI / 2, yaw: PI, pitch: 0, z: .5 }); for (let n = 1; n <= 5; n++) { c.pose('n' + n, 260); c.scale(1.08, 400); await c.wait(150); c.scale(1, 200); await c.wait(140); } await c.wait(300); },
    // ---- middle finger: explicit, held, many deliveries
    async middleSlow(c) {
      c.over(true); c.pose('fist', 120);
      const at = [W * rnd(.35, .65), Hh * rnd(.35, .5)]; c.orient(rnd(-.15, .15), rnd(-.25, .25), .3, 60);
      const w = wristFor(tipOf('middle', 'mid'), at[0], at[1], rig.roll.t, rig.yaw.t, .3, .7);
      rig.x.x = rig.x.t = w[0]; rig.y.x = rig.y.t = Hh + S0 * 3;
      await c.go(w[0], w[1], { dur: 1100, path: 'direct', z: .7, ease: 'cubic' });
      setFinger(1, [0, .03, .02], 18); await c.wait(1300);
      c.depth(.98, 40); c.scale(1.08, 60); await c.wait(900); c.depth(.7, 60); c.scale(1, 60); await c.wait(500);
    },
    async middleJab(c) {
      c.over(true); c.pose('middle', 400);
      const at = towardViewer(); c.aim('middle', -PI / 2 + rnd(-.2, .2), rnd(-.3, .3), .35, 200);
      await c.goPt('mid', at[0], at[1], { speed: 1800, path: any(['direct', 'lurch', 'swoop']), z: .65 });
      for (let i = 0; i < 3; i++) { c.depth(1.05, 500); c.scale(1.12, 600); await c.wait(120); const tp = c.tip('middle'); c.burst(tp[0], tp[1], 'tap', 1.2); c.depth(.65, 300); c.scale(1, 300); await c.wait(220); }
      await c.wait(900);
    },
    async middleTurn(c) {
      c.over(true); c.pose('middle', 200);
      const at = towardViewer(); c.orient(rnd(-.2, .2), PI, .2, 80);
      await c.goPt('mid', at[0], at[1], { speed: 1000, path: pathPick(), z: .6 });
      await c.wait(250); c.orient(null, rnd(-.15, .15), .35, 30); await c.wait(1100);
      await rock(c, 2, .08, 260, rig.roll.t); await c.wait(500);
    },
    async middleRise(c) {
      c.over(true); c.pose('middle', 300);
      const x = W * rnd(.25, .75), roll = rnd(-.15, .15); c.orient(roll, rnd(-.2, .2), .15, 200);
      const w = wristFor(tipOf('middle', 'middle'), x, Hh - S0 * 1.2, roll, rig.yaw.t, .15, .5);
      rig.x.x = rig.x.t = w[0]; rig.y.x = rig.y.t = Hh + S0 * 4; rig.z.x = rig.z.t = .5;
      await c.go(w[0], w[1], { dur: 2200, path: 'direct', ease: 'lurch', z: .5 });
      c.trem(.25); await c.wait(1200); c.trem(0);
      await c.go(w[0], Hh + S0 * 4, { dur: 600, path: 'direct', ease: 'in' });
    },
    async middleDouble(c) {
      c.over(true);
      for (let k = 0; k < 2; k++) {
        c.pose('fist', 300); const at = freshSpot(stageSpot); c.aim('middle', -PI / 2 + rnd(-.3, .3), rnd(-.3, .3), .3, 200);
        await c.goPt('mid', at[0], at[1], { speed: 1600, path: any(['arc', 'swoop']), z: .6 });
        c.pose('middle', 900); c.scale(1.12, 600); await c.wait(160); c.scale(1, 200); await c.wait(rnd(700, 900));
      }
    },
    // ---- big win extras
    async conductBow(c) {
      await show(c, { pose: 'open', which: 'mid', ang: -PI / 2, yaw: PI * .9, pitch: -.4, z: .5 });
      const x = rig.x.t, y = rig.y.t;
      await c.go(x + S0 * 1.4, y - S0 * .8, { dur: 500, path: 'arc' }); await c.go(x - S0 * 1.2, y + S0 * .4, { dur: 700, path: 'arc', side: 1 });
      c.pose('limp', 80); c.orient(rig.roll.t + .9, null, -.6, 50); await c.go(x, y + S0, { dur: 700, path: 'arc' }); await c.wait(700);
    },
  };

  // ---------------------------------------------------------------- Idle library (moving but idle)
  const IDLE = {
    async drift(c) {
      const poses = ['relax', 'open', 'limp', 'claw', 'relax'];
      for (let i = 0; i < 1 + Math.floor(rnd(1, 3)); i++) {
        c.over(false); c.pose(pick('dpose', poses), 40);
        c.orient(rnd(-.6, .6), pick('dyaw', [['0', 2], ['pi', 1], ['side', 1]]) === 'pi' ? PI + rnd(-.3, .3) : rnd(-.9, .9), rnd(-.4, .4), 25);
        const p = freshSpot(anySpot); await c.goPt('mid', p[0], p[1], { speed: rnd(180, 320), z: rnd(-.25, .45), path: pathPick(1) });
        await c.wait(rnd(300, 1400));
      }
    },
    async prowl(c) {
      c.pose(any(['claw', 'relax', 'limp']), 60); c.orient(rnd(-.4, .4), rnd(-.5, .5), rnd(-.3, .2), 40);
      for (let i = 0; i < 2; i++) {
        const p = freshSpot(anySpot); await c.goPt('mid', p[0], p[1], { speed: rnd(260, 420), path: 'dive', zArc: -rnd(1, 1.5), z: i ? rnd(.1, .5) : rnd(-.3, .1) });
        await c.wait(rnd(200, 700));
      }
    },
    async creep(c) {
      const r = pickEl('table'); if (!r) return IDLE.drift(c);
      const dir = sgn(), y = r.top - 4, xa = W / 2 - dir * W * rnd(.2, .4), xb = W / 2 + dir * W * rnd(.1, .38);
      c.pose('claw', 80); c.aim('tips', PI / 2 + dir * .25, rnd(-.2, .2), -.9, 60);
      await c.goPt('tips', xa, y, { speed: 700, z: .1, path: 'dive', zArc: -1.1 });
      c.hov(.15); c.breath(0);
      const d0 = now(), dur = Math.abs(xb - xa) / rnd(60, 110) * 1000;
      const walk = c.go(rig.x.t + (xb - xa), rig.y.t, { dur, path: 'direct', ease: 'lin', bank: 0 });
      c.tween(dur, () => { const ph = (now() - d0) / 1000 * 7; for (let f = 0; f < 4; f++) setFinger(f, [.55 + Math.sin(ph + f * PI / 2) * .45, .9 + Math.sin(ph + f * PI / 2 + 1) * .35, .7], 500); off.y += Math.abs(Math.sin(ph)) * -S0 * .08; }, E.lin).catch(() => {});
      await walk; c.hov(1); c.breath(1); c.pose('relax', 80);
    },
    async peek(c) {
      const r = pickEl('table'); if (!r) return IDLE.prowl(c);
      const x = W * rnd(.12, .88), roll = rnd(-.3, .3);
      c.pose('claw', 60); c.orient(roll, rnd(-.2, .2), rnd(-.2, .2), 40);
      // dive under the table, then rise behind its top edge
      const hide = wristFor(tipOf('claw', 'tips'), x, r.top + S0 * 1.4, roll, rig.yaw.t, rig.pitch.t, -.2);
      await c.go(hide[0], hide[1], { speed: 520, path: 'dive', zArc: -1.2, z: -.2 });
      const up = wristFor(tipOf('claw', 'tips'), x, r.top - S0 * rnd(.4, .9), roll, rig.yaw.t, rig.pitch.t, -.2);
      await c.go(up[0], up[1], { dur: rnd(900, 1500), path: 'direct', ease: 'lurch', z: -.2 });
      for (let i = 0; i < 3; i++) { for (let f = 0; f < 4; f++) setFinger(f, [rnd(.3, .9), rnd(.6, 1.2), .8], 200); await c.wait(rnd(200, 450)); }
      await c.go(hide[0], hide[1], { dur: 380, path: 'direct', ease: 'in', z: -.25 });
      await c.wait(rnd(300, 800));
    },
    async drum(c) { await R.drum(c); await c.wait(rnd(200, 600)); },
    async flex(c) {
      await show(c, { pose: 'splay', which: 'middle', ang: -PI / 2 + rnd(-.3, .3), yaw: PI + rnd(-.3, .3), pitch: 0, z: .35, speed: 600 });
      await c.wait(300); c.pose('fist', 160); await c.wait(380); c.pose('open', 140); await c.wait(300);
      for (const f of pick('crack', ['0123', '3210', '1302', '2031']).split('').map(Number)) {
        c.finger(f, [-.5, .1, .1], 900); await c.wait(90); const p = c.tip('tips'); c.burst(p[0] + rnd(-20, 20), p[1], 'crack', .8); await c.wait(90); c.finger(f, [.1, .1, .05], 200); await c.wait(rnd(100, 220));
      }
    },
    async knock(c) {
      c.over(false); c.pose('fist', 140); c.orient(rnd(-.4, .4), rnd(-.2, .2), rnd(.5, .7), 70);
      const at = freshSpot(stageSpot); await c.goPt('mid', at[0], at[1], { speed: 700, z: .8, path: pathPick() });
      for (let i = 0; i < 2 + Math.floor(rnd(0, 2)); i++) {
        c.depth(1.12, 600); c.scale(1.06, 600); await c.wait(110);
        const p = c.screenOf(tipOf('fist', 'knuck')); c.burst(p[0], p[1], 'knock', 1);
        c.depth(.8, 300); c.scale(1, 300); await c.wait(rnd(170, 300));
      }
      await c.wait(400);
    },
    async inspect(c) {
      const name = pick('inspect', ['coins', 'tickets', 'hist', 'people', 'go', 'medal', 'say']);
      const r = pickEl(name); if (!r) return IDLE.drift(c);
      const [tx, ty] = centerOf(r);
      await pointAt(c, tx, ty, { dist: rnd(2.2, 3.2), speed: 450, z: .25 });
      c.trem(.12); await c.wait(rnd(500, 1000)); c.trem(0);
      if (chance(.7)) await tapAt(c, tx, ty, 1 + Math.floor(rnd(0, 3)), { p: .8 });
    },
    async orbit(c) {
      const w = wheel(); if (!w) return IDLE.drift(c);
      c.pose('point', 100); const dir = sgn(), a0 = rnd(0, TAU), span = rnd(1.4, 2.6) * dir, rr = rnd(1.05, 1.3), z = rnd(-.35, -.1);
      const pt = a => { const w2 = wheel() || w; return [w2.x + Math.cos(a) * w2.r * rr, w2.y + Math.sin(a) * w2.r * rr]; };
      c.aim('index', a0 + PI, rnd(-.3, .3), -.2, 60);
      await c.goPt('index', ...pt(a0), { speed: 600, z, path: 'dive' });
      await c.tween(Math.abs(span) * 1500, u => { const a = a0 + span * u, p = pt(a); rig.roll.toA(solveRoll(tipOf('point', 'index'), a + PI, rig.yaw.t, rig.pitch.t), 60); const wr = wristFor(tipOf('point', 'index'), p[0], p[1], rig.roll.t, rig.yaw.t, rig.pitch.t, z); rig.x.t = wr[0]; rig.y.t = wr[1]; }, E.sine);
    },
    async loom(c) {
      c.over(false); c.pose('splay', 50); c.orient(rnd(-.3, .3), PI + rnd(-.4, .4), rnd(-.1, .3), 30);
      const at = towardViewer(); await c.goPt('mid', at[0], at[1], { dur: rnd(1800, 2600), path: 'direct', ease: 'sine', z: 1.05 });
      c.trem(.35);
      for (const f of [3, 2, 1, 0]) { c.finger(f, [.9, 1.3, 1.0], 25); await c.wait(rnd(250, 450)); }
      c.thumb([.7, .9, .5, .6], 25); await c.wait(500); c.trem(0);
      const p = freshSpot(anySpot); await c.goPt('mid', p[0], p[1], { dur: 420, path: 'direct', ease: 'out', z: -.85, k: 300 });
      await c.wait(rnd(400, 900));
    },
    async shadowbox(c) { await R.punchAir(c); },
    async count(c) { await R.countUp(c); },
    async conduct(c) {
      c.pose(any(['point', 'relax', 'pinch']), 70);
      const at = freshSpot(stageSpot), s = S0 * rnd(.8, 1.3), yaw = rnd(-.3, .3);
      c.orient(rnd(-.3, .3), yaw, rnd(-.3, 0), 50);
      await c.goPt('mid', at[0], at[1], { speed: 500, z: .35, path: pathPick(1) });
      const beats = [[0, 1.2], [-1, .3], [1.1, .3], [0, -1]];
      for (let bar = 0; bar < 2; bar++) for (const [bx, by] of beats) {
        c.orient(bx * .35 + rnd(-.1, .1), null, null, 70);
        await c.goPt('mid', at[0] + bx * s, at[1] + by * s * .8, { dur: rnd(320, 420), path: 'arc', bend: .25, side: bx >= 0 ? 1 : -1, z: .35, bank: .4 });
      }
    },
    async twiddle(c) {
      c.pose('fist', 80); c.thumb([1.0, .35, 0, .1], 80);
      const at = freshSpot(anySpot); c.orient(rnd(-.5, .5), PI * rnd(.6, .95) * sgn(), rnd(-.2, .2), 40);
      await c.goPt('mid', at[0], at[1], { speed: 300, z: rnd(-.2, .3), path: pathPick(1) });
      const t0 = now(); await c.tween(rnd(2000, 3500), () => { const ph = (now() - t0) / 1000 * 5.5; setThumb([.85 + Math.cos(ph) * .3, .45 + Math.sin(ph) * .3], 300); }, E.lin);
    },
    async rest(c) {
      const r = pickEl(any(['say', 'go', 'hist'])) || pickEl('table'); if (!r) return IDLE.drift(c);
      c.pose('limp', 60); c.aim('tips', PI / 2 + rnd(-.3, .3), rnd(-.2, .2), -.6, 50);
      await c.goPt('tips', r.left + r.width * rnd(.2, .8), r.top + S0 * .15, { speed: 420, z: .15, path: pathPick(1) });
      c.hov(.3);
      for (let i = 0; i < 3 + Math.floor(rnd(0, 3)); i++) { await c.wait(rnd(300, 800)); const f = Math.floor(rnd(0, 4)); c.finger(f, [1.0, .8, .4], 500); await c.wait(110); c.finger(f, [.5, .6, .4], 200); }
      c.hov(1);
    },
    async weave(c) {
      // over the header, under the table, back over: a figure through the HUD
      c.pose(any(['relax', 'claw', 'open']), 60); c.orient(rnd(-.5, .5), rnd(-.6, .6), 0, 40);
      const top = pickEl('header'), tb = pickEl('table');
      const a = [W * rnd(.1, .3), top ? top.bottom + S0 * .2 : Hh * .15], b = [W * rnd(.4, .6), tb ? tb.top + S0 * .8 : Hh * .8], d = [W * rnd(.7, .9), Hh * rnd(.3, .5)];
      if (chance(.5)) { a[0] = W - a[0]; d[0] = W - d[0]; }
      await c.goPt('mid', a[0], a[1], { speed: 500, z: .6, path: pathPick() });
      await c.goPt('mid', b[0], b[1], { speed: 420, z: -.75, path: 'arc' });
      await c.goPt('mid', d[0], d[1], { speed: 520, z: .55, path: 's' });
    },
  };
  const IDLE_W = { drift: 1.4, prowl: 1, creep: .8, peek: .9, drum: 1, flex: .8, knock: .5, inspect: 1.1, orbit: .8, loom: .45, shadowbox: .55, count: .35, conduct: 1, twiddle: .9, rest: .8, weave: .9 };
  const AGIT = { shadowbox: 2, loom: 1.4, creep: 1.3, knock: 1.2, peek: 1.2 };
  const CALM_IDLE = ['drift', 'twiddle', 'conduct', 'rest'];

  // Roaming while a bonus game runs: over the overlay, circling the game box. Fingers reach in from outside,
  // the cuff points away, so the play area stays mostly free. No teleports: every move is a spring path.
  const ROAM_SC = .78;
  function boxRect() { const e = $('#bonus.on #box'); if (!e) return null; const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 40 ? r : null; }
  // Point on the box frame. side 0 top, 1 right, 2 bottom, 3 left. `out` > 0 sits outside, < 0 inside.
  function rimPt(r, side, u, out) {
    const ins = S0 * .35, cl = (x, y) => [clamp(x, ins, W - ins), clamp(y, ins, Hh - ins)];
    const p = [[r.left + r.width * u, r.top], [r.right, r.top + r.height * u], [r.left + r.width * u, r.bottom], [r.left, r.top + r.height * u]][side];
    const n = [[0, -1], [1, 0], [0, 1], [-1, 0]][side];
    // room outside this side: if there is none, hug the edge from the inside
    const room = [r.top, W - r.right, Hh - r.bottom, r.left][side];
    const o = out > 0 ? Math.min(out, Math.max(0, room - S0 * .3)) : out;
    return { p: cl(p[0] + n[0] * o, p[1] + n[1] * o), ang: Math.atan2(-n[1], -n[0]), n, room };
  }
  // Prefer sides with space around them, avoid repeating the same spot.
  function rimPick(r, out) {
    const rooms = [r.top, W - r.right, Hh - r.bottom, r.left];
    const side = +pick('rimSide', [0, 1, 2, 3].map(s => [String(s), .35 + clamp(rooms[s] / (S0 * 2), 0, 1.6)]), 3);
    const cand = [], p = freshSpot(() => { const q = rimPt(r, side, rnd(.1, .9), out); cand.push(q); return q.p; }, 6);
    return cand.find(q => q.p === p) || cand[0];
  }
  function boxTargets() {
    return [...document.querySelectorAll('#bonus.on #box button, #bonus.on #box .cell, #bonus.on #box .side, #bonus.on #box td, #bonus.on #box [data-i]')].map(visRect).filter(Boolean);
  }
  // Does segment a-b cross the box (shrunk so edge hugging spots do not count)? Liang-Barsky clip.
  function crosses(a, b, r) {
    const ins = S0 * .45, L = r.left + ins, R = r.right - ins, T = r.top + ins, B = r.bottom - ins;
    if (L >= R || T >= B) return false;
    const dx = b[0] - a[0], dy = b[1] - a[1]; let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a[0] - L], [dx, R - a[0]], [-dy, a[1] - T], [dy, B - a[1]]]) {
      if (!p) { if (q < 0) return false; continue; }
      const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t0 < t1;
  }
  // Corner waypoints from a to b around the box, the short way round. Empty when the straight line is clear.
  function around(r, a, b) {
    if (!crosses(a, b, r)) return [];
    const m = S0 * .75, ins = S0 * .3, cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const C = [[r.left - m, r.top - m], [r.right + m, r.top - m], [r.right + m, r.bottom + m], [r.left - m, r.bottom + m]].map(([x, y]) => [clamp(x, ins, W - ins), clamp(y, ins, Hh - ins)]);
    const ang = p => Math.atan2(p[1] - cy, p[0] - cx), a0 = ang(a), cwTo = p => ((ang(p) - a0) % TAU + TAU) % TAU;
    const span = cwTo(b), cw = span <= PI;
    return C.map(p => ({ p, d: cw ? cwTo(p) : TAU - cwTo(p) })).filter(o => o.d > 0 && o.d < (cw ? span : TAU - span)).sort((u, v) => u.d - v.d).map(o => o.p);
  }
  const faceBox = (c, r, p, k = 45) => c.aim('tips', Math.atan2((r.top + r.bottom) / 2 - p[1], (r.left + r.right) / 2 - p[0]) + rnd(-.3, .3), rnd(-.5, .5), rnd(-.15, .25), k);
  // goPt that travels around the box instead of across it
  async function rimGo(c, r, which, sx, sy, o = {}) {
    const z = o.z ?? rig.z.t, w = wristFor(tipOf(rig.pose, which), sx, sy, rig.roll.t, rig.yaw.t, rig.pitch.t, z);
    let a = [rig.x.x, rig.y.x];
    // inside the box (after pointing at something): leave through the nearest edge first
    if (a[0] > r.left && a[0] < r.right && a[1] > r.top && a[1] < r.bottom && crosses(a, w, r)) {
      const m = S0 * .6, ins = S0 * .3, d = [a[1] - r.top, r.right - a[0], r.bottom - a[1], a[0] - r.left], s = d.indexOf(Math.min(...d));
      a = [[a[0], r.top - m], [r.right + m, a[1]], [a[0], r.bottom + m], [r.left - m, a[1]]][s].map((v, i) => clamp(v, ins, (i ? Hh : W) - ins));
      await c.go(a[0], a[1], { speed: (o.speed || 450) * 1.2, z, path: 'direct', ease: 'sine', k: 70 });
    }
    for (const p of around(r, a, w)) {
      if (o.face) faceBox(c, r, p);
      await c.go(p[0], p[1], { speed: (o.speed || 450) * 1.15, z, path: 'arc', bend: .12, ease: 'lin', k: 55 });
    }
    if (o.face) faceBox(c, r, [sx, sy]);
    await c.goPt(which, sx, sy, { ...o, z });
  }
  async function drum(c, n) { for (let i = 0; i < n; i++) { const f = Math.floor(rnd(0, 4)); c.finger(f, [rnd(.5, 1.1), rnd(.6, 1.2), .6], 420); await c.wait(rnd(90, 160)); c.finger(f, [.3, .4, .25], 260); await c.wait(rnd(120, 380)); } }
  const ROAM = {
    // glide along the frame to a fresh spot, fingers reaching toward the game
    async glide(c, r) {
      c.over(true); c.scale(ROAM_SC, 60); c.pose(any(['relax', 'open', 'claw', 'limp']), 60);
      const q = rimPick(r, S0 * rnd(.5, 1.1));
      c.aim('tips', q.ang + rnd(-.35, .35), rnd(-.5, .5), rnd(-.2, .25), 50);
      await rimGo(c, r, 'tips', q.p[0], q.p[1], { speed: rnd(320, 520), z: rnd(.05, .3), path: any(['arc', 's']), k: 90 });
      if (chance(.6)) await drum(c, 2 + Math.floor(rnd(0, 3))); else await c.wait(rnd(500, 1300));
    },
    // fingers hooked over the box edge, watching
    async perch(c, r) {
      c.over(true); c.scale(ROAM_SC, 60); c.pose(any(['hook', 'claw', 'relax']), 70);
      const q = rimPick(r, -S0 * .18);
      c.aim('tips', q.ang, rnd(-.25, .25), rnd(.05, .3), 60);
      await rimGo(c, r, 'tips', q.p[0], q.p[1], { speed: rnd(380, 600), z: .1, path: any(['arc', 's']), k: 100 });
      c.hov(.4); await drum(c, 1 + Math.floor(rnd(0, 3))); await c.wait(rnd(600, 1500)); c.hov(1);
    },
    // point at something in the game from just outside the frame
    async hint(c, r) {
      const list = boxTargets(); if (!list.length) return ROAM.glide(c, r);
      const t = any(list), tx = t.left + t.width / 2, ty = t.top + t.height / 2;
      const q = rimPick(r, S0 * .4), from = Math.atan2(ty - q.p[1], tx - q.p[0]);
      // pointAt takes its distance in hand units
      const dist = clamp(hyp(tx - q.p[0], ty - q.p[1]) / S0 - .4, .9, 2.6);
      c.over(true); c.scale(ROAM_SC, 60); c.pose('point', 140); c.aim('index', from, rnd(-.4, .4), rnd(-.2, .25), 110);
      await rimGo(c, r, 'index', tx - Math.cos(from) * dist * S0, ty - Math.sin(from) * dist * S0, { speed: 600, z: .15, path: 'arc' });
      await pointAt(c, tx, ty, { from, dist, z: .15, over: true, speed: 700, jab: chance(.5) ? 1 : 0 });
      await c.wait(rnd(500, 1000));
    },
    // knuckle knock on the frame, like tapping a fish tank
    async knock(c, r) {
      const q = rimPick(r, 0), [tx, ty] = q.p;
      c.over(true); c.scale(ROAM_SC, 60); c.pose('fist', 160);
      c.aim('knuck', q.ang, rnd(-.3, .3), -.2, 120);
      const bx = tx - Math.cos(q.ang) * S0 * .9, by = ty - Math.sin(q.ang) * S0 * .9;
      await rimGo(c, r, 'knuck', bx, by, { speed: 700, z: .2, path: 'arc' });
      for (let i = 0; i < 2 + Math.floor(rnd(0, 2)); i++) {
        await c.goPt('knuck', tx - Math.cos(q.ang) * S0 * .15, ty - Math.sin(q.ang) * S0 * .15, { dur: 90, path: 'direct', ease: 'in', k: 800, bank: 0, z: .2 });
        c.burst(tx, ty, 'knock', .5);
        await c.goPt('knuck', bx, by, { dur: 170, path: 'direct', ease: 'out', k: 450, bank: 0, z: .2 });
        await c.wait(rnd(60, 180));
      }
      c.soft();
    },
    // slow lap to the far side of the box, around it, fingers always toward the game
    async lap(c, r) {
      c.over(true); c.scale(ROAM_SC, 60); c.pose(any(['relax', 'splay', 'open']), 50);
      const q = rimPick(r, S0 * .8);
      await rimGo(c, r, 'mid', q.p[0], q.p[1], { speed: rnd(300, 420), z: .22, path: 'arc', face: true });
      await c.wait(rnd(200, 600));
    },
  };
  const ROAM_W = [['glide', 1.4], ['perch', 1], ['hint', .9], ['lap', .7], ['knock', .3]];

  // ---------------------------------------------------------------- Wheel spin
  const CORNERS = { tl: -.75 * PI, tr: -.25 * PI, br: .25 * PI, bl: .75 * PI };
  const GRIPS = {
    claw: { pre: 'claw', pose: 'grip', yaw: 0, pitch: -.55, at: 'grip', rr: .9 },
    grip: { pre: 'open', pose: 'grip', yaw: .2, pitch: -.35, at: 'grip', rr: .93 },
    hook: { pre: 'claw', pose: 'hook', yaw: PI, pitch: .25, at: 'hook', rr: 1 },
    pinch: { pre: 'relax', pose: 'pinch', yaw: .5, pitch: -.2, at: 'pinch', rr: .95 },
    slap: { pre: 'splay', pose: 'flat', yaw: 0, pitch: -.95, at: 'palm', rr: .78 },
  };
  function planSpin() {
    const corner = pick('corner', Object.keys(CORNERS), 3);
    const bucket = pick('force', [['flick', 1], ['easy', 1.2], ['firm', 1.2], ['heave', 1], ['monster', .6]], 4);
    const k = { flick: rnd(0, .15), easy: rnd(.15, .38), firm: rnd(.38, .62), heave: rnd(.62, .85), monster: rnd(.85, 1) }[bucket];
    const grip = pick('grip', k < .18 ? ['pinch', 'claw'] : k < .5 ? ['claw', 'hook', 'grip'] : k < .85 ? ['grip', 'claw', 'hook', 'slap'] : ['grip', 'slap', 'hook'], 3);
    return { corner, bucket, k, grip, pullArc: lerp(.35, 1.15, k), pullMs: lerp(300, 95, k), windup: lerp(.04, .3, k), e: lerp(2.7, 4.2, k), rps: lerp(1.3, 8.8, k ** 1.15) };
  }
  // Wheel motion shared with the page: angle(p) for p in 0..1, with an acceleration phase while the glove pulls.
  function spinShape(plan, remain) {
    if (!plan || CALM) return { turns: CALM ? 1 : null, e: 3.4, pa: 0 };
    const dist = plan.rps * TAU * remain / 1000 / plan.e;
    return { turns: Math.max(1, Math.round(dist / TAU)), e: plan.e, pa: clamp(plan.pullMs / remain, 0, .2) };
  }
  function spinCurve(shape) {
    const pa = shape.pa || 0, e = shape.e || 3.4, warp = p => pa ? p - pa * (1 - Math.exp(-p / pa)) : p, q1 = warp(1);
    return p => 1 - (1 - warp(p) / q1) ** e;
  }
  async function spinAct(c, plan, mode) {
    const gp = GRIPS[plan.grip], ang0 = CORNERS[plan.corner], zG = .22, contact = tipOf(gp.pose, gp.at), tok = c.tok;
    const handAt = (w, ang, lift, pose = gp.pose) => {
      const loc = tipOf(pose, gp.at), roll = solveRoll(loc, ang + PI, gp.yaw, gp.pitch), px = w.x + Math.cos(ang) * (w.r * gp.rr + lift), py = w.y + Math.sin(ang) * (w.r * gp.rr + lift);
      const o = wristFor(loc, px, py, roll, gp.yaw, gp.pitch, zG); return { x: o[0], y: o[1], roll, px, py };
    };
    c.over(false); tok.state = 'approach';
    let w = wheel(); if (!w) return;
    const fast = mode === 'lunge';
    c.pose(gp.pre, fast ? 400 : 70);
    let h = handAt(w, ang0, S0 * (fast ? .8 : 1.5), gp.pre);
    c.orient(h.roll, gp.yaw, gp.pitch, fast ? 300 : 50);
    if (!fast) {
      if (plan.k > .62) {
        const s = handAt(w, ang0 - .55, S0 * 2.6, gp.pre);
        await c.go(clamp(s.x, S0, W - S0), clamp(s.y, S0 * 1.6, Hh - S0), { path: any(['arc', 's', 'swoop']), speed: 650, z: .75, ease: 'cubic' });
        c.pose('splay', 200); c.trem(.5 + plan.k * .5); st.agit = Math.min(1, st.agit + .2); await c.wait(rnd(250, 520)); c.trem(0); c.pose(gp.pre, 200);
      } else {
        await c.go(h.x, h.y, { path: any(['arc', 's', 'swoop', 'loop']), speed: lerp(360, 720, plan.k), z: zG + .25, ease: 'sine' });
      }
    }
    // grab
    w = wheel() || w; h = handAt(w, ang0, 0);
    c.orient(h.roll, gp.yaw, gp.pitch, 300);
    await c.go(h.x, h.y, { path: 'direct', dur: fast ? 170 : lerp(420, 170, plan.k), ease: plan.k > .5 ? 'expo' : 'cubic', k: 650, z: zG });
    c.pose(gp.pose, 700); c.hov(0);
    c.burst(h.px, h.py, 'grab', .4 + plan.k);
    const a0 = (wheel() || w).a;
    c.lock(() => { const w2 = wheel(); if (!w2) return null; const hh = handAt(w2, ang0 + (w2.a - a0), 0); rig.roll.toA(hh.roll, 900); rig.z.to(zG, 200); return [hh.x, hh.y]; });
    // wind up: drag the wheel backwards a little
    tok.state = 'windup';
    if (!st.spinT0 && A.nudge) { let done = 0; await c.tween(fast ? 120 : lerp(250, 650, plan.k), u => { const tgt = -plan.windup * u; A.nudge(tgt - done); done = tgt; }, E.cubic); }
    c.trem(lerp(.05, .55, plan.k)); for (let f = 0; f < 4; f++) setFinger(f, [rig.P[f * 4 + 1].t + .12, null, null], 300);
    tok.state = 'cocked';
    await c.until(() => st.spinT0, mode === 'prep' ? 9000 : 1500);
    if (!st.spinT0) { c.trem(0); unlock(); c.hov(1); if (A.nudge) A.nudge(plan.windup * .5); return; }
    tok.pri = 9; c.trem(0); tok.state = 'pull';
    const t0 = now();
    await c.until(() => { const w2 = wheel(); return !w2 || (w2.a - st.spinA0) >= plan.pullArc || now() - t0 > plan.pullMs * 1.6 + 250; });
    // release and follow through
    let [vx, vy] = lockVel; const sp = hyp(vx, vy), cap = 3600; if (sp > cap) { vx *= cap / sp; vy *= cap / sp; }
    unlock(); c.hov(1); tok.state = 'follow';
    rig.x.v = vx; rig.y.v = vy; rig.x.k = rig.y.k = 9; rig.x.z = rig.y.z = 1;
    const fl = [clamp(rig.x.x + vx * .3, S0, W - S0), clamp(rig.y.x + vy * .3, S0, Hh - S0)];
    rig.x.t = fl[0]; rig.y.t = fl[1];
    if (plan.bucket === 'monster') burst(rig.x.x, rig.y.x, 'whoosh', Math.atan2(vy, vx) + PI);
    if (plan.k < .2) { c.pose('relax', 200); c.orient(rig.roll.t + sgn() * rnd(.6, 1.2), null, 0, 50); await c.wait(500); }
    else if (plan.k < .62) { c.pose('open', 400); c.depth(.35); await c.wait(350); c.pose('relax', 90); await c.wait(400); }
    else {
      c.pose('splay', 600); c.depth(.75, 40); await c.wait(450);
      const r0 = rig.roll.t; await c.tween(900, u => rig.roll.to(r0 + Math.sin(u * TAU * 4) * .4 * (1 - u), 400), E.lin);
      c.pose('limp', 90); for (let i = 0; i < 4; i++) { setFinger(Math.floor(rnd(0, 4)), [-.3, .1, .1], 900); await c.wait(70); } c.pose('relax', 80);
    }
    c.soft(); rig.x.k = rig.y.k = KP;
  }
  // While the wheel turns (after the pull)
  const WATCH = {
    async conduct(c) {
      c.pose('point', 120); const dir = 1, z = .35; let a = rnd(0, TAU);
      await c.tween(1e5, () => {
        const w = wheel(); if (!w) return; const spd = clamp((w.a - (WATCH.la ?? w.a)) / .016, 0, 6); WATCH.la = w.a;
        a += dir * (.6 + spd * .5) * .016; const rr = w.r * 1.18, p = [w.x + Math.cos(a) * rr, w.y + Math.sin(a) * rr];
        rig.roll.toA(solveRoll(tipOf('point', 'index'), a + PI, rig.yaw.t, rig.pitch.t), 90);
        const wr = wristFor(tipOf('point', 'index'), p[0], p[1], rig.roll.t, rig.yaw.t, rig.pitch.t, z); rig.x.t = wr[0]; rig.y.t = wr[1]; rig.z.t = z;
      }, E.lin);
    },
    async hover(c) {
      const w = wheel(); if (!w) return;
      c.pose('relax', 100); c.aim('tips', PI / 2, 0, -.6, 60);
      await c.goPt('tips', w.x + w.r * rnd(-.25, .25), w.y - w.r * 1.05, { speed: 700, z: .3, path: pathPick() });
      for (;;) for (const f of [3, 2, 1, 0]) { c.finger(f, [.9, .6, .3], 900); await c.wait(55); c.finger(f, [.22, .3, .16], 500); }
    },
    async clench(c) {
      const w = wheel(); if (!w) return;
      c.pose('fist', 120); const s = sgn(); c.orient(s * .4, s * 1.1, 0, 60);
      await c.goPt('mid', w.x + s * w.r * 1.25, w.y - w.r * rnd(.1, .5), { speed: 700, z: .25, path: pathPick() });
      await c.tween(1e5, () => rig.trem.to(clamp(1 - (st.spinEnd - now()) / 4000, .05, .9), 40), E.lin);
    },
    async mimic(c) {
      const w = wheel(); if (!w) return;
      c.pose('splay', 80); const s = sgn(), base = rig.roll.t, a0 = w.a;
      c.orient(base, PI * .9, 0, 60);
      await c.goPt('mid', w.x + s * w.r * 1.3, w.y + w.r * rnd(-.3, .3), { speed: 700, z: .3, path: pathPick() });
      await c.tween(1e5, () => { const w2 = wheel(); if (w2) rig.roll.to(base + (w2.a - a0) * .35, 200); }, E.lin);
    },
    async twiddle(c) { await IDLE.twiddle(c); },
    async leanIn(c) {
      const w = wheel(); if (!w) return;
      c.pose('claw', 60); c.aim('tips', PI / 2 + rnd(-.3, .3), rnd(-.2, .2), -.3, 60);
      await c.goPt('tips', w.x + rnd(-.3, .3) * w.r, w.y - w.r * .92, { speed: 600, z: .45, path: 'arc' });
      c.trem(.35); for (const f of [3, 2, 1, 0]) { c.finger(f, [.9, 1.3, 1.0], 30); await c.wait(rnd(150, 280)); }
      await c.until(() => false, 8000);
    },
  };

  // ---------------------------------------------------------------- Director
  const REACT = {
    round: [['beckon', 1], ['presentTable', 1], ['snapPoint', .8], ['pointPlayer', .5], ['tapClock', .6], ['tapTickets', .7], ['wave', .4]],
    bet: [['nodTap', 1], ['quickThumb', .8], ['rubMoney', 1], ['quickOk', .7]],
    refused: [['wag', 1], ['thumbsDown', .8], ['punchHud', 1], ['palmNo', .8]],
    ready: [['pointWheel', 1], ['snapPoint', .8], ['quickThumb', .6], ['rubMoney', .5]],
    win: [['thumbsUp', 1], ['fingerGuns', 1], ['pointPlayer', .7], ['ok', .8], ['fistPump', 1], ['patWin', .8], ['peace', .4]],
    bigwin: [['fistPump', 1], ['jazz', 1], ['fingerGuns', .8], ['thumbsUp', .6], ['conductBow', .8], ['patWin', .6]],
    loss: [['thumbsDown', 1], ['wag', 1], ['laughPoint', 1], ['punchWheel', 1], ['punchHud', .8], ['palmNo', .6], ['shrug', .5]],
    nobet: [['shrug', 1], ['tapTickets', 1], ['beckon', .8], ['pointHit', .7]],
    landedBonus: [['jazz', 1], ['drumroll', 1], ['rubMoney', .8], ['snapPoint', .7], ['pointHit', .8]],
    bonusWin: [['thumbsUp', 1], ['ok', 1], ['fistPump', 1], ['fingerGuns', .8], ['jazz', .6]],
    bonusLoss: [['middleSlow', 1], ['middleJab', 1], ['middleTurn', 1], ['middleRise', 1], ['middleDouble', .8]],
    bonusWatch: [['shrug', 1], ['wave', 1], ['peace', .7], ['beckon', .5]],
    levelUp: [['fistPump', 1], ['thumbsUp', 1], ['countUp', .7], ['jazz', .6]],
    join: [['wave', 1], ['pointPeople', 1]],
    leave: [['wave', 1], ['thumbsDown', .4], ['shrug', .5]],
  };
  const OVER = new Set(['bonusWin', 'bonusLoss', 'bonusWatch', 'landedBonus']);
  const PRI = { bonusLoss: 5, bonusWin: 5, win: 5, bigwin: 5, loss: 5, nobet: 4, levelUp: 4, landedBonus: 4, refused: 3, ready: 3, round: 2, bet: 2, join: 2, leave: 2, bonusWatch: 4 };
  const MOOD = { win: [-.1, .3], bigwin: [.2, .6], loss: [.35, -.2], bonusLoss: [.45, -.3], refused: [.25, 0], bonusWin: [0, .5] };
  function react(type, d = {}) {
    if (!started || CALM && /punch/.test(type)) return;
    const list = REACT[type]; if (!list) return;
    const m = MOOD[type]; if (m) st.agit = clamp(st.agit + m[0], 0, 1);
    const pri = PRI[type] || 2;
    if (cur && cur.pri > pri) { queue.push({ type, d, exp: now() + (pri >= 4 ? 6000 : 2500), pri }); return; }
    const name = pick('react:' + type, list.map(([n, w]) => [n, w * (CALM && /punch|jab/i.test(n) ? 0 : 1)]));
    st.lastReact = now();
    run(type + ':' + name, async c => { c.over(OVER.has(type)); await (R[name] || IDLE[name])(c, { ...d, over: OVER.has(type) }); c.over(false); }, pri, d);
  }
  function director() {
    if (!started) return;
    const tn = now();
    // anticipation: get to the wheel before betting closes
    if (st.phase === 'betting' && !CALM && st.round !== st.prepRound && (!cur || cur.pri < 6)) {
      const left = st.endsAt - Date.now();
      if (st.round !== st.countRound && left < 4200 && left > 3200 && chance(.006)) { st.countRound = st.round; run('countdown', countdown, 4); }
      else if (st.endsAt && (left < (st.lead || 2000) || st.allReady) && !(cur && cur.name === 'countdown' && left > 900)) startPrep();
    }
    if (cur) return;
    for (let i = 0; i < queue.length; i++) { const q = queue[i]; if (q.exp < tn) { queue.splice(i--, 1); continue; } queue.splice(i, 1); return react(q.type, q.d); }
    if (st.phase === 'spinning' && st.spinT0) {
      const late = st.spinEnd && st.spinEnd - tn < 1600;
      const name = late ? 'leanIn' : pick('watch', [['conduct', st.spinPlan && st.spinPlan.k > .4 ? 1.3 : .5], ['hover', 1], ['clench', .8], ['mimic', st.spinPlan && st.spinPlan.k > .5 ? 1 : .4], ['twiddle', st.spinPlan && st.spinPlan.k < .3 ? 1.2 : .3]]);
      run('watch:' + name, async c => { const job = WATCH[name](c); job.catch(() => {}); await Promise.race([job, c.until(() => (!late && st.spinEnd - now() < 1600) || st.phase !== 'spinning')]); }, 1);
      return;
    }
    if (overlayOn()) {
      const r = boxRect();
      if (r) { const n = pick('roam', ROAM_W); run('roam:' + n, async c => { await ROAM[n](c, r); if (chance(.3)) await c.wait(rnd(300, 900)); }, 0); }
      else run('roam:wait', async c => { c.scale(ROAM_SC, 60); await c.wait(300); }, 0);
      return;
    }
    if (rig.sc.t !== 1) rig.sc.to(1, 60);
    const names = CALM ? CALM_IDLE : Object.keys(IDLE_W);
    const name = pick('idle', names.map(n => [n, (IDLE_W[n] || 1) * (1 + (AGIT[n] ? (AGIT[n] - 1) * st.agit * 2 : 0))]), 9);
    run('idle:' + name, async c => { c.over(false); await IDLE[name](c); if (chance(.35)) await c.wait(rnd(300, 1200)); }, 0);
  }
  function startPrep() {
    st.prepRound = st.round; const plan = st.spinPlan = planSpin();
    run('spin', c => spinAct(c, plan, 'prep'), 6);
  }
  async function countdown(c) {
    const r = pickEl('clock') || pickEl('say'); if (!r) return;
    c.pose('n3', 160); c.orient(rnd(-.2, .2), PI + rnd(-.2, .2), .1, 90);
    await c.goPt('mid', r.left + r.width * rnd(.3, .7), r.top - S0 * 1.6, { speed: 1000, z: .5, path: pathPick() });
    for (const n of [3, 2, 1]) {
      await c.until(() => st.endsAt - Date.now() < n * 1000 + 300, 3000);
      c.pose('n' + n, 500); c.scale(1.12, 500); await c.wait(120); c.scale(1, 200);
    }
    await c.until(() => false, 1500);
  }

  // ---------------------------------------------------------------- Page API
  function resize() {
    W = innerWidth; Hh = innerHeight; dpr = Math.min(2, devicePixelRatio || 1);
    S0 = clamp(Math.min(W, Hh) * .1, 38, 112);
    [cv, fxc].forEach(c => { c.width = Math.ceil(W * dpr); c.height = Math.ceil(Hh * dpr); });
  }
  function init(adapter) {
    if (started) { A = adapter || A; return; }
    A = adapter || {};
    const mkc = (id, z) => { const c = document.createElement('canvas'); c.id = id; c.setAttribute('aria-hidden', 'true'); c.style.cssText = `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${z}`; document.body.appendChild(c); return c; };
    cv = mkc('glove', 12); fxc = mkc('glovefx', 14);
    g = cv.getContext('2d'); fg = fxc.getContext('2d'); HAS_FILTER = typeof g.filter === 'string';
    Hb = document.createElement('canvas'); hb = Hb.getContext('2d'); Cb = document.createElement('canvas'); cb = Cb.getContext('2d');
    resize(); addEventListener('resize', resize);
    // entrance: drops in from above, presents itself
    rig.x.x = rig.x.t = W * rnd(.3, .7); rig.y.x = rig.y.t = -S0 * 4; rig.z.x = rig.z.t = .6;
    started = true;
    run('enter', async c => { c.pose('open', 60); c.orient(rnd(-.3, .3), PI, -.3, 40); await c.goPt('mid', W * rnd(.35, .65), Hh * .32, { dur: 1600, path: 's', ease: 'cubic', z: .55 }); await R.wave(c); }, 3);
    requestAnimationFrame(frame);
  }
  function room(info) {
    if (!started) return;
    if (info.round !== st.round && info.phase === 'betting') { st.round = info.round; st.spinT0 = 0; st.spinEnd = 0; st.lead = rnd(1.5, 2.6) * 1000; if (st.phase !== 'betting' && chance(.55)) react('round'); }
    if (info.phase !== st.phase) {
      if (info.phase === 'landed' && st.phase === 'spinning') { st.spinT0 = 0; if (cur && /^watch/.test(cur.name)) kill(cur); }
      st.phase = info.phase;
    }
    st.endsAt = info.left > 0 ? Date.now() + info.left : 0;
    st.allReady = !!info.allReady;
  }
  // Called when the server starts a spin. Returns how long the page should wait before the wheel moves, and its shape.
  function spin(sp, remain) {
    if (!started || CALM) return { delay: 0, shape: r => spinShape(null, r) };
    st.spinT0 = 0;
    let plan = st.spinPlan, delay = 0;
    const cocked = cur && cur.name === 'spin' && !cur.dead && cur.state === 'cocked';
    if (cocked) delay = rnd(0, 80);
    else if (remain > 1800 && wheel()) {
      plan = st.spinPlan = planSpin();
      const w = wheel(), a = CORNERS[plan.corner], d = hyp(w.x + Math.cos(a) * w.r - rig.x.x, w.y + Math.sin(a) * w.r - rig.y.x);
      delay = clamp(d / 2600 * 1000, 180, 480) + 200;
      if (cur) kill(cur);
      cur = null; run('spin', c => spinAct(c, plan, 'lunge'), 9);
    } else plan = null;
    st.prepRound = st.round;
    return { delay, shape: r => spinShape(plan, r) };
  }
  function spinGo(info = {}) { const w = wheel(); st.spinA0 = w ? w.a : 0; st.spinT0 = now(); st.spinEnd = now() + (info.remain || 4000); st.phase = 'spinning'; }
  function emit(type, d = {}) {
    if (!started) return;
    if (type === 'bet') { if (now() - st.lastReact < 2500 || !chance(.4) || st.phase !== 'betting') return; }
    if (type === 'payout') { const { stake = 0, win = 0 } = d; type = !stake ? 'nobet' : win > stake * 4 ? 'bigwin' : win > stake ? 'win' : 'loss'; }
    if (type === 'bonusResult') { const { stake = 0, win = 0 } = d; type = !stake ? 'bonusWatch' : (d.m ?? win / stake - 1) < 1 ? 'bonusLoss' : 'bonusWin'; }
    react(type, d);
  }
  return { init, room, spin, spinGo, emit, spinCurve, get state() { return { cur: cur && cur.name, phase: st.phase, layer, agit: st.agit }; }, _R: R, _IDLE: IDLE, _run: (n, pri = 7) => run('debug:' + n, c => (R[n] || IDLE[n] || WATCH[n])(c, {}), pri) };
})();
if (typeof window !== 'undefined') window.Glove = Glove;
