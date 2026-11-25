'use strict';
// Spare Change 1: Minority Rules
module.exports = {
  id: 'minority', cat: 'spare', name: 'Minority Rules',
  rules: [
    'Secretly pick Red or Blue. The fewer players on a side, the higher its multiplier (1 player gets 8x, a crowd shares 2x).',
    'After the reveal and before the flip, a Swap token forces one rival to the other side. Everyone gets 1 free token, plus any you won earlier.',
    'If everyone picks the same side, a Rescue Flip doubles that side.',
    'Winning side pays its multiplier. The losing side keeps 1x.'
  ],
  create(ctx) {
    const ids = ctx.ids, picks = {}, free = {}, done = {}, swaps = [];
    let phase = 'pick', flip = null, flipAt = 0, rescue = false, mult = { red: 0, blue: 0 };
    ids.forEach(id => free[id] = 1);
    const other = s => (s === 'red' ? 'blue' : 'red');
    const count = s => ids.filter(id => picks[id] === s).length;
    const multFor = k => (k ? Math.max(2, Math.round(8 / k)) : 0);
    const tokens = id => free[id] + (ctx.items(id).swap || 0);
    const recompute = () => { mult = { red: multFor(count('red')), blue: multFor(count('blue')) }; if (rescue) mult[picks[ids[0]]] *= 2; };

    function reveal() {
      if (phase !== 'pick') return;
      ids.forEach(id => { if (!picks[id]) picks[id] = ctx.rand() < 0.5 ? 'red' : 'blue'; });
      rescue = ids.length > 0 && ids.every(id => picks[id] === picks[ids[0]]);
      recompute();
      if (rescue) {
        ctx.log(`Everyone picked ${picks[ids[0]]}. Rescue Flip: that side is doubled to ${mult[picks[ids[0]]]}x`);
        return doFlip();
      }
      phase = 'swap'; ctx.deadline(9000); ctx.after(9000, applySwaps);
      ctx.log('Picks revealed. Use a Swap token now, before the flip.');
      ctx.push();
    }
    function applySwaps() {
      if (phase !== 'swap') return;
      for (const [from, to] of swaps) {
        if (ctx.attack(from, to, 'a Swap')) { picks[to] = other(picks[to]); ctx.log(`${ctx.name(from)} swaps ${ctx.name(to)} to ${picks[to]}`); }
      }
      recompute(); doFlip();
    }
    function doFlip() {
      phase = 'flip'; flip = ctx.rand() < 0.5 ? 'red' : 'blue'; flipAt = ctx.now() + 3000; ctx.deadline(0);
      ctx.after(3200, () => {
        phase = 'done'; ctx.log(`The coin lands ${flip.toUpperCase()}`); ctx.push();
        const res = {}; ids.forEach(id => res[id] = picks[id] === flip ? mult[flip] : 1);
        ctx.after(2500, () => ctx.end(res));
      });
      ctx.push();
    }
    return {
      start() { ctx.deadline(10000); ctx.after(10000, reveal); },
      act(pid, a) {
        if (phase === 'pick' && (a.side === 'red' || a.side === 'blue')) {
          picks[pid] = a.side; ctx.push();
          if (ids.every(id => picks[id])) ctx.after(400, reveal);
        } else if (phase === 'swap' && !done[pid]) {
          if (a.swap && a.swap !== pid && ids.includes(a.swap)) {
            if (free[pid] > 0) free[pid]--; else if (!ctx.take(pid, 'swap')) return;
            swaps.push([pid, a.swap]); ctx.log(`${ctx.name(pid)} plays a Swap token`);
          }
          if (a.swap || a.pass) {
            done[pid] = true; ctx.push();
            if (ids.every(id => done[id] || tokens(id) < 1)) ctx.after(300, applySwaps);
          }
        }
      },
      view(pid) {
        const open = phase !== 'pick';
        return {
          phase, flip: phase === 'done' ? flip : null, flipSide: flip, flipAt, rescue,
          mine: pid ? picks[pid] || null : null,
          picks: open ? picks : null, picked: ids.filter(id => picks[id]),
          live: open ? mult : { red: multFor(1), blue: multFor(ids.length) },
          tokens: pid ? tokens(pid) : 0, acted: pid ? !!done[pid] : true
        };
      }
    };
  }
};
