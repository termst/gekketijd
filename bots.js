'use strict';
// Test bots. Usage: node bots.js <CODE> [count] [ws://localhost:8080]
// Bots join a lobby, bet a little every round and play every subgame with random but legal moves.
// DEV mode extra: node bots.js <CODE> 2 ws://localhost:8080 <gameId>  forces that subgame every round.
const [code, count = '2', url = 'ws://localhost:8080', force] = process.argv.slice(2);
if (!code) { console.log('Usage: node bots.js <CODE> [count] [ws url] [force gameId]'); process.exit(1); }
const R = n => Math.floor(Math.random() * n), pick = a => a[R(a.length)];
const CAT = { minority: 'spare', streak: 'spare', duel: 'spare', weighted: 'spare', sniper: 'grab', traps: 'grab', ammo: 'grab', ricochet: 'grab', puckwars: 'drop', pegs: 'drop', auction: 'drop', tilt: 'drop', draft: 'prod', paint: 'prod', push: 'prod', brake: 'prod' };

function bot(i) {
  const ws = new WebSocket(url);
  let me = null, round = -1, lastAct = 0, off = 0, lastB = null;
  setInterval(() => lastB && play(lastB), 700);
  const send = o => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const act = a => send({ t: 'act', a });
  ws.onopen = () => send({ t: 'hello', token: 'bot-' + code + '-' + i, name: 'Bot ' + (i + 1) });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === 'hello') send({ t: 'join', code });
    if (m.t === 'err') { if (/No lobby/.test(m.msg) && i === 0) return send({ t: 'create', code }); console.log(`[bot ${i + 1}]`, m.msg); }
    if (m.t === 'room') {
      me = m.you; off = m.now - Date.now();
      if (m.phase === 'betting' && m.round !== round) {
        round = m.round;
        if (force && i === 0) send({ t: 'force', key: CAT[force], game: force });
        const key = force ? CAT[force] : pick(['one', 'two', 'spare', 'grab', 'drop', 'prod']);
        setTimeout(() => { send({ t: 'bet', key, amt: 5 }); setTimeout(() => send({ t: 'ready' }), 300 + R(1500)); }, 200 + R(800));
      }
    }
    if (m.t === 'room' && m.phase === 'intro' && m.next && m.next.cap) setTimeout(() => send(Math.random() < 0.6 ? { t: 'buyin', amt: 5 * (1 + R(m.next.cap / 5)) } : { t: 'buyin', pass: true }), 300 + R(2000));
    if (m.t === 'bonus') { lastB = m.part ? m : null; if (m.part) play(m); }
    if (m.t === 'room' && m.phase !== 'bonus') lastB = null;
  };
  ws.onclose = () => console.log(`[bot ${i + 1}] disconnected`);
  function play(m) {
    const v = m.v, now = Date.now();
    if (now - lastAct < 400 + R(900)) return;
    lastAct = now;
    const rivals = m.players.map(p => p.id).filter(id => id !== me);
    const later = (ms, fn) => setTimeout(fn, ms);
    switch (m.id) {
      case 'minority': if (v.phase === 'pick' && !v.mine) act({ side: pick(['red', 'blue']) }); if (v.phase === 'swap' && !v.acted) act(rivals.length && v.tokens && Math.random() < 0.5 ? { swap: pick(rivals) } : { pass: true }); break;
      case 'streak': if (v.turn === me && !v.busy) { const s = v.S[me]; act(s.streak >= 2 + R(3) && !s.forced ? { bank: true, pass: rivals.length ? pick(rivals) : null } : { call: pick(['red', 'blue']) }); } break;
      case 'duel': if (v.phase === 'live' && now + off > v.t0) later(R(4000), () => act({ stop: true, t: Date.now() + off })); break;
      case 'weighted': if (v.phase === 'bid' && !v.locked.includes(me)) act({ side: pick(['red', 'blue']), pts: R(11), lock: true }); break;
      case 'sniper': if (v.phase === 'shoot') { if (v.bomb) act({ bomb: pick(rivals) }); else if (v.shots[me] > 0) act({ shoot: R(108) }); } break;
      case 'traps': if (v.phase === 'trap') { if (v.myTraps.length < 2) act({ trap: R(36) }); else act({ lock: true }); } if (v.phase === 'pick' && v.myPick === undefined) act({ pick: R(36) }); break;
      case 'ammo': if (v.phase === 'live' && v.bullets[me] > 0 && !v.hold[me]) act(Math.random() < 0.15 ? { hold: true } : { shoot: R(80) }); break;
      case 'ricochet': if (v.phase === 'aim' && !v.locked.includes(me)) { act({ aim: R(150) - 75 }); if (Math.random() < 0.4) act({ lock: true }); } break;
      case 'puckwars': if (v.phase === 'drop' && v.P[me].left > 0) act({ x: R(600), drop: Math.random() < 0.5 }); break;
      case 'pegs': if (v.phase === 'build') { if (v.extra[me].length < 2) act({ peg: { x: 30 + R(540), y: 140 + R(440) } }); else if (!v.lock.includes(me)) act({ lock: true }); } break;
      case 'auction': if (v.phase === 'auction' && v.high?.pid !== me && Math.random() < 0.5) { const b = (v.high ? v.high.amt : 0) + 1 + R(3); if (b <= v.mult[me] && b < 12) act({ bid: b }); } if (v.phase === 'steal' && v.owner[v.dslot] === me) act({ steal: (v.dslot + 1 + R(v.vals.length - 1)) % v.vals.length }); break;
      case 'tilt': if (v.phase === 'live' && Math.random() < 0.3) act({ nudge: pick([-1, 1]), board: Math.random() < 0.2 && rivals.length ? pick(rivals) : me }); break;
      case 'draft': if (v.phase === 'draft' && v.turn === me) act({ flapper: R(4) }); if (v.phase === 'jam' && !v.jamUsed) act(rivals.length ? { jam: pick(rivals) } : { pass: true }); break;
      case 'paint': if (v.phase === 'paint' && v.points[me] > 0) act({ paint: R(64) }); break;
      case 'push': if (v.phase === 'decide') act(v.inn[me] ? { choice: pick(['stay', 'cash']), curse: Math.random() < 0.3 } : { curse: Math.random() < 0.3 }); break;
      case 'brake': if (v.phase === 'live' && !v.pressed[me]) later(R(9000), () => act({ brake: true })); break;
    }
  }
}
for (let i = 0; i < +count; i++) setTimeout(() => bot(i), i * 200);
