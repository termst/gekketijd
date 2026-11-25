'use strict';
// Productivitime 3: Push Your Luck
const { pool } = require('../lib');
const SPIN_MS = 5000, DECIDE_MS = 10000, SPINS = 3, CAP = 2500, JACKPOT = 20000, CURSE = 0.25;
module.exports = {
  id: 'push', cat: 'prod', name: 'Push Your Luck',
  rules: [
    'The wheel spins and everyone takes the result. After each spin, secretly choose to cash out or stay.',
    'Staying multiplies the next spin by your current result. Landing on the red BUST segment makes everyone still in lose everything.',
    'Players who have cashed out can buy a Curse card for 25% of their result. It adds 1 extra BUST segment to the wheel.',
    'Results are capped at 2,500x. The last player still in after 3 spins gets the 20,000x jackpot cap.'
  ],
  create(ctx) {
    const ids = ctx.ids;
    const segs = ctx.shuffle(pool([[1.5, 12], [2, 10], [3, 8], [5, 5], [10, 3], [25, 1], ['BUST', 1]]));
    const r = {}, inn = {}, choice = {}, curse = {};
    ids.forEach(id => { r[id] = 0; inn[id] = true; });
    let phase = 'spin', top = ctx.rnd(segs.length), spins = [], n = 0, bust = false, curses = [];
    const stillIn = () => ids.filter(id => inn[id]);
    function spin() {
      phase = 'spin'; ctx.deadline(0);
      const from = top; top = ctx.rnd(segs.length); n++;
      spins.push({ from, to: top, at: ctx.now(), dur: SPIN_MS }); ctx.push();
      ctx.after(SPIN_MS + 500, () => {
        const s = segs[top];
        if (s === 'BUST') {
          bust = true;
          stillIn().forEach(id => { r[id] = 0; inn[id] = false; });
          ctx.log('BUST. Everyone still in loses everything.');
          return finish();
        }
        stillIn().forEach(id => { r[id] = n === 1 ? s : Math.round(r[id] * s * 100) / 100; });
        ctx.log(`Spin ${n}: ${s}x`);
        if (n >= SPINS || !stillIn().length) return finish();
        phase = 'decide'; Object.keys(choice).forEach(k => delete choice[k]); Object.keys(curse).forEach(k => delete curse[k]);
        ctx.deadline(DECIDE_MS); ctx.after(DECIDE_MS, resolve); ctx.push();
      });
    }
    function resolve() {
      if (phase !== 'decide') return;
      for (const id of stillIn()) if (choice[id] === 'cash') { inn[id] = false; ctx.log(`${ctx.name(id)} cashes out at ${r[id]}x`); }
      for (const id of ids) {
        if (!curse[id] || inn[id]) continue;
        const free = segs.map((s, i) => i).filter(i => segs[i] !== 'BUST');
        const i = ctx.pick(free); segs[i] = 'BUST'; curses.push(i);
        r[id] = Math.round(r[id] * (1 - CURSE) * 100) / 100;
        ctx.log(`${ctx.name(id)} buys a Curse card: one more BUST segment`);
      }
      if (!stillIn().length) return finish();
      ctx.after(1200, spin); phase = 'wait'; ctx.deadline(0); ctx.push();
    }
    function finish() {
      phase = 'done'; ctx.deadline(0);
      const last = !bust && n >= SPINS && stillIn().length === 1 ? stillIn()[0] : null;
      const res = {};
      ids.forEach(id => res[id] = Math.min(id === last ? JACKPOT : CAP, r[id]));
      if (last) ctx.log(`${ctx.name(last)} is the last one standing: 20,000x jackpot cap`);
      ctx.push(); ctx.after(4000, () => ctx.end(res));
    }
    return {
      start() { ctx.after(1000, spin); },
      act(pid, a) {
        if (phase !== 'decide') return;
        if (inn[pid] && (a.choice === 'stay' || a.choice === 'cash')) { choice[pid] = a.choice; if (a.choice === 'cash' && a.curse) curse[pid] = true; }
        else if (!inn[pid] && a.curse !== undefined && r[pid] > 0) curse[pid] = !!a.curse;
        else return;
        ctx.push();
        if (stillIn().every(id => choice[id])) ctx.after(400, resolve);
      },
      view(pid) {
        return { phase, segs, spins, top, n, max: SPINS, r, inn, bust, curses, cap: CAP, jackpot: JACKPOT,
          mine: pid ? { choice: choice[pid] || null, curse: !!curse[pid] } : null, decided: ids.filter(id => choice[id]) };
      }
    };
  }
};
