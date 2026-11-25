'use strict';
// Serverless multiplayer for static hosting (GitHub Pages).
// The lobby creator's browser runs the game core (core.js) and is the host.
// Other players connect to it peer to peer over WebRTC. PeerJS's free public broker is only used to find each other.
// RHNet.connect() returns a WebSocket-like object, so client.js works the same with or without a server.
const RHNet = (() => {
  const PREFIX = 'rarehours-gekketijd-v1-';
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const ss = { get: k => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const randToken = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const clean = s => String(s || 'Player').replace(/[<>&"]/g, '').trim().slice(0, 16) || 'Player';
  const loadProf = () => { try { const p = JSON.parse(ls.get('rh-prof') || 'null'); return p && typeof p.bal === 'number' ? p : null; } catch { return null; } };
  const saveProf = p => { if (p) ls.set('rh-prof', JSON.stringify(p)); };
  // Optional own broker for testing: ?peerhost=localhost&peerport=9000
  function peerOpts() {
    const q = new URLSearchParams(location.search), h = q.get('peerhost');
    return h ? { host: h, port: +q.get('peerport') || 9000, path: '/', secure: location.protocol === 'https:', debug: 1 } : { debug: 1 };
  }

  // Host state survives reconnects of the local client.
  let H = null;

  function connect() {
    const sock = { readyState: 0, onopen: null, onmessage: null, onclose: null, send: s => handle(JSON.parse(s)), close() {} };
    let token = '', name = 'Player', mode = null, remote = null, guestPeer = null, tries = 0;
    const emit = o => { if (sock.readyState === 1 && sock.onmessage) sock.onmessage({ data: JSON.stringify(o) }); };
    const fail = msg => emit({ t: 'err', msg });
    const drop = () => { if (sock.readyState === 3) return; sock.readyState = 3; sock.onclose && sock.onclose(); };
    setTimeout(() => { sock.readyState = 1; sock.onopen && sock.onopen(); }, 0);

    function handle(m) {
      if (mode === 'guest') { if (remote && remote.open) remote.send(m); return; }
      if (mode === 'host') return H.local(m);
      if (m.t === 'ping') return emit({ t: 'pong', c: m.c, s: Date.now() });
      if (m.t === 'hello') {
        token = String(m.token || '').slice(0, 64) || randToken(); name = clean(m.name);
        const p = loadProf();
        return emit({ t: 'hello', token, name, bal: p ? p.bal : 500 });
      }
      if (!token) return;
      if (m.t === 'create') return host(String(m.code || '').toUpperCase().trim(), !m.code);
      if (m.t === 'join') return join(String(m.code || '').toUpperCase().trim());
    }

    // ---- Host ----
    function host(code, auto, attempt = 0) {
      if (H && H.code === code && H.ready) { mode = 'host'; return H.attach(sock, emit, token, name); }
      if (auto) { code = ''; for (let i = 0; i < 4; i++) code += CODE_CH[Math.floor(Math.random() * CODE_CH.length)]; }
      if (!/^[A-Z0-9]{4}$/.test(code)) return fail('A custom code must be exactly 4 letters or digits.');
      const peer = new Peer(PREFIX + code, peerOpts());
      let opened = false;
      peer.on('open', () => { opened = true; startHost(peer, code); mode = 'host'; H.attach(sock, emit, token, name); });
      peer.on('error', e => {
        if (opened) { if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 3000); return; }
        peer.destroy();
        if (e.type === 'unavailable-id') {
          if (auto && attempt < 5) return host('', true, attempt + 1);
          if (ss.get('rh-host') === code && attempt < 6) return setTimeout(() => host(code, false, attempt + 1), 3000);   // our own old session is still registered
          return fail(`Code ${code} is already in use. Pick another.`);
        }
        fail('Could not reach the lobby service. Check your internet and try again.');
      });
    }

    function startHost(peer, code) {
      const db = { profiles: {} };
      const core = RHCore({ RHS, GAMES: RHGames, db, dev: false, save: () => { if (H && H.token) saveProf(db.profiles[H.token]); } });
      const room = new core.Room(code);
      core.rooms.set(code, room);
      ss.set('rh-host', code);
      H = { code, peer, core, room, db, ready: true, token: null, me: null, conn: null, emit: null };
      H.attach = (s, em, tok, nm) => {
        H.emit = em; H.token = tok;
        if (!db.profiles[tok]) { const p = loadProf(); if (p) db.profiles[tok] = p; }
        if (H.conn) H.conn.open = false;
        H.conn = { open: true, send: o => H.emit(o) };
        H.me = room.join(H.conn, tok, nm);
        saveProf(db.profiles[tok]);
      };
      H.local = m => {
        if (m.t === 'ping') return H.emit({ t: 'pong', c: m.c, s: Date.now() });
        if (m.t === 'hello') return H.emit({ t: 'hello', token: H.token, name: H.me.name, bal: H.me.prof.bal });
        if (m.t === 'create' || m.t === 'join') return;
        room.handle(H.me, m);
      };
      // Keep the broker registration alive so new players can still find the lobby.
      peer.on('disconnected', () => setTimeout(() => !peer.destroyed && peer.reconnect(), 1000));
      peer.on('connection', dc => {
        let tok = null, nm = 'Player', me = null;
        const c = { open: false, send: o => { if (dc.open) try { dc.send(o); } catch {} } };
        dc.on('open', () => { c.open = true; });
        dc.on('data', m => {
          if (!m || typeof m !== 'object') return;
          if (m.t === 'ping') return c.send({ t: 'pong', c: m.c, s: Date.now() });
          if (m.t === 'hello') {
            tok = String(m.token || '').slice(0, 64) || randToken(); nm = clean(m.name);
            if (m.prof && typeof m.prof.bal === 'number' && !(me && me.prof)) db.profiles[tok] = m.prof;
            const pr = core.profile(tok, nm);
            return c.send({ t: 'hello', token: tok, name: nm, bal: pr.bal });
          }
          if (!tok) return;
          if (m.t === 'create' || m.t === 'join') {
            if (me) return;
            me = room.join(c, tok, nm);
            if (!me) c.send({ t: 'err', msg: 'That lobby is full (8 players).' });
            return;
          }
          if (me) room.handle(me, m);
        });
        const gone = () => { c.open = false; if (me && me.conn === c) { me.conn = null; room.left(); } };
        dc.on('close', gone); dc.on('error', gone);
      });
    }

    // ---- Guest ----
    function join(code) {
      if (H && H.code === code) { mode = 'host'; return H.attach(sock, emit, token, name); }
      if (guestPeer) guestPeer.destroy();
      const peer = guestPeer = new Peer(peerOpts());
      peer.on('open', () => {
        const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        dc.on('open', () => {
          tries = 0; mode = 'guest'; remote = dc;
          dc.send({ t: 'hello', token, name, prof: loadProf() });
        });
        dc.on('data', m => { if (m && m.t === 'room' && m.prof) saveProf(m.prof); emit(m); });
        dc.on('close', () => { remote = null; peer.destroy(); drop(); });
      });
      peer.on('error', e => {
        if (mode === 'guest') return;
        peer.destroy();
        if (e.type === 'peer-unavailable') {
          if (ss.get('rh-host') === code) return host(code, false);           // we were the host of this lobby: reopen it
          if (ss.get('rh-room') === code && ++tries < 6) return setTimeout(() => join(code), 3000);   // host may be reloading
          return fail(`No lobby with code ${code}.`);
        }
        fail('Could not reach the lobby service. Check your internet and try again.');
      });
    }
    return sock;
  }
  return { connect };
})();
