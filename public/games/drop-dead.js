'use strict';
// Drop Dead renderers: Puck Wars, Peg Builder, Slot Auction, Tilt
(() => {
  const { G, esc, fx2, now, tone, drawBoard, track, smooth, secs, K } = RH;
  // Boards are 600x720: width also follows the free height so the whole board fits on screen.
  const fit = (w, h) => `min(${w},max(180px,calc((100dvh - ${h}px) * .833)))`;
  const boardCanvas = (id, w = fit('420px,86vw', 390)) => `<canvas class="gc board" id="${id}" width="600" height="720" style="width:${w}"></canvas>`;
  const worldX = (c, e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * RHS.BW, (e.clientY - r.top) / r.height * RHS.BH]; };
  const slotX = (i, n) => (i + .5) * RHS.BW / n;
  // Landing effect over a slot of a board canvas
  function landFx(c, slot, n, text, col, big) {
    const [x, y] = K.canvasPt(c, slotX(slot, n), RHS.SLOT_Y + 20, RHS.BW, RHS.BH);
    K.pop(x, y - 30, text, { color: col, kind: big ? 'big' : '' });
    K.burst(x, y, { n: big ? 50 : 24, colors: [col, '#fff', '#ffe58a'], up: true, power: big ? 600 : 420 });
    tone(big ? 880 : 640, .15);
  }
  const marker = (x, px, col, label, crown) => {
    x.save(); x.shadowColor = col; x.shadowBlur = 12; x.fillStyle = col;
    x.beginPath(); x.moveTo(px - 14, 4); x.lineTo(px + 14, 4); x.lineTo(px, 30); x.fill(); x.restore();
    x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke();
    if (crown) { x.fillStyle = '#ffe58a'; x.beginPath(); x.moveTo(px - 10, 46); x.lineTo(px - 10, 36); x.lineTo(px - 5, 41); x.lineTo(px, 34); x.lineTo(px + 5, 41); x.lineTo(px + 10, 36); x.lineTo(px + 10, 46); x.fill(); }
    if (label) { x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 4; RH.heft(x, 13, 2); x.textAlign = 'center'; x.textBaseline = 'middle'; RH.htext(x, label, px, crown ? 58 : 42); x.shadowBlur = 0; }
  };

  // ---------------------------------------------------------------- Puck Wars
  G.puckwars = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="kstage">${boardCanvas('pw-c')}</div><div id="pw-b"></div>`);
      const c = el.querySelector('#pw-c'); st.x = 300; st.sent = 0; st.hover = false;
      c.onpointermove = e => { st.hover = true; st.x = Math.max(RHS.PUCK_R, Math.min(RHS.BW - RHS.PUCK_R, worldX(c, e)[0])); const t = performance.now(); if (t - st.sent > 70) { st.sent = t; api.send({ x: st.x }); } };
      c.onpointerleave = () => st.hover = false;
      c.onclick = e => { const me = st.v && st.v.P[api.me]; if (!me || me.left <= 0) return; st.x = worldX(c, e)[0]; api.send({ x: st.x, drop: true }); tone(400, .1); if (window.Sfx) Sfx.play('glove-whoosh', { vol: .4 }); };
      st.key = e => { const me = st.v && st.v.P[api.me]; if (!me || me.left <= 0) return;
        if (e.key === 'ArrowLeft' || e.key === 'a') { st.x = Math.max(RHS.PUCK_R, st.x - 15); api.send({ x: st.x }); }
        if (e.key === 'ArrowRight' || e.key === 'd') { st.x = Math.min(RHS.BW - RHS.PUCK_R, st.x + 15); api.send({ x: st.x }); }
        if (e.code === 'Space') { e.preventDefault(); c.onclick({ clientX: c.getBoundingClientRect().left + st.x / RHS.BW * c.getBoundingClientRect().width }); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const me = v.P[api.me], c = el.querySelector('#pw-c');
      for (const p of api.players) {
        const q = v.P[p.id], k = 'v' + p.id + ':' + q.value + ':' + q.factor;
        if ((q.value !== null || q.factor > 1) && K.once(st, k)) {
          const pk = Object.entries(st.pk || {}).filter(([id]) => v.owners[id] === p.id).map(([, x]) => x).pop();
          const slot = pk ? Math.max(0, Math.min(v.slots - 1, Math.floor(pk.tx / (RHS.BW / v.slots)))) : 0;
          landFx(c, slot, v.slots, q.value !== null ? `${p.name}: ${q.value * q.factor}x` : `DOUBLE x${q.factor}`, p.color, q.value === null || q.value >= 50);
        }
      }
      K.steps(el.querySelector('.ksteps'), ['Aim and drop', 'Bumper pucks', 'Score'], v.phase === 'done' ? 2 : me && me.left > 0 ? 0 : 1);
      const cue = el.querySelector('.kcue'), auto = Math.max(0, Math.ceil((v.opened + v.dropMs - now()) / 1000));
      if (!me) K.cue(cue, 'Watching Puck Wars', 'All pucks share one board and knock each other around', 'wait');
      else if (me.left > 0) K.cue(cue, me.until > now() ? 'DOUBLE: drop your bonus puck' : 'Aim and click to drop', `Move over the board, click or Space. ${me.until > now() ? '' : `Auto drop in ${auto}s.`} Knock the leader off course.`, 'you');
      else if (me.value === null) K.cue(cue, 'Your puck is falling', 'Come on...', 'wait');
      else K.cue(cue, `You landed ${me.value * me.factor}x`, me.factor > 1 ? `DOUBLE x${me.factor}` : '', 'good');
      K.board(el.querySelector('#pw-b'), api.players.map(p => { const q = v.P[p.id];
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: q.value !== null ? q.value * q.factor : null, txt: q.left ? 'aiming' : 'falling', sub: q.factor > 1 ? 'x' + q.factor : '', tag: p.id === v.leader ? 'LEADER' : '' }; }), { pops: false });
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    fx(el, st, d) { if (d.p) track(st, d.p.main); },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#pw-c'); if (!v || !c) return;
      const pucks = smooth(st).map(p => ({ ...p, c: api.color(v.owners[p.id]) }));
      const me = v.P[api.me];
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs: v.pegs, pucks, after: x => {
        if (me && me.left > 0) { x.save(); x.strokeStyle = api.color(api.me); x.globalAlpha = .35; x.setLineDash([6, 10]); x.lineDashOffset = -performance.now() / 40; x.lineWidth = 2; x.beginPath(); x.moveTo(st.x, 34); x.lineTo(st.x, RHS.SLOT_Y - 20); x.stroke(); x.restore(); }
        for (const p of api.players) {
          const q = v.P[p.id]; if (!q || q.left <= 0) continue;
          marker(x, p.id === api.me ? st.x : q.x, p.color, p.id === api.me ? '' : p.name.slice(0, 6), p.id === v.leader);
        }
      } });
    }
  };

  // ---------------------------------------------------------------- Peg Builder
  G.pegs = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="kstage">${boardCanvas('pb-c')}</div><div class="row" id="pb-act"></div><div id="pb-b"></div>`);
      const c = el.querySelector('#pb-c');
      c.onpointermove = e => { st.ptr = worldX(c, e); };
      c.onpointerleave = () => st.ptr = null;
      c.onclick = e => {
        const v = st.v; if (!v || v.phase !== 'build' || !api.part || v.lock.includes(api.me)) return;
        const [x, y] = worldX(c, e), mine = v.extra[api.me], k = mine.findIndex(p => Math.hypot(p.x - x, p.y - y) < 18);
        if (k >= 0) { tone(300, .06); return api.send({ unpeg: k }); }
        const all = RHS.basePegs().concat(...Object.values(v.extra));
        if (mine.length < 2 && RHS.pegSpotOk(all, x, y)) { api.send({ peg: { x, y } }); tone(600, .06); const [px, py] = K.canvasPt(c, x, y, RHS.BW, RHS.BH); K.burst(px, py, { kind: 'spark', n: 14, colors: [api.color(api.me), '#fff'] }); }
        else { RH.toast(mine.length >= 2 ? 'Both pegs placed. Click one of yours to move it.' : 'Too close to another peg.', 1500); K.shake(c); }
      };
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const mine = v.owner.map((o, i) => o === api.me ? i : -1).filter(i => i >= 0), n = (v.extra[api.me] || []).length, locked = v.lock.includes(api.me);
      if (v.doubles && K.once(st, 'd' + v.doubles)) { K.burstAt(el.querySelector('#pb-c'), { n: 60, colors: ['#ffe58a', '#e6b030', '#fff'] }); K.popAt(el.querySelector('#pb-c'), `DOUBLE: all slots x${Math.pow(2, v.doubles)}`, { kind: 'big' }); }
      if (v.phase === 'done' && v.landed !== null && K.once(st, 'land')) { const o = v.owner[v.landed]; landFx(el.querySelector('#pb-c'), v.landed, v.n, o ? `${api.name(o)} +${v.vals[v.landed]}x` : 'Nobody', o ? api.color(o) : '#aaa', o === api.me); }
      K.steps(el.querySelector('.ksteps'), ['Place 2 pegs', 'Drop', 'Payout'], { build: 0, drop: 1, done: 2 }[v.phase]);
      const cue = el.querySelector('.kcue');
      if (v.phase === 'build') K.cue(cue, !api.part ? 'Players are building' : locked ? 'Pegs locked' : `Place your pegs: ${n}/2`, api.part && !locked ? `Your slots glow: ${mine.map(i => v.vals[i] + 'x').join(' and ')}. Steer the puck there, or away from rivals.` : `Locked: ${v.lock.length}/${api.players.length}`, api.part && !locked ? 'you' : 'wait');
      else if (v.phase === 'drop') K.cue(cue, 'The puck drops', v.doubles ? `DOUBLE x${Math.pow(2, v.doubles)}: dropping again` : 'Pegs in your colour glow', 'info');
      else { const o = v.landed !== null ? v.owner[v.landed] : null; K.cue(cue, o ? (o === api.me ? 'It landed in your slot' : `${api.name(o)} collects`) : 'Nobody collects', '', o === api.me ? 'good' : 'info'); }
      const act = el.querySelector('#pb-act');
      if (v.phase === 'build' && api.part && !locked) {
        if (!act.querySelector('#pb-lock')) { act.innerHTML = '<button class="kbig" id="pb-lock"></button>'; act.querySelector('#pb-lock').onclick = () => { api.send({ lock: true }); tone(500, .15); }; }
        const b = act.querySelector('#pb-lock'); b.disabled = n !== 2; b.textContent = n === 2 ? 'Lock pegs' : `${2 - n} peg${n === 1 ? '' : 's'} to place`; b.classList.toggle('pulse', n === 2);
      } else act.innerHTML = '';
      K.board(el.querySelector('#pb-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.res[p.id], sub: v.owner.map((o, i) => o === p.id ? v.vals[i] : null).filter(x => x !== null).map(x => x + 'x').join(' + '), tag: v.phase === 'build' && v.lock.includes(p.id) ? 'LOCKED' : '' })));
    },
    fx(el, st, d) { if (d.p) { const id = d.p.main[0] && d.p.main[0][0]; if (d.p.main.length && st.pid !== id) { st.pid = id; st.pk = {}; } track(st, d.p.main); } },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#pb-c'); if (!v || !c) return;
      const pegs = RHS.basePegs().concat(...Object.entries(v.extra).map(([id, a]) => a.map(p => ({ ...p, c: api.color(id) }))));
      const building = v.phase === 'build' && api.part && !v.lock.includes(api.me) && (v.extra[api.me] || []).length < 2;
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs, owner: i => v.owner[i] ? api.color(v.owner[i]) + 'bb' : null, label: i => v.owner[i] ? api.name(v.owner[i]).slice(0, 6) : v.vals[i] === 'DOUBLE' ? '' : '-',
        hot: i => v.owner[i] === api.me ? '#ffe58a' : null, hit: v.phase === 'done' ? v.landed : null, pucks: smooth(st).map(p => v.phase === 'done' && v.landed !== null ? { ...p, x: slotX(v.landed, v.n), y: RHS.SLOT_Y + 8, tr: [], c: '#fff' } : { ...p, c: '#fff' }),
        after: x => { if (building && st.ptr) { const [px, py] = st.ptr, ok = RHS.pegSpotOk(RHS.basePegs().concat(...Object.values(v.extra)), px, py);
          x.save(); x.globalAlpha = .8; x.beginPath(); x.arc(px, py, RHS.PEG_R + 3, 0, RH.TAU); x.fillStyle = ok ? api.color(api.me) : '#ff3a3a55'; x.fill(); x.strokeStyle = ok ? '#fff' : '#ff3a3a'; x.lineWidth = 2; x.stroke();
          x.beginPath(); x.arc(px, py, 30, 0, RH.TAU); x.setLineDash([4, 6]); x.strokeStyle = ok ? '#ffffff66' : '#ff3a3a88'; x.stroke(); x.restore(); } } });
    }
  };

  // ---------------------------------------------------------------- Slot Auction
  G.auction = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="sa-lots" id="sa-g"></div><div class="sa-floor"><div class="sa-lot"></div><div class="row" id="sa-act"></div></div><div class="kstage" id="sa-stage">${boardCanvas('sa-c', fit('360px,78vw', 470))}</div><div id="sa-b"></div>`);
      el.querySelector('#sa-g').onclick = e => { const b = e.target.closest('[data-i]'); if (b && !b.disabled) { api.send({ steal: +b.dataset.i }); tone(300, .2); } };
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const my = v.mult[api.me] || 0, auctioning = v.phase === 'auction' && v.lot < v.vals.length, steal = v.phase === 'steal' && v.owner[v.dslot] === api.me;
      el.querySelector('#sa-g').innerHTML = v.vals.map((x, i) => {
        const o = v.owner[i], cur = i === v.lot && auctioning;
        return `<button class="sa-card ${x === 'DOUBLE' ? 'dbl' : ''} ${o ? 'own' : ''} ${cur ? 'cur' : ''} ${i < v.lot && !o ? 'nobid' : ''} ${v.hits.includes(i) ? 'hit' : ''} ${steal && i !== v.dslot && o !== api.me ? 'steal' : ''}" data-i="${i}" style="--c:${o ? api.color(o) : ''}" ${steal && i !== v.dslot && o !== api.me ? '' : 'disabled'}>
          <b>${x === 'DOUBLE' ? 'x2' : x + 'x'}</b><small>${o ? esc(api.name(o)) : i < v.lot ? 'no bids' : cur ? 'on sale' : 'lot ' + (i + 1)}</small>${o ? `<em>paid ${v.paid[i]}</em>` : ''}${v.hits.filter(h => h === i).length ? `<i class="sa-hits">${'&#9679;'.repeat(v.hits.filter(h => h === i).length)}</i>` : ''}</button>`;
      }).join('');
      el.querySelector('#sa-stage').hidden = v.phase !== 'drop' && v.phase !== 'done';
      const lot = el.querySelector('.sa-lot'), act = el.querySelector('#sa-act'), hi = v.high ? v.high.amt : 0, top = v.high && v.high.pid === api.me;
      if (auctioning) {
        const left = Math.max(0, (api.m.ends || 0) - now()), x = v.vals[v.lot];
        lot.innerHTML = `<span class="cat">Lot ${v.lot + 1} of ${v.vals.length}</span><b class="${x === 'DOUBLE' ? 'dbl' : ''}">${x === 'DOUBLE' ? 'DOUBLE' : x + 'x'}</b><span class="sa-high">${v.high ? `<span class="kav" style="--c:${api.color(v.high.pid)}">${esc(api.name(v.high.pid).slice(0, 2))}</span> ${hi}x by ${esc(api.name(v.high.pid))}` : 'No bids yet'}</span>`;
        lot.classList.toggle('hot', left > 0 && left < 3000);
        if (v.high && K.once(st, 'h' + v.lot + ':' + hi)) { K.flash(lot); tone(500 + hi * 20, .08); if (v.high.pid !== api.me) K.popAt(lot.querySelector('.sa-high'), `${hi}x`, { color: api.color(v.high.pid) }); }
        if (api.part) {
          const k = `${v.lot}:${hi}:${my}:${top}`;
          if (act.dataset.k !== k) { act.dataset.k = k;
            act.innerHTML = top ? '<span class="ktag">You are the top bidder</span>' : [1, 2, 5].map(d => `<button class="kbig ${d === 1 ? 'pulse' : 'dark'}" data-b="${hi + d}" ${hi + d > my ? 'disabled' : ''}>Bid ${hi + d}x<small>+${d}</small></button>`).join('');
            act.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { api.send({ bid: +b.dataset.b }); tone(640, .08); K.burstAt(b, { kind: 'coin', n: 10, colors: ['#ffd34d', '#e6b030'] }); }); }
        } else act.innerHTML = '';
      } else { lot.innerHTML = ''; act.innerHTML = steal ? '<button class="kbig dark" id="sa-skip">Skip the steal</button>' : ''; act.dataset.k = ''; const s = act.querySelector('#sa-skip'); if (s) s.onclick = () => api.send({ skip: true }); }
      K.steps(el.querySelector('.ksteps'), ['Auction 8 slots', 'DOUBLE steal', `Drop ${v.pucks} pucks`], v.phase === 'auction' ? 0 : v.phase === 'steal' ? 1 : 2);
      const cue = el.querySelector('.kcue');
      if (auctioning) K.cue(cue, api.part ? (top ? 'You lead this lot' : `Bid on lot ${v.lot + 1}`) : 'Auction running', `You have ${my}x to spend. Unspent counts toward your result. A late bid resets the clock to 3s.`, api.part && !top ? 'you' : 'wait');
      else if (v.phase === 'steal') K.cue(cue, steal ? 'Steal a slot' : `${api.name(v.owner[v.dslot])} may steal a slot`, steal ? 'You own DOUBLE: click any slot to take it.' : '', steal ? 'you' : 'wait');
      else if (v.phase === 'drop') K.cue(cue, `Puck ${v.dropN} of ${v.pucks}`, 'Owners collect the slot their puck lands in', 'info');
      else if (v.phase === 'done') K.cue(cue, api.part ? `You finish at ${fx2(my + (v.won[api.me] || 0))}x` : 'Auction closed', api.part ? `${my}x kept + ${v.won[api.me] || 0}x collected` : '', 'good');
      else K.cue(cue, 'The auction opens', 'Get ready to bid', 'wait');
      const n = v.hits.length; if (n && K.once(st, 'hit' + n)) { const i = v.hits[n - 1], o = v.owner[i]; setTimeout(() => landFx(el.querySelector('#sa-c'), i, v.vals.length, o ? `${api.name(o)} +${v.vals[i] === 'DOUBLE' ? 'x2' : v.vals[i] + 'x'}` : 'Unowned', o ? api.color(o) : '#aaa', o === api.me), 50); }
      K.board(el.querySelector('#sa-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.mult[p.id] + v.won[p.id], sub: `${v.mult[p.id]}x left, ${v.won[p.id]}x won` })));
    },
    fx(el, st, d) { if (d.p) { const id = d.p.main[0] && d.p.main[0][0]; if (d.p.main.length && st.pid !== id) { st.pid = id; st.pk = {}; } track(st, d.p.main); } },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#sa-c'); if (!v || !c || el.querySelector('#sa-stage').hidden) return;
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs: RHS.basePegs(), owner: i => v.owner[i] ? api.color(v.owner[i]) + 'bb' : null, label: i => v.owner[i] ? api.name(v.owner[i]).slice(0, 6) : '', hot: i => v.owner[i] === api.me ? '#ffe58a' : null, pucks: smooth(st).map(p => ({ ...p, c: '#fff' })) });
    }
  };

  // ---------------------------------------------------------------- Tilt
  G.tilt = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="row" id="tl-act"></div><div class="tl-boards"><div id="tl-me"></div><div class="tl-others" id="tl-others"></div></div><div id="tl-b"></div>`);
      st.key = e => { if (e.key === 'ArrowLeft' || e.key === 'a') nudge(-1); if (e.key === 'ArrowRight' || e.key === 'd') nudge(1); };
      const nudge = (d, board) => { api.send(board ? { nudge: d, board } : { nudge: d }); tone(250, .15, .08); if (window.Sfx) Sfx.play('glove-slap', { vol: .45 }); const c = el.querySelector('#tl-' + (board || api.me)); if (c) { c.style.setProperty('--tx', d * 10 + 'px'); K.flash(c, 'knudge'); } };
      st.nudge = nudge;
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      if (!st.built) {
        st.built = true;
        const mine = api.players.find(p => p.id === api.me);
        el.querySelector('#tl-me').innerHTML = mine ? `<div class="tl-board me"><b>Your board</b>${boardCanvas('tl-' + mine.id, fit('340px,80vw', 420))}</div>` : '';
        el.querySelector('#tl-others').innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<div class="tl-board"><b style="color:${p.color}">${esc(p.name)}</b>${boardCanvas('tl-' + p.id, mine ? '150px' : fit('220px', 420))}${mine ? `<div class="row"><button class="btn sm" data-r="${p.id}" data-d="-1">&#9664; Nudge</button><button class="btn sm" data-r="${p.id}" data-d="1">Nudge &#9654;</button></div>` : ''}</div>`).join('');
        el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => st.nudge(+b.dataset.d, b.dataset.r));
      }
      const u = v.used[api.me] || 0, act = el.querySelector('#tl-act');
      if (api.part && v.phase !== 'done' && !v.tilted[api.me]) {
        if (!act.querySelector('[data-n]')) { act.innerHTML = `<button class="kbig blue" data-n="-1">&#9664; Tilt<kbd>A</kbd></button><span class="tl-pips"></span><button class="kbig blue" data-n="1">Tilt &#9654;<kbd>D</kbd></button>`; act.querySelectorAll('[data-n]').forEach(b => b.onclick = () => st.nudge(+b.dataset.n)); }
        act.querySelector('.tl-pips').innerHTML = [0, 1, 2, 3].map(i => `<i class="${i < u ? 'on' : ''} ${i === 3 ? 'tilt' : ''}">${i === 3 ? 'TILT' : ''}</i>`).join('');
        act.querySelectorAll('[data-n]').forEach(b => { b.disabled = v.phase !== 'live'; b.classList.toggle('red', u >= 3); });
      } else act.innerHTML = '';
      el.querySelectorAll('[data-r]').forEach(b => b.disabled = v.rival[api.me] || v.phase !== 'live');
      for (const p of api.players) {
        if (v.tilted[p.id] && K.once(st, 't' + p.id)) { const c = el.querySelector('#tl-' + p.id); K.shake(c, true); K.burstAt(c, { kind: 'spark', n: 50, colors: ['#ff3a3a', '#ffd34d'] }); tone(120, .4); }
        if (v.landed[p.id] !== null && K.once(st, 'l' + p.id)) { const c = el.querySelector('#tl-' + p.id); if (c) landFx(c, v.landed[p.id], v.slots, `${v.vals[v.landed[p.id]]}x`, p.color, p.id === api.me); }
      }
      for (const n of v.nudges) if (n.target !== n.pid && K.once(st, 'n' + n.at)) { const c = el.querySelector('#tl-' + n.target); if (c) { K.flash(c, 'knudge'); K.popAt(c, `${api.name(n.pid)} nudges!`, { kind: 'bad' }); } }
      K.steps(el.querySelector('.ksteps'), ['Get ready', 'Steer', 'Land'], v.phase === 'lead' ? 0 : v.phase === 'live' ? 1 : 2);
      const cue = el.querySelector('.kcue');
      if (!api.part) K.cue(cue, 'Watching Tilt', 'Everyone steers their own board', 'wait');
      else if (v.phase === 'lead') K.cue(cue, `Drop in ${secs(v.t0)}`, 'A and D or the buttons tilt your board. 3 nudges max, the 4th is TILT. None used: +3x.', 'you');
      else if (v.tilted[api.me]) K.cue(cue, 'TILT', 'Your puck is destroyed', 'bad');
      else if (v.phase === 'done') K.cue(cue, 'All pucks landed', '', 'info');
      else K.cue(cue, u >= 3 ? 'Careful: next nudge is TILT' : `Steer your puck: ${u}/3 nudges`, u ? 'You can spend 1 nudge on a rival board' : 'No nudges used so far: +3x bonus', u >= 3 ? 'bad' : 'you');
      K.board(el.querySelector('#tl-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.landed[p.id] !== null ? v.vals[v.landed[p.id]] + (v.used[p.id] ? 0 : 3) : null, txt: v.tilted[p.id] ? 'TILT' : 'falling', sub: `${v.used[p.id]}/3 nudges`, out: v.tilted[p.id], tag: v.used[p.id] === 0 && v.landed[p.id] !== null ? '+3x' : '' })), { pops: false });
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    fx(el, st, d) { if (d.b) for (const [id, fr] of Object.entries(d.b)) { st.bk = st.bk || {}; const s = st.bk[id] || (st.bk[id] = {}); track(s, fr); } },
    frame(el, st) {
      const v = st.v, api = st.api; if (!v) return;
      for (const p of api.players) {
        const c = el.querySelector('#tl-' + p.id); if (!c) continue;
        const s = (st.bk || {})[p.id] || {};
        drawBoard(c.getContext('2d'), { vals: v.vals, pegs: RHS.basePegs(), hit: v.landed[p.id], pucks: v.tilted[p.id] ? [] : smooth(s).map(q => ({ ...q, c: p.color })), after: x => {
          if (v.tilted[p.id]) { x.fillStyle = '#0008'; x.fillRect(0, 0, RHS.BW, RHS.BH); K.glowText(x, 'TILT', 300, 340, 110, '#ff4a4a', '#000'); }
          if (v.phase === 'lead') K.bigCount(x, Math.max(0, (v.t0 - now()) / 1000), 300, 330, 160); } });
      }
    }
  };
})();
