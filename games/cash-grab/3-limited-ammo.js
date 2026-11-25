'use strict';
// Cash Grab 3: Limited Ammo Bounty
const { pool } = require('../lib');
const ROWS = 8, COLS = 10, BULLETS = 3, GAME_MS = 30000, COOLDOWN = 1000;
module.exports = {
  id: 'ammo', cat: 'grab', name: 'Limited Ammo Bounty',
  rules: [
    'Everyone gets 3 bullets. The gallery is hidden. A shot claims the target it hits and reveals the entire row for everyone.',
    'Shooting a target another player already claimed steals it from them.',
    'Wait for information, or grab the high values before someone else does. You hold the sum of the targets you own at the end.',
    'Every bullet you keep unused until the end converts into a Shield.'
  ],
  create(ctx) {
    const ids = ctx.ids, cells = ctx.shuffle(pool([[2, 16], [3, 14], [5, 14], [8, 10], [10, 8], [15, 6], [25, 6], [50, 4], [100, 2]])).map(v => ({ v, o: null }));
    const rowOpen = Array(ROWS).fill(false), bullets = {}, cool = {}, hold = {};
    ids.forEach(id => { bullets[id] = BULLETS; cool[id] = 0; });
    let phase = 'live', lastShot = null;
    function finish() {
      if (phase === 'done') return; phase = 'done'; ctx.deadline(0);
      const res = {};
      ids.forEach(id => {
        res[id] = cells.reduce((a, c) => a + (c.o === id ? c.v : 0), 0);
        if (bullets[id] > 0) ctx.give(id, 'shield', bullets[id]);
      });
      ctx.push(); ctx.after(4000, () => ctx.end(res));
    }
    const over = () => ids.every(id => bullets[id] <= 0 || hold[id]);
    return {
      start() { ctx.deadline(GAME_MS); ctx.after(GAME_MS, finish); },
      act(pid, a) {
        if (phase !== 'live') return;
        if (a.hold) { hold[pid] = true; ctx.push(); if (over()) ctx.after(300, finish); return; }
        if (!Number.isInteger(a.shoot) || a.shoot < 0 || a.shoot >= cells.length) return;
        if (bullets[pid] <= 0 || hold[pid] || ctx.now() < cool[pid]) return;
        const c = cells[a.shoot]; if (c.o === pid) return;
        bullets[pid]--; cool[pid] = ctx.now() + COOLDOWN;
        const row = Math.floor(a.shoot / COLS); rowOpen[row] = true;
        if (!c.o) { c.o = pid; ctx.log(`${ctx.name(pid)} claims ${c.v}x and reveals row ${row + 1}`); }
        else if (ctx.attack(pid, c.o, 'a steal')) { ctx.log(`${ctx.name(pid)} steals ${c.v}x from ${ctx.name(c.o)}`); c.o = pid; }
        lastShot = { pid, i: a.shoot, at: ctx.now() };
        ctx.push();
        if (over()) ctx.after(600, finish);
      },
      view(pid) {
        const all = phase === 'done';
        return { phase, rows: ROWS, cols: COLS, bullets, hold, lastShot, cool: pid ? cool[pid] : 0,
          cells: cells.map((c, i) => (all || c.o || rowOpen[Math.floor(i / COLS)]) ? { v: c.v, o: c.o } : { o: null }),
          rowOpen, totals: Object.fromEntries(ids.map(id => [id, cells.reduce((a, c) => a + (c.o === id ? c.v : 0), 0)])) };
      }
    };
  }
};
