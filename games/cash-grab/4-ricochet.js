'use strict';
// Cash Grab 4: Ricochet
const { RHS, pool } = require('../lib');
const AIM_MS = 15000, SHOT_MS = 2600, COLORS = ['red', 'blue', 'green', 'gold'], COMBO = 3;
module.exports = {
  id: 'ricochet', cat: 'grab', name: 'Ricochet',
  rules: [
    'Aim: 1 shot. It bounces off the walls and passes through up to 3 targets.',
    'Score: the best value you hit. Every target hit is destroyed.',
    'Order: shots fire in lock-in order, so earlier shots clear targets first. All aims are visible live.',
    'Combo: 3 hits of the same color triple your best value.'
  ],
  create(ctx) {
    const ids = ctx.ids, T = [], vals = ctx.shuffle(pool([[2, 8], [3, 8], [5, 7], [8, 5], [10, 4], [15, 3], [25, 2], [40, 2], [60, 1]]));
    let tries = 0;
    while (T.length < 36 && tries++ < 5000) {
      const x = 40 + ctx.rand() * (RHS.GW - 80), y = 50 + ctx.rand() * 560;
      if (T.every(t => Math.hypot(t.x - x, t.y - y) > RHS.TR * 2 + 8)) T.push({ id: T.length, x: Math.round(x), y: Math.round(y), v: vals[T.length % vals.length], c: COLORS[ctx.rnd(4)], gone: false });
    }
    const aim = {}, lockAt = {}, shots = [];
    ids.forEach(id => aim[id] = Math.round((ctx.rand() - 0.5) * 60));
    let phase = 'aim', cur = -1, pushT = 0, res = {};
    const res0 = () => ids.forEach(id => res[id] = 0);
    res0();
    function fire() {
      if (phase !== 'aim') return; phase = 'fire'; ctx.deadline(0);
      const order = ids.slice().sort((a, b) => (lockAt[a] || 1e15) - (lockAt[b] || 1e15));
      order.forEach(id => {
        const tr = RHS.trace(aim[id], T);
        const hit = tr.hits.map(h => T[h]);
        hit.forEach(t => t.gone = true);
        let best = Math.max(0, ...hit.map(t => t.v));
        const combo = hit.length === 3 && hit.every(t => t.c === hit[0].c);
        if (combo) best *= COMBO;
        res[id] = best;
        shots.push({ id, angle: aim[id], pts: tr.pts.map(p => [Math.round(p[0]), Math.round(p[1])]), hits: tr.hits, best, combo });
      });
      // Restore targets for animation; the client destroys them as each shot plays
      T.forEach(t => t.gone = false);
      cur = 0; ctx.push();
      const step = () => {
        const s = shots[cur]; s.hits.forEach(h => T[h].gone = true);
        ctx.log(`${ctx.name(s.id)} ${s.hits.length ? `hits ${s.hits.length} and takes ${s.best}x${s.combo ? ' (same color combo)' : ''}` : 'misses everything'}`);
        cur++; ctx.push();
        if (cur < shots.length) ctx.after(SHOT_MS, step);
        else { phase = 'done'; ctx.push(); ctx.after(3000, () => ctx.end(res)); }
      };
      ctx.after(SHOT_MS, step);
    }
    return {
      start() { ctx.deadline(AIM_MS); ctx.after(AIM_MS, fire); },
      act(pid, a) {
        if (phase !== 'aim' || lockAt[pid]) return;
        if (typeof a.aim === 'number') aim[pid] = Math.max(-75, Math.min(75, Math.round(a.aim * 10) / 10));
        if (a.lock) { lockAt[pid] = ctx.now(); ctx.log(`${ctx.name(pid)} locks in`); }
        const now = ctx.now();
        if (a.lock || now - pushT > 80) { pushT = now; ctx.push(); }
        if (ids.every(id => lockAt[id])) ctx.after(400, fire);
      },
      view() {
        return { phase, targets: T, aim, locked: ids.filter(id => lockAt[id]), order: ids.filter(id => lockAt[id]).sort((a, b) => lockAt[a] - lockAt[b]),
          shots: phase === 'aim' ? [] : shots.slice(0, cur + 1), cur, shotMs: SHOT_MS, res: phase === 'done' ? res : null };
      }
    };
  }
};
