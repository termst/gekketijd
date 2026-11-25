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

let db = { profiles: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch {}
let saveT = null;
const save = () => { if (!saveT) saveT = setTimeout(() => { saveT = null; fs.writeFile(DB_FILE, JSON.stringify(db), () => {}); }, 1000); };
const { rooms, Room, genCode, profile, CODE_OK } = require('./public/core.js')({ RHS, GAMES, db, save, dev: DEV });

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

// ---------------------------------------------------------------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let u = decodeURIComponent((req.url || '/').split('?')[0]);
  if (u === '/') u = '/index.html';
  if (u === '/server-mode.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('window.RH_SERVER = 1;'); }
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
