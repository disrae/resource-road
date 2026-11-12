// The built ground along the road: one mesh in road coordinates (stations every 2 m, columns
// packed tightly across the road, ditch and banks and spread out toward the forest), plus the
// plants and stones the game puts on it. The engine terrain is sunk out of sight underneath.
import * as THREE from '../../vendor/three.module.min.js';
import { groundMaterial, propMaterial } from '../render/materials.js';
import { Kit, tf, rand } from './kit.js';

const D_LIST = [0.5, 1.0, 1.5, 2.0, 2.6, 3.4, 4.6, 6.2, 8.5, 11.5, 15.5, 21, 28, 37, 48, 60, 72];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildGround(route, textures = null) {
  const nS = route.n, ds = route.ds, hw = route.halfWidth, nD = D_LIST.length;
  const inner = [];                                     // [side, t]: left apron, lane, right apron
  for (let k = 0; k < 3; k++) inner.push([-1, k / 3]);
  for (let k = 0; k < 4; k++) inner.push([0, k / 4]);
  for (let k = 0; k <= 3; k++) inner.push([1, k / 3]);
  const cols = nD + inner.length + nD, nV = nS * cols;
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3), aRoad = new Float32Array(nV * 4), aMat = new Float32Array(nV * 4);
  const pIdx = new Int8Array(nV).fill(-1), pW = new Float32Array(nV);
  for (let i = 0; i < nS; i++) {
    const s = route.sMin + i * ds, f = route.frame(s), wl = route.widthL(s), wr = route.widthR(s);
    const rl = route.reachD(s, false), rr = route.reachD(s, true), ang = Math.atan2(f.tx, -f.tz);
    const pi = route.pulloutAt(s, hw + 1), pull = pi >= 0 ? Math.min(1, (wr - hw) / route.pullouts[pi].width) : 0;
    const padW = route.pad ? Math.min(1, (wl - hw) / route.pad.width) : 0;
    for (let c = 0; c < cols; c++) {
      let u, d = 0, pw = 0, padw = 0;
      if (c < nD) { d = -D_LIST[nD - 1 - c] * rl / 72; u = -wl + d; padw = padW * smooth(2.5, 0, -d); }
      else if (c < nD + inner.length) {
        const [side, t] = inner[c - nD];
        u = side < 0 ? -wl + (wl - hw) * t : side === 0 ? -hw + 2 * hw * t : hw + (wr - hw) * t;
        if (side > 0 && t > 0) pw = pull;
        if (side < 0 || (side === 0 && t === 0)) padw = padW;
      } else { d = D_LIST[c - nD - inner.length] * rr / 72; u = wr + d; pw = pull * smooth(1.6, 0, d); }
      const v = i * cols + c;
      let y = route.surface(s, u);
      if (c === 0 || c === cols - 1) y -= 3.5;           // tuck the outer edge under the engine terrain
      pos[v * 3] = f.x - f.tz * u; pos[v * 3 + 1] = y; pos[v * 3 + 2] = f.z + f.tx * u;
      aRoad[v * 4] = s; aRoad[v * 4 + 1] = u; aRoad[v * 4 + 2] = d; aRoad[v * 4 + 3] = ang;
      aMat[v * 4 + 3] = padw; pIdx[v] = pw > 0 ? pi : -1; pW[v] = pw;
    }
  }
  const P = (i, c, o) => { const v = (Math.max(0, Math.min(nS - 1, i)) * cols + Math.max(0, Math.min(cols - 1, c))) * 3; o[0] = pos[v]; o[1] = pos[v + 1]; o[2] = pos[v + 2]; };
  const a = [0, 0, 0], b = [0, 0, 0], c1 = [0, 0, 0], d1 = [0, 0, 0];
  for (let i = 0; i < nS; i++) for (let c = 0; c < cols; c++) {
    P(i - 1, c, a); P(i + 1, c, b); P(i, c - 1, c1); P(i, c + 1, d1);
    const sx = b[0] - a[0], sy = b[1] - a[1], sz = b[2] - a[2], ux = d1[0] - c1[0], uy = d1[1] - c1[1], uz = d1[2] - c1[2];
    let nx = uy * sz - uz * sy, ny = uz * sx - ux * sz, nz = ux * sy - uy * sx; const l = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const v = (i * cols + c) * 3; nor[v] = nx / l; nor[v + 1] = ny / l; nor[v + 2] = nz / l;
  }
  const idx = new Uint32Array((nS - 1) * (cols - 1) * 6);
  let k = 0;
  for (let i = 0; i < nS - 1; i++) for (let c = 0; c < cols - 1; c++) {
    const v0 = i * cols + c, v1 = v0 + 1, v2 = v0 + cols, v3 = v2 + 1;
    idx[k++] = v0; idx[k++] = v1; idx[k++] = v2; idx[k++] = v1; idx[k++] = v3; idx[k++] = v2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 4));
  const matAttr = new THREE.BufferAttribute(aMat, 4); g.setAttribute('aMat', matAttr);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const material = groundMaterial(hw, textures); material.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(g, material); mesh.frustumCulled = false;
  // types: one of 'sound' | 'mud' | 'rock' per pullout, in road order
  const setSurfaces = (types) => {
    for (let v = 0; v < nV; v++) {
      const p = pIdx[v], w = pW[v], t = p >= 0 ? types[p] : null;
      aMat[v * 4] = t === 'mud' ? w : 0; aMat[v * 4 + 1] = t === 'rock' ? w : 0; aMat[v * 4 + 2] = p >= 0 ? w : 0;
    }
    matAttr.needsUpdate = true;
  };
  return { mesh, setSurfaces };
}

// ---- plants and stones --------------------------------------------------------------------------

// a drooping whorl of boughs: a ragged cone skirt from an apex on the trunk down to a rim
function whorl(kit, y, r, rise, droop, seg, phase, inner, outer, rnd) {
  for (let i = 0; i < seg; i++) {
    const a0 = phase + (i / seg) * Math.PI * 2, a1 = phase + ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const r0 = r * (0.72 + 0.5 * rnd()), rm = r0 * 0.62;
    const tip = [Math.cos(am) * r0, y - droop * (0.7 + 0.6 * rnd()), Math.sin(am) * r0];
    const l = [Math.cos(a0) * rm, y - droop * 0.35, Math.sin(a0) * rm], rr = [Math.cos(a1) * rm, y - droop * 0.35, Math.sin(a1) * rm];
    const top = [0, y + rise, 0];
    const ny = r / (rise + droop + 1e-3) * 0.9;
    const N = (ang) => { const q = Math.hypot(1, ny); return [Math.cos(ang) / q, ny / q, Math.sin(ang) / q]; };
    const push = (p, n, c) => { kit.pos.push(...p); kit.nor.push(...n); kit.col.push(...c); kit.aux.push(0.06, 0, 0, 5); kit.uv.push(-1, -1); };
    push(top, N(am), inner); push(tip, N(am), outer); push(l, N(a0), inner);
    push(top, N(am), inner); push(rr, N(a1), inner); push(tip, N(am), outer);
  }
}

function conifer({ tiers, crown0, radius, droop, seg, bark, dark, light, trunkR, stubs, seed }) {
  const kit = new Kit(), rnd = rand(seed);
  kit.cyl(trunkR * 0.25, trunkR, 1.03, 7, tf(0, 0.485, 0), bark, { gloss: 0.05 });
  for (let i = 0; i < stubs; i++) {                       // dead lower branches
    const y = 0.07 + (crown0 - 0.07) * rnd(), a = rnd() * 6.283, len = 0.03 + 0.05 * rnd();
    kit.cyl(0.0008, 0.0022, len, 3, tf(Math.cos(a) * len * 0.5, y, Math.sin(a) * len * 0.5, 0, -a, Math.PI / 2 + 0.25), [0.13, 0.12, 0.11], { gloss: 0.02 });
  }
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1), y = crown0 + (0.985 - crown0) * Math.pow(f, 0.92);
    const r = radius * (1 - Math.pow(f, 1.25)) * (0.82 + 0.3 * rnd()) + 0.012;
    const sh = 0.75 + 0.5 * rnd();
    whorl(kit, y, r, 0.1 * (1 - 0.5 * f), droop * (1 - 0.6 * f), seg, rnd() * 6.283, dark.map((v) => v * sh), light.map((v) => v * sh), rnd);
  }
  return kit.build();
}

function alder(seed) {
  const kit = new Kit(), rnd = rand(seed), bark = [0.30, 0.29, 0.26];
  kit.cyl(0.006, 0.014, 0.75, 6, tf(0.01, 0.36, 0, 0, 0, -0.04), bark, { gloss: 0.1 });
  for (let i = 0; i < 4; i++) {
    const a = rnd() * 6.283, y = 0.45 + 0.1 * i, len = 0.3 - 0.03 * i, tilt = 0.5 + 0.3 * rnd();
    kit.cyl(0.002, 0.006, len, 4, tf(Math.cos(a) * Math.sin(tilt) * len / 2, y + Math.cos(tilt) * len / 2, Math.sin(a) * Math.sin(tilt) * len / 2, 0, -a, -tilt), bark, { gloss: 0.1 });
    for (let j = 0; j < 3; j++) {
      const q = 0.5 + 0.25 * j, rr = 0.07 + 0.06 * rnd(), yel = rnd();
      const col = [0.26 + 0.2 * yel, 0.25 + 0.06 * yel, 0.05];
      kit.add(new THREE.IcosahedronGeometry(1, 0), tf(Math.cos(a) * Math.sin(tilt) * len * q + (rnd() - 0.5) * 0.08, y + Math.cos(tilt) * len * q + (rnd() - 0.3) * 0.08, Math.sin(a) * Math.sin(tilt) * len * q + (rnd() - 0.5) * 0.08, rnd() * 3, rnd() * 3, 0, rr, rr * 0.55, rr), col, { gloss: 0.12 });
    }
  }
  return kit.build();
}

function snag(seed) {
  const kit = new Kit(), rnd = rand(seed), grey = [0.2, 0.19, 0.17];
  kit.cyl(0.007, 0.013, 1.0, 6, tf(0, 0.48, 0, 0, 0, 0.03), grey, { gloss: 0.08 });
  for (let i = 0; i < 9; i++) {
    const y = 0.3 + 0.65 * rnd(), a = rnd() * 6.283, len = 0.05 + 0.1 * rnd();
    kit.cyl(0.0008, 0.003, len, 3, tf(Math.cos(a) * len * 0.5, y, Math.sin(a) * len * 0.5, 0, -a, Math.PI / 2 - 0.2), grey, { gloss: 0.04 });
  }
  return kit.build();
}

function stump() {
  const kit = new Kit();
  kit.cyl(0.42, 0.55, 1, 9, tf(0, 0.5, 0), [0.1, 0.08, 0.06], { gloss: 0.05 });
  kit.cyl(0.4, 0.4, 0.02, 9, tf(0, 1.0, 0), [0.42, 0.34, 0.2], { gloss: 0.1 });
  return kit.build();
}

function tuft(seed) {
  const kit = new Kit(), rnd = rand(seed);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283, lean = 0.15 + 0.55 * rnd(), h = 0.6 + 0.4 * rnd(), w = 0.035;
    const bx = Math.cos(a), bz = Math.sin(a), px = -bz * w, pz = bx * w, ox = (rnd() - 0.5) * 0.25, oz = (rnd() - 0.5) * 0.25;
    const tip = [ox + bx * lean, h, oz + bz * lean], n = [bx * 0.5, 0.8, bz * 0.5];
    const push = (p, c) => { kit.pos.push(...p); kit.nor.push(...n); kit.col.push(...c); kit.aux.push(0.1, 0, 0, 5); kit.uv.push(-1, -1); };
    push([ox - px, 0, oz - pz], [0.5, 0.5, 0.5]); push(tip, [1, 1, 1]); push([ox + px, 0, oz + pz], [0.5, 0.5, 0.5]);
  }
  return kit.build();
}

function bush(seed) {
  const kit = new Kit(), rnd = rand(seed);
  for (let i = 0; i < 4; i++) {
    const r = 0.35 + 0.3 * rnd(), g = 0.7 + 0.5 * rnd();
    kit.add(new THREE.IcosahedronGeometry(1, 1), tf((rnd() - 0.5) * 0.8, 0.25 + 0.3 * rnd(), (rnd() - 0.5) * 0.8, rnd() * 3, rnd() * 3, 0, r, r * 0.7, r), [0.035 * g, 0.075 * g, 0.03 * g], { gloss: 0.3 });
  }
  return kit.build();
}

function boulder(seed) {
  const rnd = rand(seed), g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)].map((v) => v.toFixed(3)).join(',');
    if (!seen.has(key)) seen.set(key, 0.72 + 0.5 * rnd());
    const m = seen.get(key); p.setXYZ(i, p.getX(i) * m, p.getY(i) * m * 0.75, p.getZ(i) * m);
  }
  return new Kit().add(g, null, [0.3, 0.295, 0.285], { gloss: 0.12 }).build();
}

const FIR = { tiers: 13, crown0: 0.34, radius: 0.15, droop: 0.05, seg: 8, bark: [0.105, 0.08, 0.06], dark: [0.018, 0.04, 0.022], light: [0.055, 0.105, 0.045], trunkR: 0.0115, stubs: 9 };
const CEDAR = { tiers: 11, crown0: 0.16, radius: 0.19, droop: 0.085, seg: 8, bark: [0.13, 0.075, 0.05], dark: [0.022, 0.045, 0.018], light: [0.07, 0.12, 0.04], trunkR: 0.014, stubs: 3 };
const YOUNG = { tiers: 8, crown0: 0.07, radius: 0.24, droop: 0.05, seg: 7, bark: [0.1, 0.08, 0.06], dark: [0.02, 0.05, 0.022], light: [0.06, 0.13, 0.05], trunkR: 0.012, stubs: 0 };

// Plant the corridor. Returns { group, update(camera, range) }.
export function buildFlora(route, { density = 1 } = {}) {
  const geos = {
    firA: conifer({ ...FIR, seed: 11 }), firB: conifer({ ...FIR, seed: 23, crown0: 0.45, radius: 0.13 }),
    cedar: conifer({ ...CEDAR, seed: 5 }), young: conifer({ ...YOUNG, seed: 9 }),
    alder: alder(3), snag: snag(4), stump: stump(), tuft: tuft(6), bush: bush(8), rockA: boulder(2), rockB: boulder(19),
  };
  const material = propMaterial({ instanced: true });
  const CH = 110, nCh = Math.ceil((route.sMax - route.sMin) / CH);
  const lists = Array.from({ length: nCh }, () => ({}));
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const put = (type, s, u, sx, sy, yaw, tint, lean = 0, sinkY = 0) => {
    const ch = Math.max(0, Math.min(nCh - 1, Math.floor((s - route.sMin) / CH)));
    const w = route.toWorld(s, u);
    _e.set(lean * Math.cos(yaw * 3.1), yaw, lean * Math.sin(yaw * 3.1)); _q.setFromEuler(_e); _p.set(w[0], w[1] - sinkY, w[2]); _s.set(sx, sy, sx);
    (lists[ch][type] ||= []).push({ m: new THREE.Matrix4().compose(_p, _q, _s), c: tint });
  };
  const rnd = rand(4242), pad = route.pad;
  const nearPadLeft = (s) => pad && s > pad.s0 - 46 && s < pad.s1 + 40;
  for (let s = route.sMin + 4; s < route.sMax - 4; s += 4.6) {
    for (const right of [true, false]) {
      const clear = route.clearing(s, right), w = right ? route.widthR(s) : route.widthL(s);
      const padSide = !right && nearPadLeft(s);
      // trees: rows stepping away from the road, bigger and denser further in
      for (let d = right ? 3.6 : 2.4; d < clear + 1; d += 3.9) {
        if (rnd() > 0.78 * density + 0.1) { rnd(); rnd(); rnd(); rnd(); continue; }
        const dd = d + (rnd() - 0.5) * 3.2, ss = s + (rnd() - 0.5) * 4.2, u = (right ? 1 : -1) * (w + Math.max(right ? 3.3 : 1.6, dd));
        const pick = rnd(), k = rnd(), tint = [0.8 + 0.4 * rnd(), 0.8 + 0.4 * rnd(), 0.8 + 0.4 * rnd()];
        if (padSide) { if (dd > 5 && pick < 0.3) put('stump', ss, u, 0.7 + 0.5 * k, 0.35 + 0.5 * k, k * 6, tint); continue; }
        const yaw = k * 6.283;
        if (dd < 6.5) {
          if (pick < 0.34) put('alder', ss, u, 7 + 5 * k, 7 + 6 * k, yaw, tint, 0.08);
          else if (pick < 0.7) put('young', ss, u, 5 + 5 * k, 4 + 7 * k, yaw, tint, 0.03);
          else if (pick < 0.78) put('stump', ss, u, 0.6 + 0.5 * k, 0.3 + 0.5 * k, yaw, tint);
          else if (pick < 0.9) put('bush', ss, u, 0.8 + 0.8 * k, 0.8 + 0.6 * k, yaw, tint);
        } else if (dd < 10.5) {
          const h = 15 + 11 * k;
          if (pick < 0.42) put('firA', ss, u, h, h, yaw, tint, 0.02);
          else if (pick < 0.68) put('cedar', ss, u, h * 0.9, h * 0.9, yaw, tint, 0.02);
          else if (pick < 0.8) put('alder', ss, u, 10 + 5 * k, 11 + 6 * k, yaw, tint, 0.06);
          else if (pick < 0.9) put('young', ss, u, 7 + 4 * k, 8 + 6 * k, yaw, tint);
          else put('snag', ss, u, 14 + 8 * k, 14 + 8 * k, yaw, tint, 0.05);
        } else {
          const h = 24 + 14 * k;
          if (pick < 0.5) put('firA', ss, u, h, h, yaw, tint, 0.015);
          else if (pick < 0.8) put('firB', ss, u, h * 1.05, h * 1.05, yaw, tint, 0.015);
          else if (pick < 0.94) put('cedar', ss, u, h * 0.85, h * 0.85, yaw, tint, 0.02);
          else put('snag', ss, u, h * 0.7, h * 0.7, yaw, tint, 0.04);
        }
      }
      // verge: grass tufts, low brush, stones on the cut bank
      for (let j = 0; j < 5; j++) {
        const ss = s + (rnd() - 0.5) * 4.6, dd = 0.15 + rnd() * rnd() * (padSide ? 12 : 4.2), u = (right ? 1 : -1) * (w + dd), k = rnd(), g = rnd();
        if (rnd() > 0.82 * density + 0.18) continue;
        const straw = [0.2 + 0.16 * g, 0.17 + 0.12 * g, 0.05 + 0.04 * g], green = [0.07, 0.12 + 0.05 * g, 0.04];
        if (k < 0.74) put('tuft', ss, u, 0.35 + 0.5 * g, 0.3 + 0.55 * g, g * 6.283, g > 0.75 ? green : straw);
        else if (k < 0.86 && dd > 1.2) put('bush', ss, u, 0.5 + 0.6 * g, 0.5 + 0.5 * g, g * 6.283, [0.8 + 0.4 * g, 1, 0.9]);
        else if (k < 0.94 && right && dd > 1.5) put(g > 0.5 ? 'rockA' : 'rockB', ss, u, 0.18 + 0.5 * g * g, 0.18 + 0.4 * g * g, g * 6.283, [0.8 + 0.3 * g, 0.8 + 0.3 * g, 0.8 + 0.3 * g], 0.4, 0.05);
      }
    }
  }
  const group = new THREE.Group(), chunks = [];
  for (let ch = 0; ch < nCh; ch++) {
    const sub = new THREE.Group(); const f = route.frame(route.sMin + (ch + 0.5) * CH);
    for (const [type, arr] of Object.entries(lists[ch])) {
      const im = new THREE.InstancedMesh(geos[type], material, arr.length);
      const col = new THREE.Color();
      arr.forEach((it, i) => { im.setMatrixAt(i, it.m); im.setColorAt(i, col.setRGB(it.c[0], it.c[1], it.c[2])); });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere();
      sub.add(im);
    }
    group.add(sub); chunks.push({ sub, x: f.x, y: f.y, z: f.z });
  }
  // extra rocks strewn over a rock pullout are added by the game once the surfaces are known
  const extra = new THREE.Group(); group.add(extra);
  const strew = (pullouts, types) => {
    extra.clear();
    const r2 = rand(77), items = { rockA: [], rockB: [] };
    pullouts.forEach((p, pi) => {
      if (types[pi] !== 'rock') return;
      for (let i = 0; i < 46; i++) {
        const s = p.s + (r2() - 0.5) * (p.length + 10), u = route.halfWidth + 0.5 + r2() * (p.width + 0.6), g = r2(), size = 0.12 + 0.34 * g * g;
        const w = route.toWorld(s, u);
        _e.set(r2() * 3, r2() * 6, r2() * 3); _q.setFromEuler(_e); _p.set(w[0], w[1] + size * 0.15, w[2]); _s.set(size, size * (0.7 + 0.5 * r2()), size * (0.8 + 0.6 * r2()));
        items[r2() > 0.5 ? 'rockA' : 'rockB'].push(new THREE.Matrix4().compose(_p, _q, _s));
      }
    });
    for (const [type, arr] of Object.entries(items)) {
      if (!arr.length) continue;
      const im = new THREE.InstancedMesh(geos[type], material, arr.length), col = new THREE.Color(0.9, 0.9, 0.9);
      arr.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col); });
      im.computeBoundingSphere(); extra.add(im);
    }
  };
  const update = (camera, range) => {
    const c = camera.position;
    for (const ch of chunks) ch.sub.visible = Math.hypot(ch.x - c.x, ch.z - c.z) < range + CH;
  };
  void _m;
  return { group, update, strew, material };
}
