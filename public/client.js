'use strict';
// Gekke Tijd client: lobby, main wheel, table, bonus overlay host. Subgame renderers live in games/*.js
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
  const short = n => n >= 1e4 ? (Math.round(n / 1e3) + 'K') : n >= 1e3 ? (Math.round(n / 100) / 10 + 'K') : String(n);
  const initials = n => (String(n).replace(/[^\p{L}\p{N}]/gu, '') || '?').slice(0, 2).toUpperCase();

  // ---- Sound ----
  // Samples and synth blips both run through Sfx (sfx.js): variant shuffle, pitch/level spread, soft fades.
  // Three levels, cycled by the speaker button: full, low (45%), mute.
  const SND = { on: 1, low: .45, off: 0 }, SND_NEXT = { on: 'low', low: 'off', off: 'on' };
  let sndMode = SND[store.get('rh-sound')] !== undefined ? store.get('rh-sound') : 'on';
  const applySnd = () => { Sfx.on = sndMode !== 'off'; Sfx.vol = SND[sndMode] || 1; };
  applySnd();
  const tone = (f, d = .08, v = .05) => Sfx.tone(f, d, v);
  const sfx = (n, v = .8, o = {}) => Sfx.play(n, { vol: v / .8, ...o });
  // Urgent countdown: one tick per second over the last n seconds. It escalates: woodblock first, tighter and louder,
  // a stopwatch layer joins at 2, the modern tick marks the final second. Ticks alternate a little left/right (tick, tock).
  // A tick only plays right at its second boundary, so a hidden tab or a lag spike never fires a late or doubled tick.
  const countdown = () => {
    let key = '', prev = 1e9;
    return (id, left, n, vol = 1) => {
      const sec = Math.ceil(left / 1000);
      if (id !== key) { key = id; prev = sec; return; }
      if (sec === prev) return;
      const fresh = sec < prev && left > sec * 1000 - 260 && sec >= 1 && sec <= n; prev = sec;
      if (!fresh) return;
      const u = n > 1 ? (n - sec) / (n - 1) : 1, pan = sec % 2 ? -.18 : .18;
      if (sec > 1) Sfx.play('tick-wood', { vol: vol * (.55 + u * .45), rate: 1 + u * .12, pan, force: true });
      if (sec === 2) Sfx.play('tick-stopwatch', { vol: vol * .75, pan: -pan, force: true, delay: 15 });
      if (sec === 1) { Sfx.play('tick-modern', { vol: vol * 1.05, force: true }); Sfx.play('tick-wood', { vol: vol * .5, rate: 1.18, pan, force: true }); }
    };
  };
  const betTick = countdown(), bonusTick = countdown();

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
    if (m.t === 'hello') { if (!S && 'won' in m) lifeStats(m.won, m.lost, m.bal); token = m.token; store.set('rh-token', token); send({ t: 'ping', c: Date.now() }); if (roomCode) send({ t: 'join', code: roomCode }); return; }
    if (m.t === 'err') { if (!S) { $('lerr').textContent = m.msg; if (/No lobby/.test(m.msg)) roomCode = null; } else { if (/Orra|maximum/.test(m.msg)) { sfx('no_tokens_left'); pendingRepeat = false; } toast(/No lobby/.test(m.msg) ? 'The host left, so this lobby is closed.' : m.msg, 3200, 'bad'); if (/No lobby/.test(m.msg)) { try { sessionStorage.removeItem('rh-room'); } catch {} setTimeout(() => location.href = location.pathname, 3000); } } return; }
    if (m.t === 'catalog') { catalog = m.games; return; }
    if (m.t === 'room') { if (bestRtt > 1e8) off = m.now - Date.now(); onRoom(m); return; }
    if (m.t === 'bonus') return Bonus.update(m);
    if (m.t === 'fx') return Bonus.fx(m);
  }

  // ---- Lobby screen ----
  // Run settings shown when creating a lobby. Values mirror RUN_OPTS in core.js, which checks them again.
  // Each row: key, label, hint, options, modes it shows in. Battle keeps its stack in `stack`, sent as `start`.
  const STORM_EVERY = { slow: 6, normal: 4, fast: 3 };
  const RUN = [
    ['start', 'Starting balance', 'Own wallet: your saved Orra. Fixed: same start for all, part of each win is saved.', [[0, 'Own wallet'], [500, '500'], [1000, '1K'], [2500, '2.5K'], [5000, '5K'], [10000, '10K']], 'classic'],
    ['limit', 'Max bet per round', 'The level limit grows as you level up.', [['level', 'Level limit'], ['none', 'No limit']], 'classic'],
    ['stack', 'Stack', 'Everyone starts with this.', [[500, '500'], [1000, '1K'], [2500, '2.5K'], [5000, '5K']], 'battle'],
    ['target', 'Win at', 'First to reach this amount wins.', c => [2, 3, 5].map(v => [v, short(c.stack * v) + ' (x' + v + ')']), 'battle'],
    ['storm', 'Storm', 'Ante every round, it climbs every few rounds.', [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], 'battle'],
    ['bet', 'Betting time', 'Seconds per round to place bets.', [5, 8, 12, 15, 20, 30].map(v => [v, v + 's'])],
    ['spin', 'Wheel spin', 'Time before the wheel lands.', [['short', '2 to 4s'], ['normal', '3 to 7s'], ['long', '6 to 10s']]],
    ['late', 'Late buy-ins', 'Join bonus games you did not bet on.', [['on', 'On'], ['off', 'Off']]],
    ['boost', 'Prime Minute', 'One field per round pays x2 to x5.', [['on', 'On'], ['off', 'Off']]],
    ['max', 'Players', 'Maximum, including you.', [2, 3, 4, 5, 6, 7, 8].map(v => [v, String(v)])]
  ];
  const MODES = [
    ['classic', 'Classic', 'Play the wheel at your own pace. Levels, Cashier and your own wallet.'],
    ['battle', 'Battle', 'Same stack for all. First to the target wins, the Storm drains the rest.']
  ];
  const RUN_DEF = { mode: 'classic', start: 0, bet: 8, spin: 'normal', limit: 'level', late: 'on', boost: 'on', max: 8, stack: 1000, target: 3, storm: 'normal' };
  let runCfg = (() => { try { const c = JSON.parse(store.get('rh-cfg') || 'null'); return { ...RUN_DEF, ...(c || {}) }; } catch { return { ...RUN_DEF }; } })();
  const runSend = () => { const c = { ...runCfg }; if (c.mode === 'battle') { c.start = c.stack; c.limit = 'none'; } delete c.stack; return c; };
  const anteNow = c => Math.max(5, Math.round(c.stack * .01 / 5) * 5);
  function runSummary(c) {
    const spin = { short: 'short', normal: 'normal', long: 'long' }[c.spin];
    if (c.mode === 'battle') return `${short(c.stack)} each, first to <b>${short(c.stack * c.target)}</b> wins. Ante starts at ${anteNow(c)} and climbs every ${STORM_EVERY[c.storm]} rounds. Up to ${c.max} players.`;
    return `${c.start ? short(c.start) + ' each' : 'Own wallet'}, ${c.limit === 'none' ? 'no bet limit' : 'level bet limit'}, ${c.bet}s to bet, ${spin} spins. Up to ${c.max} players.`;
  }
  function lifeStats(won, lost, bal) { $('lwon').textContent = fmt(won || 0); $('llost').textContent = fmt(lost || 0); if (typeof bal === 'number') $('lwal').textContent = fmt(bal); }
  function lobby() {
    const q = new URLSearchParams(location.search), j = (q.get('join') || '').toUpperCase().slice(0, 4);
    $('nm').value = myName; $('jc').value = j;
    try { const p = JSON.parse(store.get('rh-prof') || 'null'); if (p) lifeStats(p.won, p.lost, p.bal); } catch {}
    if (j) { $('joinbox').querySelector('h3').textContent = `You are invited to lobby ${j}`; }
    const name = () => { myName = $('nm').value.trim().slice(0, 16); if (!myName) { $('lerr').textContent = 'Enter a name first.'; $('nm').focus(); return false; } store.set('rh-name', myName); send({ t: 'hello', token, name: myName }); return true; };
    const view = v => { $('home').hidden = v !== 'home'; $('setup').hidden = v !== 'setup'; $('lobby').classList.toggle('wide', v === 'setup'); $('lerr').textContent = ''; };
    const opts = () => {
      const c = runCfg, rows = RUN.filter(r => !r[4] || r[4] === c.mode);
      $('opts').innerHTML = `<div class="modes" role="radiogroup" aria-label="Game mode">${MODES.map(([v, t, d]) => `<button type="button" role="radio" class="mode ${v}${c.mode === v ? ' on' : ''}" data-k="mode" data-v="${v}" aria-checked="${c.mode === v}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
        <div class="rows">${rows.map(([k, t, d, vals]) => { vals = typeof vals === 'function' ? vals(c) : vals; return `<div class="orow"><div class="olab"><b>${t}</b><small>${d}</small></div><div class="seg" role="radiogroup" aria-label="${t}">${vals.map(([v, l]) => `<button type="button" role="radio" data-k="${k}" data-v="${v}" aria-checked="${c[k] === v}" class="${c[k] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`; }).join('')}</div>
        <p class="osum">${runSummary(c)}</p>`;
      $('opts').querySelectorAll('[data-k]').forEach(b => b.onclick = () => {
        const k = b.dataset.k;
        let v = b.dataset.v;
        if (k !== 'mode') { const row = RUN.find(r => r[0] === k && (!r[4] || r[4] === runCfg.mode)), vals = typeof row[3] === 'function' ? row[3](runCfg) : row[3]; v = vals.find(x => String(x[0]) === v)[0]; }
        runCfg[k] = v; store.set('rh-cfg', JSON.stringify(runCfg)); tone(k === 'mode' ? 440 : 520, .04, .03); opts();
        $('opts').querySelector(`[data-k="${k}"][data-v="${b.dataset.v}"]`).focus();
      });
      $('sgo').textContent = c.mode === 'battle' ? 'Open battle lobby' : 'Open lobby';
    };
    let pickCode = '';
    $('cb').onclick = () => {
      if (!name()) return;
      pickCode = $('cv').value.toUpperCase().trim();
      if (pickCode && !/^[A-Z0-9]{4}$/.test(pickCode)) { $('lerr').textContent = 'Code: exactly 4 letters or digits, or empty.'; $('cv').focus(); return; }
      $('scode').innerHTML = pickCode ? `Code <b>${esc(pickCode)}</b>` : 'Random code';
      view('setup'); opts(); $('sgo').focus();
    };
    $('sback').onclick = () => { view('home'); $('cv').focus(); };
    $('sreset').onclick = () => { runCfg = { ...RUN_DEF, mode: runCfg.mode }; store.set('rh-cfg', JSON.stringify(runCfg)); opts(); };
    $('sgo').onclick = () => {
      if (!name()) { view('home'); return; }
      $('lerr').textContent = 'Opening lobby...'; roomCode = null; setTimeout(() => send({ t: 'create', code: pickCode, cfg: runSend() }), 50);
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
  // Style: printed carnival poster. Flat inks, two-tone (cel) shading, halftone dots and hard offset shadows instead of soft fades.
  const COINS = [[5, '#b8452f', '#5c1a0e'], [10, '#2463b8', '#0d2f63'], [25, '#12805f', '#053f2e'], [100, '#23283a', '#05070d'], [500, '#c98a1e', '#6b4206']];
  function chipSvg([v, c, d]) {
    let e = ''; for (let i = 0; i < 8; i++) e += `<path d="M-8 -48A49 49 0 0 1 8 -48L6 -35H-6Z" fill="#fff6e6" transform="rotate(${i * 45})"/>`;
    return `<svg viewBox="-50 -50 100 100" aria-hidden="true"><circle r="49" fill="${d}"/><circle r="47" fill="${c}"/>${e}<circle r="35" fill="${d}"/><circle r="32" fill="#fff6e6"/><circle r="28" fill="${c}"/><path d="M-41 -20A46 46 0 0 1 20 -41" stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none"/><text x="${v > 99 ? 1 : 1.2}" y="${v > 99 ? 7 : 8}" text-anchor="middle" font-family='${FONT}' font-weight="400" font-size="${v > 99 ? 21 : 25}" letter-spacing="${v > 99 ? 2 : 2.4}" fill="#fff" stroke="#fff" stroke-width="${v > 99 ? 1.3 : 1.6}" stroke-linejoin="round">${v}</text></svg>`;
  }
  function stackHtml(n) { const a = []; for (const c of [...COINS].reverse()) while (n >= c[0] && a.length < 5) { a.push(c); n -= c[0]; } return '<span class="stack">' + a.map((c, i) => chipSvg(c).replace('<svg', '<svg style="bottom:' + i * 4 + 'px"')).join('') + '</span>'; }

  // Skin per field: f = wheel wedge, pl = number plaque, tk = desk ticket.
  const SKIN = {
    one: { f: '#BFE3D6', pl: '#34434A', tk: '#7FA596' }, two: { f: '#F6C343', pl: '#664632', tk: '#C9953F' },
    five: { f: '#F4B6B0', pl: '#574C6C', tk: '#C98886' }, ten: { f: '#C9B6E4', pl: '#4B2342', tk: '#8F7AB0' },
    spare: { f: '#1F3C9E', tk: '#2343AE' }, grab: { f: '#1E7A3C', tk: '#1F8441' }, drop: { f: '#A02A8E', tk: '#A42C92' }, prod: { f: '#B3202A', tk: '#BA2430' }
  };
  const INK = '#2b1606', G1 = '#FFF0B8', G2 = '#F2C65A', G3 = '#D9A13A', G4 = '#A8721E', CREAM = '#FFF4DC', TITLE = '#FFD45C';
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',') + ')'; };
  // Bonus medallions, shared by the wheel (as images) and the desk tickets (inline). Flat inks, a light half and a dark half.
  const GLYPH = {
    spare: `<circle r="10" fill="${G3}" stroke="${INK}" stroke-width="1.3"/><path d="M-7.1-7.1A10 10 0 0 1 7.1 7.1Z" fill="${G2}"/><circle r="6.6" fill="none" stroke="${INK}" stroke-width="1.5"/><path d="M-3.2-4.3h6.4L0 0l3.2 4.3h-6.4L0 0z" fill="${INK}"/>`,
    grab: `<path d="M-10-3-5.5-8.5h11L10-3 0 10z" fill="#BFE6FA" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/><path d="M-10-3H0L0 10z" fill="#8CC6E6"/><path d="M-10-3h20M-5.5-8.5-3-3 0 10 3-3 5.5-8.5M-3-3 0-8.5 3-3" fill="none" stroke="${INK}" stroke-width=".9"/>`,
    drop: `<circle cy="-3" r="5.8" fill="#F4F1EA" stroke="${INK}" stroke-width="1.1"/><path d="M1.5-8.3A5.8 5.8 0 0 1 1.5 2.3 5.8 5.8 0 0 0 1.5-8.3" fill="#C9CCD6"/><g fill="${G2}" stroke="${INK}" stroke-width=".8"><circle cx="-7.5" cy="7" r="2"/><circle cx="7.5" cy="7" r="2"/><circle cy="10.5" r="2"/></g>`,
    prod: `<circle r="10" fill="${CREAM}" stroke="${INK}" stroke-width="1.4"/><path d="M0-8.2v2M8.2 0h-2M0 8.2v-2M-8.2 0h2" stroke="${INK}" stroke-width="1.4"/><path d="M0 0V-6.4M0 0l4.6 2.8" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><circle r="1.7" fill="#B3202A"/>`
  };
  const medal = k => `<svg viewBox="-20 -20 40 40" aria-hidden="true"><circle r="19.4" fill="${G3}" stroke="${INK}" stroke-width="1.2"/><path d="M-13.7-13.7A19.4 19.4 0 0 1 13.7 13.7Z" fill="${G2}"/><circle r="15.4" fill="${mix(SKIN[k].f, '#000000', .45)}" stroke="${INK}" stroke-width="1.2"/>${GLYPH[k]}</svg>`;
  const STACK_BADGE = `<svg viewBox="-20 -20 40 40" aria-hidden="true">${[8, 1, -6].map((y, i) => `<ellipse cy="${y + 3}" rx="13" ry="5" fill="${INK}"/><rect x="-13" y="${y}" width="26" height="3" fill="${i % 2 ? G4 : '#8a1420'}"/><ellipse cy="${y}" rx="13" ry="5" fill="${i % 2 ? G2 : '#D8322B'}" stroke="${INK}" stroke-width=".8"/><ellipse cy="${y}" rx="9" ry="3.3" fill="none" stroke="${CREAM}" stroke-width="1.4" stroke-dasharray="2.4 2.2"/>`).join('')}</svg>`;
  const ICON = {};
  BONUS_KEYS.forEach(k => { const im = new Image(); im.onload = () => { if (cx) { makeArt(); draw(); } }; im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(medal(k).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"')); ICON[k] = im; });

  // Stage: art deco swirl in flat bands, emerald left and crimson to hot pink right, gold rules, string lights, halftone screen.
  function scenery() {
    const X = 800, Y = 330, n = 16, pt = (cx, cy, r, a) => (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1);
    let s = `<defs><pattern id="sc-ht" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="3.5" cy="3.5" r="1.25" fill="#12030a"/></pattern></defs><rect width="1600" height="900" fill="#12050b"/>`;
    const lights = ['', '', ''];
    for (let i = n - 1; i >= 0; i--) {
      const cx = X + i * 7, cy = Y + i * 11, r = 250 + i * 82, sp = Math.PI / 2 + i * .16, odd = i % 2;
      const lit = Math.min(1, i / 5) * (1 - Math.max(0, i - 5) / 14); // deep near the wheel, brightest a few bands out
      const green = mix('#06281a', odd ? '#157e4d' : '#0e623a', lit), pink = mix('#3e0516', odd ? '#c93d78' : '#9c1844', lit);
      s += `<path d="M${pt(cx, cy, r, sp)}A${r} ${r} 0 0 1 ${pt(cx, cy, r, sp + Math.PI)}Z" fill="${green}"/><path d="M${pt(cx, cy, r, sp + Math.PI)}A${r} ${r} 0 0 1 ${pt(cx, cy, r, sp)}Z" fill="${pink}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#2b0d0d" stroke-width="${odd ? 5 : 3}"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${G3}" stroke-opacity="${(.35 + lit * .5).toFixed(2)}" stroke-width="${odd ? 2.2 : 1.2}"/>`;
      if (odd) { const m = Math.round(TAU * r / 44); for (let j = 0; j < m; j++) { const a = j / m * TAU, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (x > -10 && x < 1610 && y > -10 && y < 910) lights[j % 3] += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="#ffd9a0" opacity=".2"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.2" fill="${CREAM}" stroke="${INK}" stroke-width=".8"/>`; } }
    }
    s += '<rect width="1600" height="900" fill="url(#sc-ht)" opacity=".35"/>' + lights.map((l, i) => `<g class="tw t${i}">${l}</g>`).join('');
    $('scene').innerHTML = s;
  }

  // ---- Main wheel (canvas). Logical size 1100 x 1100, drawn at K x resolution. Static layers are cached. ----
  const K = 1.5, W = 1100, H = 1100, R = 450, CX = 550, CY = 575, FR = R + 4, HUB = 134;
  let cx, face, base, over, pegImg, bulbOn, bulbOff, glit, angle = 0, flap = 0, blink = 0, hitSeg = -1;
  function layer(w, h) { const e = document.createElement('canvas'); e.width = Math.ceil(w * K); e.height = Math.ceil(h * K); const c = e.getContext('2d'); c.scale(K, K); return [e, c]; }
  // Canvas twin of the CSS heft scale in style.css. Escargoth has one weight (400), so heft h (0..3) is a hairline
  // outline plus tracking that grows slightly faster than the outline. Always set canvas fonts through heft().
  function heft(c, px, h = 2) { c.font = `400 ${px}px ${FONT}`; c.letterSpacing = ((.01 + h * .015) * px).toFixed(2) + 'px'; c.heftW = h * .011 * px; }
  function htext(c, s, x, y, max) {
    s = String(s);
    if (c.heftW) { c.save(); c.lineJoin = 'round'; c.lineWidth = c.heftW; c.strokeStyle = c.fillStyle; max ? c.strokeText(s, x, y, max) : c.strokeText(s, x, y); c.restore(); }
    max ? c.fillText(s, x, y, max) : c.fillText(s, x, y);
  }
  function disc(c, r, f) { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = f; c.fill(); }
  function ringPath(c, r0, r1) { c.beginPath(); c.arc(0, 0, r1, 0, TAU); c.arc(0, 0, r0, 0, TAU, true); }
  function ring(c, r0, r1, f) { ringPath(c, r0, r1); c.fillStyle = f; c.fill(); }
  function wedge(c, a, w, r0, r1) { c.beginPath(); c.arc(0, 0, r1, a - w, a + w); c.arc(0, 0, r0, a + w, a - w, true); c.closePath(); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function poly(c, p, r) { c.beginPath(); const n = p.length; for (let i = 0; i < n; i++) { const a = p[i], b = p[(i + 1) % n], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (!i) c.moveTo(m[0], m[1]); const d = p[(i + 2) % n]; c.arcTo(b[0], b[1], (b[0] + d[0]) / 2, (b[1] + d[1]) / 2, r); } c.closePath(); }
  // Fill the top-left half plane (light comes from the top left) inside the current clip.
  function lightHalf(c, f, off = 0, big = 2000) { c.beginPath(); c.moveTo(-big + off, -big + off); c.lineTo(big + off, -big + off); c.lineTo(-big + off, big + off); c.closePath(); c.fillStyle = f; c.fill(); }
  // Cel shaded gold band: base ink, a light top-left half, a highlight rule, inked edges.
  function goldBand(c, r0, r1) {
    ring(c, r0, r1, G3); c.save(); ringPath(c, r0, r1); c.clip(); lightHalf(c, G2); c.restore();
    c.beginPath(); c.arc(0, 0, r1 - Math.min(3, (r1 - r0) / 3), Math.PI * 1.02, Math.PI * 1.48); c.lineWidth = 1.8; c.strokeStyle = G1; c.stroke();
    c.lineWidth = 1.5; c.strokeStyle = INK; [r0, r1].forEach(r => { c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); });
  }
  function metal(c, rot = 0) { const g = c.createConicGradient(rot, 0, 0); [G1, G3, G4, G2, G1, G3, G4, G2, G1].forEach((x, i) => g.addColorStop(i / 8, x)); return g; }
  const hsh = n => { n = Math.imul(n ^ n >>> 15, 0x2c1b3c6d); n = Math.imul(n ^ n >>> 12, 0x297a2d39); return ((n ^ n >>> 15) >>> 0) / 4294967296; };
  function spark(c, x, y, s, a) { c.save(); c.translate(x, y); c.globalAlpha = a; c.fillStyle = '#fffbe8'; c.beginPath(); c.moveTo(0, -s); c.quadraticCurveTo(0, 0, s, 0); c.quadraticCurveTo(0, 0, 0, s); c.quadraticCurveTo(0, 0, -s, 0); c.quadraticCurveTo(0, 0, 0, -s); c.fill(); c.restore(); }
  function glitter() {
    if (glit) return glit;
    const e = document.createElement('canvas'); e.width = e.height = 200; const c = e.getContext('2d'); let s = 11;
    const rnd = () => (s = s * 16807 % 2147483647) / 2147483647;
    for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(255,${235 + rnd() * 20 | 0},${170 + rnd() * 85 | 0},${(.15 + rnd() * .5).toFixed(2)})`; c.beginPath(); c.arc(rnd() * 200, rnd() * 200, .4 + rnd() * rnd() * 1.3, 0, TAU); c.fill(); }
    for (let i = 0; i < 10; i++) spark(c, rnd() * 200, rnd() * 200, 2 + rnd() * 2.5, .85);
    return glit = e;
  }
  function bulb(on) {
    const [e, c] = layer(36, 36); c.translate(18, 18);
    if (on) disc(c, 10, 'rgba(255,226,150,.3)');
    disc(c, 5.8, INK); disc(c, 4.6, on ? CREAM : '#6e4a2a');
    if (on) { c.save(); c.beginPath(); c.arc(0, 0, 4.6, 0, TAU); c.clip(); lightHalf(c, '#FFE6A8', 1.6, 20); c.restore(); c.beginPath(); c.arc(-1.5, -1.6, 1.3, 0, TAU); c.fillStyle = '#fff'; c.fill(); }
    return e;
  }
  function makePeg() {
    const [e, c] = layer(24, 24); c.translate(12, 12);
    c.beginPath(); c.arc(1.6, 2.4, 6, 0, TAU); c.fillStyle = 'rgba(30,10,4,.5)'; c.fill();
    disc(c, 6, G4); c.save(); c.beginPath(); c.arc(0, 0, 6, 0, TAU); c.clip(); lightHalf(c, G2, 1, 20); c.restore();
    c.beginPath(); c.arc(0, 0, 6, 0, TAU); c.lineWidth = 1.2; c.strokeStyle = INK; c.stroke();
    c.beginPath(); c.arc(-2, -2.2, 1.4, 0, TAU); c.fillStyle = G1; c.fill();
    return e;
  }
  // Halftone screen toward the hub: dots shrink outward, replacing a gradient fade.
  function halftone(c, w, col) {
    c.fillStyle = col;
    for (let r = 132, row = 0; r < 262; r += 8.5, row++) {
      const d = 3.1 * (1 - (r - 132) / 140); if (d < .45) break;
      const n = Math.max(1, Math.floor(2 * r * w / 8.5)), step = 2 * w / n;
      for (let j = 0; j < n; j++) { const a = -w + (j + (row % 2 ? .25 : .75)) * step; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, d, 0, TAU); c.fill(); }
    }
  }
  function plaque(c, t, s) {
    c.save(); c.translate(R - 128, 0); c.rotate(Math.PI / 4); c.fillStyle = s.pl; c.fillRect(-4, -4, 8, 8); c.restore();
    c.save(); c.translate(R - 55, 0); c.rotate(Math.PI / 2);
    const w = 44, h = 62;
    rr(c, -w / 2 + 2.5, -h / 2 + 3.5, w, h, 10); c.fillStyle = 'rgba(30,10,4,.45)'; c.fill();
    rr(c, -w / 2, -h / 2, w, h, 10); c.fillStyle = s.pl; c.fill();
    c.save(); c.clip(); c.fillStyle = mix(s.pl, '#000000', .3); c.fillRect(-w / 2, h / 2 - 7, w, 7); c.fillStyle = mix(s.pl, '#ffffff', .2); c.fillRect(-w / 2, -h / 2, w, 3); c.restore();
    rr(c, -w / 2, -h / 2, w, h, 10); c.lineWidth = 1.6; c.strokeStyle = INK; c.stroke();
    rr(c, -w / 2 + 4, -h / 2 + 4, w - 8, h - 11, 6.5); c.lineWidth = 1.2; c.strokeStyle = 'rgba(255,244,220,.55)'; c.stroke();
    heft(c, t.pay > 9 ? 40 : 46, 3); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = INK; htext(c, t.n, 1.2, 1.5, w - 9); c.fillStyle = CREAM; htext(c, t.n, 0, -1, w - 9);
    c.restore();
  }
  function stripe(c, k, t) {
    const txt = t.n.toUpperCase(), x0 = 168, x1 = R - 60, fs = 27, x = (x0 + x1) / 2;
    c.save(); heft(c, fs, 2.5); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.fillStyle = INK; c.fillText(txt, x + 1.5, 4, x1 - x0); c.lineWidth = 4; c.strokeStyle = INK; c.strokeText(txt, x, 1.5, x1 - x0);
    c.fillStyle = TITLE; htext(c, txt, x, 1.5, x1 - x0); c.restore();
    c.save(); c.translate(R - 30, 0); c.rotate(Math.PI / 2); if (ICON[k].complete && ICON[k].naturalWidth) c.drawImage(ICON[k], -19, -19, 38, 38); c.restore();
  }
  function makeFace() {
    let c; [face, c] = layer(2 * FR, 2 * FR); c.translate(FR, FR);
    const w = TAU / N / 2, pat = c.createPattern(glitter(), 'repeat');
    DIAL.forEach((k, i) => {
      const t = TYPES[k], s = SKIN[k], a = i * TAU / N - Math.PI / 2;
      wedge(c, a, w + .002, 0, R); c.fillStyle = s.f; c.fill();
      c.save(); c.clip();
      if (t.pay) { c.rotate(a); halftone(c, w, mix(s.f, s.pl, .32)); }
      else { c.globalCompositeOperation = 'screen'; c.globalAlpha = .35; c.fillStyle = pat; c.fill(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.rotate(a); halftone(c, w, 'rgba(0,0,0,.28)'); }
      c.restore();
      c.save(); c.rotate(a); t.pay ? plaque(c, t, s) : stripe(c, k, t); c.restore();
    });
    for (let i = 0; i < N; i++) {
      const a = (i + .5) * TAU / N - Math.PI / 2, x = Math.cos(a), y = Math.sin(a);
      c.beginPath(); c.moveTo(x * 120, y * 120); c.lineTo(x * R, y * R); c.strokeStyle = INK; c.lineWidth = 3.2; c.stroke(); c.strokeStyle = G2; c.lineWidth = 1.2; c.stroke();
    }
  }
  function crescent(c, r, dx, dy, f) { c.save(); c.beginPath(); c.arc(0, 0, r, 0, TAU); c.clip(); c.beginPath(); c.arc(0, 0, r, 0, TAU); c.arc(dx, dy, r, 0, TAU, true); c.fillStyle = f; c.fill('evenodd'); c.restore(); }
  function hub(c) {
    c.save(); c.translate(5, 9); disc(c, HUB, 'rgba(30,10,4,.5)'); c.restore();
    goldBand(c, HUB - 12, HUB); ring(c, 101, HUB - 12, '#5c0f2c');
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .4; ring(c, 101, HUB - 12, c.createPattern(glitter(), 'repeat')); c.restore();
    goldBand(c, 95, 101);
    for (let i = 0; i < 32; i++) { c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 95, i * TAU / 32, (i + 1) * TAU / 32); c.closePath(); c.fillStyle = i % 2 ? '#C4261F' : '#DC342C'; c.fill(); }
    crescent(c, 95, 18, 26, 'rgba(255,240,215,.13)');
    c.beginPath(); c.arc(0, 0, 95, 0, TAU); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke();
    if (hubLogo) return;
    // Fallback until the logo image is decoded: our display face, slanted, flat gold with an inked offset shadow and a swash
    c.save(); c.transform(1, 0, -.18, 1, 0, 0); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const lines = [['Gekke', -20, 44], ['Tijd', 25, 52]];
    for (const [s, y, f] of lines) { heft(c, f, 3); c.fillStyle = INK; c.fillText(s, 3, y + 4); c.lineWidth = 3; c.strokeStyle = INK; c.strokeText(s, 0, y); }
    for (const [s, y, f] of lines) { heft(c, f, 3); c.fillStyle = TITLE; htext(c, s, 0, y); }
    c.restore();
    c.beginPath(); c.moveTo(-56, 56); c.quadraticCurveTo(0, 45, 60, 54); c.lineCap = 'round'; c.lineWidth = 4.5; c.strokeStyle = INK; c.stroke(); c.lineWidth = 2; c.strokeStyle = TITLE; c.stroke();
    spark(c, -64, -26, 6, 1); spark(c, 66, 8, 5, .9);
  }
  function makeBase() {
    let c; [base, c] = layer(W, H); c.translate(CX, CY);
    c.save(); c.translate(8, 16); disc(c, R + 56, 'rgba(18,4,10,.55)'); c.restore();
    for (let i = 10; i > 0; i--) { c.save(); c.translate(0, i); disc(c, R + 55, i > 6 ? INK : G4); c.restore(); }
    disc(c, R + 56, INK); goldBand(c, R + 41, R + 55);
    ring(c, R + 17, R + 41, '#5c0f2c');
    c.save(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .45; ring(c, R + 17, R + 41, c.createPattern(glitter(), 'repeat')); c.restore();
    goldBand(c, R + 5, R + 17); ring(c, R, R + 5, INK); disc(c, R, INK);
  }
  function makeOver() {
    let c; [over, c] = layer(W, H); c.translate(CX, CY);
    ring(c, R - 6, R, 'rgba(30,10,4,.35)');
    crescent(c, R - 6, 70, 90, 'rgba(255,250,235,.11)');
    hub(c);
  }
  // The game logo sits on the hub, over the inner bulb ring. Pre-rendered once at its drawn size, with an inked drop shadow.
  const LOGO_W = 232, LOGO_H = LOGO_W * 598 / 1008;
  let hubLogo = null;
  (() => {
    const im = new Image(); im.decoding = 'async';
    im.onload = () => {
      const pad = 14, [e, c] = layer(LOGO_W + pad * 2, LOGO_H + pad * 2);
      c.shadowColor = 'rgba(18,4,10,.6)'; c.shadowOffsetX = 3 * K; c.shadowOffsetY = 6 * K; c.shadowBlur = 6 * K;
      c.imageSmoothingQuality = 'high'; c.drawImage(im, pad, pad, LOGO_W, LOGO_H);
      hubLogo = { e, pad };
      if (face) { makeOver(); draw(); }
    };
    im.src = 'img/logo.webp';
  })();
  function makeArt() { if (!bulbOn) { bulbOn = bulb(true); bulbOff = bulb(false); pegImg = makePeg(); } makeBase(); makeFace(); makeOver(); }
  const PTR = [[-48, -34], [48, -34], [48, 0], [0, 76], [-48, 0]], PIN = [[-38, -25], [38, -25], [38, -4], [0, 61], [-38, -4]];
  const PBULBS = (() => { const p = [[-30, -18], [30, -18], [30, -6], [0, 48], [-30, -6]], out = []; for (let i = 0; i < 5; i++) { const a = p[i], b = p[(i + 1) % 5], m = i === 0 ? 4 : i === 2 || i === 3 ? 3 : 1; for (let j = 0; j < m; j++) out.push([a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m]); } return out; })();
  function pointer(c) {
    c.setTransform(K, 0, 0, K, CX * K, 46 * K); c.rotate(flap); c.scale(1.2, 1.2);
    c.save(); c.translate(4, 7); poly(c, PTR, 10); c.fillStyle = 'rgba(18,4,10,.55)'; c.fill(); c.restore();
    poly(c, PTR, 10); c.fillStyle = G3; c.fill(); c.save(); c.clip(); c.fillStyle = G2; c.fillRect(-60, -50, 60, 150); c.restore();
    poly(c, PTR, 10); c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
    poly(c, PIN, 7); c.fillStyle = '#5c0f2c'; c.fill();
    c.save(); c.clip(); c.globalCompositeOperation = 'screen'; c.globalAlpha = .4; c.fillStyle = c.createPattern(glitter(), 'repeat'); c.fill(); c.restore();
    c.lineWidth = 1.8; c.strokeStyle = INK; c.stroke();
    PBULBS.forEach(([x, y], i) => c.drawImage(CALM || (i + blink) % 2 ? bulbOn : bulbOff, x - 12, y - 12, 24, 24));
    // red tip that dips into the segments
    const tip = [[-13, 54], [13, 54], [0, 88]];
    poly(c, tip, 3); c.fillStyle = '#A81E1A'; c.fill(); c.save(); c.clip(); c.fillStyle = '#E8443A'; c.fillRect(-20, 50, 20, 50); c.restore();
    poly(c, tip, 3); c.lineWidth = 2; c.strokeStyle = INK; c.stroke();
    c.save(); c.translate(0, 14); c.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * TAU - Math.PI / 2, r = i % 2 ? 5 : 12; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath();
    c.fillStyle = G2; c.fill(); c.lineWidth = 1.4; c.strokeStyle = INK; c.stroke(); c.restore();
  }
  function draw() {
    if (!face) return;
    const c = cx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(base, 0, 0);
    c.setTransform(K, 0, 0, K, CX * K, CY * K);
    c.save(); c.rotate(angle); c.drawImage(face, -FR, -FR, 2 * FR, 2 * FR);
    if (hitSeg >= 0) {
      const a = hitSeg * TAU / N - Math.PI / 2, w = TAU / N / 2, on = CALM || blink % 2;
      wedge(c, a, w, HUB, R); c.fillStyle = `rgba(255,248,225,${on ? .42 : .2})`; c.fill();
      c.lineJoin = 'round'; c.lineWidth = 8; c.strokeStyle = INK; c.stroke(); c.lineWidth = 4.5; c.strokeStyle = on ? G1 : G2; c.stroke();
    }
    c.restore();
    for (let i = 0; i < N; i++) { const a = angle + (i + .5) * TAU / N - Math.PI / 2; c.drawImage(pegImg, Math.cos(a) * (R - 10) - 12, Math.sin(a) * (R - 10) - 12, 24, 24); }
    c.setTransform(1, 0, 0, 1, 0, 0); { const x = (CX - R - 2) * K | 0, y = (CY - R - 2) * K | 0, d = (2 * R + 4) * K | 0; c.drawImage(over, x, y, d, d, x, y, d, d); } c.setTransform(K, 0, 0, K, CX * K, CY * K);
    for (let i = 0; i < 48; i++) { const a = (i + .5) / 48 * TAU; c.drawImage(CALM || (i + blink) % 3 ? bulbOn : bulbOff, Math.cos(a) * (R + 29) - 18, Math.sin(a) * (R + 29) - 18, 36, 36); }
    for (let i = 0; i < 24; i++) { const a = (i + .5) / 24 * TAU; c.drawImage(CALM || (i + blink) % 2 ? bulbOn : bulbOff, Math.cos(a) * 111.5 - 12, Math.sin(a) * 111.5 - 12, 24, 24); }
    if (hubLogo) { const p = hubLogo.pad; c.drawImage(hubLogo.e, -LOGO_W / 2 - p, -LOGO_H / 2 - p - 2, LOGO_W + p * 2, LOGO_H + p * 2); }
    if (!CALM) for (let i = 0; i < 5; i++) { const h = hsh(i * 7919 + blink * 104729), a = h * TAU, r = i < 3 ? R + 48 - (i % 2) * 37 : R + 29; spark(c, Math.cos(a) * r, Math.sin(a) * r, 6 + hsh(h * 1e9 | 0) * 5, .95); }
    pointer(c);
    c.setTransform(1, 0, 0, 1, 0, 0);
  }
  // Server dictates the landing field and the duration (3 to 7 s); we animate toward it.
  // The Glove (glove.js) grabs the wheel first: it may ask for a short delay and sets the spin force (turns and curve).
  let spinKey = null, spinRaf = 0, spinWait = 0, spinLive = false, spinSnd = null, tickMat = 0;
  const zoom = z => { if (!CALM) $('stage').dataset.zoom = z; };
  const G_ = window.Glove || null;
  const wheelInfo = () => { const r = $('wheel').getBoundingClientRect(); if (!r.width) return null; const s = r.width / W; return { x: r.left + CX * s, y: r.top + CY * s, r: R * s, a: angle }; };
  const wheelNudge = da => { if (spinLive || !face) return; angle += da; draw(); };
  function spinTo(sp) {
    cancelAnimationFrame(spinRaf); clearTimeout(spinWait); hitSeg = -1; if (spinSnd) { spinSnd.stop(200); spinSnd = null; }
    const plan = G_ ? G_.spin(sp, Math.max(0, sp.dur - (now() - sp.at))) : null;
    spinWait = setTimeout(() => spinRun(sp, plan), plan ? plan.delay : 0);
  }
  function spinRun(sp, plan) {
    const from = angle, target = -(sp.idx + (Math.random() - .5) * .7) * TAU / N;
    const remain = Math.max(300, sp.dur - (now() - sp.at)), shape = plan ? plan.shape(remain) : { turns: null, e: 3.4, pa: 0 };
    const turns = CALM ? 1 : shape.turns || sp.turns, curve = G_ ? G_.spinCurve(shape) : p => 1 - Math.pow(1 - p, 3.4);
    const dist = ((target - from) % TAU + TAU) % TAU + turns * TAU;
    const t0 = performance.now(); let seg = null, close = false, lastTick = 0;
    spinLive = true; zoom(1); if (G_) G_.spinGo({ remain });
    // Whirr: harder spins play a touch higher, it fades out over the slow down. One flapper material per spin, others mixed in.
    const force = Math.min(1, turns * TAU / Math.max(1, remain / 1000) / 30);
    spinSnd = Sfx.play('wheel-spin-mechanical', { rate: .94 + force * .14, vol: .8 + force * .3, dur: remain * .92, fadeOut: remain * .55 });
    tickMat = Math.floor(Math.random() * 3);
    const stepF = () => {
      const p = Math.min(1, (performance.now() - t0) / remain); angle = from + dist * curve(p);
      const s = Math.floor(angle / (TAU / N) + .5); flap *= .8; if (seg !== null && s !== seg) { flap = .26; const tn = performance.now(), gapT = tn - lastTick; lastTick = tn; Sfx.play('flapper-tick', { file: 'flapper-tick-' + (1 + (Math.random() < .7 ? tickMat : Math.floor(Math.random() * 3))), vol: .55 + Math.min(.6, gapT / 250), rate: 1.08 - Math.min(.14, gapT / 1500) }); } seg = s; blink = Math.floor(p * 40);
      if (!close && remain - (performance.now() - t0) <= Math.max(1300, remain * .45)) { close = true; zoom(2); }
      if (p >= 1) { flap = 0; angle %= TAU; hitSeg = sp.idx; spinLive = false; if (spinSnd) { spinSnd.stop(260); spinSnd = null; } Sfx.play('wheel-land-settle'); settledAt = performance.now(); draw(); return; }
      draw(); spinRaf = requestAnimationFrame(stepF);
    };
    spinRaf = requestAnimationFrame(stepF);
  }

  // ---- Table ----
  const GROUPS = { num: KEYS.filter(k => TYPES[k].pay), bonus: BONUS_KEYS };
  let settledAt = 0, landAt = 0, chip = 5, myTot = 0, pendingRepeat = false, lastPhase = null, lastRound = -1, lastWinShown = null, players0 = {}, gloveKey = '';
  function setupTable() {
    cx = $('wheel').getContext('2d');
    // Desk: raffle tickets, numbers left and bonuses right, each 2x2 group with a chip stack badge in the middle
    const ticket = k => {
      const t = TYPES[k], s = SKIN[k], i = KEYS.indexOf(k);
      if (t.pay) return `<button class="house num" id="h-${k}" style="--tk:${s.tk};--pl:${s.pl};--i:${i}" aria-label="Bet on ${t.n}, pays ${t.pay} to 1"><span class="tk"><span class="stub"></span><span class="face"><span class="plq"><span class="n">${t.n}</span></span><span class="p">Pays ${t.pay}x</span></span></span><span class="dots"></span><span class="stake"></span></button>`;
      const name = esc(t.n).replace('Productivitime', 'Producti&shy;vitime'), long = s => Math.max(...s.split(' ').map(w => w.length));
      return `<button class="house bonus" id="h-${k}" style="--tk:${s.tk};--i:${i};--fs:${Math.min(32, 180 / long(t.n)).toFixed(1)};--fsm:${Math.min(32, 200 / long(name.replace('&shy;', ' '))).toFixed(1)}" aria-label="Bet on bonus game ${t.n}"><span class="tk"><span class="stub">${medal(k)}</span><span class="face"><span class="ttl"><span class="n">${name}</span></span><span class="p">Bonus<i> game</i></span></span></span><span class="dots"></span><span class="stake"></span></button>`;
    };
    // The badge between each group of 4 tickets bets the selected chip on all 4 at once. Repeated clicks stack.
    const badge = (g, l) => `<button class="medal" id="g-${g}" aria-label="Bet the selected chip on all 4 ${l}" title="Bet on all 4">${STACK_BADGE}</button>`;
    $('street').innerHTML = `<div class="tgrp">${GROUPS.num.map(ticket).join('')}${badge('num', 'number fields')}</div><div class="tgrp">${GROUPS.bonus.map(ticket).join('')}${badge('bonus', 'bonus fields')}</div>`;
    Object.keys(GROUPS).forEach(g => $('g-' + g).onclick = () => placeGroup(g));
    KEYS.forEach(k => { $('h-' + k).onclick = () => placeBet(k); $('h-' + k).oncontextmenu = e => { e.preventDefault(); send({ t: 'unbet', key: k }); }; });
    $('quay').innerHTML = '<div class="info">' + [['bal', 'Balance'], ['bet', 'Total bet'], ['win', 'Win']].map(([i, t]) => `<div><small>${t}</small><b>${ORRA}<span id="${i}">0</span></b></div>`).join('') + '</div><div class="chips">' + COINS.map(c => `<button class="coin" data-v="${c[0]}" aria-label="Chip ${c[0]} Orra">${chipSvg(c)}</button>`).join('') + '</div><div class="acts"><button class="btn" id="clear">Clear</button><button class="btn" id="again">Repeat</button><button class="btn go" id="go">Ready</button></div>';
    document.querySelectorAll('.coin').forEach(b => b.onclick = () => { chip = +b.dataset.v; renderChips(); });
    $('clear').onclick = () => send({ t: 'clear' });
    $('again').onclick = () => { pendingRepeat = true; send({ t: 'repeat' }); };
    Sfx.preload();
    $('go').onclick = () => { send({ t: 'ready' }); tone(660, .15); if (G_) G_.emit('ready'); };
    $('help').onclick = () => { rulesDialog(); $('rules').showModal(); };
    $('shop').onclick = () => { shop(); $('work').showModal(); };
    // Speaker icon: two waves (full), one wave (45%), a cross (mute). Click cycles full > 45% > mute > full.
    const SPK = '<path d="M3.5 9.2h3.6L12 5v14l-4.9-4.2H3.5z" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>';
    const WAVE = (d, o = 1) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="${o}"/>`;
    const SND_ICON = {
      on: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPK}${WAVE('M15.2 9.1a4.2 4.2 0 0 1 0 5.8')}${WAVE('M17.8 6.6a7.8 7.8 0 0 1 0 10.8')}</svg>`,
      low: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPK}${WAVE('M15.2 9.1a4.2 4.2 0 0 1 0 5.8')}${WAVE('M17.8 6.6a7.8 7.8 0 0 1 0 10.8', .22)}</svg>`,
      off: `<svg viewBox="0 0 24 24" aria-hidden="true">${SPK}${WAVE('M15.6 9.4l5.2 5.2M20.8 9.4l-5.2 5.2')}</svg>`
    };
    const SND_TXT = { on: ['Sound 100%', 'Sound on, click for 45% volume'], low: ['Sound 45%', 'Sound at 45%, click to mute'], off: ['Muted', 'Sound off, click for full volume'] };
    const sndLabel = () => { const b = $('snd'); b.innerHTML = SND_ICON[sndMode]; b.setAttribute('aria-pressed', sndMode !== 'off'); b.setAttribute('aria-label', SND_TXT[sndMode][1]); b.title = SND_TXT[sndMode][0]; b.classList.toggle('muted', sndMode === 'off'); b.classList.toggle('low', sndMode === 'low'); };
    sndLabel(); $('snd').onclick = () => { sndMode = SND_NEXT[sndMode]; applySnd(); store.set('rh-sound', sndMode); sndLabel(); if (sndMode !== 'off') sfx('token_place', .5); toast(SND_TXT[sndMode][0], 1200); };
    ['rules', 'work'].forEach(id => $(id).onclick = e => { if (e.target === $(id)) $(id).close(); });
    $('invite').onclick = () => {
      const link = location.origin + location.pathname + '?join=' + S.code;
      (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Invite link copied.', 3200, 'ok'), () => prompt('Copy this invite link', link));
    };
    if (!CALM) setInterval(() => { blink++; if (!S || S.phase !== 'spinning') draw(); }, 600);
    requestAnimationFrame(clockLoop);
  }
  // Chips are the betting tokens. Check locally first so an impossible bet gets instant feedback.
  function canBet(n, el) {
    const me = S.me, avail = me.bal - myTot, need = chip * n;
    const deny = t => { sfx('no_tokens_left'); if (G_) G_.emit('refused'); toast(t, 2600, 'bad'); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); return false; };
    if (S.battle && !players[S.you].alive) return deny('You are out of this battle.');
    if (avail < 5) return deny(S.me.cashier.closed ? 'No Orra left in this run.' : 'No Orra left. Collect more at the Cashier.');
    if (need > avail) return deny(n > 1 ? `All 4 needs ${fmt(need)} Orra. You have ${fmt(avail)}.` : `Only ${fmt(avail)} Orra left. Use a smaller chip.`);
    if (myTot + need > me.limit) return deny(`Level ${me.lvl} limit: ${fmt(me.limit)} Orra per round.`);
    return true;
  }
  function placeBet(k) {
    if (!S || !canBet(1, $('h-' + k))) return;
    send({ t: 'bet', key: k, amt: chip }); sfx('token_place'); if (G_) G_.emit('bet', { el: $('h-' + k) });
  }
  function placeGroup(g) {
    if (!S || !canBet(4, $('g-' + g))) return;
    send({ t: 'bets', keys: GROUPS[g], amt: chip }); sfx('token_place'); if (G_) G_.emit('bet', { el: $('g-' + g) });
  }
  function renderChips() { document.querySelectorAll('.coin').forEach(b => { b.classList.toggle('on', +b.dataset.v === chip); b.setAttribute('aria-pressed', +b.dataset.v === chip); }); }
  function clockLoop() {
    if (S) {
      const el = $('clock').firstChild;
      const left = S.phase === 'betting' && S.ends ? S.ends - now() : 0;
      el.style.width = Math.max(0, Math.min(100, left / (S.cfg ? S.cfg.bet * 10 : 80))) + '%'; $('clock').classList.toggle('low', left > 0 && left < 3000);
      // betting countdown: last 5 s (3 s on short rounds), softer once you pressed Ready
      if (left > 0) betTick('r' + S.round, left, S.cfg && S.cfg.bet < 10 ? 3 : 5, players[S.you] && players[S.you].ready ? .6 : 1);
    }
    Bonus.tick();
    requestAnimationFrame(clockLoop);
  }
  function shop() {
    const c = S.me.cashier, me = S.me, pct = (a, b) => Math.max(0, Math.min(100, a / b * 100)).toFixed(1) + '%', nolim = me.limit >= 1e9;
    if (c.closed) {
      $('workbody').innerHTML = `<div class="cards"><section class="dcard"><h3>Run balance</h3><p class="stat">${ORRA}${fmt(me.bal - myTot)}</p><p class="note">Everyone started on ${fmt(S.cfg.start)} Orra. Wages and daily bonus only work in Own wallet lobbies.</p></section>
 <section class="dcard"><h3>Own wallet</h3><p class="stat">${ORRA}${fmt(me.wallet)}<small>saved ${fmt(me.vault.run)} of ${fmt(me.vault.cap)} this run</small></p><div class="meter"><i style="width:${pct(me.vault.run, me.vault.cap)}"></i></div><p class="note">Part of each win is saved here. Higher multiplier, bigger share. Huge wins count less, and the share drops as the cap fills. Today: ${fmt(me.vault.today)} of ${fmt(me.vault.day)}. Spend it in an Own wallet lobby.</p></section>
 <section class="dcard"><h3>Level ${me.lvl}</h3><p class="stat">${nolim ? 'No limit' : fmt(me.limit)}<small>max bet per round</small></p><div class="meter"><i style="width:${pct(me.xp, me.need)}"></i></div><p class="note">${fmt(me.need - me.xp)} XP to level ${me.lvl + 1}.</p></section></div>`;
      return;
    }
    $('workbody').innerHTML = `<div class="cards">
 <section class="dcard"><h3>Wages, level ${c.work}</h3><p class="stat">${ORRA}${fmt(c.pending)}<small>of ${fmt(c.cap)}</small></p><div class="meter"><i style="width:${pct(c.pending, c.cap)}"></i></div>
  <p class="note">You earn ${c.rate} Orra per minute, up to ${fmt(c.cap)}.</p>
  <button class="btn go" id="w1" ${c.pending < 1 ? 'disabled' : ''}>${c.pending < 1 ? 'Nothing to collect yet' : 'Collect ' + fmt(c.pending)}</button>
  <button class="btn" id="w2" ${c.work >= 10 || me.bal < c.upCost ? 'disabled' : ''}>${c.work >= 10 ? 'Maximum level' : 'Upgrade to level ' + (c.work + 1) + ' for ' + fmt(c.upCost)}</button></section>
 <section class="dcard"><h3>Daily bonus</h3><p class="stat">${ORRA}${fmt(c.gift)}</p><p class="note">${c.today ? `Collected. Streak day ${c.day}. Next one tomorrow.` : `Streak day ${c.day}. +25 per day in a row, up to day 7.`}</p>
  <button class="btn go" id="w3" ${c.today ? 'disabled' : ''}>${c.today ? 'Collected today' : 'Collect ' + fmt(c.gift)}</button></section>
 <section class="dcard"><h3>Level ${me.lvl}</h3><p class="stat">${nolim ? 'No limit' : fmt(me.limit)}<small>max bet per round</small></p><div class="meter"><i style="width:${pct(me.xp, me.need)}"></i></div>
  <p class="note">${fmt(me.need - me.xp)} XP to level ${me.lvl + 1}. Every 5 Orra you bet gives 1 XP.</p></section>
 <section class="dcard"><h3>Inventory</h3><div class="inv"><div><b>${me.items.shield || 0}</b><small>Shield</small></div><div><b>${me.items.swap || 0}</b><small>Swap token</small></div></div>
  <p class="note">Shield: blocks the next attack on you. Swap token: forces a rival to switch sides.</p></section></div>`;
    $('w1').onclick = () => { send({ t: 'cashier', op: 'collect' }); sfx('token_place'); Sfx.play('coin-stream', { vol: .6, dur: 900, fadeOut: 450, delay: 60 }); };
    $('w2').onclick = () => send({ t: 'cashier', op: 'upgrade' });
    $('w3').onclick = () => { send({ t: 'cashier', op: 'daily' }); sfx('token_place'); Sfx.play('coin-stream', { delay: 80 }); Sfx.play('game-show', { vol: .7, delay: 120 }); };
  }
  function rulesDialog() {
    let h = `<div class="rgrid"><div class="rcol"><section class="rsec"><h3>The table</h3><ul class="brules">
<li><b>Bet:</b> pick a chip, click a field. Click again to add more. Right-click removes your bet.</li>
<li><b>Group:</b> the chip stack between each group of 4 bets your chip on all 4.</li>
<li><b>Time:</b> ${S && S.cfg ? S.cfg.bet : 8} seconds per round. The wheel spins early once everyone presses Ready.</li>
<li><b>Limit:</b> your level sets the max bet per round.</li>
<li><b>Prime Minute:</b> 1 field per round pays x2, x3 or x5.</li>
<li><b>Crowd:</b> fields backed by more players, or with more Orra on them, land slightly less often (up to ${Math.round(RHS.CROWD_MAX * 100)}% less).</li></ul>
<div class="pays">${KEYS.map(k => { const t = TYPES[k]; return `<div style="--c:${SKIN[k].f}">${t.n}<small>${t.pay ? 'pays ' + t.pay + ' : 1' : 'Bonus game'}</small></div>`; }).join('')}</div></section>
<section class="rsec"><h3>Bonus games</h3><ul class="brules">
<li><b>Backers</b> (bet on the field) always play: full multiplier, Prime Minute boost, first turn, and an Edge Shield against late joiners.</li>
<li><b>Late buy-in:</b> everyone else can join for 25% to 50% of the top backer's stake. Late joiners get 60% of their multiplier.</li>
<li><b>Payout:</b> your final multiplier times your stake, plus your stake back.</li>
<li><b>Items:</b> Shields and Swap tokens carry over between games.</li></ul></section></div><div class="rcol"><p class="note">Each bonus field plays 1 of its 4 games, picked at random.</p>`;
    for (const k of BONUS_KEYS) h += `<section class="rsec" style="--accent:${ACCENT[k]}"><h3><span class="cat">${CAT_NAMES[k]}</span></h3><div class="gl">${(catalog[k] || []).map(g => `<details><summary>${esc(g.name)}</summary><ul class="brules">${g.rules.map(ruleLi).join('')}</ul></details>`).join('')}</div></section>`;
    h += '</div></div><p class="note">Orra is play money with no real value.</p>';
    if (S && S.battle) h = Battle.rules(S) + h;
    $('rulebody').innerHTML = h;
  }
  // 'Label: text' renders the label in bold so rules scan fast.
  function ruleLi(r) { const m = /^([^:]{1,18}): (.*)$/.exec(r); return m ? `<li><b>${esc(m[1])}:</b> ${esc(m[2])}</li>` : `<li>${esc(r)}</li>`; }
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
      if (G_) G_.init({ wheel: wheelInfo, nudge: wheelNudge });
    }
    if (G_) {
      G_.room({ phase: m.phase, round: m.round, left: m.phase === 'betting' && m.ends ? m.ends - now() : 0, allReady: m.phase === 'betting' && m.players.every(p => !p.online || p.ready) });
      if (!first) { const was = Object.keys(players0), ids = m.players.filter(p => p.online).map(p => p.id); if (ids.some(i => !was.includes(i))) G_.emit('join'); else if (was.some(i => !ids.includes(i))) G_.emit('leave'); }
      players0 = {}; m.players.forEach(p => { if (p.online) players0[p.id] = 1; });
    }
    const me = players[m.you], betting = m.phase === 'betting', out = !!m.battle && !me.alive, ready = me.ready || out;
    $('room').textContent = m.code; $('lvl').innerHTML = `<b>Level ${m.me.lvl}<small>${fmt(m.me.xp)} / ${fmt(m.me.need)} XP</small></b><span class="meter"><i style="width:${Math.min(100, m.me.xp / m.me.need * 100)}%"></i></span>`;
    if ($('work').open) shop();
    // players strip
    // In a battle the strip also shows who is out, who leads and how close everyone is to the target.
    const B = m.battle, live = B && m.phase !== 'wait', lead = live ? m.players.filter(p => p.alive).sort((a, b) => b.bal - a.bal)[0] : null;
    $('people').innerHTML = m.players.filter(p => !live || p.alive || p.place || p.online).map(p => {
      const tot = Object.values(p.bets).reduce((a, b) => a + b, 0), dead = live && !p.alive;
      const prog = live && p.alive ? `<span class="prog" title="${fmt(p.bal)} of ${fmt(B.target)}"><i style="width:${Math.min(100, p.bal / B.target * 100).toFixed(1)}%"></i></span>` : '';
      return `<span class="pl ${p.online ? '' : 'off'} ${p.ready && betting ? 'ready' : ''} ${p.id === m.you ? 'me' : ''} ${dead ? 'out' : ''}" style="--c:${p.color}"><i></i><b>${esc(p.name)}</b>${dead ? `<span class="tag bad">${p.place ? 'Out #' + p.place : 'Watching'}</span>` : `<small>${ORRA}${fmt(p.bal - (betting ? tot : 0))}</small>`}${lead && lead.id === p.id && m.players.filter(q => q.alive).length > 1 ? '<span class="tag lead">Lead</span>' : ''}${live && B.underdog === p.id && p.alive ? '<span class="tag" title="Lowest stack: skips the ante this round">Underdog</span>' : ''}${p.ko ? `<span class="tag" title="Knockouts">KO ${p.ko}</span>` : ''}${tot && !dead ? `<span class="tag">bet ${fmt(tot)}</span>` : ''}${p.ready && betting && !dead ? '<span class="tag ok">READY</span>' : ''}${p.shield ? `<span class="tag" title="Shields">S${p.shield}</span>` : ''}${p.swap ? `<span class="tag" title="Swap tokens">W${p.swap}</span>` : ''}${prog}</span>`;
    }).join('');
    // fields
    const mine = me.bets || {}, tot = Object.values(mine).reduce((a, b) => a + b, 0);
    if (pendingRepeat && betting && tot > 0) { pendingRepeat = false; sfx('token_place'); }
    myTot = betting ? tot : 0;
    document.body.classList.toggle('spinning', m.phase === 'spinning');
    Object.keys(GROUPS).forEach(g => $('g-' + g).disabled = !betting || ready);
    KEYS.forEach(k => {
      const h = $('h-' + k); h.disabled = !betting || ready;
      h.classList.toggle('lit', !!mine[k]);
      h.querySelector('.stake').innerHTML = mine[k] ? stackHtml(mine[k]) + `<b>${ORRA}${fmt(mine[k])}</b>` : '';
      // Other players' bets: their colour token, first 2 letters of their name and the amount, sized down as more players join in.
      const others = m.players.filter(p => p.id !== m.you && p.bets[k]), dots = h.querySelector('.dots');
      dots.style.setProperty('--n', others.length);
      dots.innerHTML = others.map(p => `<i style="--c:${p.color}" title="${esc(p.name)}: ${fmt(p.bets[k])} Orra"><span class="tkn"></span><b>${esc(initials(p.name))}</b><small>${short(p.bets[k])}</small></i>`).join('');
      const b = h.querySelector('.boost'); if (b) b.remove();
      if (m.boost && m.boost.k === k) h.insertAdjacentHTML('beforeend', `<span class="boost">x${m.boost.m}</span>`);
      h.classList.toggle('hit', m.phase !== 'betting' && m.phase !== 'spinning' && m.landed === k);
    });
    $('bal').textContent = fmt(m.me.bal - (betting ? tot : 0)); $('bet').textContent = fmt(tot);
    // Wallet chip: own wallet lobbies play straight from it (open bets already held back), fixed runs leave it untouched.
    const wal = m.me.wallet - (m.cfg.start ? 0 : betting ? tot : 0), wEl = $('wal'), wOld = +wEl.dataset.v;
    if (wOld !== wal) { wEl.textContent = fmt(wal); wEl.dataset.v = wal; const ch = $('walchip'); if (!isNaN(wOld) && wal > wOld) { ch.classList.remove('up'); void ch.offsetWidth; ch.classList.add('up'); } }
    $('walchip').title = m.cfg.start ? 'Your own wallet. This run uses its own balance, part of each win is saved here.' : 'Your own wallet. This lobby plays from it.';
    $('clear').disabled = !betting || ready || !tot; $('again').disabled = !betting || ready || !m.me.hasLast;
    $('go').disabled = !betting || ready; $('go').textContent = out ? 'Out' : betting ? (ready ? 'Waiting' : tot ? 'Ready' : 'Sit out') : m.phase === 'spinning' ? 'Spinning' : 'Wait';
    document.querySelectorAll('.coin').forEach(b => { b.disabled = !betting || ready; b.classList.toggle('short', betting && +b.dataset.v > m.me.bal - tot); });
    // spin
    if (m.phase === 'spinning' && m.spin && spinKey !== m.spin.at) { spinKey = m.spin.at; spinTo(m.spin); }
    if (m.phase === 'betting' || m.phase === 'intro' || m.phase === 'bonus') zoom(0);
    if (m.phase === 'betting' && lastPhase !== 'betting') { hitSeg = -1; draw(); document.body.classList.remove('won'); $('win').textContent = '0'; $('win').parentNode.classList.remove('up'); }
    // history
    $('hist').innerHTML = m.hist.slice(0, 10).map(k => { const t = TYPES[k]; return `<span class="${t.pay ? '' : 'bh'}" style="background:${SKIN[k].f};color:${t.pay ? SKIN[k].pl : '#FFE38A'}" title="${t.n}">${t.pay ? t.n : t.n.split(' ').map(w => w[0]).join('')}</span>`; }).join('');
    // wheel at rest: landing sting first, so the result sounds below can wait on it
    if (lastPhase === 'spinning' && m.phase !== 'spinning') { landAt = performance.now(); Sfx.play('wheel-land', { delay: Math.max(0, 140 - (landAt - settledAt)) }); }
    // messages and payouts
    let msg = m.msg;
    if (m.phase === 'payout' && m.results) {
      const row = m.results.rows.find(r => r.id === m.you), key = m.results.key, t = TYPES[key];
      if (row && row.stake) msg = `${t.n} pays ${fx2(row.m)}x. You collect ${fmt(row.win)} Orra.`;
      else if (row) msg = `${t.n}. No bet on this field.`;
      if (row && row.lvl) msg += ` Level up! +${row.lvl} Orra.`;
      if (row && row.vault) msg += ` +${fmt(row.vault)} saved to your wallet.`;
      const br = m.results.battle;
      if (br && br.taker) msg += br.taker === m.you ? ` You take the Pot: ${fmt(br.pot)}.` : ` ${players[br.taker] ? players[br.taker].name : 'Someone'} takes the Pot.`;
      if (br && br.ko.length) msg += ` Out: ${br.ko.join(', ')}.`;
      $('win').textContent = fmt(row ? row.win : 0); $('win').parentNode.classList.toggle('up', !!(row && row.win > 0));
      const key2 = m.round + ':' + key;
      if (row && lastWinShown !== key2) {
        lastWinShown = key2;
        const bonus = BONUS_KEYS.includes(key), won = bonus ? row.stake > 0 && row.m >= 1 : row.win > 0, lost = !won && (bonus ? row.stake > 0 : row.spent > 0);
        // let the landing sting breathe before the result
        const wait = Math.max(0, 420 - (performance.now() - landAt));
        if (won) {
          document.body.classList.add('won');
          const big = Math.min(1, row.win / Math.max(1, (bonus ? row.stake : row.spent) * 6));
          Sfx.play('win', { delay: wait });
          Sfx.play('coin-stream', { delay: wait + 250 + Math.random() * 200, vol: .7 + big * .5, dur: 900 + big * 1300, fadeOut: 500 });
        } else if (lost) Sfx.play('loss', { delay: wait });
      }
      if (BONUS_KEYS.includes(key)) Bonus.results(m);
      if (G_ && gloveKey !== key2) {
        gloveKey = key2;
        G_.emit(BONUS_KEYS.includes(key) ? 'bonusResult' : 'payout', BONUS_KEYS.includes(key) ? { stake: row ? row.stake : 0, win: row ? row.win : 0, m: row ? row.m : 0 } : { stake: row ? row.spent : 0, win: row ? row.win : 0 });
        if (row && row.lvl) G_.emit('levelUp');
      }
    }
    if (G_ && m.phase === 'intro' && lastPhase !== 'intro') G_.emit('landedBonus');
    if (G_ && m.phase === 'landed' && lastPhase === 'spinning' && m.results && !m.results.rows.length) G_.emit('payout', { stake: 0, win: 0 });
    if (m.phase === 'spinning' && lastPhase === 'betting') Sfx.play('bets-closed');
    if (m.phase === 'betting' && lastRound !== m.round) { lastRound = m.round; tone(660, .4); }
    if (out && m.phase !== 'over') msg = me.place ? `You are out in place ${me.place}. ${m.phase === 'payout' ? msg : 'Watching the rest.'}` : 'Battle in progress. You join the next one.';
    say(msg);
    Battle.ui(m);
    if (m.phase === 'intro' && m.next) Bonus.intro(m);
    if (m.phase === 'betting') Bonus.close();
    lastPhase = m.phase;
  }

  // ---- Battle mode: waiting room, status bar, end screen ----
  const Battle = (() => {
    let key = '';
    const box = () => $('abox');
    const P = id => players[id] || { name: '?', color: '#888' };
    const host = m => P(m.host).name;
    function rules(m) {
      const B = m.battle, c = m.cfg;
      return `<section class="rsec battle-rules"><h3>Battle</h3><ul class="brules">
<li><b>Goal:</b> everyone starts with ${fmt(c.start)}. First to ${fmt(B.target)} wins, or be the last one standing.</li>
<li><b>Storm:</b> every round each player still in pays the ante into the Pot. It starts at ${fmt(Math.max(5, Math.round(c.start * .01 / 5) * 5))} and climbs every ${B.every} rounds.</li>
<li><b>Pot:</b> the biggest net winner of the round takes the whole Pot. Nobody up, it carries over.</li>
<li><b>Underdog:</b> with 3 or more players left, the lowest stack skips the ante.</li>
<li><b>Knockout:</b> under 5 Orra after a round or an ante and you are out. The Pot taker of that round gets the KO.</li>
<li><b>Prize:</b> saved to your wallet. Winner 100 per opponent, the rest 20 per player they outlasted. Level up rewards also go to the wallet.</li></ul></section>`;
    }
    const RULES = [['Storm', 'Ante every round, it climbs every few rounds'], ['Pot', 'Biggest net winner of the round takes it'], ['Underdog', 'Lowest stack skips the ante (3+ left)'], ['Knockout', 'Under 5 Orra and you are out']];
    function wait(m) {
      const on = m.players.filter(p => p.online), isHost = m.host === m.you, B = m.battle;
      return `<div class="acard"><span class="cat">Battle lobby ${esc(m.code)}</span><h2>Waiting room</h2>
        <p class="lead">${short(m.cfg.start)} each. First to <b>${short(B.target)}</b> wins, or be the last one standing.</p>
        <div class="arules">${RULES.map(([t, d]) => `<div><b>${t}</b><small>${d}</small></div>`).join('')}</div>
        <div class="aplayers"><small>${on.length} of ${m.cfg.max} players</small><div>${on.map(p => `<span class="bp ${p.id === m.you ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}${p.id === m.host ? '<span class="tag">Host</span>' : ''}</span>`).join('')}</div></div>
        <div class="aacts"><button class="btn" data-a="invite">Copy invite</button>${isHost ? `<button class="btn go" data-a="start" ${on.length < 2 ? 'disabled' : ''}>${on.length < 2 ? 'Need 2 players' : 'Start battle'}</button>` : `<p class="note">Waiting for ${esc(host(m))} to start.</p>`}</div></div>`;
    }
    function over(m) {
      const B = m.battle, st = B.standings || [], mine = st.find(r => r.id === m.you), w = P(B.winner), isHost = m.host === m.you;
      const th = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
      return `<div class="acard"><span class="cat">Battle over after ${B.n} rounds</span><h2>${B.winner === m.you ? 'You win' : esc(w.name) + ' wins'}</h2>
        ${mine ? `<p class="lead">You finished ${th(mine.place)}${mine.prize ? ` and saved ${orra(mine.prize)} to your wallet` : ''}.</p>` : '<p class="lead">You watched this one.</p>'}
        <table class="res"><tr><th>#</th><th>Player</th><th class="n">Stack</th><th class="n">KO</th><th class="n">Prize</th></tr>${st.map(r => `<tr class="${r.id === m.you ? 'me' : ''}"><td>${r.place}</td><td><span class="pdot" style="--c:${P(r.id).color}"></span>${esc(P(r.id).name)}</td><td class="n">${fmt(r.run)}</td><td class="n">${r.ko}</td><td class="n">${r.prize ? orra(r.prize) : '0'}</td></tr>`).join('')}</table>
        <div class="aacts"><button class="btn" data-a="leave">Leave</button>${isHost ? `<button class="btn go" data-a="start" ${m.players.filter(p => p.online).length < 2 ? 'disabled' : ''}>Rematch</button>` : `<p class="note">Waiting for ${esc(host(m))} to start a rematch.</p>`}</div></div>`;
    }
    function bar(m) {
      const B = m.battle, toNext = B.every - ((B.n - 1) % B.every), maxed = B.storm >= B.maxStorm - 1;
      return `<div><small>Round</small><b>${B.n}</b></div>
        <div><small>Win at</small><b>${orra(B.target)}</b></div>
        <div class="storm"><small>Storm ${B.storm + 1}</small><b>Ante ${fmt(B.ante)}</b><em>${maxed ? 'Max level' : `${fmt(B.nextAnte)} ${toNext === 1 ? 'next round' : 'in ' + toNext + ' rounds'}`}</em></div>
        <div class="pot"><small>Pot</small><b>${orra(B.pot)}</b></div>
        <div><small>Left</small><b>${B.alive} / ${m.players.filter(p => p.alive || p.place).length}</b></div>
        ${B.log[0] ? `<p class="blast">${esc(B.log[0])}</p>` : ''}`;
    }
    function ui(m) {
      document.body.classList.toggle('battle', !!m.battle);
      const B = m.battle, show = B && (m.phase === 'wait' || m.phase === 'over');
      $('bbar').hidden = !B || m.phase === 'wait' || m.phase === 'over';
      if (B && !$('bbar').hidden) $('bbar').innerHTML = bar(m);
      document.body.classList.toggle('out', !!B && !players[m.you].alive && m.phase !== 'wait' && m.phase !== 'over');
      $('arena').classList.toggle('on', !!show);
      if (!show) { key = ''; return; }
      const html = m.phase === 'wait' ? wait(m) : over(m);
      if (html === key) return;
      const first = !key; key = html; box().innerHTML = html;
      if (first && m.phase === 'over') Sfx.play(B.winner === m.you ? 'win' : 'game-show');
      box().querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'start') { send({ t: 'start' }); tone(660, .2); }
        if (a === 'invite') $('invite').click();
        if (a === 'leave') { try { sessionStorage.removeItem('rh-room'); } catch {} location.href = location.pathname; }
      });
    }
    return { ui, rules };
  })();

  // ---- Bonus overlay host ----
  const G = {};
  const Bonus = (() => {
    let cur = null, inst = null, last = null, logKey = '', span = { ends: 0, tot: 1 };
    const box = () => $('box');
    const rulesList = rules => `<ul class="brules">${rules.map(ruleLi).join('')}</ul>`;
    const accent = cat => box().style.setProperty('--accent', ACCENT[cat] || 'var(--gold)');
    // Intro is the briefing: no clock. Everyone who plays (or may still buy in) reads the rules and presses Ready.
    // The host can start early. Built once per round, then patched so the slider and scroll position stay put.
    let introKey = '', introGo = false;
    function intro(m) {
      const n = m.next, k = m.round + ':' + n.id, backer = n.backers.includes(m.you), late = n.late.includes(m.you);
      const isHost = m.host === m.you, waiting = n.wait.includes(m.you), ready = n.ready.includes(m.you);
      accent(n.cat);
      if (introKey !== k) {
        introKey = k; cur = null; last = null; introGo = false;
        box().innerHTML = `<div class="intro"><span class="cat">${CAT_NAMES[n.cat]}</span><h2>${esc(n.name)}</h2>
          <span class="badge"></span>${rulesList(n.rules)}<div class="buyin" hidden></div>
          <div class="bplayers"></div><p class="bwait" role="status" aria-live="polite"></p>
          <div class="iacts"><button class="btn go" id="bready">Ready</button><button class="btn" id="bskip" title="Host: start without waiting">Start now</button></div><div class="bt go" hidden><i></i></div></div>`;
        $('bonus').classList.add('on'); Sfx.play('game-show', { delay: Math.max(0, 500 - (performance.now() - landAt)) });
        $('bready').onclick = () => { send({ t: 'bready' }); tone(660, .12); if (G_) G_.emit('briefReady'); };
        $('bskip').onclick = () => { send({ t: 'bskip' }); tone(520, .12); };
        if (n.cap) {
          const bx = box().querySelector('.buyin'), start = Math.min(n.cap, Math.max(5, Math.round(n.cap / 2 / 5) * 5));
          bx.hidden = false;
          bx.innerHTML = `<p class="bihead">Buy in, max <b>${orra(n.cap)}</b> <small>(${Math.round(n.share * 100)}% of top stake ${orra(n.top)})</small></p>
            <div class="birow"><input type="range" id="biamt" min="5" max="${n.cap}" step="5" value="${start}" aria-label="Buy-in amount"><b id="bival">${orra(start)}</b></div>
            <div class="birow"><button class="btn go" id="bigo">Buy in and ready</button><button class="btn" id="bipass">Watch</button></div>
            <p class="note">Late: ${Math.round(n.latePay * 100)}% of your multiplier, no Prime Minute, you go after backers, their Edge Shields block your first attack.</p>`;
          const r = $('biamt');
          r.oninput = () => { $('bival').innerHTML = orra(+r.value); tone(520 + +r.value / n.cap * 300, .03, .02); };
          $('bigo').onclick = () => { send({ t: 'buyin', amt: +r.value }); sfx('token_place'); if (G_) G_.emit('briefReady'); };
          $('bipass').onclick = () => send({ t: 'buyin', pass: true });
        }
        const f = box().querySelector(n.cap ? '#bigo' : '#bready'); if (f && (backer || n.cap)) setTimeout(() => f.focus({ preventScroll: true }), 50);
      }
      const bx = box().querySelector('.buyin');
      if (bx && !n.cap) bx.hidden = true;
      const badge = box().querySelector('.badge');
      badge.className = 'badge ' + (backer ? 'in' : late ? 'in late' : 'watch');
      badge.textContent = backer ? 'Backer: full edge' : late ? 'Bought in late' : n.cap ? 'Not backed: buy in or watch' : 'Spectating';
      // Who plays and who the game waits for
      const inGame = id => n.backers.includes(id) || n.late.includes(id);
      const rows = m.players.filter(p => inGame(p.id) || n.wait.includes(p.id))
        .sort((a, b) => inGame(b.id) - inGame(a.id) || n.late.includes(a.id) - n.late.includes(b.id) || (b.bets[n.cat] || 0) - (a.bets[n.cat] || 0));
      box().querySelector('.bplayers').innerHTML = rows.map(p => {
        const st = n.ready.includes(p.id) ? '<span class="tag ok">Ready</span>' : !p.online ? '<span class="tag">Away</span>' : inGame(p.id) ? '<span class="tag rd">Reading</span>' : '<span class="tag rd">Deciding</span>';
        return `<span class="bp ${p.id === m.you ? 'me' : ''}" style="--c:${p.color}"><i></i>${esc(p.name)}${inGame(p.id) ? `<small>${ORRA}${fmt(p.bets[n.cat])}</small><span class="tag ${n.late.includes(p.id) ? '' : 'ok'}">${n.late.includes(p.id) ? 'Late' : 'Backer'}</span>` : ''}${st}</span>`;
      }).join('');
      const names = n.wait.map(id => players[id] ? players[id].name : '?');
      box().querySelector('.bwait').textContent = n.go ? 'Everyone is ready. Starting...'
        : waiting && n.cap ? 'Take your time. Buy in or watch when you have read the rules.'
        : waiting ? 'Take your time. Press Ready when you have read the rules.'
        : names.length ? `Waiting for ${names.length > 3 ? names.slice(0, 3).join(', ') + ' and ' + (names.length - 3) + ' more' : names.join(', ')}` : '';
      const rb = $('bready'), sk = $('bskip');
      rb.hidden = n.go || !(backer || late) || (!waiting && !ready); rb.disabled = ready || n.go; rb.textContent = ready ? 'You are ready' : 'Ready';
      rb.classList.toggle('done', ready);
      sk.hidden = !isHost || n.go || !n.wait.length || (n.wait.length === 1 && n.wait[0] === m.you);
      const bt = box().querySelector('.bt.go');
      if (n.go && !introGo) { introGo = true; bt.hidden = false; bt.style.setProperty('--dur', Math.max(300, m.ends - now()) + 'ms'); tone(780, .12); if (G_) G_.emit('briefGo'); }
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
        if (b.textContent !== String(sec)) b.textContent = sec;
        if (left && last.part) bonusTick(cur, left, 3, .8);
        clk.classList.toggle('low', left > 0 && left <= 3000);
      }
      if (inst && G[last.id] && G[last.id].frame) try { G[last.id].frame(inst.el, inst.st, last.v, api(last)); } catch (e) { console.error(e); }
    }
    function results(m) {
      if (!$('bonus').classList.contains('on') || box().querySelector('.final') || !box().querySelector('.bbody')) return;
      const rows = m.results.rows.filter(r => r.stake), mine = rows.find(r => r.id === m.you);
      const pl = id => players[id] || { name: '?', color: '#888' };
      box().insertAdjacentHTML('beforeend', `<div class="final"><div class="fcard"><span class="cat">${CAT_NAMES[m.results.key]}</span><h3>${esc(last ? last.name : 'Bonus')} results</h3>
        ${mine ? `<p class="mine ${mine.win > 0 ? 'win' : ''}">You finished at ${fx2(mine.m)}x and collect ${orra(mine.win)}${mine.vault ? `. ${orra(mine.vault)} saved to your wallet` : ''}</p>` : '<p class="note">You watched this one.</p>'}
        <table class="res"><tr><th>Player</th><th class="n">Result</th><th class="n">Stake</th><th class="n">Collect</th></tr>${rows.map(r => `<tr class="${r.id === m.you ? 'me' : ''}"><td><span class="pdot" style="--c:${pl(r.id).color}"></span>${esc(pl(r.id).name)}${r.late ? ' <span class="tag">Late</span>' : ''}</td><td class="n">${fx2(r.m)}x</td><td class="n">${fmt(r.stake)}</td><td class="n">${orra(r.win)}</td></tr>`).join('')}</table>
        <button class="btn go" id="bclose">Back to the table</button></div></div>`);
      const b = $('bclose'); if (b) { b.onclick = close; b.focus(); }
    }
    function close() { $('bonus').classList.remove('on'); cur = null; inst = null; last = null; introKey = ''; introGo = false; }
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
      heft(c, Math.max(9, Math.min(20, TAU * r / n * .62)), 2.5); htext(c, o.text(i), r - 8, 1, r * .6);
      c.restore();
    }
    disc(c, r * .22, metal(c, 1)); disc(c, r * .19, '#2c150b');
    if (o.hub) { c.fillStyle = '#f3dc98'; c.textAlign = 'center'; c.textBaseline = 'middle'; heft(c, r * .09, 3); htext(c, o.hub, 0, 0); }
    for (const f of o.flappers || []) {
      const a = f.off * TAU / n - Math.PI / 2;
      c.save(); c.rotate(a + Math.PI / 2); c.translate(0, -r - 14);
      c.beginPath(); c.moveTo(-11, -14); c.lineTo(11, -14); c.lineTo(0, 16); c.closePath(); c.fillStyle = f.color; c.fill(); c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
      if (f.label) { c.rotate(-(a + Math.PI / 2)); c.fillStyle = '#fff'; heft(c, 12, 2); c.textAlign = 'center'; htext(c, f.label, 0, -26); }
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
      v === 'DOUBLE' ? heft(c, Math.min(14, sw * .3), 2) : heft(c, Math.min(22, sw * .42), 3);
      if (v === 'DOUBLE') { c.save(); c.translate(i * sw + sw / 2, RHS.SLOT_Y + 28); c.rotate(-Math.PI / 2); htext(c, 'DOUBLE', 0, 0); c.restore(); }
      else htext(c, v + 'x', i * sw + sw / 2, RHS.SLOT_Y + 28);
      if (o.label) { const l = o.label(i); if (l) { heft(c, 11, 1.5); htext(c, l, i * sw + sw / 2, RHS.BH - 10); } }
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
  return { boot, G, h: esc, esc, fmt, fx2, ORRA, orra, now, tone, segWheel, spinPos, drawBoard, track, smooth, coinFlip, coinHtml, secs, toast, FONT, heft, htext, TAU, metal, disc };
})();
