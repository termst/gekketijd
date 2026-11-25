'use strict';
// Helpers shared by subgames.
const RHS = require('../public/shared.js');

// Build an array from [[value, count], ...]
const pool = spec => spec.flatMap(([v, n]) => Array(n).fill(v));

// Values for pachinko style slot rows
function slotValues(ctx, n, doubles = 0) {
  const vals = ctx.shuffle(pool([[5, 3], [7, 2], [10, 3], [15, 2], [20, 2], [25, 2], [30, 1], [50, 1], [75, 1], [100, 1]])).slice(0, n - doubles);
  for (let i = 0; i < doubles; i++) vals.splice(1 + ctx.rnd(vals.length - 1), 0, 'DOUBLE');
  return vals;
}

// Fixed step physics loop that streams frames to every client.
// onLand(puck) is called once for each puck that reaches a slot.
function liveBoards(ctx, boards, onLand, onIdle, tag = 'p') {
  const landed = new Set();
  let idle = 0;
  const id = ctx.every(16, () => {
    let any = false;
    for (const b of Object.values(boards)) {
      for (let i = 0; i < 2; i++) b.step(1 / 120);
      for (const p of b.pucks) {
        if (!p.done && !p.dead) any = true;
        if ((p.done || p.dead) && !landed.has(p.id)) { landed.add(p.id); onLand(p, b); }
      }
    }
    if (++idle % 3 === 0) {
      const d = {}; for (const [k, b] of Object.entries(boards)) d[k] = b.snap();
      ctx.fx({ [tag]: d });
    }
    if (!any && onIdle) onIdle();
  });
  return id;
}

module.exports = { RHS, pool, slotValues, liveBoards };
