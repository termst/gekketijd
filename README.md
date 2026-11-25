# Gekke Tijd (gekketijd)

Multiplayer wheel game with 16 minigames. Play money only (Orra), no real money.

## Play

**https://termst.github.io/gekketijd/**

1. Enter a name. Type a 4 character code or leave the code field empty for a random one, then click **Create**.
2. Pick the run settings (starting balance, betting time, wheel spin time, bet limit, late buy-ins, Prime Minute, max players) and click **Open lobby**. Your browser is now the host of the lobby.
3. Click **Copy invite link** and send it to friends (or give them the 4 character code).
4. Friends open the link and click **Join**. Up to 8 players.

How it works: everything runs on GitHub Pages, no server or account needed. The lobby creator's browser runs the game, the other players connect to it directly (peer to peer, WebRTC). The free PeerJS service is only used to find each other.

Good to know:
- The host must keep the game tab open. If the host closes it, the lobby ends. Keep the host tab visible: browsers slow down timers in background tabs.
- Balances, level, items and lifetime Won and Lost totals are saved in each player's own browser (localStorage). Won is the profit on winning fields, Lost is every stake on fields that did not hit.
- A run with a fixed starting balance gives every player the same fresh balance for that lobby only. Your saved wallet is untouched and the Cashier is closed during that run.
- The chip stack badge between each group of 4 tickets bets the selected chip on all 4 fields. Other players' bets show on each ticket as their colour token, the first 2 letters of their name and the amount.
- Some strict networks (school, office, some mobile carriers) block peer to peer connections. Then try another network or a phone hotspot.

## Bonus games: backers and late buy-ins

The wheel pays 1, 2, 5 and 10 to 1 on the number fields.

When the wheel lands on a bonus field, players who bet on it (backers) always play. Everyone else online gets a 7 second buy-in window:

- Late cap: 25% to 50% of the top backer's stake (`0.25 + 0.25 * backers / players`), never below one 5 chip, within balance and the level limit left this round.
- Late joiners collect 60% of their multiplier and get no Prime Minute boost.
- Backers move first (biggest stake first) and get an Edge Shield that blocks the first attack from a late joiner, without using up a real Shield.
- The window closes early once every eligible player has bought in or pressed Watch.

Tuning lives at the top of `public/core.js` (`JOIN_MS`, `LATE_PAY`, `lateShare`). Subgames can read `ctx.backer(pid)` and `ctx.late(pid)` for game specific edges.

## Wheel weighting

The wheel is random with two small leans (`pickIndex` in `public/core.js`):

| Lean | Effect |
|---|---|
| Dry streak | Bonus fields get +5% weight per 1 or 2 in a row, max +40%. Resets on a bonus hit. |
| Crowd | Each field's weight drops by 12% x (share of bettors on it, needs 2+ bettors) plus 12% x (share of all Orra staked on it). Max 24% less. |

Example, 4 bettors: 3 on Ten holding 60% of the Orra. Ten weight = 1 - 0.12 x 0.75 - 0.12 x 0.6 = 0.84. Tuning: `CROWD_PLAYERS`, `CROWD_STAKE`, `CROWD_MAX` in `public/shared.js`.

## The Glove

`public/glove.js` is the white glove that spins the wheel and reacts to the game. It draws itself on its own canvas (no images) and never blocks clicks.

- Rig: palm slab, 4 fingers x 3 joints, 3 thumb bones and a fading sleeve, rotated in 3D and projected (2.5D). Every joint, the orientation, position, depth and scale are springs, so poses blend without snapping.
- Depth: closer means bigger, a longer and softer shadow, and the front HUD layer. Further means smaller, blurred, and under the HUD (`deep` under everything, `mid` over the wheel but under the table and header, `front` over all).
- Wheel: each spin picks one of 4 corners and a force (flick, easy, firm, heave, monster). The force sets the wheel's turns and curve, the grip style, the wind up (the wheel is dragged back a little) and the follow through. The server still decides where the wheel lands and when.
- Reactions: round start, bets, refused bets, ready, win, big win, loss, no bet, bonus landing, minigame win, minigame loss (middle finger, 5 deliveries), level up, players joining or leaving. Each has several gestures; idle has 16 behaviours (drift, prowl, creep, peek, drum, knuckle crack, knock on the screen, inspect, orbit, loom, shadowbox, count, conduct, thumb twiddle, rest, weave through the HUD).
- Anti repetition: every pick (behaviour, gesture, corner, force, grip, path, screen spot) is weighted against its recent history.
- Punches only spawn impact particles. Reduced motion settings get a calm glove and normal wheel spins.
- Try a gesture from the browser console: `Glove._run('middleJab')`, `Glove._run('knock')`, `Glove._run('creep')`.

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
- `games/<category>/*.js`: 16 subgames. After changing one, run `node tools/bundle-games.js` to rebuild `public/games-bundle.js` for the browser.
- `public/`: client, shared physics, renderers per category, `vendor/peerjs.min.js` (PeerJS 1.5.4, MIT).
- `public/sfx.js` + `public/sfx/`: sound effects. Files are `<group>-<n>.mp3`, trimmed, de-clicked (short fades) and loudness matched offline. Each play draws a variant from a shuffle bag (no repeat until all variants played, never twice in a row), with a small pitch and level spread, sometimes a soft attack or a start offset, and glove sounds panned to where the glove is. Groups and levels: the `DEF` table at the top of `sfx.js`.

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
