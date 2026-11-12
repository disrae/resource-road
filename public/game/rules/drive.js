// How the pickup drives. Pure and deterministic: no browser, no clock, no randomness.
//
// The pickup is tracked in road coordinates: s = metres along the road, u = metres to the right of
// the centreline, yaw = which way the body points relative to the road (radians, + = right),
// head = which way it is actually moving (lags the body a little: loose gravel), v = speed (m/s).
//
// `road` supplies curvature(s), widthL(s), widthR(s) (see world/route.js, or flatRoad below).

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const CAR = {
  wheelbase: 3.7,
  maxSpeed: 13.9,        // m/s (50 km/h)
  reverseMax: 3.2,
  accel: 2.3,            // m/s2 at a standstill, falling to zero at top speed
  brake: 6.5,
  roll: 0.45,            // coasting deceleration
  steerMax: 0.5,         // radians of front wheel angle at walking pace
  steerFade: 9,          // the faster you go, the less the wheels turn (m/s at which it halves)
  steerRate: 1.5,        // how fast the wheel angle follows the keys, rad/s
  follow: 0.8,           // share of the road's curve the truck follows by itself (1 = on rails)
  align: 0.9,            // how strongly it straightens up along the road when you let go of the keys
  grip: 4.5,             // how quickly the direction of travel catches up with the body
  over: 0.7,             // how far past the road edge it can go on the downhill side
  overR: 1.2,            // and on the ditch side
};

export function newCar(s, u, yaw = 0) { return { s, u, yaw, head: yaw, v: 0, steer: 0, spin: 0, hit: 0, off: 0 }; }

// input: { throttle 0..1, brake 0..1, steer -1..1 }. Holding brake at a standstill reverses.
// mod: { cap (m/s), drag (m/s2), pull (steer offset, rad), frozen (bool: brake to a stop, ignore input), grip }
export function stepCar(c, input, road, dt, mod = {}, P = CAR) {
  const k = road.curvature(c.s);
  const inp = mod.frozen ? { throttle: 0, brake: 0, steer: 0 } : input;
  const st = clamp(inp.steer || 0, -1, 1), thr = clamp(inp.throttle || 0, 0, 1), brk = clamp(inp.brake || 0, 0, 1);

  const lim = P.steerMax / (1 + (c.v / P.steerFade) ** 2);
  const target = st * lim + (mod.pull || 0) * Math.min(1, Math.abs(c.v) / 3);
  const rate = P.steerRate * dt;
  c.steer += clamp(target - c.steer, -rate, rate);

  const cap = Math.max(0, Math.min(P.maxSpeed, mod.cap ?? Infinity));
  let a = 0;
  if (mod.frozen) a = -Math.sign(c.v) * 8;
  else {
    if (thr > 0) a += c.v < -0.1 ? P.brake * thr : P.accel * thr * clamp(1 - c.v / Math.max(cap, 0.01), 0, 1);
    if (brk > 0) a += c.v > 0.15 ? -P.brake * brk : -P.accel * 0.7 * brk * clamp(1 + c.v / P.reverseMax, 0, 1);
  }
  const drag = (thr > 0 && c.v >= 0 ? 0 : P.roll) + (mod.drag || 0);     // rolling drag only when coasting
  let v = c.v + a * dt;
  if (mod.frozen && Math.sign(v) !== Math.sign(c.v)) v = 0;
  const dv = drag * dt; v = Math.abs(v) <= dv ? (thr > 0 || brk > 0 ? v : 0) : v - Math.sign(v) * dv;
  if (v > cap) v = Math.max(cap, v - 7 * dt);
  if (v < -P.reverseMax) v = -P.reverseMax;
  c.v = v;

  const ds = c.v * Math.cos(c.head) / Math.max(0.3, 1 - c.u * k);
  const yawRate = c.v * Math.tan(c.steer) / P.wheelbase;
  const assist = (1 - Math.abs(st)) * P.align * Math.min(1, Math.abs(c.v) / 4);
  const turn = (1 - P.follow) * k * ds;
  c.yaw += (yawRate - turn - c.yaw * assist) * dt;
  c.yaw = clamp(c.yaw, -1.2, 1.2);
  c.head += (c.yaw - c.head) * (1 - Math.exp(-dt * (mod.grip ?? P.grip))) - turn * dt;
  c.s += ds * dt; c.u += c.v * Math.sin(c.head) * dt;
  c.spin += c.v * dt / 0.42;

  const wl = road.widthL(c.s), wr = road.widthR(c.s), uMin = -wl - P.over, uMax = wr + P.overR;
  c.hit = 0;
  if (c.u < uMin) { c.u = uMin; if (c.head * Math.sign(c.v || 1) < 0) { c.head *= 0.4; c.yaw *= 0.6; } c.v *= Math.max(0, 1 - 3 * dt); c.hit = -1; }
  if (c.u > uMax) { c.u = uMax; if (c.head * Math.sign(c.v || 1) > 0) { c.head *= 0.4; c.yaw *= 0.6; } c.v *= Math.max(0, 1 - 3 * dt); c.hit = 1; }
  if (road.sMin != null && c.s < road.sMin) { c.s = road.sMin; if (c.v < 0) c.v = 0; }
  // how far the outer wheels are off the running surface (0 = on it, 1 = well off)
  c.off = Math.max(smooth(wr - 0.9, wr + 0.6, c.u), smooth(-wl + 0.9, -wl - 0.6, c.u));
  return c;
}

// A stand-in road for tests and tools: the scenario's widths with gentle made-up bends.
export function flatRoad(scenario, bends = 1) {
  const L = scenario.layout, hw = 2.7, pad = L.pad, pullouts = L.pullouts;
  const widthL = (s) => hw + (pad ? pad.width * smooth(pad.s0 - 14, pad.s0, s) * smooth(pad.s1 + 16, pad.s1, s) : 0);
  const widthR = (s) => { let w = hw; for (const p of pullouts) w += p.width * smooth(p.s - p.length / 2 - 14, p.s - p.length / 2, s) * smooth(p.s + p.length / 2 + 14, p.s + p.length / 2, s); return w; };
  const pulloutAt = (s, u) => { if (u < hw - 0.4) return -1; for (let i = 0; i < pullouts.length; i++) { const p = pullouts[i]; if (Math.abs(s - p.s) < p.length / 2 + 14) return i; } return -1; };
  const curvature = (s) => bends * (0.012 * Math.sin(s / 42) + 0.006 * Math.sin(s / 19 + 1)) * smooth(60, 260, s);
  return { halfWidth: hw, pullouts, pad, widthL, widthR, pulloutAt, curvature, sMin: -60 };
}
