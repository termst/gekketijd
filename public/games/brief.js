'use strict';
// Bonus game explainers. Each game gets one goal line, 3 steps that use the same names as its in-game step tracker,
// an optional payout strip and up to 3 extras. Icons are 24px line drawings in currentColor.
// The full rules (games/<cat>/*.js) stay available behind a toggle; this is the quick read.
(() => {
  const P = {
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    shuffle: '<path d="M3 7h3.5c4.5 0 6 10 10.5 10H21M3 17h3.5c1.6 0 2.7-1.3 3.6-3M13.9 10c.9-1.7 2-3 3.6-3H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 1.5v4.5M12 18v4.5M1.5 12H6M18 12h4.5"/>',
    star: '<path d="M12 3.2l2.7 5.5 6 .9-4.4 4.2 1 6L12 17l-5.3 2.8 1-6-4.4-4.2 6-.9z"/>',
    bomb: '<circle cx="10.5" cy="14" r="6.5"/><path d="M15 9.5l2.2-2.2M18.5 3.5v2M21 6h-2M20.3 3.7l-1.4 1.4"/>',
    trap: '<path d="M3 16h18M3 16l2-5 2 5 2-5 2 5 2-5 2 5 2-5 2 5 2-5M3 16v3h18v-3"/>',
    pick: '<path d="M6 3.5l12.5 7-5.6 1.6-2.4 5.4z"/><path d="M13 12.1l5 5"/>',
    people: '<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.5-6 5.5-6s5.5 2.7 5.5 6M15 14.3c.5-.2 1-.3 1.5-.3 2.8 0 4.5 2.4 4.5 5.5"/>',
    solo: '<circle cx="12" cy="8" r="3.5"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/>',
    flag: '<path d="M5 21V3.5M5 4h12l-2.5 4 2.5 4H5"/>',
    swap: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>',
    shield: '<path d="M12 3l7.5 3v5c0 4.6-3 8.1-7.5 10-4.5-1.9-7.5-5.4-7.5-10V6z"/>',
    sum: '<path d="M17.5 5H6.5l6 7-6 7h11"/>',
    bounce: '<path d="M3 20l6.5-13L15 17l6-13"/><path d="M3 21.5h18"/>',
    trophy: '<path d="M8 3.5h8V9a4 4 0 0 1-8 0zM8 5.5H4.5c0 3 1.5 4.6 3.8 5M16 5.5h3.5c0 3-1.5 4.6-3.8 5M12 13v3.5M8.5 20.5h7M10 16.5h4v4h-4z"/>',
    drop: '<circle cx="12" cy="6.5" r="3.5"/><path d="M12 11.5v6M9 14.5l3 3 3-3M4 21h16"/>',
    bump: '<circle cx="7.5" cy="14" r="4.5"/><circle cx="16.5" cy="12" r="4.5"/><path d="M12 3.5v3M8.5 4.5l1.2 2.3M15.5 4.5l-1.2 2.3"/>',
    slot: '<circle cx="12" cy="5.5" r="3"/><path d="M3 12v9h18v-9M9 12v9M15 12v9"/>',
    crown: '<path d="M3 8l4.5 4.2L12 5l4.5 7.2L21 8l-2 11H5z"/>',
    pegs: '<circle cx="7" cy="6" r="1.8"/><circle cx="17" cy="6" r="1.8"/><circle cx="12" cy="11" r="1.8"/><circle cx="7" cy="16" r="1.8"/><circle cx="17" cy="16" r="1.8"/><path d="M12 15v6M9.5 18.5L12 21l2.5-2.5"/>',
    gavel: '<path d="M9.5 3.5l6 6-2.8 2.8-6-6zM10.6 10.4L3.5 17.5l2 2 7.1-7.1M13 21h8"/>',
    timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
    leftright: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
    warn: '<path d="M12 3.5l9.5 17h-19z"/><path d="M12 10v5M12 17.8v.4"/>',
    wheel: '<circle cx="12" cy="13" r="8"/><circle cx="12" cy="13" r="1.6"/><path d="M12 5v6.4M12 14.6V21M4 13h6.4M13.6 13H20"/><path d="M10 1.5h4L12 4.5z"/>',
    skip: '<path d="M4 12h11M11 7.5l4.5 4.5-4.5 4.5M19.5 5v14"/>',
    brush: '<path d="M14.5 3.5l6 6-7.5 7.5-6-6zM7 11c-2.5 0-4 1.8-4 4.5 0 1.5-.4 2.7-1 3.8 3.5 0 8-.8 8-5.3"/>',
    half: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor" stroke="none"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    fork: '<path d="M12 21v-7.5M12 13.5L6 5.5M12 13.5l6-8M3.5 8.5V4.5h4M20.5 8.5V4.5h-4"/>',
    skull: '<path d="M5 11a7 7 0 0 1 14 0v3.5l-2 1V19H7v-3.5l-2-1z"/><circle cx="9.5" cy="11.5" r="1.6"/><circle cx="14.5" cy="11.5" r="1.6"/><path d="M10.5 19v2.5M13.5 19v2.5"/>',
    up: '<path d="M3 17.5l6-6 4 4 8-8M15 7.5h6v6"/>',
    bank: '<path d="M3 9l9-5 9 5zM5.5 10.5v7M10 10.5v7M14 10.5v7M18.5 10.5v7M3 20.5h18"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6M5 10v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4M5 14v4c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-4"/>',
    versus: '<path d="M4 4l10 10M20 4L10 14M6.5 15.5L4 18l2 2 2.5-2.5M17.5 15.5L20 18l-2 2-2.5-2.5"/>',
    stop: '<circle cx="12" cy="12" r="8.5"/><rect x="9" y="9" width="6" height="6" rx=".5"/>',
    gauge: '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 16l-4-5M3.5 20h17"/>',
    scale: '<path d="M12 4v16M6 20h12M4 7.5h16M6.5 7.5l-3 6.5h6zM17.5 7.5l-3 6.5h6z"/>',
    pass: '<path d="M3 12h9.5M9 8.5l3.5 3.5L9 15.5"/><circle cx="18" cy="8.5" r="2.5"/><path d="M14.5 19c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4"/>',
    three: '<circle cx="5.5" cy="12" r="2.8"/><circle cx="12" cy="12" r="2.8"/><circle cx="18.5" cy="12" r="2.8"/>',
    x2: '<rect x="2.5" y="5.5" width="19" height="13" rx="1.5"/><path d="M6.5 9.5l4 5M10.5 9.5l-4 5M13.5 10.2c.4-.9 1.2-1.2 2-1.2 1.2 0 2 .8 2 1.8 0 1.6-2.6 2.4-4 4.2h4.2"/>'
  };
  const icon = k => `<svg class="bico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[k] || P.star}</svg>`;

  // goal, steps [icon, step name, what you do], pay [[label, value]], extra [[icon, text]]
  const B = {
    // Spare Change
    minority: { goal: 'Be on the side fewer players pick.',
      steps: [['pick', 'Pick a side', 'Red or Blue, in secret.'], ['swap', 'Swap a rival', 'Spend a Swap token to move a rival across. 1 is free.'], ['coin', 'Coin flip', 'The winning side gets its multiplier. Losers get 1x.']],
      pay: [['Alone', '8x'], ['2 players', '4x'], ['3 players', '3x'], ['4 or more', '2x']],
      extra: [['x2', 'Everyone on one side: doubled']] },
    streak: { goal: 'Call the coin. Bank your streak before you miss.',
      steps: [['coin', 'Call', 'On your turn, call Red or Blue.'], ['up', 'Streak', 'Right: +1x. Wrong: back to 0.'], ['bank', 'Bank', 'Lock in your streak and stop. Auto after 8 calls.']],
      extra: [['pass', 'When you bank, force a rival into 1 extra call'], ['shield', 'Every 5 streak earns a Shield']] },
    duel: { goal: 'Stop the marker on your colour. Closer pays more.',
      steps: [['versus', 'Face 1 player', 'The odd player out duels the House.'], ['stop', 'Stop', 'Press STOP when the marker hits your mark.'], ['trophy', 'Win', 'The better stop takes 25% of the loser.']],
      pay: [['Far off', '2x'], ['Dead on', '20x']],
      extra: [['swap', 'Perfect stop earns a Swap token']] },
    weighted: { goal: 'Weigh the coin to your side. Points you keep also pay.',
      steps: [['scale', 'Bid points', 'Pick Red or Blue and bid 0 to 10 points. Each point: +5% for that side.'], ['eye', 'Reveal odds', 'All bids add up to the odds, 5% to 95%.'], ['coin', 'Coin flip', 'The winning side pays its multiplier.']],
      extra: [['crown', 'Top bidder on the winning side: Top Slot bonus'], ['coins', 'Every unspent point pays 0.5x, win or lose']] },
    // Cash Grab
    sniper: { goal: 'Remember where the big values hide. Then shoot one.',
      steps: [['eye', 'Memorise', 'Values show for 3 seconds.'], ['shuffle', 'Shuffle', 'Targets hide and move. Follow the big ones.'], ['target', 'Shoot', '1 shot. The first hit claims a target.']],
      extra: [['star', 'Gold target: 1 extra shot'], ['bomb', '5 bombs: hit one and a rival is halved']] },
    traps: { goal: 'Pick a rich target. Trap the ones rivals will pick.',
      steps: [['trap', 'Set 2 traps', 'Hide them where you think rivals go.'], ['pick', 'Pick a target', 'Choose 1. Shared targets split the value.'], ['eye', 'Reveal', 'Each rival trap on your pick: you pay 3x to its owner.']],
      extra: [['solo', 'Alone on an untrapped target: +2x'], ['shield', 'Your own traps never catch you']] },
    ammo: { goal: 'Own the best targets when the 30 seconds run out.',
      steps: [['target', 'Shoot', '3 bullets. A shot reveals its whole row.'], ['flag', 'Claim', 'Hit a free target to own it. Hit a rival\'s to steal it.'], ['sum', 'Final gallery', 'You score the total of the targets you own.']],
      extra: [['shield', 'Unused bullets become Shields']] },
    ricochet: { goal: 'Bounce one shot through the best targets.',
      steps: [['bounce', 'Aim', '1 shot. It bounces off walls through up to 3 targets.'], ['timer', 'Fire in lock order', 'Lock in early: earlier shots clear targets first.'], ['trophy', 'Results', 'Your best hit counts.']],
      extra: [['three', '3 hits of one colour: best value x3'], ['eye', 'Everyone sees all aims live']] },
    // Drop Dead
    puckwars: { goal: 'Land your puck in the best slot. Knock rivals off course.',
      steps: [['drop', 'Aim and drop', 'Move to a spot, click to drop. Auto after 8 seconds.'], ['bump', 'Bumper pucks', 'All pucks share 1 board and collide.'], ['slot', 'Score', 'You get the slot your puck lands in.']],
      extra: [['crown', 'The richest player is marked: hit them'], ['x2', 'DOUBLE slot: x2 and 1 more puck']] },
    pegs: { goal: 'Steer the one shared puck into your own slots.',
      steps: [['pegs', 'Place 2 pegs', 'Push the puck toward your 2 slots, away from rivals\'.'], ['drop', 'Drop', '1 shared puck falls through the board.'], ['slot', 'Payout', 'The owner of the slot it lands in collects.']],
      extra: [['flag', 'Your slots are marked in your colour'], ['x2', 'DOUBLE: every slot doubles, puck drops again']] },
    auction: { goal: 'Buy the slots the pucks hit. Keep what you don\'t spend.',
      steps: [['gavel', 'Auction 8 slots', 'Slots are sold one by one. You have 20x to spend.'], ['swap', 'DOUBLE steal', 'The DOUBLE owner may steal 1 slot.'], ['drop', 'Drop 3 pucks', 'Each hit slot pays its owner.']],
      extra: [['timer', 'Bid in the last 3 seconds: clock resets to 3'], ['sum', 'Result: unspent plus collected'], ['x2', 'Puck on DOUBLE: its owner\'s take x2']] },
    tilt: { goal: 'Nudge your own puck into a good slot. Don\'t overdo it.',
      steps: [['drop', 'Get ready', 'Everyone drops on their own board.'], ['leftright', 'Steer', '3 nudges, left or right. Arrow keys work.'], ['slot', 'Land', 'You score the slot you land in.']],
      extra: [['warn', '4th nudge is TILT: 0x'], ['people', '1 nudge may go to a rival\'s board'], ['star', 'No nudges used: +3x']] },
    // Productivitime
    draft: { goal: 'Pick the flapper that ends on the best value.',
      steps: [['pick', 'Draft', 'Pick 1 of 4 flappers. Lowest balance picks first.'], ['skip', 'Jam', 'Once: push a rival\'s flapper 1 segment on.'], ['wheel', 'Spin', 'Your flapper\'s segment is your result.']],
      extra: [['people', 'Shared flapper: split. Alone: +50%'], ['x2', 'DOUBLE or TRIPLE: multiplies, spins again']] },
    paint: { goal: 'Own the segments where the wheel lands.',
      steps: [['brush', 'Paint segments', '6 points. A free segment costs 1, a rival\'s costs 2.'], ['wheel', 'Spin 3 times', 'The landing segment pays its owner.'], ['half', 'Neighbours', 'Both neighbours collect 50%.']],
      extra: [['x2', 'DOUBLE or TRIPLE: all segments multiply, free spin'], ['lock', 'DOUBLE and TRIPLE can\'t be painted']] },
    push: { goal: 'Ride the multiplier. Cash out before it busts.',
      steps: [['wheel', 'Spin', 'Everyone still in takes the result. Each spin multiplies.'], ['fork', 'Stay or cash out', 'Decide in secret after each spin.'], ['skull', 'Bust', 'BUST drops everyone still in to 0.']],
      extra: [['timer', 'Max 3 spins'], ['skull', 'Out? Pay 25% to add a BUST'], ['crown', 'Cap 2,500x, or 20,000x if you are the only one left']] },
    brake: { goal: 'Brake so the wheel stops on a big value under your flapper.',
      steps: [['eye', 'Get ready', 'Find your flapper on the wheel.'], ['gauge', 'Brake', '1 press: the wheel slows by about half.'], ['wheel', 'Read your flapper', 'The segment under it is your result.']],
      extra: [['x2', 'DOUBLE pays 2x the next segment'], ['shield', 'Your press stops it on DOUBLE: a Shield']] }
  };

  function html(id, o = {}) {
    const b = B[id]; if (!b) return '';
    const { esc } = RH;
    let h = `<div class="brief${o.sm ? ' sm' : ''}"><p class="bgoal">${esc(b.goal)}</p>`;
    h += `<ol class="bsteps">${b.steps.map(([ic, t, d], i) => `<li><span class="bring">${icon(ic)}<em>${i + 1}</em></span><b>${esc(t)}</b><small>${esc(d)}</small></li>`).join('')}</ol>`;
    if (b.pay) h += `<div class="bpay"><small>Pays</small>${b.pay.map(([l, v]) => `<span><b>${esc(v)}</b><small>${esc(l)}</small></span>`).join('')}</div>`;
    if (b.extra) h += `<ul class="bextra">${b.extra.map(([ic, t]) => `<li>${icon(ic)}<span>${esc(t)}</span></li>`).join('')}</ul>`;
    return h + '</div>';
  }
  RH.Brief = { html, icon, has: id => !!B[id] };
})();
