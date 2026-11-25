'use strict';
// Drop Dead renderers: Puck Wars, Peg Builder, Slot Auction, Tilt
(() => {
  const { G, esc, fx2, now, tone, drawBoard, track, smooth, secs } = RH;
  // Boards are 600x720: width also follows the free height so the whole board fits on screen.
  const fit = (w, h) => `min(${w},max(180px,calc((100dvh - ${h}px) * .833)))`;
  const boardCanvas = (id, w = fit('440px,88vw', 330)) => `<canvas class="gc" id="${id}" width="600" height="720" style="width:${w}"></canvas>`;
  const worldX = (c, e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * RHS.BW, (e.clientY - r.top) / r.height * RHS.BH]; };

  G.puckwars = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="pw-note"></p>${boardCanvas('pw-c')}<div class="row" id="pw-act"></div>`;
      const c = el.querySelector('#pw-c'); st.x = 300; st.sent = 0;
      c.onpointermove = e => { st.x = worldX(c, e)[0]; const t = performance.now(); if (t - st.sent > 70) { st.sent = t; api.send({ x: st.x }); } };
      c.onclick = e => { st.x = worldX(c, e)[0]; api.send({ x: st.x, drop: true }); tone(400, .1); };
    },
    update(el, st, v, api) {
      st.v = v;
      const me = v.P[api.me];
      el.querySelector('#pw-note').textContent = me ? (me.left > 0 ? `Move to choose your spot, click to drop. ${me.until > now() ? 'Second puck: drop now!' : ''}` : 'Your puck is in play.') : 'Watching.';
      el.querySelector('#pw-act').innerHTML = api.players.map(p => { const q = v.P[p.id]; return `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)}${p.id === v.leader ? ' (leader)' : ''} ${q.value !== null ? q.value + 'x' : q.left ? 'to drop' : 'falling'}${q.factor > 1 ? ' x' + q.factor : ''}</span>`; }).join('');
    },
    fx(el, st, d) { if (d.p) track(st, d.p.main); },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#pw-c'); if (!v || !c) return;
      const pucks = smooth(st).map(p => ({ ...p, c: api.color(v.owners[p.id]) }));
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs: v.pegs, pucks, after: x => {
        for (const p of api.players) {
          const q = v.P[p.id]; if (!q || q.left <= 0) continue;
          const px = p.id === api.me ? st.x : q.x;
          x.fillStyle = p.color; x.beginPath(); x.moveTo(px - 12, 2); x.lineTo(px + 12, 2); x.lineTo(px, 24); x.fill();
          if (p.id === v.leader) { x.fillStyle = '#ffe58a'; x.fillRect(px - 9, 26, 18, 6); }
        }
      } });
    }
  };

  G.pegs = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="pb-note"></p>${boardCanvas('pb-c')}<div class="row" id="pb-act"></div>`;
      const c = el.querySelector('#pb-c');
      c.onclick = e => {
        const v = st.v; if (!v || v.phase !== 'build' || !api.part || v.lock.includes(api.me)) return;
        const [x, y] = worldX(c, e), mine = v.extra[api.me], k = mine.findIndex(p => Math.hypot(p.x - x, p.y - y) < 16);
        if (k >= 0) return api.send({ unpeg: k });
        const all = RHS.basePegs().concat(...Object.values(v.extra));
        if (mine.length < 2 && RHS.pegSpotOk(all, x, y)) { api.send({ peg: { x, y } }); tone(600, .06); } else RH.toast(mine.length >= 2 ? 'You placed both pegs. Click one to remove it.' : 'Too close to another peg.', 1500);
      };
    },
    update(el, st, v, api) {
      st.v = v;
      const mine = v.owner.map((o, i) => o === api.me ? i : -1).filter(i => i >= 0);
      el.querySelector('#pb-note').textContent = v.phase === 'build' ? `Your slots are marked in your color (${mine.map(i => v.vals[i] + 'x').join(' and ') || 'none'}). Click to place your 2 pegs (${(v.extra[api.me] || []).length}/2).` : v.phase === 'drop' ? `Dropping...${v.doubles ? ' DOUBLE x' + Math.pow(2, v.doubles) : ''}` : 'Done.';
      const act = el.querySelector('#pb-act');
      act.innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)} ${v.res[p.id]}x${v.lock.includes(p.id) ? ' (locked)' : ''}</span>`).join('');
      if (v.phase === 'build' && api.part && !v.lock.includes(api.me)) { act.insertAdjacentHTML('beforeend', `<button class="btn go" id="pb-lock" ${(v.extra[api.me] || []).length === 2 ? '' : 'disabled'}>Lock pegs</button>`); el.querySelector('#pb-lock').onclick = () => api.send({ lock: true }); }
    },
    fx(el, st, d) { if (d.p) track(st, d.p.main); },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#pb-c'); if (!v || !c) return;
      const pegs = RHS.basePegs().concat(...Object.entries(v.extra).map(([id, a]) => a.map(p => ({ ...p, c: api.color(id) }))));
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs, owner: i => v.owner[i] ? api.color(v.owner[i]) + 'cc' : null, label: i => v.owner[i] ? api.name(v.owner[i]).slice(0, 6) : v.vals[i] === 'DOUBLE' ? '' : '-', hit: v.phase === 'done' ? v.landed : null, pucks: smooth(st).map(p => ({ ...p, c: '#fff' })) });
    }
  };

  G.auction = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="sa-note"></p><div class="grid" id="sa-g" style="grid-template-columns:repeat(8,1fr);width:min(720px,94vw)"></div><div class="row" id="sa-act"></div>${boardCanvas('sa-c', fit('380px,80vw', 420))}`;
    },
    update(el, st, v, api) {
      st.v = v;
      el.querySelector('#sa-g').innerHTML = v.vals.map((x, i) => {
        const o = v.owner[i];
        return `<button class="cell ${o ? 'own' : ''} ${i === v.lot && v.phase === 'auction' ? 'mine' : ''}" data-i="${i}" style="--c:${o ? api.color(o) : ''};min-height:64px" ${v.phase === 'steal' && v.owner[v.dslot] === api.me && i !== v.dslot && o !== api.me ? '' : 'disabled'}>${x === 'DOUBLE' ? 'DOUBLE' : x + 'x'}<small style="display:block;font-size:10px">${o ? esc(api.name(o)) + ' paid ' + v.paid[i] : i < v.lot ? 'no bids' : ''}</small></button>`;
      }).join('');
      el.querySelectorAll('#sa-g button').forEach(b => b.onclick = () => api.send({ steal: +b.dataset.i }));
      const act = el.querySelector('#sa-act'), my = v.mult[api.me];
      act.innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)} keeps ${v.mult[p.id]}x, won ${v.won[p.id]}x</span>`).join('');
      const note = el.querySelector('#sa-note');
      if (v.phase === 'auction' && v.lot < v.vals.length) {
        const hi = v.high ? v.high.amt : 0;
        note.textContent = `Lot ${v.lot + 1}/${v.vals.length}: slot ${v.vals[v.lot]}${v.vals[v.lot] === 'DOUBLE' ? '' : 'x'}. High bid ${v.high ? hi + 'x by ' + api.name(v.high.pid) : 'none'}. You have ${my !== undefined ? my : 0}x.`;
        if (api.part) {
          act.insertAdjacentHTML('beforeend', [1, 2, 5].map(k => `<button class="btn" data-b="${hi + k}" ${hi + k > my || (v.high && v.high.pid === api.me) ? 'disabled' : ''}>Bid ${hi + k}x</button>`).join(''));
          act.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { api.send({ bid: +b.dataset.b }); tone(640, .08); });
        }
      } else if (v.phase === 'steal') {
        note.textContent = `${api.name(v.owner[v.dslot])} owns DOUBLE and chooses a slot to steal.`;
        if (v.owner[v.dslot] === api.me) { act.insertAdjacentHTML('beforeend', '<button class="btn" id="sa-skip">Skip steal</button>'); el.querySelector('#sa-skip').onclick = () => api.send({ skip: true }); }
      } else note.textContent = v.phase === 'drop' ? `Puck ${v.dropN}/${v.pucks}` : v.phase === 'done' ? 'Auction closed.' : 'Get ready to bid.';
    },
    fx(el, st, d) { if (d.p) { const id = d.p.main[0] && d.p.main[0][0]; if (st.pid !== id) { st.pid = id; st.pk = {}; } track(st, d.p.main); } },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#sa-c'); if (!v || !c) return;
      drawBoard(c.getContext('2d'), { vals: v.vals, pegs: RHS.basePegs(), owner: i => v.owner[i] ? api.color(v.owner[i]) + 'cc' : null, label: i => v.owner[i] ? api.name(v.owner[i]).slice(0, 6) : '', pucks: smooth(st).map(p => ({ ...p, c: '#fff' })) });
    }
  };

  G.tilt = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="tl-note"></p><div class="row" id="tl-act"></div><div class="row tl-boards"><div id="tl-me"></div><div class="row tl-boards" id="tl-others"></div></div>`;
      st.pk = {};
      st.key = e => { if (e.key === 'ArrowLeft' || e.key === 'a') api.send({ nudge: -1 }); if (e.key === 'ArrowRight' || e.key === 'd') api.send({ nudge: 1 }); };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v;
      if (!st.built) {
        st.built = true;
        const mine = api.players.find(p => p.id === api.me);
        el.querySelector('#tl-me').innerHTML = mine ? `<div class="tl-board"><b>Your board</b>${boardCanvas('tl-' + mine.id, fit('340px,80vw', 400))}</div>` : '';
        el.querySelector('#tl-others').innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<div class="tl-board"><b style="color:${p.color}">${esc(p.name)}</b>${boardCanvas('tl-' + p.id, mine ? '150px' : fit('220px', 400))}${mine ? `<div class="row"><button class="btn sm" data-r="${p.id}" data-d="-1">Nudge left</button><button class="btn sm" data-r="${p.id}" data-d="1">Nudge right</button></div>` : ''}</div>`).join('');
        el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => api.send({ nudge: +b.dataset.d, board: b.dataset.r }));
      }
      const u = v.used[api.me] || 0, act = el.querySelector('#tl-act');
      if (api.part && v.phase !== 'done') {
        act.innerHTML = `<button class="btn go" data-n="-1">Tilt left</button><span class="big" style="font-size:28px;min-width:60px">${u}/3</span><button class="btn go" data-n="1">Tilt right</button>`;
        act.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { api.send({ nudge: +b.dataset.n }); tone(250, .15, .08); });
      } else act.innerHTML = '';
      el.querySelectorAll('[data-r]').forEach(b => b.disabled = v.rival[api.me] || v.phase !== 'live');
      el.querySelector('#tl-note').textContent = v.phase === 'lead' ? `Drop in ${secs(v.t0)}...` : v.tilted[api.me] ? 'TILT. Your puck is destroyed.' : u >= 3 ? 'Careful: the next nudge triggers TILT.' : `Nudges used ${u}/3. Arrow keys work too. 0 nudges used = +3x. 1 nudge may go to a rival board.`;
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    fx(el, st, d) { if (d.b) for (const [id, fr] of Object.entries(d.b)) { st.bk = st.bk || {}; const s = st.bk[id] || (st.bk[id] = {}); track(s, fr); } },
    frame(el, st, _, api) {
      const v = st.v; if (!v) return;
      for (const p of api.players) {
        const c = el.querySelector('#tl-' + p.id); if (!c) continue;
        const s = (st.bk || {})[p.id] || {};
        drawBoard(c.getContext('2d'), { vals: v.vals, pegs: RHS.basePegs(), hit: v.landed[p.id], pucks: v.tilted[p.id] ? [] : smooth(s).map(q => ({ ...q, c: p.color })), after: x => { if (v.tilted[p.id]) { x.fillStyle = '#c8323c'; RH.heft(x, 90, 3); x.textAlign = 'center'; RH.htext(x, 'TILT', 300, 360); } } });
      }
    }
  };
})();
