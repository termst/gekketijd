'use strict';
// Drop Dead 4: Tilt
const { RHS, slotValues, liveBoards } = require('../lib');
const SLOTS = 12, LEAD = 2500, SAFE = 3;
module.exports = {
  id: 'tilt', cat: 'drop', name: 'Tilt',
  rules: [
    'Everyone has their own board and puck, dropping live. You have 3 nudges that tilt your board left or right.',
    'A 4th nudge triggers TILT and destroys your puck.',
    'You can spend 1 of your nudges on a rival\'s board instead of your own.',
    'Finishing with 0 nudges used grants +3x on top of your slot.'
  ],
  create(ctx) {
    const ids = ctx.ids, vals = slotValues(ctx, SLOTS, 0), x0 = 200 + ctx.rand() * 200;
    const boards = {}, used = {}, rival = {}, tilted = {}, nudges = [];
    ids.forEach((id, i) => { boards[id] = new RHS.Board({ slots: SLOTS, g: 900 }); used[id] = 0; rival[id] = false; tilted[id] = false; });
    let phase = 'lead', loop = null, t0 = 0;
    function idle() {
      if (phase !== 'live') return;
      phase = 'done'; ctx.cancel(loop); ctx.deadline(0);
      const res = {};
      ids.forEach(id => { const p = boards[id].pucks[0]; res[id] = tilted[id] || !p || p.dead ? 0 : vals[p.slot] + (used[id] === 0 ? SAFE : 0); });
      ctx.push(); ctx.after(3500, () => ctx.end(res));
    }
    return {
      start() {
        t0 = ctx.now() + LEAD; ctx.deadline(LEAD); ctx.push();
        ctx.after(LEAD, () => {
          phase = 'live'; ctx.deadline(0);
          ids.forEach((id, i) => boards[id].addPuck(i + 1, id, x0));
          loop = liveBoards(ctx, boards, () => ctx.push(), idle, 'b');
          ctx.push();
        });
      },
      act(pid, a) {
        if (phase !== 'live' || tilted[pid]) return;
        const dir = a.nudge === -1 ? -1 : a.nudge === 1 ? 1 : 0; if (!dir) return;
        const target = a.board && a.board !== pid ? a.board : pid;
        if (target !== pid) {
          if (!ids.includes(target) || rival[pid]) return;
          const tp = boards[target].pucks[0]; if (!tp || tp.done || tp.dead) return;
          rival[pid] = true; used[pid]++;
          if (ctx.attack(pid, target, 'a nudge')) { boards[target].nudge(dir); ctx.log(`${ctx.name(pid)} nudges ${ctx.name(target)}'s board ${dir < 0 ? 'left' : 'right'}`); }
          nudges.push({ pid, target, dir, at: ctx.now() });
        } else {
          const p = boards[pid].pucks[0]; if (!p) return;
          if (used[pid] < 3 && (p.done || p.dead)) return;
          used[pid]++;
          if (used[pid] < 4) { boards[pid].nudge(dir); nudges.push({ pid, target: pid, dir, at: ctx.now() }); }
        }
        if (used[pid] >= 4) {
          tilted[pid] = true; const p = boards[pid].pucks[0]; if (p) p.dead = true;
          ctx.log(`TILT. ${ctx.name(pid)}'s puck is destroyed`);
        }
        ctx.push();
      },
      view() {
        return { phase, t0, vals, slots: SLOTS, used, rival, tilted, nudges: nudges.slice(-10),
          landed: Object.fromEntries(ids.map(id => { const p = boards[id].pucks[0]; return [id, p && p.done ? p.slot : null]; })) };
      }
    };
  }
};
