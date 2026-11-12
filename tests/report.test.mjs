// The reporting seam and the session code. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIO as S } from '../public/game/scenario.js';
import { makePlan } from '../public/game/rules/plan.js';
import { flatRoad } from '../public/game/rules/drive.js';
import { createRun } from '../public/game/rules/run.js';
import { createBot } from '../public/game/rules/bot.js';
import { events, createRunReporter, onReport } from '../public/game/report.js';
import { sessionFromLink, playerId, seedFor, randomId } from '../public/game/session.js';

test('session code from the link', () => {
  assert.equal(sessionFromLink('?s=TUE-0930', ''), 'TUE-0930');
  assert.equal(sessionFromLink('?session=abc', ''), 'abc');
  assert.equal(sessionFromLink('', '#s=H1'), 'H1');
  assert.equal(sessionFromLink('?q=low', ''), null);
  assert.equal(sessionFromLink('?s=<b>x y</b>', ''), 'bxyb');
  assert.equal(seedFor('TUE'), 'TUE');
  assert.match(seedFor(null), /^solo-/);
});

test('player id stays the same in one browser, and survives storage being blocked', () => {
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) || null, setItem: (k, v) => mem.set(k, v) };
  const a = playerId(storage); assert.equal(playerId(storage), a); assert.match(a, /^p_[a-z0-9]{12}$/);
  const blocked = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.match(playerId(blocked), /^p_/);
  assert.notEqual(randomId(), randomId());
});

test('a whole run through the seam: start, every decision, end, all stamped the same', () => {
  events.length = 0;
  const seen = []; const off = onReport((e) => seen.push(e.type));
  const road = flatRoad(S), plan = makePlan(S, 'TUE-0930'), run = createRun(S, plan, road), bot = createBot('mud', road);
  const rep = createRunReporter({ session: 'TUE-0930', playerId: 'p_test', runId: 'r_test', now: () => '2026-01-01T00:00:00.000Z' });
  rep.start({ scenarioId: S.id, seed: plan.seedText, tier: 'low', plan: { faults: plan.faults, surfaces: plan.surfaces } });
  while (!run.state.done) { bot.tick(run, 1 / 30); for (const e of run.drain()) { if (e.type === 'decision') rep.decision(e); if (e.type === 'end') rep.end(e.summary); } }
  off();
  assert.equal(events[0].type, 'run_start'); assert.equal(events.at(-1).type, 'run_end');
  const decisions = events.filter((e) => e.type === 'decision');
  assert.equal(decisions.length, S.decisions.length);
  assert.deepEqual(decisions.map((d) => d.seq), decisions.map((_, i) => i + 1));
  for (const e of events) { assert.equal(e.v, 1); assert.equal(e.session, 'TUE-0930'); assert.equal(e.playerId, 'p_test'); assert.equal(e.runId, 'r_test'); assert.ok(e.at); }
  for (const d of decisions) assert.deepEqual(Object.keys(d).sort(), ['at', 'choice', 'detail', 'id', 'ms', 'playerId', 'runId', 'safe', 'seq', 'session', 'type', 'v']);
  assert.equal(events.at(-1).outcome, 'stuck'); assert.equal(seen.length, events.length);
  assert.doesNotThrow(() => JSON.stringify(events));
});
