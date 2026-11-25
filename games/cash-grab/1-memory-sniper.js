'use strict';
// Cash Grab 1: Memory Sniper
const { pool } = require('../lib');
const N = 108, COLS = 12, PREVIEW = 3000, WAVE = 1100, SHOOT_MS = 15000, BOMB_MS = 8000;
module.exports = {
  id: 'sniper', cat: 'grab', name: 'Memory Sniper',
  rules: [
    '108 multipliers are shown for 3 seconds, then hidden and shuffled in front of you. Track the big ones.',
    'Shoot a target to claim it. The first shot claims it and locks it for everyone else.',
    '5 hidden bomb targets are in the gallery. Hit one and you pick a rival whose multiplier gets halved.',
    'The single golden target is marked in the preview. Hitting it grants a free extra shot.'
  ],
  create(ctx) {
    const vals = ctx.shuffle(pool([[5, 26], [7, 18], [10, 18], [15, 12], [20, 10], [25, 7], [50, 6], [75, 3], [100, 2]])).slice(0, N - 6);
    const T = vals.map((v, i) => ({ id: i, v, kind: 'val', shown: v }));
    for (let i = 0; i < 5; i++) T.push({ id: T.length, v: 0, kind: 'bomb', shown: ctx.pick([5, 7, 10, 15, 20, 25]) });
    T.push({ id: T.length, v: ctx.pick([25, 50, 75]), kind: 'gold', shown: 0 });
    const gold = T[T.length - 1]; gold.shown = gold.v;
    // Random ids so hidden cards leak nothing about their kind
    const perm = ctx.shuffle([...Array(N).keys()]); T.forEach((t, i) => t.id = perm[i]); T.sort((a, b) => a.id - b.id);
    // position -> target id
    let at = ctx.shuffle(T.map(t => t.id));
    const init = at.slice();
    const waves = [], shots = {}, got = {}, halves = {}, bombs = {};
    ctx.ids.forEach(id => { shots[id] = 1; got[id] = []; halves[id] = 0; });
    let phase = 'preview', start = 0;
    // Three visible shuffle waves: row rotation, column swap, random pair swaps
    function makeWaves() {
      const rows = N / COLS;
      let w = at.slice(); const r = [];
      for (let y = 0; y < rows; y++) { const k = 1 + ctx.rnd(COLS - 1), row = w.slice(y * COLS, y * COLS + COLS); for (let x = 0; x < COLS; x++) r[y * COLS + x] = row[(x + k) % COLS]; }
      waves.push(r.slice()); w = r.slice();
      const cols = ctx.shuffle([...Array(COLS).keys()]), c = [];
      for (let y = 0; y < rows; y++) for (let x = 0; x < COLS; x++) c[y * COLS + x] = w[y * COLS + cols[x]];
      waves.push(c.slice()); w = c.slice();
      for (let i = 0; i < 30; i++) { const a = ctx.rnd(N), b = ctx.rnd(N); [w[a], w[b]] = [w[b], w[a]]; }
      waves.push(w.slice()); at = w;
    }
    function finish() {
      if (phase === 'done') return; phase = 'done'; ctx.deadline(0);
      const res = {};
      ctx.ids.forEach(id => { let m = got[id].reduce((a, t) => a + T[t].v, 0); for (let i = 0; i < halves[id]; i++) m /= 2; res[id] = m; });
      ctx.push(); ctx.after(3500, () => ctx.end(res));
    }
    function check() {
      if (phase !== 'shoot') return;
      if (ctx.ids.every(id => shots[id] <= 0) && !Object.keys(bombs).length) finish();
    }
    function bombHit(pid, target) {
      delete bombs[pid];
      if (target && ctx.ids.includes(target) && target !== pid && ctx.attack(pid, target, 'a bomb')) {
        halves[target]++; ctx.log(`${ctx.name(pid)} bombs ${ctx.name(target)}: multiplier halved`);
      }
      ctx.push(); check();
    }
    function shoot(pid, posi) {
      const tid = at[posi]; if (tid === undefined) return;
      const t = T[tid]; if (t.owner) return;
      t.owner = pid; shots[pid]--; got[pid].push(tid);
      if (t.kind === 'gold') { shots[pid]++; ctx.log(`${ctx.name(pid)} hits the golden target (${t.v}x) and gets a free extra shot`); }
      else if (t.kind === 'bomb') {
        const rivals = ctx.ids.filter(x => x !== pid);
        ctx.log(`${ctx.name(pid)} hits a bomb`);
        if (rivals.length) { bombs[pid] = ctx.after(BOMB_MS, () => bombHit(pid, ctx.pick(rivals))); }
      } else ctx.log(`${ctx.name(pid)} claims ${t.v}x`);
      ctx.push(); check();
    }
    return {
      start() {
        makeWaves();
        ctx.deadline(PREVIEW);
        ctx.after(PREVIEW, () => { phase = 'shuffle'; start = ctx.now(); ctx.deadline(0); ctx.push(); });
        ctx.after(PREVIEW + WAVE * 3 + 400, () => {
          phase = 'shoot'; ctx.deadline(SHOOT_MS); ctx.push();
          ctx.after(SHOOT_MS, () => {
            // Unused shots fire at a random open target, open bomb choices resolve at random
            for (const id of ctx.ids) while (shots[id] > 0) { const open = at.map((t, i) => i).filter(i => !T[at[i]].owner); if (!open.length) break; shoot(id, ctx.pick(open)); }
            for (const id of Object.keys(bombs)) { ctx.cancel(bombs[id]); const r = ctx.ids.filter(x => x !== id); bombHit(id, r.length ? ctx.pick(r) : null); }
            finish();
          });
        });
      },
      act(pid, a) {
        if (phase !== 'shoot') return;
        if (a.bomb !== undefined && bombs[pid]) { ctx.cancel(bombs[pid]); return bombHit(pid, a.bomb); }
        if (Number.isInteger(a.shoot) && shots[pid] > 0 && !bombs[pid]) shoot(pid, a.shoot);
      },
      view(pid) {
        const showAll = phase === 'preview' || phase === 'done';
        const cards = (phase === 'preview' || phase === 'shuffle' ? init : at).map(tid => {
          const t = T[tid];
          if (showAll || t.owner) return { id: tid, v: phase === 'preview' ? t.shown : t.v, k: phase === 'preview' ? (t.kind === 'gold' ? 'gold' : 'val') : t.kind, o: t.owner || null };
          return { id: tid };
        });
        return { phase, cols: COLS, cards, waves: phase === 'shuffle' ? waves : null, start, wave: WAVE, shots, halves, bomb: pid ? !!bombs[pid] : false,
          got: Object.fromEntries(ctx.ids.map(id => [id, got[id].reduce((a, t) => a + T[t].v, 0)])) };
      }
    };
  }
};
