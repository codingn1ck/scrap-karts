// Driving physics tests. Runs the real code from index.html (not a copy):
// the config block at the top of the script and the "physics" section.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a);
  assert.ok(a >= 0 && b > a, `markers not found: ${from} .. ${to}`);
  return html.slice(a, b);
}
const code = slice("'use strict';", '/* ---------- three.js scene ---------- */')
  + slice('/* ---------- physics ---------- */', '/* ---------- weapons & projectiles ---------- */')
  + ';({ DRIVE, OBST, drive, driveState, makeFixedLoop, savePrev, renderPose })';

// Fresh copy of the game code for each test, so config tweaks don't leak.
function load() { return vm.runInNewContext(code, { document: {}, Math, Object, Array, String, Number }); }
function kart(G, x, z, yaw) { return { x, z, yaw, alive: true, frozenUntil: 0, starUntil: 0, ...G.driveState(), px: x, pz: z, pyaw: yaw }; }

// Drive `seconds` of game time at a given frame rate through the fixed-step loop.
function run(G, k, fps, seconds, input) {
  const loop = G.makeFixedLoop(dt => { G.savePrev(k); const i = input(); G.drive(k, i.thr, i.steer, dt, 0); });
  let steps = 0;
  for (let f = 0; f < Math.round(seconds * fps); f++) steps += loop.advance(1 / fps);
  return { steps, loop };
}
const FULL = () => ({ thr: 1, steer: 0 });

test('config: driving numbers live in DRIVE', () => {
  const { DRIVE } = load();
  assert.strictEqual(DRIVE.REVERSE_RATIO, 0.8);
  assert.strictEqual(DRIVE.STEP, 1 / 60);
  for (const key of ['DRIFT_GRIP', 'DRIFT_TURN_MULT', 'DRIFT_BODY_ANGLE', 'DRIFT_HOLD_TIME', 'DRIFT_START_SPEED', 'DRIFT_END_SPEED', 'DRIFT_BOOST', 'DRIFT_BOOST_SPEED', 'DRIFT_BOOST_TIME'])
    assert.ok(key in DRIVE, key);
});

test('fixed timestep: 2 s full throttle covers the same distance at 30, 60, 144 fps and jittery frames', () => {
  // lane x = -25 heading +z is clear of every obstacle
  const dist = fps => {
    const G = load(), k = kart(G, -25, -55, 0);
    const { steps } = run(G, k, fps, 2, FULL);
    assert.strictEqual(steps, 120, `${fps} fps should run exactly 120 physics steps`);
    return Math.hypot(k.x + 25, k.z + 55);
  };
  const d30 = dist(30), d60 = dist(60), d144 = dist(144);
  // jittery frame times that still add up to 2 s
  const G = load(), k = kart(G, -25, -55, 0), loop = G.makeFixedLoop(() => { G.savePrev(k); G.drive(k, 1, 0, G.DRIVE.STEP, 0); });
  const jitter = [1 / 30, 1 / 144, 1 / 75, 1 / 50, 1 / 144, 1 / 60];
  let t = 0, i = 0; while (t < 2 - 1e-9) { const f = Math.min(jitter[i++ % jitter.length], 2 - t); loop.advance(f); t += f; }
  const dJ = Math.hypot(k.x + 25, k.z + 55);
  console.log(`  distance in 2 s: 30fps=${d30.toFixed(6)}  60fps=${d60.toFixed(6)}  144fps=${d144.toFixed(6)}  jitter=${dJ.toFixed(6)}`);
  assert.ok(d30 > 30, 'kart actually moved');
  assert.ok(Math.abs(d30 - d144) < 1e-9, `30fps ${d30} vs 144fps ${d144}`);
  assert.ok(Math.abs(d30 - d60) < 1e-9);
  assert.ok(Math.abs(d30 - dJ) < 1e-9);
});

test('interpolation: drawn position moves smoothly forward every frame at 144 fps', () => {
  const G = load(), k = kart(G, -25, -55, 0);
  const loop = G.makeFixedLoop(() => { G.savePrev(k); G.drive(k, 1, 0, G.DRIVE.STEP, 0); });
  let lastZ = -Infinity;
  for (let f = 0; f < 288; f++) {
    loop.advance(1 / 144);
    const z = G.renderPose(k, loop.alpha).z;
    assert.ok(z >= lastZ - 1e-9, `frame ${f}: drawn z went backwards`);
    lastZ = z;
  }
});

test('reverse: same acceleration as forward, top speed = REVERSE_RATIO * top', () => {
  const G = load(), D = G.DRIVE;
  const fwd = kart(G, -25, 0, 0), rev = kart(G, -25, 0, 0);
  for (let i = 0; i < 12; i++) { G.drive(fwd, 1, 0, D.STEP, 0); G.drive(rev, -1, 0, D.STEP, 0); }
  assert.ok(Math.abs(Math.abs(rev.vz) - Math.abs(fwd.vz)) < 1e-9, `0.2 s from rest: fwd ${fwd.vz} rev ${rev.vz}`);
  // peak speed over 3 s (speed ripples by ~1% step to step as drag and throttle alternate)
  const peak = (G, thr) => { const k = kart(G, -25, thr > 0 ? -55 : 55, 0); let m = 0; for (let i = 0; i < 180; i++) { G.drive(k, thr, 0, D.STEP, 0); m = Math.max(m, Math.hypot(k.vx, k.vz)); } return m; };
  const fTop = peak(G, 1), rTop = peak(G, -1);
  assert.ok(Math.abs(fTop - D.TOP_SPEED) < 1e-6, `forward top ${fTop}`);
  assert.ok(Math.abs(rTop - D.TOP_SPEED * 0.8) < 1e-6, `reverse top ${rTop}`);
  // ratio is just a config value
  const G2 = load(); G2.DRIVE.REVERSE_RATIO = 1.0;
  assert.ok(Math.abs(peak(G2, -1) - D.TOP_SPEED) < 1e-6);
});

// Drift tests run in an open arena (no obstacles) so the kart can circle freely.
function driftRig(cfg = {}) {
  const G = load(); G.OBST.length = 0; Object.assign(G.DRIVE, cfg);
  const k = kart(G, 0, -40, 0), S = G.DRIVE.STEP;
  const steps = (n, thr, steer) => { for (let i = 0; i < n; i++) G.drive(k, thr, steer, S, 0); };
  steps(120, 1, 0); // 2 s straight: up to top speed
  return { G, k, steps };
}

test('drift: needs 0.3 s of the same turn above 70% top speed', () => {
  const { k, steps } = driftRig();
  steps(17, 1, 1); assert.strictEqual(k.drift, 0, 'not yet at 0.283 s');
  steps(1, 1, 1);  assert.strictEqual(k.drift, 1, 'drifting at 0.3 s');
  // too slow: no drift even with a long hold
  const r = driftRig(); r.steps(150, 0, 0); // coast down
  assert.ok(Math.hypot(r.k.vx, r.k.vz) < 0.7 * 26);
  r.steps(60, 0, 1); assert.strictEqual(r.k.drift, 0);
  // switching direction restarts the hold timer
  const s = driftRig(); s.steps(10, 1, 1); s.steps(10, 1, -1); assert.strictEqual(s.k.drift, 0);
});

const slipDeg = k => Math.abs(Math.atan2(k.vx * Math.cos(k.yaw) - k.vz * Math.sin(k.yaw), k.vx * Math.sin(k.yaw) + k.vz * Math.cos(k.yaw))) * 180 / Math.PI;

test('drift: slides more than normal cornering, keeps speed, turns faster, angles the body, ends on release', () => {
  const { G, k, steps } = driftRig();
  const normal = driftRig({ DRIFT_HOLD_TIME: 1e9 }); // same input, drift never starts
  steps(120, 1, 1); normal.steps(120, 1, 1);
  assert.strictEqual(k.drift, 1); assert.strictEqual(normal.k.drift, 0);
  console.log(`  slip angle: drifting ${slipDeg(k).toFixed(1)} deg vs normal turn ${slipDeg(normal.k).toFixed(1)} deg; drift speed ${Math.hypot(k.vx, k.vz).toFixed(2)}`);
  assert.ok(slipDeg(k) > slipDeg(normal.k) + 8, 'kart slides noticeably more while drifting');
  assert.ok(Math.hypot(k.vx, k.vz) > 25, 'a held drift does not bleed speed');
  assert.ok(Math.abs(Math.abs(k.lean) - 20 * Math.PI / 180) < 1e-3, `body angle ${k.lean * 180 / Math.PI} deg`);
  // turn rate: one step of drift vs normal at identical speed
  const a = { ...k }, b = { ...k, drift: 0, steerDir: 0, steerHold: 0 };
  const ya = a.yaw, yb = b.yaw; G.drive(a, 1, 1, G.DRIVE.STEP, 0); G.drive(b, 1, 1, G.DRIVE.STEP, 0);
  const ratio = wrapd(ya - a.yaw) / wrapd(yb - b.yaw);
  assert.ok(Math.abs(ratio - 1.3) < 0.05, `turn rate ratio ${ratio}`);
  steps(1, 1, 0); assert.strictEqual(k.drift, 0, 'released turn ends drift');
});
const wrapd = a => Math.atan2(Math.sin(a), Math.cos(a));

test('drift: boost after >1 s, none for short drifts, toggle works', () => {
  const S = 1 / 60;
  const exitSpeed = (cfg, driftSteps) => {
    const { k, steps } = driftRig(cfg);
    steps(18 + driftSteps, 1, 1);
    assert.strictEqual(k.drift, 1);
    steps(1, 1, 0);
    const v0 = Math.hypot(k.vx, k.vz), boostT = k.boostT;
    steps(Math.round(0.4 / S), 1, 0); // 0.4 s later, still inside the boost window
    return { v0, boostT, v: Math.hypot(k.vx, k.vz) };
  };
  const long = exitSpeed({}, 70), short = exitSpeed({}, 30), off = exitSpeed({ DRIFT_BOOST: false }, 70);
  assert.ok(long.boostT > 0.7, 'boost timer set');
  assert.strictEqual(short.boostT, 0, 'no boost for a 0.5 s drift');
  assert.strictEqual(off.boostT, 0, 'toggle off: no boost');
  assert.ok(long.v > 26 + 3.5, `boosted speed ${long.v}`);
  assert.ok(off.v <= 26 + 1e-9, `unboosted speed ${off.v}`);
  // boost wears off
  const { k, steps } = driftRig(); steps(88, 1, 1); steps(1, 1, 0); steps(60, 1, 0);
  assert.strictEqual(k.boostT, 0);
  assert.ok(Math.hypot(k.vx, k.vz) <= 26 + 1e-9, 'back to normal top speed');
});

test('drift: ends when speed drops below 45% of top', () => {
  const { k, steps } = driftRig();
  steps(18, 1, 1); assert.strictEqual(k.drift, 1);
  let n = 0; while (k.drift && n++ < 600) steps(1, -1, 1); // brake while holding the turn
  assert.strictEqual(k.drift, 0);
  assert.ok(Math.hypot(k.vx, k.vz) < 0.45 * 26 + 1, `ended at ${Math.hypot(k.vx, k.vz)}`);
});
