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
  + ';({ DRIVE, WORLD, OBST, TERRAIN, KART_R, drive, driveState, resetDrive, makeFixedLoop, savePrev, renderPose, groundY, solidAt })';

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

test('interpolation: drawn position moves forward on every frame at 144 fps', () => {
  const G = load(), k = kart(G, -25, -55, 0);
  const loop = G.makeFixedLoop(() => { G.savePrev(k); G.drive(k, 1, 0, G.DRIVE.STEP, 0); });
  let lastZ = -Infinity, lastD = 0;
  for (let f = 0; f < 288; f++) {
    loop.advance(1 / 144);
    assert.ok(loop.alpha >= 0 && loop.alpha <= 1, `alpha ${loop.alpha}`);
    const z = G.renderPose(k, loop.alpha).z;
    if (f > 20) { // once moving, every frame must show progress (no repeated frames, no stair-steps)
      const d = z - lastZ;
      assert.ok(d > 1e-6, `frame ${f}: drawn z did not advance`);
      if (f > 150) assert.ok(d < lastD * 1.6 && d > lastD / 1.6, `frame ${f}: uneven step ${d} after ${lastD}`);
      lastD = d;
    }
    lastZ = z;
  }
});

test('interpolation: renderPose blends previous and current state', () => {
  const G = load();
  const k = { x: 10, z: 20, yaw: 0.2, lean: 0.1, px: 0, pz: 0, pyaw: 0, plean: 0 };
  const half = G.renderPose(k, 0.5);
  assert.deepStrictEqual([half.x, half.z].map(v => +v.toFixed(9)), [5, 10]);
  assert.ok(Math.abs(half.yaw - 0.1) < 1e-9 && Math.abs(half.lean - 0.05) < 1e-9);
  // yaw blends the short way round across the +-PI seam
  const w = G.renderPose({ ...k, pyaw: Math.PI - 0.1, yaw: -Math.PI + 0.1 }, 0.5);
  assert.ok(Math.abs(Math.abs(w.yaw) - Math.PI) < 1e-9, `seam yaw ${w.yaw}`);
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
  // switching direction restarts the hold timer
  const s = driftRig(); s.steps(10, 1, 1); s.steps(10, 1, -1); assert.strictEqual(s.k.drift, 0);
  // speed threshold: hold the kart at a fixed speed (coasting) while holding the turn for 1 s
  const at = frac => {
    const r = driftRig();
    for (let i = 0; i < 60; i++) {
      const v = Math.hypot(r.k.vx, r.k.vz), want = frac * 26;
      r.k.vx *= want / v; r.k.vz *= want / v;
      r.steps(1, 0, 1);
      if (r.k.drift) return true;
    }
    return false;
  };
  // the check uses forward speed, which is a little under total speed while turning (~19 deg slip)
  assert.strictEqual(at(0.68), false, 'no drift just under 70%');
  assert.strictEqual(at(0.50), false, 'no drift at 50%');
  assert.strictEqual(at(0.80), true, 'drift above 70%');
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
  // counter-steer also ends it (and doesn't instantly start a drift the other way)
  const c = driftRig(); c.steps(30, 1, 1); assert.strictEqual(c.k.drift, 1);
  c.steps(1, 1, -1); assert.strictEqual(c.k.drift, 0);
  // the body angles into the turn: same sign as the yaw change
  for (const steer of [1, -1]) {
    const r = driftRig(); r.steps(40, 1, steer);
    const y0 = r.k.yaw; r.steps(1, 1, steer);
    assert.strictEqual(Math.sign(r.k.lean), Math.sign(wrapd(r.k.yaw - y0)), `lean sign for steer ${steer}`);
  }
  // the multiplier comes from config
  const m = driftRig({ DRIFT_TURN_MULT: 2 }); m.steps(30, 1, 1);
  const a2 = { ...m.k }, b2 = { ...m.k, drift: 0, steerDir: 0, steerHold: 0 };
  const ya2 = a2.yaw, yb2 = b2.yaw; m.G.drive(a2, 1, 1, m.G.DRIVE.STEP, 0); m.G.drive(b2, 1, 1, m.G.DRIVE.STEP, 0);
  assert.ok(Math.abs(wrapd(ya2 - a2.yaw) / wrapd(yb2 - b2.yaw) - 2) < 0.05, 'DRIFT_TURN_MULT is used');
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
  // no boost when a long drift dies from slowing down (braking while still holding the turn)
  {
    const r = driftRig(); r.steps(18 + 90, 1, 1); assert.strictEqual(r.k.drift, 1); // 1.5 s drift
    let n = 0, prev = Math.hypot(r.k.vx, r.k.vz), jumped = false;
    while (r.k.drift && n++ < 600) { r.steps(1, -1, 1); const v = Math.hypot(r.k.vx, r.k.vz); if (v > prev + 0.5) jumped = true; prev = v; }
    assert.strictEqual(r.k.drift, 0, 'drift ended by slowing down');
    assert.strictEqual(r.k.boostT, 0, 'no boost on a speed-out exit');
    assert.strictEqual(jumped, false, 'no forward shove while braking');
  }
  // counter-steering out of a long drift counts as releasing the turn: boost
  { const r = driftRig(); r.steps(18 + 70, 1, 1); r.steps(1, 1, -1); assert.ok(r.k.boostT > 0, 'boost on counter-steer exit'); }
  // the 1 s boundary: a drift exits on the release step, so held steps + 1 = drift duration in steps
  const boostAfter = heldSteps => { const r = driftRig(); r.steps(18 + heldSteps, 1, 1); r.steps(1, 1, 0); return r.k.boostT; };
  assert.strictEqual(boostAfter(56), 0, '0.95 s drift: no boost');
  assert.ok(boostAfter(62) > 0, '1.05 s drift: boost');
  // boost wears off
  const { k, steps } = driftRig(); steps(88, 1, 1); steps(1, 1, 0); steps(60, 1, 0);
  assert.strictEqual(k.boostT, 0);
  assert.ok(Math.hypot(k.vx, k.vz) <= 26 + 1e-9, 'back to normal top speed');
});

test('drift: ends when speed drops below 45% of top', () => {
  const { k, steps } = driftRig();
  steps(18, 1, 1); assert.strictEqual(k.drift, 1);
  let n = 0, before = 0;
  while (k.drift && n++ < 600) { before = Math.hypot(k.vx, k.vz); steps(1, -1, 1); } // brake while holding the turn
  assert.strictEqual(k.drift, 0);
  assert.ok(Math.hypot(k.vx, k.vz) < 0.45 * 26, 'ended below 45%');
  // pin the cut-off: hold a drifting kart at a fixed speed while coasting (coast drag takes ~2.8% off
  // before the check), and see whether the drift survives 10 steps
  const survives = frac => {
    const r = driftRig(); r.steps(30, 1, 1); assert.strictEqual(r.k.drift, 1);
    for (let i = 0; i < 10; i++) {
      const v = Math.hypot(r.k.vx, r.k.vz), want = frac * 26;
      r.k.vx *= want / v; r.k.vz *= want / v;
      r.steps(1, 0, 1);
      if (!r.k.drift) return false;
    }
    return true;
  };
  assert.strictEqual(survives(0.47), true, 'drift holds at 47% (45.7% after drag)');
  assert.strictEqual(survives(0.44), false, 'drift ends at 44%');
});

/* ---------- terrain: y axis ---------- */
// Lane x = -25 heading +z is clear of every obstacle; terrain for these tests is pushed into TERRAIN per test.
const PLATEAU = { x: -25, z: -20, w: 20, d: 20, y: 3 };                           // z -30..-10
const RAMP_Z = { x: -25, z: -35, w: 6, d: 10, y0: 0, y1: 3, dir: 'z' };            // z -40..-30, rises toward +z onto the plateau
function terrainRig(...entries) { const G = load(); G.TERRAIN.push(...entries); return G; }
// Drive n fixed steps with savePrev before each (as the game does), recording y along the way.
function steps(G, k, n, thr, steer = 0) { const ys = []; for (let i = 0; i < n; i++) { G.savePrev(k); G.drive(k, thr, steer, G.DRIVE.STEP, 0); ys.push(k.y); } return ys; }

test('terrain: groundY picks plateau, ramp low/mid/high, pit, and the highest of overlapping entries', () => {
  const G = terrainRig(PLATEAU, RAMP_Z, { x: 30, z: 30, w: 10, d: 10, y: -2 }, { x: 30, z: 30, w: 4, d: 4, y: 1 },
    { x: 0, z: 40, w: 10, d: 4, y0: 0, y1: 2, dir: '-x' });
  assert.strictEqual(G.groundY(0, 0), 0, 'flat ground');
  assert.strictEqual(G.groundY(-25, -20), 3, 'plateau top');
  assert.strictEqual(G.groundY(-25, -9.9), 0, 'just off the plateau');
  assert.ok(Math.abs(G.groundY(-25, -40)) < 1e-9, 'ramp low end');
  assert.ok(Math.abs(G.groundY(-25, -35) - 1.5) < 1e-9, 'ramp middle');
  assert.ok(Math.abs(G.groundY(-25, -30) - 3) < 1e-9, 'ramp high end');
  assert.ok(Math.abs(G.groundY(-27.9, -32.5) - 2.25) < 1e-9, 'ramp height is constant across its width');
  assert.strictEqual(G.groundY(30, 34), -2, 'pit');
  assert.strictEqual(G.groundY(30, 30), 1, 'overlap: the highest entry wins');
  assert.ok(Math.abs(G.groundY(5, 40)) < 1e-9 && Math.abs(G.groundY(-5, 40) - 2) < 1e-9 && Math.abs(G.groundY(0, 40) - 1) < 1e-9, '-x ramp rises toward -x');
});

test('terrain: a ramp raises the kart to the plateau top at full speed, in both directions and along x', () => {
  // up a +z ramp onto the plateau
  const G = terrainRig(PLATEAU, RAMP_Z), k = kart(G, -25, -55, 0);
  const ys = steps(G, k, 120, 1);
  assert.ok(k.z > -30 && k.z < -10, `on the plateau: z ${k.z}`);
  assert.strictEqual(k.y, 3, `top height ${k.y}`);
  assert.ok(ys.every(y => y >= -1e-9 && y <= 3 + 1e-9), 'y stays between ground and the top');
  const climb = ys.filter((y, i) => i && y > ys[i - 1]).length; assert.ok(climb > 8, `rose over several steps, not a snap (${climb})`);
  assert.ok(ys.every((y, i) => !i || y - ys[i - 1] < G.WORLD.STEP_UP), 'no single step bigger than STEP_UP');
  // back down the same ramp: stays on the surface, ends on flat ground
  const down = steps(G, Object.assign(k, { yaw: Math.PI, vx: 0, vz: 0 }), 150, 1);
  assert.ok(k.z < -42 && Math.abs(k.y) < 1e-9, `back on the flat: z ${k.z} y ${k.y}`);
  assert.ok(down.every((y, i) => !i || down[i - 1] - y < G.WORLD.STEP_UP), 'descended gradually');
  // a -z ramp onto the same plateau, driven heading -z from the far side
  const G2 = terrainRig(PLATEAU, { x: -25, z: -5, w: 6, d: 10, y0: 0, y1: 3, dir: '-z' }), k2 = kart(G2, -25, 20, Math.PI);
  steps(G2, k2, 120, 1); assert.strictEqual(k2.y, 3, `-z ramp: y ${k2.y} z ${k2.z}`);
  // a ramp along x (arena cleared of obstacles so the lane is free)
  const G3 = terrainRig({ x: 0, z: 0, w: 20, d: 20, y: 3 }, { x: -15, z: 0, w: 10, d: 6, y0: 0, y1: 3, dir: 'x' }); G3.OBST.length = 0;
  const k3 = kart(G3, -45, 0, Math.PI / 2); steps(G3, k3, 120, 1);
  assert.strictEqual(k3.y, 3, `x ramp: y ${k3.y} x ${k3.x}`);
  const G4 = terrainRig({ x: 0, z: 0, w: 20, d: 20, y: 3 }, { x: 15, z: 0, w: 10, d: 6, y0: 0, y1: 3, dir: '-x' }); G4.OBST.length = 0;
  const k4 = kart(G4, 45, 0, -Math.PI / 2); steps(G4, k4, 120, 1);
  assert.strictEqual(k4.y, 3, `-x ramp: y ${k4.y} x ${k4.x}`);
});

test('terrain: a ramp down into a pit and back out is drivable', () => {
  const PIT = { x: -25, z: -20, w: 20, d: 20, y: -2 }, R = { x: -25, z: -35, w: 6, d: 10, y0: -2, y1: 0, dir: '-z' };
  const G = terrainRig(PIT, R), k = kart(G, -25, -55, 0);
  const ys = steps(G, k, 120, 1);
  assert.ok(k.z > -30 && k.z < -10 && k.y === -2, `in the pit: z ${k.z} y ${k.y}`);
  assert.ok(ys.every((y, i) => !i || ys[i - 1] - y < G.WORLD.STEP_UP), 'rolled down the ramp, no drop');
  steps(G, Object.assign(k, { yaw: Math.PI, vx: 0, vz: 0 }), 150, 1);
  assert.ok(k.z < -42 && Math.abs(k.y) < 1e-9, `back out: z ${k.z} y ${k.y}`);
  // the pit's other sides are walls from inside: driving +z from inside the pit stops at the far side
  const k2 = kart(G, -25, -15, 0); k2.y = -2; steps(G, k2, 120, 1);
  assert.ok(k2.z <= -10 + 1e-9 && k2.y === -2, `pit wall holds: z ${k2.z} y ${k2.y}`);
});

test('terrain: a 3-unit plateau side blocks a kart (position reverts) while the ramp beside it is drivable', () => {
  const G = terrainRig(PLATEAU, RAMP_Z);
  // head-on into the plateau side next to the ramp
  const k = kart(G, -18, -55, 0); steps(G, k, 120, 1);
  assert.ok(k.z <= -30 + 1e-9, `stopped at the side: z ${k.z}`);
  assert.ok(k.z > -32, `pressed against the side, not bounced away: z ${k.z}`);
  assert.strictEqual(k.y, 0, 'did not climb'); assert.ok(Math.abs(k.x + 18) < 1e-9, 'x unchanged');
  // same start on the ramp lane makes it up
  const r = kart(G, -25, -55, 0); steps(G, r, 120, 1); assert.strictEqual(r.y, 3);
  // into the side along x: x stays outside, z slides freely (per-axis revert)
  G.OBST.length = 0;
  const s = kart(G, -55, -20, Math.PI / 2 + 0.3); steps(G, s, 120, 1);
  assert.ok(s.x <= -35 + 1e-9 && s.x > -37, `x held outside: ${s.x}`); assert.strictEqual(s.y, 0);
  assert.ok(s.z < -20, `slid along the wall: z ${s.z}`);
  // diagonal into a corner: both axes revert
  const c = kart(G, -40, -45, Math.atan2(5, 15)); steps(G, c, 120, 1);
  assert.ok(G.groundY(c.x, c.z) === 0 && c.y === 0, `corner: still on the flat at ${c.x},${c.z}`);
  // the velocity on the blocked axis is damped like an obstacle hit
  const v = kart(G, -18, -30.3, 0); v.vz = 20; G.savePrev(v); G.drive(v, 1, 0, G.DRIVE.STEP, 0);
  assert.ok(v.vz < 0 && v.vz > -8, `bounced back gently: vz ${v.vz}`); assert.ok(Math.abs(v.z + 30.3) < 1e-9, 'position reverted to before the step');
});

test('terrain: driving off a plateau falls under gravity and lands at 0, never below', () => {
  const G = terrainRig(PLATEAU), k = kart(G, -25, -14, 0); k.y = 3; k.py = 3;
  const ys = steps(G, k, 120, 1);
  const first = ys.findIndex(y => y < 3);
  assert.ok(first > 0, 'left the edge');
  assert.ok(ys[first] > 2.9, `first airborne step is a small drop, not a snap: ${ys[first]}`);
  const air = ys.filter(y => y > 0 && y < 3).length;
  assert.ok(air >= 15, `in the air for several steps (${air})`);
  for (let i = first + 1; i < first + air; i++) assert.ok(ys[i] - ys[i - 1] < ys[i - 1] - ys[i - 2] + 1e-9 || ys[i] === 0, 'accelerating downward');
  assert.ok(ys.every(y => y >= 0), 'never below ground');
  assert.strictEqual(k.y, 0); assert.strictEqual(k.vy, 0);
  // the fall follows GRAVITY: y after n airborne steps = 3 - G/2 * (n dt)^2 (summed per step)
  let y = 3, vy = 0; for (let i = 0; i < 10; i++) { vy -= G.WORLD.GRAVITY * G.DRIVE.STEP; y += vy * G.DRIVE.STEP; }
  assert.ok(Math.abs(ys[first + 9] - y) < 1e-9, `gravity integration: ${ys[first + 9]} vs ${y}`);
  // a dead kart is left alone
  const d = kart(G, -25, -14, 0); d.y = 3; d.alive = false; steps(G, d, 10, 1); assert.strictEqual(d.y, 3);
});

test('terrain: 2 s full throttle from a plateau covers identical distance and final y at 30, 60, 144 fps', () => {
  const go = fps => {
    const G = terrainRig(PLATEAU), k = kart(G, -25, -28, 0); k.y = 3; k.py = 3;
    const { steps: n } = run(G, k, fps, 2, FULL);
    assert.strictEqual(n, 120);
    return { d: Math.hypot(k.x + 25, k.z + 28), y: k.y, z: k.z };
  };
  const a = go(30), b = go(60), c = go(144);
  console.log(`  from plateau: 30fps=${a.d.toFixed(6)} y=${a.y}  60fps=${b.d.toFixed(6)} y=${b.y}  144fps=${c.d.toFixed(6)} y=${c.y}`);
  assert.ok(a.z > -10, 'drove off the plateau edge');
  assert.strictEqual(a.y, 0, 'landed'); assert.strictEqual(b.y, a.y); assert.strictEqual(c.y, a.y);
  assert.ok(Math.abs(a.d - b.d) < 1e-9 && Math.abs(a.d - c.d) < 1e-9, `${a.d} ${b.d} ${c.d}`);
  // interpolation covers y too
  const G = load(); const p = G.renderPose({ x: 0, z: 0, y: 2, px: 0, pz: 0, py: 1, yaw: 0, pyaw: 0, lean: 0, plean: 0 }, 0.5);
  assert.strictEqual(p.y, 1.5);
  // resetDrive keeps the kart's height (respawn sets y = groundY first)
  const k = kart(G, 0, 0, 0); k.y = 3; G.resetDrive(k); assert.strictEqual(k.y, 3); assert.strictEqual(k.py, 3); assert.strictEqual(k.vy, 0);
});

test('terrain: solidAt treats ground above a given height as solid; without y it ignores terrain', () => {
  const G = terrainRig(PLATEAU, RAMP_Z);
  assert.strictEqual(G.solidAt(-25, -20, 0.3), false, 'old signature: terrain ignored');
  assert.strictEqual(G.solidAt(-25, -20, 0.3, 1.1), true, 'a shot at 1.1 hits the 3-high plateau');
  assert.strictEqual(G.solidAt(-25, -20, 0.3, 4.1), false, 'a shot fired from the plateau flies over it');
  assert.strictEqual(G.solidAt(-25, -39, 0.3, 1.1), false, 'low end of the ramp is below the shot');
  assert.strictEqual(G.solidAt(-25, -31, 0.3, 1.1), true, 'high end of the ramp is above it');
  assert.strictEqual(G.solidAt(0, 0, 0.3, 1.1), false, 'flat ground');
  assert.strictEqual(G.solidAt(14, 14, 0.3, 1.1), true, 'obstacles still count');
});
