'use strict';
// Productivitime 1: Flapper Draft
const { pool } = require('../lib');
const N = 64, OFF = [0, 16, 32, 48], NAMES = ['Green', 'Blue', 'Yellow', 'Purple'], PICK_MS = 8000, JAM_MS = 9000, SPIN_MS = 6000, MAX_RESPIN = 3;
module.exports = {
  id: 'draft', cat: 'prod', name: 'Flapper Draft',
  rules: [
    'Draft: pick 1 of 4 flappers. Lowest balance picks first.',
    'Split: players on the same flapper split its result. Alone is +50%.',
    'Jam: once, make a rival\'s flapper read 1 segment further.',
    'DOUBLE or TRIPLE: multiplies that flapper and spins again for it.'
  ],
  create(ctx) {
    const ids = ctx.ids;
    const segs = ctx.shuffle(pool([[10, 12], [15, 11], [20, 10], [25, 9], [50, 7], [75, 5], [100, 4], [200, 2], ['DOUBLE', 3], ['TRIPLE', 1]]));
    const order = ids.slice().sort((a, b) => ctx.balance(a) - ctx.balance(b));
    const pick = {}, jam = {}, jams = [0, 0, 0, 0], factor = [1, 1, 1, 1], value = [null, null, null, null];
    let phase = 'draft', turn = 0, tm = null, spins = [], top = ctx.rnd(N);
    function nextPick() {
      if (turn >= order.length) return jamPhase();
      ctx.deadline(PICK_MS); ctx.cancel(tm);
      tm = ctx.after(PICK_MS, () => choose(order[turn], ctx.rnd(4)));
      ctx.push();
    }
    function choose(pid, k) { pick[pid] = k; ctx.log(`${ctx.name(pid)} takes the ${NAMES[k]} flapper`); turn++; nextPick(); }
    function jamPhase() {
      if (ids.length < 2) return spin();
      phase = 'jam'; ctx.deadline(JAM_MS); tm = ctx.after(JAM_MS, spin); ctx.push();
    }
    function spin() {
      if (phase === 'spin' || phase === 'done') return;
      ctx.cancel(tm);
      if (phase === 'jam') {
        for (const [from, to] of Object.entries(jam)) {
          if (to && ctx.attack(from, to, 'a Jam card')) { jams[pick[to]]++; ctx.log(`${ctx.name(from)} jams ${ctx.name(to)}'s ${NAMES[pick[to]]} flapper`); }
        }
      }
      phase = 'spin'; ctx.deadline(0); doSpin(true);
    }
    function doSpin(first) {
      const from = top; top = ctx.rnd(N);
      const active = [0, 1, 2, 3].filter(k => value[k] === null);
      const reads = {};
      active.forEach(k => { const skip = first ? jams[k] : 0; reads[k] = (top + OFF[k] + skip) % N; });
      spins.push({ from, to: top, at: ctx.now(), dur: SPIN_MS, reads, active });
      ctx.push();
      ctx.after(SPIN_MS + 600, () => {
        let again = false;
        for (const k of active) {
          const s = segs[reads[k]];
          if (s === 'DOUBLE' || s === 'TRIPLE') {
            factor[k] *= s === 'DOUBLE' ? 2 : 3;
            if (spins.length > MAX_RESPIN) value[k] = 25 * factor[k]; else again = true;
            ctx.log(`${NAMES[k]} hits ${s}: x${factor[k]}`);
          } else value[k] = s * factor[k];
        }
        ctx.push();
        if (again) return ctx.after(1500, () => doSpin(false));
        phase = 'done';
        const res = {};
        ids.forEach(id => {
          const k = pick[id], share = ids.filter(x => pick[x] === k).length;
          res[id] = (value[k] || 0) / share * (share === 1 ? 1.5 : 1);
        });
        ctx.push(); ctx.after(4000, () => ctx.end(res));
      });
    }
    return {
      start() { ctx.after(800, nextPick); },
      act(pid, a) {
        if (phase === 'draft' && pid === order[turn] && Number.isInteger(a.flapper) && a.flapper >= 0 && a.flapper < 4) { ctx.cancel(tm); choose(pid, a.flapper); }
        else if (phase === 'jam' && !(pid in jam)) {
          if (a.jam && a.jam !== pid && ids.includes(a.jam)) jam[pid] = a.jam; else if (a.pass) jam[pid] = null; else return;
          ctx.push(); if (ids.every(id => id in jam)) spin();
        }
      },
      view(pid) {
        return { phase, segs, off: OFF, names: NAMES, order, turn: order[turn] || null, pick, jamUsed: pid ? pid in jam : true,
          jammed: phase === 'jam' ? null : jams, factor, value, spins, top };
      }
    };
  }
};
