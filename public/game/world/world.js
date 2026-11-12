// Puts the game's world into the Mistline engine: carves the road into the generated terrain,
// adds the built ground, plants, signs and vehicles, and drives light, fog and time of day.
import * as THREE from '../../vendor/three.module.min.js';
import { Engine } from '../../engine/engine.js';
import { uni } from '../../engine/gl/common.js';
import { WORLD } from '../../engine/terrain.js';
import { N_SPOT, N_POINT } from '../../engine/gl/gamelight.js';
import { buildRoute, heightSampler } from './route.js';
import { buildGround, buildFlora } from './corridor.js';

// Graphics tiers. `engine` picks the Mistline quality tier underneath.
//   fogSteps: samples of the near-fog march; clouds: draw the engine's volumetric clouds at dusk;
//   flora: planting density; treeRange / floraRange: draw distance [dusk, night] in metres.
export const TIERS = {
  low:    { label: 'Low',    engine: 'low',    fogSteps: 8,  clouds: false, flora: 0.6, treeRange: [520, 200], floraRange: [330, 150], scale: 1 },
  medium: { label: 'Medium', engine: 'medium', fogSteps: 14, clouds: true,  flora: 0.85, treeRange: [800, 240], floraRange: [480, 190], scale: 1 },
  high:   { label: 'High',   engine: 'high',   fogSteps: 22, clouds: true,  flora: 1.0, treeRange: [1100, 280], floraRange: [650, 230], scale: 1 },
};

export function createWorld(canvas, tierName, scenario) {
  const tier = TIERS[tierName] || TIERS.medium;
  let route = null, maskTex = null, maskRect = null;
  const engine = new Engine(canvas, tier.engine, {
    terrain(h, n) {
      const natural = Float32Array.from(h);
      route = buildRoute(heightSampler(natural, n, WORLD.size), scenario.layout);
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

  const ground = buildGround(route);
  const flora = buildFlora(route, { density: tier.flora });
  engine.scene.add(ground.mesh, flora.group);

  const spotPos = uni('uSpotPos').value, spotDir = uni('uSpotDir').value, spotCol = uni('uSpotCol').value;
  const pointPos = uni('uPointPos').value, pointCol = uni('uPointCol').value;
  const world = {
    engine, route, ground, flora, tier, tierName, scenario, env: 'dusk', night: 0,
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
    // 'dusk' (staging area, long view) or 'night' (the drive: dark, fog down on the road)
    setEnv(env, fogScale = 1) {
      const L = scenario.look; world.env = env; world.night = env === 'night' ? 1 : 0;
      engine.setDials(L.dusk);
      const fp = uni('uFogParams').value;
      if (env === 'night') {
        engine.setDials(L.night);
        engine.drawClouds = false;
        fp.set(3 / L.fog.visibility * fogScale, L.fog.top, L.fog.topSoftness, 0.6);
        uni('uFogAmb').value.set(...(L.fog.ambient || [0.0012, 0.0018, 0.0028]));
        uni('uFogSky').value.set(...(L.fog.sky || [0.0026, 0.0038, 0.006]));
        // fixed exposure at night (the meter is pinned), so the dark stays dark and the lamps set the picture
        engine.exposureGain = (L.nightExposure ?? 7) / (0.62 * 0.45 * Math.pow(2, 6.6)); engine.meterKey = 1e-4;
        uni('uFogGlow').value = L.fog.glow ?? 0.012;
      } else {
        engine.drawClouds = tier.clouds;
        fp.set(0, L.fog.top, L.fog.topSoftness, 0.6);
        engine.exposureGain = 1; engine.meterKey = 1;
      }
      engine.fixedNear = env === 'night' ? 0.12 : 0.35;
      uni('uFogSteps').value = tier.fogSteps;
      engine.trees.setDensity(engine.quality.trees, tier.treeRange[world.night]);
      world.floraRange = tier.floraRange[world.night];
    },
    setFog(visibility, top) { const fp = uni('uFogParams').value; fp.x = visibility > 0 ? 3 / visibility : 0; if (top != null) fp.y = top; },
    resize(w, h, dpr, fixed = null) { engine.userScale = tier.scale; engine.setSize(w, h, dpr, fixed); },
    frame(dt, opts) { flora.update(engine.camera, world.floraRange || 400); engine.frame(dt, opts); },
    // camera helper in road coordinates: eye at (s, u, height above the road), looking along the road
    // turned by yaw (radians, positive = right) and pitched by pitch
    view(s, u = 0, h = 1.6, yaw = 0, pitch = 0) {
      const f = route.frame(s), cam = engine.camera, w = route.toWorld(s, u);
      cam.position.set(w[0], w[1] + h, w[2]);
      cam.rotation.set(pitch, Math.atan2(-f.tx, -f.tz) - yaw, 0, 'YXZ');
    },
  };
  world.setEnv('dusk');
  return world;
}
