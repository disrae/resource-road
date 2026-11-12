// Game lights: a handful of spot lights (headlights) and point lights (tail-lights, markers)
// shared by every lit material and by the near-fog pass. Added for the resource-road game.
import * as THREE from '../../vendor/three.module.min.js';
import { uni } from './common.js';

export const N_SPOT = 4, N_POINT = 6;

const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));
const v3 = (n) => Array.from({ length: n }, () => new THREE.Vector3(0, 0, 0));
uni('uSpotPos', v4(N_SPOT));     // xyz position, w intensity (0 = off)
uni('uSpotDir', v4(N_SPOT));     // xyz direction, w cosine of the outer half-angle
uni('uSpotCol', v3(N_SPOT));
uni('uPointPos', v4(N_POINT));   // xyz position, w intensity
uni('uPointCol', v3(N_POINT));
uni('uFogParams', new THREE.Vector4(0, 400, 30, 0.6));   // extinction per metre, top altitude, top softness, wisp amount
uni('uFillPos', new THREE.Vector4(0, 0, 0, 1));          // soft fill light scattered back by the fog: xyz, w radius
uni('uFillCol', new THREE.Vector3(0, 0, 0));

export const GAMELIGHT_UNIFORMS = ['uSpotPos', 'uSpotDir', 'uSpotCol', 'uPointPos', 'uPointCol', 'uFogParams', 'uFillPos', 'uFillCol'];

export const GLSL_GAMELIGHT = /* glsl */`
#define N_SPOT ${N_SPOT}
#define N_POINT ${N_POINT}
uniform vec4 uSpotPos[N_SPOT];
uniform vec4 uSpotDir[N_SPOT];
uniform vec3 uSpotCol[N_SPOT];
uniform vec4 uPointPos[N_POINT];
uniform vec3 uPointCol[N_POINT];
uniform vec4 uFogParams;
uniform vec4 uFillPos;
uniform vec3 uFillCol;
// Beam profile of a dipped headlamp. The lamp axis is aimed 0.045 (tangent) below a cut-off line;
// under the line the beam gets stronger toward it, so the road is lit fairly evenly from near to
// far, and above it only a little spill escapes up into the fog in front of the driver's eyes.
float spotCone(vec3 l, vec4 dir) {
  vec3 d = dir.xyz; float z = dot(l, d);
  if (z <= 0.05) return 0.0;
  vec3 rt = normalize(vec3(-d.z, 0.0, d.x)), up = cross(rt, d);
  float W = sqrt(max(1.0 - dir.w * dir.w, 1e-4)) / dir.w;          // tangent of the half-angle
  float az = dot(l, rt) / z / W, tb = 0.045 - dot(l, up) / z;      // tb: tangent below the cut-off
  float v = pow(0.045 / max(tb, 0.036), 1.6);
  v *= 1.0 - smoothstep(W * 0.7, W * 1.5, tb);                     // bottom of the beam
  v *= mix(0.07, 1.0, smoothstep(-0.07, 0.02, tb));                // the cut-off
  v *= 1.0 - smoothstep(W * 0.4, W * 1.0, -tb);                    // top of the spill
  return v * (0.6 * exp(-az * az * 1.9) + 0.4 * exp(-az * az * 10.0));
}
// Diffuse light from the game lights at P (multiply by albedo). spec receives a glossy highlight
// (scaled by gloss 0..1) and retro receives light bounced straight back at the lamp, for signs.
vec3 gameLight(vec3 P, vec3 N, vec3 rd, float gloss, out vec3 spec, out vec3 retro) {
  vec3 sum = vec3(0.0); spec = vec3(0.0); retro = vec3(0.0);
  float shin = mix(18.0, 260.0, gloss);
  for (int i = 0; i < N_SPOT; i++) {
    if (uSpotPos[i].w <= 0.0) continue;
    vec3 L = P - uSpotPos[i].xyz; float r2 = dot(L, L), r = sqrt(r2); vec3 l = L / max(r, 1e-3);
    float cone = spotCone(l, uSpotDir[i]);
    if (cone <= 0.0) continue;
    vec3 E = uSpotCol[i] * (uSpotPos[i].w * cone / (r2 + 1.0) * exp(-uFogParams.x * r));
    float ndl = dot(N, -l);
    // wrapped: rough ground at a grazing angle still throws light back toward the lamp
    float k = 0.3 * (1.0 - gloss);
    sum += E * clamp((ndl + k) / (1.0 + k), 0.0, 1.0);
    vec3 h = normalize(-l - rd);
    spec += E * pow(max(dot(N, h), 0.0), shin) * step(0.0, ndl) * gloss * (0.25 + shin * 0.012);
    retro += E * smoothstep(0.90, 1.0, dot(l, rd)) * smoothstep(-0.2, 0.3, ndl);
  }
  for (int i = 0; i < N_POINT; i++) {
    if (uPointPos[i].w <= 0.0) continue;
    vec3 L = P - uPointPos[i].xyz; float r2 = dot(L, L), r = sqrt(r2); vec3 l = L / max(r, 1e-3);
    vec3 E = uPointCol[i] * (uPointPos[i].w / (r2 + 0.6) * exp(-uFogParams.x * r));
    float ndl = dot(N, -l);
    sum += E * max(ndl * 0.8 + 0.2, 0.0);
    vec3 h = normalize(-l - rd);
    spec += E * pow(max(dot(N, h), 0.0), shin) * step(0.0, ndl) * gloss * (0.25 + shin * 0.012);
  }
  // light scattered back out of the fog around the lamps: soft and directionless
  vec3 F = P - uFillPos.xyz;
  sum += uFillCol / (1.0 + dot(F, F) / (uFillPos.w * uFillPos.w)) * (0.6 + 0.4 * N.y);
  return sum;
}
`;
