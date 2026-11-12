// The rules of one run: inspection, radio calls, the meeting with the logging truck, the outcome.
// Pure and deterministic: no browser, no clock, no randomness of its own. The same scenario,
// plan (see plan.js) and inputs always give the same decisions and the same outcome.
//
// The game loop calls step(dt, input) and reads `state`. When `state.pending` is set the run is
// waiting for an answer (a question card on screen) and step() does nothing until submit().
// Things for the screen and speakers come out of drain() as plain event objects.
import { stepCar, newCar } from './drive.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const OUTCOME_ORDER = ['nearMiss', 'late', 'stuck', 'damaged', 'clean'];   // worst first

export function fill(text, vars) { return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)); }

export function createRun(scenario, plan, road) {
  const S = scenario, R = S.road, RD = S.radio, T = S.truck, TX = S.text;
  const kmS = (km) => (km - R.startKm) * R.kmSpacing;
  const kmAt = (s) => R.startKm + Math.max(0, Math.floor((s + 70) / R.kmSpacing));     // the board you are at or last passed
  const baseVars = { road: R.name, otherRoad: R.otherRoad, vehicle: R.vehicle, channel: R.channel, wrongChannel: R.wrongChannel };
  const callText = (km, dir) => fill(RD.callTemplate, { ...baseVars, km, dir });
  const items = S.inspection.items, itemById = Object.fromEntries(items.map((it) => [it.id, it]));
  const lastP = S.layout.pullouts[S.layout.pullouts.length - 1], lastEnd = lastP.s + lastP.length / 2;
  const out = [];
  const emit = (type, data = {}) => out.push({ type, ...data });

  const st = {
    phase: 'intro',                    // intro -> inspect -> drive -> done
    t: 0,                              // seconds of driving
    car: newCar(S.layout.start ? S.layout.start.s : -34, S.layout.start ? S.layout.start.u : -6.5, 0.1),
    truck: { active: false, s: 0, u: -0.15, v: 0, horn: false, stall: 0, gone: false },
    radio: { working: true },
    station: -1,                       // which inspection item is on screen
    missed: {},                        // inspection id -> true when a real fault was left unfixed
    fixed: {},                         // inspection id -> true when a real fault was fixed
    pending: null,
    enc: 'none',                       // none | approach | waiting | squeeze | nearmiss | passed | after
    canWait: false, waitTimer: 0, mudTime: 0, rockDist: 0, encTimer: 0,
    stuck: false, damaged: false, km2Called: false, late: false, nearMiss: false,
    heard: {}, told: {}, decided: {}, decisions: [], extraCalls: 0,
    outcome: null, endS: R.endS, thump: 0, done: false,
  };
  for (const it of items) { st.missed[it.id] = false; st.fixed[it.id] = false; }

  function decide(id, choice, safe, ms = null, detail = {}) {
    if (st.decided[id]) return;
    const d = { id, choice, safe: !!safe, ms: ms == null ? null : Math.round(ms), detail, seq: st.decisions.length + 1 };
    st.decided[id] = d; st.decisions.push(d); emit('decision', d);
  }
  const ask = (p) => { st.pending = p; emit('ask', { pending: p }); };
  const toast = (text, tone = 'info', vars = {}) => emit('toast', { text: fill(text, { ...baseVars, ...vars }), tone });
  const sinceHeard = () => (st.tTruck == null ? null : (st.t - st.tTruck) * 1000);

  // ---- inspection --------------------------------------------------------------------------------
  function askIntro() {
    ask({ kind: 'intro', id: 'inspect.intro', title: S.title, text: S.inspection.intro,
      options: [{ id: 'do', text: S.inspection.doLabel }, { id: 'skip', text: S.inspection.skipLabel }] });
  }
  function askStation(i) {
    st.station = i; const it = items[i];
    ask({ kind: 'inspect', id: it.id, view: it.view, title: it.label, text: fill(it.prompt, baseVars), step: i + 1, steps: items.length, gauge: it.gauge || null,
      fault: !!plan.faults[it.id],     // for drawing only (the gauge reading, the radio display)
      options: [{ id: 'ok', text: it.okChoice }, { id: 'fix', text: it.faultChoice }] });
  }
  function startDrive() {
    st.phase = 'drive'; st.station = -1;
    st.radio.working = !st.missed['inspect.radio'];
    emit('phase', { phase: 'drive' });
  }

  // ---- radio ---------------------------------------------------------------------------------------
  const callPoints = RD.callPoints.map((p) => ({ ...p, s: kmS(p.km) }));
  function openCall() {
    if (st.phase !== 'drive' || st.pending || st.enc === 'waiting' || st.enc === 'squeeze' || st.enc === 'nearmiss') return false;
    ask({ kind: 'call', id: 'call', title: R.channel, road: R.name, vehicle: R.vehicle, kms: [0, 1, 2, 3].map((i) => R.startKm + i), dirs: ['up', 'down'] });
    return true;
  }
  function sendCall(ans, ms) {
    const s = st.car.s, text = callText(ans.km, ans.dir);
    emit('radio', { who: 'me', text });
    const cp = callPoints.find((p) => !st.decided[p.id] && s >= p.s + RD.window[0] && s <= p.s + RD.window[1]);
    if (!cp) { st.extraCalls++; if (!st.radio.working) emit('radio', { who: 'static', text: TX.noReply }); return; }
    const choice = ans.dir !== 'up' ? 'wrong-direction' : ans.km !== cp.km ? 'wrong-km' : 'correct';
    decide(cp.id, choice, choice === 'correct', ms, { km: ans.km, dir: ans.dir, heardByOthers: st.radio.working });
    if (choice === 'wrong-direction') toast(TX.wrongDirection, 'bad');
    else if (choice === 'wrong-km') toast(TX.wrongKm, 'bad', { said: ans.km, km: cp.km });
    else toast(TX.goodCall, 'good');
    if (!st.radio.working) emit('radio', { who: 'static', text: TX.noReply });
    if (cp.kind === 'board' && choice === 'correct' && st.radio.working) st.km2Called = true;
  }

  // ---- the meeting -----------------------------------------------------------------------------------
  const zoneOf = () => road.pulloutAt(st.car.s, st.car.u);
  const clearVars = () => { const km = kmAt(st.car.s); return { ...baseVars, km, clear: fill(RD.clearTemplate, { ...baseVars, km }), position: callText(km, 'up') }; };
  function commitSpot(zone, viaPrompt) {
    const surface = zone >= 0 ? plan.surfaces[zone] : 'none', u = st.car.u;
    decide('pullout.choice', surface, surface === 'sound', sinceHeard(), { pullout: zone, km: +(st.car.s / R.kmSpacing).toFixed(2) });
    const timing = u >= 3.5 ? 'in-time' : u >= 1.9 ? 'late' : 'on-road';
    decide('pullout.timing', timing, timing === 'in-time', sinceHeard(), { u: +u.toFixed(2), confirmed: viaPrompt });
    st.late = timing === 'late'; st.nearMiss = timing === 'on-road';
    if (surface === 'mud' && !st.stuck) { st.stuck = true; emit('sfx', { name: 'spin' }); }
    if (surface === 'rock' && !st.damaged) { st.damaged = true; emit('sfx', { name: 'bang' }); }
    return timing;
  }
  function waitHere() {
    if (!st.canWait || st.pending) return false;
    const timing = commitSpot(zoneOf(), true);
    st.car.v = 0;
    if (timing === 'on-road') return false;
    const v = clearVars();
    ask({ kind: 'choice', id: 'call.clear', title: R.channel, text: TX.clearAsk,
      options: RD.clearOptions.map((o) => ({ id: o.id, text: fill(o.text, v), say: o.id === 'silent' ? null : fill(o.text, v).replace(/^"|"$/g, '') })) });
    return true;
  }
  function beginWait(called) {
    st.enc = st.late ? 'squeeze' : 'waiting'; st.encTimer = 0;
    st.truck.s = Math.min(st.truck.s, st.car.s + 190);
    st.truck.horn = st.late || !called;
    emit('waiting', { text: TX.waiting });
  }
  function meet() {
    const zone = zoneOf(), c = st.car;
    const timing = commitSpot(zone, false);
    decide('call.clear', timing === 'in-time' ? 'silent' : 'not-applicable', false, null, {});
    if (timing === 'on-road') { st.enc = 'nearmiss'; st.encTimer = 0; st.truck.horn = true; emit('sfx', { name: 'horn-long' }); }
    else { st.enc = timing === 'late' ? 'squeeze' : 'waiting'; st.encTimer = 0; st.truck.horn = true; }
    void c;
  }
  function debrief() {
    const list = [];
    if (st.nearMiss) list.push('nearMiss'); if (st.late) list.push('late'); if (st.stuck) list.push('stuck'); if (st.damaged) list.push('damaged');
    if (!list.length) list.push('clean');
    st.outcome = OUTCOME_ORDER.find((o) => list.includes(o)); st.outcomes = list;
    const D = S.debrief[st.outcome], extra = [];
    for (const o of list) if (o !== st.outcome) extra.push(S.debrief[o].body);
    if (st.damaged && st.missed['inspect.spare']) extra.push(TX.spareFlat);
    if (st.km2Called && st.outcome === 'clean') extra.push(TX.calledHelped);
    st.enc = 'after';
    ask({ kind: 'debrief', id: 'debrief', outcome: st.outcome, title: D.title, text: D.body, right: D.right, extra, options: [{ id: 'next', text: TX.continue }] });
  }
  function askRejoin() {
    const v = clearVars(), key = st.outcome === 'damaged' && st.missed['inspect.spare'] ? 'damagedNoSpare' : st.outcome;
    ask({ kind: 'choice', id: 'call.rejoin', title: R.channel, lead: TX.rejoin[key], text: TX.rejoinAsk,
      options: RD.rejoinOptions.map((o) => ({ id: o.id, text: fill(o.text, v), say: o.id === 'silent' ? null : fill(o.text, v).replace(/^"|"$/g, '') })) });
  }
  function resume() {
    const c = st.car, moved = st.stuck || st.damaged || st.nearMiss;
    st.stuck = false; st.damaged = false; st.mudTime = 0; st.rockDist = 0;
    st.truck.active = false; st.truck.gone = true;
    if (moved) { c.u = 0.4; c.yaw = c.head = 0; c.v = 0; c.steer = 0; }
    st.endS = Math.min(R.endS, Math.max(c.s, lastEnd) + (S.layout.afterMeeting || 170));
    st.enc = 'done';
    emit('resume', { cut: moved, text: TX.arrive });
  }

  // ---- answers ----------------------------------------------------------------------------------------
  function submit(choice, ms = null) {
    const p = st.pending; if (!p) return false;
    st.pending = null;
    if (p.kind === 'intro') {
      if (choice === 'skip') {
        for (const it of items) { st.missed[it.id] = !!plan.faults[it.id]; decide(it.id, 'skipped', false, ms, { fault: !!plan.faults[it.id] }); }
        startDrive();
      } else { st.phase = 'inspect'; emit('phase', { phase: 'inspect' }); askStation(0); }
    } else if (p.kind === 'inspect') {
      const it = itemById[p.id], fault = !!plan.faults[it.id], fix = choice === 'fix';
      decide(it.id, fix ? 'fix' : 'ok', fault ? fix : true, ms, { fault });
      if (fault && fix) { st.fixed[it.id] = true; emit('inspectResult', { id: it.id, text: fill(it.truthFault + ' ' + it.fixed, baseVars), tone: 'good' }); }
      else if (fault) st.missed[it.id] = true;
      else if (fix) emit('inspectResult', { id: it.id, text: fill(it.truthOk, baseVars), tone: 'info' });
      if (st.station + 1 < items.length) askStation(st.station + 1); else startDrive();
    } else if (p.kind === 'heard') {
      const opt = p.options.find((o) => o.id === choice) || { id: 'no-answer', safe: false };
      decide(p.id, opt.id, !!opt.safe, ms, {});
      emit('answer', { id: p.id, safe: !!opt.safe, text: p.right });
    } else if (p.kind === 'call') {
      if (choice && choice.km != null && choice.dir) sendCall(choice, ms);
    } else if (p.kind === 'note') {
      if (p.id === 'radio.realise') { st.radio.working = true; emit('radio', { who: 'me', text: RD.checkCall }); emit('radio', { who: 'reply', text: RD.checkReply }); }
    } else if (p.kind === 'choice' && p.id === 'call.clear') {
      decide('call.clear', choice, choice === 'clear', ms, {});
      const o = p.options.find((x) => x.id === choice); if (o && o.say) emit('radio', { who: 'me', text: o.say });
      beginWait(choice === 'clear');
    } else if (p.kind === 'debrief') {
      askRejoin();
    } else if (p.kind === 'choice' && p.id === 'call.rejoin') {
      decide('call.rejoin', choice, choice === 'call', ms, {});
      const o = p.options.find((x) => x.id === choice); if (o && o.say) emit('radio', { who: 'me', text: o.say });
      resume();
    }
    return true;
  }

  // ---- one step of the drive ---------------------------------------------------------------------------
  function step(dt, input) {
    if (st.phase !== 'drive' || st.pending || st.done) return;
    st.t += dt;
    const c = st.car, zone = zoneOf(), kind = zone >= 0 ? plan.surfaces[zone] : null, deep = zone >= 0 && c.u > 3.3;
    const locked = st.enc === 'waiting' || st.enc === 'squeeze' || st.enc === 'nearmiss' || st.enc === 'passed';
    const mod = { frozen: locked || st.stuck, pull: st.missed['inspect.tires'] ? -0.035 : 0 };
    if (kind === 'mud' && deep) { st.mudTime += dt; mod.cap = Math.max(0, 3.2 - st.mudTime * 1.3); mod.drag = 2.5; mod.grip = 2; }
    if (kind === 'rock' && deep) { mod.cap = 4; }
    if (st.damaged) mod.cap = Math.min(mod.cap ?? 99, 2.2);
    if (c.off > 0 && zone < 0) { mod.cap = Math.min(mod.cap ?? 99, 13.9 - 9.5 * c.off); mod.drag = (mod.drag || 0) + 2.2 * c.off; }
    const s0 = c.s;
    stepCar(c, input, road, dt, mod);
    if (kind === 'rock' && deep) st.rockDist += Math.abs(c.s - s0);
    if (c.hit === -1 && !st.told.edge) { st.told.edge = true; toast(TX.edge, 'bad'); }

    if (kind === 'mud' && deep && !st.stuck && st.mudTime > 0.6 && Math.abs(c.v) < 0.6) { st.stuck = true; c.v = 0; emit('sfx', { name: 'spin' }); toast(TX.stuck, 'bad'); }
    if (kind === 'rock' && !st.damaged && st.rockDist > 3) { st.damaged = true; emit('sfx', { name: 'bang' }); toast(TX.rockHit, 'bad'); }

    // what a missed inspection item does on the road
    if (st.missed['inspect.lights'] && !st.told.lights && st.t > 4) { st.told.lights = true; toast(TX.oneLight, 'bad'); }
    if (st.missed['inspect.tires'] && !st.told.tires && c.s > 120) { st.told.tires = true; toast(TX.softTire, 'bad'); }
    if (st.missed['inspect.load'] && Math.abs(c.v) > 4) { st.thump += dt; if (st.thump > 11) { st.thump = 0; emit('sfx', { name: 'thump' }); if (!st.told.load) { st.told.load = true; toast(TX.looseLoad, 'bad'); } } }

    // call points you drove past without calling
    for (const p of callPoints) if (!st.decided[p.id] && c.s > p.s + RD.window[1]) { decide(p.id, 'not-made', false, null, {}); toast(TX.notCalled, 'bad', { km: p.km }); }
    // the radio that was never checked: you notice in the end
    if (!st.radio.working && c.s >= RD.realiseS) {
      ask({ kind: 'note', id: 'radio.realise', title: TX.radioRealise.title, text: fill(TX.radioRealise.body, baseVars), options: [{ id: 'next', text: fill(TX.radioRealise.button, baseVars) }] });
      return;
    }
    // calls you hear
    for (const h of RD.heard) {
      if (st.heard[h.id] || c.s < h.s) continue;
      st.heard[h.id] = true;
      if (h.startsTruck) { st.truck.active = true; st.truck.s = Math.max(plan.truckStartS, c.s + 400); st.truck.v = plan.truckSpeed; st.tTruck = st.t; st.enc = 'approach'; }
      if (h.needsRadio && !st.radio.working) continue;
      const text = h.from === 'other' ? fill(RD.otherTemplate, baseVars) : fill(RD.truckTemplate, { ...baseVars, km: h.km });
      emit('radio', { who: h.from, text });
      if (h.question) {
        const q = RD.questions[h.id];
        ask({ kind: 'heard', id: h.id, title: R.channel, heard: text, text: q.ask, right: fill(q.right, baseVars),
          options: q.options.map((o) => ({ id: o.id, text: fill(o.text, baseVars), safe: o.safe })) });
        return;
      }
    }

    // the truck
    const tr = st.truck;
    if (st.enc === 'approach') {
      if (Math.abs(c.v) < 1.5 && c.u < 1.9) tr.stall += dt;
      const hold = tr.stall < 8 && c.s < lastEnd;
      tr.v = st.km2Called ? T.easedSpeed : plan.truckSpeed;
      tr.s -= tr.v * dt; if (hold) tr.s = Math.max(tr.s, lastEnd + 90);
      st.canWait = Math.abs(c.v) < 0.5 && c.u >= 1.9 && zone >= 0;
      st.waitTimer = st.canWait ? st.waitTimer + dt : 0;
      if (tr.s - c.s < T.sightDistance) meet();
      else if (st.waitTimer > 6) waitHere();
    } else if (st.enc === 'waiting' || st.enc === 'squeeze') {
      st.canWait = false; st.encTimer += dt;
      const near = Math.abs(tr.s - c.s) < 45;
      tr.v = st.enc === 'squeeze' && near ? 2.4 : st.km2Called ? T.easedSpeed + 2 : plan.truckSpeed + 2;
      tr.u += ((st.enc === 'squeeze' && tr.s - c.s < 60 ? -1.1 : -0.15) - tr.u) * Math.min(1, dt * 1.2);
      tr.s -= tr.v * dt;
      if (tr.horn && tr.s - c.s < 40 && !st.told.horn) { st.told.horn = true; emit('sfx', { name: st.enc === 'squeeze' ? 'horn-long' : 'horn' }); }
      if (tr.s + 24 < c.s) { st.enc = 'passed'; st.encTimer = 0; }
    } else if (st.enc === 'nearmiss') {
      st.canWait = false; st.encTimer += dt;
      const gap = tr.s - c.s - 7.5;                                   // bumper to bumper, roughly
      tr.v = Math.max(0, Math.min(tr.v, Math.sqrt(Math.max(0, 2 * 4.5 * (gap - 1.5)))));
      tr.s -= tr.v * dt;
      if (tr.v < 0.05 && Math.abs(c.v) < 0.05) { st.stopTimer = (st.stopTimer || 0) + dt; if (st.stopTimer > 2.2) { st.nearMissGap = tr.s - c.s; debrief(); } }
    } else if (st.enc === 'passed') {
      tr.s -= tr.v * dt; st.encTimer += dt;
      if (st.encTimer > 1.8) debrief();
    } else if (st.enc === 'done' && tr.gone) { /* the truck is away down the road */ }

    if (c.s >= st.endS && (st.enc === 'done' || c.s >= R.endS)) finish();
    if (st.t > 1500) finish();
  }

  function finish() {
    if (st.done) return;
    // anything never reached is still reported, so every run carries every decision
    const fallback = { 'heard.other': 'no-answer', 'heard.truck': 'no-answer', 'pullout.choice': 'none', 'pullout.timing': 'on-road', 'call.clear': 'not-applicable', 'call.rejoin': 'silent' };
    for (const d of S.decisions) if (!st.decided[d.id]) decide(d.id, fallback[d.id] || (d.id.startsWith('inspect.') ? 'skipped' : 'not-made'), false, null, { unreached: true });
    if (!st.outcome) st.outcome = 'nearMiss';
    st.done = true; st.phase = 'done';
    emit('end', { summary: summarize(S, st) });
  }

  askIntro();
  return {
    state: st, plan, step, submit, openCall, waitHere, finish,
    drain() { const o = out.slice(); out.length = 0; return o; },
    // km shown on the next board and how far it is: handy for tests and bots
    callPoints,
  };
}

// The personal end screen: what happened, decision by decision.
export function summarize(S, st) {
  const rows = S.decisions.map((d) => {
    const got = st.decided[d.id];
    return { id: d.id, group: d.group, label: d.label, choice: got ? got.choice : null, choiceLabel: got ? (d.choices[got.choice] || got.choice) : '', safe: got ? got.safe : false, ms: got ? got.ms : null };
  });
  const missed = S.inspection.items.filter((it) => st.missed[it.id]).map((it) => fill(it.truthFault + ' ' + it.missed, { channel: S.road.channel, wrongChannel: S.road.wrongChannel }));
  return {
    outcome: st.outcome, outcomes: st.outcomes || [st.outcome], outcomeLabel: S.summary.outcomes[st.outcome] || st.outcome,
    safe: rows.filter((r) => r.safe).length, total: rows.length, rows, missed, takeaways: S.summary.takeaways, seconds: Math.round(st.t),
  };
}
export { clamp };
