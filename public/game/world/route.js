// The road as geometry. Pure JS (no DOM, no GL): unit-tested in node and shared by the
// renderer (corridor mesh, terrain carving, prop placement) and the vehicles.
//
// Road coordinates: s = metres along the centreline (s = 0 is the 0 km board, negative is the
// staging area and the road behind it), u = metres to the RIGHT of the centreline when
// travelling "up" (kilometres increasing).
//
// The centreline is traced over the generated terrain at a steady climb (the way a side-hill
// road is surveyed), then given a gentle meander so there are real corners.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const ROUTE_DEFAULTS = {
  path: null,                // an explicit centreline instead of the traced one: see buildRoute
  pathZero: 0,               // metres along `path` where s = 0 (the first kilometre board) lies
  start: [4300, 450],        // world x, z where the trace begins (the staging area)
  heading: 20,               // degrees, atan2(z, x): 0 = east, 90 = south
  grade: 0.042,              // steady climb of the surveyed line
  sMin: -180,                // road behind the staging area
  sMax: 3080,                // end of the built road (the game ends before this)
  ds: 2,                     // station spacing, metres
  halfWidth: 2.7,            // running surface half-width: a single lane, two vehicles cannot pass
  maxGrade: 0.085,           // steepest pitch allowed in the finished profile
  reach: 72,                 // how far the corridor mesh extends to each side
  meander: [[17, 265, 1.3], [5.5, 118, 4.1], [9, 610, 0.4]],   // amplitude m, wavelength m, phase
};

// sampleNatural(x, z) -> height in metres: the terrain the road is laid on (any terrain source).
// layout: { pad: { s0, s1, width }, pullouts: [{ s, length, width }] } in metres (see scenario.js)
// cfg: any of ROUTE_DEFAULTS. With cfg.path = [[x, z], ...] (world metres, in order of increasing
// kilometres) the centreline follows that line, e.g. a surveyed or GPS line of a real road, instead
// of being traced over the terrain; it is continued straight at both ends to cover sMin..sMax.
export function buildRoute(sampleNatural, layout = {}, cfg = {}) {
  const C = { ...ROUTE_DEFAULTS, ...cfg };
  const ds = C.ds, n = Math.round((C.sMax - C.sMin) / ds) + 1;
  const H = sampleNatural, pad0 = layout.pad || null;
  const gradAt = (x, z, e = 40) => [(H(x + e, z) - H(x - e, z)) / (2 * e), (H(x, z + e) - H(x, z - e)) / (2 * e)];

  // 1. survey line: constant grade over the smoothed terrain, from the staging area forwards, then backwards
  const trace = (x, z, th, grade, len) => {
    const out = [[x, z]], step = 4;
    for (let d = 0; d < len; d += step) {
      const [gx, gz] = gradAt(x, z), gm = Math.hypot(gx, gz);
      let want = th;
      if (gm > Math.abs(grade) + 1e-3) {
        const ga = Math.atan2(gz, gx), phi = Math.acos(grade / gm);
        const dist = (a) => Math.abs(Math.atan2(Math.sin(a - th), Math.cos(a - th)));
        want = dist(ga + phi) < dist(ga - phi) ? ga + phi : ga - phi;
      }
      let dth = Math.atan2(Math.sin(want - th), Math.cos(want - th)) * 0.5;
      dth = clamp(dth, -step / 60, step / 60);
      th += dth; x += Math.cos(th) * step; z += Math.sin(th) * step;
      out.push([x, z]);
    }
    return out;
  };
  let line, i0;
  if (C.path && C.path.length > 1) {
    // a given centreline: continue it straight at both ends, then walk it in 4 m steps
    const P = C.path.map((p) => [p[0], p[1]]);
    const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
    let total = 0; for (let i = 1; i < P.length; i++) total += seg(P[i - 1], P[i]);
    const on = (a, b, len) => { const l = seg(a, b) || 1; return [b[0] + (b[0] - a[0]) / l * len, b[1] + (b[1] - a[1]) / l * len]; };
    const before = Math.max(8, -C.sMin + 80 - C.pathZero), after = Math.max(8, C.sMax + 80 - (total - C.pathZero));
    P.unshift(on(P[1], P[0], before)); P.push(on(P[P.length - 2], P[P.length - 1], after));
    line = [P[0]];
    let k = 1, at = 0, done = 0;                                // segment k-1..k, `at` metres into it
    for (let want = 4; want < total + before + after; want += 4) {
      while (k < P.length - 1 && done + seg(P[k - 1], P[k]) < want) { done += seg(P[k - 1], P[k]); k++; }
      at = want - done; const l = seg(P[k - 1], P[k]) || 1, t = at / l;
      line.push([P[k - 1][0] + (P[k][0] - P[k - 1][0]) * t, P[k - 1][1] + (P[k][1] - P[k - 1][1]) * t]);
    }
    i0 = Math.round((before + C.pathZero) / 4);
  } else {
    const th0 = C.heading * Math.PI / 180;
    const fwd = trace(C.start[0], C.start[1], th0, C.grade, C.sMax + 80);
    const back = trace(C.start[0], C.start[1], th0 + Math.PI, -C.grade, -C.sMin + 80);
    line = back.slice(1).reverse().concat(fwd);                // 4 m spacing, index of s=0 is back.length-1
    i0 = back.length - 1;
  }

  // 2. meander: offset along the normal, fading in after the staging area (traced roads only)
  const off = C.path ? line : line.map((p, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const s = (i - i0) * 4;
    let m = 0;
    for (const [amp, wl, ph] of C.meander) m += amp * Math.sin(2 * Math.PI * s / wl + ph);
    m *= smooth(60, 260, s);
    return [p[0] - tz * m, p[1] + tx * m];                      // right-hand normal of (tx, tz) is (-tz, tx)
  });
  // 3. smooth, then resample at uniform arc length
  const sm = off.map((p, i) => {
    let x = 0, z = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const q = off[clamp(i + k, 0, off.length - 1)], wk = 4 - Math.abs(k); x += q[0] * wk; z += q[1] * wk; w += wk; }
    return [x / w, z / w];
  });
  const acc = [0];
  for (let i = 1; i < sm.length; i++) acc.push(acc[i - 1] + Math.hypot(sm[i][0] - sm[i - 1][0], sm[i][1] - sm[i - 1][1]));
  const at0 = acc[i0];
  const X = new Float64Array(n), Z = new Float64Array(n), Y = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const want = at0 + C.sMin + i * ds;
    while (j < acc.length - 2 && acc[j + 1] < want) j++;
    const t = clamp((want - acc[j]) / (acc[j + 1] - acc[j] || 1), -2, 3);
    X[i] = sm[j][0] + (sm[j + 1][0] - sm[j][0]) * t; Z[i] = sm[j][1] + (sm[j + 1][1] - sm[j][1]) * t;
  }
  // 4. tangents, curvature, vertical profile (the terrain along the line, heavily smoothed)
  const TX = new Float64Array(n), TZ = new Float64Array(n), K = new Float64Array(n), G = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const tx = X[b] - X[a], tz = Z[b] - Z[a], l = Math.hypot(tx, tz) || 1;
    TX[i] = tx / l; TZ[i] = tz / l;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const cross = TX[a] * TZ[b] - TZ[a] * TX[b], dot = TX[a] * TX[b] + TZ[a] * TZ[b];
    K[i] = Math.atan2(cross, dot) / ((b - a) * ds);            // positive = turning right
  }
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) raw[i] = H(X[i], Z[i]);
  const box = (src, r) => { const o = new Float64Array(n); let a = 0; const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + src[i];
    for (let i = 0; i < n; i++) { const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r); o[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1); } void a; return o; };
  const prof = box(box(raw, Math.round(70 / ds)), Math.round(70 / ds));
  for (let i = 0; i < n; i++) Y[i] = prof[i];
  // level the staging pad, ease any pitch steeper than maxGrade (working outwards from the pad), round the breaks
  const gmax = C.maxGrade * ds;
  let i00 = Math.round(-C.sMin / ds);
  if (pad0) {
    const a = Math.round((pad0.s0 - 20 - C.sMin) / ds), b = Math.round((pad0.s1 + 6 - C.sMin) / ds), mid = Math.round((a + b) / 2), yp = Y[mid];
    for (let i = a; i <= b; i++) Y[i] = yp + (i - mid) * ds * 0.012;
    i00 = mid;
  }
  for (let i = i00 + 1; i < n; i++) Y[i] = clamp(Y[i], Y[i - 1] - gmax, Y[i - 1] + gmax);
  for (let i = i00 - 1; i >= 0; i--) Y[i] = clamp(Y[i], Y[i + 1] - gmax, Y[i + 1] + gmax);
  { const r = box(box(Y, Math.round(16 / ds)), Math.round(16 / ds)); for (let i = 0; i < n; i++) Y[i] = r[i]; }
  for (let i = 0; i < n; i++) G[i] = (Y[Math.min(n - 1, i + 1)] - Y[Math.max(0, i - 1)]) / ((Math.min(n - 1, i + 1) - Math.max(0, i - 1)) * ds);

  const pad = layout.pad || null, pullouts = layout.pullouts || [];
  const hw = C.halfWidth;
  // half-widths of the running surface at s: [left, right]
  const widthL = (s) => hw + (pad ? pad.width * smooth(pad.s0 - 14, pad.s0, s) * smooth(pad.s1 + 16, pad.s1, s) : 0);
  const widthR = (s) => {
    let w = hw;
    for (const p of pullouts) w += p.width * smooth(p.s - p.length / 2 - 14, p.s - p.length / 2, s) * smooth(p.s + p.length / 2 + 14, p.s + p.length / 2, s);
    return w;
  };
  // which pullout (index) a point of the widened right side belongs to, or -1
  const pulloutAt = (s, u) => {
    if (u < hw - 0.4) return -1;
    for (let i = 0; i < pullouts.length; i++) { const p = pullouts[i]; if (Math.abs(s - p.s) < p.length / 2 + 14) return i; }
    return -1;
  };

  const idx = (s) => clamp((s - C.sMin) / ds, 0, n - 1.0001);
  const lerpArr = (A, f) => { const i = Math.floor(f), t = f - i; return A[i] * (1 - t) + A[i + 1] * t; };
  // How far the built corridor reaches beyond the road edge, per station and side. It is shortened on
  // the inside of tight corners so the corridor never folds over itself.
  const RL = new Float64Array(n), RR = new Float64Array(n);
  {
    const rawL = new Float64Array(n), rawR = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const s = C.sMin + i * ds, k = K[i];
      rawR[i] = k > 1e-5 ? clamp(0.78 / k - widthR(s), 16, C.reach) : C.reach;
      rawL[i] = k < -1e-5 ? clamp(0.78 / -k - widthL(s), 16, C.reach) : C.reach;
    }
    const w = Math.round(36 / ds);
    const minf = (A) => { const o = new Float64Array(n); for (let i = 0; i < n; i++) { let m = Infinity; for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) m = Math.min(m, A[j]); o[i] = m; } return o; };
    const a = box(box(minf(rawL), w), w), b = box(box(minf(rawR), w), w);
    for (let i = 0; i < n; i++) { RL[i] = a[i]; RR[i] = b[i]; }
  }
  const reachD = (s, right) => lerpArr(right ? RR : RL, idx(s));
  const frame = (s) => {
    const f = idx(s);
    let tx = lerpArr(TX, f), tz = lerpArr(TZ, f); const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: lerpArr(X, f), y: lerpArr(Y, f), z: lerpArr(Z, f), tx, tz, k: lerpArr(K, f), grade: lerpArr(G, f) };
  };
  // design cross-section relative to the centreline height. d = metres outside the running surface.
  const lower = (d) => -0.12 - d / 1.7;                                             // fill slope
  const upper = (d) => (d < 2.6 ? -0.55 * Math.sin(Math.PI * clamp(d / 2.6, 0, 1)) : 0) + Math.max(0, d - 2.2) / 1.05;   // ditch, then cut slope
  // height of the finished ground at (s, u). Also reports what kind of ground it is.
  const surface = (s, u, info = null) => {
    const f = frame(s), wl = widthL(s), wr = widthR(s);
    const d = u > wr ? u - wr : u < -wl ? -u - wl : 0;
    const x = f.x - f.tz * u, z = f.z + f.tx * u;
    let y, kind;
    if (d <= 0) {
      const camber = u > hw ? -0.012 * (u - hw) - 0.02 * hw : u < -hw ? -0.02 * hw - 0.004 * (-u - hw) : -0.02 * Math.abs(u);
      y = f.y + camber; kind = 0;                                                   // running surface
    } else {
      const edge = f.y - 0.02 * hw - (u > 0 ? 0.012 * (wr - hw) : 0.004 * (wl - hw));
      const nat = H(x, z), lo = edge + lower(d), hi = edge + upper(d);
      if (nat > hi) { y = hi; kind = d < 2.6 ? 1 : 2; }                             // ditch / cut bank
      else if (nat < lo) { y = lo; kind = 3; }                                      // fill slope
      else { y = nat; kind = d < 1.2 ? 1 : 4; }                                     // natural ground
      // ease the last of the corridor back onto the untouched hillside
      const rd = reachD(s, u > 0);
      const t = smooth(rd * 0.62, rd * 0.95, d);
      if (t > 0) { y = y * (1 - t) + nat * t; }
    }
    if (info) { info.kind = kind; info.d = d; info.x = x; info.z = z; info.wl = wl; info.wr = wr; }
    return y;
  };
  const toWorld = (s, u, out = [0, 0, 0]) => { const f = frame(s); out[0] = f.x - f.tz * u; out[2] = f.z + f.tx * u; out[1] = surface(s, u); return out; };

  // nearest station to a world point: coarse scan, then refine. Returns { s, u, dist }.
  const locate = (x, z, hint = null) => {
    let best = 0, bd = Infinity;
    if (hint != null) { const c = Math.round(idx(hint)); for (let i = Math.max(0, c - 40); i <= Math.min(n - 1, c + 40); i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } } }
    else {
      for (let i = 0; i < n; i += 8) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      for (let i = Math.max(0, best - 8); i <= Math.min(n - 1, best + 8); i++) { const d = (X[i] - x) ** 2 + (Z[i] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    const dx = x - X[best], dz = z - Z[best];
    const along = dx * TX[best] + dz * TZ[best], u = -dx * TZ[best] + dz * TX[best];
    return { s: C.sMin + best * ds + clamp(along, -ds, ds), u, dist: Math.sqrt(bd), end: best === 0 || best === n - 1 };
  };

  // Press the road into a heightmap (row-major, n x n texels over a square of side L centred on the
  // origin). Under the corridor mesh the terrain is sunk out of sight; mask (optional Uint8Array,
  // m x m) receives 255 where trees must not grow.
  // mask: { data: Uint8Array, w, h, x0, z0, cell } covering the rectangle around the road.
  const carve = (h, hn, L, mask = null) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    const R = C.reach + 40;
    const cell = (v, N) => clamp(Math.floor((v / L + 0.5) * N), 0, N - 1);
    for (let jz = cell(z0 - R, hn); jz <= cell(z1 + R, hn); jz++) for (let ix = cell(x0 - R, hn); ix <= cell(x1 + R, hn); ix++) {
      const x = (ix + 0.5) / hn * L - L / 2, z = (jz + 0.5) / hn * L - L / 2;
      const q = locate(x, z);
      if (q.dist > R || q.end) continue;
      const info = {}; let y = surface(q.s, q.u, info);
      const rd = reachD(q.s, q.u > 0), d = info.d;
      if (d > rd + 30) continue;
      // keep the coarse terrain below the built ground everywhere inside the corridor (cuts are concave)
      y = Math.min(y, frame(q.s).y - 0.8 + Math.max(0, d - 10) * 0.6);
      const sink = smooth(rd * 0.95, rd * 0.5, d);
      h[ix + jz * hn] = h[ix + jz * hn] * (1 - sink) + (y - 4.5) * sink;
    }
    if (mask) {
      for (let jz = 0; jz < mask.h; jz++) for (let ix = 0; ix < mask.w; ix++) {
        const x = mask.x0 + (ix + 0.5) * mask.cell, z = mask.z0 + (jz + 0.5) * mask.cell;
        const q = locate(x, z);
        if (q.dist > 90 || q.end) continue;
        const wl = widthL(q.s), wr = widthR(q.s);
        const d = q.u > 0 ? q.u - wr : -q.u - wl;
        // the engine's own trees are kept off the right-of-way and the band the game plants itself,
        // and off the slope below the staging area so the view down the inlet is open
        let lim = clearing(q.s, q.u > 0);
        if (pad && q.u < 0) lim = Math.max(lim, 62 * smooth(pad.s0 - 60, pad.s0 - 10, q.s) * smooth(pad.s1 + 50, pad.s1 + 5, q.s));
        if (d < lim) mask.data[ix + jz * mask.w] = 255;
      }
    }
    return { x0: x0 - 60, x1: x1 + 60, z0: z0 - 60, z1: z1 + 60 };
  };
  // width of the band beside the road (beyond the edge) that the game plants with its own trees
  const clearing = (s, right) => Math.min(reachD(s, right) * 0.6, (right ? 17 : 15) + 2.0 * Math.sin(s * 0.071) + 1.5 * Math.sin(s * 0.19));
  const bounds = () => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, X[i]); x1 = Math.max(x1, X[i]); z0 = Math.min(z0, Z[i]); z1 = Math.max(z1, Z[i]); }
    return { x0: x0 - 60, x1: x1 + 60, z0: z0 - 60, z1: z1 + 60 }; };

  let maxGrade = 0, minRadius = Infinity;
  for (let i = 0; i < n; i++) { maxGrade = Math.max(maxGrade, Math.abs(G[i])); if (Math.abs(K[i]) > 1e-6) minRadius = Math.min(minRadius, 1 / Math.abs(K[i])); }

  return {
    cfg: C, n, ds, sMin: C.sMin, sMax: C.sMax, X, Y, Z, TX, TZ, K, G, halfWidth: hw, reach: C.reach,
    pad, pullouts, widthL, widthR, pulloutAt, reachD, clearing, frame, surface, toWorld, locate, carve, bounds,
    curvature: (s) => lerpArr(K, idx(s)), grade: (s) => lerpArr(G, idx(s)),
    stats: { maxGrade, minRadius, y0: frame(0).y, y1: frame(C.sMax).y },
  };
}

// Bilinear sampler over a row-major heightmap, matching the engine's heightAt (texel centres).
export function heightSampler(h, n, L) {
  return (x, z) => {
    const fx = clamp((x / L + 0.5) * n - 0.5, 0, n - 1.001), fz = clamp((z / L + 0.5) * n - 0.5, 0, n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    return (h[i + j * n] * (1 - tx) + h[i + 1 + j * n] * tx) * (1 - tz) + (h[i + (j + 1) * n] * (1 - tx) + h[i + 1 + (j + 1) * n] * tx) * tz;
  };
}
