'use strict';
// Spare Change renderers: Minority Rules, Streak or Bank, Coin Duel, Weighted Coin
(() => {
  const { G, esc, fx2, now, coinFlip, coinHtml, tone } = RH;
  const dots = (ids, api) => ids.map(id => `<span class="pdot" style="--c:${api.color(id)}" title="${esc(api.name(id))}"></span>`).join('');

  G.minority = {
    mount(el) { el.innerHTML = `<div class="row" id="mr-sides"></div>${coinHtml()}<div id="mr-act" class="row"></div><p class="note" id="mr-note"></p>`; },
    update(el, st, v, api) {
      const open = !!v.picks, side = s => {
        const who = open ? Object.keys(v.picks).filter(id => v.picks[id] === s) : [];
        return `<button class="side ${s} ${v.mine === s ? 'sel' : ''}" data-s="${s}" ${v.phase !== 'pick' || !api.part ? 'disabled' : ''}>${s.toUpperCase()}<small>${open ? v.live[s] + 'x' + (v.rescue && who.length ? ' Rescue' : '') : 'secret'}</small><small>${dots(who, api)}</small></button>`;
      };
      el.querySelector('#mr-sides').innerHTML = side('red') + side('blue');
      el.querySelectorAll('.side').forEach(b => b.onclick = () => { api.send({ side: b.dataset.s }); tone(520); });
      const act = el.querySelector('#mr-act'), note = el.querySelector('#mr-note');
      act.innerHTML = '';
      if (v.phase === 'pick') note.textContent = `Picked: ${v.picked.map(api.name).join(', ') || 'nobody yet'}. 1 player on a side gets 8x, a crowd shares 2x.`;
      if (v.phase === 'swap') {
        if (api.part && !v.acted && v.tokens > 0) {
          act.innerHTML = api.players.filter(p => p.id !== api.me).map(p => `<button class="btn" data-t="${p.id}"><span class="pdot" style="--c:${p.color}"></span>Swap ${esc(p.name)}</button>`).join('') + '<button class="btn" data-pass="1">No swap</button>';
          act.querySelectorAll('button').forEach(b => b.onclick = () => api.send(b.dataset.pass ? { pass: true } : { swap: b.dataset.t }));
          note.textContent = `You have ${v.tokens} Swap token${v.tokens > 1 ? 's' : ''}. Force a rival to the opposite side before the flip.`;
        } else note.textContent = 'Waiting for Swap tokens...';
      }
      if (v.phase === 'flip' || v.phase === 'done') { coinFlip(el, v.flipSide, v.flipAt); note.textContent = v.flip ? `${v.flip.toUpperCase()} wins ${v.live[v.flip]}x. The other side keeps 1x.` : 'Flipping...'; }
    }
  };

  G.streak = {
    mount(el) { el.innerHTML = `${coinHtml()}<p class="big" id="sb-last"></p><table class="res" id="sb-t"></table><div class="row" id="sb-act"></div>`; },
    update(el, st, v, api) {
      el.querySelector('#sb-t').innerHTML = '<tr><th>Player</th><th>Streak</th><th>Banked</th><th>Calls</th><th></th></tr>' + v.order.map(id => {
        const s = v.S[id];
        return `<tr class="${id === api.me ? 'me' : ''}" style="${id === v.turn ? 'background:#e6c67322' : ''}"><td><span class="pdot" style="--c:${api.color(id)}"></span>${esc(api.name(id))}${id === v.turn ? ' (turn)' : ''}</td><td class="n">${s.streak}x</td><td class="n">${s.banked}x</td><td class="n">${s.calls}/${v.max}</td><td>${s.done ? 'banked' : s.forced ? `must call ${s.forced}` : ''}</td></tr>`;
      }).join('');
      if (v.last) {
        coinFlip(el, v.last.res, v.last.at + 1300);
        clearTimeout(st.t); el.querySelector('#sb-last').textContent = '';
        st.t = setTimeout(() => { el.querySelector('#sb-last').textContent = `${api.name(v.last.pid)} called ${v.last.side}: ${v.last.ok ? 'correct' : 'wrong'}`; }, Math.max(0, v.last.at + 1300 - now()));
      }
      const act = el.querySelector('#sb-act'), s = v.S[api.me];
      if (v.turn === api.me && !v.busy && s) {
        const rivals = v.order.filter(id => id !== api.me && !v.S[id].done);
        act.innerHTML = `<button class="side red" data-c="red">CALL RED</button><button class="side blue" data-c="blue">CALL BLUE</button>
          <div><button class="btn go" id="sb-bank" ${s.streak > 0 && !s.forced ? '' : 'disabled'}>Bank ${s.streak}x</button><br><label class="note">Pass the coin to <select id="sb-pass"><option value="">nobody</option>${rivals.map(id => `<option value="${id}">${esc(api.name(id))}</option>`).join('')}</select></label></div>`;
        act.querySelectorAll('[data-c]').forEach(b => b.onclick = () => api.send({ call: b.dataset.c }));
        el.querySelector('#sb-bank').onclick = () => api.send({ bank: true, pass: el.querySelector('#sb-pass').value || null });
        if (!st.beeped) { tone(700, .2); st.beeped = true; }
      } else { act.innerHTML = v.turn ? `<p class="note">${esc(api.name(v.turn))} is calling...</p>` : ''; st.beeped = false; }
    }
  };

  G.duel = {
    mount(el, st, api) {
      el.innerHTML = `<div id="cd-list" class="ga"></div><button class="btn go" id="cd-stop">STOP (space)</button><p class="note" id="cd-note"></p>`;
      const stop = () => { api.send({ stop: true, t: now() }); tone(900, .1); };
      el.querySelector('#cd-stop').onclick = stop;
      st.key = e => { if (e.code === 'Space' && document.getElementById('cd-stop')) { e.preventDefault(); stop(); } };
      addEventListener('keydown', st.key);
    },
    update(el, st, v, api) {
      st.v = v;
      const list = el.querySelector('#cd-list');
      if (!st.built) {
        st.built = true;
        list.innerHTML = v.duels.map((d, i) => `<div><div class="row"><b style="color:#ff8a8a">${esc(api.name(d.red))}</b> vs <b style="color:#8ab8ff">${esc(api.name(d.blue))}</b></div><canvas class="gc" width="560" height="60" data-i="${i}"></canvas><p class="note" data-r="${i}"></p></div>`).join('');
      }
      v.duels.forEach((d, i) => {
        const r = el.querySelector(`[data-r="${i}"]`);
        if (d.final) r.textContent = `${api.name(d.red)} ${fx2(d.final.red)}x, ${api.name(d.blue)} ${fx2(d.final.blue)}x${d.steal ? ' (25% stolen)' : ''}`;
        else r.textContent = ['red', 'blue'].map(s => d.stops[s] ? `${api.name(d[s])} stopped` : '').filter(Boolean).join(', ');
      });
      const mine = v.duels.find(d => d.red === api.me || d.blue === api.me), b = el.querySelector('#cd-stop');
      const side = mine ? (mine.red === api.me ? 'red' : 'blue') : null;
      b.hidden = !mine || !!mine.stops[side] || v.phase !== 'live';
      el.querySelector('#cd-note').textContent = mine ? `You are ${side.toUpperCase()}. Your sweet spot is the ${side} mark. Perfect stop wins a Swap token.` : '';
      if (v.phase === 'done') removeEventListener('keydown', st.key);
    },
    frame(el, st, v) {
      if (!v) return;
      const t = now();
      v.duels.forEach((d, i) => {
        const c = el.querySelector(`canvas[data-i="${i}"]`); if (!c) return;
        const x = c.getContext('2d'), W = c.width, H = c.height;
        x.clearRect(0, 0, W, H); x.fillStyle = '#0008'; x.fillRect(0, 18, W, 24);
        for (const s of ['red', 'blue']) { const sx = v.spot[s] * W; x.fillStyle = s === 'red' ? '#c8323c' : '#2f6fd0'; x.fillRect(sx - 30, 18, 60, 24); x.fillStyle = '#fff'; x.fillRect(sx - 1, 14, 2, 32); }
        let p = null;
        if (t >= v.t0 && v.phase === 'live') { const q = (((t - v.t0) % v.period) + v.period) % v.period / v.period; p = q < .5 ? q * 2 : 2 - q * 2; }
        if (t < v.t0) { x.fillStyle = '#fff'; x.font = '700 20px ' + RH.FONT; x.textAlign = 'center'; x.fillText(Math.ceil((v.t0 - t) / 1000), W / 2, 37); }
        if (p !== null && !(d.stops.red && d.stops.blue)) { x.fillStyle = '#ffe58a'; x.fillRect(p * W - 3, 8, 6, 44); }
        for (const s of ['red', 'blue']) { const k = d.stops[s]; if (k && k.p >= 0) { x.fillStyle = s === 'red' ? '#ff8a8a' : '#8ab8ff'; x.beginPath(); x.moveTo(k.p * W, 16); x.lineTo(k.p * W - 8, 2); x.lineTo(k.p * W + 8, 2); x.fill(); x.fillStyle = '#fff'; x.font = '700 12px ' + RH.FONT; x.textAlign = 'center'; x.fillText(fx2(k.m) + 'x', k.p * W, 56); } }
      });
    }
  };

  G.weighted = {
    mount(el, st) {
      st.side = 'red'; st.pts = 0;
      el.innerHTML = `<div class="row" id="wc-sides"></div><div id="wc-ctl" class="row"></div>${coinHtml()}<div id="wc-odds"></div><p class="note" id="wc-note"></p>`;
    },
    update(el, st, v, api) {
      const bidders = s => v.bids ? Object.keys(v.bids).filter(id => v.bids[id].side === s) : [];
      el.querySelector('#wc-sides').innerHTML = ['red', 'blue'].map(s => `<button class="side ${s} ${st.side === s && v.phase === 'bid' ? 'sel' : ''}" data-s="${s}" ${v.phase !== 'bid' || !api.part ? 'disabled' : ''}>${s.toUpperCase()} ${v.mult[s]}x<small>${v.bids ? bidders(s).map(id => `${esc(api.name(id))} ${v.bids[id].pts}`).join(', ') : 'Top Slot x' + v.top + ' for the top bidder'}</small></button>`).join('');
      el.querySelectorAll('.side').forEach(b => b.onclick = () => { st.side = b.dataset.s; this.update(el, st, v, api); });
      const ctl = el.querySelector('#wc-ctl'), locked = v.locked.includes(api.me);
      if (v.phase === 'bid' && api.part && !locked) {
        if (!ctl.querySelector('input')) {
          ctl.innerHTML = `<label>Points <input type="range" min="0" max="${v.points}" value="${st.pts}" id="wc-pts"></label><b id="wc-pv"></b><button class="btn go" id="wc-lock">Lock bid</button>`;
          const upd = () => { st.pts = +el.querySelector('#wc-pts').value; el.querySelector('#wc-pv').textContent = `${st.pts} pts (+${st.pts * 5}%), keep ${v.points - st.pts} = ${fx2((v.points - st.pts) * .5)}x`; };
          el.querySelector('#wc-pts').oninput = upd; upd();
          el.querySelector('#wc-lock').onclick = () => api.send({ side: st.side, pts: st.pts, lock: true });
        }
      } else ctl.innerHTML = v.phase === 'bid' ? `<p class="note">Locked: ${v.locked.map(api.name).join(', ') || 'nobody yet'}</p>` : '';
      if (v.chance !== null) {
        el.querySelector('#wc-odds').innerHTML = `<div style="display:flex;width:min(420px,90vw);height:22px;margin:auto"><div style="background:var(--red);width:${v.chance * 100}%;font-size:12px">${Math.round(v.chance * 100)}%</div><div style="background:var(--blue);flex:1;font-size:12px">${Math.round((1 - v.chance) * 100)}%</div></div>`;
        coinFlip(el, v.flipSide, v.flipAt);
      }
      el.querySelector('#wc-note').textContent = v.flip ? `${v.flip.toUpperCase()} wins. Unspent points pay 0.5x each.` : v.phase === 'bid' ? 'Every point adds +5% to your side, and is spent whether you win or not.' : 'Flipping with the weighted odds...';
    }
  };
})();
