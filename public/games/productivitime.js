'use strict';
// Productivitime renderers: Flapper Draft, Paint the Wheel, Push Your Luck, Brake Battle
(() => {
  const { G, esc, fx2, now, tone, segWheel, spinPos, secs, K } = RH;
  const wheelCanvas = (id, w = 'min(440px,84vw,max(200px,calc(100dvh - 430px)))') => `<canvas class="gc wheel" id="${id}" width="640" height="640" style="width:${w}"></canvas>`;
  const SEGC = v => v === 'DOUBLE' ? '#c9961e' : v === 'TRIPLE' ? '#7a3fc0' : v === 'BUST' ? '#d01818' : v >= 100 ? '#0d7558' : v >= 50 ? '#b65f30' : v >= 20 ? '#1c4f9e' : v >= 5 ? '#4a2a18' : '#3d2013';
  const label = v => typeof v === 'number' ? v + 'x' : v === 'DOUBLE' ? 'x2' : v === 'TRIPLE' ? 'x3' : v;
  const PUSHC = { 1.5: '#3d2013', 2: '#5a3018', 3: '#1c4f9e', 5: '#0d7558', 10: '#b65f30', 25: '#c9961e', BUST: '#d01818' };
  const FCOL = ['#2fbf5a', '#3a8ee8', '#f2c230', '#a35ae8'];
  const lastSpin = v => v.spins && v.spins[v.spins.length - 1];
  const curRot = (v, n) => { const s = lastSpin(v); return s ? spinPos(s, n, now()) : v.top; };
  const spinning = v => { const s = lastSpin(v); return s && now() < s.at + s.dur; };
  const segAt = (c, e, rot, n) => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640 - 320, y = (e.clientY - r.top) / r.height * 640 - 320; if (Math.hypot(x, y) < 70 || Math.hypot(x, y) > 285) return -1; const a = Math.atan2(y, x) + Math.PI / 2; return ((Math.round(a / (RH.TAU / n) + rot) % n) + n) % n; };
  // Screen point of a segment's outer label on a wheel canvas
  const segPt = (c, i, rot, n) => { const a = (i - rot) * RH.TAU / n - Math.PI / 2; return K.canvasPt(c, 320 + Math.cos(a) * 230, 320 + Math.sin(a) * 230, 640, 640); };
  const spinSfx = (d = 5000) => { if (window.Sfx) Sfx.play('wheel-spin-mechanical', { vol: .45, dur: d * .92, fadeOut: d * .55 }); };

  // ---------------------------------------------------------------- Flapper Draft
  G.draft = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="fd-cards" id="fd-cards"></div><div class="row" id="fd-act"></div><div class="kstage">${wheelCanvas('fd-c')}</div><div id="fd-b"></div>`);
      el.querySelector('#fd-cards').onclick = e => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) { api.send({ flapper: +b.dataset.k }); tone(600, .1); K.burstAt(b, { n: 20, colors: [FCOL[+b.dataset.k], '#fff'] }); } };
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const myTurn = v.phase === 'draft' && v.turn === api.me, who = k => Object.keys(v.pick).filter(id => v.pick[id] === k);
      el.querySelector('#fd-cards').innerHTML = v.names.map((n, k) => { const w = who(k), mine = v.pick[api.me] === k;
        return `<button class="fd-card ${mine ? 'sel' : ''} ${myTurn ? 'can' : ''}" data-k="${k}" style="--c:${FCOL[k]}" ${myTurn ? '' : 'disabled'}>
          <span class="fd-flap"></span><b>${n}</b><span class="fd-who">${w.map(id => `<span class="kav" style="--c:${api.color(id)}">${esc(api.name(id).slice(0, 2))}</span>`).join('') || '<em>empty: +50% if alone</em>'}</span>
          ${v.jammed && v.jammed[k] ? `<span class="fd-jam">JAM +${v.jammed[k]}</span>` : ''}${v.factor[k] > 1 ? `<span class="fd-x">x${v.factor[k]}</span>` : ''}<span class="fd-val">${v.value[k] !== null ? v.value[k] + 'x' : ''}</span></button>`; }).join('');
      for (let k = 0; k < 4; k++) if (v.value[k] !== null && K.once(st, 'v' + k)) { const b = el.querySelector(`.fd-card[data-k="${k}"]`); K.popAt(b, v.value[k] + 'x', { color: FCOL[k], kind: v.value[k] >= 100 ? 'big' : '' }); if (v.pick[api.me] === k) K.burstAt(b, { n: 40, up: true }); }
      const n = v.spins.length; if (n && K.once(st, 's' + n)) spinSfx(lastSpin(v).dur);
      const act = el.querySelector('#fd-act'), cue = el.querySelector('.kcue');
      K.steps(el.querySelector('.ksteps'), ['Draft', 'Jam', 'Spin'], { draft: 0, jam: 1, spin: 2, done: 2 }[v.phase]);
      if (v.phase === 'draft') K.cue(cue, myTurn ? 'Pick your flapper' : `${api.name(v.turn)} is picking`, myTurn ? 'Share a flapper and you split it. Alone: +50%.' : `Pick order: ${v.order.map(api.name).join(', ')}. Lowest balance first.`, myTurn ? 'you' : 'wait');
      else if (v.phase === 'jam') K.cue(cue, api.part && !v.jamUsed ? 'Jam a rival?' : 'Jams are being played', api.part && !v.jamUsed ? 'Their flapper reads 1 segment further. Shields block it.' : '', api.part && !v.jamUsed ? 'you' : 'wait');
      else if (v.phase === 'spin') K.cue(cue, spinning(v) ? 'Spinning...' : 'Reading the flappers', n > 1 ? `Respin ${n - 1}: DOUBLE and TRIPLE spin again` : '', 'info');
      else { const k = v.pick[api.me]; K.cue(cue, k !== undefined ? `${v.names[k]} pays ${v.value[k]}x` : 'Draft settled', 'Shared flappers split, alone +50%', 'good'); }
      if (v.phase === 'jam' && api.part && !v.jamUsed) {
        if (!act.querySelector('[data-j]')) {
          act.innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<button class="kchip" data-j="${p.id}" style="--c:${p.color}">Jam ${esc(p.name)} (${v.names[v.pick[p.id]]})</button>`).join('') + '<button class="btn" data-pass="1">Keep it</button>';
          act.querySelectorAll('button').forEach(b => b.onclick = () => { api.send(b.dataset.pass ? { pass: true } : { jam: b.dataset.j }); tone(300, .15); });
        }
      } else act.innerHTML = '';
      if (myTurn && K.once(st, 'turn')) tone(700, .2);
      K.board(el.querySelector('#fd-b'), api.players.map(p => { const k = v.pick[p.id], sh = k !== undefined ? who(k).length : 0;
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, turn: p.id === v.turn && v.phase === 'draft', val: v.phase === 'done' && k !== undefined ? (v.value[k] || 0) / sh * (sh === 1 ? 1.5 : 1) : null, txt: k !== undefined ? v.names[k] : 'waiting', sub: k !== undefined ? (sh > 1 ? `split ${sh} ways` : 'alone +50%') : '' }; }), { pops: false });
    },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#fd-c'); if (!v || !c) return;
      const n = v.segs.length, rot = curRot(v, n), sp = lastSpin(v), done = sp && now() > sp.at + sp.dur;
      K.wheelTick(st, rot, spinning(v));
      segWheel(c.getContext('2d'), { segs: v.segs, rot, fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]),
        ring: i => { if (!done || !sp) return null; const k = Object.keys(sp.reads).find(k => sp.reads[k] === i); return k !== undefined ? FCOL[k] : null; },
        flappers: v.off.map((o, k) => ({ off: o, color: FCOL[k], label: Object.keys(v.pick).filter(id => v.pick[id] === k).map(id => api.name(id).slice(0, 5)).join('+') })) });
    }
  };

  // ---------------------------------------------------------------- Paint the Wheel
  G.paint = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="pt-ink"></div><div class="kstage">${wheelCanvas('pt-c')}</div><div id="pt-b"></div>`);
      const c = el.querySelector('#pt-c');
      c.onpointermove = e => { const v = st.v; st.hov = v && v.phase === 'paint' ? segAt(c, e, v.top, v.segs.length) : -1; };
      c.onpointerleave = () => st.hov = -1;
      c.onclick = e => { const v = st.v; if (!v || v.phase !== 'paint' || !api.part) return; const i = segAt(c, e, v.top, v.segs.length); if (i < 0) return;
        if (typeof v.segs[i] !== 'number') { RH.toast('DOUBLE and TRIPLE cannot be painted.', 1500); return; }
        const cost = v.owner[i] && v.owner[i] !== api.me ? 2 : 1; if (v.owner[i] === api.me) return; if ((v.points[api.me] || 0) < cost) { RH.toast('Not enough paint left.', 1500); K.shake(el.querySelector('.pt-ink')); return; }
        api.send({ paint: i }); tone(560 + i * 4, .06); const [x, y] = segPt(c, i, v.top, v.segs.length); K.burst(x, y, { n: 14, colors: [api.color(api.me), '#fff'], power: 260 }); };
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const pts = v.points[api.me] || 0, n = v.spins.length;
      el.querySelector('.pt-ink').innerHTML = v.phase === 'paint' && api.part ? `<span>Paint</span>${Array.from({ length: v.budget }, (_, i) => `<i class="${i < pts ? 'on' : ''}" style="--c:${api.color(api.me)}"></i>`).join('')}<small>free 1, rival 2</small>` : v.mul > 1 ? `<b class="pt-mul">All segments x${v.mul}</b>` : '';
      if (n && K.once(st, 's' + n)) spinSfx(lastSpin(v).dur);
      if (v.mul > 1 && K.once(st, 'm' + v.mul)) { K.burstAt(el.querySelector('#pt-c'), { n: 60, colors: ['#ffe58a', '#a35ae8', '#fff'] }); K.popAt(el.querySelector('#pt-c'), `JACKPOT x${v.mul}`, { kind: 'big' }); }
      // Score pops when a spin settles
      for (const p of api.players) { const k = 'r' + p.id + ':' + v.res[p.id]; if (v.res[p.id] > 0 && K.once(st, k)) { const c = el.querySelector('#pt-c'), [x, y] = segPt(c, v.top, v.top, v.segs.length); K.pop(x, y - 20, `${p.name} +`, { color: p.color }); } }
      K.steps(el.querySelector('.ksteps'), ['Paint segments', 'Spin 3 times'], v.phase === 'paint' ? 0 : 1);
      const cue = el.querySelector('.kcue');
      if (v.phase === 'paint') K.cue(cue, !api.part ? 'Players are painting' : pts ? `Paint the wheel: ${pts} left` : 'Out of paint', api.part && pts ? 'Click segments to claim them. The landing segment pays its owner, neighbours get half.' : 'Waiting for the others', api.part && pts ? 'you' : 'wait');
      else if (v.phase === 'spin') K.cue(cue, spinning(v) ? `Spin ${Math.min(3, v.scored + 1)} of 3` : 'Collecting', v.mul > 1 ? `Every segment x${v.mul}` : 'DOUBLE or TRIPLE: multiply and spin free', 'info');
      else K.cue(cue, api.part ? `You collect ${fx2(v.res[api.me])}x` : 'Painting done', '', api.part && v.res[api.me] > 0 ? 'good' : 'info');
      K.board(el.querySelector('#pt-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.res[p.id], sub: `${v.owner.filter(o => o === p.id).length} segments${v.phase === 'paint' ? ', ' + v.points[p.id] + ' paint' : ''}` })));
    },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#pt-c'); if (!v || !c) return;
      const n = v.segs.length, rot = curRot(v, n), sp = lastSpin(v), done = sp && now() > sp.at + sp.dur;
      K.wheelTick(st, rot, spinning(v));
      const nb = i => done && v.phase !== 'paint' && (i === (v.top + 1) % n || i === (v.top + n - 1) % n);
      segWheel(c.getContext('2d'), { segs: v.segs, rot, hub: v.mul > 1 ? 'x' + v.mul : '',
        fill: i => v.owner[i] ? api.color(v.owner[i]) : typeof v.segs[i] === 'number' ? (i % 2 ? '#2c1a12' : '#3a2418') : SEGC(v.segs[i]),
        text: i => typeof v.segs[i] === 'number' ? v.segs[i] * v.mul + '' : label(v.segs[i]),
        ring: i => i === st.hov && v.phase === 'paint' ? '#ffffff' : done && v.phase !== 'paint' && i === v.top ? '#ffe58a' : nb(i) ? '#ffe58a88' : null, flappers: [{ off: 0, color: '#f4ecd8' }] });
    }
  };

  // ---------------------------------------------------------------- Push Your Luck
  G.push = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="pl-wrap"><div class="kstage">${wheelCanvas('pl-c', 'min(380px,78vw,max(200px,calc(100dvh - 500px)))')}</div><div class="pl-side"><div class="pl-risk"></div><div class="pl-pot"></div></div></div><div class="row" id="pl-act"></div><div id="pl-b"></div>`);
    },
    update(el, st, v, api) {
      st.v = v;
      const act = el.querySelector('#pl-act'), mine = v.mine, inn = v.inn[api.me], busts = v.segs.filter(s => s === 'BUST').length, my = v.r[api.me] || 0;
      if (v.spins.length && K.once(st, 's' + v.spins.length)) spinSfx(lastSpin(v).dur);
      if (v.n && !spinning(v) && K.once(st, 'r' + v.n + v.bust)) {
        const c = el.querySelector('#pl-c');
        if (v.bust) { K.flash(el.closest('#box'), 'kbust'); K.shake(el.closest('#box'), true); K.popAt(c, 'BUST', { kind: 'big bad', size: 72 }); K.burstAt(c, { kind: 'spark', n: 80, colors: ['#ff3a3a', '#ff8a2a', '#000'], power: 700 }); if (window.Sfx) Sfx.play('loss', { vol: .8 }); }
        else { const s = v.segs[v.top]; K.popAt(c, 'x' + s, { kind: 'big', color: '#7dffb0' }); if (inn) K.burstAt(c, { n: 30, colors: ['#4fd68a', '#ffe58a', '#fff'] }); tone(700 + s * 30, .15); }
      }
      el.querySelector('.pl-risk').innerHTML = `<small>Bust risk next spin</small><b class="${busts > 1 ? 'hot' : ''}">${(busts / v.segs.length * 100).toFixed(1)}%</b><span>${busts} BUST of ${v.segs.length}</span>`;
      el.querySelector('.pl-pot').innerHTML = api.part ? `<small>${inn ? 'Riding on' : my ? 'Cashed out' : 'Out'}</small><b>${fx2(my)}x</b><span>Spin ${v.n} of ${v.max}</span>` : `<small>Spin</small><b>${v.n}/${v.max}</b>`;
      const k = `${v.phase}:${v.n}:${mine && mine.choice}:${mine && mine.curse}:${inn}`;
      if (act.dataset.k !== k) { act.dataset.k = k; act.innerHTML = '';
        if (v.phase === 'decide' && api.part) {
          if (inn) {
            act.innerHTML = `<button class="kbig ${mine.choice === 'stay' ? 'sel' : 'pulse'}" data-c="stay">Stay in<small>spin again</small></button><button class="kbig dark ${mine.choice === 'cash' ? 'sel' : ''}" data-c="cash">Cash out<small>lock ${fx2(my)}x</small></button>
              <button class="kchip ${mine.curse ? 'on' : ''}" id="pl-cu" style="--c:#d01818" title="Only when you cash out">Curse: +1 BUST for those who stay (costs 25%)</button>`;
            act.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { api.send({ choice: b.dataset.c, curse: !!st.curse }); tone(b.dataset.c === 'stay' ? 700 : 500, .12); });
            const cu = act.querySelector('#pl-cu'); st.curse = mine.curse; cu.onclick = () => { st.curse = !st.curse; cu.classList.toggle('on', st.curse); if (mine.choice) api.send({ choice: mine.choice, curse: st.curse }); };
          } else if (my > 0) {
            act.innerHTML = `<button class="kbig ${mine.curse ? 'sel red' : 'dark'}" id="pl-curse">${mine.curse ? 'Curse bought' : 'Curse the wheel'}<small>${mine.curse ? 'click to undo' : 'pay 25%, add 1 BUST'}</small></button>`;
            el.querySelector('#pl-curse').onclick = () => { api.send({ curse: !mine.curse }); tone(200, .2); };
          }
        }
      }
      K.steps(el.querySelector('.ksteps'), ['Spin 1', 'Spin 2', 'Spin 3'], Math.max(0, v.n - 1));
      const cue = el.querySelector('.kcue');
      if (v.phase === 'decide' && api.part && inn) K.cue(cue, mine.choice ? (mine.choice === 'stay' ? 'You stay in' : 'You cash out') : 'Stay or cash out?', `Decided: ${v.decided.length}. Hidden until everyone chooses.`, mine.choice ? 'wait' : 'you');
      else if (v.phase === 'decide') K.cue(cue, 'Players are deciding', my > 0 ? 'Curse the wheel to hurt the players still in' : '', my > 0 ? 'you' : 'wait');
      else if (v.phase === 'done') K.cue(cue, v.bust ? 'BUST' : 'Final spin done', v.bust ? 'Everyone still in drops to 0' : '', v.bust ? 'bad' : 'good');
      else K.cue(cue, spinning(v) ? 'Spinning...' : `Spin ${v.n} of ${v.max}`, `BUST chance ${(busts / v.segs.length * 100).toFixed(1)}%`, 'info');
      K.board(el.querySelector('#pl-b'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.r[p.id], sub: v.inn[p.id] ? 'still in' : v.r[p.id] ? 'cashed out' : 'out', out: !v.inn[p.id] && !v.r[p.id], tag: v.decided.includes(p.id) && v.phase === 'decide' ? 'DECIDED' : '' })));
    },
    frame(el, st) {
      const v = st.v, c = el.querySelector('#pl-c'); if (!v || !c) return;
      const n = v.segs.length, sp = lastSpin(v), done = sp && now() > sp.at + sp.dur, rot = curRot(v, n);
      K.wheelTick(st, rot, spinning(v));
      segWheel(c.getContext('2d'), { segs: v.segs, rot, fill: i => PUSHC[v.segs[i]] || '#3d2013', text: i => label(v.segs[i]), ring: i => done && i === v.top ? (v.segs[i] === 'BUST' ? '#ff3a3a' : '#ffe58a') : v.curses.includes(i) ? '#ff3a3a66' : null, flappers: [{ off: 0, color: '#f4ecd8' }] });
    }
  };

  // ---------------------------------------------------------------- Brake Battle
  G.brake = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div class="kstage">${wheelCanvas('bb-c', 'min(440px,84vw,max(200px,calc(100dvh - 480px)))')}<div class="bb-speed"><i></i></div></div><div class="row"><button class="kbig red pulse" id="bb-b">BRAKE<kbd>Space</kbd></button></div><div id="bb-b2"></div>`);
      const press = () => { const b = el.querySelector('#bb-b'); if (b.hidden || b.disabled) return; api.send({ brake: true }); tone(180, .3, .1); if (window.Sfx) Sfx.play('glove-slam', { vol: .5 }); K.shake(el.querySelector('#bb-c')); };
      el.querySelector('#bb-b').onclick = press;
      st.key = e => { if (e.code === 'Space' && document.getElementById('bb-b')) { e.preventDefault(); press(); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; st.api = api; if (!st.w) st.w = { a: v.a, w: 0, t: now() };
      const b = el.querySelector('#bb-b');
      b.hidden = !api.part || !!v.pressed[api.me] || v.phase === 'done'; b.disabled = v.phase !== 'live';
      for (const id of Object.keys(v.pressed)) if (K.once(st, 'p' + id)) { if (id !== api.me) K.popAt(el.querySelector('#bb-c'), `${api.name(id)} brakes!`, { color: api.color(id) }); }
      if (v.phase === 'done' && v.result && K.once(st, 'done')) { const r = v.result[api.me]; if (r !== undefined && r >= Math.max(...Object.values(v.result))) K.burstAt(el.querySelector('#bb-c'), { n: 70, up: true }); }
      K.steps(el.querySelector('.ksteps'), ['Get ready', 'Brake', 'Read your flapper'], v.phase === 'lead' ? 0 : v.phase === 'live' ? 1 : 2);
      const cue = el.querySelector('.kcue');
      if (v.phase === 'lead') K.cue(cue, `Starts in ${secs(v.t0)}`, 'One brake each: it halves the speed. Watch your flapper.', api.part ? 'you' : 'wait');
      else if (v.phase === 'live') K.cue(cue, !api.part ? 'Brake Battle' : v.pressed[api.me] ? 'Brake used' : 'Time your brake', v.pressed[api.me] ? 'Hope it stops on something good' : 'Stop the wheel on DOUBLE with your press: free Shield', !api.part || v.pressed[api.me] ? 'wait' : 'you');
      else K.cue(cue, v.stopBy ? `${api.name(v.stopBy)}'s brake stops it` : 'It stopped on its own', api.part && v.result ? `Your flapper reads ${v.result[api.me]}x` : '', api.part && v.result ? 'good' : 'info');
      K.board(el.querySelector('#bb-b2'), api.players.map(p => ({ id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: v.result ? v.result[p.id] : null, txt: v.pressed[p.id] ? 'braked' : 'ready', tag: v.stopBy === p.id ? 'STOPPER' : '' })), { pops: false });
      if (v.phase === 'done') { removeEventListener('keydown', st.key); st.w = { a: v.a, w: 0, t: now() }; }
    },
    fx(el, st, d) { if (d.w) st.w = d.w; },
    frame(el, st) {
      const v = st.v, api = st.api, c = el.querySelector('#bb-c'); if (!v || !c || !st.w) return;
      const k = v.c0 / v.c1, tau = Math.max(0, (now() - st.w.t) / 1000);
      let a = st.w.a, w = 0;
      if (st.w.w > 0) { const tstop = Math.log((st.w.w + k) / (2 + k)) / v.c1, T = Math.min(tau, Math.max(0, tstop)); a += (st.w.w + k) * (1 - Math.exp(-v.c1 * T)) / v.c1 - k * T; w = (st.w.w + k) * Math.exp(-v.c1 * T) - k; }
      const sp = el.querySelector('.bb-speed i'); if (sp) sp.style.width = Math.max(0, Math.min(100, w / 110 * 100)) + '%';
      const n = v.segs.length, fl = api.players.map(p => ({ off: v.off[p.id], color: p.color, label: api.name(p.id).slice(0, 6) }));
      K.wheelTick(st, a, v.phase === 'live');
      if (v.phase === 'lead') { segWheel(c.getContext('2d'), { segs: v.segs, rot: a, fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]), flappers: fl }); K.bigCount(c.getContext('2d'), Math.max(0, (v.t0 - now()) / 1000), 320, 320, 150); return; }
      segWheel(c.getContext('2d'), { segs: v.segs, rot: a, fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]), flappers: fl,
        ring: i => { if (v.phase !== 'done') return null; const p = api.players.find(p => ((Math.round(a) + v.off[p.id]) % n + n) % n === i); return p ? p.color : null; } });
    }
  };
})();
