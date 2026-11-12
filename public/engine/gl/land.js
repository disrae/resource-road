// Terrain mesh, its procedural material, and the sun-shadow map.
import * as THREE from '../../vendor/three.module.min.js';
import { GLSL_COMMON, Pass, target2D, pick, uni } from './common.js';
import { GLSL_SKY } from './sky.js';
import { WORLD } from '../terrain.js';

// Shared surface description: where forest and snow are. Used by terrain and trees.
export const GLSL_SURFACE = /* glsl */`
uniform float uSnowline, uTreeline, uSeason;
uniform sampler2D uShadowTex;
uniform sampler3D uVolTex;
uniform vec3 uGrid;
float forestAt(vec2 xz, vec4 ter) {
  float n = fbm2(xz / 900.0 + 3.7), n2 = vnoise2(xz / 140.0);
  float slope = 1.0 / sqrt(1.0 + dot(ter.yz, ter.yz));
  float tl = uTreeline + (n - 0.5) * 420.0 + clamp(ter.w, -200.0, 200.0) * -0.5;
  float f = smoothstep(tl + 60.0, tl - 220.0, ter.x + (n2 - 0.5) * 160.0);
  f *= smoothstep(0.52, 0.68, slope + (n2 - 0.5) * 0.12);
  f *= smoothstep(4.0, 16.0, ter.x);
  return f;
}
float snowAt(vec2 xz, vec4 ter, float ny) {
  float n = fbm2(xz / 520.0 + 11.0);
  float line = uSnowline + (n - 0.5) * 380.0 - clamp(-ter.w, -150.0, 250.0) * 0.6;
  float s = smoothstep(line - 90.0, line + 160.0, ter.x);
  float hold = smoothstep(0.38, 0.72, ny + (n - 0.5) * 0.2 + s * 0.12);   // steep faces shed snow
  return s * hold;
}
// light reaching a point: terrain shadow * cloud shadow. Also returns the volume texel.
float sunVisibility(vec3 p, out vec4 vol) {
  vec2 uv = p.xz / WORLD_SIZE + 0.5;
  vol = texture(uVolTex, vec3(uv, altToS(p.y + 25.0, groundAt(p.xz))));
  float sh = texture(uShadowTex, uv).r;
  return sh * exp(-vol.g * 0.9);
}
// Diffuse light leaking down through cloud of upward optical depth tau: multiple scattering makes
// it fall off far more slowly than the direct beam.
float cloudDiffuse(float tauUp) { return 1.0 / (1.0 + 0.3 * tauUp); }
// Hemispherical light at a surface under the sky and whatever cloud is above it.
vec3 skyLight(vec3 n, vec4 vol) {
  float td = cloudDiffuse(vol.a), over = 1.0 - exp(-vol.a * 0.8);
  vec3 overcast = uLightCol * (0.6 * saturate(uLightDir.y + 0.06)) + skyLUT(vec3(0.0, 1.0, 0.0)) * 3.2;
  return mix(skyAmbient(n), overcast * (0.6 + 0.4 * n.y), over) * mix(1.0, td, over);
}
`;

const VERT = /* glsl */`
precision highp float;
invariant gl_Position;
in vec3 position;
uniform mat4 projectionMatrix, viewMatrix;
uniform sampler2D uHeightTex;
uniform float uSink;
out vec3 vWorld;
void main() {
  vec3 p = position;
  vec2 uv = p.xz / ${WORLD.size.toFixed(1)} + 0.5;
  p.y = texture(uHeightTex, uv).x;
  if (uSink > 0.0 && all(greaterThan(uv, vec2(0.004))) && all(lessThan(uv, vec2(0.996)))) p.y -= uSink;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FRAG = GLSL_COMMON + GLSL_SKY + GLSL_SURFACE + /* glsl */`
in vec3 vWorld;
out vec4 o;
uniform sampler3D uNoiseTex;

// crowns: cellular pattern that reads as conifer tops from above and from the side
vec3 canopy(vec2 xz, float scale, out float crown) {
  vec2 p = xz / scale, i = floor(p), f = fract(p);
  float best = 9.0; vec2 bo = vec2(0.0); float id = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 c = g + vec2(hash12(i + g), hash12(i + g + 71.3)) * 0.8 + 0.1 - f;
    float d = dot(c, c);
    if (d < best) { best = d; bo = c; id = hash12(i + g + 13.1); }
  }
  float r = sqrt(best);
  crown = saturate(1.0 - r * 1.5) * (0.6 + 0.4 * id);
  return vec3(-bo / max(r, 1e-3) * saturate(r * 1.9), id);
}

void main() {
  vec3 P = vWorld;
  vec4 ter = terrainAt(P.xz);
  vec3 V = P - uCamPos;
  float dist = length(V);
  vec3 rd = V / dist;
  vec3 N = normalize(vec3(-ter.y, 1.0, -ter.z));
  // fine relief the height texture cannot hold
  float fade = 1.0 - smoothstep(600.0, 5000.0, dist);
  float e = 6.0;
  vec3 Nd = N;
  if (fade > 0.0) {
    float b0 = fbm2(P.xz / 34.0), bx = fbm2((P.xz + vec2(e, 0.0)) / 34.0), bz = fbm2((P.xz + vec2(0.0, e)) / 34.0);
    Nd = normalize(N + vec3(b0 - bx, 0.0, b0 - bz) * 3.4 * fade);
  }
  float slopeN = N.y;
  // crags: detail read from a 3D field, so it does not smear down steep faces the way xz-projected noise does
  float steep = 1.0 - smoothstep(0.5, 0.84, N.y);
  vec4 r1 = texture(uNoiseTex, P / 520.0);
  vec4 r2 = texture(uNoiseTex, P.zxy / 97.0 + r1.gbr * 0.12);
  vec3 crag = (vec3(r1.g, r1.a, r1.b) - 0.5) * 1.1 + (vec3(r2.b, r2.g, r2.a) - 0.5) * 0.9;
  Nd = normalize(Nd + crag * (0.22 + 0.78 * steep) * mix(0.3, 1.0, fade));

  float forest = forestAt(P.xz, ter);
  float snow = snowAt(P.xz, ter, Nd.y);
  float n1 = fbm2(P.xz / 260.0), n2 = fbm2(P.xz / 37.0 + 5.0), n3 = vnoise2(P.xz / 6.0);

  // rock with tilted strata and lichen-stained variation
  float strata = vnoise2(vec2(P.y / 26.0 + n1 * 3.0, dot(P.xz, vec2(0.003, 0.002))));
  vec3 rock = mix(vec3(0.115, 0.108, 0.10), vec3(0.23, 0.215, 0.20), strata);
  rock = mix(rock, vec3(0.16, 0.13, 0.10), 0.5 * n2);
  rock *= 0.66 + 0.7 * mix(n3, r2.g, steep);
  rock *= 1.0 - 0.4 * steep * smoothstep(0.5, 0.8, r2.r) * smoothstep(0.35, 0.6, r1.g);     // gullies and cracks
  // alpine heather / meadow, seasonal
  float au = smoothstep(0.62, 0.8, uSeason) * (1.0 - smoothstep(0.9, 1.0, uSeason));
  float wi = 1.0 - smoothstep(0.08, 0.3, uSeason) + smoothstep(0.9, 1.0, uSeason);
  vec3 meadow = mix(vec3(0.085, 0.12, 0.035), vec3(0.19, 0.13, 0.04), saturate(au + 0.7 * wi));
  meadow = mix(meadow, vec3(0.12, 0.16, 0.05), n2 * 0.5);
  float grass = smoothstep(0.62, 0.8, slopeN + (n2 - 0.5) * 0.25) * (1.0 - smoothstep(uTreeline + 250.0, uTreeline + 700.0, P.y + n1 * 300.0));
  vec3 alb = mix(rock, meadow, grass);

  // forest
  float nearF = 1.0 - smoothstep(900.0, 3200.0, dist), midF = 1.0 - smoothstep(2200.0, 6500.0, dist);
  // the crown patterns cost a lot of arithmetic: only where there is forest close enough to show them
  float crown = 0.5, crown2 = 0.5;
  vec3 cn = vec3(0.0, 0.0, 0.5), cn2 = vec3(0.0, 0.0, 0.5);
  if (forest > 0.0 && nearF > 0.0) cn = canopy(P.xz, 9.0, crown);
  if (forest > 0.0 && midF > 0.0) cn2 = canopy(P.xz, 31.0, crown2);
  vec3 conifer = mix(vec3(0.022, 0.052, 0.030), vec3(0.052, 0.090, 0.036), cn.z * 0.6 + n1 * 0.5);
  vec3 decid = mix(vec3(0.05, 0.10, 0.025), mix(vec3(0.30, 0.17, 0.02), vec3(0.22, 0.06, 0.02), cn2.z), au);
  decid = mix(decid, vec3(0.09, 0.075, 0.06), wi * 0.8);
  float broadleaf = smoothstep(0.62, 0.8, fbm2(P.xz / 480.0 + 23.0)) * smoothstep(700.0, 200.0, P.y);
  vec3 tree = mix(conifer, decid, broadleaf * (0.4 + 0.6 * cn2.z));
  tree *= mix(1.0, 0.45 + 0.9 * crown, nearF * 0.9) * mix(1.0, 0.7 + 0.6 * crown2, midF * 0.6);
  alb = mix(alb, tree, forest);
  vec3 Nf = normalize(Nd + vec3(cn.x, 0.0, cn.y) * 0.9 * nearF + vec3(cn2.x, 0.0, cn2.y) * 0.45 * midF);
  Nd = normalize(mix(Nd, Nf, forest));

  // shoreline: gravel, darker where wet
  float shore = 1.0 - smoothstep(1.5, 9.0, P.y + (n2 - 0.5) * 3.0);
  alb = mix(alb, mix(vec3(0.07, 0.065, 0.06), vec3(0.2, 0.185, 0.16), smoothstep(0.0, 6.0, P.y)) * (0.8 + 0.4 * n3), shore);
  if (P.y < 0.0) alb = mix(vec3(0.05, 0.06, 0.05), vec3(0.02, 0.03, 0.035), saturate(-P.y / 30.0));

  // snow: full cover on open ground, dusting on the canopy
  float snowCover = snow * mix(1.0, (0.12 + 0.5 * mix(0.45, crown, nearF)) * mix(0.55, 1.0, smoothstep(0.0, 500.0, P.y - uSnowline)), forest);
  vec3 snowCol = vec3(0.86, 0.89, 0.93);
  alb = mix(alb, snowCol, snowCover);
  Nd = normalize(mix(Nd, N, snowCover * 0.55));

  // light
  vec4 vol;
  float vis = sunVisibility(P, vol);
  float wet = saturate(vol.b * 3.0) * (1.0 - snowCover);
  alb *= mix(1.0, 0.62, wet);
  float ndl = dot(Nd, uLightDir);
  float wrap = mix(saturate(ndl), saturate(ndl * 0.75 + 0.25), max(forest * 0.6, snowCover * 0.5));
  float ao = saturate(0.72 + ter.w / 260.0) * mix(1.0, 0.55 + 0.45 * crown, forest * nearF);
  vec3 amb = skyLight(Nd, vol) * ao;
  amb += uLightCol * 0.035 * saturate(0.5 - 0.5 * Nd.y) * vis;                       // ground bounce
  vec3 col = alb * (uLightCol * wrap * vis + amb) / PI * 3.14159;
  // sparkle + sheen on snow and wet rock
  vec3 Hh = normalize(uLightDir - rd);
  float spec = pow(saturate(dot(Nd, Hh)), mix(24.0, 90.0, wet)) * (snowCover * 0.22 + wet * 0.35) * saturate(ndl * 4.0);
  col += uLightCol * spec * vis;

  vec3 ins;
  vec3 T = aerial(uCamPos, rd, dist, ins);
  col = col * T + ins;
  o = vec4(col, 1.0);
}
`;

const DEPTH_FRAG = /* glsl */`
precision highp float;
in vec3 vWorld;
void main() {}
`;

const SHADOW_FRAG = GLSL_COMMON + /* glsl */`
uniform vec3 uLightDir;
in vec2 vUv;
out vec4 o;
void main() {
  vec2 xz = (vUv - 0.5) * WORLD_SIZE;
  float h0 = texture(uHeightTex, vUv).x;
  vec3 p = vec3(xz.x, max(h0, 0.0) + 6.0, xz.y);
  float res = 1.0, t = 30.0;
  vec3 l = uLightDir;
  if (l.y < -0.02) { o = vec4(0.0); return; }
  for (int i = 0; i < 56; i++) {
    vec3 q = p + l * t;
    if (q.y > 2900.0) break;
    float h = texture(uHeightTex, q.xz / WORLD_SIZE + 0.5).x;
    res = min(res, 14.0 * (q.y - h) / t);
    if (res < 0.0) break;
    t += clamp((q.y - h) * 0.5, 22.0, 400.0);
  }
  o = vec4(vec3(smoothstep(0.0, 1.0, res)), 1.0);
}
`;

function gridGeometry(size, n) {
  const g = new THREE.PlaneGeometry(size, size, n, n);
  g.rotateX(-Math.PI / 2);
  return g;
}

export class Land {
  constructor(renderer, detail = 768) {
    this.renderer = renderer;
    const uniforms = {
      ...pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip',
        'uSkyLUT', 'uSunDir', 'uMoonDir', 'uLightDir', 'uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol', 'uHaze', 'uNight',
        'uHighCloud', 'uSkyTime', 'uCamPos', 'uSnowline', 'uTreeline', 'uSeason', 'uShadowTex', 'uVolTex', 'uGrid', 'uNoiseTex'),
      uSink: { value: 0 },
    };
    // Depth is laid down first by a cheap copy of each mesh, so the heavy surface shader runs
    // once per pixel however many ridges overlap behind one another.
    const mk = (sink) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { ...uniforms, uSink: { value: sink } }, depthWrite: false, depthFunc: THREE.EqualDepth,
    });
    const mkDepth = (sink) => new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: DEPTH_FRAG, colorWrite: false,
      uniforms: { uHeightTex: uniforms.uHeightTex, uSink: { value: sink } },
    });
    this.detail = detail;
    this.group = new THREE.Group();
    this.inner = new THREE.Mesh(gridGeometry(WORLD.size, detail), mk(0));
    this.outer = new THREE.Mesh(gridGeometry(WORLD.size * 5, 400), mk(700));
    this.innerDepth = new THREE.Mesh(this.inner.geometry, mkDepth(0));
    this.outerDepth = new THREE.Mesh(this.outer.geometry, mkDepth(700));
    for (const m of [this.inner, this.outer, this.innerDepth, this.outerDepth]) m.frustumCulled = false;
    this.innerDepth.renderOrder = this.outerDepth.renderOrder = -2;
    this.inner.renderOrder = this.outer.renderOrder = -1;
    this.group.add(this.innerDepth, this.outerDepth, this.inner, this.outer);

    this.shadowRT = target2D(1024, 1024, { type: THREE.UnsignedByteType, wrapS: THREE.MirroredRepeatWrapping, wrapT: THREE.MirroredRepeatWrapping });
    this.shadowPass = new Pass(SHADOW_FRAG, pick('uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip', 'uLightDir'));
    uni('uShadowTex', this.shadowRT.texture);
    this.lastDir = new THREE.Vector3();
  }
  setDetail(detail) {
    if (detail === this.detail) return;
    this.detail = detail;
    this.inner.geometry.dispose();
    this.inner.geometry = this.innerDepth.geometry = gridGeometry(WORLD.size, detail);
  }
  updateShadow(force = false) {
    const d = uni('uLightDir').value;
    if (!force && this.lastDir.distanceToSquared(d) < 2e-7) return;
    this.lastDir.copy(d);
    this.shadowPass.render(this.renderer, this.shadowRT);
  }
}
