// Near-field fog for the resource-road game: a short, fine ray march from the eye that the
// cloud march (30 m steps, quarter resolution) cannot do. It fogs the scene by distance, lights
// the fog inside headlight beams so they read as volumes, and adds a closed-form glow around
// point lights so lamps bloom out of the murk before the thing carrying them is visible.
import * as THREE from '../../vendor/three.module.min.js';
import { Pass, pick, uni } from './common.js';
import { GLSL_GAMELIGHT, GAMELIGHT_UNIFORMS } from './gamelight.js';

const FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
${GLSL_GAMELIGHT}
uniform sampler2D uTex, uDepthTex;
uniform sampler3D uNoiseTex;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos, uFogAmb, uFogSky;
uniform float uSkyTime, uFogSteps, uFogReach, uFrame, uFogGlow;
in vec2 vUv; out vec4 o;

float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
// forward lobe (lamps seen through fog flare) plus a broad back lobe (your own beams are visible)
float phase(float c) { return (0.3 * hg(c, 0.6) + 0.7 * hg(c, -0.25)) * uFogGlow; }
float topFade(float y) { return smoothstep(uFogParams.y + uFogParams.z, uFogParams.y - uFogParams.z, y); }
float density(vec3 p) {
  float d = uFogParams.x * topFade(p.y);
  if (uFogParams.w > 0.0) {
    float n = texture(uNoiseTex, p * 0.011 + vec3(uSkyTime * 0.013, uSkyTime * 0.004, uSkyTime * 0.009)).r;
    float n2 = texture(uNoiseTex, p.zxy * 0.043 - vec3(uSkyTime * 0.02)).g;
    d *= mix(1.0, 0.25 + 1.1 * n + 0.5 * n2, uFogParams.w);
  }
  return d;
}

void main() {
  vec3 col = texture(uTex, vUv).rgb;
  if (uFogParams.x <= 0.0) { o = vec4(col, 1.0); return; }
  float depth = texture(uDepthTex, vUv).r;
  vec4 wp = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 V = wp.xyz / wp.w - uCamPos;
  float dist = length(V); vec3 rd = V / dist;
  if (depth >= 1.0) dist = 2.0e4;
  float tMax = min(dist, uFogReach);
  float jit = ign(gl_FragCoord.xy + 5.588 * mod(uFrame, 4.0));
  float T = 1.0; vec3 S = vec3(0.0);
  float t0 = 0.0, n = uFogSteps;
  // ambient light in the fog: brighter looking up toward the sky than down into the trees
  vec3 amb = mix(uFogAmb, uFogSky, smoothstep(-0.1, 0.5, rd.y));
  for (float i = 0.0; i < 40.0; i++) {
    if (i >= n) break;
    float t1 = tMax * pow((i + 1.0) / n, 1.6);
    float dt = t1 - t0, t = t0 + dt * jit;
    vec3 p = uCamPos + rd * t;
    float sg = density(p);
    if (sg > 0.0) {
      vec3 Li = amb;
      for (int k = 0; k < N_SPOT; k++) {
        if (uSpotPos[k].w <= 0.0) continue;
        vec3 L = p - uSpotPos[k].xyz; float r2 = dot(L, L), r = sqrt(r2); vec3 l = L / max(r, 1e-3);
        float cone = spotCone(l, uSpotDir[k]);
        if (cone > 0.0) Li += uSpotCol[k] * (uSpotPos[k].w * cone / (r2 + 2.0) * exp(-uFogParams.x * r) * phase(dot(l, -rd)));
      }
      float a = exp(-sg * dt);
      S += T * (1.0 - a) * Li;
      T *= a;
    }
    t0 = t1;
  }
  // beyond the march: a uniform slab under the fog top, lit by the ambient only
  if (dist > tMax) {
    float y0 = uCamPos.y + rd.y * tMax, y1 = uCamPos.y + rd.y * min(dist, 6000.0);
    float top = uFogParams.y, span = min(dist, 6000.0) - tMax;
    float inside = abs(y1 - y0) < 1e-3 ? step(y0, top) : clamp((top - min(y0, y1)) / abs(y1 - y0), 0.0, 1.0);
    float a = exp(-uFogParams.x * span * inside);
    S += T * (1.0 - a) * amb; T *= a;
  }
  // glow around point lights and lamps: closed-form in-scatter along the ray
  for (int k = 0; k < N_POINT + N_SPOT; k++) {
    vec4 lp; vec3 lc; float boost = 1.0;
    if (k < N_POINT) { lp = uPointPos[k]; lc = uPointCol[k]; }
    else {
      lp = uSpotPos[k - N_POINT]; lc = uSpotCol[k - N_POINT];
      // a headlamp glares when it points at the eye, and barely glows from behind
      float facing = dot(uSpotDir[k - N_POINT].xyz, normalize(uCamPos - lp.xyz));
      boost = 0.001 + 3.0 * smoothstep(0.2, 0.98, facing);
    }
    if (lp.w <= 0.0) continue;
    vec3 q = lp.xyz - uCamPos;
    float tc = dot(q, rd), h = max(length(q - rd * tc), 0.04);
    float te = min(dist, 400.0);
    float integ = (atan((te - tc) / h) - atan(-tc / h)) / h;
    float away = length(q);
    S += lc * (lp.w * boost * uFogParams.x * topFade(lp.y) * integ * exp(-uFogParams.x * 0.8 * away) * 12.0 * uFogGlow);
  }
  o = vec4(col * T + S, 1.0);
}
`;

export class NearFog {
  constructor() {
    uni('uFogAmb', new THREE.Vector3()); uni('uFogSky', new THREE.Vector3());
    uni('uFogSteps', 16); uni('uFogReach', 220); uni('uFogGlow', 0.25);   // uFogGlow: how brightly beams light the fog
    this.pass = new Pass(FRAG, {
      ...pick(...GAMELIGHT_UNIFORMS, 'uDepthTex', 'uNoiseTex', 'uInvViewProj', 'uCamPos', 'uSkyTime', 'uFrame', 'uFogAmb', 'uFogSky', 'uFogSteps', 'uFogReach', 'uFogGlow'),
      uTex: { value: null },
    });
  }
  get active() { return uni('uFogParams').value.x > 0; }
  render(renderer, src, dst) { this.pass.uniforms.uTex.value = src.texture; this.pass.render(renderer, dst); }
}
