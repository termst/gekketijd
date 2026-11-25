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

Testing with the Node server: `DEV=1 node server.js`, then `node bots.js ABCD 2` adds 2 bots to lobby ABCD.
`node bots.js ABCD 2 ws://localhost:8080 tilt` forces a subgame (DEV only).
