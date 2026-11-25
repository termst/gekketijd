'use strict';
// Drop Dead 1: Puck Wars
const { RHS, slotValues, liveBoards } = require('../lib');
const SLOTS = 12, DROP_MS = 8000, EXTRA_MS = 5000, MAX_PUCKS = 4;
module.exports = {
  id: 'puckwars', cat: 'drop', name: 'Puck Wars',
  rules: [
    'Everyone drops their own puck on the same board. Choose your position and your moment. Pucks collide and knock each other off course.',
    'Drop next to the leader (crown) to knock their puck away.',
    'You keep the value of the slot your puck lands in.',
    'Landing on DOUBLE doubles only your multiplier and grants you a second puck.'
  ],
  create(ctx) {
    const ids = ctx.ids, vals = slotValues(ctx, SLOTS, 2);
    const board = new RHS.Board({ slots: SLOTS });
    const P = {}; let pid0 = 1, phase = 'drop', loop = null, opened = 0;
    ids.forEach(id => P[id] = { x: 100 + ctx.rnd(400), left: 1, factor: 1, value: null, pucks: 0, until: 0, timer: null });
    const numeric = vals.filter(v => v !== 'DOUBLE');
    const leader = ids.slice().sort((a, b) => ctx.balance(b) - ctx.balance(a))[0];
    let pushT = 0;
    function drop(id) {
      const p = P[id]; if (p.left <= 0) return;
      p.left--; p.pucks++; ctx.cancel(p.timer); p.timer = null;
      board.addPuck(pid0++, id, p.x);
      ctx.push();
    }
    function onLand(puck) {
      const p = P[puck.owner], v = vals[puck.slot];
      if (v === 'DOUBLE') {
        if (p.pucks < MAX_PUCKS) {
          p.factor *= 2; p.left++; p.until = ctx.now() + EXTRA_MS;
          ctx.log(`${ctx.name(puck.owner)} lands on DOUBLE: now x${p.factor} with a second puck`);
          p.timer = ctx.after(EXTRA_MS, () => drop(puck.owner));
        } else { p.factor *= 2; p.value = Math.max(...numeric); ctx.log(`${ctx.name(puck.owner)} lands DOUBLE again and takes the top slot`); }
      } else { p.value = v; ctx.log(`${ctx.name(puck.owner)} lands on ${v}x${p.factor > 1 ? ' (x' + p.factor + ')' : ''}`); }
      ctx.push();
    }
    function idle() {
      if (phase !== 'drop' || ctx.now() < opened + DROP_MS) return;
      if (ids.some(id => P[id].left > 0)) return;
      phase = 'done'; ctx.cancel(loop); ctx.deadline(0);
      const res = {}; ids.forEach(id => res[id] = (P[id].value || 0) * P[id].factor);
      ctx.push(); ctx.after(3000, () => ctx.end(res));
    }
    return {
      start() {
        opened = ctx.now(); ctx.deadline(DROP_MS);
        ids.forEach(id => P[id].timer = ctx.after(DROP_MS, () => drop(id)));
        loop = liveBoards(ctx, { main: board }, onLand, idle);
      },
      act(pid, a) {
        const p = P[pid]; if (phase !== 'drop') return;
        if (typeof a.x === 'number') p.x = Math.max(RHS.PUCK_R, Math.min(RHS.BW - RHS.PUCK_R, a.x));
        if (a.drop && p.left > 0) drop(pid);
        else if (ctx.now() - pushT > 100) { pushT = ctx.now(); ctx.push(); }
      },
      view() {
        return { phase, vals, slots: SLOTS, pegs: board.pegs, leader, opened, dropMs: DROP_MS,
          P: Object.fromEntries(ids.map(id => [id, { x: P[id].x, left: P[id].left, factor: P[id].factor, value: P[id].value, until: P[id].until }])),
          owners: Object.fromEntries(board.pucks.map(p => [p.id, p.owner])) };
      }
    };
  }
};
