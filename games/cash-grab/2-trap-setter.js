'use strict';
// Cash Grab 2: Trap Setter
const { pool } = require('../lib');
const N = 36, TRAP_MS = 15000, PICK_MS = 12000;
module.exports = {
  id: 'traps', cat: 'grab', name: 'Trap Setter',
  rules: [
    'Trap: place 2 secret traps on the 36 targets.',
    'Pick: choose 1 target. Players on the same target split its value.',
    'Hit: each rival trap on your pick costs you 3x and pays it to the trapper. Your own traps do nothing.',
    'Bonus: alone on a target nobody trapped is +2x.'
  ],
  create(ctx) {
    const ids = ctx.ids, vals = ctx.shuffle(pool([[2, 6], [3, 6], [5, 6], [8, 5], [10, 4], [15, 3], [20, 3], [30, 2], [50, 1]]));
    const traps = {}, picks = {}, lock = {};
    ids.forEach(id => traps[id] = []);
    let phase = 'trap', res = null, detail = null;
    function toPick() {
      if (phase !== 'trap') return;
      ids.forEach(id => { while (traps[id].length < 2) { const i = ctx.rnd(N); if (!traps[id].includes(i)) traps[id].push(i); } });
      phase = 'pick'; ctx.deadline(PICK_MS); ctx.after(PICK_MS, reveal); ctx.log('Traps are set. Now pick your target.'); ctx.push();
    }
    function reveal() {
      if (phase !== 'pick') return;
      ids.forEach(id => { if (picks[id] === undefined) picks[id] = ctx.rnd(N); });
      res = {}; detail = {}; ids.forEach(id => { res[id] = 0; detail[id] = []; });
      for (const id of ids) {
        const t = picks[id], same = ids.filter(x => picks[x] === t);
        res[id] += vals[t] / same.length; detail[id].push(`${Math.round(vals[t] / same.length * 10) / 10}x from target`);
        const setters = ids.filter(x => x !== id && traps[x].includes(t));
        for (const s of setters) {
          if (ctx.attack(s, id, 'a trap')) { res[id] -= 3; res[s] += 3; detail[id].push(`-3x trap by ${ctx.name(s)}`); detail[s].push(`+3x from ${ctx.name(id)}`); ctx.log(`${ctx.name(id)} walks into ${ctx.name(s)}'s trap`); }
        }
        const anyTrap = ids.some(x => traps[x].includes(t));
        if (!anyTrap && same.length === 1) { res[id] += 2; detail[id].push('+2x untouched target'); }
      }
      phase = 'done'; ctx.deadline(0); ctx.push();
      ctx.after(5000, () => ctx.end(res));
    }
    return {
      start() { ctx.deadline(TRAP_MS); ctx.after(TRAP_MS, toPick); },
      act(pid, a) {
        if (phase === 'trap' && Number.isInteger(a.trap) && a.trap >= 0 && a.trap < N && !lock[pid]) {
          const t = traps[pid], k = t.indexOf(a.trap);
          if (k >= 0) t.splice(k, 1); else if (t.length < 2) t.push(a.trap);
          ctx.push();
        } else if (phase === 'trap' && a.lock && traps[pid].length === 2) {
          lock[pid] = true; ctx.push(); if (ids.every(id => lock[id])) ctx.after(300, toPick);
        } else if (phase === 'pick' && Number.isInteger(a.pick) && a.pick >= 0 && a.pick < N) {
          picks[pid] = a.pick; ctx.push(); if (ids.every(id => picks[id] !== undefined)) ctx.after(500, reveal);
        }
      },
      view(pid) {
        const open = phase === 'done';
        return { phase, vals, myTraps: pid ? traps[pid] : [], myPick: pid ? picks[pid] : undefined, traps: open ? traps : null, picks: open ? picks : null,
          lock: ids.filter(id => lock[id]), picked: ids.filter(id => picks[id] !== undefined), res, detail };
      }
    };
  }
};
