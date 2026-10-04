// Arena map tests. Runs the real layout and physics code from index.html (not a copy):
// the config block at the top of the script (HALF, OBST, BOX_SPOTS, SPAWNS, TERRAIN) and the physics
// section (groundY, solidAt). Run with: node test/map.test.js
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
  + ';({ HALF, WALL_IN, KART_R, WORLD, OBST, BOX_SPOTS, SPAWNS, TERRAIN, groundY, solidAt })';
const G = vm.runInNewContext(code, { document: {}, Math, Object, Array, String, Number });
const { HALF, WALL_IN, KART_R, WORLD, OBST, BOX_SPOTS, SPAWNS, TERRAIN, groundY, solidAt } = G;

const EPS = 1e-6;
const rect = t => ({ x0: t.x - t.w / 2, z0: t.z - t.d / 2, x1: t.x + t.w / 2, z1: t.z + t.d / 2 });
const overlap = (a, b, margin = 0) => { // true when the two rectangles share area (touching edges do not count)
  const A = rect(a), B = rect(b);
  return A.x0 < B.x1 + margin - EPS && B.x0 < A.x1 + margin - EPS && A.z0 < B.z1 + margin - EPS && B.z0 < A.z1 + margin - EPS;
};
const TOPS = TERRAIN.filter(t => !t.dir), RAMPS = TERRAIN.filter(t => t.dir);
const rampEnds = r => { // centre of the low end and of the high end, and the unit vector pointing up the ramp
  const ux = r.dir === 'x' ? 1 : r.dir === '-x' ? -1 : 0, uz = r.dir === 'z' ? 1 : r.dir === '-z' ? -1 : 0, L = ux ? r.w : r.d;
  return { ux, uz, L, low: [r.x - ux * L / 2, r.z - uz * L / 2], high: [r.x + ux * L / 2, r.z + uz * L / 2], width: ux ? r.d : r.w };
};
// the top (plateau or pit) a ramp's high end is flush with
const servedBy = r => {
  const { high, ux, uz } = rampEnds(r);
  return TOPS.find(t => Math.abs(t.y - r.y1) < EPS && Math.abs(groundY(high[0] + ux * 0.01, high[1] + uz * 0.01) - r.y1) < EPS
    && Math.abs(high[0] + ux * 0.01 - t.x) <= t.w / 2 && Math.abs(high[1] + uz * 0.01 - t.z) <= t.d / 2);
};

test('arena is 200 x 200', () => {
  assert.strictEqual(HALF, 100);
  assert.strictEqual(WALL_IN, HALF - 0.6);
});

test('terrain: every ramp is 8 wide, 12 long, and has no step at either end', () => {
  assert.ok(RAMPS.length >= 12, `ramps: ${RAMPS.length}`);
  for (const r of RAMPS) {
    const E = rampEnds(r);
    assert.strictEqual(E.width, 8, `ramp at ${r.x},${r.z} width`);
    assert.strictEqual(E.L, 12, `ramp at ${r.x},${r.z} length`);
    // the ground just outside the low end is at y0, the top just past the high end is at y1 (checked across the width)
    for (const s of [-0.45, 0, 0.45]) {
      const ox = E.ux ? 0 : s * E.width, oz = E.uz ? 0 : s * E.width;
      assert.ok(Math.abs(groundY(E.low[0] - E.ux * 0.3 + ox, E.low[1] - E.uz * 0.3 + oz) - r.y0) < EPS, `ramp at ${r.x},${r.z}: step at the low end`);
      assert.ok(Math.abs(groundY(E.high[0] + E.ux * 0.3 + ox, E.high[1] + E.uz * 0.3 + oz) - r.y1) < EPS, `ramp at ${r.x},${r.z}: step at the high end`);
      // the ramp surface itself runs linearly from y0 to y1
      for (const f of [0.1, 0.5, 0.9]) {
        const x = E.low[0] + E.ux * E.L * f + ox, z = E.low[1] + E.uz * E.L * f + oz;
        assert.ok(Math.abs(groundY(x, z) - (r.y0 + (r.y1 - r.y0) * f)) < 1e-6, `ramp at ${r.x},${r.z}: surface at ${f}`);
      }
    }
    assert.ok(servedBy(r), `ramp at ${r.x},${r.z} does not end flush with a plateau or pit`);
  }
});

test('terrain: every plateau and pit has at least two ramps and stays 6 units off the wall', () => {
  assert.ok(TOPS.length >= 9, `tops: ${TOPS.length}`);
  for (const t of TOPS) {
    const n = RAMPS.filter(r => servedBy(r) === t).length;
    assert.ok(n >= 2, `top at ${t.x},${t.z} (y ${t.y}) has ${n} ramp(s)`);
    const R = rect(t);
    assert.ok(Math.max(Math.abs(R.x0), Math.abs(R.x1), Math.abs(R.z0), Math.abs(R.z1)) <= HALF - 6, `top at ${t.x},${t.z} is too close to the wall`);
  }
  // ramps never lie inside another entry (only touch at the junction edge)
  for (const r of RAMPS) for (const o of TERRAIN) if (o !== r) assert.ok(!overlap(r, o), `ramp at ${r.x},${r.z} overlaps the entry at ${o.x},${o.z}`);
  const plateau = TOPS.find(t => t.x === 0 && t.z === 0);
  assert.ok(plateau && plateau.y === 3 && plateau.w === 28, 'central plateau 28 x 28 at y 3');
  assert.strictEqual(TOPS.filter(t => t.y === 2.5).length, 4, 'four hills');
  assert.strictEqual(TOPS.filter(t => t.y < 0).length, 2, 'two bowls');
});

test('obstacles: inside the walls, not overlapping each other, never on a ramp, level with the ground under them', () => {
  assert.ok(OBST.length >= 30, `obstacles: ${OBST.length}`);
  for (const o of OBST) {
    const R = rect(o);
    assert.ok(Math.max(Math.abs(R.x0), Math.abs(R.x1), Math.abs(R.z0), Math.abs(R.z1)) < WALL_IN - 2, `obstacle at ${o.x},${o.z} is in the wall`);
    for (const r of RAMPS) assert.ok(!overlap(o, r, 1.5), `obstacle at ${o.x},${o.z} overlaps (or crowds) the ramp at ${r.x},${r.z}`);
    const gy = groundY(o.x, o.z);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      assert.ok(Math.abs(groundY(o.x + sx * (o.w / 2 - 0.05), o.z + sz * (o.d / 2 - 0.05)) - gy) < EPS, `obstacle at ${o.x},${o.z} straddles a terrain edge`);
  }
  for (let i = 0; i < OBST.length; i++) for (let j = i + 1; j < OBST.length; j++)
    assert.ok(!overlap(OBST[i], OBST[j]), `obstacles ${i} (${OBST[i].x},${OBST[i].z}) and ${j} (${OBST[j].x},${OBST[j].z}) overlap`);
});

test('spawns: 12, at ground level, clear of obstacles, ramps and each other', () => {
  assert.strictEqual(SPAWNS.length, 12);
  for (const [x, z] of SPAWNS) {
    assert.ok(Math.abs(x) < WALL_IN - KART_R - 2 && Math.abs(z) < WALL_IN - KART_R - 2, `spawn ${x},${z} is too close to the wall`);
    assert.strictEqual(groundY(x, z), 0, `spawn ${x},${z} is not at ground level`);
    assert.ok(!solidAt(x, z, KART_R + 3), `spawn ${x},${z} has an obstacle within 3 units`);
    for (const t of TERRAIN) assert.ok(!overlap({ x, z, w: 2 * KART_R + 4, d: 2 * KART_R + 4 }, t), `spawn ${x},${z} sits on terrain at ${t.x},${t.z}`);
  }
  for (let i = 0; i < SPAWNS.length; i++) for (let j = i + 1; j < SPAWNS.length; j++)
    assert.ok(Math.hypot(SPAWNS[i][0] - SPAWNS[j][0], SPAWNS[i][1] - SPAWNS[j][1]) > 12, `spawns ${i} and ${j} are too close`);
});

test('boxes: ~24, on every level, each pickable by a kart standing on the same level', () => {
  assert.ok(BOX_SPOTS.length >= 22 && BOX_SPOTS.length <= 28, `boxes: ${BOX_SPOTS.length}`);
  const onTop = t => BOX_SPOTS.filter(([x, z]) => Math.abs(x - t.x) < t.w / 2 && Math.abs(z - t.z) < t.d / 2).length;
  assert.ok(onTop(TOPS.find(t => t.x === 0 && t.z === 0)) >= 3, 'at least 3 boxes on the central plateau');
  for (const t of TOPS) assert.ok(onTop(t) >= 1, `no box on the top at ${t.x},${t.z}`);
  for (const [x, z] of BOX_SPOTS) {
    assert.ok(!solidAt(x, z, 0.5), `box ${x},${z} is inside an obstacle`);
    for (const r of RAMPS) assert.ok(!overlap({ x, z, w: 1, d: 1 }, r), `box ${x},${z} is on a ramp`);
    const gy = groundY(x, z);
    let ok = false; // a kart centre within pickup range (2.7), free of obstacles and on the box's level
    for (let a = 0; a < 16 && !ok; a++) for (const d of [0, 1.2, 2.2]) {
      const px = x + Math.cos(a / 16 * Math.PI * 2) * d, pz = z + Math.sin(a / 16 * Math.PI * 2) * d;
      if (!solidAt(px, pz, KART_R) && Math.abs(groundY(px, pz) - gy) < EPS) { ok = true; break; }
    }
    assert.ok(ok, `box ${x},${z} cannot be reached`);
  }
  for (let i = 0; i < BOX_SPOTS.length; i++) for (let j = i + 1; j < BOX_SPOTS.length; j++)
    assert.ok(Math.hypot(BOX_SPOTS[i][0] - BOX_SPOTS[j][0], BOX_SPOTS[i][1] - BOX_SPOTS[j][1]) > 6, `boxes ${i} and ${j} are too close`);
});

test('reachability: from every spawn a kart can drive to every box (ramps up, ledges block, drops allowed)', () => {
  // 1-unit grid; a cell is open when a kart centre there is clear of obstacles and walls; moving onto a cell
  // more than STEP_UP higher is blocked (the physics treats such ledges as walls), moving down is a drop (fine).
  const N = 2 * HALF + 1, idx = (x, z) => (x + HALF) * N + (z + HALF);
  const open = new Uint8Array(N * N), gy = new Float32Array(N * N);
  for (let x = -HALF; x <= HALF; x++) for (let z = -HALF; z <= HALF; z++) { open[idx(x, z)] = solidAt(x, z, KART_R) ? 0 : 1; gy[idx(x, z)] = groundY(x, z); }
  const reach = (sx, sz) => {
    const seen = new Uint8Array(N * N), q = [idx(sx, sz)]; seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop(), x = Math.floor(i / N) - HALF, z = i % N - HALF;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz; if (Math.abs(nx) > HALF || Math.abs(nz) > HALF) continue;
        const j = idx(nx, nz); if (seen[j] || !open[j] || gy[j] > gy[i] + WORLD.STEP_UP) continue;
        seen[j] = 1; q.push(j);
      }
    }
    return seen;
  };
  for (const [sx, sz] of SPAWNS) {
    const seen = reach(sx, sz);
    for (const [bx, bz] of BOX_SPOTS) {
      let ok = false;
      for (let x = Math.floor(bx - 2); x <= Math.ceil(bx + 2) && !ok; x++) for (let z = Math.floor(bz - 2); z <= Math.ceil(bz + 2); z++)
        if (Math.hypot(x - bx, z - bz) <= 2.7 && Math.abs(x) <= HALF && Math.abs(z) <= HALF && seen[idx(x, z)] && Math.abs(gy[idx(x, z)] - groundY(bx, bz)) < EPS) { ok = true; break; }
      assert.ok(ok, `box ${bx},${bz} is not reachable from spawn ${sx},${sz}`);
    }
    // every top can also be left again: some ramp low end is reachable from the top (so nothing is a one-way trap)
    for (const t of TOPS) {
      let cx = Math.round(t.x), cz = Math.round(t.z), best = 1e9; // the open cell on the top nearest its centre
      for (let x = Math.ceil(t.x - t.w / 2); x <= t.x + t.w / 2; x++) for (let z = Math.ceil(t.z - t.d / 2); z <= t.z + t.d / 2; z++) {
        const d = Math.hypot(x - t.x, z - t.z); if (open[idx(x, z)] && d < best) { best = d; cx = x; cz = z; }
      }
      const fromTop = reach(cx, cz);
      assert.ok(SPAWNS.some(([x, z]) => fromTop[idx(x, z)]), `no way back down from the top at ${t.x},${t.z}`);
    }
  }
});

test('corridors: obstacle faces that run side by side leave at least 10 units between them', () => {
  // for every pair of obstacles whose footprints face each other (projection overlap > 3), the gap is 0 (touching) or >= 10
  const bad = [];
  for (let i = 0; i < OBST.length; i++) for (let j = i + 1; j < OBST.length; j++) {
    const A = rect(OBST[i]), B = rect(OBST[j]);
    const gx = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1), gz = Math.max(A.z0, B.z0) - Math.min(A.z1, B.z1); // positive = separated along that axis
    if (gx > 0 && gz < -3 && gx < 10 - EPS) bad.push(`${i}/${j} x-gap ${gx.toFixed(1)}`);
    if (gz > 0 && gx < -3 && gz < 10 - EPS) bad.push(`${i}/${j} z-gap ${gz.toFixed(1)}`);
  }
  assert.deepStrictEqual(bad, []);
});
