'use strict';
// Drop Dead 2: Peg Builder
const { RHS, slotValues, liveBoards } = require('../lib');
const BUILD_MS = 15000, MAX_DOUBLES = 3;
module.exports = {
  id: 'pegs', cat: 'drop', name: 'Peg Builder',
  rules: [
    'Each player owns 2 slots at the bottom. Before the drop, place 2 extra pegs anywhere on the board.',
    'Use your pegs to steer the puck to your slots, or to block the paths that lead to rivals\' slots. Pegs show up live.',
    'One shared puck drops. The owner of the slot it lands in collects its value.',
    'The neutral DOUBLE slot doubles every slot and drops the puck again.'
  ],
  create(ctx) {
    const ids = ctx.ids, n = Math.max(13, ids.length * 2 + 1);
    const nums = slotValues(ctx, n - 1, 0);
    while (nums.length < n - 1) nums.push(ctx.pick([5, 10, 15, 20]));
    const dbl = 3 + ctx.rnd(n - 6);
    const vals = nums.slice(); vals.splice(dbl, 0, 'DOUBLE');
    const owner = Array(n).fill(null);
    const free = ctx.shuffle([...Array(n).keys()].filter(i => i !== dbl));
    ids.forEach(id => { owner[free.pop()] = id; owner[free.pop()] = id; });
    const extra = {}, lock = {};
    ids.forEach(id => extra[id] = []);
    let phase = 'build', board = null, loop = null, doubles = 0, res = {}, landed = null;
    ids.forEach(id => res[id] = 0);
    const allPegs = () => RHS.basePegs().concat(...ids.map(id => extra[id]));
    function dropPuck() {
      board.pucks = []; board.t = 0;
      board.addPuck(1, null, 240 + ctx.rand() * 120);
      ctx.push();
    }
    function onLand(p) {
      const v = vals[p.slot]; landed = p.slot;
      if (v === 'DOUBLE' && doubles < MAX_DOUBLES) {
        doubles++;
        for (let i = 0; i < n; i++) if (vals[i] !== 'DOUBLE') vals[i] *= 2;
        ctx.log(`DOUBLE: every slot doubles. Dropping again.`);
        ctx.push();
        ctx.cancel(loop);
        ctx.after(1500, () => { board = new RHS.Board({ slots: n, pegs: allPegs() }); dropPuck(); loop = liveBoards(ctx, { main: board }, onLand); });
        return;
      }
      ctx.cancel(loop);
      if (v !== 'DOUBLE' && owner[p.slot]) { res[owner[p.slot]] += v; ctx.log(`The puck lands on ${v}x, owned by ${ctx.name(owner[p.slot])}`); }
      else ctx.log(v === 'DOUBLE' ? 'DOUBLE limit reached. Nobody collects.' : `The puck lands on ${v}x. Nobody owns it.`);
      phase = 'done'; ctx.push(); ctx.after(3500, () => ctx.end(res));
    }
    function go() {
      if (phase !== 'build') return;
      // Players who did not place both pegs get theirs placed at random
      ids.forEach(id => { let t = 0; while (extra[id].length < 2 && t++ < 200) { const x = 30 + ctx.rand() * 540, y = 140 + ctx.rand() * 440; if (RHS.pegSpotOk(allPegs(), x, y)) extra[id].push({ x: Math.round(x), y: Math.round(y) }); } });
      phase = 'drop'; ctx.deadline(0);
      board = new RHS.Board({ slots: n, pegs: allPegs() });
      dropPuck();
      loop = liveBoards(ctx, { main: board }, onLand);
    }
    return {
      start() { ctx.deadline(BUILD_MS); ctx.after(BUILD_MS, go); },
      act(pid, a) {
        if (phase !== 'build' || lock[pid]) return;
        if (a.peg && extra[pid].length < 2) {
          const x = Math.round(+a.peg.x), y = Math.round(+a.peg.y);
          if (RHS.pegSpotOk(allPegs(), x, y)) { extra[pid].push({ x, y }); ctx.push(); }
        } else if (Number.isInteger(a.unpeg)) { extra[pid].splice(a.unpeg, 1); ctx.push(); }
        else if (a.lock && extra[pid].length === 2) { lock[pid] = true; ctx.push(); if (ids.every(id => lock[id])) ctx.after(300, go); }
      },
      view() { return { phase, n, vals, owner, extra, lock: ids.filter(id => lock[id]), doubles, landed, res }; }
    };
  }
};
