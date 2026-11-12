// Atmospheric sky: a small single-scattering raymarch baked into a lat-long LUT every
// frame, plus the GLSL used everywhere else to look it up (sky, haze, ambient light).
import * as THREE from '../../vendor/three.module.min.js';
import { Pass, target2D, uni, pick } from './common.js';

const LUT_MAP = /* glsl */`
// v packs elevation with extra resolution at the horizon
vec2 skyDirToUv(vec3 d) {
  float e = asin(clamp(d.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(e) * sqrt(abs(e) / (0.5 * PI));
  return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, v);
}
vec3 skyUvToDir(vec2 uv) {
  float vv = uv.y * 2.0 - 1.0;
  float e = sign(vv) * vv * vv * 0.5 * PI, a = (uv.x - 0.5) * 2.0 * PI;
  return vec3(cos(e) * cos(a), sin(e), cos(e) * sin(a));
}
`;

const LUT_FRAG = /* glsl */`
precision highp float;
#define PI 3.14159265359
uniform vec3 uSunDir, uMoonDir;
uniform float uSunE, uMoonE, uHaze, uCamAlt;
in vec2 vUv;
out vec4 o;
${LUT_MAP}
const float RG = 6360e3, RT = 6440e3;
const vec3 BR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 BO = vec3(0.650e-6, 1.881e-6, 0.085e-6);

vec3 dens(float h) {   // rayleigh, mie, ozone
  return vec3(exp(-h / 8000.0), exp(-h / 1200.0), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}
float raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd), c = dot(ro, ro) - r * r, d = b * b - c;
  return d < 0.0 ? -1.0 : -b + sqrt(d);
}
float hitGround(vec3 ro, vec3 rd) {
  float b = dot(ro, rd), c = dot(ro, ro) - RG * RG, d = b * b - c;
  if (d < 0.0) return -1.0;
  float t = -b - sqrt(d);
  return t;
}
vec3 extinction(vec3 d, float bm) { return BR * d.x + vec3(bm * 1.11) * d.y + BO * d.z; }
vec3 lightT(vec3 p, vec3 l, float bm) {
  float tg = hitGround(p, l);
  if (tg > 0.0) return vec3(0.0);
  float tmax = raySphere(p, l, RT);
  vec3 od = vec3(0.0);
  float t = 0.0;
  for (int i = 0; i < 6; i++) {
    float t1 = tmax * pow(float(i + 1) / 6.0, 2.0);
    od += extinction(dens(length(p + l * 0.5 * (t + t1)) - RG), bm) * (t1 - t);
    t = t1;
  }
  return exp(-od);
}
void main() {
  vec3 rd = skyUvToDir(vUv);
  vec3 ro = vec3(0.0, RG + max(uCamAlt, 1.0) + 2.0, 0.0);
  float bm = 2.2e-6 + 26.0e-6 * uHaze * uHaze + 5.0e-6 * uHaze;
  float tmax = raySphere(ro, rd, RT), tg = hitGround(ro, rd);
  if (tg > 0.0) tmax = tg;
  float muS = dot(rd, uSunDir), muM = dot(rd, uMoonDir);
  float g = 0.78;
  float pRs = 3.0 / (16.0 * PI) * (1.0 + muS * muS), pRm = 3.0 / (16.0 * PI) * (1.0 + muM * muM);
  float k = 3.0 / (8.0 * PI) * (1.0 - g * g) / (2.0 + g * g);
  float pMs = k * (1.0 + muS * muS) / pow(1.0 + g * g - 2.0 * g * muS, 1.5);
  float pMm = k * (1.0 + muM * muM) / pow(1.0 + g * g - 2.0 * g * muM, 1.5);
  vec3 L = vec3(0.0), T = vec3(1.0);
  float t = 0.0;
  const int N = 28;
  for (int i = 0; i < N; i++) {
    float t1 = tmax * pow(float(i + 1) / float(N), 2.2);
    float dt = t1 - t;
    vec3 p = ro + rd * (t + 0.5 * dt);
    vec3 d = dens(length(p) - RG);
    vec3 ext = extinction(d, bm);
    vec3 sR = BR * d.x, sM = vec3(bm) * d.y;
    vec3 Ts = lightT(p, uSunDir, bm), Tm = uMoonE > 0.0 ? lightT(p, uMoonDir, bm) : vec3(0.0);
    // crude multiple scattering: an isotropic share of what reaches this sample
    vec3 ms = (sR + sM) * (Ts * uSunE + Tm * uMoonE) * 0.085 * (1.0 + 2.0 * d.x);
    vec3 S = (sR * pRs + sM * pMs) * Ts * uSunE + (sR * pRm + sM * pMm) * Tm * uMoonE + ms;
    vec3 Tstep = exp(-ext * dt);
    L += T * (S - S * Tstep) / max(ext, vec3(1e-9));
    T *= Tstep;
    t = t1;
  }
  o = vec4(L, dot(T, vec3(0.333)));
}
`;

// Sky lookups + haze for any shader. Requires GLSL_COMMON first (PI, saturate, fbm2).
export const GLSL_SKY = LUT_MAP + /* glsl */`
uniform sampler2D uSkyLUT;
uniform vec3 uSunDir, uMoonDir, uLightDir, uLightCol, uSunCol, uSunColHigh, uMoonCol;
uniform float uHaze, uNight, uHighCloud, uSkyTime;
uniform vec3 uCamPos;

vec3 skyLUT(vec3 d) { return texture(uSkyLUT, skyDirToUv(d)).rgb; }
// diffuse sky light arriving on a surface with normal n (cheap two-tap estimate)
vec3 skyAmbient(vec3 n) {
  vec3 up = skyLUT(normalize(vec3(n.x * 0.35, 1.0, n.z * 0.35)));
  vec3 side = skyLUT(normalize(vec3(n.x, 0.22, n.z) + vec3(1e-4, 0.0, 0.0)));
  return PI * (up * (0.55 + 0.25 * n.y) + side * 0.3);
}
// haze between the camera and a point: returns transmittance (rgb) and writes inscatter
vec3 aerial(vec3 ro, vec3 rd, float dist, out vec3 inscatter) {
  float H = 1500.0 + 900.0 * uHaze;
  float y0 = ro.y, dy = rd.y * dist;
  float a = exp(-max(y0, 0.0) / H);
  float integ = abs(dy) > 1.0 ? a * (1.0 - exp(-dy / H)) / (dy / H) : a;
  vec3 beta = vec3(5.8e-6, 13.5e-6, 33.1e-6) * 0.9 + vec3(3.0e-6 + 9.0e-5 * uHaze * uHaze + 1.2e-5 * uHaze);
  vec3 T = exp(-beta * integ * dist);
  vec3 hd = normalize(vec3(rd.x, clamp(rd.y, 0.015, 0.25), rd.z));
  inscatter = skyLUT(hd) * (1.0 - T);
  return T;
}
// thin high cloud on a curved shell: returns colour and coverage (a)
vec4 cirrus(vec3 rd) {
  if (rd.y < 0.01 || uHighCloud < 0.01) return vec4(0.0);
  const float R = 6360e3, Hc = 9000.0;
  float b = R * rd.y, t = -b + sqrt(b * b + 2.0 * R * Hc + Hc * Hc);
  vec2 p = rd.xz * t / 9000.0 + vec2(uSkyTime * 0.004, uSkyTime * 0.0015);
  float n = fbm2(p * vec2(0.55, 1.5) + 2.0 * fbm2(p * 0.4));
  float n2 = fbm2(p * 3.7 + 5.0);
  float c = smoothstep(1.0 - uHighCloud * 0.85, 1.25 - uHighCloud * 0.6, n + 0.35 * n2 + 0.12);
  c *= smoothstep(0.01, 0.12, rd.y);
  float mu = dot(rd, uSunDir);
  float ph = 0.55 + 1.6 * pow(saturate(mu), 6.0) + 6.0 * pow(saturate(mu), 60.0);
  vec3 col = uSunColHigh * 0.11 * ph + uMoonCol * 0.11 * (0.55 + 2.0 * pow(saturate(dot(rd, uMoonDir)), 8.0)) + skyLUT(vec3(0.0, 1.0, 0.0)) * 0.9;
  return vec4(col, c * 0.85);
}
vec3 skyWithCirrus(vec3 rd) {
  vec3 s = skyLUT(rd);
  vec4 c = cirrus(rd);
  return mix(s, c.rgb, c.a);
}
`;

export class Sky {
  constructor(renderer) {
    this.renderer = renderer;
    this.rt = target2D(256, 128, { wrapS: THREE.RepeatWrapping });
    this.pass = new Pass(LUT_FRAG, {
      ...pick('uSunDir', 'uMoonDir', 'uHaze'),
      uSunE: { value: 22 }, uMoonE: { value: 0 }, uCamAlt: { value: 100 },
    });
    uni('uSkyLUT', this.rt.texture);
  }
  update(sunE, moonE, camAlt) {
    const u = this.pass.uniforms;
    u.uSunE.value = sunE; u.uMoonE.value = moonE; u.uCamAlt.value = Math.min(camAlt, 12000);
    this.pass.render(this.renderer, this.rt);
  }
}
