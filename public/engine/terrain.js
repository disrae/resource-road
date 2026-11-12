// Procedural fjord terrain + terrain-aware wind solve. Pure JS (no DOM, no GL) so
// it can be unit-tested in node. Units are metres; y is up; sea level is y = 0.
import { rng, fbm, erodedFbm, ridged, smoothstep, lerp, clamp } from './noise.js';

export const WORLD = {
  size: 16000,      // side of the simulated square, metres
  top: 4500,        // top of the simulated atmosphere above sea level
  lid: 3600,        // effective lid for the column wind solve
};

// Hand-tuned seeds that give good compositions.
export const FAVOURITE_SEEDS = [7, 2024, 41, 318, 1109];

export function terrainParams(seed) {
  const r = rng(seed * 7919 + 13);
  const L = WORLD.size;
  return {
    seed,
    a1: lerp(0.07, 0.13, r()) * L, k1: lerp(1.6, 2.6, r()) * Math.PI / L, p1: r() * 6.283,
    a2: lerp(0.02, 0.05, r()) * L, k2: lerp(4.5, 7.0, r()) * Math.PI / L, p2: r() * 6.283,
    zoff: lerp(-0.08, 0.08, r()) * L,
    head: lerp(0.12, 0.3, r()) * L,
    wHead: lerp(380, 620, r()), wMouth: lerp(1100, 1700, r()),
    hmax: lerp(2250, 2650, r()),
    ox: r() * 512, oy: r() * 512,
    ridgeMix: lerp(0.35, 0.6, r()),
  };
}

// Height at a single world position. Kept as a function so tests and tools can probe it.
export function heightAt(x, z, P) {
  const L = WORLD.size, s = P.seed;
  // domain warp
  const wx = (fbm(x / 6100 + P.ox, z / 6100 + P.oy, s + 11, 3) - 0.5) * 2600;
  const wz = (fbm(x / 6100 + P.oy + 37, z / 6100 + P.ox + 91, s + 23, 3) - 0.5) * 2600;
  const px = x + wx, pz = z + wz;

  // fjord centre line z = zc(x); it becomes a river valley east of the head
  const zc = P.zoff + P.a1 * Math.sin(px * P.k1 + P.p1) + P.a2 * Math.sin(px * P.k2 + P.p2);
  const dzc = P.a1 * P.k1 * Math.cos(px * P.k1 + P.p1) + P.a2 * P.k2 * Math.cos(px * P.k2 + P.p2);
  const d = Math.abs(pz - zc) / Math.sqrt(1 + dzc * dzc);
  const t = clamp((P.head - px) / (P.head + L / 2), 0, 1);
  const inland = px - P.head;
  let w = lerp(P.wHead, P.wMouth, Math.pow(t, 0.8)) + 3200 * smoothstep(-0.26 * L, -0.5 * L, px);
  w = lerp(w, 260, smoothstep(-200, 1500, inland));
  const dd = d - w;                                   // signed distance to the shore line
  const floor = 0.055 * Math.max(0, inland) + 4 * smoothstep(-400, 300, inland);

  // mountain mass
  const e = erodedFbm(px / 5200 + P.ox, pz / 5200 + P.oy, s + 101, 9, 0.9);
  const rg = ridged(px / 3900 + P.oy, pz / 3900 + P.ox, s + 211, 6);
  let m = lerp(e * 1.25, rg, P.ridgeMix);
  m = 0.3 + 0.9 * Math.pow(clamp(m * 1.15, 0, 1), 1.15);
  // wandering side valleys and passes
  const v = Math.abs(2 * fbm(px / 5600 + P.oy + 7, pz / 5600 + P.ox + 3, s + 307, 2) - 1);
  const valley = lerp(0.26, 1, smoothstep(0.03, 0.24, v));
  const env = 1 - Math.exp(-Math.max(0, dd) / 1750);
  const crag = (ridged(px / 1250 + P.ox, pz / 1250 - P.oy, s + 451, 5) - 0.45) * 330 * m * valley;
  const detail = ((fbm(px / 420, pz / 420, s + 401, 4) - 0.5) * 70 + crag) * env;
  let h;
  if (dd > 0) {
    const shelf = 14 * smoothstep(0, 160, dd);
    h = floor + shelf + P.hmax * env * m * valley + detail;
  } else {
    const wet = smoothstep(300, -300, inland);       // 1 in the fjord, 0 up the river valley
    const sea = -190 * smoothstep(0, -700, dd);
    const flat = floor + (fbm(px / 300, pz / 300, s + 501, 3) - 0.5) * 6;
    h = lerp(flat, sea, wet);
  }
  // a few islands near the mouth
  const isl = fbm(px / 1500 + P.ox * 3, pz / 1500 + P.oy * 3, s + 601, 4);
  const islMask = smoothstep(-500, -1300, dd) * smoothstep(-0.2 * L, -0.34 * L, px);
  const ih = (isl - 0.6) * 1500 * islMask;
  if (ih > -40) h = Math.max(h, lerp(h, ih, smoothstep(-40, 10, ih)));
  return h;
}

// Full heightmap, row-major: index = i + j*n, x = (i+.5)/n*L - L/2, z likewise with j.
export function generateHeightmap(seed, n = 1024) {
  const P = terrainParams(seed), L = WORLD.size;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = (j + 0.5) / n * L - L / 2;
    for (let i = 0; i < n; i++) h[i + j * n] = heightAt((i + 0.5) / n * L - L / 2, z, P);
  }
  return h;
}

function boxBlur(src, n, r) {
  const tmp = new Float32Array(n * n), out = new Float32Array(n * n), k = 2 * r + 1;
  for (let j = 0; j < n; j++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += src[clamp(i, 0, n - 1) + j * n];
    for (let i = 0; i < n; i++) {
      tmp[i + j * n] = acc / k;
      acc += src[Math.min(n - 1, i + r + 1) + j * n] - src[Math.max(0, i - r) + j * n];
    }
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let j = -r; j <= r; j++) acc += tmp[i + clamp(j, 0, n - 1) * n];
    for (let j = 0; j < n; j++) {
      out[i + j * n] = acc / k;
      acc += tmp[i + Math.min(n - 1, j + r + 1) * n] - tmp[i + Math.max(0, j - r) * n];
    }
  }
  return out;
}

// RGBA float data for the GPU: height, dh/dx, dh/dz, relief (height minus local mean, m).
export function buildTerrainTexels(h, n) {
  const L = WORLD.size, dx = L / n, out = new Float32Array(n * n * 4);
  const blur = boxBlur(boxBlur(h, n, Math.max(1, Math.round(n / 80))), n, Math.max(1, Math.round(n / 80)));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = i + j * n;
      const xl = h[Math.max(0, i - 1) + j * n], xr = h[Math.min(n - 1, i + 1) + j * n];
      const zl = h[i + Math.max(0, j - 1) * n], zr = h[i + Math.min(n - 1, j + 1) * n];
      out[k * 4] = h[k];
      out[k * 4 + 1] = (xr - xl) / (2 * dx);
      out[k * 4 + 2] = (zr - zl) / (2 * dx);
      out[k * 4 + 3] = h[k] - blur[k];
    }
  }
  return out;
}

// Shelter at coarse resolution m: how far (m) the surroundings within a couple of kilometres stand
// above each point. Large on valley floors and over a walled-in inlet, zero on open water,
// negative on ridges. Cold night air collects where this is large. RGBA texels, r = shelter.
export function buildShelterTexels(h, n, m = 256) {
  const f = n / m, g = new Float32Array(m * m), out = new Float32Array(m * m * 4);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let acc = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) acc += Math.max(0, h[i * f + a + (j * f + b) * n]);
    g[i + j * m] = acc / (f * f);
  }
  const r = Math.max(1, Math.round(m * 1100 / WORLD.size)), wide = boxBlur(boxBlur(g, m, r), m, r);
  for (let k = 0; k < m * m; k++) out[k * 4] = wide[k] - g[k];
  return out;
}

// Column depth available to the wind at coarse resolution m (terrain smoothed first).
export function columnDepth(h, n, m) {
  const f = n / m, D = new Float32Array(m * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    let acc = 0;
    for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) acc += Math.max(0, h[i * f + a + (j * f + b) * n]);
    D[i + j * m] = acc / (f * f);
  }
  const sm = boxBlur(D, m, 1);
  for (let k = 0; k < m * m; k++) D[k] = clamp(WORLD.lid - sm[k], 900, WORLD.lid);
  return D;
}

// Solve div(D (U + grad phi)) = 0 for unit winds U = x^ and U = z^ with red-black SOR.
// Because the problem is linear in U, any wind direction is a blend of the two solutions,
// so the GPU gets the terrain-deflected column wind for free: u = U + Ux*g0 + Uz*g1.
// Returns RGBA texels: d(phi_x)/dx, d(phi_x)/dz, d(phi_z)/dx, d(phi_z)/dz (dimensionless).
export function solveFlow(h, n, m = 128, iters = 420) {
  const D = columnDepth(h, n, m), dx = WORLD.size / m;
  const phi = [new Float32Array(m * m), new Float32Array(m * m)];
  const idx = (i, j) => i + j * m;
  for (let c = 0; c < 2; c++) {
    const p = phi[c], w = 1.95;
    for (let it = 0; it < iters; it++) {
      for (let col = 0; col < 2; col++) {
        for (let j = 1; j < m - 1; j++) for (let i = 1 + ((j + col) & 1); i < m - 1; i += 2) {
          const k = idx(i, j), d0 = D[k];
          const de = 0.5 * (d0 + D[k + 1]), dw = 0.5 * (d0 + D[k - 1]);
          const ds = 0.5 * (d0 + D[k + m]), dn = 0.5 * (d0 + D[k - m]);
          const src = c === 0 ? dx * (de - dw) : dx * (ds - dn);
          const v = (de * p[k + 1] + dw * p[k - 1] + ds * p[k + m] + dn * p[k - m] + src) / (de + dw + ds + dn);
          p[k] += w * (v - p[k]);
        }
      }
    }
  }
  const out = new Float32Array(m * m * 4);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = idx(i, j), il = Math.max(0, i - 1), ir = Math.min(m - 1, i + 1);
    const jl = Math.max(0, j - 1), jr = Math.min(m - 1, j + 1);
    for (let c = 0; c < 2; c++) {
      out[k * 4 + c * 2] = clamp((phi[c][idx(ir, j)] - phi[c][idx(il, j)]) / ((ir - il) * dx), -1.5, 1.5);
      out[k * 4 + c * 2 + 1] = clamp((phi[c][idx(i, jr)] - phi[c][idx(i, jl)]) / ((jr - jl) * dx), -1.5, 1.5);
    }
  }
  return { texels: out, depth: D, phi, m };
}

// Residual of the column mass balance for a unit wind in component c (for tests):
// returns { before, after } RMS divergence of D*U and of D*(U + grad phi).
export function flowResidual(sol, c) {
  const { depth: D, phi, m } = sol, dx = WORLD.size / m, p = phi[c];
  let b = 0, a = 0, cnt = 0;
  for (let j = 1; j < m - 1; j++) for (let i = 1; i < m - 1; i++) {
    const k = i + j * m, d0 = D[k];
    const de = 0.5 * (d0 + D[k + 1]), dw = 0.5 * (d0 + D[k - 1]);
    const ds = 0.5 * (d0 + D[k + m]), dn = 0.5 * (d0 + D[k - m]);
    const src = c === 0 ? (de - dw) / dx : (ds - dn) / dx;
    const lap = (de * (p[k + 1] - p[k]) - dw * (p[k] - p[k - 1]) + ds * (p[k + m] - p[k]) - dn * (p[k] - p[k - m])) / (dx * dx);
    b += src * src; a += (src + lap) * (src + lap); cnt++;
  }
  return { before: Math.sqrt(b / cnt), after: Math.sqrt(a / cnt) };
}

export function terrainStats(h) {
  let min = Infinity, max = -Infinity, sea = 0, sum = 0, bad = 0;
  for (let k = 0; k < h.length; k++) {
    const v = h[k];
    if (!Number.isFinite(v)) { bad++; continue; }
    if (v < min) min = v; if (v > max) max = v;
    if (v < 0) sea++; sum += v;
  }
  return { min, max, seaFraction: sea / h.length, mean: sum / h.length, bad };
}
