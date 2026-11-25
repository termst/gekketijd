'use strict';
// Drop Dead 3: Slot Auction
const { RHS, liveBoards } = require('../lib');
const START = 20, LOT_MS = 5000, EXTEND = 3000, STEAL_MS = 10000, PUCKS = 3;
module.exports = {
  id: 'auction', cat: 'drop', name: 'Slot Auction',
  rules: [
    'Start: everyone has 20x to spend.',
    'Auction: 8 slots are sold one by one, paid from your 20x. A bid in the last 3 seconds resets the timer to 3.',
    'Drop: 3 pucks. The owner of each hit slot collects its value. Result: what you kept plus what you collected.',
    'DOUBLE: its owner may steal 1 slot. A puck on DOUBLE doubles its owner\'s collected value.'
  ],
  create(ctx) {
    const ids = ctx.ids, vals = ctx.shuffle([5, 10, 15, 25, 30, 50, 75, 'DOUBLE']), n = vals.length;
    const owner = Array(n).fill(null), paid = Array(n).fill(0), mult = {}, won = {};
    ids.forEach(id => { mult[id] = START; won[id] = 0; });
    let phase = 'auction', lot = 0, high = null, lotEnds = 0, lotT = null, dropN = 0, board = null, loop = null, hits = [];
    const dslot = vals.indexOf('DOUBLE');
    function openLot() {
      high = null; lotEnds = ctx.now() + LOT_MS; ctx.deadline(LOT_MS);
      lotT = ctx.after(LOT_MS, closeLot); ctx.push();
    }
    function closeLot() {
      lotT = null;
      if (high) { owner[lot] = high.pid; paid[lot] = high.amt; mult[high.pid] -= high.amt; ctx.log(`${ctx.name(high.pid)} buys slot ${lot + 1} (${vals[lot]}) for ${high.amt}x`); }
      else ctx.log(`Slot ${lot + 1} (${vals[lot]}) gets no bids`);
      high = null; lot++;
      ctx.push();
      if (lot < n) ctx.after(700, openLot); else ctx.after(700, afterAuction);
    }
    function afterAuction() {
      const d = owner[dslot];
      if (d) { phase = 'steal'; ctx.deadline(STEAL_MS); ctx.after(STEAL_MS, drops); ctx.log(`${ctx.name(d)} owns DOUBLE and may steal a slot`); ctx.push(); }
      else drops();
    }
    function drops() {
      if (phase === 'drop' || phase === 'done') return;
      phase = 'drop'; ctx.deadline(0); next();
    }
    function next() {
      if (dropN >= PUCKS) {
        phase = 'done'; const res = {}; ids.forEach(id => res[id] = mult[id] + won[id]);
        ctx.push(); return ctx.after(3500, () => ctx.end(res));
      }
      dropN++;
      board = new RHS.Board({ slots: n });
      board.addPuck(dropN, null, 60 + ctx.rand() * 480);
      ctx.push();
      loop = liveBoards(ctx, { main: board }, p => {
        ctx.cancel(loop); hits.push(p.slot);
        const o = owner[p.slot], v = vals[p.slot];
        if (o && v === 'DOUBLE') { won[o] *= 2; ctx.log(`Puck ${dropN} hits DOUBLE: ${ctx.name(o)}'s winnings double to ${won[o]}x`); }
        else if (o) { won[o] += v; ctx.log(`Puck ${dropN} hits ${v}x for ${ctx.name(o)}`); }
        else ctx.log(`Puck ${dropN} hits an unowned slot`);
        ctx.push(); ctx.after(1200, next);
      });
    }
    return {
      start() { ctx.after(1500, openLot); },
      act(pid, a) {
        if (phase === 'auction' && lot < n && a.bid !== undefined && lotT) {
          const amt = Math.floor(+a.bid);
          if (!(amt >= 1) || amt > mult[pid] || (high && amt <= high.amt)) return;
          high = { pid, amt };
          if (lotEnds - ctx.now() < EXTEND) { ctx.cancel(lotT); lotEnds = ctx.now() + EXTEND; ctx.deadline(EXTEND); lotT = ctx.after(EXTEND, closeLot); }
          ctx.push();
        } else if (phase === 'steal' && pid === owner[dslot] && Number.isInteger(a.steal) && a.steal >= 0 && a.steal < n && a.steal !== dslot && owner[a.steal] !== pid) {
          const victim = owner[a.steal];
          if (!victim || ctx.attack(pid, victim, 'a slot steal')) { owner[a.steal] = pid; ctx.log(`${ctx.name(pid)} steals slot ${a.steal + 1} (${vals[a.steal]})${victim ? ' from ' + ctx.name(victim) : ''}`); }
          drops();
        } else if (phase === 'steal' && pid === owner[dslot] && a.skip) drops();
      },
      view() { return { phase, vals, owner, paid, mult, won, lot, high, dslot, dropN, pucks: PUCKS, hits }; }
    };
  }
};
