// Rules, plan and scripted playthroughs. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIO as S } from '../public/game/scenario.js';
import { makePlan } from '../public/game/rules/plan.js';
import { hashString, mulberry32 } from '../public/game/rules/rng.js';
import { stepCar, newCar, flatRoad, CAR } from '../public/game/rules/drive.js';
import { createRun, OUTCOME_ORDER } from '../public/game/rules/run.js';
import { createBot, playThrough, POLICIES } from '../public/game/rules/bot.js';

const road = flatRoad(S);
const play = (seed, policy, over = {}) => {
  const plan = { ...makePlan(S, seed), ...over };
  const run = createRun(S, plan, road), bot = createBot(typeof policy === 'string' ? POLICIES[policy] : policy, road);
  return { ...playThrough(run, bot), plan, run };
};
const byId = (st) => Object.fromEntries(st.decisions.map((d) => [d.id, d]));
const SEEDS = ['A', 'B', 'C', 'safety-1', 'TUE-0930', '7', 'x9'];

test('rng: same text, same numbers', () => {
  const a = mulberry32(hashString('abc')), b = mulberry32(hashString('abc'));
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('plan: the session code fixes the faults, the pullouts and the truck', () => {
  assert.deepEqual(makePlan(S, 'TUE-0930'), makePlan(S, 'TUE-0930'));
  const faultSeen = new Set(), orders = new Set();
  for (let i = 0; i < 300; i++) {
    const p = makePlan(S, 'seed' + i), n = Object.values(p.faults).filter(Boolean).length;
    assert.ok(n >= S.inspection.faultCount[0] && n <= S.inspection.faultCount[1]);
    for (const [k, v] of Object.entries(p.faults)) if (v) faultSeen.add(k);
    assert.deepEqual([...p.surfaces].sort(), ['mud', 'rock', 'sound']);
    orders.add(p.surfaces.join());
    assert.ok(p.truckSpeed >= S.truck.speed[0] && p.truckSpeed <= S.truck.speed[1]);
  }
  assert.equal(faultSeen.size, S.inspection.items.length, 'every item can be the faulty one');
  assert.equal(orders.size, 6, 'every order of pullouts turns up');
});

test('driving: speeds up, tops out, stops, stays inside the road edges', () => {
  const c = newCar(300, 0, 0);
  for (let i = 0; i < 60 * 30; i++) stepCar(c, { throttle: 1, brake: 0, steer: 0 }, road, 1 / 60);
  assert.ok(c.v > 12 && c.v <= CAR.maxSpeed + 1e-6, 'top speed ' + c.v);
  assert.ok(Math.abs(c.u) < 2.7, 'hands off, it stays on the road: u=' + c.u);
  for (let i = 0; i < 60 * 4; i++) stepCar(c, { throttle: 0, brake: 1, steer: 0 }, road, 1 / 60);
  assert.ok(c.v <= 0.2, 'brakes stop it');
  const d = newCar(500, 0, 0);
  for (let i = 0; i < 60 * 20; i++) { stepCar(d, { throttle: 1, brake: 0, steer: 1 }, road, 1 / 60); assert.ok(d.u <= road.widthR(d.s) + CAR.overR + 1e-6); }
  const e = newCar(500, 0, 0);
  for (let i = 0; i < 60 * 20; i++) { stepCar(e, { throttle: 1, brake: 0, steer: -1 }, road, 1 / 60); assert.ok(e.u >= -road.widthL(e.s) - CAR.over - 1e-6); }
});

test('every run reports every decision once, with choices from the catalogue', () => {
  for (const policy of Object.keys(POLICIES)) for (const seed of SEEDS) {
    const { state, events } = play(seed, policy);
    assert.ok(state.done, policy + ' finishes');
    const ids = state.decisions.map((d) => d.id);
    assert.deepEqual([...ids].sort(), S.decisions.map((d) => d.id).sort(), policy + '/' + seed);
    for (const d of state.decisions) {
      const cat = S.decisions.find((x) => x.id === d.id);
      assert.ok(cat.choices[d.choice], `${d.id}: "${d.choice}" is in the catalogue`);
      assert.equal(typeof d.safe, 'boolean');
    }
    assert.ok(OUTCOME_ORDER.includes(state.outcome));
    assert.equal(events.filter((e) => e.type === 'end').length, 1);
    assert.equal(events.filter((e) => e.type === 'decision').length, S.decisions.length);
  }
});

test('good run: every decision safe, truck cleared', () => {
  for (const seed of SEEDS) {
    const { state, events } = play(seed, 'good');
    assert.equal(state.outcome, 'clean', seed);
    const unsafe = state.decisions.filter((d) => !d.safe).map((d) => d.id);
    assert.deepEqual(unsafe, [], seed);
    const end = events.find((e) => e.type === 'end').summary;
    assert.equal(end.safe, end.total); assert.equal(end.missed.length, 0);
    assert.ok(state.t > 150 && state.t < 480, 'drive time ' + state.t);
  }
});

test('each way it goes wrong', () => {
  for (const seed of SEEDS) {
    const mud = play(seed, 'mud'); assert.equal(mud.state.outcome, 'stuck'); assert.equal(byId(mud.state)['pullout.choice'].choice, 'mud');
    const rock = play(seed, 'rock'); assert.equal(rock.state.outcome, 'damaged'); assert.equal(byId(rock.state)['pullout.choice'].choice, 'rock');
    const late = play(seed, 'late'); assert.equal(late.state.outcome, 'late'); assert.equal(byId(late.state)['pullout.timing'].choice, 'late');
    assert.equal(byId(late.state)['pullout.choice'].choice, 'sound');
    const nm = play(seed, 'nearmiss'); assert.equal(nm.state.outcome, 'nearMiss');
    assert.equal(byId(nm.state)['pullout.choice'].choice, 'none'); assert.equal(byId(nm.state)['pullout.timing'].choice, 'on-road');
    assert.equal(byId(nm.state)['call.clear'].choice, 'not-applicable');
    assert.ok(nm.state.nearMissGap > 7.5 && nm.state.nearMissGap < 25, 'the truck stops short of the pickup: ' + nm.state.nearMissGap);
    assert.ok(byId(nm.state)['call.rejoin'], 'still reaches the last decision after the near miss');
    const bad = play(seed, 'careless'); assert.equal(bad.state.outcome, 'nearMiss');
    assert.equal(bad.state.decisions.filter((d) => d.safe).length, 0);
    for (const id of ['call.start', 'call.mustcall', 'call.km2']) assert.equal(byId(bad.state)[id].choice, 'not-made');
    const wc = play(seed, 'wrongcalls');
    for (const id of ['call.start', 'call.mustcall', 'call.km2']) assert.equal(byId(wc.state)[id].choice, 'wrong-direction');
    assert.equal(byId(wc.state)['call.clear'].choice, 'position');
  }
});

test('same session code and same play give the same run', () => {
  const a = play('TUE-0930', 'mud'), b = play('TUE-0930', 'mud');
  assert.deepEqual(a.state.decisions, b.state.decisions);
  assert.equal(a.state.t, b.state.t);
});

test('fair: the firm pullout can always be reached in time, fast or slow, wherever it is', () => {
  const orders = [['sound', 'mud', 'rock'], ['mud', 'sound', 'rock'], ['mud', 'rock', 'sound'], ['rock', 'mud', 'sound'], ['rock', 'sound', 'mud'], ['sound', 'rock', 'mud']];
  for (const surfaces of orders) for (const speed of [5.5, 8, 11, 13.9]) for (const truckSpeed of S.truck.speed) {
    const { state } = play('fair', { ...POLICIES.good, speed }, { surfaces, truckSpeed });
    assert.equal(state.outcome, 'clean', `${surfaces} at ${speed} m/s`);
  }
});

test('sitting on the road after the call does not stop the truck coming', () => {
  const plan = makePlan(S, 'sit'), run = createRun(S, plan, road), bot = createBot('nearmiss', road);
  let ticks = 0;
  while (!run.state.done && ticks++ < 400000) {
    if (run.state.enc === 'approach' && !run.state.pending) run.step(1 / 30, { throttle: 0, brake: run.state.car.v > 0.3 ? 1 : 0, steer: 0 });
    else bot.tick(run, 1 / 30);
  }
  assert.equal(run.state.outcome, 'nearMiss');
  assert.ok(run.state.decided['pullout.choice'].detail.km < 1.7, 'met well below the pullouts');
});

test('a radio left on the wrong channel: the first call goes nowhere, then you notice', () => {
  const faults = { 'inspect.lights': false, 'inspect.tires': false, 'inspect.load': false, 'inspect.spare': false, 'inspect.radio': true };
  const { state, events } = play('radio', 'wrongcalls', { faults });
  assert.equal(state.missed['inspect.radio'], true);
  assert.equal(byId(state)['call.start'].detail.heardByOthers, false);
  assert.equal(byId(state)['call.mustcall'].detail.heardByOthers, true);
  const heard = events.filter((e) => e.type === 'radio' && e.who === 'truck').map((e) => e.text);
  assert.equal(heard.length, 1, 'the 5 km call was missed, the 3 km call was heard');
  assert.ok(events.some((e) => e.type === 'ask' && e.pending.id === 'radio.realise'));
  const fixedRun = play('radio', 'good', { faults });
  assert.equal(fixedRun.events.filter((e) => e.type === 'radio' && e.who === 'truck').length, 2);
});

test('missed spare shows up when the tire is cut', () => {
  const faults = { 'inspect.lights': false, 'inspect.tires': false, 'inspect.load': false, 'inspect.spare': true, 'inspect.radio': false };
  const { events } = play('spare', { ...POLICIES.rock, inspect: 'ok' }, { faults });
  const deb = events.find((e) => e.type === 'ask' && e.pending.kind === 'debrief').pending;
  assert.equal(deb.outcome, 'damaged'); assert.ok(deb.extra.includes(S.text.spareFlat));
});

test('scenario file is consistent', () => {
  const ids = new Set(S.decisions.map((d) => d.id));
  for (const it of S.inspection.items) assert.ok(ids.has(it.id));
  for (const p of S.radio.callPoints) assert.ok(ids.has(p.id));
  for (const [id, q] of Object.entries(S.radio.questions)) {
    assert.ok(ids.has(id)); const cat = S.decisions.find((d) => d.id === id);
    for (const o of q.options) assert.ok(cat.choices[o.id], id + ' option ' + o.id);
    assert.equal(q.options.filter((o) => o.safe).length, 1);
  }
  for (const o of S.radio.clearOptions) assert.ok(S.decisions.find((d) => d.id === 'call.clear').choices[o.id]);
  for (const o of S.radio.rejoinOptions) assert.ok(S.decisions.find((d) => d.id === 'call.rejoin').choices[o.id]);
  for (const k of Object.keys(S.surfaces)) assert.ok(S.decisions.find((d) => d.id === 'pullout.choice').choices[k]);
  for (const o of OUTCOME_ORDER) { assert.ok(S.debrief[o]); assert.ok(S.summary.outcomes[o]); assert.ok(S.text.rejoin[o]); }
  const text = JSON.stringify(S);
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text), 'no emoji in the scenario');
});
