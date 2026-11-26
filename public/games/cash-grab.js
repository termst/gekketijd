'use strict';
// Cash Grab renderers: Memory Sniper, Trap Setter, Limited Ammo Bounty, Ricochet
(() => {
  const { G, esc, fx2, now, tone, K } = RH;
  const COL = { red: '#e0454f', blue: '#3a7ee0', green: '#2fbf6a', gold: '#e6b030' };
  const tier = v => v >= 100 ? 't4' : v >= 50 ? 't3' : v >= 20 ? 't2' : v >= 10 ? 't1' : 't0';
  const bullets = (n, max) => Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  const shot = () => { if (window.Sfx) Sfx.play('glove-snap', { vol: .5 }); else tone(220, .1, .07); };

  // ---------------------------------------------------------------- Memory Sniper
  G.sniper = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="grid ms" id="ms-g"></div><div class="row" id="ms-act"></div><div id="ms-b"></div>`);
      st.cards = {}; st.order = []; st.seen = {};
    },
    layout(el, st, order, d) {
      const g = el.querySelector('#ms-g'), W = g.clientWidth || 600, cw = (W - 11 * 4) / 12, ch = Math.max(26, Math.min(44, cw * .74));
      g.style.height = (ch + 4) * 9 + 'px';
      order.forEach((id, i) => { const c = st.cards[id]; if (!c) return; c.style.setProperty('--d', d + 'ms'); c.style.width = cw + 'px'; c.style.height = ch + 'px'; c.style.transform = `translate(${(i % 12) * (cw + 4)}px,${Math.floor(i / 12) * (ch + 4)}px)`; });
    },
    update(el, st, v, api) {
      const g = el.querySelector('#ms-g');
      if (!Object.keys(st.cards).length) {
        v.cards.forEach(c => { const b = document.createElement('button'); b.className = 'cell mover'; b.dataset.id = c.id;
          b.onclick = () => { const p = st.order.indexOf(c.id); if (p >= 0 && !b.disabled) { api.send({ shoot: p }); shot(); K.flash(b); } };
          g.appendChild(b); st.cards[c.id] = b; });
        this.layout(el, st, v.cards.map(c => c.id), 0);
      }
      if (v.phase === 'shuffle' && v.waves && !st.shuffled) {
        st.shuffled = true; K.shake(g);
        v.waves.forEach((w, k) => setTimeout(() => { this.layout(el, st, w, v.wave * .9); tone(200 + k * 80, .2); K.shake(g); }, Math.max(0, v.start + k * v.wave - now())));
      }
      if (v.phase !== 'shuffle') { st.order = v.cards.map(c => c.id); if (v.phase !== 'preview' || !st.laid) { this.layout(el, st, st.order, 0); st.laid = true; } }
      const canShoot = v.phase === 'shoot' && api.part && v.shots[api.me] > 0 && !v.bomb;
      g.classList.toggle('aim', canShoot);
      v.cards.forEach(c => {
        const b = st.cards[c.id]; if (!b) return;
        const shown = c.v !== undefined, own = c.o, bomb = c.k === 'bomb' && v.phase !== 'preview';
        b.className = 'cell mover ' + (shown ? 'face ' + (bomb ? 'bomb' : c.k === 'gold' ? 'gold' : tier(c.v)) : 'back') + (own ? ' own' : '');
        b.style.setProperty('--c', own ? api.color(own) : '');
        b.innerHTML = !shown ? '' : bomb ? 'BOMB' : c.v + 'x';
        b.disabled = !canShoot || !!own;
        if (own && !st.seen[c.id]) {
          st.seen[c.id] = 1; K.flash(b, 'kclaim');
          if (v.phase === 'shoot') { K.popAt(b, bomb ? 'BOMB' : c.k === 'gold' ? 'GOLD +1 shot' : c.v + 'x', { color: bomb ? '#ff8a7a' : api.color(own), kind: c.v >= 50 || bomb ? 'big' : '' });
            K.burstAt(b, bomb ? { kind: 'spark', n: 50, colors: ['#ff5a1a', '#ffd34d', '#fff'], power: 600 } : { n: c.v >= 50 ? 50 : 18, colors: [api.color(own), '#fff', '#ffe58a'] });
            if (bomb) K.shake(el.closest('#box'), true); else if (own === api.me) tone(660 + c.v * 3, .15); }
        }
      });
      const cue = el.querySelector('.kcue');
      K.steps(el.querySelector('.ksteps'), ['Memorise', 'Shuffle', 'Shoot'], { preview: 0, shuffle: 1, shoot: 2, done: 2 }[v.phase]);
      if (v.phase === 'preview') K.cue(cue, 'Memorise the big ones', 'Gold target = a free extra shot. Five targets are bombs in disguise.', 'you');
      else if (v.phase === 'shuffle') K.cue(cue, 'Keep your eyes on them', 'Three shuffles: rows slide, columns swap, then random pairs.', 'you');
      else if (v.phase === 'shoot') K.cue(cue, v.bomb ? 'BOMB: halve a rival' : canShoot ? 'Take your shot' : api.part ? 'Out of shots' : 'Players are shooting', v.bomb ? 'Pick who gets their result halved.' : canShoot ? `${v.shots[api.me]} shot${v.shots[api.me] > 1 ? 's' : ''} left. First hit claims the target.` : 'Watch the gallery fill up', v.bomb || canShoot ? 'you' : 'wait');
      else K.cue(cue, 'Gallery revealed', 'Every target, bombs included', 'info');
      const act = el.querySelector('#ms-act');
      if (v.bomb) {
        if (!act.querySelector('[data-b]')) {
          act.innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<button class="kbig dark" data-b="${p.id}"><span class="kav" style="--c:${p.color}">${esc(p.name.slice(0, 2))}</span> ${esc(p.name)}<small>${v.got[p.id]}x now</small></button>`).join('');
          act.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { api.send({ bomb: b.dataset.b }); K.burstAt(b, { kind: 'spark', n: 40, colors: ['#ff5a1a', '#ffd34d'] }); });
        }
      } else act.innerHTML = '';
      K.board(el.querySelector('#ms-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.halves[p.id] ? v.got[p.id] / Math.pow(2, v.halves[p.id]) : v.got[p.id], sub: v.phase === 'shoot' ? `${v.shots[p.id]} shot${v.shots[p.id] === 1 ? '' : 's'} left` : '', tag: v.halves[p.id] ? 'HALVED' + (v.halves[p.id] > 1 ? ' x' + v.halves[p.id] : '') : '' })));
    }
  };

  // ---------------------------------------------------------------- Trap Setter
  G.traps = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="grid ts" id="ts-g"></div><div class="row" id="ts-act"></div><div id="ts-b"></div>`);
      el.querySelector('#ts-g').onclick = e => { const b = e.target.closest('[data-i]'); if (!b || b.disabled) return; const v = st.v;
        api.send(v.phase === 'trap' ? { trap: +b.dataset.i } : { pick: +b.dataset.i }); tone(v.phase === 'trap' ? 300 : 620, .08); K.flash(b); };
    },
    update(el, st, v, api) {
      st.v = v;
      const g = el.querySelector('#ts-g'), done = v.phase === 'done', locked = v.lock.includes(api.me);
      const can = api.part && (v.phase === 'trap' && !locked || v.phase === 'pick');
      g.classList.toggle('trapping', v.phase === 'trap' && can); g.classList.toggle('picking', v.phase === 'pick' && can);
      g.innerHTML = v.vals.map((x, i) => {
        const trapBy = v.traps ? Object.keys(v.traps).filter(id => v.traps[id].includes(i)) : [];
        const pickBy = v.picks ? Object.keys(v.picks).filter(id => v.picks[id] === i) : [];
        const myTrap = v.myTraps.includes(i), myPick = v.myPick === i, sprung = done && trapBy.some(t => pickBy.some(p => p !== t));
        return `<button class="cell face ${tier(x)} ${myTrap ? 'mytrap' : ''} ${myPick ? 'mine' : ''} ${sprung ? 'sprung' : ''} ${done && !trapBy.length && pickBy.length === 1 ? 'clean' : ''}" data-i="${i}" ${can ? '' : 'disabled'} style="--d:${(i % 6 + Math.floor(i / 6)) * 40}ms">
          <b>${x}x</b><span class="ts-marks">${trapBy.map(id => `<i class="jaw" style="--c:${api.color(id)}"></i>`).join('')}${pickBy.map(id => `<span class="kav" style="--c:${api.color(id)}">${esc(api.name(id).slice(0, 2))}</span>`).join('')}${myTrap && !done ? '<i class="jaw" style="--c:' + api.color(api.me) + '"></i>' : ''}${myPick && !done ? `<span class="kav me" style="--c:${api.color(api.me)}">${esc(api.name(api.me).slice(0, 2))}</span>` : ''}</span></button>`;
      }).join('');
      if (done) g.classList.add('reveal');
      if (done && K.once(st, 'rev')) {
        setTimeout(() => { g.querySelectorAll('.sprung').forEach(c => { K.burstAt(c, { kind: 'spark', n: 30, colors: ['#ff5a1a', '#ffd34d'] }); }); if (g.querySelector('.sprung')) { K.shake(g, true); tone(140, .3); } }, 500);
        setTimeout(() => { const mine = v.res[api.me]; if (mine > 0 && mine >= Math.max(...Object.values(v.res))) K.burstAt(g, { n: 70, up: true }); }, 900);
      }
      K.steps(el.querySelector('.ksteps'), ['Set 2 traps', 'Pick a target', 'Reveal'], { trap: 0, pick: 1, done: 2 }[v.phase]);
      const cue = el.querySelector('.kcue');
      if (v.phase === 'trap') K.cue(cue, !api.part ? 'Players set traps' : locked ? 'Traps locked' : `Set your traps: ${v.myTraps.length}/2`, locked || !api.part ? `Locked: ${v.lock.length}/${api.players.length}` : 'Guess where rivals will go. Each catch steals 3x from them.', locked || !api.part ? 'wait' : 'you');
      else if (v.phase === 'pick') K.cue(cue, v.myPick !== undefined ? 'Target picked' : api.part ? 'Pick your target' : 'Players pick', api.part ? 'Shared targets split. Rival traps cost 3x. Alone and untrapped: +2x.' : `Picked: ${v.picked.length}/${api.players.length}`, v.myPick === undefined && api.part ? 'you' : 'wait');
      else { const r = v.res[api.me]; K.cue(cue, api.part ? `You take ${fx2(r)}x` : 'Traps sprung', api.part ? (v.detail[api.me] || []).join(', ') : '', api.part ? (r > 0 ? 'good' : 'bad') : 'info'); }
      const act = el.querySelector('#ts-act');
      if (v.phase === 'trap' && api.part && !locked) {
        if (!act.querySelector('#ts-lock')) { act.innerHTML = '<button class="kbig" id="ts-lock"></button>'; act.querySelector('#ts-lock').onclick = () => { api.send({ lock: true }); tone(500, .15); }; }
        const b = act.querySelector('#ts-lock'); b.disabled = v.myTraps.length !== 2; b.innerHTML = v.myTraps.length === 2 ? 'Lock traps' : `Place ${2 - v.myTraps.length} more trap${v.myTraps.length === 1 ? '' : 's'}`; b.classList.toggle('pulse', v.myTraps.length === 2);
      } else act.innerHTML = '';
      K.board(el.querySelector('#ts-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me,
        val: done ? v.res[p.id] : null, txt: v.phase === 'trap' ? (v.lock.includes(p.id) ? 'Locked' : 'Trapping') : v.picked.includes(p.id) ? 'Picked' : 'Choosing', sub: done ? (v.detail[p.id] || []).slice(1).join(', ') : '' })));
    }
  };

  // ---------------------------------------------------------------- Limited Ammo Bounty
  G.ammo = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="la-top"><span class="la-ammo"></span><span class="la-hold"></span></div><div class="grid la" id="la-g"></div><div id="la-b"></div>`);
      st.rows = []; st.cells = [];
      el.querySelector('#la-g').onclick = e => { const b = e.target.closest('[data-i]'); if (!b || b.disabled) return; api.send({ shoot: +b.dataset.i }); shot(); K.flash(b, 'kmuzzle'); };
    },
    update(el, st, v, api) {
      const g = el.querySelector('#la-g'), myB = v.bullets[api.me] || 0, cool = v.cool > now(), live = v.phase === 'live';
      const can = live && api.part && myB > 0 && !v.hold[api.me];
      if (!g.children.length) g.innerHTML = v.cells.map((c, i) => `<button class="cell back" data-i="${i}"></button>`).join('');
      g.classList.toggle('aim', can && !cool); g.classList.toggle('cool', can && cool);
      v.cells.forEach((c, i) => {
        const b = g.children[i], key = (c.v !== undefined ? c.v : '?') + ':' + (c.o || '');
        b.disabled = !can || cool || c.o === api.me;
        if (b.dataset.k === key) return;
        const was = b.dataset.k; b.dataset.k = key;
        b.className = 'cell ' + (c.v !== undefined ? 'face ' + tier(c.v) : 'back') + (c.o ? ' own' : '');
        b.style.setProperty('--c', c.o ? api.color(c.o) : ''); b.style.setProperty('--d', (i % v.cols) * 35 + 'ms');
        b.innerHTML = c.v !== undefined ? c.v + 'x' : '';
        if (was !== undefined && was.split(':')[0] === '?' && c.v !== undefined) b.classList.add('kreveal');
        if (was !== undefined && c.o && was.split(':')[1] !== c.o) {
          const stolen = !!was.split(':')[1];
          K.popAt(b, stolen ? 'STOLEN ' + c.v + 'x' : c.v + 'x', { color: api.color(c.o), kind: c.v >= 50 || stolen ? 'big' : '' });
          K.burstAt(b, { n: stolen ? 40 : 20, colors: [api.color(c.o), '#fff', '#ffe58a'] });
          if (stolen && was.split(':')[1] === api.me) K.shake(el.closest('#box'), true);
        }
      });
      el.querySelector('.la-ammo').innerHTML = api.part ? `<span class="la-b">${bullets(myB, 3)}</span>${cool ? '<em>Reloading</em>' : ''}` : '';
      const hold = el.querySelector('.la-hold');
      if (can) { if (!hold.querySelector('button')) { hold.innerHTML = '<button class="btn" id="la-hold"></button>'; hold.querySelector('button').onclick = () => { api.send({ hold: true }); tone(520, .15); }; } hold.querySelector('button').textContent = `Keep ${myB} as Shield${myB > 1 ? 's' : ''}`; }
      else hold.innerHTML = v.hold[api.me] ? '<span class="ktag">Holding</span>' : '';
      if (cool) { clearTimeout(st.t); st.t = setTimeout(() => this.update(el, st, v, api), v.cool - now() + 30); }
      K.steps(el.querySelector('.ksteps'), ['Shoot', 'Final gallery'], live ? 0 : 1);
      const cue = el.querySelector('.kcue');
      if (!live) { const tot = v.totals[api.me]; K.cue(cue, api.part ? `You own ${tot}x` : 'Gallery closed', 'Unused bullets became Shields', api.part ? (tot > 0 ? 'good' : 'bad') : 'info'); }
      else if (can) K.cue(cue, cool ? 'Reloading...' : 'Shoot a target', 'A shot reveals its whole row. Hit a rival\'s target to steal it.', cool ? 'wait' : 'you');
      else K.cue(cue, api.part ? (v.hold[api.me] ? 'Holding your bullets' : 'Out of bullets') : 'Players are shooting', 'Rivals can still steal from you', 'wait');
      K.board(el.querySelector('#la-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.totals[p.id], sub: v.hold[p.id] ? 'holding' : `${v.bullets[p.id]} bullet${v.bullets[p.id] === 1 ? '' : 's'}` })));
    }
  };

  // ---------------------------------------------------------------- Ricochet
  G.ricochet = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<canvas class="gc rc" id="rc-c" width="600" height="800"></canvas><div class="row" id="rc-ctl"><button class="btn" id="rc-l">Left<kbd>A</kbd></button><button class="kbig pulse" id="rc-lock">Lock shot<kbd>Space</kbd></button><button class="btn" id="rc-r">Right<kbd>D</kbd></button></div><div id="rc-b"></div>`);
      const c = el.querySelector('#rc-c'); st.aim = 0; st.sentT = 0; st.anim = {}; st.hitT = {};
      const set = a => { st.aim = Math.max(-75, Math.min(75, a)); const t = performance.now(); if (t - st.sentT > 60) { st.sentT = t; api.send({ aim: st.aim }); } };
      const lock = () => { if (!st.live) return; api.send({ aim: st.aim, lock: true }); tone(700, .15); };
      c.onpointermove = e => { if (!st.live) return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 600, y = (e.clientY - r.top) / r.height * 800; set(Math.atan2(x - RHS.GUN.x, RHS.GUN.y - y) * 180 / Math.PI); };
      c.onclick = lock; el.querySelector('#rc-lock').onclick = lock;
      el.querySelector('#rc-l').onclick = () => set(st.aim - 1.5); el.querySelector('#rc-r').onclick = () => set(st.aim + 1.5);
      st.key = e => { if (!st.live) return; if (e.key === 'a' || e.key === 'ArrowLeft') set(st.aim - (e.shiftKey ? .3 : 1.5)); if (e.key === 'd' || e.key === 'ArrowRight') set(st.aim + (e.shiftKey ? .3 : 1.5)); if (e.code === 'Space') { e.preventDefault(); lock(); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; st.api = api; st.live = v.phase === 'aim' && api.part && !v.locked.includes(api.me);
      if (st.first === undefined && v.aim[api.me] !== undefined) { st.aim = v.aim[api.me]; st.first = 1; }
      el.querySelector('#rc-ctl').hidden = !st.live;
      v.shots.forEach((s, i) => { if (!st.anim[i]) { st.anim[i] = performance.now(); tone(500, .1); if (window.Sfx) Sfx.play('glove-whoosh', { vol: .5 }); } });
      K.steps(el.querySelector('.ksteps'), ['Aim', 'Fire in lock order', 'Results'], { aim: 0, fire: 1, done: 2 }[v.phase]);
      const cue = el.querySelector('.kcue'), cur = v.shots[v.shots.length - 1];
      if (v.phase === 'aim') K.cue(cue, st.live ? 'Aim your shot' : api.part ? 'Locked in' : 'Players are aiming', st.live ? 'Lock early to clear targets first. 3 hits of one colour triple your best.' : `Fire order: ${v.order.map(api.name).join(', ') || 'nobody yet'}`, st.live ? 'you' : 'wait');
      else if (v.phase === 'fire' && cur) K.cue(cue, `${cur.id === api.me ? 'Your' : api.name(cur.id) + "'s"} shot`, 'Bouncing through the targets...', 'info');
      else if (v.res) K.cue(cue, api.part ? `You take ${v.res[api.me]}x` : 'All shots fired', '', api.part ? (v.res[api.me] > 0 ? 'good' : 'bad') : 'info');
      K.board(el.querySelector('#rc-b'), api.players.map(p => { const s = v.shots.find(x => x.id === p.id), seen = s && st.anim[v.shots.indexOf(s)] && performance.now() - st.anim[v.shots.indexOf(s)] > v.shotMs * .8;
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: seen ? s.best : null, txt: v.locked.includes(p.id) ? '#' + (v.order.indexOf(p.id) + 1) + ' locked' : 'aiming', tag: seen && s.combo ? 'COMBO' : '' }; }));
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    frame(el, st) {
      const v = st.v, api = st.api; if (!v) return;
      const c = el.querySelector('#rc-c'); if (!c) return; const x = c.getContext('2d'), t = performance.now();
      const bg = x.createLinearGradient(0, 0, 0, 800); bg.addColorStop(0, '#0f3a2a'); bg.addColorStop(1, '#061a10'); x.fillStyle = bg; x.fillRect(0, 0, 600, 800);
      x.strokeStyle = '#e6c673'; x.lineWidth = 5; x.strokeRect(2.5, 2.5, 595, 830);
      // Which targets are already gone in the current animation
      const gone = new Set(); v.shots.forEach((s, i) => { const t0 = st.anim[i]; if (!t0) return; const p = Math.min(1, (t - t0) / (v.shotMs * .8)); s.hits.forEach((h, k) => { if (p >= (k + 1) / (s.hits.length + 1) || p >= 1) gone.add(h); }); });
      for (const tg of v.targets) {
        if (tg.gone && !v.shots.some(s => s.hits.includes(tg.id))) continue;
        if (gone.has(tg.id)) { if (!st.hitT[tg.id]) { st.hitT[tg.id] = t; const [px, py] = K.canvasPt(c, tg.x, tg.y, 600, 800); K.burst(px, py, { kind: 'spark', n: 18, colors: [COL[tg.c], '#fff'] }); K.pop(px, py, tg.v + 'x', { color: COL[tg.c] }); tone(500 + tg.v * 10, .06); } continue; }
        const big = tg.v >= 25, R = RHS.TR;
        x.save(); if (big) { x.shadowColor = COL[tg.c]; x.shadowBlur = 12 + 6 * Math.sin(t / 200 + tg.id); }
        const g = x.createRadialGradient(tg.x - R * .35, tg.y - R * .4, 2, tg.x, tg.y, R);
        g.addColorStop(0, '#fff'); g.addColorStop(.3, COL[tg.c]); g.addColorStop(1, '#0008');
        x.beginPath(); x.arc(tg.x, tg.y, R, 0, RH.TAU); x.fillStyle = COL[tg.c]; x.fill(); x.fillStyle = g; x.fill(); x.restore();
        x.lineWidth = 2.5; x.strokeStyle = '#fffa'; x.stroke();
        x.fillStyle = '#fff'; x.shadowColor = '#000'; x.shadowBlur = 3; RH.heft(x, big ? 17 : 15, 2.5); x.textAlign = 'center'; x.textBaseline = 'middle'; RH.htext(x, tg.v, tg.x, tg.y + 1); x.shadowBlur = 0;
      }
      if (v.phase === 'aim') {
        for (const p of api.players) {
          const mine = p.id === api.me, a = mine && st.live ? st.aim : v.aim[p.id];
          const tr = RHS.trace(a, v.targets, 99, mine ? 1 : 0), pts = tr.pts;
          x.save(); x.strokeStyle = p.color; x.globalAlpha = mine ? .95 : .45; x.lineWidth = mine ? 3.5 : 2; x.setLineDash(v.locked.includes(p.id) ? [] : [10, 8]); x.lineDashOffset = -t / 30;
          if (mine) { x.shadowColor = p.color; x.shadowBlur = 10; }
          x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(px, py) : x.moveTo(px, py)); x.stroke(); x.restore();
          if (mine) for (const h of tr.hits.slice(0, 3)) { const tg = v.targets[h]; x.beginPath(); x.arc(tg.x, tg.y, RHS.TR + 5, 0, RH.TAU); x.strokeStyle = '#fff'; x.lineWidth = 2; x.stroke(); }
        }
      }
      v.shots.forEach((s, i) => {
        const t0 = st.anim[i]; if (!t0) return;
        const p = Math.min(1, (t - t0) / (v.shotMs * .8)), pts = s.pts, col = api.color(s.id);
        let len = 0; const seg = []; for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); seg.push(d); len += d; }
        let left = len * p; x.save(); x.strokeStyle = col; x.lineWidth = 4; x.shadowColor = col; x.shadowBlur = 14; x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); let bx = pts[0][0], by = pts[0][1];
        for (let k = 1; k < pts.length && left > 0; k++) { const f = Math.min(1, left / seg[k - 1]); bx = pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f; by = pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f; x.lineTo(bx, by); left -= seg[k - 1]; }
        x.globalAlpha = i === v.shots.length - 1 ? 1 : .25; x.stroke(); x.restore();
        if (p < 1) { x.save(); x.shadowColor = '#fff'; x.shadowBlur = 20; x.beginPath(); x.arc(bx, by, 8, 0, RH.TAU); x.fillStyle = '#fff'; x.fill(); x.restore(); }
        else if (i === v.shots.length - 1) { K.glowText(x, `${api.name(s.id)}: ${s.best}x`, 300, 690, 34, s.combo ? '#ffe58a' : '#fff'); if (s.combo) K.glowText(x, 'SAME COLOUR COMBO x3', 300, 730, 20, '#ffe58a'); }
      });
      // Gun
      x.save(); x.translate(RHS.GUN.x, RHS.GUN.y); if (v.phase === 'aim' && st.live) x.rotate(st.aim * Math.PI / 180);
      x.fillStyle = '#c9a14a'; x.fillRect(-6, -40, 12, 40); x.restore();
      x.save(); x.translate(RHS.GUN.x, RHS.GUN.y); x.beginPath(); x.arc(0, 0, 20, 0, RH.TAU); x.fillStyle = RH.metal(x, 1); x.fill(); x.restore();
    }
  };
})();
