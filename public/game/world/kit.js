// A small mesh kit: merge primitives into one vertex-coloured geometry for the prop material.
import * as THREE from '../../vendor/three.module.min.js';

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// transform helper: position, rotation (radians, XYZ order), scale
export function tf(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

export class Kit {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.aux = []; this.uv = []; }
  // geo: any BufferGeometry. opts: gloss 0..1, retro 0..1, emit (emission multiplier), flat (faceted normals),
  // uv: [u0, v0, u1, v1] rectangle of the atlas to map the geometry's own 0..1 uvs into.
  add(geo, matrix, color, opts = {}) {
    const { gloss = 0.25, retro = 0, emit = 0, flat = true, uv = null } = opts;
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (flat) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array, t = g.attributes.uv ? g.attributes.uv.array : null;
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]); this.nor.push(n[i], n[i + 1], n[i + 2]);
      this.col.push(color[0], color[1], color[2]);
      this.aux.push(gloss, retro, emit, p[i + 1]);
      if (uv && t) { const k = i / 3 * 2; this.uv.push(uv[0] + (uv[2] - uv[0]) * t[k], uv[1] + (uv[3] - uv[1]) * t[k + 1]); } else this.uv.push(-1, -1);
    }
    g.dispose();
    return this;
  }
  box(w, h, d, matrix, color, opts) { return this.add(new THREE.BoxGeometry(w, h, d), matrix, color, opts); }
  // cylinder along Y by default; r0 = top radius, r1 = bottom radius
  cyl(r0, r1, h, seg, matrix, color, opts = {}) { return this.add(new THREE.CylinderGeometry(r0, r1, h, seg, 1, !!opts.open), matrix, color, { flat: false, ...opts }); }
  // side profile [[x, y], ...] (x along the vehicle, y up) extruded across the width, centred on z = 0
  profile(points, width, matrix, color, opts = {}) {
    const sh = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    const bevel = opts.bevel ?? 0.04;
    const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 6 });
    g.translate(0, 0, -(width - 2 * bevel) / 2);
    const m = matrix ? matrix.clone() : new THREE.Matrix4();
    return this.add(g, m, color, opts);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.aux, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

// deterministic random stream for decoration (not game rules)
export function rand(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
