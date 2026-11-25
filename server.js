'use strict';
// Rare Hours multiplayer server. No dependencies: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const RHS = require('./public/shared.js');
const { TYPES, DIAL, BONUS_KEYS, BORING } = RHS;

const PORT = +process.env.PORT || 8080;
const DEV = process.env.DEV === '1';
const PUB = path.join(__dirname, 'public');
const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// ---------------------------------------------------------------- Subgames
// Every file in games/<category>/ exports { id, cat, name, rules, create(ctx) }.
const CATS = { spare: 'spare-change', grab: 'cash-grab', drop: 'drop-dead', prod: 'productivitime' };
const GAMES = {};
for (const [key, dir] of Object.entries(CATS)) {
  const full = path.join(__dirname, 'games', dir);
  GAMES[key] = fs.readdirSync(full).filter(f => f.endsWith('.js')).sort().map(f => require(path.join(full, f)));
  if (GAMES[key].length !== 4) console.warn(`Category ${key} has ${GAMES[key].length} subgames, expected 4`);
}
const GAME_BY_ID = {};
Object.values(GAMES).flat().forEach(g => GAME_BY_ID[g.id] = g);

// ---------------------------------------------------------------- Profiles and economy (Orra)
let db = { profiles: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
let saveT = null;
const saveSoon = () => { if (!saveT) saveT = setTimeout(() => { saveT = null; fs.writeFile(DB_FILE, JSON.stringify(db), () => {}); }, 1000); };
function profile(token, name) {
  let p = db.profiles[token];
  if (!p) p = db.profiles[token] = { name, bal: 500, xp: 0, lvl: 1, work: 1, claim: Date.now(), day: '', streak: 0, items: { swap: 0, shield: 0 } };
  if (name) p.name = name;
  p.items = p.items || { swap: 0, shield: 0 };
  saveSoon();
  return p;
}
const CHIPS = [5, 10, 25, 100, 500];
const limit = p => 200 * p.lvl, need = p => 200 * p.lvl, rate = p => 10 * p.work, cap = p => 100 * p.work, upCost = p => 400 * p.work * p.work;
const pending = p => Math.max(0, Math.min(cap(p), Math.floor((Date.now() - p.claim) / 60000 * rate(p))));
const dayKey = (t = Date.now()) => { const d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
function gainXp(p, stake) { p.xp += stake / 5; let got = 0; while (p.xp >= need(p)) { p.xp -= need(p); p.lvl++; got += 25 * (p.lvl - 1); } p.bal += got; return got; }

// ---------------------------------------------------------------- Minimal WebSocket
class Conn {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = []; this.onmsg = null; this.onclose = null; this.open = true;
    sock.setNoDelay(true);
    sock.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    const close = () => { if (this.open) { this.open = false; this.onclose && this.onclose(); } };
    sock.on('close', close); sock.on('error', close); sock.on('end', close);
  }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) return this.sock.destroy();
      const mo = off; if (masked) off += 4;
      if (b.length < off + len) return;
      const data = Buffer.from(b.subarray(off, off + len));
      if (masked) for (let i = 0; i < data.length; i++) data[i] ^= b[mo + (i & 3)];
      this.buf = b.subarray(off + len);
      if (op === 8) { this.sock.end(); return; }
      if (op === 9) { this.raw(0x8a, data); continue; }
      if (op === 1 || op === 0) {
        this.frag.push(data);
        if (fin) { const s = Buffer.concat(this.frag).toString('utf8'); this.frag = []; try { this.onmsg && this.onmsg(JSON.parse(s)); } catch (e) { console.error('msg error', e); } }
      }
    }
  }
  raw(op, data) {
    if (!this.open) return;
    const n = data.length; let h;
    if (n < 126) h = Buffer.from([op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    try { this.sock.write(Buffer.concat([h, data])); } catch {}
  }
  send(o) { this.raw(0x81, Buffer.from(JSON.stringify(o))); }
}

// ---------------------------------------------------------------- Rooms
const rooms = new Map();
const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_OK = /^[A-Z0-9]{4}$/;
function genCode() { let c; do { c = ''; for (let i = 0; i < 4; i++) c += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; } while (rooms.has(c)); return c; }
const COLORS = ['#e8443a', '#3a8ee8', '#3ac46e', '#e8b23a', '#b45ae8', '#3ad6d6', '#e85aa8', '#a8d63a'];
const MAX_PLAYERS = 8;
const BET_MS = 8000;
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const round2 = x => Math.round(x * 100) / 100;

class Room {
  constructor(code) {
    this.code = code; this.players = new Map(); this.phase = 'betting'; this.ends = 0; this.bets = {}; this.ready = new Set();
    this.boost = null; this.hist = []; this.dry = 0; this.spin = null; this.bonus = null; this.msg = ''; this.timer = null;
    this.last = {}; this.results = null; this.round = 0; this.force = null; this.idle = null;
  }
  get online() { return [...this.players.values()].filter(p => p.conn && p.conn.open); }
  join(conn, token, name) {
    const pid = crypto.createHash('sha1').update(token).digest('hex').slice(0, 8);
    let p = this.players.get(pid);
    if (!p) {
      if (this.players.size >= MAX_PLAYERS) return null;
      const used = new Set([...this.players.values()].map(x => x.color));
      p = { id: pid, token, color: COLORS.find(c => !used.has(c)) || COLORS[0] };
      this.players.set(pid, p);
    }
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
    this.boost = { k: RHS.KEYS[Math.floor(Math.random() * 8)], m: r < 0.7 ? 2 : r < 0.95 ? 3 : 5 };
    this.msg = `Prime Minute: ${TYPES[this.boost.k].n} is boosted x${this.boost.m}`;
    this.after(BET_MS, () => this.closeBets());
    this.broadcast();
  }
  checkReady() {
    const on = this.online;
    if (this.phase === 'betting' && on.length && on.every(p => this.ready.has(p.id))) this.closeBets();
  }
  closeBets() {
    if (this.phase !== 'betting') return;
    clearTimeout(this.timer); this.timer = null;
    this.stakes = {};
    for (const p of this.players.values()) {
      const b = this.bets[p.id]; if (!b) continue;
      const tot = Object.values(b).reduce((a, x) => a + x, 0);
      if (!tot || tot > p.prof.bal || tot > limit(p.prof)) continue;
      p.prof.bal -= tot; p.levelUp = gainXp(p.prof, tot);
      this.stakes[p.id] = { ...b }; this.last[p.id] = { ...b };
    }
    saveSoon();
    const idx = this.pickIndex(), dur = 3000 + Math.floor(Math.random() * 4001);   // 3 to 7 seconds
    this.spin = { idx, dur, at: Date.now(), turns: 3 + Math.floor(dur / 1600) };
    this.phase = 'spinning'; this.msg = 'No more bets';
    this.after(dur, () => this.landed());
    this.broadcast();
  }
  // Genuinely random, with a small boost to bonus fields that grows after each 1 or 3.
  pickIndex() {
    if (this.force) { const i = DIAL.indexOf(this.force.key); if (i >= 0) return i; }
    const lean = 1 + Math.min(0.4, 0.05 * this.dry);
    const w = DIAL.map(k => BONUS_KEYS.includes(k) ? lean : 1), sum = w.reduce((a, b) => a + b, 0);
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
      this.msg = `${t.n}. Nobody bet on it.`; this.results = { key, rows: [] };
      this.after(2500, () => this.startBetting()); this.broadcast(); return;
    }
    let pool = GAMES[key], g = pool[Math.floor(Math.random() * pool.length)];
    if (this.force && this.force.game && GAME_BY_ID[this.force.game]) g = GAME_BY_ID[this.force.game];
    this.force = null;
    this.msg = `${t.n}: ${g.name}`;
    this.phase = 'intro'; this.nextGame = { id: g.id, name: g.name, cat: key, rules: g.rules };
    this.after(2800, () => this.startBonus(key, g, ids));
    this.broadcast();
  }
  // res: { pid: multiplier }. Pays stake * (m * boost + 1), as in the base game.
  pay(key, res) {
    const rows = [];
    for (const [pid, b] of Object.entries(this.stakes)) {
      const p = this.players.get(pid); if (!p) continue;
      const stake = b[key] || 0;
      let m = stake ? Math.max(0, round2(res[pid] || 0)) : 0;
      if (stake && this.boost && this.boost.k === key) m = round2(m * this.boost.m);
      const win = stake ? Math.round(stake * (m + 1)) : 0;
      p.prof.bal += win;
      rows.push({ id: pid, m, stake, win, spent: Object.values(b).reduce((a, x) => a + x, 0), lvl: p.levelUp || 0 });
      p.levelUp = 0;
    }
    rows.sort((a, b) => b.win - a.win);
    this.results = { key, rows };
    this.phase = 'payout'; saveSoon();
    this.after(BONUS_KEYS.includes(key) ? 5000 : 3500, () => this.startBetting());
    this.broadcast();
  }

  // ---- Bonus host ----
  startBonus(key, mod, ids) {
    const room = this, timers = new Set();
    let done = false;
    const P = pid => room.players.get(pid);
    const inst = { id: mod.id, name: mod.name, cat: key, rules: mod.rules, log: [], ends: 0, ids };
    const ctx = {
      ids: ids.slice(),
      rand: Math.random,
      rnd: n => Math.floor(Math.random() * n),
      pick: a => a[Math.floor(Math.random() * a.length)],
      shuffle,
      name: pid => (P(pid) ? P(pid).name : 'House'),
      color: pid => (P(pid) ? P(pid).color : '#888'),
      online: pid => !!(P(pid) && P(pid).conn && P(pid).conn.open),
      balance: pid => (P(pid) ? P(pid).prof.bal : 0),
      stake: pid => (room.stakes[pid] && room.stakes[pid][key]) || 0,
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
        players: b.ids.map(id => { const q = this.players.get(id); return { id, name: q ? q.name : '?', color: q ? q.color : '#888', shield: q ? q.prof.items.shield : 0, swap: q ? q.prof.items.swap : 0, stake: (this.stakes[id] || {})[b.cat] || 0 }; }),
        v
      });
    }
  }

  // ---- Client messages ----
  handle(p, m) {
    const pr = p.prof;
    if (m.t === 'bet' || m.t === 'unbet' || m.t === 'clear' || m.t === 'repeat') {
      if (this.phase !== 'betting' || this.ready.has(p.id)) return;
      const b = this.bets[p.id] = this.bets[p.id] || {};
      const tot = () => Object.values(b).reduce((a, x) => a + x, 0);
      if (m.t === 'bet') {
        if (!TYPES[m.key] || !CHIPS.includes(m.amt)) return;
        if (pr.bal - tot() < m.amt) return p.conn.send({ t: 'err', msg: 'Not enough Orra. Visit the Cashier.' });
        if (tot() + m.amt > limit(pr)) return p.conn.send({ t: 'err', msg: `Level ${pr.lvl}: maximum ${limit(pr)} Orra per round.` });
        b[m.key] = (b[m.key] || 0) + m.amt;
      } else if (m.t === 'unbet') delete b[m.key];
      else if (m.t === 'clear') this.bets[p.id] = {};
      else if (m.t === 'repeat') {
        const l = this.last[p.id] || {}, s = Object.values(l).reduce((a, x) => a + x, 0);
        if (!s) return; if (s > pr.bal || s > limit(pr)) return p.conn.send({ t: 'err', msg: 'Not enough Orra to repeat.' });
        this.bets[p.id] = { ...l };
      }
      return this.broadcast();
    }
    if (m.t === 'ready') {
      if (this.phase !== 'betting') return;
      this.ready.add(p.id); this.broadcast(); return this.checkReady();
    }
    if (m.t === 'act') {
      if (this.bonus && this.bonus.ids.includes(p.id)) { try { this.bonus.game.act(p.id, m.a || {}); } catch (e) { console.error(e); } }
      return;
    }
    if (m.t === 'cashier') {
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
      t: 'room', code: this.code, you: pid, dev: DEV, phase: this.phase, ends: this.ends, now: Date.now(), round: this.round,
      boost: this.boost, hist: this.hist, msg: this.msg, spin: this.spin, landed: this.phase === 'betting' ? null : this.landedKey,
      next: this.phase === 'intro' ? this.nextGame : null, results: this.phase === 'payout' || this.phase === 'landed' ? this.results : null,
      players: [...this.players.values()].map(p => ({
        id: p.id, name: p.name, color: p.color, online: !!(p.conn && p.conn.open), bal: p.prof.bal, lvl: p.prof.lvl,
        bets: this.phase === 'betting' ? (this.bets[p.id] || {}) : ((this.stakes || {})[p.id] || {}),
        ready: this.ready.has(p.id), shield: p.prof.items.shield, swap: p.prof.items.swap
      })),
      me: {
        bal: pr.bal, lvl: pr.lvl, xp: Math.floor(pr.xp), need: need(pr), limit: limit(pr), items: pr.items, hasLast: !!Object.keys(this.last[pid] || {}).length,
        cashier: { rate: rate(pr), cap: cap(pr), pending: pending(pr), work: pr.work, upCost: upCost(pr), today, day: today ? pr.streak : next, gift: 100 + 25 * Math.min(next - 1, 6) }
      }
    };
  }
  broadcast() { for (const p of this.players.values()) if (p.conn) p.conn.send(this.state(p.id)); if (this.bonus) this.pushBonus(); }
}

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') return sock.destroy();
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  const c = new Conn(sock);
  let token = null, name = 'Player', room = null, me = null;
  c.onmsg = m => {
    if (m.t === 'ping') return c.send({ t: 'pong', c: m.c, s: Date.now() });
    if (m.t === 'hello') {
      token = String(m.token || '').slice(0, 64) || crypto.randomBytes(12).toString('hex');
      name = String(m.name || 'Player').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Player';
      const pr = profile(token, name);
      return c.send({ t: 'hello', token, name, bal: pr.bal });
    }
    if (!token) return;
    if (m.t === 'create' || m.t === 'join') {
      if (room) return;
      let code = String(m.code || '').toUpperCase().trim();
      if (m.t === 'create') {
        if (code) {
          if (!CODE_OK.test(code)) return c.send({ t: 'err', msg: 'A custom code must be exactly 4 letters or digits.' });
          if (rooms.has(code)) return c.send({ t: 'err', msg: `Code ${code} is already in use. Pick another.` });
        } else code = genCode();
        rooms.set(code, new Room(code));
      } else if (!rooms.has(code)) return c.send({ t: 'err', msg: `No lobby with code ${code || '?'}.` });
      const r = rooms.get(code), p = r.join(c, token, name);
      if (!p) { if (!r.players.size) rooms.delete(code); return c.send({ t: 'err', msg: 'That lobby is full (8 players).' }); }
      room = r; me = p; return;
    }
    if (room && me) room.handle(me, m);
  };
  c.onclose = () => { if (room && me && me.conn === c) { me.conn = null; room.left(); } };
});
server.listen(PORT, () => console.log(`Rare Hours running on http://localhost:${PORT}${DEV ? ' (DEV: forced spins enabled)' : ''}`));
module.exports = { server, rooms };
