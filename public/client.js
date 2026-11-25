'use strict';
// Rare Hours client: lobby, main wheel, table, bonus overlay host. Subgame renderers live in games/*.js
const RH = (() => {
  const $ = id => document.getElementById(id), TAU = Math.PI * 2;
  const { TYPES, KEYS, DIAL, BONUS_KEYS } = RHS, N = DIAL.length;
  const FONT = '"Roboto Condensed","Arial Narrow",Arial,sans-serif', CALM = matchMedia('(prefers-reduced-motion:reduce)').matches;
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

  // ---- Art (ported from the base game) ----
  const COINS = [[5, '#b8452f', '#5c1a0e'], [10, '#2463b8', '#0d2f63'], [25, '#12805f', '#053f2e'], [100, '#23283a', '#05070d'], [500, '#c98a1e', '#6b4206']];
  function chipSvg([v, c, d]) {
    let e = ''; for (let i = 0; i < 8; i++) e += `<path d="M-8 -48A49 49 0 0 1 8 -48L6 -35H-6Z" fill="#fff6e6" transform="rotate(${i * 45})"/>`;
    return `<svg viewBox="-50 -50 100 100" aria-hidden="true"><circle r="49" fill="${d}"/><circle r="47" fill="${c}"/>${e}<circle r="35" fill="${d}"/><circle r="32" fill="#fff6e6"/><circle r="28" fill="${c}"/><path d="M-41 -20A46 46 0 0 1 20 -41" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none"/><text y="${v > 99 ? 7 : 8}" text-anchor="middle" font-family='${FONT}' font-weight="700" font-size="${v > 99 ? 21 : 25}" fill="#fff">${v}</text></svg>`;
  }
  function stackHtml(n) { const a = []; for (const c of [...COINS].reverse()) while (n >= c[0] && a.length < 5) { a.push(c); n -= c[0]; } return '<span class="stack">' + a.map((c, i) => chipSvg(c).replace('<svg', '<svg style="bottom:' + i * 4 + 'px"')).join('') + '</span>'; }
  function scenery() {
    let s = `<defs><radialGradient id="wall" cx=".5" cy=".4" r=".75"><stop stop-color="#7a4426"/><stop offset=".5" stop-color="#4a2415"/><stop offset="1" stop-color="#160a06"/></radialGradient>
 <linearGradient id="br" x2="1"><stop stop-color="#4d380f"/><stop offset=".35" stop-color="#f3dc98"/><stop offset=".6" stop-color="#b48a38"/><stop offset="1" stop-color="#3d2c0c"/></linearGradient>
 <linearGradient id="fold" x2="1"><stop stop-color="#1c0508"/><stop offset=".45" stop-color="#7d1524"/><stop offset=".65" stop-color="#520c17"/><stop offset="1" stop-color="#140305"/></linearGradient>
 <linearGradient id="fl" x2="0" y2="1"><stop stop-color="#000" stop-opacity=".7"/><stop offset="1" stop-color="#000" stop-opacity=".1"/></linearGradient>
 <radialGradient id="glow"><stop stop-color="#ffdc94" stop-opacity=".65"/><stop offset="1" stop-color="#ffdc94" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="900" fill="url(#wall)"/>`;
    for (let x = -40; x < 1640; x += 168) s += `<rect x="${x + 14}" y="110" width="140" height="330" fill="#0002" stroke="#1c0d07" stroke-width="7"/><rect x="${x + 20}" y="116" width="128" height="318" fill="none" stroke="#b48a38" stroke-opacity=".55" stroke-width="2"/><rect x="${x + 14}" y="478" width="140" height="116" fill="#0002" stroke="#1c0d07" stroke-width="7"/><rect x="${x + 20}" y="484" width="128" height="104" fill="none" stroke="#b48a38" stroke-opacity=".4" stroke-width="2"/>`;
    s += '<rect y="454" width="1600" height="10" fill="#b48a38"/><rect y="78" width="1600" height="12" fill="#b48a38"/><circle cx="800" cy="360" r="520" fill="url(#glow)" opacity=".7"/>';
    [212, 380, 1220, 1388].forEach(x => s += `<circle cx="${x}" cy="225" r="150" fill="url(#glow)"/><rect x="${x - 7}" y="230" width="14" height="80" fill="url(#br)"/><path d="M${x - 28} 235L${x - 18} 180H${x + 18}L${x + 28} 235Z" fill="#fff0c4"/><rect x="${x - 30}" y="233" width="60" height="7" fill="url(#br)"/>`);
    s += '<rect y="610" width="1600" height="290" fill="#3b0c16"/>'; const ys = [0, 26, 60, 104, 160, 290];
    for (let r = 0; r < 5; r++) for (let c = -9; c < 9; c++) { const q = (u, y) => (800 + u * 150 * (.6 + y / 290 * 1.1)).toFixed(0) + ' ' + (610 + y), m = (ys[r] + ys[r + 1]) / 2; s += `<path d="M${q(c + .5, ys[r])}L${q(c + 1, m)}L${q(c + .5, ys[r + 1])}L${q(c, m)}Z" fill="${(c + r) & 1 ? '#661524' : '#51101d'}" stroke="#b48a38" stroke-opacity=".45" stroke-width="2"/>`; }
    s += '<rect y="610" width="1600" height="290" fill="url(#fl)"/><rect y="596" width="1600" height="16" fill="url(#br)"/>';
    for (let i = 0; i < 4; i++) s += `<path d="M${i * 44 - 10} 0H${i * 44 + 42}L${i * 34 + 16} 720H${i * 34 - 30}Z" fill="url(#fold)"/><path d="M${1610 - i * 44} 0H${1558 - i * 44}L${1584 - i * 34} 720H${1630 - i * 34}Z" fill="url(#fold)"/>`;
    $('scene').innerHTML = s;
  }
  const R = 450, CX = 550, CY = 575; let cx, face, angle = 0, flap = 0, blink = 0, hitSeg = -1;
  function metal(c, rot = 0) { const g = c.createConicGradient(rot, 0, 0); ['#f7e6ae', '#b48a38', '#5e4414', '#e6c673', '#fff3c9', '#b48a38', '#4d380f', '#e0bd62', '#f7e6ae'].forEach((x, i) => g.addColorStop(i / 8, x)); return g; }
  function star(c, n, a, b) { c.beginPath(); for (let i = 0; i < n * 2; i++) { const q = i / (n * 2) * TAU - Math.PI / 2, r = i % 2 ? b : a; c.lineTo(Math.cos(q) * r, Math.sin(q) * r); } c.closePath(); }
  function disc(c, r, f) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = f; c.fill(); }
  function makeFace() {
    face = document.createElement('canvas'); face.width = face.height = 960; const c = face.getContext('2d'); c.translate(480, 480);
    DIAL.forEach((k, i) => {
      const t = TYPES[k], a = i * TAU / N - Math.PI / 2, w = TAU / N / 2, g = c.createRadialGradient(0, 0, 110, 0, 0, R);
      g.addColorStop(0, t.d); g.addColorStop(.7, t.c); g.addColorStop(1, t.c); c.fillStyle = g; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, a - w, a + w); c.closePath(); c.fill();
      c.strokeStyle = '#e6c673'; c.lineWidth = 2.5; c.stroke(); c.save(); c.rotate(a); c.textBaseline = 'middle'; c.fillStyle = t.t;
      if (t.pay) { c.translate(R - 42, 0); c.rotate(Math.PI / 2); c.textAlign = 'center'; c.font = `700 ${t.pay > 9 ? 34 : 40}px ${FONT}`; c.fillText(t.n, 0, 3); }
      else { c.save(); c.translate(R - 34, 0); star(c, 4, 17, 6); c.fill(); c.restore(); c.textAlign = 'right'; c.font = `700 30px ${FONT}`; c.fillText(t.n, R - 60, 2, 235); }
      c.restore();
    });
  }
  function draw() {
    const c = cx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, 1100, 1140);
    let g = c.createLinearGradient(390, 0, 710, 0); ['#140a06', '#4a2415', '#8a5230', '#4a2415', '#140a06'].forEach((x, i) => g.addColorStop(i / 4, x)); c.fillStyle = g;
    c.beginPath(); c.moveTo(CX - 95, 980); c.lineTo(CX + 95, 980); c.quadraticCurveTo(CX + 110, 1090, CX + 200, 1132); c.lineTo(CX - 200, 1132); c.quadraticCurveTo(CX - 110, 1090, CX - 95, 980); c.fill();
    for (let i = 30; i >= 0; i--) { c.setTransform(1, 0, 0, .985, CX, CY + i * 1.3); disc(c, R + 50, i > 26 ? '#140a06' : i > 8 ? '#3d2013' : '#5e351e'); }
    c.setTransform(1, 0, 0, .985, CX, CY); disc(c, R + 50, metal(c, .6)); disc(c, R + 43, '#4a1119'); disc(c, R + 17, metal(c, 2.4)); disc(c, R + 6, '#140a06');
    for (let i = 0; i < 48; i++) { const a = (i + .5) / 48 * TAU, on = CALM || (i + blink) % 3; c.save(); c.translate(Math.cos(a) * (R + 30), Math.sin(a) * (R + 30)); if (on) { const q = c.createRadialGradient(0, 0, 2, 0, 0, 19); q.addColorStop(0, '#ffe2b0cc'); q.addColorStop(1, '#ffb86000'); disc(c, 19, q); } disc(c, 7, on ? '#fff8e6' : '#8a5a36'); c.restore(); }
    c.save(); c.rotate(angle); c.drawImage(face, -480, -480);
    if (hitSeg >= 0) { const a = hitSeg * TAU / N - Math.PI / 2, w = TAU / N / 2; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, a - w, a + w); c.closePath(); c.fillStyle = '#ffffff40'; c.fill(); c.strokeStyle = '#fff'; c.lineWidth = 7; c.stroke(); }
    for (let i = 0; i < N; i++) { const a = (i + .5) * TAU / N; c.save(); c.translate(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4)); const q = c.createRadialGradient(-2, -2, 1, 0, 0, 7); q.addColorStop(0, '#fff'); q.addColorStop(1, '#7d8aa3'); disc(c, 6.5, q); c.restore(); }
    c.restore();
    g = c.createRadialGradient(0, 0, R - 60, 0, 0, R); g.addColorStop(0, '#0000'); g.addColorStop(1, '#0007'); disc(c, R, g);
    g = c.createLinearGradient(0, -R, 0, R); g.addColorStop(0, '#ffffff3d'); g.addColorStop(.45, '#ffffff00'); g.addColorStop(1, '#00000059'); disc(c, R, g);
    c.save(); c.shadowColor = '#000c'; c.shadowBlur = 34; c.shadowOffsetY = 16; disc(c, 126, '#140a06'); c.restore(); disc(c, 126, metal(c, 1)); disc(c, 114, '#140a06');
    g = c.createRadialGradient(-30, -45, 10, 0, 0, 125); g.addColorStop(0, '#8a5230'); g.addColorStop(1, '#2c150b'); disc(c, 110, g);
    c.lineWidth = 3; c.strokeStyle = '#c9a14a'; c.beginPath(); c.arc(0, 0, 92, 0, TAU); c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#f3dc98'; c.font = '700 46px ' + FONT; c.fillText('RARE', 0, -24); c.fillText('HOURS', 0, 26);
    c.setTransform(1, 0, 0, 1, CX, 42); c.save(); c.shadowColor = '#000b'; c.shadowBlur = 14; c.shadowOffsetY = 8; c.rotate(flap);
    g = c.createLinearGradient(-20, 0, 20, 0); g.addColorStop(0, '#fff6dd'); g.addColorStop(.5, '#f4ecd8'); g.addColorStop(1, '#a99a78'); c.fillStyle = g;
    c.beginPath(); c.moveTo(-19, 0); c.lineTo(19, 0); c.lineTo(0, 130); c.closePath(); c.fill(); c.restore();
    g = c.createLinearGradient(0, -32, 0, 32); g.addColorStop(0, '#f7e6ae'); g.addColorStop(1, '#7a5a1c'); c.fillStyle = g; c.fillRect(-46, -32, 92, 50); c.strokeStyle = '#3d2c0c'; c.lineWidth = 3; c.strokeRect(-46, -32, 92, 50); disc(c, 9, '#3d2c0c'); c.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Server dictates the landing field and the duration (3 to 7 s); we animate toward it.
  let spinKey = null, spinRaf = 0;
  function spinTo(sp) {
    cancelAnimationFrame(spinRaf); hitSeg = -1;
    const from = angle, target = -(sp.idx + (Math.random() - .5) * .7) * TAU / N;
    const remain = Math.max(300, sp.dur - (now() - sp.at)), dist = ((target - from) % TAU + TAU) % TAU + (CALM ? 1 : sp.turns) * TAU;
    const t0 = performance.now(); let seg = null;
    const stepF = () => {
      const p = Math.min(1, (performance.now() - t0) / remain); angle = from + dist * (1 - Math.pow(1 - p, 3.4));
      const s = Math.floor(angle / (TAU / N) + .5); flap *= .8; if (seg !== null && s !== seg) { flap = .45; tone(850, .03, .03); } seg = s; blink = Math.floor(p * 40);
      if (p >= 1) { flap = 0; angle %= TAU; hitSeg = sp.idx; draw(); return; }
      draw(); spinRaf = requestAnimationFrame(stepF);
    };
    spinRaf = requestAnimationFrame(stepF);
  }

  // ---- Table ----
  let chip = 5, myTot = 0, pendingRepeat = false, lastPhase = null, lastRound = -1, lastWinShown = null;
  function setupTable() {
    cx = $('wheel').getContext('2d');
    $('street').innerHTML = KEYS.map(k => { const t = TYPES[k]; return `<button class="house ${t.pay ? '' : 'bonus'}" id="h-${k}" style="--c:${t.c};--t:${t.t}" aria-label="Bet on ${t.n}"><span class="dots"></span><span class="n">${t.n}</span><span class="p">${t.pay ? t.pay + ' : 1' : 'Bonus'}</span><span class="stake"></span></button>`; }).join('');
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
<div class="pays">${KEYS.map(k => { const t = TYPES[k]; return `<div style="--c:${t.c}">${t.n}<small>${t.pay ? 'pays ' + t.pay + ' : 1' : 'Bonus game'}</small></div>`; }).join('')}</div></section>
<section class="rsec"><h3>Bonus games</h3><ul>
<li>You only play a bonus game if you bet on its field. Everyone else watches live.</li>
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
      $('lobby').hidden = true; $('game').hidden = false; setupTable(); renderChips(); makeFace(); draw();
      history.replaceState(null, '', location.pathname + '?join=' + m.code);
      try { sessionStorage.setItem('rh-room', m.code); } catch {}
      if (document.fonts) document.fonts.ready.then(() => { makeFace(); draw(); });
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
      h.querySelector('.stake').innerHTML = mine[k] ? stackHtml(mine[k]) + `<b>${fmt(mine[k])}</b>` : '';
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
    if (m.phase === 'betting' && lastPhase !== 'betting') { hitSeg = -1; draw(); document.body.classList.remove('won'); $('win').textContent = '0'; $('win').parentNode.classList.remove('up'); }
    // history
    $('hist').innerHTML = m.hist.slice(0, 10).map(k => { const t = TYPES[k]; return `<span style="background:${t.c};color:${t.t}" title="${t.n}">${t.pay ? t.n : t.n.split(' ').map(w => w[0]).join('')}</span>`; }).join('');
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
    function intro(m) {
      const n = m.next, part = !!(players[m.you].bets[n.cat]);
      const who = m.players.filter(p => p.bets[n.cat]).map(p => `<span class="bp ${p.id === m.you ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}</span>`).join('');
      accent(n.cat);
      box().innerHTML = `<div class="intro"><span class="cat">${CAT_NAMES[n.cat]}</span><h2>${esc(n.name)}</h2>
        <span class="badge ${part ? 'in' : 'watch'}">${part ? 'You are in. Get ready.' : 'Spectating: you did not bet on this field'}</span>
        ${rulesList(n.rules)}<div class="bplayers">${who}</div><div class="bt"><i></i></div></div>`;
      $('bonus').classList.add('on'); cur = null; last = null; tone(440, .5);
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
      box().querySelector('.bplayers').innerHTML = m.players.map(p => `<span class="bp ${p.id === m.me ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}<small>${ORRA}${fmt(p.stake)}</small>${p.shield ? `<span class="tag" title="Shields">Shield ${p.shield}</span>` : ''}${p.swap ? `<span class="tag" title="Swap tokens">Swap ${p.swap}</span>` : ''}</span>`).join('') + (m.part ? '' : '<span class="bp watch">You are spectating</span>');
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
        <table class="res"><tr><th>Player</th><th class="n">Result</th><th class="n">Stake</th><th class="n">Collect</th></tr>${rows.map(r => `<tr class="${r.id === m.you ? 'me' : ''}"><td><span class="pdot" style="--c:${pl(r.id).color}"></span>${esc(pl(r.id).name)}</td><td class="n">${fx2(r.m)}x</td><td class="n">${fmt(r.stake)}</td><td class="n">${orra(r.win)}</td></tr>`).join('')}</table>
        <button class="btn go" id="bclose">Back to the table</button></div></div>`);
      const b = $('bclose'); if (b) { b.onclick = close; b.focus(); }
    }
    function close() { $('bonus').classList.remove('on'); cur = null; inst = null; last = null; }
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

  function boot() { scenery(); lobby(); connect(); document.querySelectorAll('.orra-inline').forEach(e => e.innerHTML = ORRA); }
  return { boot, G, h: esc, esc, fmt, fx2, ORRA, orra, now, tone, segWheel, spinPos, drawBoard, track, smooth, coinFlip, coinHtml, secs, toast, FONT, TAU, metal, disc };
})();
