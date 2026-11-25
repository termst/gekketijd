'use strict';
// Spare Change 4: Weighted Coin
const POINTS = 10, BID_MS = 12000;
module.exports = {
  id: 'weighted', cat: 'spare', name: 'Weighted Coin',
  rules: [
    'Bid: pick Red or Blue and bid 0 to 10 points. Each point adds +5% chance to that side (5% to 95%).',
    'Pay: the winning side pays its multiplier. Its top bidder also gets the Top Slot multiplier.',
    'Keep: every unspent point pays 0.5x, win or lose.'
  ],
  create(ctx) {
    const ids = ctx.ids, bids = {}, lock = {};
    const M = [2, 3, 4, 5, 6, 8, 10];
    const mult = { red: ctx.pick(M), blue: ctx.pick(M) }, top = ctx.pick([2, 2, 3, 3, 5]);
    let phase = 'bid', flip = null, flipAt = 0, chance = 0.5;
    function reveal() {
      if (phase !== 'bid') return;
      ids.forEach(id => { if (!bids[id]) bids[id] = { side: ctx.rand() < 0.5 ? 'red' : 'blue', pts: 0 }; });
      const sum = s => ids.reduce((a, id) => a + (bids[id].side === s ? bids[id].pts : 0), 0);
      chance = Math.max(0.05, Math.min(0.95, 0.5 + 0.05 * (sum('red') - sum('blue'))));
      flip = ctx.rand() < chance ? 'red' : 'blue';
      phase = 'flip'; flipAt = ctx.now() + 3500; ctx.deadline(0);
      ctx.log(`Final odds: Red ${Math.round(chance * 100)}%, Blue ${Math.round((1 - chance) * 100)}%`);
      ctx.push();
      ctx.after(3700, () => {
        phase = 'done';
        const win = ids.filter(id => bids[id].side === flip), hi = Math.max(0, ...win.map(id => bids[id].pts));
        const res = {};
        ids.forEach(id => {
          const b = bids[id]; let m = 0;
          if (b.side === flip) { m = mult[flip]; if (hi > 0 && b.pts === hi) { m *= top; ctx.log(`${ctx.name(id)} takes the Top Slot x${top}`); } }
          res[id] = m + (POINTS - b.pts) * 0.5;
        });
        ctx.log(`The coin lands ${flip.toUpperCase()}`);
        ctx.push();
        ctx.after(3000, () => ctx.end(res));
      });
    }
    return {
      start() { ctx.deadline(BID_MS); ctx.after(BID_MS, reveal); },
      act(pid, a) {
        if (phase !== 'bid' || lock[pid]) return;
        if (a.side === 'red' || a.side === 'blue') {
          bids[pid] = { side: a.side, pts: Math.max(0, Math.min(POINTS, Math.floor(+a.pts || 0))) };
          if (a.lock) lock[pid] = true;
          ctx.push();
          if (ids.every(id => lock[id])) ctx.after(300, reveal);
        }
      },
      view(pid) {
        const open = phase !== 'bid';
        return { phase, mult, top, points: POINTS, flip: phase === 'done' ? flip : null, flipSide: open ? flip : null, flipAt, chance: open ? chance : null,
          mine: pid ? bids[pid] || null : null, locked: ids.filter(id => lock[id]), bids: open ? bids : null };
      }
    };
  }
};
