// Dev: trace constant-grade side-hill routes over the terrain and report on them.
import fs from 'node:fs';
import { WORLD } from '../public/engine/terrain.js';
import { writePNG } from './png.mjs';
const n = 1024, L = WORLD.size, seed = 7;
const h = new Float32Array(fs.readFileSync(`shots/tmp/height-${seed}.f32`).buffer.slice(0));
const blur = (src, r) => { const o = new Float32Array(n * n), t = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let d = -r; d <= r; d++) { const ii = i + d; if (ii >= 0 && ii < n) { a += src[ii + j * n]; c++; } } t[i + j * n] = a / c; }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let d = -r; d <= r; d++) { const jj = j + d; if (jj >= 0 && jj < n) { a += t[i + jj * n]; c++; } } o[i + j * n] = a / c; }
  return o; };
const hs = blur(blur(h, 2), 2);
const samp = (H, x, z) => { const fx = (x / L + 0.5) * n - 0.5, fz = (z / L + 0.5) * n - 0.5; const i = Math.max(0, Math.min(n - 2, Math.floor(fx))), j = Math.max(0, Math.min(n - 2, Math.floor(fz))); const tx = fx - i, tz = fz - j;
  return (H[i + j * n] * (1 - tx) + H[i + 1 + j * n] * tx) * (1 - tz) + (H[i + (j + 1) * n] * (1 - tx) + H[i + 1 + (j + 1) * n] * tx) * tz; };
const grad = (H, x, z, e = 12) => [(samp(H, x + e, z) - samp(H, x - e, z)) / (2 * e), (samp(H, x, z + e) - samp(H, x, z - e)) / (2 * e)];
function trace(x, z, heading, grade, len, ds = 8) {
  const pts = [[x, z]]; let th = heading;
  for (let s = 0; s < len; s += ds) {
    const [gx, gz] = grad(hs, x, z), gm = Math.hypot(gx, gz);
    let want = th;
    if (gm > Math.abs(grade) + 1e-3) {
      const ga = Math.atan2(gz, gx), phi = Math.acos(grade / gm);
      const c1 = ga + phi, c2 = ga - phi;
      const d = (a) => Math.abs(Math.atan2(Math.sin(a - th), Math.cos(a - th)));
      want = d(c1) < d(c2) ? c1 : c2;
    }
    let dth = Math.atan2(Math.sin(want - th), Math.cos(want - th));
    const maxTurn = ds / 45;                   // min radius 45 m
    dth = Math.max(-maxTurn, Math.min(maxTurn, dth * 0.5));
    th += dth; x += Math.cos(th) * ds; z += Math.sin(th) * ds; pts.push([x, z]);
  }
  return pts;
}
const cands = JSON.parse(process.argv[2] || '[]');
const rgbFile = process.argv[3];
const out = [];
for (const c of cands) {
  const pts = trace(c.x, c.z, c.heading * Math.PI / 180, c.grade, c.len);
  let minH = 1e9, maxH = -1e9, maxSlope = 0, sumSlope = 0, turn = 0;
  const prof = [];
  pts.forEach((p, i) => { const y = samp(h, p[0], p[1]); minH = Math.min(minH, y); maxH = Math.max(maxH, y); const [gx, gz] = grad(hs, p[0], p[1]); const sl = Math.atan(Math.hypot(gx, gz)) * 57.3; maxSlope = Math.max(maxSlope, sl); sumSlope += sl; if (i % 50 === 0) prof.push(`${Math.round(y)}@${Math.round(sl)}`); });
  out.push({ ...c, start: Math.round(samp(h, c.x, c.z)), end: pts[pts.length - 1].map(Math.round), minH: Math.round(minH), maxH: Math.round(maxH), meanSlope: Math.round(sumSlope / pts.length), maxSlope: Math.round(maxSlope), prof: prof.join(' ') });
  c.pts = pts;
}
console.log(JSON.stringify(out, null, 1));
// slope-class map with routes
const rgb = new Uint8Array(n * n * 3);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const x = (i + 0.5) / n * L - L / 2, z = (j + 0.5) / n * L - L / 2, v = h[i + j * n];
  const [gx, gz] = grad(hs, x, z), sl = Math.atan(Math.hypot(gx, gz)) * 57.3;
  let c = v < 0 ? [30, 60, 110] : sl < 12 ? [60, 160, 60] : sl < 22 ? [150, 190, 60] : sl < 32 ? [220, 190, 60] : sl < 42 ? [220, 120, 50] : [150, 50, 50];
  if (v > 1450) c = c.map((q) => q * 0.5 + 110);
  if (v > 0 && Math.floor(v / 100) !== Math.floor(h[Math.min(n * n - 1, i + 1 + j * n)] / 100)) c = [0, 0, 0];
  rgb.set(c, (i + j * n) * 3);
}
for (const c of cands) c.pts.forEach((p, k) => { const i = Math.round((p[0] / L + 0.5) * n), j = Math.round((p[1] / L + 0.5) * n); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const q = (i + a + (j + b) * n) * 3; if (q >= 0 && q < rgb.length - 3) rgb.set(k < 12 ? [255, 255, 255] : [255, 0, 255], q); } });
if (rgbFile) { writePNG(rgbFile, n, n, rgb); console.log('wrote', rgbFile); }
