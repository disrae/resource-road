// Puts the game's world into the Mistline engine: carves the road into the generated terrain,
// adds the built ground, plants, signs and vehicles, and drives light, fog and time of day.
import * as THREE from '../../vendor/three.module.min.js';
import { Engine } from '../../engine/engine.js';
import { uni } from '../../engine/gl/common.js';
import { WORLD } from '../../engine/terrain.js';
import { N_SPOT, N_POINT } from '../../engine/gl/gamelight.js';
import { buildRoute, heightSampler } from './route.js';
import { buildGround, buildFlora } from './corridor.js';
import { placeFor } from './place.js';
import { conditionFor } from './conditions.js';
import { RUNGS } from '../quality.js';

// Graphics levels: what is fixed when the page loads.
//   engine    the Mistline quality tier underneath (terrain detail, weather grid, pixel budget)
//   scale     render resolution as a fraction of the window's pixels, before the automatic ladder
//   clouds    draw the engine's volumetric clouds in daylight
//   flora     planting density beside the road
//   rung      where the automatic graphics ladder starts (see ../quality.js); a level forced by the
//             link or picked on the title screen never goes above this rung
//   fogSteps  steps in the headlight fog march at the top rung (the shader allows up to 40)
//   tex       sizes of the photo-scanned ground images this level downloads (normal: 0 = none)
//   aniso     anisotropic filtering for those images
// Everything else adapts while the game runs: world.setRung().
// Light is for weak laptops. Film is for recording video offline (see ../film.js), not for play:
// nothing in it is held back to keep a frame rate.
export const LEVELS = {
  light:    { label: 'Light',    engine: 'low',    scale: 0.75, clouds: false, flora: 0.6,  rung: 4, fogSteps: 22, tex: { albedo: 512,  normal: 0 },    aniso: 2 },
  balanced: { label: 'Balanced', engine: 'medium', scale: 0.8,  clouds: true,  flora: 0.85, rung: 2, fogSteps: 22, tex: { albedo: 512,  normal: 512 },  aniso: 4 },
  high:     { label: 'High',     engine: 'high',   scale: 1,    clouds: true,  flora: 1.0,  rung: 0, fogSteps: 22, tex: { albedo: 1024, normal: 1024 }, aniso: 8 },
  film:     { label: 'Film',     engine: 'ultra',  scale: 1,    clouds: true,  flora: 1.0,  rung: 0, fogSteps: 40, tex: { albedo: 2048, normal: 2048 }, aniso: 16, offline: true },
};
// the name of a level from what a link or an older saved choice says ("low" and "medium" are the old names)
export const levelName = (v) => { const k = { low: 'light', medium: 'balanced' }[v] || v; return LEVELS[k] ? k : null; };
const FULL = { treeRange: [1100, 280], floraRange: [650, 230] };   // at the top rung: [daylight, dark]

export function createWorld(canvas, levelId, scenario, conditionName = null, textures = null) {
  const tierName = LEVELS[levelId] ? levelId : 'balanced', tier = LEVELS[tierName];
  const condition = conditionFor(scenario.look, conditionName);
  const place = placeFor(scenario);
  let route = null, maskTex = null, maskRect = null;
  const engine = new Engine(canvas, tier.engine, {
    terrain(h, n) {
      const natural = Float32Array.from(h);
      // the place: a terrain source (these heights) plus a road path (see place.js)
      route = buildRoute(heightSampler(natural, n, WORLD.size), place.layout, place.road);
      const bb = route.bounds(), cell = 3, w = Math.ceil((bb.x1 - bb.x0) / cell), hh = Math.ceil((bb.z1 - bb.z0) / cell);
      const mask = { cell, x0: bb.x0, z0: bb.z0, w, h: hh, data: new Uint8Array(w * hh) };
      route.carve(h, n, WORLD.size, mask);
      maskTex = new THREE.DataTexture(mask.data, w, hh, THREE.RedFormat, THREE.UnsignedByteType);
      maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
      maskRect = [bb.x0, bb.z0, 1 / (w * cell), 1 / (hh * cell)];
    },
  });
  uni('uRoadMask').value = maskTex; uni('uRoadMaskRect').value.set(...maskRect);
  engine.setDial('season', scenario.look.season);
  engine.setDial('weatherSpeed', 40);

  const ground = buildGround(route, textures);
  const flora = buildFlora(route, { density: tier.flora });
  engine.scene.add(ground.mesh, flora.group);

  const spotPos = uni('uSpotPos').value, spotDir = uni('uSpotDir').value, spotCol = uni('uSpotCol').value;
  const pointPos = uni('uPointPos').value, pointCol = uni('uPointCol').value;
  const world = {
    engine, route, ground, flora, tier, tierName, level: tierName, textures, scenario, condition, env: 'stage', dark: 0, rung: tier.rung,
    // spot i: position, direction (unit), intensity (0 = off), half-angle in degrees, colour
    setSpot(i, p, d, intensity, halfAngle = 24, col = [1, 0.93, 0.8]) {
      if (i >= N_SPOT) return;
      spotPos[i].set(p[0], p[1], p[2], intensity); spotDir[i].set(d[0], d[1], d[2], Math.cos(halfAngle * Math.PI / 180)); spotCol[i].set(col[0], col[1], col[2]);
    },
    setPoint(i, p, intensity, col = [1, 0.1, 0.05]) {
      if (i >= N_POINT) return;
      pointPos[i].set(p[0], p[1], p[2], intensity); pointCol[i].set(col[0], col[1], col[2]);
    },
    lightsOff() { for (let i = 0; i < N_SPOT; i++) spotPos[i].w = 0; for (let i = 0; i < N_POINT; i++) pointPos[i].w = 0; },
    // light scattered back from the fog around a set of lamps (lights the truck's own bodywork a little)
    setFill(p, radius, col) { uni('uFillPos').value.set(p[0], p[1], p[2], radius); uni('uFillCol').value.set(col[0], col[1], col[2]); },
    setSurfaces(types) { ground.setSurfaces(types); flora.strew(route.pullouts, types); },
    // 'stage' (the staging area at dusk, long view) or 'drive' (the scenario's condition: by default night and fog)
    setEnv(env) {
      const L = scenario.look, C = condition, drive = env === 'drive'; world.env = env; world.dark = drive && C.dark ? 1 : 0;
      engine.setDials(L.stage);
      if (drive) engine.setDials(C.dials);
      const fp = uni('uFogParams').value, fog = drive ? C.fog : null;
      if (fog) fp.set(3 / fog.visibility, fog.top ?? L.fogTop, fog.topSoftness ?? L.fogTopSoftness ?? 16, 0.6);
      else fp.set(0, L.fogTop, 16, 0.6);
      uni('uFogAmb').value.set(...(C.fogAmbient || [0.0017, 0.0026, 0.004]));
      uni('uFogSky').value.set(...(C.fogSky || [0.0036, 0.0054, 0.0085]));
      uni('uFogGlow').value = C.fogGlow ?? 0.011;
      uni('uSnowCover').value = drive ? C.snow || 0 : 0; uni('uRain').value = drive ? C.rain || 0 : 0;
      if (world.dark) {
        // fixed exposure at night (the meter is pinned), so the dark stays dark and the lamps set the picture
        engine.exposureGain = (C.exposure ?? 7) / (0.62 * 0.45 * Math.pow(2, 6.6)); engine.meterKey = 1e-4;
      } else { engine.exposureGain = 1; engine.meterKey = 1; }
      // in fog at night nothing is seen of the clouds, so the weather simulation and cloud march are skipped
      engine.drawClouds = tier.clouds && !(world.dark && fog && fog.visibility < 300);
      engine.fixedNear = drive ? 0.12 : 0.35;
      world.setRung(world.rung);
    },
    // one rung of the automatic graphics ladder (../quality.js): only numbers read every frame change
    setRung(i) {
      const r = RUNGS[Math.max(0, Math.min(RUNGS.length - 1, i))], q0 = world.baseQuality, short = world.dark ? 1 : 0;
      world.rung = i;
      world.fogSteps = uni('uFogSteps').value = Math.max(6, Math.round(tier.fogSteps * r.fog));
      engine.trees.setDensity(q0.trees, Math.max(120, FULL.treeRange[short] * r.range * (0.55 + 0.45 * q0.trees)));
      world.floraRange = Math.max(90, FULL.floraRange[short] * r.range);
      engine.quality = { ...q0, maxSteps: Math.max(28, Math.round(q0.maxSteps * r.cloud)), stepScale: q0.stepScale / r.cloud };
      if (engine.autoScale !== r.res) { engine.autoScale = r.res; if (engine.cssW) engine.setSize(engine.cssW, engine.cssH, engine.dpr, engine.fixed); }
    },
    setFog(visibility, top) { const fp = uni('uFogParams').value; fp.x = visibility > 0 ? 3 / visibility : 0; if (top != null) fp.y = top; },
    resize(w, h, dpr, fixed = null) { engine.userScale = tier.scale / world.baseQuality.scale; engine.setSize(w, h, dpr, fixed); },
    frame(dt, opts) { flora.update(engine.camera, world.floraRange || 400); engine.frame(dt, opts); },
    // camera helper in road coordinates: eye at (s, u, height above the road), looking along the road
    // turned by yaw (radians, positive = right) and pitched by pitch
    view(s, u = 0, h = 1.6, yaw = 0, pitch = 0) {
      const f = route.frame(s), cam = engine.camera, w = route.toWorld(s, u);
      cam.position.set(w[0], w[1] + h, w[2]);
      cam.rotation.set(pitch, Math.atan2(-f.tx, -f.tz) - yaw, 0, 'YXZ');
    },
  };
  world.baseQuality = { ...engine.quality };
  world.setEnv('stage');
  return world;
}
