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

## Optional: run your own server

The Node server still works and does not need the peer to peer layer:

```
node server.js
```

Open http://localhost:8080. Node 18+, no `npm install`. The server reads `PORT` and `DATA_FILE` env vars, so it can also run on any Node host.

## Development

- `public/core.js`: the game core (lobbies, wheel, economy, bonus host). Used by both `server.js` and the browser host.
- `public/net.js`: peer to peer transport for GitHub Pages mode.
- `games/<category>/*.js`: 16 subgames. After changing one, run `node tools/bundle-games.js` to rebuild `public/games-bundle.js` for the browser.
- `public/`: client, shared physics, renderers per category, `vendor/peerjs.min.js` (PeerJS 1.5.4, MIT).
- `public/sfx/`: sound effects. `token_place.mp3` plays when a chip is placed, `no_tokens_left.mp3` when a bet is refused (not enough Orra or over the level limit).

Testing with the Node server: `DEV=1 node server.js`, then `node bots.js ABCD 2` adds 2 bots to lobby ABCD.
`node bots.js ABCD 2 ws://localhost:8080 tilt` forces a subgame (DEV only).
