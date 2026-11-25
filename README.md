# Rare Hours (gekketijd)

Multiplayer wheel game with 16 minigames. Play money only (Orra), no real money.

## Play

**https://termst.github.io/gekketijd/**

1. Enter a name and click **Create**. Your browser is now the host of the lobby.
2. Click **Copy invite link** and send it to friends (or give them the 4 character code).
3. Friends open the link and click **Join**. Up to 8 players.

How it works: everything runs on GitHub Pages, no server or account needed. The lobby creator's browser runs the game, the other players connect to it directly (peer to peer, WebRTC). The free PeerJS service is only used to find each other.

Good to know:
- The host must keep the game tab open. If the host closes it, the lobby ends. Keep the host tab visible: browsers slow down timers in background tabs.
- Balances, level and items are saved in each player's own browser (localStorage).
- Some strict networks (school, office, some mobile carriers) block peer to peer connections. Then try another network or a phone hotspot.

## Bonus games: backers and late buy-ins

The wheel pays 1, 2, 5 and 10 to 1 on the number fields.

When the wheel lands on a bonus field, players who bet on it (backers) always play. Everyone else online gets a 7 second buy-in window:

- Late cap: 25% to 50% of the top backer's stake (`0.25 + 0.25 * backers / players`), never below one 5 chip, within balance and the level limit left this round.
- Late joiners collect 60% of their multiplier and get no Prime Minute boost.
- Backers move first (biggest stake first) and get an Edge Shield that blocks the first attack from a late joiner, without using up a real Shield.
- The window closes early once every eligible player has bought in or pressed Watch.

Tuning lives at the top of `public/core.js` (`JOIN_MS`, `LATE_PAY`, `lateShare`). Subgames can read `ctx.backer(pid)` and `ctx.late(pid)` for game specific edges.

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
