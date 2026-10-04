# Scrap Karts

Arena kart brawler: 3-minute rounds, one hit = one smash = one point, 3-second respawns, random weapons from ? boxes, bots when you're alone.

## Run it on your own computer

You need Node.js 18 or newer.

```
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can join at `http://YOUR-LOCAL-IP:3000` (find your IP with `ipconfig` on Windows or `ifconfig` on Mac/Linux).

## Put it online for friends anywhere

Any host that runs a Node.js web service with WebSockets works (Render, Railway, Fly.io, a small VPS).

1. Push this folder to a GitHub repo.
2. Create a new web service from that repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Share the URL. Everyone types the same room code on the menu.

The host sets the `PORT` environment variable; the server picks it up automatically.

## How it works

`index.html` is the whole game. It loads three.js (r186) as ES modules from cdn.jsdelivr.net, so players need an internet connection even when the server runs on your own network. `server.js` serves that page and the 3D models in `assets/`, and relays each player's state to the others in the same room (max 12 per room). Every player's browser is the authority for its own kart: it decides when it has been hit and tells everyone. That keeps the server tiny, but it also means a player could cheat by editing their page. Fine for friends, not for strangers.

Opening `index.html` straight from disk still works for solo play with bots, but browsers block loading the models from `file://`, so you get the built-in fallback karts and scenery.

## Graphics

The menu and the in-game settings panel have a Low/High quality switch. High adds ambient occlusion, sharper shadows and a higher render resolution; if the frame rate stays under 45 fps on High, the game drops to Low by itself and says so. The choice is remembered per browser.

The karts and track props are from Kenney's [Car Kit](https://kenney.nl/assets/car-kit) and [Racing Kit](https://kenney.nl/assets/racing-kit) (CC0, licence files in `assets/car-kit/` and `assets/racing-kit/`). Containers, crates, tyre stacks, the arena and the fallback kart are built in code.

Add `?debug` to the URL to expose the game state as `window.SK` in the browser console (used by the automated browser tests).

## Tuning

The numbers you'd most likely want to change are at the top of the script in `index.html`: `ROUND_MS` (round length), `RESPAWN_MS`, `BOX_RESPAWN`, the `WEAPONS` table (charges and how often each drops), and `DEF` (projectile speed, blast radius). Kart handling numbers (speeds, grip, reverse ratio, drifting and the drift boost toggle) are all in the `DRIVE` object at the top of the script; the code that uses them is `drive()`. Kart driving runs at a fixed 60 Hz; projectiles, boxes and the HUD still update once per frame. `npm test` checks the driving model.
