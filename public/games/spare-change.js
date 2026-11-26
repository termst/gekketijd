'use strict';
// Spare Change renderers: Minority Rules, Streak or Bank, Coin Duel, Weighted Coin
(() => {
  const { G, esc, fx2, now, coinFlip, coinHtml, tone, K } = RH;
  const SIDE = { red: '#e0454f', blue: '#3a7ee0' };
  const av = (p, extra = '') => `<span class="kav ${extra}" style="--c:${p.color}" title="${esc(p.name)}">${esc(p.name.slice(0, 2))}</span>`;
  // Fire fn once when the coin that lands at `at` has landed
  const onLand = (st, key, at, fn) => { if (!K.once(st, key)) return; setTimeout(fn, Math.max(0, at - now() + 80)); };
  const winFx = (el, big) => { K.burstAt(el, { n: big ? 90 : 50, up: true, power: big ? 700 : 520 }); if (window.Sfx) Sfx.play('win', { vol: .6 }); };
  const loseFx = el => { K.shake(el); if (window.Sfx) Sfx.play('loss', { vol: .5 }); };

  // ---------------------------------------------------------------- Minority Rules
  G.minority = {
    mount(el) {
      el.innerHTML = K.frame(`<div class="kstage mr"><div class="mr-side red" data-s="red"></div><div class="mr-mid">${coinHtml()}<div class="mr-vs">VS</div></div><div class="mr-side blue" data-s="blue"></div></div><div class="row" id="mr-act"></div><div id="mr-b"></div>`);
      el.querySelectorAll('.mr-side').forEach(b => b.onclick = e => {
        const t = e.target.closest('[data-t]');
        if (t) { el._api.send({ swap: t.dataset.t }); tone(420, .1); return; }
        if (b.classList.contains('can')) { el._api.send({ side: b.dataset.s }); tone(b.dataset.s === 'red' ? 520 : 620, .1); K.flash(b); }
      });
    },
    update(el, st, v, api) {
      el._api = api;
      const open = !!v.picks, P = api.players, mine = v.mine;
      K.steps(el.querySelector('.ksteps'), ['Pick a side', 'Swap a rival', 'Coin flip'], { pick: 0, swap: 1, flip: 2, done: 2 }[v.phase]);
      const cue = el.querySelector('.kcue'), canSwap = v.phase === 'swap' && api.part && !v.acted && v.tokens > 0;
      if (v.phase === 'pick') K.cue(cue, !api.part ? 'Players pick in secret' : mine ? `You picked ${mine.toUpperCase()}` : 'Pick a side', mine ? `Waiting: ${v.picked.length}/${P.length} picked` : 'The smaller side pays more. Alone 8x, two 4x, three 3x, more 2x.', !api.part || mine ? 'wait' : 'you');
      else if (v.phase === 'swap') K.cue(cue, canSwap ? 'Swap a rival?' : 'Swaps in progress', canSwap ? `Click a rival to move them to the other side. ${v.tokens} token${v.tokens > 1 ? 's' : ''}.` : 'Waiting for swap decisions', canSwap ? 'you' : 'wait');
      else if (v.phase === 'flip') K.cue(cue, v.rescue ? 'Everyone on one side: Rescue flip' : 'The coin is in the air', `Red pays ${v.live.red}x, Blue pays ${v.live.blue}x`, 'info');
      else K.cue(cue, `${v.flip.toUpperCase()} wins ${v.live[v.flip]}x`, mine ? (mine === v.flip ? 'You called it' : 'Other side pays 1x') : '', mine ? (mine === v.flip ? 'good' : 'bad') : 'info');
      for (const s of ['red', 'blue']) {
        const b = el.querySelector('.mr-side.' + s), who = open ? P.filter(p => v.picks[p.id] === s) : P.filter(p => p.id === api.me && mine === s);
        const ladder = [8, 4, 3, 2].map((m, i) => `<i class="${open && v.live[s] === m && !v.rescue ? 'on' : ''}">${i < 3 ? i + 1 : '4+'}: ${m}x</i>`).join('');
        b.classList.toggle('can', v.phase === 'pick' && api.part);
        b.classList.toggle('sel', mine === s);
        b.classList.toggle('win', v.phase === 'done' && v.flip === s);
        b.classList.toggle('lose', v.phase === 'done' && v.flip !== s);
        b.innerHTML = `<b class="mr-name">${s.toUpperCase()}</b><span class="mr-m">${open ? v.live[s] + 'x' : '?'}</span><span class="mr-ladder">${ladder}</span>
          <span class="mr-who">${who.map(p => canSwap && p.id !== api.me ? `<button class="kav swap" data-t="${p.id}" style="--c:${p.color}" title="Swap ${esc(p.name)}">${esc(p.name.slice(0, 2))}<small>swap</small></button>` : av(p, p.id === api.me ? 'me' : '')).join('')}${!open && v.phase === 'pick' ? '<em>secret</em>' : ''}</span>`;
      }
      const act = el.querySelector('#mr-act');
      act.innerHTML = canSwap ? '<button class="kbig dark" data-pass="1">No swap</button>' : '';
      const pb = act.querySelector('[data-pass]'); if (pb) pb.onclick = () => api.send({ pass: true });
      if (v.phase === 'flip' || v.phase === 'done') {
        coinFlip(el, v.flipSide, v.flipAt);
        onLand(st, 'land' + v.flipAt, v.flipAt, () => { const w = el.querySelector('.mr-side.' + v.flipSide); K.flash(w); if (mine === v.flipSide) winFx(w, v.live[v.flipSide] >= 4); else if (mine) loseFx(el.querySelector('.mr-side.' + mine)); });
      }
      if (v.phase === 'swap' && K.once(st, 'reveal')) { tone(500, .15); el.querySelectorAll('.mr-who .kav').forEach((a, i) => { a.style.animationDelay = i * 70 + 'ms'; a.classList.add('kdrop'); }); }
      K.board(el.querySelector('#mr-b'), P.map(p => {
        const s = open ? v.picks[p.id] : null, done = v.phase === 'done';
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: done ? (s === v.flip ? v.live[s] : 1) : null, txt: s ? s.toUpperCase() : v.picked.includes(p.id) ? 'Picked' : 'Thinking', sub: s ? `pays ${v.live[s]}x` : '', win: done && s === v.flip };
      }), { pops: false });
    }
  };

  // ---------------------------------------------------------------- Streak or Bank
  G.streak = {
    mount(el, st) {
      st.h = {};
      el.innerHTML = K.frame(`<div class="kstage sb"><div class="sb-coin">${coinHtml()}<div class="sb-res"></div></div><div class="sb-lanes"></div></div><div class="row sb-act" id="sb-act"></div>`);
    },
    update(el, st, v, api) {
      const s = v.S[api.me], myTurn = v.turn === api.me && !v.busy && s;
      // Call history, kept here from the stream of results
      if (v.last && K.once(st, 'c' + v.last.at)) {
        (st.h[v.last.pid] = st.h[v.last.pid] || []).push(v.last.ok);
        coinFlip(el, v.last.res, v.last.at + 1300);
        const L = v.last, res = el.querySelector('.sb-res'); res.textContent = ''; res.className = 'sb-res';
        onLand(st, 'l' + L.at, L.at + 1300, () => {
          res.textContent = L.ok ? 'Correct' : 'Wrong'; res.className = 'sb-res ' + (L.ok ? 'good' : 'bad');
          const lane = el.querySelector(`.sb-lane[data-id="${L.pid}"]`);
          if (L.ok) { K.popAt(lane, '+1 streak', { kind: 'good' }); if (L.pid === api.me) K.burstAt(el.querySelector('.coin3d'), { n: 26, kind: 'spark', colors: ['#ffe58a', '#fff'] }); tone(880, .12); }
          else { K.shake(lane); K.popAt(lane, 'Streak lost', { kind: 'bad' }); tone(160, .25); }
        });
      }
      const cue = el.querySelector('.kcue');
      if (myTurn) K.cue(cue, s.forced ? 'You must call' : s.streak ? `Your call: streak ${s.streak}x` : 'Your call', s.forced ? `Forced: ${s.forced} more call${s.forced > 1 ? 's' : ''} before you may bank` : s.streak ? 'Call again for +1x, or bank it now.' : 'Guess the coin. Right adds 1x to your streak.', 'you');
      else if (v.turn) K.cue(cue, v.turn === api.me ? 'Your coin is in the air' : `${api.name(v.turn)} is up`, v.S[v.turn].streak ? `On a ${v.S[v.turn].streak}x streak` : 'Calling the coin', 'wait');
      else K.cue(cue, 'All banked', '', 'info');
      el.querySelector('.sb-lanes').innerHTML = v.order.map(id => {
        const q = v.S[id], h = st.h[id] || [], p = api.P(id);
        const pips = Array.from({ length: v.max }, (_, i) => `<i class="${i < h.length ? (h[i] ? 'ok' : 'no') : ''}"></i>`).join('');
        const flames = q.streak ? `<span class="sb-fire" style="--n:${Math.min(q.streak, 6)}">${q.streak}x</span>` : '<span class="sb-fire off">0x</span>';
        return `<div class="sb-lane ${id === v.turn ? 'turn' : ''} ${q.done ? 'done' : ''} ${id === api.me ? 'me' : ''}" data-id="${id}" style="--c:${p.color}">
          <span class="kav" style="--c:${p.color}">${esc(p.name.slice(0, 2))}</span><span class="sb-nm">${esc(p.name)}${q.forced ? ` <em>must call ${q.forced}</em>` : ''}</span>
          <span class="sb-pips">${pips}</span>${flames}<span class="sb-bank"><small>banked</small>${q.banked}x</span></div>`;
      }).join('');
      const act = el.querySelector('#sb-act');
      const key = myTurn ? `t${s.streak}:${s.forced}:${v.order.filter(id => !v.S[id].done).length}` : '';
      if (act.dataset.k !== key) {
        act.dataset.k = key; st.pass = st.pass && v.S[st.pass] && !v.S[st.pass].done ? st.pass : null;
        if (!myTurn) act.innerHTML = '';
        else {
          const rivals = v.order.filter(id => id !== api.me && !v.S[id].done), canBank = s.streak > 0 && !s.forced;
          act.innerHTML = `<button class="kbig red pulse" data-c="red">Red<kbd>R</kbd></button><button class="kbig blue pulse" data-c="blue">Blue<kbd>B</kbd></button>
            <div class="sb-bankbox"><button class="kbig" id="sb-bank" ${canBank ? '' : 'disabled'}>Bank ${s.streak}x<small>${canBank ? 'lock it in, you are done' : s.forced ? 'forced to call' : 'need a streak first'}</small></button>
            ${canBank && rivals.length ? `<div class="sb-pass"><small>Pass the coin: make a rival call once more</small><div>${rivals.map(id => `<button class="kchip" data-p="${id}" style="--c:${api.color(id)}">${esc(api.name(id))}</button>`).join('')}</div></div>` : ''}</div>`;
          act.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { api.send({ call: b.dataset.c }); tone(b.dataset.c === 'red' ? 520 : 620, .1); });
          act.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { st.pass = st.pass === b.dataset.p ? null : b.dataset.p; act.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x.dataset.p === st.pass)); tone(480, .05); });
          const bk = el.querySelector('#sb-bank'); if (bk) bk.onclick = () => { api.send({ bank: true, pass: st.pass || null }); K.burstAt(bk, { kind: 'coin', n: 24, colors: ['#ffd34d', '#e6b030'] }); if (window.Sfx) Sfx.play('coin-stream', { vol: .5 }); };
          act.querySelectorAll('[data-p]').forEach(x => x.classList.toggle('on', x.dataset.p === st.pass));
          if (K.once(st, 'beep' + v.order.indexOf(api.me) + ':' + s.calls)) tone(700, .2);
        }
      }
      if (!st.key) { st.key = e => { const a = el.querySelector('#sb-act [data-c]'); if (!a) return; if (e.key === 'r') a.click(); if (e.key === 'b') el.querySelector('#sb-act [data-c="blue"]').click(); }; addEventListener('keydown', st.key); }
      if (!v.turn && st.key) { removeEventListener('keydown', st.key); st.key = () => {}; }
    }
  };

  // ---------------------------------------------------------------- Coin Duel
  G.duel = {
    mount(el, st, api) {
      el.innerHTML = K.frame(`<div id="cd-list" class="kstage"></div><button class="kbig pulse" id="cd-stop">STOP<kbd>Space</kbd></button><div id="cd-b"></div>`);
      const stop = () => { const b = el.querySelector('#cd-stop'); if (!b || b.hidden) return; api.send({ stop: true, t: now() }); tone(900, .1); K.flash(b); };
      el.querySelector('#cd-stop').onclick = stop;
      st.key = e => { if (e.code === 'Space' && document.getElementById('cd-stop')) { e.preventDefault(); stop(); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v; st.api = api;
      const list = el.querySelector('#cd-list'), mineI = v.duels.findIndex(d => d.red === api.me || d.blue === api.me);
      if (!st.built) {
        st.built = true;
        const order = v.duels.map((d, i) => i).sort((a, b) => (b === mineI) - (a === mineI));
        list.innerHTML = order.map(i => { const d = v.duels[i], big = i === mineI || mineI < 0 && v.duels.length === 1;
          return `<div class="duel ${i === mineI ? 'mine' : ''}" data-d="${i}"><div class="vs"><span class="r">${esc(api.name(d.red))}</span><em>vs</em><span class="b">${esc(api.name(d.blue))}</span></div>
            <canvas class="gc" width="700" height="${big ? 130 : 90}" data-i="${i}"></canvas><p class="dres" data-r="${i}"></p></div>`; }).join('');
      }
      v.duels.forEach((d, i) => {
        const r = el.querySelector(`[data-r="${i}"]`), box = el.querySelector(`.duel[data-d="${i}"]`);
        if (d.final) {
          const w = d.win ? d[d.win] : null;
          r.innerHTML = `<span class="r">${fx2(d.final.red)}x</span> <span class="note">${w ? esc(api.name(w)) + ' wins' + (d.steal ? ` and steals ${fx2(d.steal.amt)}x` : '') : 'Tie'}</span> <span class="b">${fx2(d.final.blue)}x</span>`;
          if (K.once(st, 'fin' + i)) { if (w === api.me) winFx(box, true); else if (i === mineI && w) loseFx(box); }
        }
        for (const s of ['red', 'blue']) if (d.stops[s] && d.stops[s].p >= 0 && K.once(st, 's' + i + s)) {
          const c = el.querySelector(`canvas[data-i="${i}"]`), [x, y] = K.canvasPt(c, d.stops[s].p * 700, 50, 700, c.height);
          K.pop(x, y - 20, fx2(d.stops[s].m) + 'x', { color: s === 'red' ? '#ff9a9a' : '#9ac2ff', kind: d.stops[s].m >= 15 ? 'big' : '' });
          if (Math.abs(d.stops[s].p - v.spot[s]) <= v.perfect) { K.burst(x, y, { kind: 'spark', n: 40, colors: ['#fff', '#ffe58a'] }); K.pop(x, y - 60, 'PERFECT', { kind: 'big' }); }
        }
      });
      const mine = v.duels[mineI], b = el.querySelector('#cd-stop'), side = mine ? (mine.red === api.me ? 'red' : 'blue') : null;
      b.hidden = !mine || !!mine.stops[side] || v.phase !== 'live';
      const cue = el.querySelector('.kcue');
      if (!mine) K.cue(cue, 'Duels in progress', 'Closer to your mark pays more: 2x far off, 20x dead on.', 'wait');
      else if (v.phase === 'done' || mine.final) K.cue(cue, mine.win ? (mine[mine.win] === api.me ? 'You win the duel' : 'You lose the duel') : 'Tie', '', mine.win ? (mine[mine.win] === api.me ? 'good' : 'bad') : 'info');
      else if (mine.stops[side]) K.cue(cue, `Stopped at ${fx2(mine.stops[side].m)}x`, 'Waiting for your rival', 'wait');
      else if (now() < v.t0) K.cue(cue, `You are ${side.toUpperCase()}`, `Hit STOP when the marker is on the ${side} mark. Dead on: 20x and a Swap token.`, 'you');
      else K.cue(cue, `STOP on the ${side.toUpperCase()} mark`, 'Space or the button. Closer pays more.', 'you');
      K.board(el.querySelector('#cd-b'), api.players.map(p => { const d = v.duels.find(x => x.red === p.id || x.blue === p.id), s = d && (d.red === p.id ? 'red' : 'blue'), k = d && d.stops[s];
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, val: d && d.final ? d.final[s] : null, txt: k ? (k.p < 0 ? 'missed' : fx2(k.m) + 'x') : 'aiming', sub: s ? s + ' side' : '', win: d && d.win === s }; }), { pops: false });
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    frame(el, st) {
      const v = st.v; if (!v) return;
      const t = now();
      v.duels.forEach((d, i) => {
        const c = el.querySelector(`canvas[data-i="${i}"]`); if (!c) return;
        const x = c.getContext('2d'), W = c.width, H = c.height, y0 = H * .28, bh = H * .4;
        x.clearRect(0, 0, W, H);
        // Bar with heat zones: the closer to a mark, the hotter (2x to 20x)
        const g = x.createLinearGradient(0, 0, W, 0);
        for (let k = 0; k <= 20; k++) { const p = k / 20, sr = Math.max(0, 1 - Math.abs(p - v.spot.red) / .6), sb = Math.max(0, 1 - Math.abs(p - v.spot.blue) / .6);
          g.addColorStop(p, sr > sb ? `rgba(224,69,79,${.15 + sr * .75})` : `rgba(58,126,224,${.15 + sb * .75})`); }
        RHrr(x, 0, y0, W, bh, 6); x.fillStyle = '#0009'; x.fill(); x.fillStyle = g; x.fill();
        for (const s of ['red', 'blue']) {
          const sx = v.spot[s] * W;
          x.save(); x.shadowColor = '#fff'; x.shadowBlur = 10; x.fillStyle = '#fff'; x.fillRect(sx - 2, y0 - 8, 4, bh + 16); x.restore();
          x.fillStyle = '#fff'; RH.heft(x, 12, 2); x.textAlign = 'center'; RH.htext(x, '20x', sx, y0 - 14);
        }
        let p = null;
        if (t >= v.t0 && v.phase === 'live') { const q = (((t - v.t0) % v.period) + v.period) % v.period / v.period; p = q < .5 ? q * 2 : 2 - q * 2; }
        if (t < v.t0) K.bigCount(x, (v.t0 - t) / 1000, W / 2, y0 + bh / 2, H * .5);
        if (p !== null && !(d.stops.red && d.stops.blue)) {
          // Marker with a short motion trail
          for (let k = 6; k >= 0; k--) { const tt = t - k * 18, q = (((tt - v.t0) % v.period) + v.period) % v.period / v.period, pp = q < .5 ? q * 2 : 2 - q * 2;
            x.globalAlpha = k ? .12 * (7 - k) / 7 : 1; x.fillStyle = '#ffe58a'; x.fillRect(pp * W - 4, y0 - 12, 8, bh + 24); }
          x.globalAlpha = 1; x.save(); x.shadowColor = '#ffe58a'; x.shadowBlur = 18; x.fillStyle = '#fff8d0'; x.fillRect(p * W - 3, y0 - 12, 6, bh + 24); x.restore();
        }
        for (const s of ['red', 'blue']) { const k = d.stops[s]; if (k && k.p >= 0) {
          const px = k.p * W; x.save(); x.shadowColor = '#000'; x.shadowBlur = 6; x.fillStyle = s === 'red' ? '#ff8a8a' : '#8ab8ff';
          x.beginPath(); x.moveTo(px, y0 + bh + 2); x.lineTo(px - 10, H - 4); x.lineTo(px + 10, H - 4); x.fill(); x.fillRect(px - 2, y0 - 6, 4, bh + 10); x.restore();
          x.fillStyle = '#fff'; RH.heft(x, 14, 2.5); x.textAlign = s === 'red' ? 'right' : 'left'; RH.htext(x, fx2(k.m) + 'x', px + (s === 'red' ? -14 : 14), H - 10); } }
      });
    }
  };
  function RHrr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  // ---------------------------------------------------------------- Weighted Coin
  G.weighted = {
    mount(el, st, api) {
      st.side = 'red'; st.pts = 0;
      el.innerHTML = K.frame(`<div class="kstage wc"><div class="wc-sides"></div><div class="wc-ctl"></div><div class="wc-odds"><div class="r"></div><div class="b"></div><span class="wc-mid"></span></div>${coinHtml()}</div><div id="wc-b"></div>`);
      el.querySelector('.wc-sides').onclick = e => { const b = e.target.closest('[data-s]'); if (!b || b.disabled) return; st.side = b.dataset.s; tone(st.side === 'red' ? 520 : 620, .06); this.update(el, st, st.v, api); };
    },
    update(el, st, v, api) {
      st.v = v;
      const locked = v.locked.includes(api.me), bidding = v.phase === 'bid' && api.part && !locked, P = api.players;
      K.steps(el.querySelector('.ksteps'), ['Bid points', 'Reveal odds', 'Coin flip'], v.phase === 'bid' ? 0 : v.phase === 'flip' ? 2 : 2);
      const cue = el.querySelector('.kcue');
      if (bidding) K.cue(cue, 'Pick a side and weigh the coin', 'Each point: +5% for your side. Points you keep pay 0.5x each, win or lose.', 'you');
      else if (v.phase === 'bid') K.cue(cue, locked ? 'Bid locked' : 'Players are bidding', `Locked: ${v.locked.length}/${P.length}`, 'wait');
      else if (v.phase === 'flip') K.cue(cue, `Red ${Math.round(v.chance * 100)}%  vs  Blue ${Math.round((1 - v.chance) * 100)}%`, 'The weighted coin flips', 'info');
      else { const m = v.mine; K.cue(cue, `${v.flip.toUpperCase()} wins ${v.mult[v.flip]}x`, m ? (m.side === v.flip ? 'Your side won' : 'Your side lost, kept points still pay') : '', m ? (m.side === v.flip ? 'good' : 'bad') : 'info'); }
      const side = bidding ? st.side : v.mine ? v.mine.side : null;
      el.querySelector('.wc-sides').innerHTML = ['red', 'blue'].map(s => {
        const who = v.bids ? P.filter(p => v.bids[p.id] && v.bids[p.id].side === s) : [];
        return `<button class="wc-side ${s} ${side === s ? 'sel' : ''} ${v.flip ? (v.flip === s ? 'win' : 'lose') : ''}" data-s="${s}" ${bidding ? '' : 'disabled'}>
          <span class="wc-name">${s.toUpperCase()}</span><b>${v.mult[s]}x</b><small>Top bidder x${v.top}</small>
          <span class="wc-who">${who.map(p => `<span class="kav" style="--c:${p.color}">${esc(p.name.slice(0, 2))}<small>${v.bids[p.id].pts}</small></span>`).join('')}</span></button>`;
      }).join('');
      const ctl = el.querySelector('.wc-ctl');
      if (bidding) {
        if (!ctl.querySelector('.wc-pips')) {
          ctl.innerHTML = `<div class="wc-pips">${Array.from({ length: v.points }, (_, i) => `<button data-p="${i + 1}" aria-label="${i + 1} points"></button>`).join('')}</div><div class="wc-sum"></div><button class="kbig" id="wc-lock"></button>`;
          ctl.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { const p = +b.dataset.p; st.pts = st.pts === p ? p - 1 : p; tone(400 + st.pts * 40, .05); this.update(el, st, v, api); });
          ctl.querySelector('#wc-lock').onclick = () => { api.send({ side: st.side, pts: st.pts, lock: true }); tone(660, .15); };
        }
        ctl.querySelectorAll('[data-p]').forEach(b => { b.classList.toggle('on', +b.dataset.p <= st.pts); b.className = b.className.replace(/ ?(red|blue)/g, '') + ' ' + st.side; });
        ctl.querySelector('.wc-sum').innerHTML = `<span>Spend <b>${st.pts}</b>: ${st.side} +${st.pts * 5}%</span><span>Keep <b>${v.points - st.pts}</b>: ${fx2((v.points - st.pts) * .5)}x safe</span>`;
        ctl.querySelector('#wc-lock').innerHTML = `Lock ${st.pts} on ${st.side.toUpperCase()}<small>if it wins: ${v.mult[st.side]}x + ${fx2((v.points - st.pts) * .5)}x</small>`;
      } else ctl.innerHTML = '';
      // Odds bar: your own preview while bidding, the real odds after the reveal
      const ch = v.chance !== null ? v.chance : bidding ? .5 + (st.side === 'red' ? 1 : -1) * st.pts * .05 : .5;
      const od = el.querySelector('.wc-odds'); od.classList.toggle('preview', v.chance === null);
      od.querySelector('.r').style.width = ch * 100 + '%'; od.querySelector('.r').textContent = `Red ${Math.round(ch * 100)}%`; od.querySelector('.b').textContent = `Blue ${Math.round((1 - ch) * 100)}%`;
      od.querySelector('.wc-mid').textContent = v.chance === null ? (bidding ? 'Your weight alone' : 'Odds hidden until all bids are in') : 'Final odds';
      el.querySelector('.persp').hidden = v.chance === null;
      if (v.chance !== null) {
        coinFlip(el, v.flipSide, v.flipAt);
        onLand(st, 'land', v.flipAt, () => { const w = el.querySelector('.wc-side.' + v.flipSide); K.flash(w); if (v.mine && v.mine.side === v.flipSide) winFx(w, true); else if (v.mine) loseFx(el.querySelector('.wc-side.' + v.mine.side)); });
      }
      K.board(el.querySelector('#wc-b'), P.map(p => { const b = v.bids && v.bids[p.id];
        return { id: p.id, name: p.name, color: p.color, me: p.id === api.me, txt: b ? `${b.side.toUpperCase()} ${b.pts}` : v.locked.includes(p.id) ? 'Locked' : 'Bidding', sub: b ? `keeps ${v.points - b.pts}` : '', win: v.flip && b && b.side === v.flip }; }), { pops: false });
    }
  };
})();
