// The place seam: a road that follows a given line, a location block, and a scenario from outside.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SCENARIO as S } from '../public/game/scenario.js';
import { buildRoute, ROUTE_DEFAULTS } from '../public/game/world/route.js';
import { placeFor, project } from '../public/game/world/place.js';
import { overlay, withLocation, loadScenario } from '../public/game/scenario-source.js';
import { makePlan } from '../public/game/rules/plan.js';
import { flatRoad } from '../public/game/rules/drive.js';
import { createRun } from '../public/game/rules/run.js';
import { createBot, playThrough, POLICIES } from '../public/game/rules/bot.js';

const DEMO = JSON.parse(readFileSync(new URL('../public/dev/demo-location.json', import.meta.url), 'utf8'));
const hills = (x, z) => 900 + 60 * Math.sin(x / 700) + 40 * Math.cos(z / 500);      // any terrain source will do

test('the built-in scenario has no location and uses the traced road', () => {
  assert.equal(S.location, null);
  const p = placeFor(S);
  assert.deepEqual(p.road, {}); assert.equal(p.layout, S.layout);
});

test('project: degrees to metres, north is -z, east is +x', () => {
  const [x, z] = project([0.001, 0.002], [0, 0], [100, 50]);
  assert.ok(Math.abs(x - (100 + 222.64)) < 0.1); assert.ok(Math.abs(z - (50 - 110.574)) < 0.1);
});

test('a road built from a given line follows it, with s = 0 where zeroAt says', () => {
  const sc = withLocation(overlay(S, DEMO)), place = placeFor(sc);
  assert.equal(place.road.path.length, DEMO.location.road.length);
  const route = buildRoute(hills, place.layout, place.road);
  assert.equal(route.sMin, ROUTE_DEFAULTS.sMin); assert.equal(route.sMax, ROUTE_DEFAULTS.sMax);
  // every point of the line lies close to the built centreline, in order
  let last = -1e9;
  for (const [px, pz] of place.road.path) {
    let best = 1e9, at = 0;
    for (let s = route.sMin; s <= route.sMax; s += 2) { const w = route.toWorld(s, 0), d = Math.hypot(w[0] - px, w[2] - pz); if (d < best) { best = d; at = s; } }
    if (at > route.sMin + 4 && at < route.sMax - 4) { assert.ok(best < 6, 'within 6 m of the line, got ' + best.toFixed(1)); assert.ok(at > last); last = at; }
  }
  // the first board stands zeroAt metres along the line (this stretch of the demo line is nearly straight)
  const w = route.toWorld(0, 0), a = place.road.path[0];
  assert.ok(Math.abs(Math.hypot(w[0] - a[0], w[2] - a[1]) - DEMO.location.zeroAt) < 6);
  // and it is drivable: no pitch steeper than the limit, pullouts where the location puts them
  for (let s = route.sMin + 10; s < route.sMax - 10; s += 10) assert.ok(Math.abs(route.frame(s).grade ?? 0) < 0.12);
  assert.deepEqual(route.pullouts.map((p) => p.s), DEMO.location.pullouts);
});

test('overlay merges objects, replaces lists and values, and leaves the built-in scenario alone', () => {
  const o = overlay(S, { road: { name: 'Elsewhere' }, layout: { pullouts: [{ s: 1, length: 2, width: 3 }] } });
  assert.equal(o.road.name, 'Elsewhere'); assert.equal(o.road.channel, S.road.channel);
  assert.equal(o.layout.pullouts.length, 1); assert.equal(S.road.name, 'Tamber'); assert.equal(S.layout.pullouts.length, 3);
});

test('a scenario file named in the link is laid over the built-in one; other sites are refused', async () => {
  const here = { origin: 'https://game.example', href: 'https://game.example/?s=A' };
  const fetchOk = async (url) => ({ ok: true, json: async () => ({ ...DEMO, seen: url }) });
  const a = await loadScenario(S, new URLSearchParams('scenario=/dev/demo-location.json'), { ...here, fetch: fetchOk });
  assert.equal(a.id, 'demo-location'); assert.equal(a.seen, 'https://game.example/dev/demo-location.json'); assert.equal(a.road.name, S.road.name);
  const warn = console.warn; console.warn = () => {};
  try {
    const b = await loadScenario(S, new URLSearchParams('scenario=https://elsewhere.example/x.json'), { ...here, fetch: fetchOk });
    assert.equal(b.id, S.id); assert.match(b.sourceError, /not allowed/);
    const c = await loadScenario(S, new URLSearchParams('scenario=https://backend.example/x.json'), { ...here, fetch: fetchOk, allow: ['https://backend.example'] });
    assert.equal(c.id, 'demo-location');
    const d = await loadScenario(S, new URLSearchParams('scenario=/missing.json'), { ...here, fetch: async () => ({ ok: false, status: 404 }) });
    assert.equal(d.id, S.id); assert.match(d.sourceError, /404/);
  } finally { console.warn = warn; }
  assert.equal((await loadScenario(S, new URLSearchParams(''))).id, S.id);
});

test('the rules play the same on a location scenario: a good run is clean, a careless one is not', () => {
  const sc = withLocation(overlay(S, { location: { ...DEMO.location, pullouts: [2080, 2240, 2400] } })), road = flatRoad(sc);
  const good = playThrough(createRun(sc, makePlan(sc, 'LOC-1'), road), createBot(POLICIES.good, road));
  assert.equal(good.state.outcome, 'clean');
  const bad = playThrough(createRun(sc, makePlan(sc, 'LOC-1'), road), createBot(POLICIES.nearmiss, road));
  assert.equal(bad.state.outcome, 'nearMiss');
});
