// Gekke Tijd game core: profiles, economy, lobbies, wheel, bonus host.
// Transport agnostic. Used by server.js (Node, WebSocket) and by the browser host (GitHub Pages, WebRTC).
// A conn is any object with { open: boolean, send(obj) }.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.RHCore = factory;
})(typeof self !== 'undefined' ? self : this, function (env) {
'use strict';
// env: { RHS, GAMES: { spare: [mod...], ... }, db: { profiles }, save(), dev }
const RHS = env.RHS, { TYPES, DIAL, BONUS_KEYS, BORING } = RHS;
const GAMES = env.GAMES, DEV = !!env.dev, db = env.db;
const GAME_BY_ID = {};
Object.values(GAMES).flat().forEach(g => GAME_BY_ID[g.id] = g);
// Short stable player id from a secret token (FNV-1a, two rounds).
function hash(s) { let a = 0x811c9dc5, b = 0x01000193 ^ s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b ^ c, 2246822519); } return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).slice(0, 8); }

// ---------------------------------------------------------------- Profiles and economy (Orra)
const saveSoon = () => env.save();
function profile(token, name) {
  let p = db.profiles[token];
  if (!p) p = db.profiles[token] = { name, bal: 500, xp: 0, lvl: 1, work: 1, claim: Date.now(), day: '', streak: 0, items: { swap: 0, shield: 0 } };
  if (name) p.name = name;
  p.items = p.items || { swap: 0, shield: 0 };
  p.won = p.won || 0; p.lost = p.lost || 0;   // lifetime: profit from winning bets, stakes lost
  p.saved = p.saved || 0;                      // lifetime: Orra saved to the wallet from fixed balance runs
  saveSoon();
  return p;
}
const CHIPS = [5, 10, 25, 100, 500];
const limit = p => 200 * p.lvl, need = p => 200 * p.lvl, rate = p => 10 * p.work, cap = p => 100 * p.work, upCost = p => 400 * p.work * p.work;
const pending = p => Math.max(0, Math.min(cap(p), Math.floor((Date.now() - p.claim) / 60000 * rate(p))));
const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
// Returns the level-up reward; the room pays it into the right balance (wallet or run balance).
function gainXp(p, stake) { p.xp += stake / 5; let got = 0; while (p.xp >= need(p)) { p.xp -= need(p); p.lvl++; got += 25 * (p.lvl - 1); } return got; }


// ---------------------------------------------------------------- Rooms
const rooms = new Map();
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_OK = /^[A-Z0-9]{4}$/;
function genCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; } while (rooms.has(c)); return c; }
const COLORS = ['#e8443a', '#3a8ee8', '#3ac46e', '#e8b23a', '#b45ae8', '#3ad6d6', '#e85aa8', '#a8d63a'];
const MAX_PLAYERS = 8;
// Run settings, chosen by the lobby creator. Every value is checked against these lists.
const RUN_OPTS = {
  start: [0, 500, 1000, 2500, 5000, 10000],   // 0: everyone plays with their own wallet
  bet: [5, 8, 12, 15, 20, 30],                // betting time, seconds
  spin: ['short', 'normal', 'long'],          // wheel spin time
  limit: ['level', 'none'],                   // max bet per round
  late: ['on', 'off'],                        // late buy-ins for bonus games
  boost: ['on', 'off'],                       // Prime Minute
  max: [2, 3, 4, 5, 6, 7, 8]                  // max players
};
const RUN_DEFAULT = { start: 0, bet: 8, spin: 'normal', limit: 'level', late: 'on', boost: 'on', max: 8 };
const SPIN_MS = { short: [2000, 4000], normal: [3000, 7000], long: [6000, 10000] };
const NO_LIMIT = 1e9;
function runCfg(c) {
  const out = { ...RUN_DEFAULT };
  if (c && typeof c === 'object') for (const k of Object.keys(RUN_OPTS)) if (RUN_OPTS[k].includes(c[k])) out[k] = c[k];
  return out;
}
// Buy-in window: when the wheel lands on a bonus field, players who did not back it can buy in late.
// Backers keep the edge: full multiplier, Prime Minute boost, an Edge Shield and the first turns.
const JOIN_MS = 7000, INTRO_MS = 2800, LATE_PAY = 0.6;
// Late cap as a share of the top backer's stake. Grows with how much of the table backed the field (25% to 50%).
const lateShare = (backers, online) => Math.min(0.5, 0.25 + 0.25 * backers / Math.max(1, online));
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const round2 = x => Math.round(x * 100) / 100;
// Wallet savings: in a fixed balance run part of every winning round is saved to the player's own wallet.
// It never touches the run balance, so gameplay is unchanged. The cut:
//   profit  = round win minus everything staked that round (betting all fields earns nothing)
//   eff     = k * ln(1 + profit / k), k = start / 4: big wins count less and less (diminishing returns)
//   rate    = 5% + 2.5% * log2(1 + multiplier), at most 20%: higher multipliers save a bigger share
//   cut     = eff * rate * (room left / run cap), so the share shrinks as the run cap fills up
// Solo tables save half. Caps: per run 100 + 8% of the start (max 1000), per day 1500 across all runs.
const VAULT_DAY = 1500;
const vaultCap = start => Math.min(1000, Math.round(100 + start * 0.08));
function vaultCut(start, profit, m, runGot, dayLeft) {
  const cap = vaultCap(start), left = Math.min(cap - runGot, dayLeft);
  if (profit <= 0 || left <= 0) return 0;
  const k = start / 4, eff = k * Math.log1p(profit / k), rate = Math.min(0.2, 0.05 + 0.025 * Math.log2(1 + m));
  return Math.max(0, Math.min(left, Math.floor(eff * rate * (cap - runGot) / cap)));
}

class Room {
  constructor(code, cfg) {
    this.cfg = runCfg(cfg); this.code = code; this.players = new Map(); this.phase = 'betting'; this.ends = 0; this.bets = {}; this.ready = new Set();
    this.boost = null; this.hist = []; this.dry = 0; this.spin = null; this.bonus = null; this.msg = ''; this.timer = null;
    this.last = {}; this.results = null; this.late = new Set(); this.passed = new Set(); this.spent = {}; this.round = 0; this.force = null; this.idle = null;
  }
  get online() { return [...this.players.values()].filter(p => p.conn && p.conn.open); }
  // A fixed starting balance gives every player a run balance for this lobby only; otherwise the wallet is used.
  bal(p) { return this.cfg.start ? p.run : p.prof.bal; }
  add(p, d) { if (this.cfg.start) p.run += d; else p.prof.bal += d; }
  // Fixed balance runs only: moves a share of the round profit into the player's own wallet.
  save(p, profit, m) {
    const pr = p.prof, today = dayKey();
    if (pr.vday !== today) { pr.vday = today; pr.vtoday = 0; }
    let cut = vaultCut(this.cfg.start, profit, m, p.vault || 0, VAULT_DAY - pr.vtoday);
    if (this.online.length < 2) cut = Math.floor(cut / 2);   // solo tables save half
    if (cut > 0) { pr.bal += cut; pr.saved += cut; pr.vtoday += cut; p.vault = (p.vault || 0) + cut; }
    return cut;
  }
  limit(pr) { return this.cfg.limit === 'none' ? NO_LIMIT : limit(pr); }
  // Lifetime stats: won is the profit on the field that hit, lost is every stake on other fields.
  tally(key, wins) {
    for (const [pid, b] of Object.entries(this.stakes || {})) {
      const p = this.players.get(pid); if (!p) continue;
      const spent = Object.values(b).reduce((a, x) => a + x, 0), stake = b[key] || 0, win = wins[pid] || 0;
      p.prof.won += Math.max(0, win - stake); p.prof.lost += spent - stake;
    }
  }
  join(conn, token, name) {
    const pid = hash(token);
    let p = this.players.get(pid);
    if (!p) {
      if (this.players.size >= this.cfg.max) return null;
      const used = new Set([...this.players.values()].map(x => x.color));
      p = { id: pid, token, color: COLORS.find(c => !used.has(c)) || COLORS[0] };
      this.players.set(pid, p);
    }
    if (this.cfg.start && p.run == null) p.run = this.cfg.start;
    p.conn = conn; p.prof = profile(token, name); p.name = p.prof.name;
    conn.send({ t: 'catalog', games: Object.fromEntries(Object.entries(GAMES).map(([k, a]) => [k, a.map(g => ({ id: g.id, name: g.name, rules: g.rules }))])) });
    clearTimeout(this.idle); this.idle = null;
    if (!this.timer && !this.bonus) this.startBetting();
    this.broadcast();
    return p;
  }
  left() {
    this.broadcast();
    if (this.phase === 'betting') this.checkReady();
    if (!this.online.length) this.idle = setTimeout(() => this.destroy(), 10 * 60000);
  }
  destroy() {
    clearTimeout(this.timer); if (this.bonus) this.bonus.kill();
    rooms.delete(this.code);
  }
  after(ms, fn) { clearTimeout(this.timer); this.ends = Date.now() + ms; this.timer = setTimeout(() => { this.timer = null; fn(); }, ms); }

  // ---- Core loop ----
  startBetting() {
    if (!this.online.length) { this.timer = null; this.phase = 'betting'; return; }   // paused until someone is back
    this.phase = 'betting'; this.round++; this.bets = {}; this.ready.clear(); this.spin = null;
    const r = Math.random();
    this.boost = this.cfg.boost === 'on' ? { k: RHS.KEYS[Math.floor(Math.random() * 8)], m: r < 0.7 ? 2 : r < 0.95 ? 3 : 5 } : null;
    this.msg = this.boost ? `Prime Minute: ${TYPES[this.boost.k].n} is boosted x${this.boost.m}` : 'Place your bets';
    this.after(this.cfg.bet * 1000, () => this.closeBets());
    this.broadcast();
  }
  checkReady() {
    const on = this.online;
    if (this.phase === 'betting' && on.length && on.every(p => this.ready.has(p.id))) this.closeBets();
  }
  closeBets() {
    if (this.phase !== 'betting') return;
    clearTimeout(this.timer); this.timer = null;
    this.stakes = {}; this.spent = {}; this.late = new Set();
    for (const p of this.players.values()) {
      const b = this.bets[p.id]; if (!b) continue;
      const tot = Object.values(b).reduce((a, x) => a + x, 0);
      if (!tot || tot > this.bal(p) || tot > this.limit(p.prof)) continue;
      this.add(p, -tot); p.levelUp = gainXp(p.prof, tot); this.add(p, p.levelUp); this.spent[p.id] = tot;
      this.stakes[p.id] = { ...b }; this.last[p.id] = { ...b };
    }
    saveSoon();
    const [lo, hi] = SPIN_MS[this.cfg.spin], idx = this.pickIndex(), dur = lo + Math.floor(Math.random() * (hi - lo + 1));
    this.spin = { idx, dur, at: Date.now(), turns: 3 + Math.floor(dur / 1600) };
    this.phase = 'spinning'; this.msg = 'No more bets';
    this.after(dur, () => this.landed());
    this.broadcast();
  }
  // Random, with two small leans:
  //   dry:   bonus fields get up to +40% weight after a run of 1s and 2s
  //   crowd: fields many players backed, or with a big share of the Orra, get up to 24% less (RHS.crowdWeights)
  pickIndex() {
    if (this.force) { const i = DIAL.indexOf(this.force.key); if (i >= 0) return i; }
    const lean = 1 + Math.min(0.4, 0.05 * this.dry), crowd = RHS.crowdWeights(this.stakes);
    const w = DIAL.map(k => (BONUS_KEYS.includes(k) ? lean : 1) * crowd[k]), sum = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; }
    return w.length - 1;
  }
  landed() {
    const key = DIAL[this.spin.idx], t = TYPES[key];
    this.hist.unshift(key); this.hist.length = Math.min(this.hist.length, 12);
    if (BORING.includes(key)) this.dry++; else if (BONUS_KEYS.includes(key)) this.dry = 0;
    this.phase = 'landed'; this.landedKey = key;
    if (t.pay) {
      const res = {};
      for (const [pid, b] of Object.entries(this.stakes)) if (b[key]) res[pid] = t.pay;
      this.msg = `${t.n}`;
      this.pay(key, res);
      return;
    }
    const ids = Object.keys(this.stakes).filter(pid => this.stakes[pid][key] > 0 && this.players.has(pid));
    if (!ids.length) {
      this.tally(key, {}); saveSoon();
      this.msg = `${t.n}. Nobody bet on it.`; this.results = { key, rows: [] };
      this.after(2500, () => this.startBetting()); this.broadcast(); return;
    }
    let pool = GAMES[key], g = pool[Math.floor(Math.random() * pool.length)];
    if (this.force && this.force.game && GAME_BY_ID[this.force.game]) g = GAME_BY_ID[this.force.game];
    this.force = null;
    const on = this.cfg.late === 'on' ? this.online.filter(p => !ids.includes(p.id)) : [];
    const top = Math.max(...ids.map(pid => this.stakes[pid][key])), share = lateShare(ids.length, ids.length + on.length);
    this.msg = `${t.n}: ${g.name}`;
    this.phase = 'intro'; this.nextGame = { id: g.id, name: g.name, cat: key, rules: g.rules, top, share, backers: ids };
    this.passed = new Set();
    this.go = () => this.startBonus(key, g, ids.concat([...this.late].filter(pid => this.players.has(pid))));
    this.after(on.length ? JOIN_MS : INTRO_MS, this.go);
    this.broadcast();
  }
  // res: { pid: multiplier }. Pays stake * (m * boost + 1), as in the base game.
  pay(key, res) {
    const rows = [], wins = {};
    for (const [pid, b] of Object.entries(this.stakes)) {
      const p = this.players.get(pid); if (!p) continue;
      const stake = b[key] || 0;
      const late = this.late.has(pid);
      let m = stake ? Math.max(0, round2(res[pid] || 0)) : 0;
      if (late) m = round2(m * LATE_PAY);
      else if (stake && this.boost && this.boost.k === key) m = round2(m * this.boost.m);
      const win = stake ? Math.round(stake * (m + 1)) : 0;
      this.add(p, win); wins[pid] = win;
      const spent = Object.values(b).reduce((a, x) => a + x, 0);
      const vault = this.cfg.start ? this.save(p, win - spent, m) : 0;
      rows.push({ id: pid, late, m, stake, win, spent, vault, lvl: p.levelUp || 0 });
      p.levelUp = 0;
    }
    this.tally(key, wins);
    rows.sort((a, b) => b.win - a.win);
    this.results = { key, rows };
    this.phase = 'payout'; saveSoon();
    this.after(BONUS_KEYS.includes(key) ? 5000 : 3500, () => this.startBetting());
    this.broadcast();
  }

  // Most a non-backer may buy in for: a share of the top stake, within balance and the level limit left this round.
  lateCap(p) {
    const n = this.nextGame;
    if (this.phase !== 'intro' || !n || this.cfg.late !== 'on' || n.backers.includes(p.id) || this.late.has(p.id) || this.passed.has(p.id)) return 0;
    const c = Math.min(Math.max(5, Math.floor(n.top * n.share / 5) * 5), this.bal(p), this.limit(p.prof) - (this.spent[p.id] || 0));   // never below one 5 chip
    return Math.max(0, c >= 5 ? Math.floor(c / 5) * 5 : 0);
  }

  // Start early once every online non-backer has bought in or chosen to watch.
  joinCheck() {
    const n = this.nextGame;
    if (this.phase !== 'intro' || !n) return;
    const open = this.online.filter(p => !n.backers.includes(p.id) && this.lateCap(p));
    if (!open.length && Date.now() < this.ends - 1200) this.after(1200, this.go);
  }

  // ---- Bonus host ----
  startBonus(key, mod, ids) {
    const room = this, timers = new Set();
    let done = false;
    const P = pid => room.players.get(pid);
    // Turn order: backers first, biggest stake first, then late joiners.
    const stakeOf = pid => (room.stakes[pid] && room.stakes[pid][key]) || 0;
    ids = ids.slice().sort((a, b) => (room.late.has(a) - room.late.has(b)) || stakeOf(b) - stakeOf(a));
    const edge = new Set(ids.filter(pid => !room.late.has(pid)));   // one free block per backer, this game only
    const inst = { id: mod.id, name: mod.name, cat: key, rules: mod.rules, log: [], ends: 0, ids, edge };
    const ctx = {
      ids: ids.slice(),
      rand: Math.random,
      rnd: n => Math.floor(Math.random() * n),
      pick: a => a[Math.floor(Math.random() * a.length)],
      shuffle,
      name: pid => (P(pid) ? P(pid).name : 'House'),
      color: pid => (P(pid) ? P(pid).color : '#888'),
      online: pid => !!(P(pid) && P(pid).conn && P(pid).conn.open),
      balance: pid => (P(pid) ? room.bal(P(pid)) : 0),
      stake: stakeOf,
      backer: pid => ids.includes(pid) && !room.late.has(pid),
      late: pid => room.late.has(pid),
      now: () => Date.now(),
      push: () => room.pushBonus(),
      after(ms, fn) { const t = setTimeout(() => { timers.delete(t); if (!done) { try { fn(); } catch (e) { console.error(e); } } }, ms); timers.add(t); return t; },
      every(ms, fn) { const t = setInterval(() => { if (!done) { try { fn(); } catch (e) { console.error(e); } } }, ms); timers.add(t); return t; },
      cancel(t) { clearTimeout(t); clearInterval(t); timers.delete(t); },
      deadline(ms) { inst.ends = ms ? Date.now() + ms : 0; },
      log(m) { inst.log.unshift(m); if (inst.log.length > 8) inst.log.pop(); },
      items: pid => (P(pid) ? P(pid).prof.items : { swap: 0, shield: 0 }),
      give(pid, item, n = 1) { const p = P(pid); if (!p) return; p.prof.items[item] = Math.min(9, (p.prof.items[item] || 0) + n); ctx.log(`${p.name} gains ${n > 1 ? n + ' ' : 'a '}${item === 'shield' ? 'Shield' : 'Swap token'}${n > 1 ? 's' : ''}`); saveSoon(); },
      take(pid, item) { const it = ctx.items(pid); if ((it[item] || 0) > 0) { it[item]--; saveSoon(); return true; } return false; },
      // Targeted attacks pass through this. A Shield blocks the next attack and is used up.
      attack(from, to, label) {
        if (from === to || !P(to)) return true;
        if (edge.has(to) && room.late.has(from)) { edge.delete(to); ctx.push(); ctx.log(`${ctx.name(to)}'s Edge Shield blocks ${label} from ${ctx.name(from)}`); return false; }
        const it = ctx.items(to);
        if (it.shield > 0) { it.shield--; saveSoon(); ctx.log(`${ctx.name(to)}'s Shield blocks ${label} from ${ctx.name(from)}`); return false; }
        return true;
      },
      fx(d) { for (const p of room.players.values()) if (p.conn) p.conn.send({ t: 'fx', g: inst.id, d }); },
      end(res) {
        if (done) return; done = true;
        timers.forEach(t => { clearTimeout(t); clearInterval(t); }); timers.clear();
        room.bonus = null;
        const out = {}; for (const pid of ids) out[pid] = round2(Math.max(0, res[pid] || 0));
        inst.final = out;
        room.msg = `${mod.name} is over`;
        room.lastBonus = { id: inst.id, name: inst.name, final: out };
        room.pay(key, out);
      }
    };
    inst.kill = () => { done = true; timers.forEach(t => { clearTimeout(t); clearInterval(t); }); };
    this.bonus = inst; this.phase = 'bonus'; this.ends = 0;
    inst.game = mod.create(ctx);
    this.broadcast();
    try { inst.game.start(); } catch (e) { console.error(e); ctx.end({}); }
    if (this.bonus === inst) this.pushBonus();
  }
  pushBonus() {
    const b = this.bonus; if (!b) return;
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      let v; try { v = b.game.view(b.ids.includes(p.id) ? p.id : null); } catch (e) { console.error(e); v = {}; }
      p.conn.send({
        t: 'bonus', id: b.id, name: b.name, cat: b.cat, rules: b.rules, ends: b.ends, now: Date.now(), log: b.log,
        me: p.id, part: b.ids.includes(p.id),
        players: b.ids.map(id => { const q = this.players.get(id); return { id, name: q ? q.name : '?', color: q ? q.color : '#888', shield: q ? q.prof.items.shield : 0, edge: b.edge.has(id), late: this.late.has(id), swap: q ? q.prof.items.swap : 0, stake: (this.stakes[id] || {})[b.cat] || 0 }; }),
        v
      });
    }
  }

  // ---- Client messages ----
  handle(p, m) {
    const pr = p.prof;
    if (m.t === 'bet' || m.t === 'bets' || m.t === 'unbet' || m.t === 'clear' || m.t === 'repeat') {
      if (this.phase !== 'betting' || this.ready.has(p.id)) return;
      const b = this.bets[p.id] = this.bets[p.id] || {};
      const tot = () => Object.values(b).reduce((a, x) => a + x, 0);
      if (m.t === 'bet' || m.t === 'bets') {
        // 'bets' places the same chip on a whole group of fields at once (the badge between 4 tickets).
        const keys = m.t === 'bet' ? [m.key] : Array.isArray(m.keys) ? [...new Set(m.keys)].slice(0, 4) : [];
        if (!keys.length || !keys.every(k => TYPES[k]) || !CHIPS.includes(m.amt)) return;
        const amt = m.amt * keys.length;
        if (this.bal(p) - tot() < amt) return p.conn.send({ t: 'err', msg: this.cfg.start ? 'Not enough Orra left in this run.' : 'Not enough Orra. Visit the Cashier.' });
        if (tot() + amt > this.limit(pr)) return p.conn.send({ t: 'err', msg: `Level ${pr.lvl}: maximum ${limit(pr)} Orra per round.` });
        for (const k of keys) b[k] = (b[k] || 0) + m.amt;
      } else if (m.t === 'unbet') delete b[m.key];
      else if (m.t === 'clear') this.bets[p.id] = {};
      else if (m.t === 'repeat') {
        const l = this.last[p.id] || {}, s = Object.values(l).reduce((a, x) => a + x, 0);
        if (!s) return; if (s > this.bal(p) || s > this.limit(pr)) return p.conn.send({ t: 'err', msg: 'Not enough Orra to repeat.' });
        this.bets[p.id] = { ...l };
      }
      return this.broadcast();
    }
    if (m.t === 'ready') {
      if (this.phase !== 'betting') return;
      this.ready.add(p.id); this.broadcast(); return this.checkReady();
    }
    if (m.t === 'buyin') {
      if (m.pass) { if (this.lateCap(p)) { this.passed.add(p.id); this.broadcast(); this.joinCheck(); } return; }
      const amt = Math.floor(+m.amt / 5) * 5, cap = this.lateCap(p);
      if (!cap) return;
      if (!(amt >= 5)) return;
      if (amt > cap) return p.conn.send({ t: 'err', msg: `You can buy in for at most ${cap} Orra.` });
      const key = this.nextGame.cat;
      this.add(p, -amt); const up = gainXp(pr, amt); this.add(p, up); p.levelUp = (p.levelUp || 0) + up;
      this.spent[p.id] = (this.spent[p.id] || 0) + amt;
      this.stakes[p.id] = { ...(this.stakes[p.id] || {}), [key]: amt };
      this.late.add(p.id); saveSoon();
      this.broadcast(); return this.joinCheck();
    }
    if (m.t === 'act') {
      if (this.bonus && this.bonus.ids.includes(p.id)) { try { this.bonus.game.act(p.id, m.a || {}); } catch (e) { console.error(e); } }
      return;
    }
    if (m.t === 'cashier') {
      if (this.cfg.start) return;   // fixed balance runs: the Cashier is closed
      const tot = Object.values(this.bets[p.id] || {}).reduce((a, x) => a + x, 0);
      if (m.op === 'collect') { pr.bal += pending(pr); pr.claim = Date.now(); }
      if (m.op === 'upgrade' && pr.work < 10 && pr.bal - tot >= upCost(pr)) { const pd = pending(pr); pr.bal += pd - upCost(pr); pr.claim = Date.now(); pr.work++; }
      if (m.op === 'daily' && pr.day !== dayKey()) { const next = pr.day === dayKey(Date.now() - 864e5) ? pr.streak + 1 : 1; pr.bal += 100 + 25 * Math.min(next - 1, 6); pr.day = dayKey(); pr.streak = next; }
      saveSoon(); return this.broadcast();
    }
    if (m.t === 'force' && DEV) { this.force = { key: m.key, game: m.game }; return; }
  }

  state(pid) {
    const me = this.players.get(pid), pr = me.prof;
    const today = pr.day === dayKey(), next = pr.day === dayKey(Date.now() - 864e5) ? pr.streak + 1 : 1;
    return {
      t: 'room', code: this.code, cfg: this.cfg, you: pid, dev: DEV, prof: pr, phase: this.phase, ends: this.ends, now: Date.now(), round: this.round,
      boost: this.boost, hist: this.hist, msg: this.msg, spin: this.spin, landed: this.phase === 'betting' ? null : this.landedKey,
      next: this.phase === 'intro' ? { ...this.nextGame, cap: this.lateCap(me), passed: this.passed.has(pid), late: [...this.late], latePay: LATE_PAY } : null, results: this.phase === 'payout' || this.phase === 'landed' ? this.results : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, online: !!(p.conn && p.conn.open), bal: this.bal(p), lvl: p.prof.lvl,
        bets: this.phase === 'betting' ? (this.bets[p.id] || {}) : ((this.stakes || {})[p.id] || {}),
        ready: this.ready.has(p.id), shield: p.prof.items.shield, swap: p.prof.items.swap
      })),
      me: {
        bal: this.bal(me), lvl: pr.lvl, xp: Math.floor(pr.xp), need: need(pr), limit: this.limit(pr), won: pr.won, lost: pr.lost, wallet: pr.bal, saved: pr.saved,
        vault: { run: me.vault || 0, cap: this.cfg.start ? vaultCap(this.cfg.start) : 0, today: pr.vday === dayKey() ? pr.vtoday : 0, day: VAULT_DAY }, items: pr.items, hasLast: !!Object.keys(this.last[pid] || {}).length,
        cashier: { closed: !!this.cfg.start, rate: rate(pr), cap: cap(pr), pending: pending(pr), work: pr.work, upCost: upCost(pr), today, day: today ? pr.streak : next, gift: 100 + 25 * Math.min(next - 1, 6) }
      }
    };
  }
  broadcast() { for (const p of this.players.values()) if (p.conn) p.conn.send(this.state(p.id)); if (this.bonus) this.pushBonus(); }
}


return { rooms, Room, genCode, profile, GAMES, CODE_OK, MAX_PLAYERS, RUN_OPTS, RUN_DEFAULT, runCfg, vaultCut, vaultCap };
});
