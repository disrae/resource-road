// Volumetric pass: raymarches the simulated cloud field at reduced resolution,
// then resolves it temporally (reprojection + neighbourhood clamp).
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, Pass, pick, uni } from './common.js';
import { GLSL_SKY } from './sky.js';

const MARCH_FRAG = GLSL_COMMON + GLSL_SKY + /* glsl */`
uniform sampler3D uVolTex, uNoiseTex;
uniform sampler2D uDepthTex;
uniform mat4 uInvViewProj;
uniform vec2 uCloudRes;
uniform float uFrame, uExtK, uStepScale, uMaxSteps, uDetail;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hg(float mu, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * mu, 1.5)); }

void main() {
  float depth = texture(uDepthTex, vUv).r;
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = far.xyz / far.w;
  vec3 ro = uCamPos, rd = normalize(wp - ro);
  float sceneDist = depth >= 0.99999 ? 1.0e6 : length(wp - ro);

  // march only inside the atmosphere slab
  float t0 = 0.0, t1 = min(sceneDist, 70000.0);
  if (rd.y > 1e-4) { t1 = min(t1, (WORLD_TOP - ro.y) / rd.y); }
  else if (rd.y < -1e-4) { t0 = max(t0, (WORLD_TOP - ro.y) / rd.y); t1 = min(t1, (-5.0 - ro.y) / rd.y); }
  else if (ro.y > WORLD_TOP) t1 = -1.0;

  float mu = dot(rd, uLightDir);
  float phase = mix(hg(mu, 0.82), hg(mu, -0.2), 0.32) + 0.35 * hg(mu, 0.965);
  float phaseMS = mix(hg(mu, 0.35), 1.0 / (4.0 * PI), 0.5);
  // the glow around a low sun is bright but small: it must not tint all the shaded cloud brown
  vec3 ambTop = skyLUT(vec3(0.0, 1.0, 0.0)) * 3.2 + skyLUT(normalize(vec3(uLightDir.x, 0.25, uLightDir.z))) * mix(0.4, 1.2, smoothstep(0.04, 0.4, uLightDir.y));
  // side-on sky, away from the sun's glow: ambient must not vary with view azimuth (that drew a bright column under decks)
  vec3 sideDir = normalize(vec3(-uLightDir.z, 0.0, uLightDir.x) + vec3(0.0, 0.08, 0.0));
  vec3 skySide = 0.5 * (skyLUT(sideDir) + skyLUT(sideDir * vec3(-1.0, 1.0, -1.0)));
  // light from the sides of the sky comes mostly from well above the horizon's sunset band
  vec3 sideHi = normalize(vec3(-uLightDir.z, 0.0, uLightDir.x) + vec3(0.0, 0.45, 0.0));
  vec3 ambBot = (skyLUT(sideHi) + skyLUT(sideHi * vec3(-1.0, 1.0, -1.0)) + skyLUT(normalize(vec3(-uLightDir.x, 0.4, -uLightDir.z)))) * (1.6 / 3.0);
  vec3 hazeCol = mix(skySide, skyLUT(normalize(vec3(rd.x, clamp(rd.y, 0.015, 0.25), rd.z))), 0.45);
  vec3 deepCol = mix(uLightCol, vec3(dot(uLightCol, vec3(0.3, 0.55, 0.15))), 0.65);
  vec3 betaAir = vec3(5.8e-6, 13.5e-6, 33.1e-6) * 0.9 + vec3(3.0e-6 + 9.0e-5 * uHaze * uHaze + 1.2e-5 * uHaze);
  float Hh = 1500.0 + 900.0 * uHaze;
  float mieK = (2.0e-6 + 5.0e-5 * uHaze) * hg(mu, 0.76) * 4.0;
  vec2 wdir = uWind / max(length(uWind), 0.5);
  vec3 drift = vec3(uWind.x, 0.0, uWind.y) * uSimTime;

  vec3 L = vec3(0.0);
  float T = 1.0, dsum = 0.0, wsum = 0.0;
  if (t1 > t0) {
    float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.61803399);
    float t = t0, dt = (30.0 + 0.03 * t0) * uStepScale;
    t += dt * jit;
    int n = int(uMaxSteps);
    for (int i = 0; i < n; i++) {
      if (t > t1 || T < 0.012) break;
      vec3 p = ro + rd * t;
      float ground = max(texture(uHeightTex, p.xz / WORLD_SIZE + 0.5).x, 0.0);
      float agl = p.y - ground;
      vec4 vol = texture(uVolTex, vec3(p.xz / WORLD_SIZE + 0.5, altToS(p.y, ground)));
      float sunVis = exp(-vol.g);
      // clear-air haze lit by the sun: this is what makes shafts through gaps visible
      float hz = exp(-max(p.y, 0.0) / Hh);
      vec3 airIn = uLightCol * (mieK * hz * sunVis) * dt * exp(-betaAir * (t * hz * 0.5));
      L += T * airIn;
      float qc = vol.r, pr = vol.b;
      if (qc > 0.002 || pr > 0.01) {
        // erode the smooth simulated field with drifting detail noise
        vec3 q = (p - drift * 0.6) / 2300.0;
        vec4 nz = texture(uNoiseTex, q);
        float er = mix(0.22, 1.0, smoothstep(40.0, 520.0, agl)) * uDetail;
        // billows: read the field a little higher or lower so flat decks get a heaped, cauliflower top
        float lift = (nz.r - 0.42) * 230.0 + (nz.g - 0.5) * 70.0;
        vec4 volB = texture(uVolTex, vec3(p.xz / WORLD_SIZE + 0.5, altToS(p.y - lift * er, ground)));
        qc = mix(qc, volB.r, 0.85);
        float d = qc - (1.0 - nz.r) * 0.42 * er * (0.35 + qc);
        if (d > 0.0) {
          vec4 nf = texture(uNoiseTex, (p - drift * 0.75) / 560.0 + nz.rgb * 0.08);
          d -= (1.0 - nf.g) * 0.16 * er * saturate(1.0 - d * 1.5) + (1.0 - nf.b) * 0.05 * er;
        }
        d = max(d, 0.0) * 1.9;
        // rain / snow shafts: vertical streaks, grey and soft
        float streak = 0.55 + 0.9 * texture(uNoiseTex, vec3(p.xz / 900.0 - wdir * (p.y / 2500.0), p.y / 9000.0 + uSimTime / 3000.0)).a;
        float dp = pr * 0.05 * streak;
        float ext = (d + dp) * uExtK;
        if (ext > 1e-6) {
          float tau = vol.g + d * uExtK * 55.0;        // a little local self-shadowing
          float deep = 0.75 * saturate(uLightDir.y + 0.08) / (1.0 + 0.3 * vol.a) * (0.45 + 1.1 * nz.r * nz.g * 2.0);      // diffuse glow deep inside, mottled
          float direct = exp(-tau) * phase + 0.42 * exp(-tau * 0.3) * phaseMS + 0.17 * exp(-tau * 0.09) / (4.0 * PI);
          float powder = 1.0 - 0.55 * exp(-d * 5.0) * saturate(-mu * 0.5 + 0.5);
          float skyVis = 1.0 / (1.0 + 0.3 * vol.a);
          vec3 amb = (ambTop * (0.12 + 0.88 * skyVis) * 2.3 + ambBot * (0.6 + 2.6 * skyVis)) * 1.45 / (4.0 * PI) + deepCol * deep * 0.25;
          float albedo = d / (d + dp + 1e-5) * 0.999 + dp / (d + dp + 1e-5) * 0.72;
          vec3 S = albedo * (uLightCol * direct * powder * 3.14159 + amb * mix(0.7, 1.0, powder));
          float Ts = exp(-ext * dt);
          float w = T * (1.0 - Ts);
          vec3 Ta = exp(-betaAir * (t * hz * 0.5));
          L += w * mix(hazeCol, S, Ta);
          dsum += t * w; wsum += w;
          T *= Ts;
        }
      }
      dt = (30.0 + 0.03 * t) * uStepScale;
      // finer steps on the way down to the surface, so a shallow fog layer is sampled, not dithered
      dt = min(dt, (28.0 + 0.2 * max(agl, 0.0)) / max(abs(rd.y), 0.04) * uStepScale);
      t += dt;
    }
  }
  if (T < 0.012) T = 0.0;
  o0 = vec4(L, T);
  o1 = vec4(wsum > 1e-4 ? dsum / wsum : min(sceneDist, 30000.0), sceneDist, 0.0, 1.0);
}
`;

const RESOLVE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uCur, uCurAux, uHist, uHistAux;
uniform mat4 uInvViewProj, uPrevViewProj;
uniform vec3 uCamPos;
uniform vec2 uCloudRes;
uniform float uBlend;
in vec2 vUv;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main() {
  vec4 cur = texture(uCur, vUv), aux = texture(uCurAux, vUv);
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(far.xyz / far.w - uCamPos);
  vec4 pc = uPrevViewProj * vec4(uCamPos + rd * aux.r, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec4 mn = cur, mx = cur, avg = cur;
  vec2 px = 1.0 / uCloudRes;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    if (x == 0 && y == 0) continue;
    vec4 c = texture(uCur, vUv + vec2(x, y) * px);
    mn = min(mn, c); mx = max(mx, c); avg += c;
  }
  avg /= 9.0;
  float blend = uBlend;
  if (pc.w <= 0.0 || any(lessThan(puv, vec2(0.0))) || any(greaterThan(puv, vec2(1.0)))) blend = 0.0;
  vec4 hist = texture(uHist, puv), haux = texture(uHistAux, puv);
  // history from behind a different surface is not valid
  float dd = abs(haux.g - aux.g) / max(min(haux.g, aux.g), 1.0);
  blend *= 1.0 - smoothstep(0.08, 0.3, dd);
  vec4 soft = (mx - mn) * 0.25;
  hist = clamp(hist, mn - soft, mx + soft);
  o0 = mix(cur, hist, blend);
  o1 = aux;
}
`;

function mrt(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false,
  });
  rt.textures[1].minFilter = rt.textures[1].magFilter = THREE.NearestFilter;
  return rt;
}

export class Clouds {
  constructor(renderer) {
    this.renderer = renderer;
    this.res = new THREE.Vector2(2, 2);
    this.march = new Pass(MARCH_FRAG, {
      ...pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
        'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
        'uHighCloud', 'uSkyTime', 'uCamPos', 'uVolTex', 'uNoiseTex', 'uDepthTex', 'uInvViewProj', 'uExtK', 'uFrame'),
      uCloudRes: { value: this.res }, uStepScale: { value: 1 }, uMaxSteps: { value: 96 }, uDetail: { value: 1 },
    });
    this.resolve = new Pass(RESOLVE_FRAG, {
      ...pick('uInvViewProj', 'uPrevViewProj', 'uCamPos'),
      uCur: { value: null }, uCurAux: { value: null }, uHist: { value: null }, uHistAux: { value: null },
      uCloudRes: { value: this.res }, uBlend: { value: 0.88 },
    });
    this.resize(2, 2);
  }
  resize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.cur && this.res.x === w && this.res.y === h) return;
    for (const t of [this.cur, this.histA, this.histB]) if (t) t.dispose();
    this.res.set(w, h);
    this.cur = mrt(w, h); this.histA = mrt(w, h); this.histB = mrt(w, h);
    this.valid = false;
  }
  render(quality) {
    const m = this.march.uniforms;
    m.uStepScale.value = quality.stepScale; m.uMaxSteps.value = quality.maxSteps;
    this.march.render(this.renderer, this.cur);
    const r = this.resolve.uniforms;
    r.uCur.value = this.cur.textures[0]; r.uCurAux.value = this.cur.textures[1];
    r.uHist.value = this.histA.textures[0]; r.uHistAux.value = this.histA.textures[1];
    r.uBlend.value = this.valid ? quality.temporal : 0;
    this.resolve.render(this.renderer, this.histB);
    const t = this.histA; this.histA = this.histB; this.histB = t;
    this.valid = true;
    uni('uCloudTex', this.histA.textures[0]);
    uni('uCloudAux', this.histA.textures[1]);
  }
}
