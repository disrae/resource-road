// Dev: top-down relief map of the terrain with contour lines, optional route overlay.
import { generateHeightmap, terrainParams, WORLD } from '../public/engine/terrain.js';
import { writePNG } from './png.mjs';
import fs from 'node:fs';
const seed = Number(process.argv[2] || 7), n = 1024, out = process.argv[3] || 'shots/tmp/map.png';
console.time('gen'); const h = generateHeightmap(seed, n); console.timeEnd('gen');
console.log(terrainParams(seed));
fs.writeFileSync(`shots/tmp/height-${seed}.f32`, Buffer.from(h.buffer));
const rgb = new Uint8Array(n * n * 3);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
  const v = h[i + j * n], k = (i + j * n) * 3;
  const vx = h[Math.min(n - 1, i + 1) + j * n] - v, vz = h[i + Math.min(n - 1, j + 1) * n] - v;
  const shade = Math.max(0.25, Math.min(1.3, 0.8 - (vx + vz) / 40));
  let c = v < 0 ? [30, 60, 110] : v < 1450 ? [40 + v / 12, 110 + v / 30, 50] : [200, 200, 210];
  if (v > 0 && Math.floor(v / 100) !== Math.floor((v + Math.max(Math.abs(vx), Math.abs(vz))) / 100)) c = [20, 20, 20];
  for (let q = 0; q < 3; q++) rgb[k + q] = Math.max(0, Math.min(255, c[q] * (v < 0 ? 1 : shade)));
}
// grid every 2 km
for (let g = 1; g < 8; g++) { const p = Math.round(g / 8 * n); for (let t = 0; t < n; t += 2) { rgb[(p + t * n) * 3] = 255; rgb[(t + p * n) * 3] = 255; } }
writePNG(out, n, n, rgb);
console.log('wrote', out);
