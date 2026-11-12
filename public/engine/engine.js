// The engine: owns the GL renderer, terrain, atmosphere and the frame graph.
import * as THREE from '../vendor/three.module.min.js';
import { generateHeightmap, buildTerrainTexels, buildShelterTexels, solveFlow, WORLD } from './terrain.js';
import { defaults, clampDial, DIAL_KEYS } from './params.js';
import { lighting, transmittance } from './astro.js';
import { uni } from './gl/common.js';
import { Atmosphere } from './gl/atmosphere.js';
import { Sky } from './gl/sky.js';
import { Land } from './gl/land.js';
import { Clouds } from './gl/clouds.js';
import { Post } from './gl/post.js';
import { Water } from './gl/water.js';
import { Trees } from './gl/trees.js';

export const QUALITY = {
  low:    { label: 'Low',    sim: [96, 96, 32],   cloudScale: 1 / 3,   maxSteps: 56,  stepScale: 1.6,  terrain: 384,  trees: 0.35, scale: 0.6,  maxDpr: 1,   maxPixels: 1.0e6, temporal: 0.9 },
  medium: { label: 'Medium', sim: [128, 128, 40], cloudScale: 1 / 2.5, maxSteps: 72,  stepScale: 1.25, terrain: 640,  trees: 0.7,  scale: 0.8,  maxDpr: 1.5, maxPixels: 1.5e6, temporal: 0.9 },
  high:   { label: 'High',   sim: [128, 128, 48], cloudScale: 1 / 2.2, maxSteps: 88,  stepScale: 1.05, terrain: 768,  trees: 1.0,  scale: 1.0,  maxDpr: 1.5, maxPixels: 1.75e6, temporal: 0.88 },
  ultra:  { label: 'Ultra',  sim: [192, 192, 64], cloudScale: 1 / 1.5, maxSteps: 144, stepScale: 0.7,  terrain: 1024, trees: 1.4,  scale: 1.0,  maxDpr: 2,   maxPixels: 8.3e6, temporal: 0.85 },
};
const WEATHER_KEYS = ['moisture', 'cloudBase', 'inversion', 'temperature', 'windDir', 'windSpeed', 'precip'];

export class Engine {
  constructor(canvas, qualityName = 'high') {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    r.autoClear = true;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.gl = r.getContext();
    this.floatLinear = !!r.extensions.get('OES_texture_float_linear');
    r.extensions.get('EXT_color_buffer_float');
    this.dials = defaults();
    this.qualityName = QUALITY[qualityName] ? qualityName : 'high';
    this.quality = QUALITY[this.qualityName];
    this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 2, 200000);
    this.camera.rotation.order = 'YXZ';
    this.viewProj = new THREE.Matrix4(); this.invViewProj = new THREE.Matrix4(); this.prevViewProj = new THREE.Matrix4();
    this.frameIndex = 0; this.skyTime = 0; this.nudgeBoost = 0; this.lastWeather = null;
    this.size = new THREE.Vector2(2, 2);

    // shared uniforms that need an initial value before any material compiles
    uni('uWind', new THREE.Vector2(5, 0)); uni('uSimTime', 0); uni('uT0', 10); uni('uMoisture', 0.7);
    uni('uCloudBase', 700); uni('uInversion', 0.2); uni('uPrecip', 0.3);
    for (const n of ['uSunDir', 'uMoonDir', 'uLightDir']) uni(n, new THREE.Vector3(0, 1, 0));
    for (const n of ['uLightCol', 'uSunCol', 'uSunColHigh', 'uMoonCol']) uni(n, new THREE.Vector3(1, 1, 1));
    uni('uHaze', 0.3); uni('uNight', 0); uni('uHighCloud', 0.2); uni('uSkyTime', 0); uni('uMoonFade', 0);
    uni('uCamPos', new THREE.Vector3()); uni('uSnowline', 1500); uni('uTreeline', 1450); uni('uSeason', 0.4);
    uni('uInvViewProj', this.invViewProj); uni('uViewProj', this.viewProj); uni('uPrevViewProj', this.prevViewProj);
    uni('uFrame', 0); uni('uHeightTex', null); uni('uFlowTex', null); uni('uShelterTex', null);
    uni('uSceneTex', null); uni('uDepthTex', null); uni('uCloudTex', null); uni('uCloudAux', null);
    uni('uOpaqueTex', null); uni('uOpaqueDepth', null); uni('uResolution', this.size);

    this.setSeed(this.dials.seed, true);
    this.atmos = new Atmosphere(r, ...this.quality.sim);
    this.sky = new Sky(r);
    this.land = new Land(r, this.quality.terrain);
    this.trees = new Trees(this.quality.trees);
    this.water = new Water(r);
    this.clouds = new Clouds(r);
    this.post = new Post(r);
    this.scene = new THREE.Scene();
    this.scene.add(this.land.group, this.trees.mesh);
    this.overlay = new THREE.Scene();          // helper lines (camera path preview)
    this.showOverlay = false;
  }

  setSeed(seed, force = false) {
    seed = Math.round(seed);
    if (!force && seed === this.seed) return;
    this.seed = seed; this.dials.seed = seed;
    const n = 1024;
    this.heightN = n;
    this.height = generateHeightmap(seed, n);
    const texels = buildTerrainTexels(this.height, n);
    const flow = solveFlow(this.height, n, 128);
    const mk = (data, size, old) => {
      let d = data, type = THREE.FloatType;
      if (!this.floatLinear) { d = new Uint16Array(data.length); for (let i = 0; i < d.length; i++) d[i] = THREE.DataUtils.toHalfFloat(data[i]); type = THREE.HalfFloatType; }
      const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat, type);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
      t.needsUpdate = true;
      if (old) old.dispose();
      return t;
    };
    this.heightTex = mk(texels, n, this.heightTex);
    this.flowTex = mk(flow.texels, 128, this.flowTex);
    this.shelterTex = mk(buildShelterTexels(this.height, n, 256), 256, this.shelterTex);
    uni('uHeightTex').value = this.heightTex; uni('uFlowTex').value = this.flowTex;
    uni('uShelterTex').value = this.shelterTex;
    if (this.atmos) this.atmos.reset();
    if (this.land) this.land.lastDir.set(0, 0, 0);
    this.findLandmarks();
  }

  // Summits (for orbit shots and the drifting autopilot) and the line of the inlet.
  findLandmarks() {
    const n = this.heightN, H = this.height, L = WORLD.size, B = 64, cand = [];
    for (let bj = 0; bj < n; bj += B) for (let bi = 0; bi < n; bi += B) {
      let best = -1e9, at = 0;
      for (let j = bj; j < bj + B; j++) for (let i = bi; i < bi + B; i++) { const h = H[i + j * n]; if (h > best) { best = h; at = i + j * n; } }
      const i = at % n, j = (at / n) | 0;
      if (i < 40 || j < 40 || i > n - 40 || j > n - 40) continue;
      cand.push([((i + 0.5) / n - 0.5) * L, best, ((j + 0.5) / n - 0.5) * L]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    this.peaks = [];
    for (const c of cand) {
      if (this.peaks.length >= 8 || c[1] < 900) break;
      if (this.peaks.every((p) => Math.hypot(p[0] - c[0], p[2] - c[2]) > 2200)) this.peaks.push(c);
    }
    // deepest water along each north-south line: the centreline of the inlet, west to east
    this.inlet = [];
    for (let x = -7000; x <= 7000; x += 500) {
      let bz = 0, best = 1e9;
      for (let z = -6500; z <= 6500; z += 100) { const h = this.heightAt(x, z, true) + Math.abs(z) * 0.004; if (h < best) { best = h; bz = z; } }
      if (best < 0) this.inlet.push([x, 0, bz]);
    }
  }

  // CPU terrain height (bilinear, mirrored outside the square), clamped to sea level.
  heightAt(x, z, raw = false) {
    const n = this.heightN, L = WORLD.size;
    const mir = (u) => { u = ((u % 2) + 2) % 2; return u > 1 ? 2 - u : u; };
    const fx = mir(x / L + 0.5) * n - 0.5, fz = mir(z / L + 0.5) * n - 0.5;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(fx))), j0 = Math.max(0, Math.min(n - 1, Math.floor(fz)));
    const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
    const tx = Math.min(1, Math.max(0, fx - i0)), tz = Math.min(1, Math.max(0, fz - j0));
    const h = this.height;
    const v = (h[i0 + j0 * n] * (1 - tx) + h[i1 + j0 * n] * tx) * (1 - tz) + (h[i0 + j1 * n] * (1 - tx) + h[i1 + j1 * n] * tx) * tz;
    return raw ? v : Math.max(0, v);
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name; this.quality = QUALITY[name];
    const q = this.quality;
    if (this.atmos.nx !== q.sim[0] || this.atmos.ny !== q.sim[2]) this.atmos.resize(...q.sim);
    this.land.setDetail(q.terrain);
    this.trees.setDensity(q.trees);
    this.setSize(this.cssW, this.cssH, this.dpr, this.fixed);
  }

  // Output size. If fixed = [w, h], render exactly that many pixels (recording / stills).
  setSize(cssW, cssH, dpr = 1, fixed = null) {
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr; this.fixed = fixed;
    const q = this.quality;
    let w, h;
    if (fixed) { w = fixed[0]; h = fixed[1]; }
    else {
      // device pixels, capped by the tier's pixel budget so a huge window costs no more than a 1080p one
      let s = Math.min(dpr, q.maxDpr) * q.scale;
      s = Math.min(s, Math.sqrt(q.maxPixels / Math.max(1, cssW * cssH))) * (this.userScale || 1) * (this.autoScale || 1);
      w = Math.round(cssW * s); h = Math.round(cssH * s);
    }
    w = Math.max(64, w & ~1); h = Math.max(64, h & ~1);
    if (w === this.size.x && h === this.size.y && this.sceneRT) return;
    this.size.set(w, h);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    for (const t of [this.sceneRT, this.mergedRT]) if (t) { t.depthTexture.dispose(); t.dispose(); }
    const mk = () => {
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
      rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;
      return rt;
    };
    this.sceneRT = mk(); this.mergedRT = mk();
    this.post.resize(w, h);
    this.clouds.resize(w * q.cloudScale, h * q.cloudScale);
    this.camera.aspect = w / h;
  }

  setDial(k, v) {
    if (!(k in this.dials)) return;
    this.dials[k] = clampDial(k, Number(v));
    if (k === 'seed') this.setSeed(this.dials.seed);
  }
  setDials(obj) { for (const k of DIAL_KEYS) if (k in obj) this.setDial(k, obj[k]); }

  updateEnvironment(dt) {
    const d = this.dials;
    if (d.daySpeed > 0 && dt > 0) d.time = (d.time + d.daySpeed / 60 * dt) % 24;
    const L = this.light = lighting(d.time, d.season, d.haze);
    uni('uSunDir').value.fromArray(L.sun); uni('uMoonDir').value.fromArray(L.moon);
    uni('uLightDir').value.fromArray(L.lightDir).normalize();
    uni('uLightCol').value.fromArray(L.lightCol); uni('uSunCol').value.fromArray(L.sunCol);
    uni('uMoonCol').value.fromArray(L.moonCol);
    const high = transmittance(L.sunEl + 0.035, d.haze * 0.3, 9000);
    uni('uSunColHigh').value.set(high[0] * 22, high[1] * 22, high[2] * 22);
    uni('uNight').value = L.night;
    uni('uMoonFade').value = Math.max(0, Math.min(1, (-L.sunEl * 57.3 - 3) / 5));
    const a = d.windDir * Math.PI / 180;
    uni('uWind').value.set(-Math.sin(a) * d.windSpeed, Math.cos(a) * d.windSpeed);
    uni('uT0').value = d.temperature; uni('uMoisture').value = d.moisture; uni('uCloudBase').value = d.cloudBase;
    uni('uInversion').value = d.inversion; uni('uPrecip').value = d.precip; uni('uHaze').value = d.haze;
    uni('uHighCloud').value = d.highCloud; uni('uSeason').value = d.season;
    this.snowline = uni('uSnowline').value = Math.max(-200, d.temperature / 0.006 - 250);
    uni('uTreeline').value = 1450;
    // faster relaxation while the weather dials are moving, so changes show within seconds
    let change = 0;
    if (this.lastWeather) for (const k of WEATHER_KEYS) {
      let dv = Math.abs(d[k] - this.lastWeather[k]);
      if (k === 'windDir') dv = Math.min(dv, 360 - dv) / 90; else if (k === 'cloudBase') dv /= 800; else if (k === 'temperature') dv /= 8; else if (k === 'windSpeed') dv /= 10;
      change += dv;
    }
    this.lastWeather = Object.fromEntries(WEATHER_KEYS.map((k) => [k, d[k]]));
    this.nudgeBoost = Math.min(1, this.nudgeBoost * Math.exp(-dt / 2.5) + change * 2.5);
    this.env = {
      sst: 8 + 6 * (0.5 - 0.5 * Math.cos(2 * Math.PI * (d.season - 0.08))),
      sunPower: Math.max(0, Math.min(1, L.sun[1] * 1.6)),
      nightCool: Math.max(0, Math.min(1, (20 - L.sunEl * 57.2958) / 14)),   // night chill holds through sunrise and fades as the sun climbs
      nudge: 1 / 3500 + this.nudgeBoost / 140,
    };
  }

  // Advance and draw one frame. dt is real seconds of wall/video time.
  frame(dt, opts = {}) {
    const r = this.renderer, cam = this.camera, q = this.quality;
    dt = Math.min(dt, 0.1);
    this.updateEnvironment(dt);
    this.skyTime += dt; uni('uSkyTime').value = this.skyTime;
    uni('uFrame').value = this.frameIndex % 1024;

    this.atmos.step(opts.freeze ? 0 : dt * this.dials.weatherSpeed, this.env, !!(opts.freeze || opts.exact || this.exactSim || this.frameIndex < 4));
    this.land.updateShadow();

    const ground = this.heightAt(cam.position.x, cam.position.z);
    cam.near = Math.max(0.6, Math.min(25, (cam.position.y - ground) * 0.2));
    cam.far = 220000; cam.fov = this.dials.fov;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.invViewProj.copy(this.viewProj).invert();
    uni('uCamPos').value.copy(cam.position);
    if (this.frameIndex === 0) this.prevViewProj.copy(this.viewProj);

    const L = this.light;
    this.sky.update(22, L.moonCol[2] > 0 ? 0.05 * uni('uMoonFade').value : 0, cam.position.y);

    this.trees.update(cam);
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, cam);
    uni('uOpaqueTex').value = this.sceneRT.texture; uni('uOpaqueDepth').value = this.sceneRT.depthTexture;
    this.water.render(this.mergedRT);
    if (this.showOverlay && this.overlay.children.length) { r.autoClear = false; r.setRenderTarget(this.mergedRT); r.render(this.overlay, cam); r.autoClear = true; }
    uni('uSceneTex').value = this.mergedRT.texture; uni('uDepthTex').value = this.mergedRT.depthTexture;

    this.clouds.render(q);
    const d = this.dials;
    const ex0 = 0.62 * L.autoExposure;
    this.post.render(this.clouds.res, {
      exposure: ex0 * Math.pow(2, d.exposure), exposure0: ex0, key: 0.2 - 0.12 * L.night,
      adaptRate: dt > 0 ? 1 - Math.exp(-dt * 1.4) : 0.5,
      contrast: d.contrast, saturation: d.saturation, warmth: d.warmth,
    }, opts.target || null);
    this.prevViewProj.copy(this.viewProj);
    this.frameIndex++;
  }
}
