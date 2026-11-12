// Seeded, dependency-free noise used by the CPU terrain generator.
// Everything here is deterministic for a given integer seed on every platform
// (only Math.imul / integer ops / IEEE add-mul are used in the hash).

export function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Small PRNG for scalar parameters (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Value noise in [0,1] with analytic derivatives. Writes into out[0..2] = value, d/dx, d/dy.
export function vnoise(x, y, seed, out) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const dux = 30 * fx * fx * (fx * (fx - 2) + 1);
  const duy = 30 * fy * fy * (fy * (fy - 2) + 1);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  const k1 = b - a, k2 = c - a, k3 = a - b - c + d;
  out[0] = a + k1 * ux + k2 * uy + k3 * ux * uy;
  out[1] = dux * (k1 + k3 * uy);
  out[2] = duy * (k2 + k3 * ux);
  return out[0];
}

const tmp = new Float64Array(3);

// Plain fbm in roughly [0,1].
export function fbm(x, y, seed, octaves, gain = 0.5, lac = 2.03) {
  let a = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    a += amp * vnoise(x, y, seed + i * 131, tmp);
    norm += amp;
    amp *= gain;
    // rotate between octaves to hide the lattice
    const nx = (0.8 * x - 0.6 * y) * lac, ny = (0.6 * x + 0.8 * y) * lac;
    x = nx; y = ny;
  }
  return a / norm;
}

// "Eroded" fbm (after Inigo Quilez): octaves are damped where the accumulated
// slope is already steep, which carves ridge-and-gully structure for free.
export function erodedFbm(x, y, seed, octaves, damp = 1.0) {
  let a = 0, amp = 0.5, norm = 0, dx = 0, dy = 0;
  // rotation matrix tracked so derivatives stay in a consistent frame
  let m00 = 1, m01 = 0, m10 = 0, m11 = 1;
  for (let i = 0; i < octaves; i++) {
    vnoise(x, y, seed + i * 173, tmp);
    const gx = tmp[1] * m00 + tmp[2] * m10, gy = tmp[1] * m01 + tmp[2] * m11;
    dx += gx; dy += gy;
    a += amp * tmp[0] / (1 + damp * (dx * dx + dy * dy));
    norm += amp;
    amp *= 0.5;
    const nx = (0.8 * x - 0.6 * y) * 2.0, ny = (0.6 * x + 0.8 * y) * 2.0;
    x = nx; y = ny;
    const a00 = 0.8 * m00 - 0.6 * m10, a01 = 0.8 * m01 - 0.6 * m11;
    const a10 = 0.6 * m00 + 0.8 * m10, a11 = 0.6 * m01 + 0.8 * m11;
    m00 = a00; m01 = a01; m10 = a10; m11 = a11;
  }
  return a / norm;
}

// Ridged multifractal in [0,1]: sharp crests, smooth valleys.
export function ridged(x, y, seed, octaves) {
  let a = 0, amp = 0.5, norm = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(2 * vnoise(x, y, seed + i * 197, tmp) - 1);
    n *= n;
    a += amp * n * prev;
    norm += amp;
    prev = Math.min(1, n * 1.6 + 0.2);
    amp *= 0.5;
    const nx = (0.8 * x - 0.6 * y) * 2.07, ny = (0.6 * x + 0.8 * y) * 2.07;
    x = nx; y = ny;
  }
  return a / norm;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
