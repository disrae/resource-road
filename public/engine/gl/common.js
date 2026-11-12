// Shared GLSL chunks + tiny helpers for fullscreen passes.
import * as THREE from '../../vendor/three.module.min.js';
import { WORLD } from '../terrain.js';

// One dictionary of uniform holders shared by every material: update once, used everywhere.
export const U = {};
export function uni(name, value) {
  if (!U[name]) U[name] = { value };
  else if (value !== undefined) U[name].value = value;
  return U[name];
}
export function pick(...names) {
  const o = {};
  for (const n of names) o[n] = uni(n);
  return o;
}

export const GLSL_COMMON = /* glsl */`
precision highp float;
precision highp sampler3D;
#define PI 3.14159265359
const float WORLD_SIZE = ${WORLD.size.toFixed(1)};
const float WORLD_TOP = ${WORLD.top.toFixed(1)};
const float WORLD_LID = ${WORLD.lid.toFixed(1)};
const float SIG_P = 1.6;
const float LAPSE = 0.0075;      // parcel cooling, K per metre of lift
const float STAB = 0.0015;       // background stability, K per metre

uniform sampler2D uHeightTex;    // h, dh/dx, dh/dz, relief
uniform sampler2D uFlowTex;      // terrain response of the column wind
uniform vec2 uWind;              // m/s, direction the air moves toward (x, z)
uniform float uSimTime;          // simulated seconds
uniform float uT0;               // sea-level temperature, C
uniform float uMoisture, uCloudBase, uInversion, uPrecip;

float saturate(float x) { return clamp(x, 0.0, 1.0); }
float remap(float x, float a, float b, float c, float d) { return c + (d - c) * saturate((x - a) / (b - a)); }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * .1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) {
  float a = 0.0, w = 0.5;
  for (int i = 0; i < 4; i++) { a += w * vnoise2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; w *= 0.5; }
  return a;
}

// Terrain texel at world xz. The texture is mirror-repeated outside the simulated square,
// so gradients flip sign in odd tiles.
vec4 terrainAt(vec2 xz) {
  vec2 uv = xz / WORLD_SIZE + 0.5;
  vec4 t = texture(uHeightTex, uv);
  vec2 par = mod(floor(uv), 2.0);
  t.yz *= 1.0 - 2.0 * par;
  return t;
}
float groundAt(vec2 xz) { return max(texture(uHeightTex, xz / WORLD_SIZE + 0.5).x, 0.0); }

// Terrain-following vertical coordinate, stretched so layers are thin near the ground.
float altToS(float y, float ground) { return pow(saturate((y - ground) / (WORLD_TOP - ground)), 1.0 / SIG_P); }
float sToAlt(float s, float ground) { return ground + pow(s, SIG_P) * (WORLD_TOP - ground); }
vec3 worldToVol(vec3 p) {
  return vec3(p.xz / WORLD_SIZE + 0.5, altToS(p.y, groundAt(p.xz)));
}

// --- thermodynamics -------------------------------------------------------------------
float qsat(float T) { return 3.8 * exp(17.27 * T / (T + 237.3)); }          // g/kg
float layerDepth() { return mix(250.0 + 1900.0 * uMoisture * uMoisture, 150.0 + 650.0 * uMoisture, uInversion); }
float layerTop() { return uCloudBase + layerDepth(); }
// ambient potential-temperature perturbation: gentle stability plus the capping inversion
float thetaAmb(float y) {
  float zi = layerTop();
  return STAB * y + 9.0 * uInversion * smoothstep(zi - 40.0, zi + 260.0, y);
}
float tempOf(float theta, float y) { return uT0 + theta - LAPSE * y; }
// ambient total water (g/kg). Below the layer top the air is well mixed, so cloud base sits where
// that mixing ratio saturates: at the cloud-base dial when moist enough, higher (or never) when dry.
float qtAmb(float y, float moistPatch) {
  float zi = layerTop();
  float sb = min((0.55 + 0.6 * uMoisture) * moistPatch, 1.0 + 0.05 * uMoisture);
  float qm = sb * qsat(tempOf(thetaAmb(uCloudBase), uCloudBase));
  float qs = qsat(tempOf(thetaAmb(y), y));
  float qMoist = min(qm, qs * (1.0 + 0.2 * min(uMoisture, 1.3)));
  float qDry = qs * (0.2 + 0.32 * uMoisture * (1.0 - 0.8 * uInversion)) * moistPatch;
  return mix(qMoist, min(qMoist, qDry), smoothstep(zi, zi + mix(700.0, 180.0, uInversion), y));
}

// --- wind --------------------------------------------------------------------------
// Terrain-aware wind at p. ter = terrainAt(p.xz).
vec3 windAt(vec3 p, vec4 ter) {
  float ground = max(ter.x, 0.0), agl = max(p.y - ground, 0.0);
  float prof = 0.7 + 0.55 * saturate(p.y / 3000.0);
  float veer = 0.35 * saturate(p.y / 3500.0);
  vec2 Uw = mat2(cos(veer), sin(veer), -sin(veer), cos(veer)) * uWind * prof;
  vec4 f = texture(uFlowTex, p.xz / WORLD_SIZE + 0.5);
  vec2 pert = Uw.x * f.xy + Uw.y * f.zw;
  vec2 uh = Uw + pert * (1.0 - smoothstep(WORLD_LID * 0.5, WORLD_LID, p.y));
  uh *= mix(0.32, 1.0, smoothstep(0.0, 320.0, agl));
  vec2 g = ter.x > 0.0 ? ter.yz : vec2(0.0);
  float w = dot(uh, g) * exp(-agl / 1300.0);
  return vec3(uh.x, w, uh.y);
}
`;

export const FS_VERT = /* glsl */`
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const tri = new THREE.BufferGeometry();
tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
const fsScene = new THREE.Scene();
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsMesh = new THREE.Mesh(tri, null);
fsMesh.frustumCulled = false;
fsScene.add(fsMesh);

// A fullscreen fragment pass.
export class Pass {
  constructor(frag, uniforms = {}, opts = {}) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: FS_VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false, depthWrite: false,
      ...opts,
    });
    this.uniforms = this.material.uniforms;
  }
  render(renderer, target = null, layer = 0) {
    fsMesh.material = this.material;
    renderer.setRenderTarget(target, layer);
    renderer.render(fsScene, fsCam);
  }
}

export function target2D(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false, ...opts,
  });
}

export function target3D(w, h, d, wrapXY = THREE.MirroredRepeatWrapping) {
  const rt = new THREE.WebGL3DRenderTarget(w, h, d, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
  });
  // r170 builds the 3D texture with defaults and ignores the options above, so set them here
  const t = rt.texture;
  t.type = THREE.HalfFloatType; t.format = THREE.RGBAFormat;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = wrapXY;
  t.wrapR = THREE.ClampToEdgeWrapping;
  return rt;
}
