// Materials for everything the game adds to the Mistline scene: the road corridor, props and
// vehicles, lamps. They use the engine's own sky, cloud-shadow and aerial-perspective code so
// the additions sit in the same light as the terrain, plus the game lights (headlights).
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, pick, uni } from '../../engine/gl/common.js';
import { GLSL_SKY } from '../../engine/gl/sky.js';
import { GLSL_SURFACE } from '../../engine/gl/land.js';
import { GLSL_GAMELIGHT, GAMELIGHT_UNIFORMS } from '../../engine/gl/gamelight.js';

const SHARED = ['uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
  'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
  'uHighCloud', 'uSkyTime', 'uCamPos', 'uSnowline', 'uTreeline', 'uSeason', 'uShadowTex', 'uVolTex', 'uGrid', ...GAMELIGHT_UNIFORMS];

const HEAD = GLSL_COMMON + GLSL_SKY + GLSL_SURFACE + GLSL_GAMELIGHT;

// Shared lighting: sun or moon with terrain and cloud shadow, sky light, then the game lights.
const GLSL_LIT = /* glsl */`
vec3 litSurface(vec3 P, vec3 N, vec3 rd, float dist, vec3 alb, float gloss, float retroK, float ao) {
  vec4 vol; float vis = sunVisibility(P, vol);
  float ndl = saturate(dot(N, uLightDir));
  vec3 col = alb * (uLightCol * ndl * vis + skyLight(N, vol) * ao);
  vec3 h = normalize(uLightDir - rd);
  col += uLightCol * vis * pow(saturate(dot(N, h)), mix(16.0, 200.0, gloss)) * gloss * gloss * 0.6 * step(0.0, dot(N, uLightDir));
  vec3 sp, re; vec3 gl = gameLight(P, N, rd, gloss, sp, re);
  col += alb * gl * ao + sp * mix(vec3(0.04), alb, 0.2) * 6.0 + re * retroK * alb;
  // wet, glossy things pick up a little of the sky
  col += skyLight(reflect(rd, N), vol) * gloss * gloss * 0.12;
  vec3 ins; vec3 T = aerial(uCamPos, rd, dist, ins);
  return col * T + ins;
}
`;

const GROUND_VERT = /* glsl */`
precision highp float;
in vec3 position; in vec3 normal; in vec4 aRoad; in vec4 aMat;
uniform mat4 projectionMatrix, viewMatrix;
out vec3 vWorld; out vec3 vN; out vec4 vRoad; out vec4 vMat;
void main() {
  vWorld = position; vN = normal; vRoad = aRoad; vMat = aMat;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}
`;

// aRoad = (s, u, d, lateral direction angle): d is metres outside the running surface, negative on the left
// (downhill) side. aMat = (mud, rock, pullout, staging pad) weights.
const GROUND_FRAG = HEAD + GLSL_LIT + /* glsl */`
in vec3 vWorld; in vec3 vN; in vec4 vRoad; in vec4 vMat;
out vec4 o;
uniform float uHalfWidth;

// Photo-scanned ground (render/textures.js). TEX is set when the material is made: 0 = none (the
// generated ground below), 1 = colour only, 2 = colour, normals and roughness.
// Layers: 0 road gravel, 1 mud, 2 broken rock, 3 soil with stones, 4 forest floor.
#if TEX > 0
uniform highp sampler2DArray uGroundTex;
#if TEX > 1
uniform highp sampler2DArray uGroundNR;
#endif
struct Scan { vec3 a; vec2 n; float r; };      // colour, surface tilt along (u, v) of the image, roughness
// uv in tiles; gx, gy = how uv changes across one pixel (so it can be called inside an if).
// The colour is pulled part of the way to grey (desat) and scaled (k) to the brightness the lamps were tuned for.
Scan scan(float layer, vec2 uv, vec2 gx, vec2 gy, float desat, float k) {
  Scan m; vec3 c = textureGrad(uGroundTex, vec3(uv, layer), gx, gy).rgb;
  m.a = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))), desat) * k;
#if TEX > 1
  vec3 q = textureGrad(uGroundNR, vec3(uv, layer), gx, gy).rgb;
  m.n = vec2(q.r, -q.g) * 2.0 - vec2(1.0, -1.0); m.r = q.b;
#else
  m.n = vec2(0.0); m.r = 0.65;
#endif
  return m;
}
const mat2 TURN = mat2(0.8, 0.6, -0.6, 0.8);
#endif

// fw = size of a pixel on the ground in metres: octaves finer than that are dropped, so nothing sparkles
float gFade(float fw, float f) { return 1.0 - smoothstep(0.5, 1.5, fw * f); }
float gravelH(vec2 p, float fw) { return 0.5 + 0.5 * (vnoise2(p * 6.0) - 0.5) * gFade(fw, 6.0) + 0.3 * (vnoise2(p * 17.0) - 0.5) * gFade(fw, 17.0) + 0.2 * (vnoise2(p * 43.0) - 0.5) * gFade(fw, 43.0); }
// stones: x = distance to the nearest cell point, y = cell brightness, zw = cell tilt
vec4 stones(vec2 p) {
  vec2 i = floor(p), f = fract(p); float best = 9.0, second = 9.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y), c = g + vec2(hash12(i + g), hash12(i + g + 37.1)) * 0.86 + 0.07 - f;
    float d = dot(c, c);
    if (d < best) { second = best; best = d; id = i + g; } else if (d < second) second = d;
  }
  return vec4(sqrt(second) - sqrt(best), hash12(id + 3.3), hash12(id + 9.1) - 0.5, hash12(id + 21.7) - 0.5);
}

void main() {
  vec3 P = vWorld; vec3 V = P - uCamPos; float dist = length(V); vec3 rd = V / dist;
  vec3 N = normalize(vN);
  float s = vRoad.x, u = vRoad.y, d = vRoad.z, outD = abs(d);
  vec2 lat = vec2(cos(vRoad.w), sin(vRoad.w));                 // world xz of +u
  float fw = min(length(dFdx(P.xz)), length(dFdy(P.xz))) * 1.5;
  float lod = 1.0 - smoothstep(30.0, 110.0, dist);
  vec2 gx = dFdx(P.xz), gy = dFdy(P.xz);
  float n1 = vnoise2(P.xz * 0.9), n2 = vnoise2(P.xz * 0.21 + 7.0), n3 = vnoise2(P.xz * 3.7), n4 = mix(0.5, hash12(floor(P.xz * 38.0)), gFade(fw, 38.0));

  // ---- gravel running surface: two compacted wheel tracks, loose stone between and beside them
  float trackC = exp(-pow((abs(u) - 0.92) / 0.4, 2.0)) * (1.0 - vMat.z) * (1.0 - vMat.w);
  float padTracks = vMat.w * smoothstep(0.55, 0.75, vnoise2(vec2(u * 0.9, s * 0.07)));
  float track = max(trackC, padTracks * 0.7);
#if TEX > 0
  // the scanned gravel, laid in two directions that swap in patches a few metres across so the 2 m tile never shows as a grid
  float swap = smoothstep(0.42, 0.58, vnoise2(P.xz * 0.16 + 31.0));
  Scan g0 = Scan(vec3(0.0), vec2(0.0), 0.65);
  if (swap < 0.999) g0 = scan(0.0, P.xz * 0.5, gx * 0.5, gy * 0.5, 0.45, 0.8);
  if (swap > 0.001) {
    Scan g1 = scan(0.0, TURN * P.xz * 0.43 + 0.37, TURN * gx * 0.43, TURN * gy * 0.43, 0.45, 0.8);
    g1.n = g1.n * TURN;                              // back from the turned image to world x, z
    g0.a = mix(g0.a, g1.a, swap); g0.n = mix(g0.n, g1.n, swap); g0.r = mix(g0.r, g1.r, swap);
  }
  vec3 alb = g0.a; vec2 tn = g0.n; float tr = g0.r, tk = 1.0;      // tn: tilt in world x, z; tk: how strongly it is applied
  tk *= 1.0 - 0.5 * track;
#else
  vec3 alb = mix(vec3(0.13, 0.118, 0.10), vec3(0.24, 0.225, 0.20), mix(n3, n4, 0.3 * lod));
#endif
  alb *= (1.0 - 0.3 * track) * (0.8 + 0.34 * n2);
  float gloss = 0.14 + 0.22 * track;
  float bump = mix(1.0, 0.3, track);
  vec3 Nb = N;
  // puddles in the tracks and pot-holes
  float pud = smoothstep(0.60, 0.66, fbm2(P.xz * 0.37 + 3.0)) * smoothstep(0.2, 0.6, track + 0.25 * n1) * (1.0 - vMat.x) * (1.0 - vMat.y);

  // ---- pullout surfaces
  float wMud = smoothstep(0.3, 0.62, vMat.x + (n1 - 0.5) * 0.35);
  float wRock = smoothstep(0.3, 0.62, vMat.y + (n1 - 0.5) * 0.35);
  if (wMud > 0.0) {
    float wob = 2.2 * n2 + 0.7 * sin(s * 0.33) + 1.5 * vnoise2(vec2(s * 0.12, u * 0.7));
    float rut = sin(u * 5.2 + wob), rutD = cos(u * 5.2 + wob);
#if TEX > 0
    Scan sm = scan(1.0, P.xz * 0.77, gx * 0.77, gy * 0.77, 0.0, 0.9);
    vec3 mud = sm.a * (0.72 + 0.5 * (rut * 0.5 + 0.5));
    tn = mix(tn, sm.n, wMud); tr = mix(tr, sm.r, wMud); tk = mix(tk, 0.8, wMud);
#else
    vec3 mud = mix(vec3(0.052, 0.036, 0.024), vec3(0.105, 0.078, 0.052), 0.5 * n3 + 0.5 * (rut * 0.5 + 0.5));
#endif
    float water = smoothstep(-0.35, -0.75, rut + (n1 - 0.5) * 0.9);
    mud = mix(mud, vec3(0.02, 0.018, 0.016), water);
    alb = mix(alb, mud, wMud); gloss = mix(gloss, mix(0.62, 0.98, water), wMud); bump = mix(bump, 0.25 * (1.0 - water), wMud);
    Nb = normalize(Nb - vec3(lat.x, 0.0, lat.y) * rutD * 0.55 * (1.0 - water) * wMud);
    pud *= 1.0 - wMud;
  }
  if (wRock > 0.0) {
#if TEX > 0
    Scan sr = scan(2.0, P.xz * 0.42 + 0.2, gx * 0.42, gy * 0.42, 0.6, 0.66);
    alb = mix(alb, sr.a, wRock); gloss = mix(gloss, 0.08, wRock); bump = mix(bump, 0.5, wRock);
    tn = mix(tn, sr.n, wRock); tr = mix(tr, sr.r, wRock); tk = mix(tk, 1.8, wRock);
#endif
#if TEX < 2
    vec4 st = stones(P.xz * 2.1), big = stones(P.xz * 0.75 + 11.0);
    float bigW = smoothstep(0.35, 0.6, big.y);
    float gap = mix(smoothstep(0.0, 0.16, st.x), smoothstep(0.0, 0.1, big.x), bigW);
#if TEX == 0
    vec3 rock = mix(vec3(0.15, 0.148, 0.145), vec3(0.36, 0.35, 0.335), mix(st.y, big.y, bigW));
    rock *= 0.25 + 0.75 * gap;
    alb = mix(alb, rock, wRock); gloss = mix(gloss, 0.08, wRock); bump = mix(bump, 0.5, wRock);
#endif
    vec2 tilt = mix(st.zw, big.zw * 1.5, bigW);
    Nb = normalize(Nb + vec3(tilt.x, 0.0, tilt.y) * 1.5 * wRock * gap);
#endif
    pud *= 1.0 - wRock;
  }

  // ---- beside the road
  if (outD > 0.0) {
    float e = smoothstep(0.0, 0.7, outD);
    bool up = d > 0.0;
    float wFloor = smoothstep(5.0, 12.0, outD + (n1 - 0.5) * 5.0);
#if TEX > 0
    // uphill: the cut bank, soil with stones in it. Downhill: the gravel that was pushed over the edge.
    vec3 side = alb * 0.8; vec2 sn = tn; float sr2 = tr, sk = 1.3;
    if (up && wFloor < 0.999) {
      Scan ss = scan(3.0, P.xz * 0.77 + 0.5, gx * 0.77, gy * 0.77, 0.1, 1.35);
      side = ss.a * (0.8 + 0.4 * n2); sn = ss.n; sr2 = ss.r;
    }
#else
    vec4 st = stones(P.xz * 1.3 + 5.0);
    vec3 soil = mix(vec3(0.085, 0.062, 0.042), vec3(0.15, 0.115, 0.08), 0.6 * n3 + 0.4 * n2);
    soil = mix(soil, vec3(0.27, 0.26, 0.245) * (0.5 + 0.5 * smoothstep(0.0, 0.12, st.x)), smoothstep(0.62, 0.7, st.y) * 0.9);   // stones in the bank
    vec3 fill = mix(alb, vec3(0.2, 0.19, 0.175) * (0.35 + 0.65 * smoothstep(0.0, 0.14, st.x)) * (0.6 + 0.8 * st.y), 0.7);
    vec3 side = up ? soil : fill;
#endif
    float ditch = up ? (1.0 - smoothstep(1.7, 2.9, outD)) * smoothstep(0.3, 1.0, outD) : 0.0;
    side *= 1.0 - 0.45 * ditch;
    // dead grass and weeds along the edges
    float grass = smoothstep(0.5, 0.72, vnoise2(P.xz * 1.1 + 2.0) * 0.7 + 0.3 * hash12(floor(P.xz * 21.0))) * smoothstep(0.2, 1.1, outD) * (1.0 - smoothstep(4.0, 9.0, outD));
    side = mix(side, mix(vec3(0.15, 0.125, 0.055), vec3(0.07, 0.10, 0.03), n1), grass * 0.85);
    // forest floor further out: needles, duff, moss
#if TEX > 0
    if (wFloor > 0.001) {
      Scan sf = scan(4.0, P.xz * 0.5 + 0.13, gx * 0.5, gy * 0.5, 0.25, 0.2);
      side = mix(side, sf.a * (0.75 + 0.5 * n2), wFloor); sn = mix(sn, sf.n, wFloor); sr2 = mix(sr2, sf.r, wFloor);
    }
    tn = mix(tn, sn, e); tr = mix(tr, sr2, e); tk = mix(tk, sk, e);
#else
    vec3 floorC = mix(vec3(0.038, 0.03, 0.02), vec3(0.028, 0.05, 0.016), smoothstep(0.45, 0.7, n2 + 0.3 * n3)) * (0.7 + 0.6 * n3);
    side = mix(side, floorC, wFloor);
#endif
    alb = mix(alb, side, e);
    gloss = mix(gloss, 0.05 + 0.4 * ditch, e); bump = mix(bump, 1.4, e); pud *= 1.0 - e;
#if TEX == 0
    if (lod > 0.0) Nb = normalize(Nb + vec3(st.z, 0.0, st.w) * 0.5 * e * smoothstep(0.62, 0.7, st.y) * lod);
#endif
  }

  // fine relief, so low headlights rake across the stones
#if TEX > 1
  Nb = normalize(Nb + vec3(tn.x, 0.0, tn.y) * tk * 1.15);
  gloss = clamp(gloss * (1.7 - 1.1 * tr), 0.0, 1.0);
#else
  if (lod > 0.0 && bump > 0.0) {
    float ee = 0.035, h0 = gravelH(P.xz, fw), hx = gravelH(P.xz + vec2(ee, 0.0), fw), hz = gravelH(P.xz + vec2(0.0, ee), fw);
    Nb = normalize(Nb + vec3(h0 - hx, 0.0, h0 - hz) * 5.5 * bump * lod);
#if TEX == 0
    alb *= 0.72 + 0.56 * mix(0.5, h0, bump);
#endif
  }
#endif
  // standing water: flat, dark, mirror-like
  Nb = normalize(mix(Nb, N, pud)); alb = mix(alb, vec3(0.022, 0.02, 0.018), pud * 0.9); gloss = mix(gloss, 1.0, pud);
  // everything is damp
  alb *= 0.78;
  // lying snow: packed and grey in the wheel tracks, clean beside them
  if (uSnowCover > 0.0) {
    float sn = uSnowCover * smoothstep(0.2, 0.55, 1.0 - track * 0.75 + (n1 - 0.5) * 0.5);
    alb = mix(alb, mix(vec3(0.42, 0.45, 0.5), vec3(0.66, 0.7, 0.76), smoothstep(0.0, 0.5, 1.0 - track)), sn);
    gloss = mix(gloss, 0.22, sn); Nb = normalize(mix(Nb, N, sn * 0.7));
  }
  o = vec4(litSurface(P, Nb, rd, dist, alb, gloss, 0.0, 1.0), 1.0);
}
`;

// textures: what loadGroundTextures() resolved to (render/textures.js), or null for the generated ground
export function groundMaterial(halfWidth, textures = null) {
  const uniforms = { ...pick(...SHARED), uHalfWidth: { value: halfWidth } };
  if (textures) { uniforms.uGroundTex = { value: textures.albedo }; if (textures.nr) uniforms.uGroundNR = { value: textures.nr }; }
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, uniforms,
    defines: { TEX: textures ? textures.mode : 0 },
  });
}

// Props and vehicles: vertex colour (rgb = albedo), aAux = (gloss, retro-reflection, emission, unused),
// optional atlas texture where uv.x >= 0 (signs).
const propVert = (instanced) => /* glsl */`
precision highp float;
in vec3 position; in vec3 normal; in vec3 color; in vec4 aAux; in vec2 uv;
${instanced ? 'in mat4 instanceMatrix; in vec3 instanceColor;' : ''}
uniform mat4 projectionMatrix, viewMatrix, modelMatrix;
out vec3 vWorld; out vec3 vN; out vec3 vCol; out vec4 vAux; out vec2 vUv;
void main() {
  mat4 m = modelMatrix${instanced ? ' * instanceMatrix' : ''};
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz; vN = mat3(m) * normal; vCol = color${instanced ? ' * instanceColor' : ''}; vAux = aAux; vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const PROP_FRAG = HEAD + GLSL_LIT + /* glsl */`
in vec3 vWorld; in vec3 vN; in vec3 vCol; in vec4 vAux; in vec2 vUv;
out vec4 o;
uniform sampler2D uAtlas;
uniform float uGlow, uDirt;
void main() {
  vec3 V = vWorld - uCamPos; float dist = length(V); vec3 rd = V / dist;
  vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
  vec3 alb = vCol;
  if (vUv.x >= 0.0) alb *= texture(uAtlas, vUv).rgb;
  // road grime thrown up the lower panels
  float grime = uDirt * smoothstep(1.5, 0.2, vAux.w) * (0.5 + 0.5 * vnoise2(vWorld.xz * 3.0 + vWorld.y * 5.0));
  alb = mix(alb, vec3(0.09, 0.075, 0.06), grime * 0.75);
  alb = mix(alb, vec3(0.66, 0.7, 0.76), uSnowCover * smoothstep(0.5, 0.9, N.y) * step(vAux.z, 0.01));
  // cheap shading for built things: darker low down and on faces that look at the ground
  float ao = mix(0.5, 1.0, smoothstep(0.0, 1.1, vAux.w)) * (0.55 + 0.45 * smoothstep(-0.8, 0.3, N.y));
  vec3 col = litSurface(vWorld, N, rd, dist, alb, vAux.x * (1.0 - grime * 0.8), vAux.y * 14.0, ao);
  col += vCol * vAux.z * uGlow;
  o = vec4(col, 1.0);
}
`;
export function propMaterial({ instanced = false, atlas = null, dirt = 0 } = {}) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: propVert(instanced), fragmentShader: PROP_FRAG, side: THREE.DoubleSide,
    uniforms: { ...pick(...SHARED), uAtlas: { value: atlas }, uGlow: { value: 1 }, uDirt: { value: dirt } },
  });
}

// A lamp lens: plain emission (HDR, so it blooms), dimmed by the near fog like everything else.
const LAMP_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uPower;
out vec4 o;
void main() { o = vec4(uColor * uPower, 1.0); }
`;
const LAMP_VERT = /* glsl */`
precision highp float;
in vec3 position;
uniform mat4 projectionMatrix, viewMatrix, modelMatrix;
void main() { gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }
`;
export function lampMaterial(color, power = 1) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: LAMP_VERT, fragmentShader: LAMP_FRAG, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Vector3(...color) }, uPower: { value: power } },
  });
}
export { uni };
