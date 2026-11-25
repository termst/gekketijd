'use strict';
// Productivitime 2: Paint the Wheel
const { pool } = require('../lib');
const N = 64, BUDGET = 6, PAINT_MS = 20000, SPIN_MS = 5000, SCORING = 3, MAX_JACKPOTS = 4;
module.exports = {
  id: 'paint', cat: 'prod', name: 'Paint the Wheel',
  rules: [
    'Paint: 6 points. A free segment costs 1, a rival\'s costs 2. DOUBLE and TRIPLE cannot be painted.',
    'Score: 3 spins. The landing segment\'s owner collects its value, both neighbours collect 50%.',
    'Jackpot: landing on DOUBLE or TRIPLE multiplies every segment and spins again (free spin).'
  ],
  create(ctx) {
    const ids = ctx.ids;
    const segs = ctx.shuffle(pool([[2, 10], [3, 10], [5, 10], [8, 8], [10, 7], [15, 5], [25, 4], [50, 3], [100, 2], ['DOUBLE', 3], ['TRIPLE', 2]]));
    const owner = Array(N).fill(null), points = {}, res = {};
    ids.forEach(id => { points[id] = BUDGET; res[id] = 0; });
    let phase = 'paint', top = ctx.rnd(N), spins = [], scored = 0, jackpots = 0, mul = 1;
    const neutral = i => typeof segs[i] !== 'number';
    function paint(pid, i) {
      if (neutral(i) || owner[i] === pid) return false;
      const cost = owner[i] ? 2 : 1; if (points[pid] < cost) return false;
      points[pid] -= cost;
      if (owner[i]) {
        if (!ctx.attack(pid, owner[i], 'a paint-over')) return true;
        ctx.log(`${ctx.name(pid)} paints over ${ctx.name(owner[i])}'s ${segs[i]}x`);
      }
      owner[i] = pid; return true;
    }
    function startSpins() {
      if (phase !== 'paint') return;
      // Unspent points paint random free segments
      ids.forEach(id => { let t = 0; while (points[id] > 0 && t++ < 500) { const i = ctx.rnd(N); if (!owner[i] && !neutral(i)) paint(id, i); } });
      phase = 'spin'; ctx.deadline(0); spin();
    }
    function spin() {
      const from = top; top = ctx.rnd(N);
      spins.push({ from, to: top, at: ctx.now(), dur: SPIN_MS }); ctx.push();
      ctx.after(SPIN_MS + 500, () => {
        const s = segs[top];
        if (typeof s !== 'number' && jackpots < MAX_JACKPOTS) {
          jackpots++; mul *= s === 'DOUBLE' ? 2 : 3;
          ctx.log(`${s}: every segment is now x${mul}. Spinning again.`);
        } else {
          scored++;
          const v = (typeof s === 'number' ? s : 25) * mul;
          if (owner[top]) { res[owner[top]] += v; ctx.log(`Spin ${scored}: ${v}x to ${ctx.name(owner[top])}`); }
          else ctx.log(`Spin ${scored}: ${v}x lands on an unclaimed segment`);
          for (const j of [(top + N - 1) % N, (top + 1) % N]) if (owner[j]) { res[owner[j]] += v / 2; ctx.log(`${ctx.name(owner[j])} neighbours it: +${v / 2}x`); }
        }
        ctx.push();
        if (scored < SCORING) ctx.after(1400, spin);
        else { phase = 'done'; ctx.push(); ctx.after(3500, () => ctx.end(res)); }
      });
    }
    return {
      start() { ctx.deadline(PAINT_MS); ctx.after(PAINT_MS, startSpins); },
      act(pid, a) {
        if (phase !== 'paint') return;
        if (Number.isInteger(a.paint) && a.paint >= 0 && a.paint < N) { if (paint(pid, a.paint)) ctx.push(); }
        if (ids.every(id => points[id] === 0)) ctx.after(800, startSpins);
      },
      view() { return { phase, segs, owner, points, budget: BUDGET, spins, top, mul, scored, res }; }
    };
  }
};
