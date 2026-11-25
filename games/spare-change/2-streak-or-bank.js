'use strict';
// Spare Change 2: Streak or Bank
const MAX_CALLS = 8, TURN_MS = 9000;
module.exports = {
  id: 'streak', cat: 'spare', name: 'Streak or Bank',
  rules: [
    'Players take turns calling a coin flip. Each correct call adds +1x to your streak. A wrong call wipes the streak.',
    'Bank at any time to lock your streak in and leave. You have 8 calls; whatever is left on the last call is banked for you.',
    'When you bank you can pass the coin: that rival must make 1 extra call before they are allowed to bank.',
    'Reaching a 5 streak grants a Shield that blocks the next attack on you.'
  ],
  create(ctx) {
    const order = ctx.shuffle(ctx.ids.slice()), S = {};
    order.forEach(id => S[id] = { streak: 0, banked: 0, calls: 0, forced: 0, done: false, best: 0 });
    let turn = -1, last = null, tm = null, busy = false;
    const active = () => order[turn];

    function next() {
      if (order.every(id => S[id].done)) {
        const res = {}; order.forEach(id => res[id] = S[id].banked);
        ctx.deadline(0); ctx.push(); return ctx.after(1500, () => ctx.end(res));
      }
      do { turn = (turn + 1) % order.length; } while (S[order[turn]].done);
      busy = false; ctx.deadline(TURN_MS); ctx.cancel(tm);
      tm = ctx.after(TURN_MS, () => {
        const s = S[active()];
        if (s.streak > 0 && s.forced === 0) bank(active(), null); else call(active(), ctx.rand() < 0.5 ? 'red' : 'blue');
      });
      ctx.push();
    }
    function call(pid, side) {
      const s = S[pid]; busy = true; ctx.cancel(tm);
      const res = ctx.rand() < 0.5 ? 'red' : 'blue', ok = res === side;
      s.calls++; if (s.forced > 0) s.forced--;
      if (ok) {
        s.streak++; s.best = Math.max(s.best, s.streak);
        if (s.streak % 5 === 0) ctx.give(pid, 'shield');
      } else { if (s.streak) ctx.log(`${ctx.name(pid)} calls wrong and loses a ${s.streak} streak`); s.streak = 0; }
      last = { pid, side, res, ok, at: ctx.now(), n: s.calls };
      if (s.calls >= MAX_CALLS) { s.banked += s.streak; s.streak = 0; s.done = true; ctx.log(`${ctx.name(pid)} is out of calls and banks ${s.banked}x`); }
      ctx.deadline(0); ctx.push();
      ctx.after(1700, next);
    }
    function bank(pid, target) {
      const s = S[pid]; busy = true; ctx.cancel(tm);
      s.banked += s.streak; s.streak = 0; s.done = true;
      ctx.log(`${ctx.name(pid)} banks ${s.banked}x`);
      if (target && S[target] && !S[target].done && target !== pid && ctx.attack(pid, target, 'Pass the coin')) {
        S[target].forced++; ctx.log(`${ctx.name(pid)} passes the coin to ${ctx.name(target)}: 1 extra call before banking`);
      }
      last = null; ctx.push(); ctx.after(800, next);
    }
    return {
      start() { ctx.after(1200, next); },
      act(pid, a) {
        if (busy || pid !== active()) return;
        const s = S[pid];
        if (a.call === 'red' || a.call === 'blue') call(pid, a.call);
        else if (a.bank && s.streak > 0 && s.forced === 0) bank(pid, a.pass || null);
      },
      view() { return { order, S, turn: active() || null, last, busy, max: MAX_CALLS }; }
    };
  }
};
