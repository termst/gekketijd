# Gekke Tijd (gekketijd)

Multiplayer wheel game with 16 minigames. Play money only (Orra), no real money.

## Play

**https://termst.github.io/gekketijd/**

1. Enter a name. Type a 4 character code or leave the code field empty for a random one, then click **Create**.
2. Pick a mode (Classic or Battle) and the settings, then click **Open lobby**. Your browser is now the host of the lobby.
3. Click **Copy invite link** and send it to friends (or give them the 4 character code).
4. Friends open the link and click **Join**. Up to 8 players.

How it works: everything runs on GitHub Pages, no server or account needed. The lobby creator's browser runs the game, the other players connect to it directly (peer to peer, WebRTC). The free PeerJS service is only used to find each other.

Good to know:
- The host must keep the game tab open. If the host closes it, the lobby ends. Keep the host tab visible: browsers slow down timers in background tabs.
- Balances, level, items and lifetime Won and Lost totals are saved in each player's own browser (localStorage). Won is the profit on winning fields, Lost is every stake on fields that did not hit.
- A run with a fixed starting balance gives every player the same fresh balance for that lobby only. Your saved wallet is untouched and the Cashier is closed during that run.
- The chip stack badge between each group of 4 tickets bets the selected chip on all 4 fields. Other players' bets show on each ticket as their colour token, the first 2 letters of their name and the amount.
- Your wallet (saved Orra) shows on the home screen next to Won and Lost, and in the game header. In fixed balance runs it stays separate from the run balance and grows with the saved share of your wins.
- The speaker button cycles full volume, 45% (one wave) and mute. The choice is remembered.
- Some strict networks (school, office, some mobile carriers) block peer to peer connections. Then try another network or a phone hotspot.

## Battle mode

Pick **Battle** on the New lobby screen. Everyone gets the same stack, the race is on.

| Rule | How it works |
|---|---|
| Goal | First to the target (x2, x3 or x5 of the stack) wins, or be the last one standing. |
| Storm | Every round each player still in pays an ante into the Pot. It starts at 1% of the stack and climbs one step every 6, 4 or 3 rounds (Slow, Normal, Fast): 1, 2, 3, 5, 8, 12, 18, 25, 35, 50%. |
| Pot | The biggest net winner of the round takes the whole Pot. Nobody up: it carries over. The winner also takes what is left at the end. |
| Underdog | With 3 or more players left, the lowest stack skips the ante. |
| Knockout | Under 5 Orra after a round or an ante means out. The Pot taker of that round gets the KO. Out players keep watching. |
| Prize | Saved to the wallet: winner 100 per opponent, the rest 20 per player they outlasted. Level up rewards go to the wallet, bets have no level limit. |

The lobby opens in a waiting room. The host (lobby creator, or the next online player if they leave) starts the battle once 2+ players are in, and can start a rematch from the end screen. Players who join mid battle watch until the next one. Tuning: `STORM_EVERY`, `STORM_PCT`, `WIN_PRIZE`, `OUTLAST_PRIZE` in `public/core.js`.

## Bonus games: backers and late buy-ins

The wheel pays 1, 2, 5 and 10 to 1 on the number fields.

When the wheel lands on a bonus field, players who bet on it (backers) always play.

Briefing: there is no clock before a bonus game. Everyone reads the game and its rules at their own pace. Backers and late joiners press **Ready**, everyone else picks **Buy in and ready** or **Watch**. The player list shows who is Ready, Reading or Deciding. Once everyone is ready the game starts after a 1.5 s count-in. The host (lobby creator, or the next online player if they leave) has a **Start now** button to skip the wait; undecided players then watch. A 5 minute failsafe (`BRIEF_MAX`) only stops a lobby where everyone walked away from hanging.

Non-backers can buy in late during the briefing:

- Late cap: 25% to 50% of the top backer's stake (`0.25 + 0.25 * backers / players`), never below one 5 chip, within balance and the level limit left this round.
- Late joiners collect 60% of their multiplier and get no Prime Minute boost.
- Backers move first (biggest stake first) and get an Edge Shield that blocks the first attack from a late joiner, without using up a real Shield.

Tuning lives at the top of `public/core.js` (`GO_MS`, `BRIEF_MAX`, `LATE_PAY`, `lateShare`). Subgames can read `ctx.backer(pid)` and `ctx.late(pid)` for game specific edges.

## Playing with friends: Call It and taunts

| Feature | How it works |
|---|---|
| Call It | When the wheel lands on a bonus field, everyone (backers, late joiners and spectators) can put one chip (5, 10, 25 or 50) on the player they think tops that game. Open during the briefing and the first 6 s of the game (`CALL_GRACE`). |
| Payout | Pari-mutuel among the callers: right callers get their chip back +20% (`CALL_BONUS`) plus a share of the wrong calls, in proportion to their chip. Nobody right, or nobody scored: every chip goes back. A tie at the top counts for both. Results show under the bonus results. |
| Taunts | Press **T** or the Taunt button (bottom left), then a line or its number key. It pops as a speech bubble over your chip for everyone, also during minigames. One per 0.9 s (`EMOTE_GAP`). |

Tuning: `CALL_CHIPS`, `CALL_GRACE`, `CALL_BONUS`, `EMOTES`, `EMOTE_GAP` in `public/core.js`. The taunt lines live in `Social` in `public/client.js` (keep `EMOTES` equal to their count).

## Minigame look and feel

Explainers: `public/games/brief.js` (`RH.Brief`) holds a quick read per game: one goal line, 3 numbered steps with line icons (named like the game's own step tracker, so the briefing and the game match), a payout strip where it helps and up to 3 extras. The briefing, the in-game Rules button and the How to play dialog all show it, with the full rules from `games/<category>/*.js` behind a Full rules toggle. A game without an entry falls back to the full rules list. When a game's rules change, update its entry too.

Every minigame renderer uses the shared kit in `public/games/kit.js` (`RH.K`), so all 16 games read the same way:

- Steps: a numbered text line of the game's phases (for example Pick, Swap, Flip), the current one underlined in the category colour.
- Cue: one line between two rules saying what to do right now. On your move it turns into a brass plate.
- Scoreboard: one plate per player with a flat colour token and live values that tween, pop the change and flash up or down.
- Effects: floating text (`pop`), confetti, sparks and coins (`burst`, one fixed canvas that only runs while particles live), shake and flash. Reduced motion settings skip particles and animations.
- Shared canvases: wheels have chasing rim bulbs, shading, pulsing landing highlights and flapper ticks while spinning. Pachinko boards have shaded pegs, glowing pucks with trails and slot flashes.
- Keyboard: Space for STOP, BRAKE, drop and lock; A and D (or arrows) to aim or tilt; R and B to call in Streak or Bank.

## Look

A fairground theatre at night: an oxblood velvet curtain (drawn once in `scenery()` in `client.js`, folds, a spotlight pool behind the wheel, vignette and fabric nap), a mahogany desk with a brass bulb rail, card stock tickets and a green baize table with a mahogany rail for bonus games.

- Palette and textures live at the top of `public/style.css`: one brass (`--brass`, `--metal` for brass plates), one cream (`--pearl`), muted print reds and blues for the coin sides (`--red`, `--blue`). Textures are tiny inline SVG noise tiles: `--grain` (panels), `--paper` (tickets, coin sides), `--felttx` (baize), `--wood` (desk).
- Panels are split by brass rules instead of boxes inside boxes. No neon glows or glossy gradients: selection is a cream or brass outline, the main action is a brass plate (`.go`, `.kbig`).
- The lobby is an admission ticket: logo and wallet on top, a perforated seam with notches, the forms on the stub.
- Player colours (`COLORS` in `core.js`) and the bonus category accents (`ACCENT` in `client.js`) are print inks that sit on velvet and baize.

## Wheel weighting

The wheel is random with two small leans (`pickIndex` in `public/core.js`):

| Lean | Effect |
|---|---|
| Dry streak | Bonus fields get +5% weight per 1 or 2 in a row, max +40%. Resets on a bonus hit. |
| Crowd | Each field's weight drops by 12% x (share of bettors on it, needs 2+ bettors) plus 12% x (share of all Orra staked on it). Max 24% less. |

Example, 4 bettors: 3 on Ten holding 60% of the Orra. Ten weight = 1 - 0.12 x 0.75 - 0.12 x 0.6 = 0.84. Tuning: `CROWD_PLAYERS`, `CROWD_STAKE`, `CROWD_MAX` in `public/shared.js`.

## The Glove

`public/glove.js` is the white glove that spins the wheel and reacts to the game. It draws itself on its own canvas (no images) and never blocks clicks.

- Rig: palm slab, 4 fingers x 3 joints, 3 thumb bones and a fading sleeve, rotated in 3D and projected (2.5D). Every joint, the orientation, position, depth and scale are springs, so poses blend without snapping. Fingers settle one after another, moves carry the hand's momentum into the next path, and a wheel grab eases onto the contact point.
- Draw order: bones are sorted against the palm plane (under the palm or over it), not by depth alone, so curled fingers and the thumb never poke through the palm while the hand turns. The palm is a bevelled solid slab and the cuff hem wraps behind the wrist.
- Depth: closer means bigger, a longer and softer shadow, and the front HUD layer. Further means smaller, blurred, and under the HUD (`deep` under everything, `mid` over the wheel but under the table and header, `front` over all).
- Wheel: each spin picks one of 4 corners and a force (flick, easy, firm, heave, monster). The force sets the wheel's turns and curve, the grip style, the wind up (the wheel is dragged back a little) and the follow through. The server still decides where the wheel lands and when.
- Reactions: round start, bets, refused bets, ready, win, big win, loss, no bet, bonus landing, minigame win, minigame loss (middle finger, 5 deliveries), level up, players joining or leaving. Each has several gestures; idle has 18 behaviours (drift, prowl, creep, peek, drum, knuckle crack, knock on the screen, inspect, orbit, loom, shadowbox, count, conduct, thumb twiddle, rest, weave through the HUD, stretch, two finger stroll). Gestures include coin flip, chef's kiss, rock on, shaka, table slam, sweep, hurry up twirl, gun twirl with holster, fingers crossed (while the wheel spins) and a dizzy wobble after monster spins.
- Cursor: the glove makes room when the cursor comes near (it drifts aside and turns see-through while the cursor is on it), sometimes follows the cursor with a pointing finger, and offers a high five (click the open palm within 1.8 s). Click the hand to poke it: it flinches, three pokes in 6 s earn a scolding.
- Fast moves get cartoon squash and stretch plus two fading smear ghosts. Off screen the glove skips drawing.
- Briefing: a thumbs up when you press Ready, a drumroll when everyone is ready, and now and then a patient point at your Ready button.
- Anti repetition: every pick (behaviour, gesture, corner, force, grip, path, screen spot) is weighted against its recent history.
- Punches only spawn impact particles. Reduced motion settings get a calm glove and normal wheel spins.
- Try a gesture from the browser console: `Glove._run('middleJab')`, `Glove._run('knock')`, `Glove._run('creep')`, `Glove._run('coinFlip')`.
- Sound slots without samples yet are marked `todo` in `sfx.js` and play a fallback (or nothing) until their files are added.

## Optional: run your own server

The Node server still works and does not need the peer to peer layer:

```
node server.js
```

Open http://localhost:8080. Node 18+, no `npm install`. The server reads `PORT` and `DATA_FILE` env vars, so it can also run on any Node host.

## Development

- `public/core.js`: the game core (lobbies, wheel, economy, bonus host). Used by both `server.js` and the browser host.
- `public/net.js`: peer to peer transport for GitHub Pages mode.
- `public/glove.js`: the Glove (see above). `client.js` feeds it room updates and events and asks it before each spin.
- `games/<category>/*.js`: 16 subgames (server side logic). After changing one, run `node tools/bundle-games.js` to rebuild `public/games-bundle.js` for the browser.
- `public/games/*.js`: the renderers per category, on top of `public/games/kit.js`.
- `public/`: client, shared physics, renderers per category, `vendor/peerjs.min.js` (PeerJS 1.5.4, MIT).
- `public/sfx.js` + `public/sfx/`: sound effects. Files are `<group>-<n>.mp3`, trimmed, de-clicked (short fades) and loudness matched offline. Each play draws a variant from a shuffle bag (no repeat until all variants played, never twice in a row), with a small pitch and level spread, sometimes a soft attack or a start offset, and glove sounds panned to where the glove is. Groups and levels: the `DEF` table at the top of `sfx.js`. Countdown ticks (`countdown()` in `client.js`) run over the last 5 s of betting (3 s on rounds under 10 s), the last 3 s of a bonus buy-in window and of bonus game clocks: woodblock ticks that get louder and higher, a stopwatch layer at 2, the modern tick on the final second. A tick only fires right at its second boundary, so lag or a hidden tab never plays it late.

| Group | Plays on |
|---|---|
| `bets-closed` | Betting closes, wheel about to spin |
| `wheel-spin-mechanical` | Wheel spin, pitch follows spin force, fades out over the slow down |
| `flapper-tick` | Every segment passing the pointer (main wheel and Brake Battle), louder as it slows |
| `wheel-land-settle`, `wheel-land` | Wheel comes to rest, then the landing sting |
| `win` + `coin-stream`, `loss` | Your payout result (coin run length scales with the win), Cashier collect and daily bonus |
| `game-show` | A bonus game is coming up, daily bonus |
| `glove-*` | Glove: punch, tap, knock, snap, finger guns, slap (pat, slap grip), wheel grab, whoosh (hard spins, punches, fast moves), drumroll (drums, watching the spin), thumbs down, middle finger, entrance |
| `token_place`, `no_tokens_left` | Chip placed, bet refused |

Testing with the Node server: `DEV=1 node server.js`, then `node bots.js ABCD 2` adds 2 bots to lobby ABCD.
`node bots.js ABCD 2 ws://localhost:8080 tilt` forces a subgame (DEV only).
