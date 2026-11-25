'use strict';
// Productivitime 4: Brake Battle
const { pool } = require('../lib');
const N = 40, LEAD = 3000, BRAKE = 0.55, C1 = 0.16, C0 = 1.6, STOP = 2;   // speeds in segments per second
module.exports = {
  id: 'brake', cat: 'prod', name: 'Brake Battle',
  rules: [
    'Every player has their own flapper on the wheel. The wheel spins and each player gets 1 brake press.',
    'Each press slows the wheel hard. The last player to press effectively decides where it stops, but wait too long and the wheel stops on its own.',
    'You get the segment under your flapper. DOUBLE pays 2x the next segment.',
    'If your press stops the wheel directly and your flapper is on a DOUBLE, you gain a Shield.'
  ],
  C1, C0, STOP,
  create(ctx) {
    const ids = ctx.ids;
    const segs = ctx.shuffle(pool([[5, 8], [10, 8], [15, 6], [20, 5], [30, 4], [50, 3], [100, 2], [200, 1], ['DOUBLE', 3]]));
    const off = {}; ids.forEach((id, i) => off[id] = Math.round(i * N / ids.length));
    const pressed = {};
    let phase = 'lead', a = ctx.rnd(N), w = 80 + ctx.rand() * 30, t0 = 0, loop = null, stopBy = null, last = ctx.now(), sendT = 0, result = null;
    const read = id => ((Math.round(a) + off[id]) % N + N) % N;
    const valueAt = i => { if (segs[i] !== 'DOUBLE') return segs[i]; for (let k = 1; k < N; k++) { const s = segs[(i + k) % N]; if (s !== 'DOUBLE') return 2 * s; } return 0; };
    const send = () => ctx.fx({ w: { a, w, t: ctx.now() } });
    function tick() {
      const now = ctx.now(), dt = (now - last) / 1000; last = now;
      a += w * dt; w -= (C1 * w + C0) * dt;
      if (w < STOP) return stop(null);
      if (now - sendT > 100) { sendT = now; send(); }
    }
    function stop(by) {
      if (phase !== 'live') return;
      phase = 'done'; ctx.cancel(loop); w = 0; a = Math.round(a); stopBy = by; send();
      result = {};
      ids.forEach(id => {
        const i = read(id); result[id] = valueAt(i);
        if (id === by && segs[i] === 'DOUBLE') ctx.give(id, 'shield');
      });
      ctx.log(by ? `${ctx.name(by)}'s brake stops the wheel` : 'The wheel stops on its own');
      ctx.push(); ctx.after(4500, () => ctx.end(result));
    }
    return {
      start() {
        t0 = ctx.now() + LEAD; ctx.deadline(LEAD); ctx.push();
        ctx.after(LEAD, () => { phase = 'live'; ctx.deadline(0); last = ctx.now(); send(); ctx.push(); loop = ctx.every(20, tick); });
      },
      act(pid, x) {
        if (phase !== 'live' || !x.brake || pressed[pid]) return;
        tick(); if (phase !== 'live') return;
        pressed[pid] = ctx.now(); w *= BRAKE;
        ctx.log(`${ctx.name(pid)} hits the brake`);
        if (w < STOP) return stop(pid);
        send(); ctx.push();
      },
      view() { return { phase, t0, segs, off, pressed, stopBy, result, a, n: N, c1: C1, c0: C0 }; }
    };
  }
};
