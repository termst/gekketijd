# Rare Hours (gekketijd)

Multiplayer wheel game with 16 minigames. Play money only (Orra), no real money.
Dependency free: plain Node 18+, no `npm install` needed.

## Play online with friends (free, one time setup)

GitHub Pages cannot run the game server, so it runs on Render (free plan).

1. Go to https://dashboard.render.com/blueprints and sign in with GitHub.
2. Click **New Blueprint Instance**, pick the `termst/gekketijd` repo, click **Apply**.
3. Wait about 2 minutes. Render gives you a URL like `https://rare-hours.onrender.com`.
4. Open it, create a lobby, click "Copy invite link" and send it to friends.

Notes on the free plan:
- The server sleeps after 15 minutes without visitors. The first visit after that takes about 30 to 50 seconds to load.
- Profiles and balances live in `data.json`, which resets when Render restarts or redeploys. For permanent saves, attach a disk (paid) and set the env var `DATA_FILE=/var/data/data.json`.
- Every push to `main` redeploys automatically.

Other hosts work too (Railway, Fly.io, any VPS): start command `node server.js`, the server reads the `PORT` env var.

## Run locally

```
node server.js
```

Open http://localhost:8080. Friends on the same wifi use `http://<your-ip>:8080`.

## How to play

- Create a lobby (auto 4 character code, or choose your own), share the code or "Copy invite link".
- Currency: Orra. Chips 5, 10, 25, 100, 500 are betting tokens.
- Rounds run automatically: 8 s betting (skipped when everyone presses Ready), 3 to 7 s spin.

## Testing

`DEV=1 node server.js`, then `node bots.js CODE 2` adds 2 bots to lobby CODE.
`node bots.js CODE 2 ws://localhost:8080 tilt` forces a subgame (DEV only). In the browser console: `RHforce('drop','tilt')`.

## Layout

- `server.js`: lobbies, timers, wheel RNG with progressive bonus luck, economy, bonus host
- `games/<category>/*.js`: 16 subgames, one module each, same interface (start, act, view)
- `public/`: client, shared physics and ricochet code, renderers per category
- `render.yaml`: Render deploy config
