// Shared between server (Node) and browser. Board physics, ricochet tracing, wheel data.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RHS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- Main wheel ----
  const TYPES = {
    one:    { n: '1',  pay: 1,  c: '#1c4f9e', d: '#0d2855', t: '#fff' },
    two:    { n: '2',  pay: 2,  c: '#b65f30', d: '#5f2a10', t: '#fff' },
    five:   { n: '5',  pay: 5,  c: '#0d7558', d: '#053a2c', t: '#fff' },
    ten:    { n: '10', pay: 10, c: '#eadfc8', d: '#a3947a', t: '#1b1430' },
    spare:  { n: 'Spare Change',   c: '#8e1f3a', d: '#430a19', t: '#fff' },
    grab:   { n: 'Cash Grab',      c: '#e0a136', d: '#80520c', t: '#241203' },
    drop:   { n: 'Drop Dead',      c: '#0b7d90', d: '#033b47', t: '#fff' },
    prod:   { n: 'Productivitime', c: '#191726', d: '#07060d', t: '#dfe6f5' }
  };
  const KEYS = Object.keys(TYPES);
  const BONUS_KEYS = ['spare', 'grab', 'drop', 'prod'];
  const BORING = ['one', 'two'];
  // 48 fields, same layout as the base game with the bonus fields renamed:
  // Spare Change x4, Cash Grab x2, Drop Dead x2, Productivitime x1
  const DIAL = ('prod one two one five one spare two one ten one two ' +
    'one grab one two five one spare one two one drop one ' +
    'two one ten one five one spare two one two one grab ' +
    'one five one drop two one spare one five two one ten').split(' ');

  // ---- Crowd weighting: the wheel leans slightly away from popular fields ----
  // players: share of this round's bettors on the field (needs 2+ bettors)
  // stake:   share of all Orra staked this round that sits on the field
  // weight = 1 - CROWD_PLAYERS * players - CROWD_STAKE * stake, floor 1 - CROWD_MAX
  // Example, 4 bettors: 3 on Ten holding 60% of the Orra -> 1 - .12*.75 - .12*.6 = 0.84 (16% less likely).
  const CROWD_PLAYERS = 0.12, CROWD_STAKE = 0.12, CROWD_MAX = 0.24;
  function crowdWeights(stakes) {
    const out = {}, bettors = Object.values(stakes || {}).filter(b => Object.values(b).some(x => x > 0));
    let total = 0; for (const b of bettors) for (const x of Object.values(b)) total += x;
    for (const k of KEYS) {
      const on = bettors.filter(b => b[k] > 0).length, amt = bettors.reduce((a, b) => a + (b[k] || 0), 0);
      const pl = bettors.length >= 2 ? on / bettors.length : 0, st = total ? amt / total : 0;
      out[k] = Math.max(1 - CROWD_MAX, 1 - CROWD_PLAYERS * pl - CROWD_STAKE * st);
    }
    return out;
  }

  // ---- Seeded RNG (mulberry32) ----
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Pachinko board ----
  // World: 600 x 720. Pegs from y=110 to y=560, slots from y=640.
  const BW = 600, BH = 720, PEG_R = 6, PUCK_R = 13, SLOT_Y = 645;
  function basePegs() {
    const pegs = [];
    for (let r = 0; r < 10; r++) {
      const y = 110 + r * 50;
      if (r % 2 === 0) for (let i = 0; i < 12; i++) pegs.push({ x: 25 + 50 * i, y });
      else for (let i = 0; i < 11; i++) pegs.push({ x: 50 + 50 * i, y });
    }
    return pegs;
  }
  // Valid spot for an extra peg: inside the peg field and not touching another peg.
  function pegSpotOk(pegs, x, y) {
    if (x < 20 || x > BW - 20 || y < 130 || y > 590) return false;
    for (const p of pegs) if (Math.hypot(p.x - x, p.y - y) < 34) return false;
    return true;
  }

  class Board {
    constructor(opt) {
      this.slots = opt.slots;               // number of slots
      this.sw = BW / this.slots;
      this.pegs = (opt.pegs || basePegs()).slice();
      this.pucks = [];
      this.rand = opt.rand || Math.random;
      this.tilt = 0;                        // horizontal acceleration from a board tilt
      this.tiltT = 0;
      this.t = 0;
      this.g = opt.g || 1300;
    }
    addPuck(id, owner, x) {
      x = Math.max(PUCK_R + 2, Math.min(BW - PUCK_R - 2, x));
      const p = { id, owner, x, y: 40, vx: (this.rand() - 0.5) * 20, vy: 0, done: false, slot: -1, dead: false, still: 0 };
      this.pucks.push(p);
      return p;
    }
    nudge(dir) { this.tilt = dir * 1400; this.tiltT = 0.28; }
    step(dt) {
      this.t += dt;
      const g = this.g;
      if (this.tiltT > 0) { this.tiltT -= dt; if (this.tiltT <= 0) this.tilt = 0; }
      const live = this.pucks.filter(p => !p.done && !p.dead);
      for (const p of live) {
        p.vy += g * dt;
        p.vx += this.tilt * dt;
        p.vx *= 0.999;
        p.x += p.vx * dt; p.y += p.vy * dt;
        // walls
        if (p.x < PUCK_R) { p.x = PUCK_R; p.vx = Math.abs(p.vx) * 0.5; }
        if (p.x > BW - PUCK_R) { p.x = BW - PUCK_R; p.vx = -Math.abs(p.vx) * 0.5; }
        // pegs
        for (const q of this.pegs) {
          const dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy, m = PUCK_R + PEG_R;
          if (d2 < m * m && d2 > 0.0001) {
            const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
            p.x = q.x + nx * m; p.y = q.y + ny * m;
            const vn = p.vx * nx + p.vy * ny;
            if (vn < 0) {
              p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny;
              p.vx += (this.rand() - 0.5) * 40;   // small jitter keeps paths lively
            }
          }
        }
        // slot dividers in the bottom band
        if (p.y > SLOT_Y - 20) {
          const s = Math.floor(p.x / this.sw), lo = s * this.sw, hi = lo + this.sw;
          if (p.x - lo < PUCK_R * 0.6 && s > 0) { p.x = lo + PUCK_R * 0.6; p.vx = Math.abs(p.vx) * 0.4; }
          if (hi - p.x < PUCK_R * 0.6 && s < this.slots - 1) { p.x = hi - PUCK_R * 0.6; p.vx = -Math.abs(p.vx) * 0.4; }
        }
        if (p.y >= SLOT_Y + 30) {
          p.done = true; p.slot = Math.max(0, Math.min(this.slots - 1, Math.floor(p.x / this.sw)));
          p.y = SLOT_Y + 30; p.vx = p.vy = 0;
        }
        // unstick a puck resting on a peg
        if (Math.abs(p.vx) + Math.abs(p.vy) < 40) { if ((p.still += dt) > 0.25) { const dir = p.x < 60 ? 1 : p.x > BW - 60 ? -1 : (this.rand() < 0.5 ? -1 : 1); p.vx += dir * 120; p.vy -= 60; p.still = 0; } }
        else p.still = 0;
      }
      // puck vs puck
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, m = PUCK_R * 2;
        if (d2 < m * m && d2 > 0.0001) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, o = (m - d) / 2;
          a.x -= nx * o; a.y -= ny * o; b.x += nx * o; b.y += ny * o;
          const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rv < 0) {
            const j2 = -(1 + 0.85) * rv / 2;
            a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny;
          }
        }
      }
    }
    // Run until every puck landed. Returns frames for animation.
    simulate(maxT = 20, every = 3) {
      const frames = []; let n = 0;
      while (this.pucks.some(p => !p.done && !p.dead) && this.t < maxT) {
        this.step(1 / 120);
        if (n++ % every === 0) frames.push(this.snap());
      }
      frames.push(this.snap());
      return frames;
    }
    snap() { return this.pucks.map(p => [p.id, Math.round(p.x), Math.round(p.y), p.done ? 1 : p.dead ? 2 : 0]); }
  }

  // ---- Ricochet gallery ----
  const GW = 600, GH = 800, TR = 22, GUN = { x: 300, y: 790 };
  // angle: degrees from straight up, -75..75
  function trace(angle, targets, maxHits = 3, maxBounces = 5) {
    const a = angle * Math.PI / 180;
    let x = GUN.x, y = GUN.y, dx = Math.sin(a), dy = -Math.cos(a);
    const pts = [[x, y]], hits = [], alive = targets.filter(t => !t.gone);
    let bounces = 0;
    while (bounces <= maxBounces && hits.length < maxHits) {
      // distance to the next wall
      let tw = Infinity, wall = null;
      if (dx > 1e-9) { const t = (GW - 4 - x) / dx; if (t < tw) { tw = t; wall = 'x'; } }
      if (dx < -1e-9) { const t = (4 - x) / dx; if (t < tw) { tw = t; wall = 'x'; } }
      if (dy < -1e-9) { const t = (4 - y) / dy; if (t < tw) { tw = t; wall = 'y'; } }
      if (dy > 1e-9) { const t = (GH - y) / dy; if (t < tw) { tw = t; wall = 'exit'; } }
      // targets crossed on this leg, in order
      const leg = [];
      for (const t of alive) {
        if (hits.includes(t.id)) continue;
        const fx = t.x - x, fy = t.y - y, proj = fx * dx + fy * dy;
        if (proj < 0 || proj > tw) continue;
        const px = x + dx * proj - t.x, py = y + dy * proj - t.y;
        if (px * px + py * py <= TR * TR) leg.push([proj, t]);
      }
      leg.sort((p, q) => p[0] - q[0]);
      for (const [d, t] of leg) {
        hits.push(t.id);
        if (hits.length >= maxHits) { x += dx * d; y += dy * d; pts.push([x, y]); return { pts, hits }; }
      }
      x += dx * tw; y += dy * tw; pts.push([x, y]);
      if (wall === 'exit') break;
      if (wall === 'x') dx = -dx; else dy = -dy;
      bounces++;
    }
    return { pts, hits };
  }

  return { TYPES, KEYS, BONUS_KEYS, BORING, DIAL, crowdWeights, CROWD_MAX, rng, Board, basePegs, pegSpotOk, BW, BH, PEG_R, PUCK_R, SLOT_Y, GW, GH, TR, GUN, trace };
});
