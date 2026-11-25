'use strict';
// Rare Hours client: lobby, main wheel, table, bonus overlay host. Subgame renderers live in games/*.js
const RH = (() => {
  const $ = id => document.getElementById(id), TAU = Math.PI * 2;
  const { TYPES, KEYS, DIAL, BONUS_KEYS } = RHS, N = DIAL.length;
  const FONT = '"Escargoth","Arial Narrow",Arial,sans-serif', CALM = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const fx2 = n => (Math.round(n * 100) / 100).toLocaleString('en-US');
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  const CAT_NAMES = { spare: 'Spare Change', grab: 'Cash Grab', drop: 'Drop Dead', prod: 'Productivitime' };
  const ACCENT = { spare: '#e2557a', grab: '#e8b04a', drop: '#2cc3d8', prod: '#9d93ec' };

  // Orra: the currency. A ring holding an hourglass, with a stem through it like a dollar sign.
  const ORRA = '<svg class="orra" viewBox="0 0 24 24" aria-label="Orra"><circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8.4 7.2h7.2L12 12l3.6 4.8H8.4L12 12z" fill="currentColor"/><path d="M12 0.5v3.4M12 20.1v3.4" stroke="currentColor" stroke-width="2.4"/></svg>';
  const orra = n => `${ORRA}${fmt(n)}`;

  // ---- Sound ----
  let sound = store.get('rh-sound') !== 'off', ac;
  const audio = () => { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); return ac; };
  function tone(f, d = .08, v = .05) { if (!sound) return; try { audio(); const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(v, ac.currentTime); g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + d); o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + d); } catch {} }
  // Sample sound effects in sfx/<name>.mp3, decoded once and played through Web Audio.
  const SFX = {};
  function loadSfx(n) {
    if (!SFX[n]) SFX[n] = fetch('sfx/' + n + '.mp3').then(r => r.arrayBuffer()).then(a => new Promise((ok, no) => audio().decodeAudioData(a, ok, no))).then(b => SFX[n] = b).catch(() => { SFX[n] = null; });
    return SFX[n];
  }
  function sfx(n, v = .8) {
    if (!sound) return;
    try {
      const b = SFX[n];
      if (b === undefined) return loadSfx(n).then(() => SFX[n] && sfx(n, v));
      if (!b || typeof b.then === 'function') return;
      const c = audio(), src = c.createBufferSource(), g = c.createGain(); g.gain.value = v; src.buffer = b; src.connect(g).connect(c.destination); src.start();
    } catch {}
  }
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, .25, .07), i * 110));

  // ---- Connection ----
  let ws = null, token = store.get('rh-token') || '', myName = store.get('rh-name') || '', roomCode = null, off = 0, bestRtt = 1e9;
  const now = () => Date.now() + off;
  const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
  let S = null, catalog = {}, players = {};
  function connect() {
    ws = window.RH_SERVER ? new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host) : RHNet.connect();
    ws.onopen = () => { send({ t: 'hello', token, name: myName || 'Player' }); };
    ws.onmessage = e => { const m = JSON.parse(e.data); onMsg(m); };
    ws.onclose = () => { toast('Connection lost. Reconnecting...'); setTimeout(connect, 1500); };
  }
  setInterval(() => send({ t: 'ping', c: Date.now() }), 4000);
  function onMsg(m) {
    if (m.t === 'pong') { const rtt = Date.now() - m.c; if (rtt <= bestRtt * 1.5) { bestRtt = Math.min(bestRtt, rtt); off = m.s - (m.c + rtt / 2); } return; }
    if (m.t === 'hello') { token = m.token; store.set('rh-token', token); send({ t: 'ping', c: Date.now() }); if (roomCode) send({ t: 'join', code: roomCode }); return; }
    if (m.t === 'err') { if (!S) { $('lerr').textContent = m.msg; if (/No lobby/.test(m.msg)) roomCode = null; } else { if (/Orra|maximum/.test(m.msg)) { sfx('no_tokens_left'); pendingRepeat = false; } toast(/No lobby/.test(m.msg) ? 'The host left, so this lobby is closed.' : m.msg, 3200, 'bad'); if (/No lobby/.test(m.msg)) { try { sessionStorage.removeItem('rh-room'); } catch {} setTimeout(() => location.href = location.pathname, 3000); } } return; }
    if (m.t === 'catalog') { catalog = m.games; return; }
    if (m.t === 'room') { if (bestRtt > 1e8) off = m.now - Date.now(); onRoom(m); return; }
    if (m.t === 'bonus') return Bonus.update(m);
    if (m.t === 'fx') return Bonus.fx(m);
  }

  // ---- Lobby screen ----
  function lobby() {
    const q = new URLSearchParams(location.search), j = (q.get('join') || '').toUpperCase().slice(0, 4);
    $('nm').value = myName; $('jc').value = j;
    if (j) { $('joinbox').querySelector('h3').textContent = `You are invited to lobby ${j}`; }
    const name = () => { myName = $('nm').value.trim().slice(0, 16); if (!myName) { $('lerr').textContent = 'Enter a name first.'; $('nm').focus(); return false; } store.set('rh-name', myName); send({ t: 'hello', token, name: myName }); return true; };
    $('cc').onchange = () => { $('cv').disabled = !$('cc').checked; if ($('cc').checked) $('cv').focus(); };
    $('cb').onclick = () => {
      if (!name()) return;
      let code = '';
      if ($('cc').checked) { code = $('cv').value.toUpperCase().trim(); if (!/^[A-Z0-9]{4}$/.test(code)) { $('lerr').textContent = 'A custom code must be exactly 4 letters or digits.'; return; } }
      $('lerr').textContent = ''; roomCode = null; setTimeout(() => send({ t: 'create', code }), 50);
    };
    $('jb').onclick = () => {
      if (!name()) return;
      const code = $('jc').value.toUpperCase().trim();
      if (!code || code.length > 4) { $('lerr').textContent = 'Lobby codes have up to 4 characters.'; return; }
      $('lerr').textContent = ''; roomCode = code; setTimeout(() => send({ t: 'join', code }), 50);
    };
    ['jc', 'cv'].forEach(id => $(id).oninput = e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    $('jc').onkeydown = e => { if (e.key === 'Enter') $('jb').click(); };
    $('cv').onkeydown = e => { if (e.key === 'Enter') $('cb').click(); };
    (j ? $('jc') : $('nm')).focus();
    let back = null; try { back = sessionStorage.getItem('rh-room'); } catch {}
    if (j && back === j && myName) { roomCode = j; $('lerr').textContent = 'Rejoining ' + j + '...'; }
    if (!myName) $('nm').focus();
  }

  // ---- Art ----
  const COINS = [[5, '#b8452f', '#5c1a0e'], [10, '#2463b8', '#0d2f63'], [25, '#12805f', '#053f2e'], [100, '#23283a', '#05070d'], [500, '#c98a1e', '#6b4206']];
  function chipSvg([v, c, d]) {
    let e = ''; for (let i = 0; i < 8; i++) e += `<path d="M-8 -48A49 49 0 0 1 8 -48L6 -35H-6Z" fill="#fff6e6" transform="rotate(${i * 45})"/>`;
    return `<svg viewBox="-50 -50 100 100" aria-hidden="true"><circle r="49" fill="${d}"/><circle r="47" fill="${c}"/>${e}<circle r="35" fill="${d}"/><circle r="32" fill="#fff6e6"/><circle r="28" fill="${c}"/><path d="M-41 -20A46 46 0 0 1 20 -41" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none"/><text y="${v > 99 ? 7 : 8}" text-anchor="middle" font-family='${FONT}' font-weight="700" font-size="${v > 99 ? 21 : 25}" fill="#fff">${v}</text></svg>`;
  }
  function stackHtml(n) { const a = []; for (const c of [...COINS].reverse()) while (n >= c[0] && a.length < 5) { a.push(c); n -= c[0]; } return '<span class="stack">' + a.map((c, i) => chipSvg(c).replace('<svg', '<svg style="bottom:' + i * 4 + 'px"')).join('') + '</span>'; }

  // Skin per field: f = wheel wedge, pl = number plaque, tk = desk ticket.
  const SKIN = {
    one: { f: '#BFE3D6', pl: '#3E4A4F', tk: '#7FA596' }, two: { f: '#F6C343', pl: '#6B4E3D', tk: '#C9953F' },
    five: { f: '#F4B6B0', pl: '#5D5470', tk: '#C98886' }, ten: { f: '#C9B6E4', pl: '#4B2342', tk: '#8F7AB0' },
    spare: { f: '#1F3C9E', tk: '#2343AE' }, grab: { f: '#1E7A3C', tk: '#1F8441' }, drop: { f: '#A02A8E', tk: '#A42C92' }, prod: { f: '#B3202A', tk: '#BA2430' }
  };
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')'; };
  // Bonus medallions, shared by the wheel (as images) and the desk tickets (inline).
  const GLYPH = {
    spare: '<circle r="10" fill="url(#mg-K)" stroke="#5a3a0c" stroke-width="1.2"/><circle r="6.8" fill="none" stroke="#7a5418" stroke-width="1.5"/><path d="M-3.2-4.3h6.4L0 0l3.2 4.3h-6.4L0 0z" fill="#7a5418"/><path d="M0-12.5v2.6M0 9.9v2.6" stroke="#7a5418" stroke-width="1.6"/>',
    grab: '<path d="M-10-3-5.5-8.5h11L10-3 0 10z" fill="#d6f1ff" stroke="#173350" stroke-width="1.1" stroke-linejoin="round"/><path d="M-10-3h20M-5.5-8.5-3-3 0 10 3-3 5.5-8.5M-3-3 0-8.5 3-3" fill="none" stroke="#173350" stroke-width=".8" opacity=".75"/><path d="M-7-3.6-4.6-7" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>',
    drop: '<path d="M-2.5-13v4M2.5-14v5" stroke="#fff6dd" stroke-width="1.2" stroke-linecap="round" opacity=".7"/><circle cy="-3" r="5.6" fill="url(#mb-K)" stroke="#5a3a0c" stroke-width=".8"/><g fill="#FFE38A" stroke="#5a3a0c" stroke-width=".6"><circle cx="-7.5" cy="7" r="2"/><circle cx="7.5" cy="7" r="2"/><circle cy="10.5" r="2"/></g>',
    prod: '<circle r="10" fill="#fff6dd" stroke="#5a3a0c" stroke-width="1.3"/><path d="M0-8.2v2M8.2 0h-2M0 8.2v-2M-8.2 0h2" stroke="#5a3a0c" stroke-width="1.3"/><path d="M0 0V-6.4M0 0l4.6 2.8" stroke="#2b1606" stroke-width="1.7" stroke-linecap="round"/><circle r="1.6" fill="#B3202A"/>'
  };
  const medal = k => `<svg viewBox="-20 -20 40 40" aria-hidden="true"><defs><linearGradient id="mg-${k}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#FFE38A"/><stop offset=".5" stop-color="#C8922E"/><stop offset="1" stop-color="#7A5418"/></linearGradient><radialGradient id="mb-${k}" cx=".35" cy=".3"><stop stop-color="#fff"/><stop offset=".6" stop-color="#dfe3ee"/><stop offset="1" stop-color="#7d8aa3"/></radialGradient></defs><circle r="19.5" fill="url(#mg-${k})"/><circle r="19" fill="none" stroke="#2b1606" stroke-width="1"/><circle r="15.6" fill="${mix(SKIN[k].f, '#000000', .45)}" stroke="#2b1606" stroke-width="1"/>${GLYPH[k].replace(/-K\)/g, '-' + k + ')')}</svg>`;
  const STACK_BADGE = `<svg viewBox="-20 -20 40 40" aria-hidden="true">${[8, 1, -6].map((y, i) => `<ellipse cy="${y + 3}" rx="13" ry="5" fill="${i % 2 ? '#7a5418' : '#6e0f1c'}"/><rect x="-13" y="${y}" width="26" height="3" fill="${i % 2 ? '#c8922e' : '#b3202a'}"/><ellipse cy="${y}" rx="13" ry="5" fill="${i % 2 ? '#FFE38A' : '#E0302B'}" stroke="#2b1606" stroke-width=".6"/><ellipse cy="${y}" rx="9" ry="3.3" fill="none" stroke="#fff6dd" stroke-width="1.3" stroke-dasharray="2.4 2.2"/>`).join('')}</svg>`;
  const ICON = {};
  BONUS_KEYS.forEach(k => { const im = new Image(); im.onload = () => { if (cx) { makeArt(); draw(); } }; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(medal(k).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"')); ICON[k] = im; });

  // Stage: art deco swirl, emerald left and crimson to hot pink right, gold edges and string lights.
  function scenery() {
    const X = 800, Y = 330, n = 16, pt = (cx, cy, r, a) => (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1);
    let s = `<defs><radialGradient id="sc-dark" cx="${X}" cy="${Y}" r="620" gradientUnits="userSpaceOnUse"><stop stop-color="#0b0207" stop-opacity=".9"/><stop offset=".5" stop-color="#0b0207" stop-opacity=".45"/><stop offset="1" stop-color="#0b0207" stop-opacity="0"/></radialGradient>
 <radialGradient id="sc-vig" cx=".5" cy=".42" r=".78"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></radialGradient></defs><rect width="1600" height="900" fill="#12050b"/>`;
    const lights = ['', '', ''];
    for (let i = n - 1; i >= 0; i--) {
      const cx = X + i * 7, cy = Y + i * 11, r = 250 + i * 82, t = i / (n - 1), sp = Math.PI / 2 + i * .16, odd = i % 2;
      const green = odd ? mix('#14794a', '#0a3d27', t) : mix('#0d5a37', '#062a1a', t), pink = odd ? mix('#e8478c', '#8a0f2e', t) : mix('#b8174a', '#4e0718', t);
      s += `<path d="M${pt(cx, cy, r, sp)}A${r} ${r} 0 0 1 ${pt(cx, cy, r, sp + Math.PI)}Z" fill="${green}"/><path d="M${pt(cx, cy, r, sp + Math.PI)}A${r} ${r} 0 0 1 ${pt(cx, cy, r, sp)}Z" fill="${pink}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e9c46a" stroke-opacity="${(.85 - t * .4).toFixed(2)}" stroke-width="${odd ? 2.6 : 1.4}"/>`;
      if (odd) { const m = Math.round(TAU * r / 44); for (let j = 0; j < m; j++) { const a = j / m * TAU, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (x > -10 && x < 1610 && y > -10 && y < 910) lights[j % 3] += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="#ffd9a0" opacity=".22"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.3" fill="#fff6dd"/>`; } }
    }
    s += lights.map((l, i) => `<g class="tw t${i}">${l}</g>`).join('') + '<rect width="1600" height="900" fill="url(#sc-dark)"/><rect width="1600" height="900" fill="url(#sc-vig)"/>';
    $('scene').innerHTML = s;
  }

  // ---- Main wheel (canvas). Logical size 1100 x 1140, drawn at K x resolution. Static layers are cached. ----
  const K = 1.5, W = 1100, H = 1140, R = 450, CX = 550, CY = 575, FR = R + 4, HUB = 134;
  let cx, face, base, over, pegImg, bulbOn, bulbOff, glit, angle = 0, flap = 0, blink = 0, hitSeg = -1;
  function layer(w, h) { const e = document.createElement('canvas'); e.width = Math.ceil(w * K); e.height = Math.ceil(h * K); const c = e.getContext('2d'); c.scale(K, K); return [e, c]; }
  function disc(c, r, f) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = f; c.fill(); }
  function ring(c, r0, r1, f) { c.beginPath(); c.arc(0, 0, r1, 0, TAU); c.arc(0, 0, r0, 0, TAU, true); c.fillStyle = f; c.fill(); }
  function wedge(c, a, w, r0, r1) { c.beginPath(); c.arc(0, 0, r1, a - w, a + w); c.arc(0, 0, r0, a + w, a - w, true); c.closePath(); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function poly(c, p, r) { c.beginPath(); const n = p.length; for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!i) c.moveTo(m[0], m[1]); const d = p[(i + 2) % n]; c.arcTo(b[0], b[1], (b[0] + d[0]) / 2, (b[1] + d[1]) / 2, r); } c.closePath(); }
  function gold(c, x0, y0, x1, y1) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#FFE38A'); g.addColorStop(.18, '#FFF3C4'); g.addColorStop(.5, '#C8922E'); g.addColorStop(1, '#7A5418'); return g; }
  function metal(c, rot = 0) { const g = c.createConicGradient(rot, 0, 0); ['#FFF3C4', '#C8922E', '#7A5418', '#FFE38A', '#FFF8DC', '#C8922E', '#6B4A12', '#E8BE5A', '#FFF3C4'].forEach((x, i) => g.addColorStop(i / 8, x)); return g; }
  function shine(c, r0, r1, a = .45) { const g = c.createConicGradient(-.4, 0, 0); [0, a, 0, a * .5, 0, a * .8, 0].forEach((x, i) => g.addColorStop(i / 6, `rgba(255,250,225,${x})`)); ring(c, r0, r1, g); }
  const hsh = n => { n = Math.imul(n ^ n >>> 15, 0x2c1b3c6d); n = Math.imul(n ^ n >>> 12, 0x297a2d39); return ((n ^ n >>> 15) >>> 0) / 4294967296; };
  function spark(c, x, y, s, a) { c.save(); c.translate(x, y); c.globalAlpha = a; c.fillStyle = '#fffbe8'; c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s); c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); c.fill(); c.restore(); }
  function glitter() {
    if (glit) return glit;
    const e = document.createElement('canvas'); e.width = e.height = 200; const c = e.getContext('2d'); let s = 11;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(255,${235 + rnd() * 20 | 0},${170 + rnd() * 85 | 0},${(.12 + rnd() * .55).toFixed(2)})`; c.beginPath(); c.arc(rnd() * 200, rnd() * 200, .3 + rnd() * rnd() * 1.5, 0, TAU); c.fill(); }
    for (let i = 0; i < 18; i++) spark(c, rnd() * 200, rnd() * 200, 2 + rnd() * 3, .9);
    return glit = e;
  }
  function bulb(on) {
    const [e, c] = layer(36, 36); c.translate(18, 18);
    if (on) { let g = c.createRadialGradient(0, 0, 2, 0, 0, 18); g.addColorStop(0, 'rgba(255,231,170,.85)'); g.addColorStop(.4, 'rgba(255,200,110,.3)'); g.addColorStop(1, 'rgba(255,180,90,0)'); disc(c, 18, g); }
    disc(c, 6.6, on ? '#7a5418' : '#3a2208');
    const g = c.createRadialGradient(-1.5, -1.8, .5, 0, 0, 5.6);
    if (on) { g.addColorStop(0, '#ffffff'); g.addColorStop(.5, '#fff3cf'); g.addColorStop(1, '#f2c66e'); } else { g.addColorStop(0, '#d8b98a'); g.addColorStop(1, '#6e4a26'); }
    disc(c, 5.4, g); return e;
  }
  function makePeg() {
    const [e, c] = layer(24, 24); c.translate(12, 12);
    c.beginPath(); c.ellipse(1.6, 2.6, 6.4, 5.6, 0, 0, TAU); c.fillStyle = 'rgba(0,0,0,.45)'; c.fill();
    const g = c.createRadialGradient(-2.2, -2.4, .4, 0, 0, 7); g.addColorStop(0, '#FFF8DC'); g.addColorStop(.45, '#E2B44E'); g.addColorStop(1, '#6B4A12');
    disc(c, 6.2, g); c.lineWidth = 1; c.strokeStyle = '#3a2208'; c.stroke();
    c.beginPath(); c.arc(0, 0, 3.6, 0, TAU); c.strokeStyle = 'rgba(255,250,225,.45)'; c.lineWidth = .9; c.stroke(); disc(c, 1.3, '#fffdf2');
    return e;
  }
  function plaque(c, t, s) {
    c.save(); c.translate(R - 150, 0); c.rotate(Math.PI / 4); c.fillStyle = mix(s.pl, s.f, .4); c.fillRect(-4.5, -4.5, 9, 9); c.restore();
    c.save(); c.translate(R - 112, 0); c.rotate(Math.PI / 2); c.fillStyle = mix(s.pl, s.f, .55); c.font = `700 22px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t.n, 0, 1); c.restore();
    c.save(); c.translate(R - 52, 0); c.rotate(Math.PI / 2);
    const w = 40, h = 56;
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 7 * K; rr(c, -w / 2, -h / 2, w, h, 10); c.fillStyle = s.pl; c.fill(); c.restore();
    let g = c.createLinearGradient(0, -h / 2, 0, h / 2); g.addColorStop(0, mix(s.pl, '#ffffff', .25)); g.addColorStop(.45, s.pl); g.addColorStop(1, mix(s.pl, '#000000', .35));
    rr(c, -w / 2, -h / 2, w, h, 10); c.fillStyle = g; c.fill(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(0,0,0,.6)'; c.stroke();
    rr(c, -w / 2 + 3.5, -h / 2 + 3.5, w - 7, h - 7, 7); c.lineWidth = 1.4; c.strokeStyle = 'rgba(244,226,180,.75)'; c.stroke();
    c.font = `700 ${t.pay > 9 ? 31 : 38}px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,.65)'; c.fillText(t.n, 0, 4); c.fillStyle = 'rgba(255,255,255,.55)'; c.fillText(t.n, 0, 1);
    g = c.createLinearGradient(0, -16, 0, 16); g.addColorStop(0, '#FFF9E8'); g.addColorStop(1, '#E6D3A6'); c.fillStyle = g; c.fillText(t.n, 0, 2.4);
    c.restore();
  }
  function stripe(c, k, t) {
    const txt = t.n.toUpperCase(), x0 = 182, x1 = R - 62, fs = 23;
    c.save(); c.font = `700 ${fs}px ${FONT}`; if ('letterSpacing' in c) c.letterSpacing = '1.5px'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.lineWidth = 5; c.strokeStyle = '#1a0904'; c.strokeText(txt, (x0 + x1) / 2, 1.5, x1 - x0);
    const g = c.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, '#FFF6C4'); g.addColorStop(.42, '#FFD866'); g.addColorStop(.58, '#D99A2B'); g.addColorStop(1, '#8C5A16');
    c.fillStyle = g; c.fillText(txt, (x0 + x1) / 2, 1.5, x1 - x0); c.restore();
    c.save(); c.translate(R - 30, 0); c.rotate(Math.PI / 2); if (ICON[k].complete && ICON[k].naturalWidth) c.drawImage(ICON[k], -18, -18, 36, 36); c.restore();
  }
  function makeFace() {
    let c; [face, c] = layer(2 * FR, 2 * FR); c.translate(FR, FR);
    const w = TAU / N / 2, pat = c.createPattern(glitter(), 'repeat');
    DIAL.forEach((k, i) => {
      const t = TYPES[k], s = SKIN[k], a = i * TAU / N - Math.PI / 2, g = c.createRadialGradient(0, 0, 110, 0, 0, R);
      if (t.pay) { g.addColorStop(0, mix(s.f, '#000000', .25)); g.addColorStop(.5, s.f); g.addColorStop(1, mix(s.f, '#ffffff', .3)); }
      else { g.addColorStop(0, mix(s.f, '#000000', .6)); g.addColorStop(.55, s.f); g.addColorStop(1, mix(s.f, '#ffffff', .15)); }
      wedge(c, a, w + .002, 0, R); c.fillStyle = g; c.fill();
      if (!t.pay) { c.save(); c.clip(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .6; c.fillStyle = pat; c.fill(); c.restore(); }
      c.save(); c.rotate(a); t.pay ? plaque(c, t, s) : stripe(c, k, t); c.restore();
    });
    for (let i = 0; i < N; i++) {
      const a = (i + .5) * TAU / N - Math.PI / 2, x = Math.cos(a), y = Math.sin(a);
      c.beginPath(); c.moveTo(x * 120, y * 120); c.lineTo(x * R, y * R); c.strokeStyle = 'rgba(43,22,6,.55)'; c.lineWidth = 3.4; c.stroke(); c.strokeStyle = '#F3D27A'; c.lineWidth = 1.3; c.stroke();
    }
  }
  function hub(c) {
    c.save(); c.shadowColor = 'rgba(0,0,0,.75)'; c.shadowBlur = 30 * K; c.shadowOffsetY = 12 * K; disc(c, HUB, '#2b1606'); c.restore();
    disc(c, HUB, gold(c, -HUB, -HUB, HUB, HUB)); shine(c, HUB - 12, HUB, .5); disc(c, HUB - 11, '#2b1606');
    let g = c.createRadialGradient(0, 0, 96, 0, 0, 122); g.addColorStop(0, '#2a0410'); g.addColorStop(.5, '#6e1030'); g.addColorStop(1, '#2a0410'); disc(c, HUB - 12, g);
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .5; ring(c, 101, HUB - 12, c.createPattern(glitter(), 'repeat')); c.restore();
    disc(c, 101, gold(c, 100, 100, -100, -100)); disc(c, 96, '#3a0808');
    g = c.createRadialGradient(0, 0, 0, 0, 0, 94); g.addColorStop(0, '#E0302B'); g.addColorStop(.65, '#C42420'); g.addColorStop(1, '#9E1A17'); disc(c, 94, g);
    for (let i = 0; i < 32; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 94, i * TAU / 32, (i + .5) * TAU / 32); c.closePath(); c.fillStyle = i % 2 ? 'rgba(255,220,180,.07)' : 'rgba(255,235,200,.13)'; c.fill(); }
    g = c.createRadialGradient(-26, -34, 0, 0, 0, 94); g.addColorStop(0, 'rgba(255,240,220,.35)'); g.addColorStop(.6, 'rgba(255,240,220,0)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); disc(c, 94, g);
    // Logo: gold script made from our display face, slanted, with a swash
    c.save(); c.transform(1, 0, -.2, 1, 0, 0); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const lines = [['Rare', -20, 46], ['Hours', 24, 48]];
    for (const [s, y, f] of lines) { c.font = `700 ${f}px ${FONT}`; c.lineWidth = 7; c.strokeStyle = '#3a0606'; c.strokeText(s, 0, y + 2); }
    for (const [s, y, f] of lines) {
      c.font = `700 ${f}px ${FONT}`; const q = c.createLinearGradient(0, y - f / 2, 0, y + f / 2); q.addColorStop(0, '#FFF6C4'); q.addColorStop(.45, '#FFD866'); q.addColorStop(.55, '#D99A2B'); q.addColorStop(1, '#8C5A16');
      c.lineWidth = 2.4; c.strokeStyle = '#5a1a08'; c.strokeText(s, 0, y); c.fillStyle = q; c.fillText(s, 0, y);
    }
    c.restore();
    c.beginPath(); c.moveTo(-58, 52); c.quadraticCurveTo(0, 40, 62, 50); c.lineWidth = 3; c.strokeStyle = '#3a0606'; c.stroke(); c.lineWidth = 1.6; c.strokeStyle = '#FFD866'; c.stroke();
    spark(c, -62, -24, 6, 1); spark(c, 64, 12, 5, .9);
  }
  function makeBase() {
    let c; [base, c] = layer(W, H);
    // pedestal
    c.save(); c.translate(CX, 0);
    c.beginPath(); c.ellipse(0, 1124, 250, 16, 0, 0, TAU); c.fillStyle = 'rgba(0,0,0,.55)'; c.fill();
    let g = c.createLinearGradient(-200, 0, 200, 0); ['#1a0610', '#4a1030', '#8a2a55', '#4a1030', '#1a0610'].forEach((x, i) => g.addColorStop(i / 4, x));
    c.beginPath(); c.moveTo(-90, 960); c.lineTo(90, 960); c.quadraticCurveTo(105, 1080, 210, 1118); c.lineTo(-210, 1118); c.quadraticCurveTo(-105, 1080, -90, 960); c.fillStyle = g; c.fill();
    c.lineWidth = 3; c.strokeStyle = gold(c, -210, 960, 210, 1118); c.stroke();
    for (const x of [-36, 0, 36]) { c.beginPath(); c.moveTo(x * .9, 1000); c.lineTo(x * 2.6, 1110); c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,227,138,.45)'; c.stroke(); }
    rr(c, -224, 1112, 448, 14, 5); c.fillStyle = gold(c, 0, 1112, 0, 1126); c.fill();
    c.restore();
    c.translate(CX, CY);
    c.save(); c.shadowColor = 'rgba(0,0,0,.8)'; c.shadowBlur = 44 * K; c.shadowOffsetY = 26 * K; disc(c, R + 54, '#2b1606'); c.restore();
    for (let i = 16; i > 0; i--) { c.save(); c.translate(0, i); disc(c, R + 54, i > 12 ? '#24120a' : i > 4 ? '#5a3a10' : '#8a6420'); c.restore(); }
    disc(c, R + 55, '#2b1606'); disc(c, R + 53, gold(c, -R, -R, R, R)); shine(c, R + 41, R + 53, .55);
    g = c.createRadialGradient(0, 0, R + 16, 0, 0, R + 42); g.addColorStop(0, '#2a0410'); g.addColorStop(.5, '#7a1236'); g.addColorStop(1, '#2a0410'); ring(c, R + 17, R + 41, g);
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .75; ring(c, R + 17, R + 41, c.createPattern(glitter(), 'repeat')); c.restore();
    c.lineWidth = 1.5; c.strokeStyle = '#2b1606'; [R + 41, R + 17].forEach(r => { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); });
    ring(c, R + 5, R + 17, gold(c, R, R, -R, -R)); shine(c, R + 5, R + 17, .35);
    ring(c, R, R + 5, '#1a0c04'); disc(c, R, '#1a0c04');
  }
  function makeOver() {
    let c; [over, c] = layer(W, H); c.translate(CX, CY);
    let g = c.createRadialGradient(0, 0, R - 30, 0, 0, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)'); disc(c, R, g);
    g = c.createRadialGradient(-R * .45, -R * .55, 0, -R * .45, -R * .55, R * 1.3); g.addColorStop(0, 'rgba(255,250,235,.26)'); g.addColorStop(.45, 'rgba(255,250,235,.05)'); g.addColorStop(1, 'rgba(20,0,10,.28)'); disc(c, R, g);
    c.beginPath(); c.arc(0, 0, R + 47, Math.PI * 1.08, Math.PI * 1.42); c.lineCap = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(255,253,240,.7)'; c.stroke();
    c.beginPath(); c.arc(0, 0, R + 11, Math.PI * 1.12, Math.PI * 1.36); c.lineWidth = 2; c.strokeStyle = 'rgba(255,253,240,.55)'; c.stroke();
    hub(c);
  }
  function makeArt() { if (!bulbOn) { bulbOn = bulb(true); bulbOff = bulb(false); pegImg = makePeg(); } makeBase(); makeFace(); makeOver(); }
  const PTR = [[-48, -34], [48, -34], [48, 0], [0, 76], [-48, 0]], PIN = [[-38, -25], [38, -25], [38, -4], [0, 61], [-38, -4]];
  const PBULBS = (() => { const p = [[-30, -18], [30, -18], [30, -6], [0, 48], [-30, -6]], out = []; for (let i = 0; i < 5; i++) { const a = p[i], b = p[(i + 1) % 5], m = i === 0 ? 4 : i === 2 || i === 3 ? 3 : 1; for (let j = 0; j < m; j++) out.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]); } return out; })();
  function pointer(c) {
    c.setTransform(K, 0, 0, K, CX * K, 46 * K); c.rotate(flap); c.scale(1.2, 1.2);
    c.save(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 16 * K; c.shadowOffsetY = 9 * K; poly(c, PTR, 10); c.fillStyle = '#2b1606'; c.fill(); c.restore();
    poly(c, PTR, 10); c.fillStyle = gold(c, -48, -36, 40, 86); c.fill(); c.lineWidth = 1.5; c.strokeStyle = '#3a2208'; c.stroke();
    poly(c, PIN, 7); let g = c.createRadialGradient(0, -6, 4, 0, 10, 70); g.addColorStop(0, '#8a1438'); g.addColorStop(1, '#2a0410'); c.fillStyle = g; c.fill();
    c.save(); c.clip(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .6; c.fillStyle = c.createPattern(glitter(), 'repeat'); c.fill(); c.restore();
    c.lineWidth = 2; c.strokeStyle = '#3a2208'; c.stroke(); c.lineWidth = 1; c.strokeStyle = 'rgba(255,243,196,.6)'; c.stroke();
    PBULBS.forEach(([x, y], i) => c.drawImage(CALM || (i + blink) % 2 ? bulbOn : bulbOff, x - 12, y - 12, 24, 24));
    // red tip that dips into the segments
    poly(c, [[-13, 54], [13, 54], [0, 88]], 3); g = c.createLinearGradient(-14, 0, 14, 0); g.addColorStop(0, '#ff6a50'); g.addColorStop(.45, '#E0302B'); g.addColorStop(1, '#7a0e0c'); c.fillStyle = g; c.fill();
    c.lineWidth = 2; c.strokeStyle = gold(c, -14, 54, 14, 88); c.stroke();
    c.beginPath(); c.moveTo(-5.5, 59); c.lineTo(-1, 80); c.lineWidth = 1.6; c.strokeStyle = 'rgba(255,240,220,.6)'; c.stroke();
    c.save(); c.translate(0, 14); g = c.createRadialGradient(-3, -3, 1, 0, 0, 12); g.addColorStop(0, '#FFF6C4'); g.addColorStop(1, '#C8922E'); c.fillStyle = g;
    c.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 5 : 12; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); c.fill(); c.lineWidth = 1; c.strokeStyle = '#5a3a0c'; c.stroke(); c.restore();
  }
  function draw() {
    if (!face) return;
    const c = cx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(base, 0, 0);
    c.setTransform(K, 0, 0, K, CX * K, CY * K);
    c.save(); c.rotate(angle); c.drawImage(face, -FR, -FR, 2 * FR, 2 * FR);
    if (hitSeg >= 0) {
      const a = hitSeg * TAU / N - Math.PI / 2, w = TAU / N / 2, on = CALM || blink % 2;
      wedge(c, a, w, HUB, R); c.fillStyle = `rgba(255,248,220,${on ? .34 : .16})`; c.fill();
      c.save(); c.shadowColor = '#FFE38A'; c.shadowBlur = 18 * K; c.lineJoin = 'round'; c.lineWidth = 5; c.strokeStyle = '#FFE38A'; c.stroke(); c.restore();
    }
    c.restore();
    for (let i = 0; i < N; i++) { const a = angle + (i + .5) * TAU / N - Math.PI / 2; c.drawImage(pegImg, Math.cos(a) * (R - 10) - 12, Math.sin(a) * (R - 10) - 12, 24, 24); }
    c.setTransform(1, 0, 0, 1, 0, 0); { const x = (CX - R - 56) * K | 0, y = (CY - R - 56) * K | 0, d = (2 * R + 112) * K | 0; c.drawImage(over, x, y, d, d, x, y, d, d); } c.setTransform(K, 0, 0, K, CX * K, CY * K);
    for (let i = 0; i < 48; i++) { const a = (i + .5) / 48 * TAU; c.drawImage(CALM || (i + blink) % 3 ? bulbOn : bulbOff, Math.cos(a) * (R + 29) - 18, Math.sin(a) * (R + 29) - 18, 36, 36); }
    for (let i = 0; i < 24; i++) { const a = (i + .5) / 24 * TAU; c.drawImage(CALM || (i + blink) % 2 ? bulbOn : bulbOff, Math.cos(a) * 111 - 12, Math.sin(a) * 111 - 12, 24, 24); }
    if (!CALM) for (let i = 0; i < 6; i++) { const h = hsh(i * 7919 + blink * 104729), a = h * TAU, r = i < 4 ? R + 47 - (i % 2) * 36 : R + 29; spark(c, Math.cos(a) * r, Math.sin(a) * r, 6 + hsh(h * 1e9 | 0) * 6, .95); }
    pointer(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Server dictates the landing field and the duration (3 to 7 s); we animate toward it.
  let spinKey = null, spinRaf = 0;
  const zoom = z => { if (!CALM) $('stage').dataset.zoom = z; };
  function spinTo(sp) {
    cancelAnimationFrame(spinRaf); hitSeg = -1;
    const from = angle, target = -(sp.idx + (Math.random() - .5) * .7) * TAU / N;
    const remain = Math.max(300, sp.dur - (now() - sp.at)), dist = ((target - from) % TAU + TAU) % TAU + (CALM ? 1 : sp.turns) * TAU;
    const t0 = performance.now(); let seg = null, close = false;
    zoom(1);
    const stepF = () => {
      const p = Math.min(1, (performance.now() - t0) / remain); angle = from + dist * (1 - Math.pow(1 - p, 3.4));
      const s = Math.floor(angle / (TAU / N) + .5); flap *= .8; if (seg !== null && s !== seg) { flap = .26; tone(850, .03, .03); } seg = s; blink = Math.floor(p * 40);
      if (!close && remain - (performance.now() - t0) <= Math.max(1300, remain * .45)) { close = true; zoom(2); }
      if (p >= 1) { flap = 0; angle %= TAU; hitSeg = sp.idx; draw(); return; }
      draw(); spinRaf = requestAnimationFrame(stepF);
    };
    spinRaf = requestAnimationFrame(stepF);
  }

  // ---- Table ----
  let chip = 5, myTot = 0, pendingRepeat = false, lastPhase = null, lastRound = -1, lastWinShown = null;
  function setupTable() {
    cx = $('wheel').getContext('2d');
    // Desk: raffle tickets, numbers left and bonuses right, each 2x2 group with a chip stack badge in the middle
    const ticket = k => {
      const t = TYPES[k], s = SKIN[k], i = KEYS.indexOf(k);
      if (t.pay) return `<button class="house num" id="h-${k}" style="--tk:${s.tk};--pl:${s.pl};--i:${i}" aria-label="Bet on ${t.n}, pays ${t.pay} to 1"><span class="tk"><span class="stub"></span><span class="face"><span class="plq"><span class="n">${t.n}</span></span><span class="p">Pays ${t.pay}x</span></span></span><span class="dots"></span><span class="stake"></span></button>`;
      const name = esc(t.n).replace('Productivitime', 'Producti&shy;vitime'), long = s => Math.max(...s.split(' ').map(w => w.length));
      return `<button class="house bonus" id="h-${k}" style="--tk:${s.tk};--i:${i};--fs:${Math.min(32, 200 / long(t.n)).toFixed(1)};--fsm:${Math.min(32, 200 / long(name.replace('&shy;', ' '))).toFixed(1)}" aria-label="Bet on bonus game ${t.n}"><span class="tk"><span class="stub">${medal(k)}</span><span class="face"><span class="ttl"><span class="n">${name}</span></span><span class="p">Bonus game</span></span></span><span class="dots"></span><span class="stake"></span></button>`;
    };
    const badge = `<span class="medal" aria-hidden="true">${STACK_BADGE}</span>`;
    $('street').innerHTML = `<div class="tgrp">${KEYS.filter(k => TYPES[k].pay).map(ticket).join('')}${badge}</div><div class="tgrp">${BONUS_KEYS.map(ticket).join('')}${badge}</div>`;
    KEYS.forEach(k => { $('h-' + k).onclick = () => placeBet(k); $('h-' + k).oncontextmenu = e => { e.preventDefault(); send({ t: 'unbet', key: k }); }; });
    $('quay').innerHTML = '<div class="info">' + [['bal', 'Balance'], ['bet', 'Total bet'], ['win', 'Win']].map(([i, t]) => `<div><small>${t}</small><b>${ORRA}<span id="${i}">0</span></b></div>`).join('') + '</div><div class="chips">' + COINS.map(c => `<button class="coin" data-v="${c[0]}" aria-label="Chip ${c[0]} Orra">${chipSvg(c)}</button>`).join('') + '</div><div class="acts"><button class="btn" id="clear">Clear</button><button class="btn" id="again">Repeat</button><button class="btn go" id="go">Ready</button></div>';
    document.querySelectorAll('.coin').forEach(b => b.onclick = () => { chip = +b.dataset.v; renderChips(); });
    $('clear').onclick = () => send({ t: 'clear' });
    $('again').onclick = () => { pendingRepeat = true; send({ t: 'repeat' }); };
    loadSfx('token_place'); loadSfx('no_tokens_left');
    $('go').onclick = () => { send({ t: 'ready' }); tone(660, .15); };
    $('help').onclick = () => { rulesDialog(); $('rules').showModal(); };
    $('shop').onclick = () => { shop(); $('work').showModal(); };
    const sndLabel = () => { $('snd').textContent = 'Sound ' + (sound ? 'on' : 'off'); $('snd').setAttribute('aria-pressed', sound); };
    sndLabel(); $('snd').onclick = () => { sound = !sound; store.set('rh-sound', sound ? 'on' : 'off'); sndLabel(); if (sound) sfx('token_place', .5); };
    ['rules', 'work'].forEach(id => $(id).onclick = e => { if (e.target === $(id)) $(id).close(); });
    $('invite').onclick = () => {
      const link = location.origin + location.pathname + '?join=' + S.code;
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied. Send it to your friends.', 3200, 'ok'), () => prompt('Copy this invite link', link));
    };
    if (!CALM) setInterval(() => { blink++; if (!S || S.phase !== 'spinning') draw(); }, 600);
    requestAnimationFrame(clockLoop);
  }
  // Chips are the betting tokens. Check locally first so an impossible bet gets instant feedback.
  function placeBet(k) {
    if (!S) return;
    const me = S.me, avail = me.bal - myTot, h = $('h-' + k);
    const deny = t => { sfx('no_tokens_left'); toast(t, 2600, 'bad'); h.classList.remove('shake'); void h.offsetWidth; h.classList.add('shake'); };
    if (avail < 5) return deny('No Orra left to bet. Open the Cashier to collect more.');
    if (chip > avail) return deny(`Only ${fmt(avail)} Orra left. Pick a smaller chip.`);
    if (myTot + chip > me.limit) return deny(`Level ${me.lvl} limit: ${fmt(me.limit)} Orra per round.`);
    send({ t: 'bet', key: k, amt: chip }); sfx('token_place');
  }
  function renderChips() { document.querySelectorAll('.coin').forEach(b => { b.classList.toggle('on', +b.dataset.v === chip); b.setAttribute('aria-pressed', +b.dataset.v === chip); }); }
  function clockLoop() {
    if (S) {
      const el = $('clock').firstChild;
      const left = S.phase === 'betting' && S.ends ? S.ends - now() : 0;
      el.style.width = Math.max(0, Math.min(100, left / 80)) + '%'; $('clock').classList.toggle('low', left > 0 && left < 3000);
    }
    Bonus.tick();
    requestAnimationFrame(clockLoop);
  }
  function shop() {
    const c = S.me.cashier, me = S.me, pct = (a, b) => Math.max(0, Math.min(100, a / b * 100)).toFixed(1) + '%';
    $('workbody').innerHTML = `<div class="cards">
 <section class="dcard"><h3>Wages, level ${c.work}</h3><p class="stat">${ORRA}${fmt(c.pending)}<small>of ${fmt(c.cap)}</small></p><div class="meter"><i style="width:${pct(c.pending, c.cap)}"></i></div>
  <p class="note">You earn ${c.rate} Orra per minute, up to ${fmt(c.cap)}.</p>
  <button class="btn go" id="w1" ${c.pending < 1 ? 'disabled' : ''}>${c.pending < 1 ? 'Nothing to collect yet' : 'Collect ' + fmt(c.pending)}</button>
  <button class="btn" id="w2" ${c.work >= 10 || me.bal < c.upCost ? 'disabled' : ''}>${c.work >= 10 ? 'Maximum level' : 'Upgrade to level ' + (c.work + 1) + ' for ' + fmt(c.upCost)}</button></section>
 <section class="dcard"><h3>Daily bonus</h3><p class="stat">${ORRA}${fmt(c.gift)}</p><p class="note">${c.today ? `Collected. Streak: day ${c.day}. Come back tomorrow for more.` : `Streak day ${c.day}. Each day in a row adds 25, up to day 7.`}</p>
  <button class="btn go" id="w3" ${c.today ? 'disabled' : ''}>${c.today ? 'Collected today' : 'Collect ' + fmt(c.gift)}</button></section>
 <section class="dcard"><h3>Level ${me.lvl}</h3><p class="stat">${fmt(me.limit)}<small>max bet per round</small></p><div class="meter"><i style="width:${pct(me.xp, me.need)}"></i></div>
  <p class="note">${fmt(me.need - me.xp)} XP to level ${me.lvl + 1}. Every 5 Orra you bet gives 1 XP.</p></section>
 <section class="dcard"><h3>Inventory</h3><div class="inv"><div><b>${me.items.shield || 0}</b><small>Shield</small></div><div><b>${me.items.swap || 0}</b><small>Swap token</small></div></div>
  <p class="note">A Shield blocks the next attack on you in any bonus game. Swap tokens force a rival to switch sides.</p></section></div>`;
    $('w1').onclick = () => { send({ t: 'cashier', op: 'collect' }); sfx('token_place'); };
    $('w2').onclick = () => send({ t: 'cashier', op: 'upgrade' });
    $('w3').onclick = () => { send({ t: 'cashier', op: 'daily' }); sfx('token_place'); fanfare(); };
  }
  function rulesDialog() {
    let h = `<section class="rsec"><h3>The table</h3><ul>
<li>Every round you have 8 seconds to bet. When everyone presses Ready, the wheel spins at once.</li>
<li>Pick a chip, then click a field. Click again to stack more. Right-click a field to remove your bet.</li>
<li>Your balance is in Orra ${ORRA}. Your level sets the maximum bet per round.</li>
<li>Prime Minute: each round one field gets a x2, x3 or x5 boost on its winnings.</li></ul>
<div class="pays">${KEYS.map(k => { const t = TYPES[k]; return `<div style="--c:${SKIN[k].f}">${t.n}<small>${t.pay ? 'pays ' + t.pay + ' : 1' : 'Bonus game'}</small></div>`; }).join('')}</div></section>
<section class="rsec"><h3>Bonus games</h3><ul>
<li>Backers (players who bet on the field before the spin) always play, with the full edge: full multiplier, Prime Minute boost, the first turns and an Edge Shield against late joiners.</li>
<li>Everyone else gets a short buy-in window. You can buy in for up to 25% to 50% of the top backer's stake (more when more of the table backed it). Late joiners collect 60% of their multiplier.</li>
<li>A bonus pays the multiplier you finish with, plus your bet back.</li>
<li>Shields and Swap tokens you win stay with you between games.</li></ul></section>`;
    for (const k of BONUS_KEYS) h += `<section class="rsec" style="--accent:${ACCENT[k]}"><h3><span class="cat">${CAT_NAMES[k]}</span></h3><p class="note">One of these 4 is picked at random.</p><div class="gl">${(catalog[k] || []).map(g => `<details><summary>${esc(g.name)}</summary><ul>${g.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul></details>`).join('')}</div></section>`;
    h += '<p class="note">Orra is play money with no real value.</p>';
    $('rulebody').innerHTML = h;
  }
  function toast(t, ms = 3200, kind = '') { const e = $('toast'); e.textContent = t; e.className = 'on ' + kind; clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), ms); }
  const say = t => { const e = $('say'); if (e.textContent === t) return; e.textContent = t; e.classList.remove('pop'); void e.offsetWidth; e.classList.add('pop'); };

  function onRoom(m) {
    const first = !S; S = m; roomCode = m.code;
    if (m.dev) window.RHforce = (key, game) => send({ t: 'force', key, game });
    players = {}; m.players.forEach(p => players[p.id] = p);
    if (first) {
      $('lobby').hidden = true; $('game').hidden = false; setupTable(); renderChips(); makeArt(); draw();
      history.replaceState(null, '', location.pathname + '?join=' + m.code);
      try { sessionStorage.setItem('rh-room', m.code); } catch {}
      if (document.fonts) document.fonts.ready.then(() => { makeArt(); draw(); });
    }
    const me = players[m.you], betting = m.phase === 'betting', ready = me.ready;
    $('room').textContent = m.code; $('lvl').innerHTML = `<b>Level ${m.me.lvl}<small>${fmt(m.me.xp)} / ${fmt(m.me.need)} XP</small></b><span class="meter"><i style="width:${Math.min(100, m.me.xp / m.me.need * 100)}%"></i></span>`;
    if ($('work').open) shop();
    // players strip
    $('people').innerHTML = m.players.map(p => {
      const tot = Object.values(p.bets).reduce((a, b) => a + b, 0);
      return `<span class="pl ${p.online ? '' : 'off'} ${p.ready && betting ? 'ready' : ''} ${p.id === m.you ? 'me' : ''}" style="--c:${p.color}"><i></i><b>${esc(p.name)}</b><small>${ORRA}${fmt(p.bal - (betting ? tot : 0))}</small>${tot ? `<span class="tag">bet ${fmt(tot)}</span>` : ''}${p.ready && betting ? '<span class="tag ok">READY</span>' : ''}${p.shield ? `<span class="tag" title="Shields">S${p.shield}</span>` : ''}${p.swap ? `<span class="tag" title="Swap tokens">W${p.swap}</span>` : ''}</span>`;
    }).join('');
    // fields
    const mine = me.bets || {}, tot = Object.values(mine).reduce((a, b) => a + b, 0);
    if (pendingRepeat && betting && tot > 0) { pendingRepeat = false; sfx('token_place'); }
    myTot = betting ? tot : 0;
    document.body.classList.toggle('spinning', m.phase === 'spinning');
    KEYS.forEach(k => {
      const h = $('h-' + k); h.disabled = !betting || ready;
      h.classList.toggle('lit', !!mine[k]);
      h.querySelector('.stake').innerHTML = mine[k] ? stackHtml(mine[k]) + `<b>${ORRA}${fmt(mine[k])}</b>` : '';
      h.querySelector('.dots').innerHTML = m.players.filter(p => p.id !== m.you && p.bets[k]).map(p => `<i style="--c:${p.color}" title="${esc(p.name)}: ${p.bets[k]}"></i>`).join('');
      const b = h.querySelector('.boost'); if (b) b.remove();
      if (m.boost && m.boost.k === k) h.insertAdjacentHTML('beforeend', `<span class="boost">x${m.boost.m}</span>`);
      h.classList.toggle('hit', m.phase !== 'betting' && m.phase !== 'spinning' && m.landed === k);
    });
    $('bal').textContent = fmt(m.me.bal - (betting ? tot : 0)); $('bet').textContent = fmt(tot);
    $('clear').disabled = !betting || ready || !tot; $('again').disabled = !betting || ready || !m.me.hasLast;
    $('go').disabled = !betting || ready; $('go').textContent = betting ? (ready ? 'Waiting' : tot ? 'Ready' : 'Sit out') : m.phase === 'spinning' ? 'Spinning' : 'Wait';
    document.querySelectorAll('.coin').forEach(b => { b.disabled = !betting || ready; b.classList.toggle('short', betting && +b.dataset.v > m.me.bal - tot); });
    // spin
    if (m.phase === 'spinning' && m.spin && spinKey !== m.spin.at) { spinKey = m.spin.at; spinTo(m.spin); }
    if (m.phase === 'betting' || m.phase === 'intro' || m.phase === 'bonus') zoom(0);
    if (m.phase === 'betting' && lastPhase !== 'betting') { hitSeg = -1; draw(); document.body.classList.remove('won'); $('win').textContent = '0'; $('win').parentNode.classList.remove('up'); }
    // history
    $('hist').innerHTML = m.hist.slice(0, 10).map(k => { const t = TYPES[k]; return `<span class="${t.pay ? '' : 'bh'}" style="background:${SKIN[k].f};color:${t.pay ? SKIN[k].pl : '#FFE38A'}" title="${t.n}">${t.pay ? t.n : t.n.split(' ').map(w => w[0]).join('')}</span>`; }).join('');
    // messages and payouts
    let msg = m.msg;
    if (m.phase === 'payout' && m.results) {
      const row = m.results.rows.find(r => r.id === m.you), key = m.results.key, t = TYPES[key];
      if (row && row.stake) msg = `${t.n} pays ${fx2(row.m)}x. You collect ${fmt(row.win)} Orra.`;
      else if (row) msg = `${t.n}. No bet on this field.`;
      if (row && row.lvl) msg += ` Level up! +${row.lvl} Orra.`;
      $('win').textContent = fmt(row ? row.win : 0); $('win').parentNode.classList.toggle('up', !!(row && row.win > 0));
      const key2 = m.round + ':' + key;
      if (row && row.win > 0 && lastWinShown !== key2) { lastWinShown = key2; fanfare(); document.body.classList.add('won'); }
      if (BONUS_KEYS.includes(key)) Bonus.results(m);
    }
    if (m.phase === 'landed' && lastPhase === 'spinning') tone(780, .5, .08);
    if (m.phase === 'betting' && lastRound !== m.round) { lastRound = m.round; tone(660, .4); }
    say(msg);
    if (m.phase === 'intro' && m.next) Bonus.intro(m);
    if (m.phase === 'betting') Bonus.close();
    lastPhase = m.phase;
  }

  // ---- Bonus overlay host ----
  const G = {};
  const Bonus = (() => {
    let cur = null, inst = null, last = null, logKey = '', span = { ends: 0, tot: 1 };
    const box = () => $('box');
    const rulesList = rules => `<ol class="brules">${rules.map(r => `<li>${esc(r)}</li>`).join('')}</ol>`;
    const accent = cat => box().style.setProperty('--accent', ACCENT[cat] || 'var(--gold)');
    // Intro doubles as the buy-in window. Built once per round, then patched so the slider keeps its value.
    let introKey = '';
    function intro(m) {
      const n = m.next, k = m.round + ':' + n.id, backer = n.backers.includes(m.you), late = n.late.includes(m.you);
      accent(n.cat);
      if (introKey !== k) {
        introKey = k; cur = null; last = null;
        const dur = Math.max(500, m.ends - now());
        box().innerHTML = `<div class="intro"><span class="cat">${CAT_NAMES[n.cat]}</span><h2>${esc(n.name)}</h2>
          <span class="badge"></span><div class="buyin" hidden></div>
          ${rulesList(n.rules)}<div class="bplayers"></div><div class="bt" style="--dur:${dur}ms"><i></i></div></div>`;
        $('bonus').classList.add('on'); tone(440, .5);
        if (n.cap) {
          const bx = box().querySelector('.buyin'), start = Math.min(n.cap, Math.max(5, Math.round(n.cap / 2 / 5) * 5));
          bx.hidden = false;
          bx.innerHTML = `<p class="bihead">Buy in late, up to <b>${orra(n.cap)}</b> <small>(${Math.round(n.share * 100)}% of the top stake ${orra(n.top)})</small></p>
            <div class="birow"><input type="range" id="biamt" min="5" max="${n.cap}" step="5" value="${start}" aria-label="Buy-in amount"><b id="bival">${orra(start)}</b></div>
            <div class="birow"><button class="btn go" id="bigo">Buy in</button><button class="btn" id="bipass">Watch</button></div>
            <p class="note">Late entry: ${Math.round(n.latePay * 100)}% of your multiplier, no Prime Minute boost, you move after the backers and their Edge Shields block your first attack.</p>`;
          const r = $('biamt');
          r.oninput = () => { $('bival').innerHTML = orra(+r.value); tone(520 + +r.value / n.cap * 300, .03, .02); };
          $('bigo').onclick = () => { send({ t: 'buyin', amt: +r.value }); sfx('token_place'); };
          $('bipass').onclick = () => send({ t: 'buyin', pass: true });
        }
      }
      const bx = box().querySelector('.buyin');
      if (bx && !n.cap) bx.hidden = true;
      const badge = box().querySelector('.badge');
      badge.className = 'badge ' + (backer ? 'in' : late ? 'in late' : 'watch');
      badge.textContent = backer ? 'You backed this field. Full edge.' : late ? 'You bought in late. Get ready.' : n.cap ? 'You did not back this field' : 'Spectating';
      box().querySelector('.bplayers').innerHTML = m.players.filter(p => p.bets[n.cat]).sort((a, b) => n.late.includes(a.id) - n.late.includes(b.id) || b.bets[n.cat] - a.bets[n.cat])
        .map(p => `<span class="bp ${p.id === m.you ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}<small>${ORRA}${fmt(p.bets[n.cat])}</small><span class="tag ${n.late.includes(p.id) ? '' : 'ok'}">${n.late.includes(p.id) ? 'Late' : 'Backer'}</span></span>`).join('');
    }
    function api(m) {
      return {
        me: m.me, part: m.part, now, send: a => send({ t: 'act', a }), tone,
        P: id => m.players.find(p => p.id === id) || { id, name: id === 'house' ? 'House' : '?', color: '#888' },
        name: id => { const p = m.players.find(p => p.id === id); return p ? p.name : id === 'house' ? 'House' : '?'; },
        color: id => { const p = m.players.find(p => p.id === id); return p ? p.color : '#888'; },
        players: m.players, m
      };
    }
    function update(m) {
      last = m;
      const key = m.id + ':' + S.round;
      const r = G[m.id];
      if (cur !== key) {
        cur = key; logKey = ''; $('bonus').classList.add('on'); accent(m.cat);
        box().innerHTML = `<div class="bhead"><div><span class="cat">${CAT_NAMES[m.cat]}</span><h2>${esc(m.name)}</h2></div>
          <div class="bmeta"><span class="bclock" hidden><b>0</b><small>s</small></span><button class="btn sm" id="brl" aria-expanded="false">Rules</button></div><div class="bt"><i></i></div></div>
          <div class="brulespop" hidden>${rulesList(m.rules)}</div><div class="bplayers"></div><div class="bbody"><div class="ga" id="ga"></div></div><div class="bfoot"><ul class="blog"></ul></div>`;
        $('brl').onclick = () => { const p = box().querySelector('.brulespop'), o = p.hidden; p.hidden = !o; $('brl').setAttribute('aria-expanded', o); $('brl').classList.toggle('on', o); };
        inst = { el: $('ga'), st: {} };
        if (r) r.mount(inst.el, inst.st, api(m));
      }
      if (m.ends !== span.ends) span = { ends: m.ends, tot: Math.max(1000, m.ends - now()) };
      box().querySelector('.bplayers').innerHTML = m.players.map(p => `<span class="bp ${p.id === m.me ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}<small>${ORRA}${fmt(p.stake)}</small>${p.late ? '<span class="tag" title="Bought in late">Late</span>' : ''}${p.edge ? '<span class="tag ok" title="Blocks the first attack from a late joiner">Edge</span>' : ''}${p.shield ? `<span class="tag" title="Shields">Shield ${p.shield}</span>` : ''}${p.swap ? `<span class="tag" title="Swap tokens">Swap ${p.swap}</span>` : ''}</span>`).join('') + (m.part ? '' : '<span class="bp watch">You are spectating</span>');
      const lk = m.log.join('\n');
      if (lk !== logKey) { logKey = lk; box().querySelector('.blog').innerHTML = m.log.map(l => `<li>${esc(l)}</li>`).join(''); }
      if (r) try { r.update(inst.el, inst.st, m.v, api(m)); } catch (e) { console.error(e); }
    }
    function fx(m) { if (!inst || !last || last.id !== m.g || !G[m.g] || !G[m.g].fx) return; try { G[m.g].fx(inst.el, inst.st, m.d, api(last)); } catch (e) { console.error(e); } }
    function tick() {
      if (!last || !$('bonus').classList.contains('on')) return;
      const left = last.ends ? Math.max(0, last.ends - now()) : 0, bt = box().querySelector('.bhead .bt i'), clk = box().querySelector('.bclock');
      if (bt) bt.style.width = left ? Math.min(100, left / span.tot * 100) + '%' : '0';
      if (clk) {
        clk.hidden = !left || !!box().querySelector('.final');
        const sec = Math.ceil(left / 1000), b = clk.firstChild;
        if (b.textContent !== String(sec)) { b.textContent = sec; if (left && sec <= 3 && last.part) tone(980, .05, .03); }
        clk.classList.toggle('low', left > 0 && left <= 3000);
      }
      if (inst && G[last.id] && G[last.id].frame) try { G[last.id].frame(inst.el, inst.st, last.v, api(last)); } catch (e) { console.error(e); }
    }
    function results(m) {
      if (!$('bonus').classList.contains('on') || box().querySelector('.final') || !box().querySelector('.bbody')) return;
      const rows = m.results.rows.filter(r => r.stake), mine = rows.find(r => r.id === m.you);
      const pl = id => players[id] || { name: '?', color: '#888' };
      box().insertAdjacentHTML('beforeend', `<div class="final"><div class="fcard"><span class="cat">${CAT_NAMES[m.results.key]}</span><h3>${esc(last ? last.name : 'Bonus')} results</h3>
        ${mine ? `<p class="mine ${mine.win > 0 ? 'win' : ''}">You finished at ${fx2(mine.m)}x and collect ${orra(mine.win)}</p>` : '<p class="note">You watched this one.</p>'}
        <table class="res"><tr><th>Player</th><th class="n">Result</th><th class="n">Stake</th><th class="n">Collect</th></tr>${rows.map(r => `<tr class="${r.id === m.you ? 'me' : ''}"><td><span class="pdot" style="--c:${pl(r.id).color}"></span>${esc(pl(r.id).name)}${r.late ? ' <span class="tag">Late</span>' : ''}</td><td class="n">${fx2(r.m)}x</td><td class="n">${fmt(r.stake)}</td><td class="n">${orra(r.win)}</td></tr>`).join('')}</table>
        <button class="btn go" id="bclose">Back to the table</button></div></div>`);
      const b = $('bclose'); if (b) { b.onclick = close; b.focus(); }
    }
    function close() { $('bonus').classList.remove('on'); cur = null; inst = null; last = null; introKey = ''; }
    return { intro, update, fx, tick, results, close };
  })();

  // ---- Shared drawing helpers for renderers ----
  // Segment wheel. rot is the (float) segment index at the top pointer.
  function segWheel(c, o) {
    const W = c.canvas.width, Hh = c.canvas.height, r = Math.min(W, Hh) / 2 - 34, n = o.segs.length;
    c.clearRect(0, 0, W, Hh); c.save(); c.translate(W / 2, Hh / 2);
    disc(c, r + 18, metal(c, .6)); disc(c, r + 6, '#140a06');
    for (let i = 0; i < n; i++) {
      const a = (i - o.rot) * TAU / n - Math.PI / 2, w = TAU / n / 2;
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, r, a - w, a + w); c.closePath(); c.fillStyle = o.fill(i); c.fill();
      c.strokeStyle = '#e6c673'; c.lineWidth = 1.2; c.stroke();
      if (o.ring) { const col = o.ring(i); if (col) { c.beginPath(); c.arc(0, 0, r - 3, a - w + .01, a + w - .01); c.strokeStyle = col; c.lineWidth = 6; c.stroke(); } }
      c.save(); c.rotate(a); c.fillStyle = o.ink ? o.ink(i) : '#fff'; c.textAlign = 'right'; c.textBaseline = 'middle';
      c.font = `700 ${Math.max(9, Math.min(20, TAU * r / n * .62))}px ${FONT}`; c.fillText(String(o.text(i)), r - 8, 1, r * .6);
      c.restore();
    }
    disc(c, r * .22, metal(c, 1)); disc(c, r * .19, '#2c150b');
    if (o.hub) { c.fillStyle = '#f3dc98'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `700 ${r * .09}px ${FONT}`; c.fillText(o.hub, 0, 0); }
    for (const f of o.flappers || []) {
      const a = f.off * TAU / n - Math.PI / 2;
      c.save(); c.rotate(a + Math.PI / 2); c.translate(0, -r - 14);
      c.beginPath(); c.moveTo(-11, -14); c.lineTo(11, -14); c.lineTo(0, 16); c.closePath(); c.fillStyle = f.color; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
      if (f.label) { c.rotate(-(a + Math.PI / 2)); c.fillStyle = '#fff'; c.font = `700 12px ${FONT}`; c.textAlign = 'center'; c.fillText(f.label, 0, -26); }
      c.restore();
    }
    c.restore();
  }
  // Animate a wheel spin from one top index to another (server timestamps)
  function spinPos(sp, n, t) {
    if (!sp) return 0;
    const p = Math.max(0, Math.min(1, (t - sp.at) / sp.dur)), e = 1 - Math.pow(1 - p, 3.2);
    const d = ((sp.to - sp.from) % n + n) % n + n * 4;
    return sp.from + d * e;
  }
  function drawBoard(c, o) {
    const W = c.canvas.width, sc = W / RHS.BW;
    c.setTransform(sc, 0, 0, sc, 0, 0); c.clearRect(0, 0, RHS.BW, RHS.BH);
    c.fillStyle = '#0b2a1e'; c.fillRect(0, 0, RHS.BW, RHS.BH);
    const n = o.vals.length, sw = RHS.BW / n;
    for (let i = 0; i < n; i++) {
      const v = o.vals[i], own = o.owner ? o.owner(i) : null;
      c.fillStyle = v === 'DOUBLE' ? '#b8891e' : own ? own : (i % 2 ? '#3d2013' : '#4d2a18');
      c.fillRect(i * sw + 1, RHS.SLOT_Y - 12, sw - 2, RHS.BH - RHS.SLOT_Y + 12);
      if (o.hit === i) { c.fillStyle = '#ffffff55'; c.fillRect(i * sw + 1, RHS.SLOT_Y - 12, sw - 2, RHS.BH - RHS.SLOT_Y + 12); }
      c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.font = `700 ${v === 'DOUBLE' ? Math.min(14, sw * .3) : Math.min(22, sw * .42)}px ${FONT}`;
      if (v === 'DOUBLE') { c.save(); c.translate(i * sw + sw / 2, RHS.SLOT_Y + 28); c.rotate(-Math.PI / 2); c.fillText('DOUBLE', 0, 0); c.restore(); }
      else c.fillText(v + 'x', i * sw + sw / 2, RHS.SLOT_Y + 28);
      if (o.label) { const l = o.label(i); if (l) { c.font = `700 11px ${FONT}`; c.fillText(l, i * sw + sw / 2, RHS.BH - 10); } }
    }
    c.fillStyle = '#e6c673'; for (let i = 1; i < n; i++) c.fillRect(i * sw - 1.5, RHS.SLOT_Y - 20, 3, RHS.BH);
    for (const p of o.pegs) { c.beginPath(); c.arc(p.x, p.y, RHS.PEG_R, 0, TAU); c.fillStyle = p.c || '#e6dcc0'; c.fill(); if (p.c) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke(); } }
    for (const p of o.pucks || []) {
      if (p.dead) continue;
      c.beginPath(); c.arc(p.x, p.y, RHS.PUCK_R, 0, TAU); c.fillStyle = p.c || '#fff'; c.fill(); c.lineWidth = 3; c.strokeStyle = '#fff'; c.stroke();
    }
    if (o.after) o.after(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Keep a smoothed copy of streamed puck positions
  function track(st, frames) {
    st.pk = st.pk || {};
    for (const [id, x, y, s] of frames) { const p = st.pk[id] || (st.pk[id] = { x, y }); if (p.ty !== undefined && y < p.ty - 150) { p.x = x; p.y = y; } p.tx = x; p.ty = y; p.s = s; }
  }
  function smooth(st) { const out = []; for (const [id, p] of Object.entries(st.pk || {})) { p.x += (p.tx - p.x) * .45; p.y += (p.ty - p.y) * .45; out.push({ id: +id, x: p.x, y: p.y, dead: p.s === 2 }); } return out; }
  function coinFlip(el, side, at, dur) {
    const coin = el.querySelector('.coin3d'); if (!coin || coin.dataset.at == at) return;
    coin.dataset.at = at;
    const rem = Math.max(200, at - now());
    coin.style.transition = 'none'; coin.style.transform = 'rotateY(0deg)'; void coin.offsetWidth;
    coin.style.transition = `transform ${rem}ms cubic-bezier(.2,.7,.3,1)`; coin.style.transform = `rotateY(${360 * 8 + (side === 'blue' ? 180 : 0)}deg)`;
  }
  const coinHtml = () => '<div class="persp"><div class="coin3d"><div class="f">RED</div><div class="b">BLUE</div></div></div>';
  const secs = ends => Math.max(0, Math.ceil((ends - now()) / 1000));

  function boot() { if (document.fonts) document.fonts.ready.then(() => S && draw()); scenery(); lobby(); connect(); document.querySelectorAll('.orra-inline').forEach(e => e.innerHTML = ORRA); }
  return { boot, G, h: esc, esc, fmt, fx2, ORRA, orra, now, tone, segWheel, spinPos, drawBoard, track, smooth, coinFlip, coinHtml, secs, toast, FONT, TAU, metal, disc };
})();
