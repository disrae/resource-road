// The automatic graphics controller, run against simulated machines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNGS, createGovernor } from '../public/game/quality.js';

// A pretend machine: the frame costs `base` ms at the top rung and less further down. A 60 Hz
// screen only shows whole refreshes, so the measured frame time is rounded up to 16.7 ms steps.
const cost = (base, rung, fixed = 2) => fixed + (base - fixed) * (0.25 + 0.75 * RUNGS[rung].res ** 2 * (0.5 + 0.5 * RUNGS[rung].fog));
const shown = (ms) => Math.ceil(ms / 16.667 - 1e-6) * 16.667;
function play(gov, seconds, baseAt) {
  let t = 0; const seen = [];
  while (t < seconds) { const ms = shown(cost(baseAt(t), gov.rung)); gov.sample(ms); t += ms / 1000; seen.push({ t, rung: gov.rung, ms }); }
  return seen;
}

test('a fast machine stays at the top rung', () => {
  const g = createGovernor(); play(g, 120, () => 9);
  assert.equal(g.rung, 0); assert.equal(g.changes, 0);
});

test('a slow machine steps down until it is smooth, then holds', () => {
  const g = createGovernor(); const seen = play(g, 300, () => 24);
  const late = seen.filter((x) => x.t > 60);
  assert.ok(g.rung > 0 && g.rung < RUNGS.length - 1, 'settles part way down, at rung ' + g.rung);
  assert.ok(late.filter((x) => x.ms < 17).length / late.length > 0.95, 'at 60 frames a second nearly all the time');
  const changesLate = g.log.filter((c) => c.t > 60).length;
  assert.ok(changesLate <= 6, 'does not flip back and forth: ' + changesLate + ' late changes');
});

test('a very slow machine goes to the bottom and stays there without hunting', () => {
  const g = createGovernor(); play(g, 200, () => 140);
  assert.equal(g.rung, RUNGS.length - 1);
  assert.ok(g.changes <= RUNGS.length, 'only steps down: ' + g.changes);
});

test('a machine that manages 30 but not 60 frames a second keeps its quality below the comfort rung', () => {
  // 16.7 ms is out of reach on every rung, 33 ms is fine: it should stop at the comfort rung, not the bottom
  const g = createGovernor(); play(g, 200, () => 55);
  assert.equal(g.rung, 4);
});

test('when the load goes up it steps down, and recovers when the load goes away', () => {
  const g = createGovernor();
  const seen = play(g, 400, (t) => (t > 30 && t < 150 ? 40 : 9));
  const during = seen.filter((x) => x.t > 60 && x.t < 150), after = seen.filter((x) => x.t > 390);
  assert.ok(Math.min(...during.map((x) => x.rung)) > 0, 'stepped down under load');
  assert.equal(after[after.length - 1].rung, 0, 'back at the top afterwards');
});

test('a long frame (hidden tab) is ignored, and a locked controller never moves', () => {
  const g = createGovernor(); for (let i = 0; i < 50; i++) g.sample(2000);
  assert.equal(g.rung, 0);
  const l = createGovernor(); l.lock(3); for (let i = 0; i < 500; i++) l.sample(80);
  assert.equal(l.rung, 3);
});
