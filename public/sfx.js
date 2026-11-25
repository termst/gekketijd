'use strict';
// Sample sound effects. Files: sfx/<group>-<n>.mp3 (trimmed, de-clicked and loudness matched offline).
// Every play picks a variant from a shuffle bag (all variants before a repeat, never the same one twice in a row),
// with a small random pitch and level spread, optional soft attack, start offset, pan and fade out.
// Page API: Sfx.play(group, opts) -> handle { stop(fadeMs), gain(v, ms) }, Sfx.preload(), Sfx.warm(group), Sfx.on (get/set), Sfx.ctx().
const Sfx = (() => {
  const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  // n: variants. v: level. pj: pitch spread (+-). vj: level spread (+-). gap: min ms between plays. max: voices at once.
  // soft: [chance, minMs, maxMs] soft attack fade in. off: [chance, maxMs] start a little into the file.
  const DEF = {
    'token_place':           { n: 0, file: 'token_place', v: .8, pj: .05, vj: .1, gap: 40, max: 4 },
    'no_tokens_left':        { n: 0, file: 'no_tokens_left', v: .8, pj: .03, vj: .05, gap: 250, max: 1 },
    'bets-closed':           { n: 1, v: .7, pj: .04, vj: .1, gap: 800, max: 1, soft: [.5, 8, 30] },
    'coin-stream':           { n: 4, v: .6, pj: .05, vj: .1, gap: 300, max: 2, soft: [.7, 20, 90], off: [.4, 120] },
    'flapper-tick':          { n: 3, v: .5, pj: .08, vj: .25, gap: 26, max: 6 },
    'game-show':             { n: 2, v: .75, pj: .02, vj: .08, gap: 1500, max: 1, soft: [.4, 6, 25] },
    'glove-drumroll':        { n: 4, v: .55, pj: .05, vj: .1, gap: 600, max: 1, soft: [.8, 40, 140], off: [.5, 300] },
    'glove-enter':           { n: 1, v: .7, pj: .06, vj: .1, gap: 2000, max: 1, soft: [.5, 10, 50] },
    'glove-fingerguns':      { n: 2, v: .7, pj: .07, vj: .12, gap: 120, max: 2 },
    'glove-middle':          { n: 1, v: .75, pj: .08, vj: .1, gap: 900, max: 1, soft: [.6, 10, 60] },
    'glove-punch':           { n: 4, v: .8, pj: .08, vj: .12, gap: 80, max: 3 },
    'glove-slap':            { n: 2, v: .75, pj: .08, vj: .12, gap: 80, max: 3 },
    'glove-snap':            { n: 3, v: .7, pj: .07, vj: .12, gap: 60, max: 3 },
    'glove-tap':             { n: 4, v: .6, pj: .1, vj: .2, gap: 45, max: 4 },
    'glove-thumbs-down':     { n: 2, v: .65, pj: .04, vj: .1, gap: 1200, max: 1, soft: [.6, 15, 70] },
    'glove-bow':             { n: 3, v: .7, pj: .04, vj: .1, gap: 1500, max: 1, soft: [.5, 10, 40] },
    'glove-clench':          { n: 1, v: .6, pj: .08, vj: .12, gap: 400, max: 1, soft: [.4, 6, 30] },
    'glove-count':           { n: 3, v: .7, pj: .03, vj: .08, gap: 90, max: 2 },
    'glove-jazz':            { n: 3, v: .7, pj: .03, vj: .08, gap: 900, max: 1, soft: [.4, 6, 25] },
    'glove-rubmoney':        { n: 4, v: .5, pj: .06, vj: .15, gap: 250, max: 2, soft: [.7, 15, 60] },
    'glove-shrug':           { n: 3, v: .6, pj: .06, vj: .12, gap: 700, max: 1, soft: [.3, 5, 20] },
    'glove-wave':            { n: 1, v: .6, pj: .1, vj: .15, gap: 500, max: 1, soft: [.5, 10, 40] },
    'glove-wheel-grab':      { n: 3, v: .75, pj: .07, vj: .1, gap: 200, max: 2 },
    'glove-whoosh':          { n: 4, v: .55, pj: .12, vj: .2, gap: 140, max: 2, soft: [.5, 15, 60] },
    // Glove gestures with style sets. Files: sfx/<group>-<set>-NN.mp3. Sfx.play(g, { set }) takes a set name, an array of
    // names, or { name: weight }; without it any take of any set can play. Each set keeps its own shuffle bag.
    'glove-coin-flick':      { sets: { metallic: 2, snappy: 2 }, v: .65, pj: .06, vj: .1, gap: 300, max: 1 },
    'glove-coin-catch':      { sets: { gloved: 2, leather: 4 }, v: .7, pj: .06, vj: .1, gap: 300, max: 1 },
    'glove-kiss':            { sets: { cartoon: 4, foley: 3, tactile: 4, fast: 1 }, v: .7, pj: .05, vj: .1, gap: 1200, max: 1 },
    'glove-rock':            { sets: { electric: 3, airguitar: 1, percussive: 3 }, v: .7, pj: .02, vj: .08, gap: 1500, max: 1, soft: [.4, 6, 25] },
    'glove-shaka':           { sets: { breezy: 2, surf: 6, foley: 2 }, v: .65, pj: .05, vj: .1, gap: 1000, max: 1, soft: [.4, 6, 25] },
    'glove-slam':            { sets: { felt: 4, cartoon: 4 }, v: .85, pj: .06, vj: .1, gap: 150, max: 2 },
    'glove-sweep':           { sets: { felt: 5, wave: 4 }, v: .65, pj: .06, vj: .12, gap: 600, max: 1, soft: [.5, 10, 40] },
    'glove-hurry':           { sets: { airy: 3, cartoon: 4 }, v: .6, pj: .05, vj: .1, gap: 1000, max: 1, soft: [.4, 6, 25] },
    'glove-twirl':           { sets: { western: 3, slick: 3 }, v: .6, pj: .08, vj: .12, gap: 400, max: 1 },
    'glove-holster':         { sets: { leather: 4, cartoon: 3 }, v: .65, pj: .06, vj: .1, gap: 400, max: 1 },
    'glove-stretch':         { sets: { knuckle: 4, cartoon: 3 }, v: .55, pj: .05, vj: .1, gap: 2500, max: 1, soft: [.6, 20, 80] },
    'glove-step':            { sets: { felt: 3, wood: 2, pizzicato: 1 }, v: .45, pj: .12, vj: .25, gap: 60, max: 3 },
    'glove-cross':           { sets: { tenseshimmer: 3, fidget: 3, anticipation: 3 }, v: .5, pj: .03, vj: .08, gap: 1500, max: 1, soft: [.8, 40, 140] },
    'glove-dizzy':           { sets: { cartoon: 3, foley: 3 }, v: .6, pj: .04, vj: .1, gap: 2000, max: 1, soft: [.5, 10, 40] },
    'loss':                  { n: 2, v: .65, pj: .03, vj: .08, gap: 1500, max: 1, soft: [.5, 10, 50] },
    'wheel-land':            { n: 7, v: .75, pj: .03, vj: .08, gap: 600, max: 1, soft: [.3, 4, 15] },
    'wheel-land-settle':     { n: 5, v: .7, pj: .04, vj: .1, gap: 600, max: 1 },
    'wheel-spin-mechanical': { n: 4, v: .55, pj: .04, vj: .08, gap: 500, max: 1, soft: [.9, 40, 160], off: [.5, 250] },
    // countdown ticks: wood for the early seconds, stopwatch layered in as it gets close, modern for the final second
    'tick-modern':           { n: 3, v: .6, pj: .02, vj: .06, gap: 400, max: 1 },
    'tick-stopwatch':        { n: 2, v: .45, pj: .03, vj: .08, gap: 400, max: 1 },
    'tick-wood':             { n: 3, v: .55, pj: .03, vj: .08, gap: 400, max: 2 },
    'win':                   { n: 4, v: .7, pj: .02, vj: .06, gap: 1500, max: 1, soft: [.4, 6, 30] },
  };
  let on = true, ac = null, out = null, master = 1;   // master: user volume (1 full, .45 low)
  const buf = {}, pend = {}, bag = {}, lastPick = {}, lastAt = {}, voices = {};
  function ctx() {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      // gentle bus compressor so stacked hits (punch + land + coins) never clip
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = .004; comp.release.value = .18;
      out = ac.createGain(); out.gain.value = .9 * master; out.connect(comp).connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  const pad = i => String(i).padStart(2, '0');
  const setFiles = (g, k) => Array.from({ length: DEF[g].sets[k] }, (_, i) => `${g}-${k}-${pad(i + 1)}`);
  const files = (g, set) => {
    const d = DEF[g];
    if (d.sets) return set ? setFiles(g, set) : Object.keys(d.sets).flatMap(k => setFiles(g, k));
    return d.n ? Array.from({ length: d.n }, (_, i) => `${g}-${i + 1}`) : [d.file];
  };
  // o.set: name, [names] or { name: weight } -> one valid set name (or null = all takes)
  function pickSet(g, s) {
    const d = DEF[g]; if (!d.sets || !s) return null;
    if (typeof s === 'string') return d.sets[s] ? s : null;
    const w = Array.isArray(s) ? s.map(k => [k, 1]) : Object.entries(s);
    const ok = w.filter(([k, v]) => d.sets[k] && v > 0); if (!ok.length) return null;
    let r = Math.random() * ok.reduce((a, [, v]) => a + v, 0);
    for (const [k, v] of ok) if ((r -= v) <= 0) return k;
    return ok[ok.length - 1][0];
  }
  function load(f) {
    if (f in buf) return Promise.resolve(buf[f]);
    if (!pend[f]) pend[f] = fetch('sfx/' + f + '.mp3').then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(a => new Promise((ok, no) => ctx().decodeAudioData(a, ok, no))).then(b => buf[f] = b).catch(() => { buf[f] = null; });
    return pend[f];
  }
  // Set groups preload one take per set up front; the rest load the first time the group plays (keeps decode memory down).
  function preload(groups) { (groups || Object.keys(DEF)).forEach(g => { const d = DEF[g]; if (!d) return; (d.sets ? Object.keys(d.sets).map(k => setFiles(g, k)[0]) : files(g)).forEach(load); }); }
  const warm = {};
  function warmUp(g) { if (DEF[g].sets && !warm[g]) { warm[g] = 1; files(g).forEach(load); } }
  // Shuffle bag: every variant plays once before any repeats, and a new bag never starts with the last one played.
  function pickFile(g, set) {
    const fl = files(g, set), key = set ? g + '/' + set : g; if (fl.length === 1) return lastPick[g] = fl[0];
    if (!bag[key] || !bag[key].length) {
      const b = fl.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
      if (b[b.length - 1] === lastPick[g]) [b[0], b[b.length - 1]] = [b[b.length - 1], b[0]];
      bag[key] = b;
    }
    return lastPick[g] = bag[key].pop();
  }
  const NOOP = { stop() {}, gain() {}, get dead() { return true; } };
  // o: set (style set, see DEF), vol, rate, pan (-1..1), delay (ms), fadeIn (ms, overrides soft), fadeOut (ms before the end, or with dur),
  //    dur (ms, cut and fade), offset (ms), loop, force (ignore gap), file (exact variant)
  function play(g, o = {}) {
    const d = DEF[g]; if (!on || !d) return NOOP; warmUp(g);
    const t = performance.now();
    if (!o.force && t - (lastAt[g] || -1e9) < (d.gap || 0)) return NOOP;
    const vs = voices[g] || (voices[g] = []);
    if (o.pending) { o = { ...o }; } else {
    for (let i = vs.length - 1; i >= 0; i--) if (vs[i].dead) vs.splice(i, 1);
    if (vs.length >= (d.max || 4)) vs.shift().stop(40);
    lastAt[g] = t; }
    let f = o.file;
    if (!f) { const set = pickSet(g, o.set); f = pickFile(g, set); if (buf[f] === undefined && d.sets) { const ready = files(g, set).filter(x => buf[x]); if (ready.length) f = ready[Math.floor(Math.random() * ready.length)]; } }
    const b = buf[f];
    if (b === undefined) {
      // not decoded yet: play when it arrives if that is soon, else drop it (a late hit sounds wrong)
      const h = { x: false, real: null, get dead() { return this.x || (!!this.real && this.real.dead); }, stop(ms) { this.x = true; if (this.real) this.real.stop(ms); }, gain(v, ms) { if (this.real) this.real.gain(v, ms); } };
      load(f).then(() => { if (!h.x && buf[f] && performance.now() - t < (o.late ?? 300)) { h.real = play(g, { ...o, file: f, force: true, pending: true }); } else h.x = true; });
      vs.push(h); return h;
    }
    if (!b) return NOOP;
    try {
      const c = ctx(), src = c.createBufferSource(), gn = c.createGain();
      src.buffer = b; src.loop = !!o.loop;
      const rate = (o.rate || 1) * (1 + rnd(-d.pj, d.pj)); src.playbackRate.value = rate;
      const vol = clamp((o.vol ?? 1) * d.v * (1 + rnd(-d.vj, d.vj)), 0, 2);
      let node = src;
      if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1); src.connect(p); node = p; }
      node.connect(gn).connect(out);
      const t0 = c.currentTime + Math.max(0, (o.delay || 0) / 1000);
      let offset = (o.offset || 0) / 1000;
      if (o.offset == null && d.off && Math.random() < d.off[0]) offset = rnd(0, d.off[1]) / 1000;
      offset = Math.min(offset, b.duration * .5);
      let fi = o.fadeIn;
      if (fi == null) fi = d.soft && Math.random() < d.soft[0] ? rnd(d.soft[1], d.soft[2]) : 3;
      if (offset > 0) fi = Math.max(fi, 12);      // never start mid-waveform without a fade
      gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(vol, t0 + fi / 1000);
      const len = o.loop ? Infinity : (b.duration - offset) / rate;
      const end = o.dur ? Math.min(len, o.dur / 1000) : len;
      if (isFinite(end)) {
        const fo = Math.min(end * .6, (o.fadeOut ?? (o.dur ? 120 : 0)) / 1000);
        if (fo > 0) { gn.gain.setValueAtTime(vol, t0 + end - fo); gn.gain.linearRampToValueAtTime(0, t0 + end); }
      }
      src.start(t0, offset);
      if (isFinite(end)) src.stop(t0 + end + .02);
      const h = {
        dead: false,
        stop(ms = 120) {
          if (this.dead) return; this.dead = true;
          try { const n = c.currentTime; gn.gain.cancelScheduledValues(n); gn.gain.setValueAtTime(gn.gain.value, n); gn.gain.linearRampToValueAtTime(0, n + ms / 1000); src.stop(n + ms / 1000 + .02); } catch {}
        },
        gain(v, ms = 150) { if (this.dead) return; try { const n = c.currentTime; gn.gain.cancelScheduledValues(n); gn.gain.setValueAtTime(gn.gain.value, n); gn.gain.linearRampToValueAtTime(clamp(v * d.v, 0, 2), n + ms / 1000); } catch {} },
      };
      src.onended = () => { h.dead = true; };
      if (!o.pending) vs.push(h);
      return h;
    } catch { return NOOP; }
  }
  // Synth blip on the same bus (for UI ticks that have no sample).
  function tone(f, dur = .08, v = .05) {
    if (!on) return;
    try { const c = ctx(), o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(v, c.currentTime); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + dur); o.connect(g).connect(out); o.start(); o.stop(c.currentTime + dur); } catch {}
  }
  function stopAll(ms = 150) { Object.values(voices).forEach(vs => vs.forEach(h => h.stop(ms))); }
  // Master volume, ramped so a change mid-sound never clicks.
  function setVol(v) { master = clamp(+v || 0, 0, 1); if (out) try { const n = ac.currentTime; out.gain.cancelScheduledValues(n); out.gain.setValueAtTime(out.gain.value, n); out.gain.linearRampToValueAtTime(.9 * master, n + .08); } catch {} }
  return { play, tone, preload, warm: g => DEF[g] && warmUp(g), ctx, stopAll, get on() { return on; }, set on(v) { on = !!v; if (!on) stopAll(80); }, get vol() { return master; }, set vol(v) { setVol(v); } };
})();
if (typeof window !== 'undefined') window.Sfx = Sfx;
