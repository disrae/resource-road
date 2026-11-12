// The running atmosphere model: ping-ponged 3D state, light volume, statistics.
import * as THREE from '../../vendor/three.module.min.js';
import { Pass, target2D, target3D, pick, uni } from './common.js';
import { SIM_FRAG, LIGHT_FRAG, STATS_FRAG, NOISE_FRAG } from './simShaders.js';
import { WORLD } from '../terrain.js';

const SHARED = ['uHeightTex', 'uFlowTex', 'uWind', 'uSimTime', 'uT0', 'uMoisture', 'uCloudBase', 'uInversion', 'uPrecip'];

export class Atmosphere {
  constructor(renderer, nx = 128, nz = 128, ny = 48) {
    this.renderer = renderer;
    this.resize(nx, nz, ny);
    const grid = { value: this.grid };
    this.simPass = new Pass(SIM_FRAG, {
      ...pick(...SHARED, 'uShelterTex'), uState: { value: null }, uVol: { value: null }, uGrid: grid,
      uS: { value: 0 }, uLayer: { value: 0 }, uDt: { value: 1 }, uReset: { value: 0 }, uNudge: { value: 1 / 1200 },
      uSST: { value: 10 }, uSunPower: { value: 0 }, uNightCool: { value: 0 }, uSunDir: uni('uSunDir', new THREE.Vector3(0, 1, 0)),
    });
    this.lightPass = new Pass(LIGHT_FRAG, {
      ...pick(...SHARED), uState: { value: null }, uGrid: grid, uS: { value: 0 }, uLayer: { value: 0 },
      uExtK: uni('uExtK', 0.011), uLightDir: uni('uLightDir', new THREE.Vector3(0, 1, 0)),
    });
    this.statsPass = new Pass(STATS_FRAG, { ...pick(...SHARED), uState: { value: null }, uGrid: grid, uPick: { value: -1 } });
    this.simTime = 0;
    this.steps = 0;
    this.makeNoise();
    uni('uNoiseTex', this.noise.texture);
  }

  resize(nx, nz, ny) {
    for (const t of [this.a, this.b, this.vol, this.statsRT]) if (t) t.dispose();
    this.nx = nx; this.nz = nz; this.ny = ny;
    this.grid = this.grid || new THREE.Vector3();
    this.grid.set(nx, nz, ny);
    this.a = target3D(nx, nz, ny, THREE.ClampToEdgeWrapping);
    this.b = target3D(nx, nz, ny, THREE.ClampToEdgeWrapping);
    this.vol = target3D(nx, nz, ny, THREE.MirroredRepeatWrapping);
    this.statsRT = target2D(nx, nz, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.statsBuf = new Float32Array(nx * nz * 4);
    uni('uVolTex', this.vol.texture);
    uni('uGrid', this.grid);
    this.needsReset = true;
  }

  makeNoise() {
    const n = 64;
    this.noise = new THREE.WebGL3DRenderTarget(n, n, n, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });
    const t = this.noise.texture;
    t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    const pass = new Pass(NOISE_FRAG, { uZ: { value: 0 } });
    for (let k = 0; k < n; k++) {
      pass.uniforms.uZ.value = (k + 0.5) / n;
      pass.render(this.renderer, this.noise, k);
    }
    pass.material.dispose();
  }

  // parity 0 / 1: only the even / odd layers (the light volume is refreshed half at a time).
  runLayers(pass, src, dst, parity = -1) {
    pass.uniforms.uState.value = src.texture;
    for (let k = 0; k < this.ny; k++) {
      if (parity >= 0 && (k & 1) !== parity) continue;
      pass.uniforms.uS.value = (k + 0.5) / this.ny;
      pass.uniforms.uLayer.value = k;
      pass.render(this.renderer, dst, k);
    }
  }

  // env: { sst, sunPower, nightCool, nudge }. exact = false spreads the light volume over two
  // frames (alternate layers), which is invisible live; recording and tests pass exact = true.
  step(dt, env, exact = true) {
    const u = this.simPass.uniforms;
    u.uVol.value = this.vol.texture;
    u.uSST.value = env.sst; u.uSunPower.value = env.sunPower; u.uNightCool.value = env.nightCool;
    u.uNudge.value = env.nudge;
    if (this.needsReset) {
      u.uReset.value = 1; u.uDt.value = 0;
      this.runLayers(this.simPass, this.b, this.a);
      u.uReset.value = 0;
      this.needsReset = false;
    }
    if (dt > 0) {
      u.uDt.value = dt;
      this.simTime += dt;
      uni('uSimTime').value = this.simTime;
      this.runLayers(this.simPass, this.a, this.b);
      const t = this.a; this.a = this.b; this.b = t;
      this.steps++;
    }
    this.phase = (this.phase | 0) ^ 1;
    this.runLayers(this.lightPass, this.a, this.vol, exact ? -1 : this.phase);
  }

  reset() { this.needsReset = true; this.simTime = 0; uni('uSimTime').value = 0; }

  // Horizontal means per model layer, split into sea and land columns (debugging / tests).
  // seaMask: Uint8Array(nx*nz) with 1 over water.
  profile(seaMask) {
    const rows = [], b = this.statsBuf, n = this.nx * this.nz;
    this.statsPass.uniforms.uState.value = this.a.texture;
    for (let k = 0; k < this.ny; k++) {
      this.statsPass.uniforms.uPick.value = k;
      this.statsPass.render(this.renderer, this.statsRT);
      this.renderer.readRenderTargetPixels(this.statsRT, 0, 0, this.nx, this.nz, b);
      const acc = { sea: [0, 0, 0, 0, 0], land: [0, 0, 0, 0, 0] };
      for (let i = 0; i < n; i++) {
        const a = seaMask && seaMask[i] ? acc.sea : acc.land;
        a[0] += b[i * 4]; a[1] += b[i * 4 + 1]; a[2] += b[i * 4 + 2]; a[3] += b[i * 4 + 3]; a[4]++;
      }
      const f = (a) => a[4] ? a.slice(0, 4).map((v) => +(v / a[4]).toFixed(3)) : null;
      rows.push({ k, agl: Math.round(Math.pow((k + 0.5) / this.ny, 1.6) * WORLD.top), sea: f(acc.sea), land: f(acc.land) });
    }
    this.statsPass.uniforms.uPick.value = -1;
    return rows;
  }

  // Reads back column integrals. Slow (GPU readback): for tests and the debug overlay only.
  stats() {
    this.statsPass.uniforms.uState.value = this.a.texture;
    this.statsPass.render(this.renderer, this.statsRT);
    this.renderer.readRenderTargetPixels(this.statsRT, 0, 0, this.nx, this.nz, this.statsBuf);
    const b = this.statsBuf, n = this.nx * this.nz;
    let cw = 0, tw = 0, pw = 0, bad = 0, cover = 0, fin = true, maxCw = 0;
    for (let i = 0; i < n; i++) {
      const c = b[i * 4], t = b[i * 4 + 1], p = b[i * 4 + 2];
      if (!Number.isFinite(c) || !Number.isFinite(t) || !Number.isFinite(p)) { fin = false; continue; }
      cw += c; tw += t; pw += p; bad += b[i * 4 + 3];
      if (c > 40) cover++;
      if (c > maxCw) maxCw = c;
    }
    const cell = (WORLD.size / this.nx) * (WORLD.size / this.nz) * 1e-3;   // g/kg*m -> ~kg/m2 * area
    return {
      cloudWater: cw * cell, totalWater: tw * cell, precipWater: pw * cell,
      cloudCover: cover / n, maxColumnCloud: maxCw, badCells: bad, finite: fin && bad === 0,
      simTime: this.simTime, steps: this.steps, grid: [this.nx, this.nz, this.ny],
    };
  }
}
