// GLSL for the atmosphere model: state advection + thermodynamics, and the light volume.
import { GLSL_COMMON } from './common.js';

// State texture (RGBA16F, terrain-following grid):
//   r = total water qt (g/kg)   g = potential temperature perturbation (K)
//   b = precipitation (g/kg)    a = cloud water diagnosed from r,g (g/kg)
export const SIM_FRAG = GLSL_COMMON + /* glsl */`
uniform sampler3D uState;
uniform sampler3D uVol;
uniform sampler2D uShelterTex;
uniform float uS, uDt, uReset, uNudge, uSST, uSunPower, uNightCool, uLayer;
uniform vec3 uGrid;            // nx, nz, ny
uniform vec3 uSunDir;
in vec2 vUv;
out vec4 o;

float patchAt(vec2 xz) {
  // slow patchiness in the incoming air, drifting with the wind
  vec2 q = (xz - uWind * uSimTime) / 6800.0;
  float amp = mix(0.5, 0.16, saturate(uMoisture / 1.1));
  return 1.0 + amp * (fbm2(q) - 0.5) + 0.5 * amp * (fbm2(q * 3.1 + 7.3) - 0.5);
}
vec4 ambient(float y, float moistPatch) { return vec4(qtAmb(y, moistPatch), thetaAmb(y), 0.0, 0.0); }

vec4 finish(vec4 st, float y) {
  float qs = qsat(tempOf(st.g, y));
  st.a = clamp(st.r - qs, 0.0, 6.0);
  return st;
}

void main() {
  vec2 xz = (vUv - 0.5) * WORLD_SIZE;
  vec4 ter = terrainAt(xz);
  float ground = max(ter.x, 0.0);
  float y = sToAlt(uS, ground), agl = y - ground;
  vec3 p = vec3(xz.x, y, xz.y);
  float moistPatch = patchAt(xz);
  vec4 amb = ambient(y, moistPatch);
  if (uReset > 0.5) { o = finish(amb, y); return; }

  vec4 self = texelFetch(uState, ivec3(ivec2(gl_FragCoord.xy), int(uLayer)), 0);
  float dTh = self.g - amb.g;

  // --- wind: terrain-deflected flow + cold-air drainage + buoyancy -------------------
  vec3 v = windAt(p, ter);
  if (ter.x > 0.0) {
    float gl = length(ter.yz);
    vec2 kat = -ter.yz / (gl + 1e-3) * min(gl * 9.0, 3.2) * saturate(-dTh / 3.0) * exp(-agl / 120.0);
    v.xz += kat;
    v.y += dot(kat, ter.yz) * exp(-agl / 1300.0);
  }
  // warm air rises freely; cold air near the ground cannot sink through it, so it pools and
  // drains downhill (above) instead of being replaced from aloft
  float buoy = clamp(dTh * 0.5, -1.0, 3.2);
  if (buoy < 0.0) buoy *= smoothstep(200.0, 1200.0, agl);
  v.y += buoy * smoothstep(0.0, 80.0, agl);
  // gentle resolved turbulence so nothing ever looks frozen
  vec3 tq = p / 900.0 + vec3(0.0, uSimTime / 700.0, 0.0);
  float gust = 0.35 + 0.08 * length(uWind);
  vec2 gxz = gust * (vec2(vnoise2(tq.xz + tq.y), vnoise2(tq.zx - tq.y + 31.7)) - 0.5);
  vec2 slope = ter.x > 0.0 ? ter.yz : vec2(0.0);
  v.xz += gxz;
  v.y += dot(gxz, slope) * exp(-agl / 1300.0);                  // gusts follow the slope too
  v.y += 0.5 * gust * (vnoise2(tq.xz * 1.7 - tq.y + 11.3) - 0.5) * smoothstep(0.0, 150.0, agl);

  // --- semi-Lagrangian advection ----------------------------------------------------
  vec3 pp = p - v * uDt;
  vec2 uvp = pp.xz / WORLD_SIZE + 0.5;
  float gp = groundAt(pp.xz);
  // the slope is not a plane: keep near-surface air at its height above the real ground, so the
  // surface layer is not swapped for free air (or pushed underground) on every step
  pp.y += (gp - (ground - dot(v.xz * uDt, slope))) * exp(-agl / 1300.0);
  pp.y = clamp(pp.y, gp, WORLD_TOP);
  float sp = altToS(pp.y, gp);
  vec3 c = vec3(uvp, sp);
  vec4 st = texture(uState, c);
  float ds = 1.0 / uGrid.z;

  // vertical turbulent mixing of anomalies (stronger with wind and surface heating)
  vec4 su = texture(uState, c + vec3(0.0, 0.0, ds)), sd = texture(uState, c - vec3(0.0, 0.0, ds));
  float yu = sToAlt(min(sp + ds, 1.0), gp), yd = sToAlt(max(sp - ds, 0.0), gp);
  vec4 au = ambient(yu, moistPatch), ad = ambient(yd, moistPatch), ac = ambient(pp.y, moistPatch);
  float kmix = (0.00035 + 0.00012 * length(uWind) + 0.0016 * uSunPower * exp(-agl / 700.0)) * (1.0 - 0.75 * uInversion * smoothstep(100.0, 600.0, agl));
  kmix *= 1.0 - 0.7 * saturate(-dTh / 2.5) * exp(-agl / 400.0);      // a cold pool is stable and mixes little
  float km = 1.0 - exp(-uDt * kmix * 40.0);
  vec2 anom = st.rg - ac.rg;
  vec2 anomN = 0.5 * ((su.rg - au.rg) + (sd.rg - ad.rg));
  st.rg = ac.rg + mix(anom, anomN, km * 0.5);

  // inflow boundaries bring in ambient air; a thin sponge avoids edge artefacts
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float inflow = 1.0 - smoothstep(0.0, 0.03, edge);
  if (uvp.x < 0.0 || uvp.x > 1.0 || uvp.y < 0.0 || uvp.y > 1.0) inflow = 1.0;
  // the slow background relaxation is weaker near the ground, so the surface layer can cool into
  // fog overnight and warm by day; the fast relaxation after a dial change applies everywhere
  float nearGround = mix(mix(0.3, 1.0, smoothstep(0.0, 500.0, agl)), 1.0, saturate(uNudge * 1000.0 - 0.3));
  float kn = max(inflow, 1.0 - exp(-uDt * uNudge * nearGround));
  st.rg = mix(st.rg, amb.rg, kn);
  // re-express the advected state at this cell's altitude
  float T = tempOf(st.g, y);

  // --- surface exchange -------------------------------------------------------------
  float wS = exp(-agl / 140.0);
  vec4 vol0 = texture(uVol, vec3(vUv, 0.5 * ds));
  // Clear, calm nights: the ground radiates and chills the air above it. Slopes shed their cold
  // air downhill, so the deep chill (and the fog it makes) collects on valley floors, in hollows
  // and over the sheltered inlet. Cloud overhead, wind, and the fog itself all slow it down.
  float calm = 1.0 / (1.0 + dot(uWind, uWind) / 25.0);
  float chill = uNightCool * exp(-vol0.a * 0.6) * calm;
  float hollow = smoothstep(10.0, 110.0, texture(uShelterTex, vUv).r);
  if (ter.x <= 0.0) {
    hollow *= 0.9;                                                // water walled in by mountains
    // the sea warms or cools the lowest air and feeds it moisture (sea smoke when the air is much colder)
    float k = (1.0 - exp(-uDt / 1500.0 * (0.4 + length(uWind) / 8.0))) * wS;
    // on walled-in water the pooled night air only gives way as the sun gets into it
    float sunIn = saturate(2.2 * uSunPower - 0.5) * exp(-0.5 * vol0.g);
    st.g += ((uSST - uT0) * 0.7 - st.g) * k * (1.0 - 0.94 * hollow * (1.0 - sunIn));
    st.r += max(qsat(uSST) * 0.8 - st.r, 0.0) * k * 0.6;
  } else {
    vec3 n = normalize(vec3(-ter.y, 1.0, -ter.z));
    float insol = uSunPower * exp(-vol0.g) * max(dot(n, uSunDir), 0.0);
    st.g += uDt * wS * 0.0034 * insol;
    hollow = max(hollow, clamp(-ter.w / 140.0, 0.0, 1.0)) / (1.0 + 40.0 * dot(ter.yz, ter.yz));   // slopes drain
  }
  float drop = chill * (0.5 + 10.0 * hollow) * exp(-agl / 200.0);
  st.g = mix(st.g, min(st.g, amb.g - drop), (1.0 - exp(-uDt / 3000.0)) * exp(-self.a * 3.5));
  st.g = clamp(st.g, amb.g - 10.0, amb.g + 8.0);

  // --- cloud + precipitation -------------------------------------------------------
  T = tempOf(st.g, y);
  float qs = qsat(T);
  float qc = max(st.r - qs, 0.0);
  float vt = mix(1.4, 6.5, smoothstep(-1.5, 2.0, T));
  float yr = pp.y + vt * uDt;
  float P = yr < WORLD_TOP ? texture(uState, vec3(uvp, altToS(yr, gp))).b : 0.0;
  P = mix(P, 0.0, inflow);
  float thr = mix(1.6, 0.22, uPrecip);
  float conv = (max(qc - thr, 0.0) * (0.3 + uPrecip) / 260.0 + qc * P * uPrecip / 180.0) * uDt;
  conv += max(qc - 2.6, 0.0);                       // hard cap on cloud water
  conv = min(conv, qc);
  float evap = P * (1.0 - exp(-uDt / 500.0 * saturate(1.0 - st.r / qs) * 2.0));
  st.r += evap - conv;
  P += conv - evap;
  P *= exp(-uDt / 2500.0);
  st.b = clamp(P, 0.0, 8.0);
  st.r = clamp(st.r, 0.0, 45.0);
  st = finish(st, y);
  if (any(isnan(st)) || any(isinf(st))) st = finish(amb, y);
  o = st;
}
`;

// Light volume (same grid): r = cloud water, g = optical depth toward the light,
// b = precipitation, a = optical depth straight up (sky visibility).
export const LIGHT_FRAG = GLSL_COMMON + /* glsl */`
uniform sampler3D uState;
uniform float uS, uLayer, uExtK;
uniform vec3 uLightDir;
uniform vec3 uGrid;
in vec2 vUv;
out vec4 o;

float extAt(vec3 q, out float ground) {
  vec4 ter = texture(uHeightTex, q.xz / WORLD_SIZE + 0.5);
  ground = ter.x;
  float g = max(ground, 0.0);
  if (q.y > WORLD_TOP) return 0.0;
  vec4 st = texture(uState, vec3(q.xz / WORLD_SIZE + 0.5, altToS(q.y, g)));
  return (st.a + 0.35 * st.b) * uExtK;
}

void main() {
  vec2 xz = (vUv - 0.5) * WORLD_SIZE;
  float ground = groundAt(xz);
  float y = sToAlt(uS, ground);
  vec3 p = vec3(xz.x, y + 2.0, xz.y);
  vec4 self = texelFetch(uState, ivec3(ivec2(gl_FragCoord.xy), int(uLayer)), 0);
  float tau = 0.0, t = 0.0, stepLen = 45.0, g;
  for (int i = 0; i < 11; i++) {
    vec3 q = p + uLightDir * (t + 0.5 * stepLen);
    float e = extAt(q, g);
    tau += e * stepLen;
    tau += saturate((g - q.y) / 60.0) * 6.0;         // terrain blocks the light
    t += stepLen; stepLen *= 1.42;
  }
  float up = 0.0; t = 0.0; stepLen = 60.0;
  for (int i = 0; i < 5; i++) {
    up += extAt(p + vec3(0.0, t + 0.5 * stepLen, 0.0), g) * stepLen;
    t += stepLen; stepLen *= 1.9;
  }
  o = vec4(self.a, min(tau, 60.0), self.b, min(up, 60.0));
}
`;

// Vertical integrals for statistics: r = cloud water path, g = total water path,
// b = precip path (all g/kg * m), a = 1 if any cell is non-finite.
export const STATS_FRAG = GLSL_COMMON + /* glsl */`
uniform sampler3D uState;
uniform vec3 uGrid;
uniform float uPick;           // >= 0: copy that layer out raw instead of integrating
in vec2 vUv;
out vec4 o;
void main() {
  if (uPick >= 0.0) { o = texelFetch(uState, ivec3(ivec2(gl_FragCoord.xy), int(uPick)), 0); return; }
  float ground = groundAt((vUv - 0.5) * WORLD_SIZE);
  vec4 acc = vec4(0.0);
  int ny = int(uGrid.z);
  for (int k = 0; k < ny; k++) {
    float s0 = float(k) / uGrid.z, s1 = float(k + 1) / uGrid.z;
    float dz = sToAlt(s1, ground) - sToAlt(s0, ground);
    vec4 st = texelFetch(uState, ivec3(ivec2(gl_FragCoord.xy), k), 0);
    if (any(isnan(st)) || any(isinf(st))) acc.a = 1.0;
    else acc.rgb += vec3(st.a, st.r, st.b) * dz;
  }
  o = acc;
}
`;

// Tileable 3D noise for cloud detail: r = low-frequency Perlin-Worley shape,
// g = medium Worley, b = fine Worley, a = soft value noise.
export const NOISE_FRAG = /* glsl */`
precision highp float;
uniform float uZ;
in vec2 vUv;
out vec4 o;
float saturate(float x) { return clamp(x, 0.0, 1.0); }
vec3 h33(vec3 p) {
  p = fract(p * vec3(.1031, .1030, .0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float worley(vec3 p, float period) {
  p *= period;
  vec3 i = floor(p), f = fract(p);
  float d = 1.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(x, y, z);
    vec3 c = h33(mod(i + g, period)) * 0.9 + 0.05;
    vec3 r = g + c - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - saturate(sqrt(d));
}
float vnoise(vec3 p, float period) {
  p *= period;
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float r = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 g = vec3(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    vec3 w = mix(1.0 - f, f, g);
    r += h33(mod(i + g, period) + 17.0).x * w.x * w.y * w.z;
  }
  return r;
}
void main() {
  vec3 p = vec3(vUv, uZ);
  float perlin = vnoise(p, 4.0) * 0.5 + vnoise(p, 8.0) * 0.3 + vnoise(p, 16.0) * 0.2;
  float w1 = worley(p, 4.0) * 0.6 + worley(p, 8.0) * 0.28 + worley(p, 16.0) * 0.12;
  float w2 = worley(p, 8.0) * 0.6 + worley(p, 16.0) * 0.28 + worley(p, 32.0) * 0.12;
  float w3 = worley(p, 16.0) * 0.65 + worley(p, 32.0) * 0.35;
  float pw = clamp((perlin - (1.0 - w1) * 0.55) / (1.0 - (1.0 - w1) * 0.55), 0.0, 1.0);
  o = vec4(pw, w2, w3, perlin);
}
`;
