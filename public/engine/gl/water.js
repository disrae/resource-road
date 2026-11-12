// The inlet: an analytic water plane shaded in a fullscreen pass over the opaque scene.
// Wind ripples follow the terrain-deflected wind, so sheltered bays go glassy.
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, Pass, pick } from './common.js';
import { GLSL_SKY } from './sky.js';
import { GLSL_SURFACE } from './land.js';

const FRAG = GLSL_COMMON + GLSL_SKY + GLSL_SURFACE + /* glsl */`
uniform sampler2D uOpaqueTex, uOpaqueDepth;
uniform mat4 uInvViewProj, uViewProj;
in vec2 vUv;
out vec4 o;

// height gradient of the wave field at p (metres), t seconds
vec2 waveGrad(vec2 p, float t, vec2 wdir, float amp, float detail) {
  vec2 g = vec2(0.0);
  float a = 0.9, k = 0.095, sp = 3.2;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ang = (hash12(vec2(fi, 3.0)) - 0.5) * 1.5;
    vec2 d = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * wdir;
    float ph = dot(d, p) * k - t * sp * sqrt(k) * 1.7 + 6.0 * vnoise2(p * k * 0.07 + fi * 7.1);
    g += d * (a * k * cos(ph)) * amp;
    a *= 0.62; k *= 2.05;
  }
  // fine ripples
  vec2 q = p * 0.55 - wdir * t * 1.1;
  float e = 0.35;
  float n0 = fbm2(q), nx = fbm2(q + vec2(e, 0.0)), nz = fbm2(q + vec2(0.0, e));
  g += vec2(nx - n0, nz - n0) / e * 0.16 * detail * (0.25 + amp);
  return g;
}

void main() {
  float depth = texture(uOpaqueDepth, vUv).r;
  vec4 far = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 wp = far.xyz / far.w;
  vec3 ro = uCamPos, rd = normalize(wp - ro);
  float sceneDist = depth >= 0.99999 ? 1.0e6 : length(wp - ro);
  vec3 col = texture(uOpaqueTex, vUv).rgb;
  float outDepth = depth;
  float tw = rd.y < -1e-5 ? -ro.y / rd.y : -1.0;
  if (tw > 0.0 && tw < sceneDist && tw < 180000.0) {
    vec3 P = ro + rd * tw;
    vec4 ter = terrainAt(P.xz);
    float wdepth = max(-ter.x, 0.0);
    // local wind at the surface (terrain shelter included)
    vec4 fl = texture(uFlowTex, P.xz / WORLD_SIZE + 0.5);
    vec2 wl = uWind + uWind.x * fl.xy + uWind.y * fl.zw;
    float wsp = length(wl);
    vec2 wdir = wsp > 0.05 ? wl / wsp : vec2(1.0, 0.0);
    float gustN = fbm2(P.xz / 520.0 - wdir * uSimTime * 0.012 + 3.0);
    float rough = smoothstep(0.4, 9.0, wsp * (0.45 + 1.1 * gustN)) * smoothstep(0.0, 3.0, wdepth + 1.0);
    float amp = 0.05 + 1.25 * rough;
    float lod = 1.0 / (1.0 + tw / 2600.0);
    vec2 g = waveGrad(P.xz, uSkyTime, wdir, amp, lod) * mix(0.25, 1.0, lod);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    // reflection: screen-space march for the mountains, sky lookup otherwise
    vec3 R = reflect(rd, N); R.y = abs(R.y) + 0.002; R = normalize(R);
    vec3 refl = skyWithCirrus(R);
    vec4 volS; float vis = sunVisibility(P + vec3(0.0, 4.0, 0.0), volS);
    float over = 1.0 - exp(-volS.a * 0.8);
    vec3 cloudCol = skyLight(vec3(0.0, 1.0, 0.0), volS) / PI;      // the underside of the deck overhead
    refl = mix(refl, cloudCol, over * 0.9);
    float st = 12.0, s = 6.0; bool hit = false; vec2 huv = vec2(0.0); float prevS = 0.0;
    for (int i = 0; i < 26; i++) {
      vec3 q = P + R * s;
      vec4 c = uViewProj * vec4(q, 1.0);
      if (c.w <= 0.0) break;
      vec3 ndc = c.xyz / c.w;
      vec2 uv = ndc.xy * 0.5 + 0.5;
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
      float dsc = texture(uOpaqueDepth, uv).r * 2.0 - 1.0;
      if (dsc < ndc.z) {
        float lo = prevS, hi = s;
        for (int j = 0; j < 5; j++) {
          float mid = 0.5 * (lo + hi);
          vec4 cm = uViewProj * vec4(P + R * mid, 1.0);
          vec3 nm = cm.xyz / cm.w;
          if (texture(uOpaqueDepth, nm.xy * 0.5 + 0.5).r * 2.0 - 1.0 < nm.z) hi = mid; else lo = mid;
          huv = nm.xy * 0.5 + 0.5;
        }
        hit = true; break;
      }
      prevS = s; s += st; st *= 1.33;
    }
    if (hit) {
      vec2 e = smoothstep(vec2(0.0), vec2(0.06), huv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - huv);
      refl = mix(refl, texture(uOpaqueTex, huv).rgb, e.x * e.y);
    }

    float fres = 0.02 + 0.98 * pow(1.0 - saturate(dot(N, -rd)), 5.0);
    fres = mix(fres, 0.5 * fres + 0.02, rough * 0.5);        // rough water reflects less at grazing angles
    // water body: absorbs red first, scatters green-blue; shallows show the bottom
    float path = min(sceneDist - tw, 400.0);
    vec3 absorb = exp(-path * vec3(0.30, 0.085, 0.07) * 0.6);
    vec3 lightIn = uLightCol * saturate(uLightDir.y) * vis * 0.4 + skyLight(vec3(0.0, 1.0, 0.0), volS) * 0.4;
    vec3 scatter = mix(vec3(0.010, 0.060, 0.058), vec3(0.004, 0.022, 0.034), saturate(wdepth / 40.0)) * lightIn;
    vec3 body = col * absorb + scatter * (1.0 - exp(-path * 0.09));
    vec3 c = mix(body, refl, fres);
    // sun / moon glitter
    vec3 Hh = normalize(uLightDir - rd);
    float nh = saturate(dot(N, Hh));
    float gl = pow(nh, mix(2600.0, 260.0, rough) * mix(0.15, 1.0, lod));
    c += uLightCol * gl * vis * mix(22.0, 3.0, rough) * mix(0.2, 1.0, lod);
    // foam where waves meet the shore
    float foam = smoothstep(1.6, 0.0, wdepth) * smoothstep(0.35, 0.75, fbm2(P.xz / 2.3 + vec2(uSkyTime * 0.25, 0.0)) + 0.35 * sin(wdepth * 4.0 - uSkyTime * 1.4)) * (0.25 + rough);
    c = mix(c, (uLightCol * saturate(uLightDir.y + 0.1) * vis + skyLight(vec3(0.0, 1.0, 0.0), volS)) * 0.25, foam * lod);
    vec3 ins;
    vec3 T = aerial(ro, rd, tw, ins);
    col = c * T + ins;
    vec4 clip = uViewProj * vec4(P, 1.0);
    outDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.99998);
  }
  o = vec4(col, 1.0);
  gl_FragDepth = outDepth;
}
`;

export class Water {
  constructor(renderer) {
    this.renderer = renderer;
    this.pass = new Pass(FRAG, pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
      'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
      'uHighCloud', 'uSkyTime', 'uCamPos', 'uSnowline', 'uTreeline', 'uSeason', 'uShadowTex', 'uVolTex', 'uGrid',
      'uOpaqueTex', 'uOpaqueDepth', 'uInvViewProj', 'uViewProj'),
    { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth });
  }
  render(target) { this.pass.render(this.renderer, target); }
}
