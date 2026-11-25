'use strict';
// Cash Grab renderers: Memory Sniper, Trap Setter, Limited Ammo Bounty, Ricochet
(() => {
  const { G, esc, fx2, now, tone, secs } = RH;
  const COL = { red: '#c8323c', blue: '#2f6fd0', green: '#1f9a5a', gold: '#c9a14a' };

  G.sniper = {
    mount(el, st) {
      el.innerHTML = `<p class="note" id="ms-note"></p><div class="grid" id="ms-g" style="width:min(900px,92vw)"></div><div class="row" id="ms-act"></div>`;
      st.cards = {}; st.order = [];
    },
    layout(el, st, order, d) {
      const g = el.querySelector('#ms-g'), W = g.clientWidth || 600, cw = (W - 11 * 3) / 12, ch = Math.max(24, Math.min(40, cw * .72));
      g.style.height = (ch + 3) * 9 + 'px';
      order.forEach((id, i) => { const c = st.cards[id]; if (!c) return; c.style.setProperty('--d', d + 'ms'); c.style.width = cw + 'px'; c.style.height = ch + 'px'; c.style.transform = `translate(${(i % 12) * (cw + 3)}px,${Math.floor(i / 12) * (ch + 3)}px)`; });
    },
    update(el, st, v, api) {
      const g = el.querySelector('#ms-g');
      if (!Object.keys(st.cards).length) {
        v.cards.forEach((c, i) => { const b = document.createElement('button'); b.className = 'cell mover'; b.dataset.id = c.id; b.onclick = () => { const p = st.order.indexOf(c.id); if (p >= 0) { api.send({ shoot: p }); tone(300, .08); } }; g.appendChild(b); st.cards[c.id] = b; });
        this.layout(el, st, v.cards.map(c => c.id), 0);
      }
      if (v.phase === 'shuffle' && v.waves && !st.shuffled) {
        st.shuffled = true;
        v.waves.forEach((w, k) => setTimeout(() => { this.layout(el, st, w, v.wave * .9); tone(200 + k * 80, .2); }, Math.max(0, v.start + k * v.wave - now())));
      }
      if (v.phase !== 'shuffle') { st.order = v.cards.map(c => c.id); if (v.phase !== 'preview' || !st.laid) { this.layout(el, st, st.order, st.shuffled ? 0 : 0); st.laid = true; } }
      v.cards.forEach(c => {
        const b = st.cards[c.id]; if (!b) return;
        const shown = c.v !== undefined, own = c.o;
        b.className = 'cell mover' + (c.k === 'gold' ? ' gold' : '') + (c.k === 'bomb' && v.phase === 'done' ? ' bomb' : '') + (own ? ' own' : '');
        b.style.setProperty('--c', own ? api.color(own) : '');
        b.textContent = !shown ? '?' : c.k === 'bomb' && v.phase !== 'preview' ? 'BOMB' : c.v + 'x';
        b.disabled = v.phase !== 'shoot' || !api.part || !!own || !(v.shots[api.me] > 0) || v.bomb;
      });
      const note = el.querySelector('#ms-note'), act = el.querySelector('#ms-act');
      note.textContent = v.phase === 'preview' ? 'Memorise the values. Gold = extra shot.' : v.phase === 'shuffle' ? 'Shuffling. Follow the big ones.' : v.phase === 'shoot' ? (api.part ? `Shots: ${v.shots[api.me]}. First hit claims.` : 'Players are shooting.') : 'Final gallery.';
      act.innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)} ${v.got[p.id]}x${v.halves[p.id] ? ` (halved ${v.halves[p.id]}x)` : ''}</span>`).join('');
      if (v.bomb) {
        act.insertAdjacentHTML('beforeend', '<p style="width:100%">Bomb. Halve a rival:</p>' + api.players.filter(p => p.id !== api.me).map(p => `<button class="btn" data-b="${p.id}"><span class="pdot" style="--c:${p.color}"></span>${esc(p.name)}</button>`).join(''));
        act.querySelectorAll('[data-b]').forEach(b => b.onclick = () => api.send({ bomb: b.dataset.b }));
      }
    }
  };

  G.traps = {
    mount(el) { el.innerHTML = `<p class="note" id="ts-note"></p><div class="grid" id="ts-g" style="grid-template-columns:repeat(6,1fr);width:min(460px,92vw)"></div><div class="row" id="ts-act"></div><div id="ts-res"></div>`; },
    update(el, st, v, api) {
      const g = el.querySelector('#ts-g');
      g.innerHTML = v.vals.map((x, i) => {
        const trapBy = v.traps ? Object.keys(v.traps).filter(id => v.traps[id].includes(i)) : [];
        const pickBy = v.picks ? Object.keys(v.picks).filter(id => v.picks[id] === i) : [];
        const myTrap = v.myTraps.includes(i), myPick = v.myPick === i;
        return `<button class="cell ${myTrap || trapBy.length ? 'trap' : ''} ${myPick ? 'mine' : ''}" data-i="${i}" style="min-height:52px;font-size:16px" ${(v.phase === 'trap' || v.phase === 'pick') && api.part ? '' : 'disabled'}>${x}x<small style="display:block;font-size:10px">${trapBy.map(id => `<span class="pdot" style="--c:${api.color(id)};border-radius:0"></span>`).join('')}${pickBy.map(id => `<span class="pdot" style="--c:${api.color(id)}"></span>`).join('')}${myTrap && !v.traps ? 'TRAP' : ''}</small></button>`;
      }).join('');
      g.querySelectorAll('button').forEach(b => b.onclick = () => api.send(v.phase === 'trap' ? { trap: +b.dataset.i } : { pick: +b.dataset.i }));
      const act = el.querySelector('#ts-act'), note = el.querySelector('#ts-note');
      act.innerHTML = '';
      if (v.phase === 'trap') {
        note.textContent = `Place 2 traps (${v.myTraps.length}/2). Locked: ${v.lock.map(api.name).join(', ') || 'nobody'}.`;
        if (api.part && !v.lock.includes(api.me)) { act.innerHTML = `<button class="btn go" id="ts-lock" ${v.myTraps.length === 2 ? '' : 'disabled'}>Lock traps</button>`; el.querySelector('#ts-lock').onclick = () => api.send({ lock: true }); }
      } else if (v.phase === 'pick') note.textContent = `Pick 1 target. Trap -3x, alone and untrapped +2x. Picked: ${v.picked.map(api.name).join(', ') || 'nobody'}.`;
      else {
        note.textContent = 'Square = trap, round = pick.';
        el.querySelector('#ts-res').innerHTML = `<table class="res">${api.players.map(p => `<tr class="${p.id === api.me ? 'me' : ''}"><td><span class="pdot" style="--c:${p.color}"></span>${esc(p.name)}</td><td>${(v.detail[p.id] || []).map(esc).join(', ')}</td><td class="n">${fx2(v.res[p.id])}x</td></tr>`).join('')}</table>`;
      }
    }
  };

  G.ammo = {
    mount(el) { el.innerHTML = `<p class="note" id="la-note"></p><div class="grid" id="la-g" style="grid-template-columns:repeat(10,1fr);width:min(640px,94vw)"></div><div class="row" id="la-act"></div>`; },
    update(el, st, v, api) {
      const g = el.querySelector('#la-g'), myB = v.bullets[api.me] || 0, cool = v.cool > now();
      g.innerHTML = v.cells.map((c, i) => `<button class="cell ${c.o ? 'own' : c.v !== undefined ? 'open' : ''} ${v.lastShot && v.lastShot.i === i && now() - v.lastShot.at < 1200 ? 'mine' : ''}" data-i="${i}" style="--c:${c.o ? api.color(c.o) : ''};min-height:38px" ${v.phase === 'live' && api.part && myB > 0 && !v.hold[api.me] && c.o !== api.me ? '' : 'disabled'}>${c.v !== undefined ? c.v + 'x' : '?'}</button>`).join('');
      g.querySelectorAll('button').forEach(b => b.onclick = () => { api.send({ shoot: +b.dataset.i }); tone(220, .12, .07); });
      el.querySelector('#la-note').textContent = v.phase === 'live' ? (api.part ? `Bullets: ${myB}. A shot reveals its row. Hit a rival's target to steal it.${cool ? ' Reloading...' : ''}` : 'Players are shooting.') : 'Final gallery.';
      const act = el.querySelector('#la-act');
      act.innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)} ${v.totals[p.id]}x, ${v.bullets[p.id]} left${v.hold[p.id] ? ', holding' : ''}</span>`).join('');
      if (v.phase === 'live' && api.part && myB > 0 && !v.hold[api.me]) { act.insertAdjacentHTML('beforeend', `<button class="btn" id="la-hold">Keep ${myB} as Shield${myB > 1 ? 's' : ''}</button>`); el.querySelector('#la-hold').onclick = () => api.send({ hold: true }); }
      if (cool) { clearTimeout(st.t); st.t = setTimeout(() => this.update(el, st, v, api), v.cool - now() + 30); }
    }
  };

  G.ricochet = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="rc-note"></p><canvas class="gc" id="rc-c" width="600" height="800" style="width:min(420px,88vw,max(200px,calc((100dvh - 400px) * .75)));cursor:crosshair"></canvas><div class="row"><button class="btn" id="rc-l">Left</button><button class="btn go" id="rc-lock">Lock shot</button><button class="btn" id="rc-r">Right</button></div>`;
      const c = el.querySelector('#rc-c'); st.aim = 0; st.sentT = 0; st.anim = {};
      const set = a => { st.aim = Math.max(-75, Math.min(75, a)); const t = performance.now(); if (t - st.sentT > 60) { st.sentT = t; api.send({ aim: st.aim }); } };
      c.onpointermove = e => { if (!st.live) return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 600, y = (e.clientY - r.top) / r.height * 800; set(Math.atan2(x - RHS.GUN.x, RHS.GUN.y - y) * 180 / Math.PI); };
      c.onclick = () => st.live && api.send({ aim: st.aim, lock: true });
      el.querySelector('#rc-lock').onclick = () => api.send({ aim: st.aim, lock: true });
      el.querySelector('#rc-l').onclick = () => set(st.aim - 2); el.querySelector('#rc-r').onclick = () => set(st.aim + 2);
    },
    update(el, st, v, api) {
      st.v = v; st.live = v.phase === 'aim' && api.part && !v.locked.includes(api.me);
      if (st.first === undefined && v.aim[api.me] !== undefined) { st.aim = v.aim[api.me]; st.first = 1; }
      el.querySelector('#rc-lock').disabled = el.querySelector('#rc-l').disabled = el.querySelector('#rc-r').disabled = !st.live;
      v.shots.forEach((s, i) => { if (!st.anim[i]) { st.anim[i] = performance.now(); tone(500, .1); } });
      el.querySelector('#rc-note').textContent = v.phase === 'aim' ? `Aim with the mouse, click to lock. Order: ${v.order.map(api.name).join(', ') || 'nobody yet'}.` : v.phase === 'fire' ? 'Firing...' : 'Results: ' + api.players.map(p => `${p.name} ${v.res ? v.res[p.id] : 0}x`).join(', ');
    },
    frame(el, st, v, api) {
      if (!st.v) return; v = st.v;
      const c = el.querySelector('#rc-c'); if (!c) return; const x = c.getContext('2d');
      x.clearRect(0, 0, 600, 800); x.fillStyle = '#0b2a1e'; x.fillRect(0, 0, 600, 800); x.strokeStyle = '#e6c673'; x.lineWidth = 4; x.strokeRect(2, 2, 596, 820);
      for (const t of v.targets) { if (t.gone) continue; x.beginPath(); x.arc(t.x, t.y, RHS.TR, 0, RH.TAU); x.fillStyle = COL[t.c]; x.fill(); x.lineWidth = 3; x.strokeStyle = '#fff8'; x.stroke(); x.fillStyle = '#fff'; RH.heft(x, 15, 2.5); x.textAlign = 'center'; x.textBaseline = 'middle'; RH.htext(x, t.v, t.x, t.y + 1); }
      if (v.phase === 'aim') {
        for (const p of api.players) {
          const mine = p.id === api.me, a = mine && st.live ? st.aim : v.aim[p.id];
          const tr = RHS.trace(a, v.targets, 99, mine ? 1 : 0), pts = tr.pts;
          x.strokeStyle = p.color; x.globalAlpha = mine ? .95 : .55; x.lineWidth = mine ? 3 : 2; x.setLineDash(v.locked.includes(p.id) ? [] : [10, 8]);
          x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.stroke();
        }
        x.setLineDash([]); x.globalAlpha = 1;
      }
      v.shots.forEach((s, i) => {
        const t0 = st.anim[i]; if (!t0) return;
        const p = Math.min(1, (performance.now() - t0) / (v.shotMs * .8)), pts = s.pts;
        let len = 0; const seg = []; for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(d); len += d; }
        let left = len * p; x.strokeStyle = api.color(s.id); x.lineWidth = 3; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); let bx = pts[0][0], by = pts[0][1];
        for (let k = 1; k < pts.length && left > 0; k++) { const f = Math.min(1, left / seg[k - 1]); bx = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f; by = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f; x.lineTo(bx, by); left -= seg[k - 1]; }
        x.globalAlpha = i === v.shots.length - 1 ? 1 : .3; x.stroke(); x.globalAlpha = 1;
        if (p < 1) { x.beginPath(); x.arc(bx, by, 7, 0, RH.TAU); x.fillStyle = '#fff'; x.fill(); }
        else if (i === v.shots.length - 1) { x.fillStyle = '#fff'; RH.heft(x, 26, 2.5); x.textAlign = 'center'; RH.htext(x, `${api.name(s.id)}: ${s.best}x${s.combo ? ' COMBO' : ''}`, 300, 680); }
      });
      x.fillStyle = '#e6c673'; x.beginPath(); x.arc(RHS.GUN.x, RHS.GUN.y, 16, 0, RH.TAU); x.fill();
    }
  };
})();
