// Weapon engine tests. Runs the real code from index.html (not a copy): the config block at the top of the
// script (WEAPONS, SHOT_OF, STATE_OF, DEF) and the physics section (splashDmg, arcStep, blockedAt).
// Run with: node test/weapons.test.js
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
  + ';({ WORLD, KART_R, OBST, TERRAIN, WEAPONS, SHOT_OF, STATE_OF, DEF, groundY, solidAt, blockedAt, splashDmg, arcStep })';
const G = vm.runInNewContext(code, { document: {}, Math, Object, Array, String, Number });
const { WORLD, KART_R, OBST, WEAPONS, SHOT_OF, STATE_OF, DEF, groundY, solidAt, blockedAt, splashDmg, arcStep } = G;

// Fly an arcing shot of `type` from (x, z) at height launchY along yaw with 16 ms steps (like the game's catch-up)
// until it lands; returns where, the ground height there, the flight time and the highest point.
function fly(type, x, z, yaw, launchY = 0) {
  const d = DEF[type], p = { x, z, y: launchY + 1.5, vx: Math.sin(yaw) * d.spd, vz: Math.cos(yaw) * d.spd, vy: d.vy };
  let t = 0, top = p.y;
  for (; t < 10; t += 0.016) { const g = arcStep(p, 0.016, d.bounce); top = Math.max(top, p.y); if (g !== null) return { x: p.x, z: p.z, g, t, top, p }; }
  throw new Error('never landed');
}

test('every weapon id fires a shot type or sets a state; every shot type is fully defined', () => {
  for (const id in WEAPONS) assert.ok(SHOT_OF[id] || STATE_OF[id], `${id} maps to a shot type or a state`);
  for (const id in SHOT_OF) assert.ok(DEF[SHOT_OF[id]], `${id} -> DEF.${SHOT_OF[id]}`);
  for (const id in STATE_OF) assert.ok(STATE_OF[id].key.endsWith('Until') && STATE_OF[id].dur > 0, `${id} state`);
  assert.deepStrictEqual(Object.keys(DEF).sort(), ['c', 'f', 'g', 'h', 'l', 'm', 'n', 'r', 'x'], 'the nine network shot types');
  for (const t in DEF) {
    const d = DEF[t];
    assert.ok(d.life > 0, `${t}.life`);
    assert.ok(typeof d.dmg === 'number' && d.dmg > 0, `${t}.dmg`);
    if (d.blast) { assert.ok(Array.isArray(d.splash) && d.splash.length === 2 && d.splash[0] >= d.splash[1], `${t}.splash [centre, edge]`); assert.strictEqual(d.splash[0], d.dmg, `${t}: centre splash equals a direct hit`); }
    if (d.spd) assert.ok(d.hit > 0, `${t}.hit: moving shots need a hit radius`);
    else assert.ok(d.prox > 0 && d.drop, `${t}: placed shots need a trigger radius and drop behind the kart`);
    if (d.vy) assert.ok(d.bounce > 0 && d.bounce < 1, `${t}.bounce`);
    if (d.spread) assert.ok(d.spread.includes(0) && d.spread.length === 3, `${t}.spread is a centred triple`);
  }
  // the design numbers (damage against 100 HP)
  assert.strictEqual(WORLD.HP_MAX, 100);
  assert.deepStrictEqual([DEF.r.dmg, DEF.g.dmg, DEF.h.dmg, DEF.f.dmg, DEF.c.dmg, DEF.l.dmg, DEF.x.dmg], [60, 7, 4, 10, 45, 80, 35]);
  assert.deepStrictEqual([DEF.r.blast, DEF.c.blast, DEF.l.blast, DEF.n.blast], [4.5, 4, 7.5, 14]);
  assert.ok(DEF.n.dmg >= WORLD.HP_MAX && DEF.m.dmg >= WORLD.HP_MAX, 'nuke and mine smash outright');
  assert.strictEqual(DEF.h.cd, 90); assert.strictEqual(DEF.g.cd, 170); assert.ok(DEF.h.hold, 'machine gun is held');
  assert.strictEqual(DEF.f.freeze, 2000);
  assert.strictEqual(WEAPONS.machinegun.ch, 40);
});

test('splash damage: full at the centre, the edge value at blast + KART_R, nothing beyond, linear between', () => {
  assert.strictEqual(splashDmg('r', 0), 60);
  const edge = DEF.r.blast + KART_R; // 6
  assert.ok(Math.abs(splashDmg('r', edge - 1e-9) - 20) < 1e-6, 'edge value');
  assert.strictEqual(splashDmg('r', edge), 0);
  assert.strictEqual(splashDmg('r', 100), 0);
  assert.strictEqual(splashDmg('r', edge / 2), 40, 'halfway = average of centre and edge');
  assert.strictEqual(splashDmg('c', (DEF.c.blast + KART_R) / 2), 30);
  assert.strictEqual(splashDmg('l', 0), 80); assert.ok(splashDmg('l', 9 - 1e-9) > 29.9);
  assert.strictEqual(splashDmg('n', 15), 999, 'nuke smashes everything in its blast');
  assert.strictEqual(splashDmg('n', 16), 0);
  assert.strictEqual(splashDmg('g', 0), 0, 'bullets have no blast');
  assert.strictEqual(splashDmg('zz', 0), 0);
});

test('blockedAt: obstacles only block up to their height, walls and plateau sides always', () => {
  const c = OBST.find(o => o.w === 22 && o.d === 5); // 22x5 container, 4 high
  assert.ok(solidAt(c.x, c.z, 0.6, 2), 'solidAt ignores height for obstacles');
  assert.ok(blockedAt(c.x, c.z, 0.6, 2), 'below the top: blocked');
  assert.ok(!blockedAt(c.x, c.z, 0.6, c.h + 0.5), 'above the top: free');
  assert.ok(blockedAt(99.9, 0, 0.6, 50), 'the arena wall has no top');
  assert.ok(blockedAt(13.9, 0, 0.6, 1.1), 'plateau side from the ground'); // plateau (y 3) edge at x = 14
  assert.ok(!blockedAt(13.9, 0, 0.6, 3.5), 'over the plateau');
});

test('arcs: a grenuke and a cannon ball fired from the ground clear the 22x5 container and the plateau edge', () => {
  const c = OBST.find(o => o.w === 22 && o.d === 5 && o.x > 0 && o.z > 0); // (16, 60), z 57.5..62.5
  // grenuke from 15 units before the container, straight at it (+z): first landing well past it
  const l = fly('l', c.x, c.z - 15, 0);
  assert.ok(l.top > 6, `grenuke apex ${l.top.toFixed(2)} (needs ~6 to clear containers)`);
  assert.ok(l.z > c.z + c.d / 2 + 2, `grenuke lands beyond the container: z ${l.z.toFixed(1)}`);
  assert.ok(l.z - (c.z - 15) > 18 && l.z - (c.z - 15) < 26, `grenuke first landing at ${(l.z - (c.z - 15)).toFixed(1)} units`);
  // cannon ball with its apex over the container (fired ~10.5 units before it) also clears it
  const cb = fly('c', c.x, c.z - 10.5, 0);
  assert.ok(cb.z > c.z + c.d / 2 + 2, `cannon ball lands beyond the container: z ${cb.z.toFixed(1)}`);
  assert.ok(cb.z - (c.z - 10.5) > 19 && cb.z - (c.z - 10.5) < 25, `cannon range ${(cb.z - (c.z - 10.5)).toFixed(1)}`);
  // a cannon ball fired from right in front of the container hits its side and bounces back
  const back = fly('c', c.x, c.z - 4, 0);
  assert.ok(back.z < c.z - c.d / 2, `bounced off the container: lands at z ${back.z.toFixed(1)}`);
  // both reach the central plateau (y 3, edge at x = -14) from the ground at x = -24 and land on top of it
  for (const t of ['c', 'l']) {
    const r = fly(t, -24, 10, Math.PI / 2);
    assert.strictEqual(r.g, 3, `${t} lands on the plateau (x ${r.x.toFixed(1)})`);
    assert.ok(r.x > -14 && r.x < 14, `${t} landed inside the plateau: x ${r.x.toFixed(1)}`);
  }
  // a wall bounce flips the velocity along the wall's normal
  const p = { x: 97, z: 0, y: 3, vx: 20, vz: 0, vy: 5 };
  arcStep(p, 0.1, 0.4);
  assert.ok(p.vx < 0 && Math.abs(p.vx) === 8, `vx after wall bounce ${p.vx}`);
});

test('cannon ball: a kart 20 units ahead on flat ground is a direct hit (ball within its hit radius at its level)', () => {
  // in the clear lane x = -25 (the origin is the plateau with the tyre stack on it)
  const d = DEF.c, p = { x: -25, z: -50, y: 1.5, vx: 0, vz: d.spd, vy: d.vy }, kart = { x: -25, z: -30, y: 0 };
  let direct = false;
  for (let t = 0; t < 3 && !direct; t += 0.016) {
    const g = arcStep(p, 0.016, d.bounce);
    if (Math.abs(kart.y - p.y) < 2.2 && Math.hypot(kart.x - p.x, kart.z - p.z) < d.hit + KART_R) direct = true;
    if (g !== null) break;
  }
  assert.ok(direct, 'direct hit before landing');
});
