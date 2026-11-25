'use strict';
// Spare Change 3: Coin Duel
const PERIOD = 1700, WINDOW = 7000, LEAD = 2500, SPOT = { red: 0.2, blue: 0.8 }, PERFECT = 0.015;
// Triangle wave 0 -> 1 -> 0 over one period
const pos = (ms) => { const x = ((ms % PERIOD) + PERIOD) % PERIOD / PERIOD; return x < 0.5 ? x * 2 : 2 - x * 2; };
module.exports = {
  id: 'duel', cat: 'spare', name: 'Coin Duel',
  rules: [
    'Players face off in pairs. A coin spins and a marker sweeps the timing bar. Stop it as close to your color\'s sweet spot as you can.',
    'Your stop sets your multiplier, from 2x (far away) to 20x (dead on).',
    'The winner of each duel steals 25% of the loser\'s multiplier.',
    'A perfect stop wins a free Swap token. An odd player out duels the House.'
  ],
  PERIOD, WINDOW, SPOT,
  create(ctx) {
    const ids = ctx.shuffle(ctx.ids.slice()), duels = [];
    for (let i = 0; i < ids.length; i += 2) duels.push({ red: ids[i], blue: ids[i + 1] || 'house', stops: {}, done: false });
    let t0 = 0, phase = 'ready';
    const score = (p, side) => Math.max(0, 1 - Math.abs(p - SPOT[side]) / 0.6);
    const mult = s => Math.round((2 + 18 * s) * 10) / 10;
    const res = {};
    function stop(d, side, t) {
      if (d.stops[side]) return;
      const p = pos(t - t0); d.stops[side] = { p, s: score(p, side), m: mult(score(p, side)) };
      const pid = d[side];
      if (pid !== 'house' && Math.abs(p - SPOT[side]) <= PERFECT) { ctx.log(`${ctx.name(pid)} hits a perfect stop`); ctx.give(pid, 'swap'); }
      if (d.stops.red && d.stops.blue) settle(d);
      ctx.push();
    }
    function settle(d) {
      if (d.done) return; d.done = true;
      const r = d.stops.red, b = d.stops.blue;
      res[d.red] = r.m; res[d.blue] = b.m;
      if (r.m !== b.m) {
        const [w, l] = r.m > b.m ? ['red', 'blue'] : ['blue', 'red'], loser = d[l], winner = d[w];
        const take = Math.round(res[loser] * 0.25 * 10) / 10;
        if (loser === 'house' || ctx.attack(winner, loser, 'a 25% steal')) {
          res[winner] += take; res[loser] -= take; d.steal = { from: l, amt: take };
          ctx.log(`${ctx.name(winner)} beats ${ctx.name(loser)} and steals ${take}x`);
        }
        d.win = w;
      } else ctx.log(`${ctx.name(d.red)} and ${ctx.name(d.blue)} tie`);
      d.final = { red: Math.round(res[d.red] * 10) / 10, blue: Math.round(res[d.blue] * 10) / 10 };
      if (duels.every(x => x.done)) finish();
    }
    function finish() {
      if (phase === 'done') return; phase = 'done'; ctx.deadline(0); ctx.push();
      const out = {}; ctx.ids.forEach(id => out[id] = res[id] || 0);
      ctx.after(3500, () => ctx.end(out));
    }
    return {
      start() {
        t0 = ctx.now() + LEAD; phase = 'live'; ctx.deadline(LEAD + WINDOW);
        // The House stops at a random moment
        duels.forEach(d => { if (d.blue === 'house') ctx.after(LEAD + 600 + ctx.rnd(WINDOW - 1200), () => stop(d, 'blue', ctx.now())); });
        ctx.after(LEAD + WINDOW, () => {
          duels.forEach(d => ['red', 'blue'].forEach(side => { if (!d.stops[side]) { d.stops[side] = { p: -1, s: 0, m: 2 }; } }));
          duels.forEach(settle); finish();
        });
        ctx.push();
      },
      act(pid, a) {
        if (!a.stop || phase !== 'live') return;
        const now = ctx.now(); if (now < t0) return;
        const t = Math.max(now - 400, Math.min(now, +a.t || now));
        const d = duels.find(x => x.red === pid || x.blue === pid); if (!d) return;
        stop(d, d.red === pid ? 'red' : 'blue', Math.max(t, t0));
      },
      view() { return { phase, t0, period: PERIOD, window: WINDOW, spot: SPOT, perfect: PERFECT, duels }; }
    };
  }
};
