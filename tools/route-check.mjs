import fs from 'node:fs';
import { buildRoute, heightSampler } from '../public/game/world/route.js';
import { writePNG } from './png.mjs';
const n = 1024, L = 16000;
const h = new Float32Array(fs.readFileSync('shots/tmp/height-7.f32').buffer.slice(0));
const nat = Float32Array.from(h);
const layout = { pad: { s0: -64, s1: -8, width: 20 }, pullouts: [{ s: 2110, length: 34, width: 4.5 }, { s: 2260, length: 34, width: 4.5 }, { s: 2410, length: 34, width: 4.5 }] };
console.time('route'); const R = buildRoute(heightSampler(nat, n, L), layout); console.timeEnd('route');
console.log(R.stats);
for (let s = -180; s <= 3080; s += 200) { const f = R.frame(s); const i = {}; const yl = R.surface(s, -30, i), yr = R.surface(s, 30, i); console.log(s, 'y', f.y.toFixed(1), 'grade', (f.grade * 100).toFixed(1) + '%', 'R', (1 / f.k).toFixed(0), 'left-30', (yl - f.y).toFixed(1), 'right+30', (yr - f.y).toFixed(1), 'pos', f.x.toFixed(0), f.z.toFixed(0)); }
console.time('carve'); const bb = R.bounds(); const mk = { cell: 2, x0: bb.x0, z0: bb.z0, w: Math.ceil((bb.x1 - bb.x0) / 2), h: Math.ceil((bb.z1 - bb.z0) / 2) }; mk.data = new Uint8Array(mk.w * mk.h); R.carve(h, n, L, mk); console.log('mask', mk.w, mk.h); console.timeEnd('carve');
// crop map around the route
const x0 = 3900, z0 = -300, W = 900, Hh = 500, sc = 4;   // 4 m per pixel
const rgb = new Uint8Array(W * Hh * 3), S = heightSampler(h, n, L);
for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) {
  const x = x0 + i * sc, z = z0 + j * sc, v = S(x, z), vx = S(x + 4, z) - v, vz = S(x, z + 4) - v;
  const shade = Math.max(0.2, Math.min(1.4, 0.8 - (vx + vz) / 3));
  let c = [90, 150, 80];
  if (Math.floor(v / 20) !== Math.floor(S(x + sc, z) / 20) || Math.floor(v / 20) !== Math.floor(S(x, z + sc) / 20)) c = [20, 20, 20];
  const mi = Math.floor((x - mk.x0) / 2), mj = Math.floor((z - mk.z0) / 2); const m = mi >= 0 && mj >= 0 && mi < mk.w && mj < mk.h ? mk.data[mi + mj * mk.w] : 0; if (m > 128) c = [200, 180, 140];
  rgb.set(c.map((q) => Math.min(255, q * shade)), (i + j * W) * 3);
}
for (let s = R.sMin; s <= R.sMax; s += 2) { const f = R.frame(s); const i = Math.round((f.x - x0) / sc), j = Math.round((f.z - z0) / sc); if (i >= 0 && j >= 0 && i < W && j < Hh) rgb.set(Math.abs(s % 1000) < 6 ? [255, 255, 255] : [255, 0, 255], (i + j * W) * 3); }
writePNG('shots/tmp/route.png', W, Hh, rgb);
