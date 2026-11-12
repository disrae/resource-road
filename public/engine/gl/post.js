// Composite (sky + scene + clouds), bloom, tone mapping / grade, FXAA.
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, Pass, target2D, pick, uni } from './common.js';
import { GLSL_SKY } from './sky.js';

const COMPOSITE_FRAG = GLSL_COMMON + GLSL_SKY + /* glsl */`
uniform sampler2D uSceneTex, uDepthTex, uCloudTex, uCloudAux;
uniform sampler3D uNoiseTex;
uniform mat4 uInvViewProj;
uniform vec2 uCloudRes;
uniform float uMoonFade;
in vec2 vUv;
out vec4 o;

vec3 stars(vec3 rd) {
  vec3 p = rd * 190.0, i = floor(p), f = fract(p) - 0.5;
  float h = hash13(i);
  if (h < 0.986) return vec3(0.0);
  vec3 off = (vec3(hash13(i + 7.1), hash13(i + 13.7), hash13(i + 29.3)) - 0.5) * 0.6;
  float d = length(f - off);
  float mag = pow((h - 0.986) / 0.014, 3.0);
  float tw = 0.75 + 0.25 * sin(uSkyTime * (2.0 + 6.0 * hash13(i + 3.3)) + h * 100.0);
  vec3 tint = mix(vec3(1.0, 0.82, 0.62), vec3(0.72, 0.84, 1.0), hash13(i + 51.0));
  return tint * (0.02 + 1.2 * mag) * tw * smoothstep(0.11, 0.0, d);
}

void main() {
  float depth = texture(uDepthTex, vUv).r;
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = far.xyz / far.w;
  vec3 rd = normalize(wp - uCamPos);
  float sceneDist = depth >= 0.99999 ? 1.0e6 : length(wp - uCamPos);
  vec3 col;
  if (sceneDist > 9.0e5) {
    col = skyLUT(rd);
    float horizon = smoothstep(-0.01, 0.06, rd.y);
    // stars and the Milky Way, only once the sky is dark
    if (uNight > 0.01 && rd.y > -0.02) {
      float band = exp(-pow(dot(rd, normalize(vec3(0.35, 0.5, -0.8))) * 3.2, 2.0));
      vec3 mw = vec3(0.55, 0.62, 0.8) * band * (0.25 + 0.75 * fbm2(rd.xz * 9.0 + rd.y * 5.0)) * 0.0045;
      col += (stars(rd) * 0.05 + mw) * uNight * horizon;
    }
    // sun
    float ms = dot(rd, uSunDir);
    float sd = acos(clamp(ms, -1.0, 1.0));
    float disc = smoothstep(0.0062, 0.0050, sd);
    col += uSunCol * disc * (0.55 + 0.45 * sqrt(max(0.0, 1.0 - sd * sd / 3.8e-5))) * 46.0 * horizon;
    // moon with a little surface shading
    float mm = dot(rd, uMoonDir);
    float md = acos(clamp(mm, -1.0, 1.0));
    if (md < 0.0105) {
      vec3 right = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), up = cross(right, uMoonDir);
      vec2 q = vec2(dot(rd, right), dot(rd, up)) / 0.0098;
      float r2 = dot(q, q);
      vec3 n = vec3(q, sqrt(max(0.0, 1.0 - r2)));
      float lit = saturate(dot(n, normalize(vec3(0.35, 0.25, 0.9))));
      float maria = 0.72 + 0.28 * smoothstep(0.35, 0.65, fbm2(q * 2.3 + 4.0));
      col += vec3(0.95, 0.97, 1.0) * lit * maria * smoothstep(1.0, 0.92, r2) * (0.012 + 0.75 * uMoonFade) * horizon;
    }
    vec4 ci = cirrus(rd);
    col = mix(col, ci.rgb, ci.a);
  } else {
    col = texture(uSceneTex, vUv).rgb;
  }
  // depth-aware upsample of the low-resolution cloud buffer
  vec2 cp = vUv * uCloudRes - 0.5, base = floor(cp), f = cp - base;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = (base + vec2(i, j) + 0.5) / uCloudRes;
    float dz = texture(uCloudAux, uv).g;
    float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    w *= 1.0 / (0.015 + abs(dz - sceneDist) / max(min(dz, sceneDist), 1.0));
    acc += texture(uCloudTex, uv) * w; wsum += w;
  }
  vec4 cl = wsum > 0.0 ? acc / wsum : texture(uCloudTex, vUv);
  col = col * cl.a + cl.rgb;
  o = vec4(max(col, vec3(0.0)), 1.0);
}
`;

const DOWN_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex; uniform vec2 uPx; uniform float uFirst;
in vec2 vUv; out vec4 o;
void main() {
  vec4 d = uPx.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  vec3 c = texture(uTex, vUv + d.xy).rgb + texture(uTex, vUv + d.zy).rgb + texture(uTex, vUv + d.xw).rgb + texture(uTex, vUv + d.zw).rgb;
  c *= 0.25;
  if (uFirst > 0.5) c = min(c, vec3(40.0));
  o = vec4(c, 1.0);
}`;
const UP_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex, uAdd; uniform vec2 uPx;
in vec2 vUv; out vec4 o;
void main() {
  vec4 d = uPx.xyxy * vec4(-1.0, -1.0, 1.0, 1.0);
  vec3 c = texture(uTex, vUv + d.xy).rgb + texture(uTex, vUv + d.zy).rgb + texture(uTex, vUv + d.xw).rgb + texture(uTex, vUv + d.zw).rgb;
  o = vec4(c * 0.25 * 0.82 + texture(uAdd, vUv).rgb, 1.0);
}`;

// Light meter: centre-weighted log-average luminance of the smallest bloom mip, eased over time.
// Output r = exposure multiplier relative to the astronomical estimate.
const METER_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex, uPrev;
uniform float uBase, uKey, uRate;
in vec2 vUv; out vec4 o;
void main() {
  float sum = 0.0, wsum = 0.0;
  for (int j = 0; j < 6; j++) for (int i = 0; i < 8; i++) {
    vec2 uv = (vec2(i, j) + 0.5) / vec2(8.0, 6.0);
    vec2 q = uv - 0.5;
    float w = 1.0 - 1.6 * dot(q, q);
    float l = dot(texture(uTex, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
    sum += log(clamp(l, 1e-5, 60.0)) * w; wsum += w;
  }
  float avg = exp(sum / wsum);
  float want = clamp(pow(uKey / (avg * uBase), 0.7), 0.45, 5.0);
  float prev = texture(uPrev, vec2(0.5)).r;
  if (!(prev > 0.0) || uRate >= 1.0) prev = want;
  o = vec4(mix(prev, want, uRate));
}`;

const FINAL_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex, uBloom, uAdapt;
uniform float uExposure, uContrast, uSaturation, uWarmth, uNight, uFrame, uBloomAmt, uVignette;
uniform vec2 uOutRes;
in vec2 vUv; out vec4 o;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// ACES filmic fit (Stephen Hill)
vec3 aces(vec3 c) {
  c = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777) * c;
  c = (c * (c + 0.0245786) - 0.000090537) / (c * (0.983729 * c + 0.4329510) + 0.238081);
  c = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602) * c;
  return clamp(c, 0.0, 1.0);
}
void main() {
  vec3 c = texture(uTex, vUv).rgb;
  vec3 b = texture(uBloom, vUv).rgb;
  c = mix(c, b * 0.29, uBloomAmt);
  c *= uExposure * texture(uAdapt, vec2(0.5)).r;
  // night vision: colour drains toward blue as the light goes
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(0.78, 0.92, 1.25) * l, 0.55 * uNight);
  c *= vec3(1.0 + 0.11 * uWarmth, 1.0 + 0.015 * uWarmth, 1.0 - 0.13 * uWarmth);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.5;
  c = aces(c * 1.05);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(lum), c, uSaturation);
  float k = mix(0.8, 1.3, uContrast);
  c = pow(max(c, 0.0), vec3(k)) / pow(vec3(0.5), vec3(k - 1.0));   // contrast around mid grey
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  float n = hash(gl_FragCoord.xy + fract(uFrame * 0.137) * 311.0) + hash(gl_FragCoord.yx + 17.0 + fract(uFrame * 0.211) * 97.0) - 1.0;
  c += n * (1.5 / 255.0);
  o = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
}`;

const FXAA_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTex; uniform vec2 uPx;
in vec2 vUv; out vec4 o;
void main() {
  vec4 m = texture(uTex, vUv);
  float lN = texture(uTex, vUv + vec2(0.0, uPx.y)).a, lS = texture(uTex, vUv - vec2(0.0, uPx.y)).a;
  float lE = texture(uTex, vUv + vec2(uPx.x, 0.0)).a, lW = texture(uTex, vUv - vec2(uPx.x, 0.0)).a;
  float lmin = min(m.a, min(min(lN, lS), min(lE, lW))), lmax = max(m.a, max(max(lN, lS), max(lE, lW)));
  float range = lmax - lmin;
  if (range < max(0.04, lmax * 0.12)) { o = vec4(m.rgb, 1.0); return; }
  vec2 dir = vec2(-((lN) - (lS)), (lE) - (lW));
  float lNW = texture(uTex, vUv + vec2(-uPx.x, uPx.y)).a, lNE = texture(uTex, vUv + uPx).a;
  float lSW = texture(uTex, vUv - uPx).a, lSE = texture(uTex, vUv + vec2(uPx.x, -uPx.y)).a;
  dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float rdm = 1.0 / (min(abs(dir.x), abs(dir.y)) + max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125));
  dir = clamp(dir * rdm, -8.0, 8.0) * uPx;
  vec3 a = 0.5 * (texture(uTex, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec4 b4 = 0.5 * vec4(a, 0.0) + 0.25 * (texture(uTex, vUv + dir * -0.5) + texture(uTex, vUv + dir * 0.5));
  o = vec4((b4.a < lmin * 0.5 || b4.a > lmax) ? a : b4.rgb, 1.0);
}`;

const LEVELS = 5;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.composite = new Pass(COMPOSITE_FRAG, {
      ...pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
        'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
        'uHighCloud', 'uSkyTime', 'uCamPos', 'uNoiseTex', 'uSceneTex', 'uDepthTex', 'uCloudTex', 'uCloudAux', 'uInvViewProj', 'uMoonFade'),
      uCloudRes: { value: new THREE.Vector2(2, 2) },
    });
    this.down = new Pass(DOWN_FRAG, { uTex: { value: null }, uPx: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
    this.up = new Pass(UP_FRAG, { uTex: { value: null }, uAdd: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.final = new Pass(FINAL_FRAG, {
      ...pick('uNight', 'uFrame'), uTex: { value: null }, uBloom: { value: null },
      uExposure: { value: 1 }, uContrast: { value: 0.5 }, uSaturation: { value: 1 }, uWarmth: { value: 0 },
      uBloomAmt: { value: 0.1 }, uVignette: { value: 0.35 }, uOutRes: { value: new THREE.Vector2() }, uAdapt: { value: null },
    });
    this.meter = new Pass(METER_FRAG, { uTex: { value: null }, uPrev: { value: null }, uBase: { value: 1 }, uKey: { value: 0.2 }, uRate: { value: 1 } });
    const one = () => target2D(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.adaptA = one(); this.adaptB = one(); this.adaptFresh = true;
    this.fxaa = new Pass(FXAA_FRAG, { uTex: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.w = 0;
  }
  resize(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    for (const t of [this.hdr, this.ldr, ...(this.mips || []), ...(this.ups || [])]) if (t) t.dispose();
    this.hdr = target2D(w, h);
    this.ldr = target2D(w, h, { type: THREE.UnsignedByteType });
    this.mips = []; this.ups = [];
    for (let i = 0; i < LEVELS; i++) {
      const mw = Math.max(2, w >> (i + 1)), mh = Math.max(2, h >> (i + 1));
      this.mips.push(target2D(mw, mh)); this.ups.push(target2D(mw, mh));
    }
  }
  render(cloudRes, look, screenTarget = null) {
    const r = this.renderer;
    this.composite.uniforms.uCloudRes.value.copy(cloudRes);
    this.composite.render(r, this.hdr);
    let src = this.hdr;
    for (let i = 0; i < LEVELS; i++) {
      this.down.uniforms.uTex.value = src.texture;
      this.down.uniforms.uPx.value.set(0.5 / src.width, 0.5 / src.height);
      this.down.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.down.render(r, this.mips[i]);
      src = this.mips[i];
    }
    let acc = this.mips[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      this.up.uniforms.uTex.value = acc.texture;
      this.up.uniforms.uAdd.value = this.mips[i].texture;
      this.up.uniforms.uPx.value.set(0.5 / acc.width, 0.5 / acc.height);
      this.up.render(r, this.ups[i]);
      acc = this.ups[i];
    }
    // meter the frame and ease the exposure toward it
    const m = this.meter.uniforms;
    m.uTex.value = this.mips[LEVELS - 1].texture; m.uPrev.value = this.adaptA.texture;
    m.uBase.value = look.exposure0; m.uKey.value = look.key;
    m.uRate.value = this.adaptFresh ? 1 : look.adaptRate;
    this.meter.render(r, this.adaptB);
    const sw = this.adaptA; this.adaptA = this.adaptB; this.adaptB = sw; this.adaptFresh = false;
    const f = this.final.uniforms;
    f.uAdapt.value = this.adaptA.texture;
    f.uTex.value = this.hdr.texture; f.uBloom.value = acc.texture;
    f.uExposure.value = look.exposure; f.uContrast.value = look.contrast;
    f.uSaturation.value = look.saturation; f.uWarmth.value = look.warmth;
    this.final.render(r, this.ldr);
    this.fxaa.uniforms.uTex.value = this.ldr.texture;
    this.fxaa.uniforms.uPx.value.set(1 / this.w, 1 / this.h);
    this.fxaa.render(r, screenTarget);
  }
}
