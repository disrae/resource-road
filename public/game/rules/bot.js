// Scripted players. Used by the tests (node) and by ?auto=<policy> in the browser, so a whole
// run can be played without hands: one good run and one of each way it can go wrong.
// Pure: decides from the run state only.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const GOOD = { inspect: 'right', calls: 'right', answers: 'safe', pull: 'sound', partial: false, clear: 'clear', rejoin: 'call', speed: 11 };

export const POLICIES = {
  good: GOOD,                                              // everything by the book: ends "clean"
  mud: { ...GOOD, pull: 'mud' },                           // pulls into the soft pullout: "stuck"
  rock: { ...GOOD, pull: 'rock' },                         // pulls onto the loose rock: "damaged"
  late: { ...GOOD, partial: true },                        // stops only part way off the road: "late"
  nearmiss: { ...GOOD, pull: 'none' },                     // never pulls over: "nearMiss"
  wrongcalls: { ...GOOD, inspect: 'ok', calls: 'wrong', clear: 'position' },   // passes every item, calls "down"
  careless: { inspect: 'skip', calls: 'none', answers: 'unsafe', pull: 'none', partial: false, clear: 'silent', rejoin: 'silent', speed: 13 },
};

export function createBot(policyName, road) {
  const P = typeof policyName === 'string' ? POLICIES[policyName] || POLICIES.good : policyName;
  const bot = {
    policy: P,
    // answer for whatever card is on screen
    answer(run) {
      const st = run.state, p = st.pending;
      if (!p) return null;
      if (p.kind === 'intro') return P.inspect === 'skip' ? 'skip' : 'do';
      if (p.kind === 'inspect') return P.inspect === 'right' ? (run.plan.faults[p.id] ? 'fix' : 'ok') : 'ok';
      if (p.kind === 'heard') return (p.options.find((o) => (P.answers === 'safe') === !!o.safe) || p.options[0]).id;
      if (p.kind === 'call') {
        const cp = run.callPoints.find((c) => !st.decided[c.id] && st.car.s >= c.s - 70 && st.car.s <= c.s + 150);
        const km = cp ? cp.km : 0;
        return P.calls === 'wrong' ? { km, dir: 'down' } : { km, dir: 'up' };
      }
      if (p.id === 'call.clear') return P.clear;
      if (p.id === 'call.rejoin') return P.rejoin;
      return 'next';
    },
    // what to do at the wheel: { input, call, wait }
    drive(run) {
      const st = run.state, c = st.car;
      let targetU = 0, targetV = P.speed, wait = false, call = false;
      if (P.calls !== 'none') call = run.callPoints.some((p) => !st.decided[p.id] && c.s >= p.s + 4 && c.s <= p.s + 120);
      if (st.enc === 'approach' && P.pull !== 'none') {
        const i = run.plan.surfaces.indexOf(P.pull), p = road.pullouts[i], ds = p.s - c.s;
        if (ds < 80 && ds > -40) targetV = 4.2;
        if (ds < 24 && ds > -40) targetU = P.partial ? 2.7 : 5.0;
        if (ds <= 1) targetV = 0;
        if (st.canWait && ds <= 1.5) wait = true;
      }
      const wantYaw = clamp((targetU - c.u) * 0.2, -0.42, 0.42);
      const steer = clamp((wantYaw - c.yaw) * 3, -1, 1);
      let throttle = 0, brake = 0;
      if (c.v < targetV - 0.3) throttle = clamp((targetV - c.v) * 0.8, 0.2, 1);
      else if (c.v > targetV + 0.4 && c.v > 0.2) brake = targetV === 0 ? 0.9 : 0.5;
      return { input: { throttle, brake, steer }, call, wait };
    },
    // one tick of a hands-off run (tests): answers at once, never waits
    tick(run, dt, ms = 1500) {
      const st = run.state;
      if (st.pending) { run.submit(bot.answer(run), ms); return; }
      if (st.phase !== 'drive') return;
      const a = bot.drive(run);
      if (a.call && run.openCall()) return;
      if (a.wait && run.waitHere()) return;
      run.step(dt, a.input);
    },
  };
  return bot;
}

// Play a whole run with a bot. Returns { state, events }.
export function playThrough(run, bot, { dt = 1 / 30, maxTicks = 200000 } = {}) {
  const events = [];
  for (let i = 0; i < maxTicks && !run.state.done; i++) { bot.tick(run, dt); events.push(...run.drain()); }
  events.push(...run.drain());
  return { state: run.state, events };
}
