'use strict';
// Productivitime renderers: Flapper Draft, Paint the Wheel, Push Your Luck, Brake Battle
(() => {
  const { G, esc, fx2, now, tone, segWheel, spinPos, secs } = RH;
  const wheelCanvas = (id, w = 'min(460px,86vw,max(200px,calc(100dvh - 360px)))') => `<canvas class="gc" id="${id}" width="640" height="640" style="width:${w}"></canvas>`;
  const SEGC = v => v === 'DOUBLE' ? '#c9a14a' : v === 'TRIPLE' ? '#7a3fc0' : v === 'BUST' ? '#d01818' : v >= 100 ? '#0d7558' : v >= 50 ? '#b65f30' : v >= 20 ? '#1c4f9e' : '#3d2013';
  const label = v => typeof v === 'number' ? v + 'x' : v === 'DOUBLE' ? 'x2' : v === 'TRIPLE' ? 'x3' : v;
  const FCOL = ['#2fbf5a', '#3a8ee8', '#f2c230', '#a35ae8'];
  const curRot = (v, n) => { const s = v.spins && v.spins[v.spins.length - 1]; return s ? spinPos(s, n, now()) : v.top; };
  const segAt = (c, e, rot, n) => { const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * 640 - 320, y = (e.clientY - r.top) / r.height * 640 - 320; if (Math.hypot(x, y) < 70 || Math.hypot(x, y) > 290) return -1; const a = Math.atan2(y, x) + Math.PI / 2; return ((Math.round(a / (RH.TAU / n) + rot) % n) + n) % n; };
  const tickSound = st => { };

  G.draft = {
    mount(el) { el.innerHTML = `<p class="note" id="fd-note"></p>${wheelCanvas('fd-c')}<div class="row" id="fd-act"></div><div class="row" id="fd-vals"></div>`; },
    update(el, st, v, api) {
      st.v = v;
      const act = el.querySelector('#fd-act'), note = el.querySelector('#fd-note');
      act.innerHTML = '';
      if (v.phase === 'draft') {
        note.textContent = `Order: ${v.order.map(api.name).join(', ')}.${v.turn ? ' ' + api.name(v.turn) + ' picks.' : ''}`;
        if (v.turn === api.me) {
          act.innerHTML = v.names.map((n, k) => `<button class="btn" data-k="${k}" style="box-shadow:inset 0 0 0 3px ${FCOL[k]}">${n}<small class="note">${Object.keys(v.pick).filter(id => v.pick[id] === k).length} on it</small></button>`).join('');
          act.querySelectorAll('[data-k]').forEach(b => b.onclick = () => api.send({ flapper: +b.dataset.k }));
          if (!st.beep) { st.beep = 1; tone(700, .2); }
        }
      } else if (v.phase === 'jam') {
        note.textContent = 'Jam: a rival\'s flapper reads 1 segment further.';
        if (api.part && !v.jamUsed) {
          act.innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<button class="btn" data-j="${p.id}"><span class="pdot" style="--c:${p.color}"></span>Jam ${esc(p.name)} (${v.names[v.pick[p.id]]})</button>`).join('') + '<button class="btn" data-pass="1">Keep it</button>';
          act.querySelectorAll('button').forEach(b => b.onclick = () => api.send(b.dataset.pass ? { pass: true } : { jam: b.dataset.j }));
        }
      } else note.textContent = v.phase === 'spin' ? 'Spinning...' : 'Done. Shared split, alone +50%.';
      el.querySelector('#fd-vals').innerHTML = v.names.map((n, k) => {
        const who = Object.keys(v.pick).filter(id => v.pick[id] === k);
        return `<span class="bp" style="--c:${FCOL[k]}"><i></i>${n}: ${who.map(api.name).join(', ') || 'empty'}${v.jammed && v.jammed[k] ? ` JAM +${v.jammed[k]}` : ''}${v.factor[k] > 1 ? ' x' + v.factor[k] : ''} ${v.value[k] !== null ? '= ' + v.value[k] + 'x' : ''}</span>`;
      }).join('');
    },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#fd-c'); if (!v || !c) return;
      const n = v.segs.length, rot = curRot(v, n), sp = v.spins[v.spins.length - 1];
      const done = sp && now() > sp.at + sp.dur;
      segWheel(c.getContext('2d'), { segs: v.segs, rot, fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]),
        ring: i => done && sp && Object.values(sp.reads).includes(i) ? '#fff' : null,
        flappers: v.off.map((o, k) => ({ off: o, color: FCOL[k], label: Object.keys(v.pick).filter(id => v.pick[id] === k).map(id => api.name(id).slice(0, 5)).join('+') })) });
    }
  };

  G.paint = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="pt-note"></p>${wheelCanvas('pt-c')}<div class="row" id="pt-act"></div>`;
      const c = el.querySelector('#pt-c');
      c.onclick = e => { const v = st.v; if (!v || v.phase !== 'paint' || !api.part) return; const i = segAt(c, e, v.top, v.segs.length); if (i >= 0) { api.send({ paint: i }); tone(560, .06); } };
    },
    update(el, st, v, api) {
      st.v = v;
      el.querySelector('#pt-note').textContent = v.phase === 'paint' ? `Click to paint. Points: ${v.points[api.me] || 0}/${v.budget}. Free 1, rival's 2.` : v.phase === 'spin' ? `Spin ${Math.min(3, v.scored + 1)}/3${v.mul > 1 ? ', x' + v.mul : ''}` : 'Done.';
      el.querySelector('#pt-act').innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)} ${v.owner.filter(o => o === p.id).length} segs, ${fx2(v.res[p.id])}x</span>`).join('');
    },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#pt-c'); if (!v || !c) return;
      const n = v.segs.length, rot = curRot(v, n), sp = v.spins[v.spins.length - 1], done = sp && now() > sp.at + sp.dur;
      segWheel(c.getContext('2d'), { segs: v.segs, rot, hub: v.mul > 1 ? 'x' + v.mul : '',
        fill: i => v.owner[i] ? api.color(v.owner[i]) : typeof v.segs[i] === 'number' ? '#2c1a12' : SEGC(v.segs[i]),
        text: i => typeof v.segs[i] === 'number' ? v.segs[i] * v.mul + '' : label(v.segs[i]),
        ring: i => done && i === v.top ? '#fff' : null, flappers: [{ off: 0, color: '#f4ecd8' }] });
    }
  };

  G.push = {
    mount(el) { el.innerHTML = `<p class="note" id="pl-note"></p>${wheelCanvas('pl-c', 'min(400px,80vw,max(200px,calc(100dvh - 470px)))')}<div class="row" id="pl-act"></div><table class="res" id="pl-t"></table>`; },
    update(el, st, v, api) {
      st.v = v;
      const act = el.querySelector('#pl-act'), mine = v.mine, inn = v.inn[api.me];
      act.innerHTML = '';
      if (v.phase === 'decide' && api.part) {
        if (inn) {
          act.innerHTML = `<button class="btn go ${mine.choice === 'stay' ? 'sel' : ''}" data-c="stay">Stay</button><button class="btn ${mine.choice === 'cash' ? 'sel' : ''}" data-c="cash">Cash out ${fx2(v.r[api.me])}x</button><label class="note chk"><input type="checkbox" id="pl-cu" ${mine.curse ? 'checked' : ''}> + Curse (25%)</label>`;
          act.querySelectorAll('[data-c]').forEach(b => b.onclick = () => api.send({ choice: b.dataset.c, curse: el.querySelector('#pl-cu').checked }));
        } else if (v.r[api.me] > 0) {
          act.innerHTML = `<button class="btn ${mine.curse ? 'sel' : ''}" id="pl-curse">${mine.curse ? 'Curse bought (undo)' : 'Curse: pay 25%, +1 BUST'}</button>`;
          el.querySelector('#pl-curse').onclick = () => api.send({ curse: !mine.curse });
        }
      }
      el.querySelector('#pl-note').textContent = v.phase === 'decide' ? `Spin ${v.n}/${v.max}. Stay or cash out. Decided: ${v.decided.map(api.name).join(', ') || 'nobody'}.` : v.phase === 'done' ? (v.bust ? 'BUST.' : 'Done.') : `Spin ${v.n}/${v.max}. BUST segments: ${v.segs.filter(s => s === 'BUST').length}.`;
      el.querySelector('#pl-t').innerHTML = '<tr><th>Player</th><th>Result</th><th>Status</th></tr>' + api.players.map(p => `<tr class="${p.id === api.me ? 'me' : ''}"><td><span class="pdot" style="--c:${p.color}"></span>${esc(p.name)}</td><td class="n">${fx2(v.r[p.id])}x</td><td>${v.inn[p.id] ? 'still in' : 'cashed out'}</td></tr>`).join('');
    },
    frame(el, st) {
      const v = st.v, c = el.querySelector('#pl-c'); if (!v || !c) return;
      const n = v.segs.length, sp = v.spins[v.spins.length - 1], done = sp && now() > sp.at + sp.dur;
      segWheel(c.getContext('2d'), { segs: v.segs, rot: curRot(v, n), fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]), ring: i => done && i === v.top ? '#fff' : null, flappers: [{ off: 0, color: '#f4ecd8' }] });
    }
  };

  G.brake = {
    mount(el, st, api) {
      el.innerHTML = `<p class="note" id="bb-note"></p>${wheelCanvas('bb-c', 'min(460px,86vw,max(200px,calc(100dvh - 430px)))')}<button class="btn go" id="bb-b">BRAKE (space)</button><div class="row" id="bb-act"></div>`;
      const press = () => { api.send({ brake: true }); tone(180, .3, .1); };
      el.querySelector('#bb-b').onclick = press;
      st.key = e => { if (e.code === 'Space' && document.getElementById('bb-b')) { e.preventDefault(); press(); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; if (!st.w) st.w = { a: v.a, w: 0, t: now() };
      el.querySelector('#bb-b').hidden = !api.part || !!v.pressed[api.me] || v.phase === 'done';
      el.querySelector('#bb-note').textContent = v.phase === 'lead' ? `Start in ${secs(v.t0)}. 1 brake each.` : v.phase === 'live' ? `Pressed: ${Object.keys(v.pressed).map(api.name).join(', ') || 'nobody'}` : (v.stopBy ? `Stopped by ${api.name(v.stopBy)}.` : 'It stopped on its own.');
      el.querySelector('#bb-act').innerHTML = api.players.map(p => `<span class="bp" style="--c:${p.color}"><i></i>${esc(p.name)}${v.pressed[p.id] ? ' braked' : ''}${v.result ? ': ' + v.result[p.id] + 'x' : ''}</span>`).join('');
      if (v.phase === 'done') { removeEventListener('keydown', st.key); st.w = { a: v.a, w: 0, t: now() }; }
    },
    fx(el, st, d) { if (d.w) st.w = d.w; },
    frame(el, st, _, api) {
      const v = st.v, c = el.querySelector('#bb-c'); if (!v || !c || !st.w) return;
      const k = v.c0 / v.c1, tau = Math.max(0, (now() - st.w.t) / 1000);
      let a = st.w.a;
      if (st.w.w > 0) { const tstop = Math.log((st.w.w + k) / (2 + k)) / v.c1, T = Math.min(tau, Math.max(0, tstop)); a += (st.w.w + k) * (1 - Math.exp(-v.c1 * T)) / v.c1 - k * T; }
      const n = v.segs.length, fl = api.players.map(p => ({ off: v.off[p.id], color: p.color, label: api.name(p.id).slice(0, 6) }));
      const seg = Math.floor(a + .5); if (st.seg !== undefined && seg !== st.seg && v.phase === 'live') { if (window.Sfx) Sfx.play('flapper-tick', { vol: .7 }); else tone(900, .02, .02); } st.seg = seg;
      segWheel(c.getContext('2d'), { segs: v.segs, rot: a, fill: i => SEGC(v.segs[i]), text: i => label(v.segs[i]), flappers: fl,
        ring: i => v.phase === 'done' && api.players.some(p => ((Math.round(a) + v.off[p.id]) % n + n) % n === i) ? '#fff' : null });
    }
  };
})();
