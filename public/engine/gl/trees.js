// Instanced conifers around the camera. Placement is computed in the vertex shader from
// the instance id, on the same jittered grid the far canopy texture uses, so individual
// trees dissolve into the shaded canopy with distance instead of popping.
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, pick } from './common.js';
import { GLSL_SKY } from './sky.js';
import { GLSL_SURFACE } from './land.js';
import { GLSL_GAMELIGHT, GAMELIGHT_UNIFORMS } from './gamelight.js';

const CELL = 9.0;

function coniferGeometry() {
  const pos = [], nor = [], ao = [];
  const tiers = 5, seg = 7;
  for (let t = 0; t < tiers; t++) {
    const y0 = 0.12 + 0.78 * (t / tiers) * 0.95, y1 = Math.min(1, y0 + 0.36 - t * 0.02);
    const r0 = 0.2 * (1 - t / (tiers + 0.6)) + 0.02;
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2 + t * 0.7, a1 = ((s + 1) / seg) * Math.PI * 2 + t * 0.7;
      const wob = 1 + 0.18 * Math.sin(s * 2.3 + t);
      const p0 = [Math.cos(a0) * r0 * wob, y0, Math.sin(a0) * r0 * wob];
      const p1 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
      const top = [0, y1, 0];
      pos.push(...p0, ...top, ...p1);
      const am = (a0 + a1) / 2, ny = r0 / (y1 - y0);
      for (const a of [a0, am, a1]) { const l = Math.hypot(1, ny); nor.push(Math.cos(a) / l, ny / l, Math.sin(a) / l); }
      ao.push(0.35 + 0.3 * t / tiers, 1.0, 0.35 + 0.3 * t / tiers);
    }
  }
  // trunk
  for (let s = 0; s < 4; s++) {
    const a0 = (s / 4) * Math.PI * 2, a1 = ((s + 1) / 4) * Math.PI * 2, r = 0.022;
    pos.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, 0, 0.3, 0, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    for (const a of [a0, (a0 + a1) / 2, a1]) nor.push(Math.cos(a), 0.1, Math.sin(a));
    ao.push(-1, -1, -1);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('ao', new THREE.Float32BufferAttribute(ao, 1));
  return g;
}

const VERT = GLSL_COMMON + GLSL_SKY + GLSL_SURFACE + /* glsl */`
in vec3 position; in vec3 normal; in float ao;
uniform mat4 projectionMatrix, viewMatrix;
uniform float uGridN, uRange;
uniform sampler2D uRoadMask; uniform vec4 uRoadMaskRect;   // cleared ground (the game's road): xy origin, zw 1/size
uniform vec2 uOrigin;
out vec3 vWorld; out vec3 vNormal; out vec4 vInfo; out vec3 vTint;
void main() {
  float id = float(gl_InstanceID);
  vec2 cell = uOrigin + vec2(mod(id, uGridN), floor(id / uGridN));
  vec2 jit = vec2(hash12(cell), hash12(cell + 71.3)) * 0.8 + 0.1;
  vec2 xz = (cell + jit) * ${CELL.toFixed(1)};
  vec4 ter = terrainAt(xz);
  float rnd = hash12(cell + 13.1), rnd2 = hash12(cell + 5.7);
  float forest = forestAt(xz, ter);
  float dist = length(vec3(xz.x, ter.x, xz.y) - uCamPos);
  float keep = step(rnd2 * 0.9 + 0.05, forest) * (1.0 - smoothstep(uRange * 0.72, uRange, dist));
  vec2 muv = (xz - uRoadMaskRect.xy) * uRoadMaskRect.zw;
  if (uRoadMaskRect.z > 0.0 && all(greaterThan(muv, vec2(0.0))) && all(lessThan(muv, vec2(1.0))) && texture(uRoadMask, muv).r > 0.5) keep = 0.0;
  if (keep < 0.01 || ter.x < 2.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float stunt = mix(1.0, 0.45, smoothstep(uTreeline - 500.0, uTreeline + 100.0, ter.x));
  float hgt = mix(15.0, 34.0, rnd) * stunt * mix(0.55, 1.0, forest) * keep;
  float ang = rnd * 6.283;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec3 p = position;
  p.xz = rot * p.xz * (0.85 + 0.5 * rnd2);
  vec3 n = normal; n.xz = rot * n.xz;
  vec3 world = vec3(xz.x, ter.x - 0.6, xz.y) + p * hgt;
  vWorld = world; vNormal = n;
  vInfo = vec4(ao, position.y, rnd, forest);
  float broad = smoothstep(0.62, 0.8, fbm2(xz / 480.0 + 23.0)) * smoothstep(700.0, 200.0, ter.x);
  vTint = vec3(broad * step(0.6, rnd2), snowAt(xz, ter, 1.0), 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const FRAG = GLSL_COMMON + GLSL_SKY + GLSL_SURFACE + GLSL_GAMELIGHT + /* glsl */`
in vec3 vWorld; in vec3 vNormal; in vec4 vInfo; in vec3 vTint;
out vec4 o;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = vWorld - uCamPos; float dist = length(V); vec3 rd = V / dist;
  bool trunk = vInfo.x < 0.0;
  float au = smoothstep(0.62, 0.8, uSeason) * (1.0 - smoothstep(0.9, 1.0, uSeason));
  vec3 conifer = mix(vec3(0.022, 0.052, 0.030), vec3(0.052, 0.090, 0.036), vInfo.z);
  vec3 decid = mix(vec3(0.05, 0.10, 0.025), mix(vec3(0.30, 0.17, 0.02), vec3(0.22, 0.06, 0.02), vInfo.z), au);
  vec3 alb = mix(conifer, decid, vTint.x);
  float tip = trunk ? 0.5 : vInfo.x;
  alb *= 0.45 + 0.9 * tip;                                        // dark interior, lighter tips
  alb *= 0.8 + 0.4 * vnoise2(vWorld.xz * 1.7 + vWorld.y * 2.1);
  if (trunk) alb = vec3(0.045, 0.035, 0.028);
  float snow = vTint.y * smoothstep(0.1, 0.6, N.y + tip * 0.5) * (trunk ? 0.0 : 0.8);
  alb = mix(alb, vec3(0.86, 0.89, 0.93), snow);
  vec4 vol; float vis = sunVisibility(vWorld, vol);
  float ndl = dot(N, uLightDir);
  float wrap = saturate(ndl * 0.6 + 0.4);
  float back = pow(saturate(dot(rd, uLightDir)), 3.0) * 0.35;      // light through the needles
  vec3 amb = skyLight(N, vol) * (0.3 + 0.7 * tip);
  vec3 col = alb * (uLightCol * (wrap + back) * vis * (0.4 + 0.6 * tip) + amb);
  vec3 gs, gr; vec3 gl = gameLight(vWorld, gl_FrontFacing ? N : -N, rd, 0.0, gs, gr);
  col += alb * 2.2 * gl * (0.35 + 0.65 * tip);                 // headlights on the boughs
  vec3 ins; vec3 T = aerial(uCamPos, rd, dist, ins);
  o = vec4(col * T + ins, 1.0);
}
`;

export class Trees {
  constructor(density = 1) {
    this.geometry = coniferGeometry();
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
      uniforms: {
        ...pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
          'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
          'uHighCloud', 'uSkyTime', 'uCamPos', 'uSnowline', 'uTreeline', 'uSeason', 'uShadowTex', 'uVolTex', 'uGrid', 'uRoadMask', 'uRoadMaskRect', ...GAMELIGHT_UNIFORMS),
        uGridN: { value: 1 }, uRange: { value: 1 }, uOrigin: { value: new THREE.Vector2() },
      },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.setDensity(density);
  }
  setDensity(d, range = 0) {
    this.range = range || 520 + 620 * d;      // range: explicit draw distance in metres (short in fog)
    this.n = Math.ceil(this.range / CELL) * 2;
    this.geometry.instanceCount = this.n * this.n;
    this.material.uniforms.uGridN.value = this.n;
    this.material.uniforms.uRange.value = this.range;
  }
  update(camera) {
    const u = this.material.uniforms;
    u.uOrigin.value.set(Math.floor(camera.position.x / CELL) - this.n / 2, Math.floor(camera.position.z / CELL) - this.n / 2);
    // nothing to draw when flying high above the forest
    this.mesh.visible = camera.position.y < 3200;
  }
}
