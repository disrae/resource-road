// Developer page: build the world with no game on top, so the look can be tuned and stills taken.
// Not linked from the game. Usage from the console or an automation script:
//   await __look.snap('name', { s: 100, env: 'night' })   -> saves shots/tmp/name.png via the dev server
import { createWorld } from '../game/world/world.js';
import { SCENARIO } from '../game/scenario.js';
import { uni } from '../engine/gl/common.js';
import * as vehicles from '../game/world/vehicles.js';
import * as props from '../game/world/props.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const t0 = performance.now();
const world = createWorld(canvas, q.get('q') || 'high', SCENARIO);
const kit = { pickup: null, truck: null, props: null };
try { kit.props = props.buildProps(world); } catch (e) { console.error('props', e); }
try { kit.pickup = vehicles.createPickup(world); kit.truck = vehicles.createLogTruck(world); } catch (e) { console.error('vehicles', e); }
world.setSurfaces(['mud', 'sound', 'rock']);
console.log('world built in', Math.round(performance.now() - t0), 'ms');

const state = { s: 60, u: 0, h: 1.5, yaw: 0, pitch: -0.03, env: 'night', lights: true, pickup: null, truck: null, cam: null };
function apply(o = {}) {
  Object.assign(state, { pickup: null, truck: null, cab: false }, o);
  if (o.env) world.setEnv(state.env);
  if (o.dials) world.engine.setDials(o.dials);
  if (o.vis != null) world.setFog(o.vis);                       // fog visibility in metres, 0 = no fog
  if (o.over) { const w = world.route.toWorld(o.over[0], o.over[1] || 0); state.cam = [w[0], w[1] + o.over[2], w[2], 0, -Math.PI / 2 + 0.001]; }
  else if (!o.cam) state.cam = null;
  if (state.cam) { const c = state.cam; world.engine.camera.position.set(c[0], c[1], c[2]); world.engine.camera.rotation.set(c[4] || 0, c[3] || 0, 0, 'YXZ'); }
  else world.view(state.s, state.u, state.h, state.yaw, state.pitch);
  world.lightsOff();
  if (kit.pickup) kit.pickup.place(state.pickup ? { ...state.pickup } : { s: state.s, u: state.u, hidden: !state.showPickup }, state.lights && world.night);
  else if (state.lights && world.night) {
    const f = world.route.frame(state.s), w = world.route.toWorld(state.s, state.u), dir = [f.tx, -0.07 - f.grade * -1, f.tz];
    world.setSpot(0, [w[0] + f.tz * 0.7, w[1] + 0.95, w[2] - f.tx * 0.7], dir, 60, 26);
    world.setSpot(1, [w[0] - f.tz * 0.7, w[1] + 0.95, w[2] + f.tx * 0.7], dir, 60, 26);
  }
  if (o.cab != null) state.cab = o.cab;
  if (state.cab && kit.pickup) { kit.pickup.place({ s: state.s, u: state.u, view: 'cab', ...(state.pickup || {}) }, state.lights && world.night); kit.pickup.cabCamera(world.engine.camera, state.yaw, state.pitch); }
  if (kit.truck) kit.truck.place(state.truck ? { ...state.truck } : { hidden: true }, world.night);
}
async function settle(n = 10) { for (let i = 0; i < n; i++) world.frame(1 / 30); }
async function snap(name, o = {}, w = 1280, h = 720) {
  world.resize(w, h, 1, [w, h]); apply(o); await settle(o.frames || 14);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  const res = await fetch('/__save?name=' + encodeURIComponent(name + '.jpg'), { method: 'POST', body: blob });
  return res.text();
}
// several views on one contact sheet: sheet('name', [{...}, {...}], 2)
async function sheet(name, list, cols = 2, w = 640, h = 360) {
  const rows = Math.ceil(list.length / cols), cv = document.createElement('canvas'); cv.width = cols * w; cv.height = rows * h;
  const g = cv.getContext('2d');
  for (let i = 0; i < list.length; i++) {
    world.resize(w, h, 1, [w, h]); apply(list[i]); await settle(list[i].frames || 14);
    g.drawImage(canvas, (i % cols) * w, Math.floor(i / cols) * h);
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  return (await fetch('/__save?name=' + encodeURIComponent(name + '.jpg'), { method: 'POST', body: blob })).text();
}
function bench(n = 60) {
  const gl = world.engine.gl; const t = performance.now();
  for (let i = 0; i < n; i++) world.frame(1 / 60);
  gl.finish(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return (performance.now() - t) / n;
}
window.__look = { world, state, apply, snap, sheet, settle, bench, uni, kit };
world.resize(innerWidth, innerHeight, devicePixelRatio);
apply({ env: q.get('env') || 'night', s: Number(q.get('s') || 60) });
let last = performance.now();
function loop(t) { const dt = Math.min(0.1, (t - last) / 1000); last = t; if (!window.__paused) { apply(); world.frame(dt); } requestAnimationFrame(loop); }
requestAnimationFrame(loop);
