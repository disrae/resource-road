// The game itself: builds the world, runs one run at a time through the pure rules (rules/run.js),
// moves the cameras and vehicles, and passes everything the rules say to the screen, the speakers
// and the reporting seam (report.js). All timing is driven by the frame's dt, so a whole run can be
// stepped without a clock (see window.__game.advance, used by the automated playthroughs).
//
// Link options:  ?s=CODE session code   ?q=light|balanced|high|film graphics level for everyone   ?mute=1   ?voice=0
//                ?debug=1 (log events, show numbers)   ?auto=good|mud|rock|late|nearmiss|wrongcalls|careless
//                ?speed=N (time multiplier, for testing)   ?manual=1 (no frame loop: step with __game.advance)
import * as THREE from '../vendor/three.module.min.js';
import { SCENARIO } from './scenario.js';
import { createWorld, LEVELS, levelName } from './world/world.js';
import { loadGroundTextures } from './render/textures.js';
import { buildProps } from './world/props.js';
import { createPickup, createLogTruck } from './world/vehicles.js';
import { makePlan } from './rules/plan.js';
import { createRun } from './rules/run.js';
import { createBot, POLICIES } from './rules/bot.js';
import { createGovernor, RUNGS } from './quality.js';
import { createRunReporter, events, status, setDebug, onReport } from './report.js';
import { sessionFromLink, playerId, seedFor, randomId } from './session.js';
import { createUI, LABELS } from './ui.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createFilm } from './film.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const Q = new URLSearchParams(location.search);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return localStorage.getItem(k) === v; } catch (e) { return false; } },
  getItem(k) { return localStorage.getItem(k); }, setItem(k, v) { localStorage.setItem(k, v); },
};
const S = SCENARIO, R = S.road, TX = S.text;
const DEBUG = Q.get('debug') === '1';
setDebug(DEBUG);
document.title = S.title;

// ---- which graphics level --------------------------------------------------------------------
const LEVEL_ORDER = ['light', 'balanced', 'high'];        // the levels meant for play, lightest first
function guessLevel() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2'); if (!gl) return 'light';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String((ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || '');
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    if (/swiftshader|llvmpipe|software|basic render/i.test(r)) return 'light';
    if (/apple m\d+ (pro|max|ultra)|rtx|radeon rx|gtx (1[06]|9[78])/i.test(r)) return 'high';
    if (/apple m\d|apple gpu|geforce|radeon pro|arc\b/i.test(r)) return 'balanced';
    if (/intel|uhd|iris|mali|adreno|powervr|radeon|amd/i.test(r)) return 'light';
    return 'balanced';
  } catch (e) { return 'light'; }
}
// Graphics are automatic unless the link pins a level for everyone (?q=light|balanced|high|film) or
// the player picks one on the title screen (G). Automatic: a starting level is guessed from the
// graphics chip (that decides which images are downloaded), then the controller in quality.js keeps
// adjusting all the way through the run. A pinned or picked level never goes above its own
// starting quality, but still steps down if the frame rate becomes unplayable. Film never adapts.
// ?tier=LEVEL starts on that level and stays automatic (for testing the controller).
const linkLevel = levelName(Q.get('q')), startLevel = levelName(Q.get('tier'));
const pickedLevel = linkLevel || startLevel ? null : levelName(store.get('rr.gfx'));
const AUTO = !linkLevel && !pickedLevel;
const tierName = linkLevel || startLevel || pickedLevel || levelName(store.get('rr.autoTier')) || guessLevel();
const LEVEL = LEVELS[tierName];
const GFX_ORDER = ['auto', 'high', 'balanced', 'light'];

// ---- boot ---------------------------------------------------------------------------------------
const canvas = document.getElementById('view'), uiRoot = document.getElementById('ui');
const ui = createUI(uiRoot, S);
ui.showLoading();
const session = sessionFromLink(location.search, location.hash), pid = playerId(store);
const audio = createAudio({ muted: Q.get('mute') === '1' || store.get('rr.mute') === '1', voice: Q.get('voice') !== '0' });
const dbg = document.createElement('pre'); dbg.className = 'dbg'; if (DEBUG) document.body.append(dbg);

const paint = () => new Promise((r) => setTimeout(r, 40));     // lets the loading screen draw before heavy work
ui.setLoading(0.04, LABELS.loadingGround);
await paint();
const textures = Q.get('tex') === '0' ? null : await loadGroundTextures(LEVEL.tex, (done, n) => ui.setLoading(0.04 + 0.66 * done / n, LABELS.loadingGround), LEVEL.aniso);
ui.setLoading(0.72, LABELS.loading);
await paint();
let world, pickup, truck, props;
try {
  world = createWorld(canvas, tierName, S, Q.get('cond'), textures);
  props = buildProps(world); pickup = createPickup(world); truck = createLogTruck(world);
} catch (e) {
  console.error(e);
  uiRoot.innerHTML = '<div class="screen loading show"><div class="title-box"><h1></h1><p class="sub"></p></div></div>';
  uiRoot.querySelector('h1').textContent = S.title;
  uiRoot.querySelector('p').textContent = 'This game needs a browser with WebGL 2 (a current Chrome, Edge, Firefox or Safari).';
  throw e;
}
const engine = world.engine, cam = engine.camera, route = world.route;
const road = { ...route, sMin: -58 };
const START = { s: S.layout.start.s, u: S.layout.start.u, yaw: 0.1, steer: 0, spin: 0, v: 0, off: 0 };

const G = {
  scene: 'title',            // title | run | summary
  run: null, plan: null, reporter: null, bot: null, summary: null,
  clock: 0, trans: null, nextCard: null, cardAt: 0, uiHold: false, paused: false,
  view: store.get('rr.view') === 'chase' ? 'chase' : 'cab',
  lookYaw: 0, lean: 0, dive: 0, sink: 0, prevV: 0, spinExtra: 0, truckSpin: 0, truckTrail: -0.15,
  radioQ: [], radioAt: 0, autoAt: 0, botName: Q.get('auto'), manual: Q.get('manual') === '1', speed: clamp(Number(Q.get('speed')) || 1, 0.1, 20),
  input: { throttle: 0, brake: 0, steer: 0 },
};
const perf = { ms: 16, slowTitle: 0 };
const gov = createGovernor({ start: LEVEL.rung, best: AUTO ? 0 : LEVEL.rung });
if (LEVEL.offline) gov.lock(LEVEL.rung);

function resize() { world.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1); }
window.addEventListener('resize', resize);
resize();

// ---- cameras --------------------------------------------------------------------------------------
// Walk-around stations, in the pickup's own space (+X forward, +Y up, +Z right). `radio` is set from
// the road entrance sign once the pickup is parked.
const STATIONS = {
  title: { pos: [5.6, 1.75, 4.6], look: [0, 1.25, -3], fov: 46 },
  intro: { pos: [7.6, 2.0, 3.0], look: [0, 1.15, -1.5], fov: 50 },
  front: { pos: [6.6, 1.3, -1.1], look: [2.9, 1.0, 0], fov: 46 },
  wheel: { pos: [2.7, 0.75, -3.3], look: [1.85, 0.45, -0.9], fov: 46 },
  box: { pos: [-4.7, 3.0, 1.5], look: [-1.8, 1.0, 0.2], fov: 48 },
  spare: { pos: [-2.5, 2.35, -2.5], look: [-1.3, 1.28, -0.45], fov: 44 },
  radio: { pos: [19, 1.9, 8.7], look: [26, 2.2, 11], fov: 40 },
};
const rig = { name: null, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50, p0: new THREE.Vector3(), l0: new THREE.Vector3(), f0: 50, t: 1, dur: 1 };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4();
function rigGo(name, dur = 1.0) {
  if (rig.name === name) return;
  const first = rig.name == null; rig.name = name;
  rig.p0.copy(rig.pos); rig.l0.copy(rig.look); rig.f0 = rig.fov; rig.dur = Math.max(0.01, dur); rig.t = first || dur <= 0 ? 1 : 0;
}
function rigUpdate(dt) {
  const st = STATIONS[rig.name] || STATIONS.title;
  rig.t = Math.min(1, rig.t + dt / rig.dur);
  const k = rig.t * rig.t * (3 - 2 * rig.t), g = st.pos;
  // walk round the truck rather than through it: blend angle, distance and height about the truck
  const a0 = Math.atan2(rig.p0.z, rig.p0.x), r0 = Math.hypot(rig.p0.x, rig.p0.z);
  let a1 = Math.atan2(g[2], g[0]); const r1 = Math.hypot(g[0], g[2]);
  while (a1 - a0 > Math.PI) a1 -= Math.PI * 2; while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
  let ang = lerp(a0, a1, k); const rad = lerp(r0, r1, k) + Math.sin(Math.PI * k) * 0.9 * Math.min(1, Math.abs(a1 - a0));
  if (rig.name === 'title') ang += Math.sin(G.clock * 0.09) * 0.1;
  rig.pos.set(Math.cos(ang) * rad, lerp(rig.p0.y, g[1], k), Math.sin(ang) * rad);
  rig.look.set(lerp(rig.l0.x, st.look[0], k), lerp(rig.l0.y, st.look[1], k), lerp(rig.l0.z, st.look[2], k));
  rig.fov = lerp(rig.f0, st.fov, k);
  if (rig.t >= 1) { rig.p0.set(g[0], g[1], g[2]); rig.l0.set(st.look[0], st.look[1], st.look[2]); rig.f0 = st.fov; }
  pickup.point(rig.pos.x, rig.pos.y, rig.pos.z, _a); pickup.point(rig.look.x, rig.look.y, rig.look.z, _b);
  cam.position.copy(_a); cam.up.set(0, 1, 0); cam.lookAt(_b);
  engine.setDial('fov', rig.fov);
}
function setRadioStation() {
  const sign = props.signs.entry, p = route.toWorld(sign.s - 9, 2.0), q = route.toWorld(sign.s, sign.u);
  _m.copy(pickup.group.matrixWorld).invert();
  _a.set(p[0], p[1] + 1.85, p[2]).applyMatrix4(_m); _b.set(q[0], q[1] + 2.2, q[2]).applyMatrix4(_m);
  STATIONS.radio.pos = [_a.x, _a.y, _a.z]; STATIONS.radio.look = [_b.x, _b.y, _b.z];
}
// how the road bends ahead: positive = to the right
function bendAhead(s, d) {
  const f0 = route.frame(s), f1 = route.frame(Math.min(route.sMax - 1, s + d));
  return (f1.tx - f0.tx) * -f0.tz + (f1.tz - f0.tz) * f0.tx;
}

// ---- a run ---------------------------------------------------------------------------------------
function faultNow(id) { const st = G.run && G.run.state; return G.scene === 'run' && !!(G.plan && G.plan.faults[id] && !(st && st.fixed[id])); }
function newRun() {
  const seed = seedFor(session);
  G.plan = makePlan(S, seed);
  G.run = createRun(S, G.plan, road);
  G.reporter = createRunReporter({ session, playerId: pid, runId: 'r_' + randomId(10) });
  G.reporter.start({ scenarioId: S.id, seed, tier: tierName, plan: { faults: G.plan.faults, surfaces: G.plan.surfaces } });
  G.bot = POLICIES[G.botName] ? createBot(G.botName, road) : null;
  world.setSurfaces(G.plan.surfaces);
  if (world.env !== 'stage') world.setEnv('stage');
  Object.assign(G, { summary: null, trans: null, nextCard: null, uiHold: false, paused: false, lookYaw: 0, lean: 0, dive: 0, sink: 0, prevV: 0, spinExtra: 0, radioQ: [], truckTrail: -0.15 });
  ui.closeCard(); ui.setFade(0); ui.setInter(''); ui.setHud({ show: false });
}
function begin() {
  audio.unlock();
  ui.hideScreen(); newRun(); G.scene = 'run';
  rigGo('intro', 1.3); pump();
}
function queueCard(p) {
  const delay = G.film ? 0 : p.kind === 'inspect' ? 1.4 : p.kind === 'heard' ? 0.9 : p.kind === 'debrief' ? 0.6 : 0.2;
  G.nextCard = { p, at: G.clock + delay };
  if (p.kind === 'inspect') rigGo(p.view, 1.25);
}
function showCard(p) { ui.showCard(p); input.clear(); G.cardAt = G.clock; G.autoAt = G.clock + (G.film ? 0 : Number(Q.get('autodelay')) || 1.3); }
function handle(ev) {
  const st = G.run.state;
  if (ev.type === 'decision') G.reporter.decision(ev);
  else if (ev.type === 'ask') queueCard(ev.pending);
  else if (ev.type === 'toast') { ui.toast(ev.text, ev.tone); if (ev.tone !== 'info') audio.sfx(ev.tone); }
  else if (ev.type === 'inspectResult') { ui.toast(ev.text, ev.tone); audio.sfx(ev.tone === 'good' ? 'good' : 'click'); }
  else if (ev.type === 'radio') G.radioQ.push(ev);
  else if (ev.type === 'phase') { if (ev.phase === 'drive') G.trans = { kind: 'toNight', t: 0 }; }
  else if (ev.type === 'answer') { G.uiHold = true; G.nextCard = { p: { kind: 'feedback', safe: ev.safe, text: ev.text, options: [{ id: 'next', text: TX.continue }] }, at: G.clock + 0.15 }; audio.sfx(ev.safe ? 'good' : 'bad'); }
  else if (ev.type === 'sfx') audio.sfx(ev.name);
  else if (ev.type === 'waiting') ui.toast(ev.text, 'info');
  else if (ev.type === 'resume') { if (ev.cut) { G.trans = { kind: 'cutIn', t: 0 }; G.sink = 0; G.lean = 0; G.dive = 0; } ui.toast(ev.text, 'info'); }
  else if (ev.type === 'end') { G.summary = ev.summary; G.reporter.end(ev.summary); G.trans = { kind: 'toSummary', t: 0 }; }
  void st;
}
function pump() { if (G.run) for (const ev of G.run.drain()) handle(ev); }
ui.onAnswer = (choice, p) => {
  audio.sfx('click');
  if (p.kind === 'feedback') { G.uiHold = false; return; }
  if (p.kind === 'pause') {
    G.paused = false;
    if (choice === 'restart') begin();
    else if (choice === 'sound') { toggleMute(); openPause(); }
    return;
  }
  G.run.submit(choice, (G.clock - G.cardAt) * 1000); pump();
};
function toggleMute() { audio.setMuted(!audio.muted); store.set('rr.mute', audio.muted ? '1' : '0'); }
function openPause() {
  G.paused = true;
  showCard({ kind: 'pause', options: [{ id: 'resume', text: LABELS.resume }, { id: 'restart', text: LABELS.restart }, { id: 'sound', text: `${LABELS.sound}: ${audio.muted ? LABELS.off : LABELS.on}` }] });
}
function showTitle() {
  G.scene = 'title'; rig.name = null; rigGo('title', 0);
  ui.showTitle({ session, tierLabel: AUTO ? LABELS.auto : LEVEL.label, pinned: !!linkLevel }, (what) => {
    if (what === 'enter') begin();
    else if (what === 'graphics' && !linkLevel) {
      // the player's own choice; a level pinned by the meeting link cannot be changed here
      const next = GFX_ORDER[(GFX_ORDER.indexOf(AUTO ? 'auto' : tierName) + 1) % GFX_ORDER.length];
      if (store.set('rr.gfx', next)) { const u = new URL(location.href); u.searchParams.delete('tier'); location.replace(u); }
    }
  });
}
const driving = () => G.scene === 'run' && G.run.state.phase === 'drive' && !G.trans && !G.uiHold && !G.paused && !ui.card && !G.nextCard;

const input = createInput(window, (e) => {
  audio.unlock();
  if (ui.key(e)) return true;
  if (e.repeat) return false;
  const k = String(e.key).toLowerCase();
  if (k === 'm') { toggleMute(); ui.toast(`${LABELS.sound}: ${audio.muted ? LABELS.off : LABELS.on}`, 'info'); return true; }
  if (!driving()) return false;
  if (k === 'r') { if (G.run.openCall()) pump(); return true; }
  if (k === 'c') { G.view = G.view === 'cab' ? 'chase' : 'cab'; store.set('rr.view', G.view); return true; }
  if (k === 'enter' || k === ' ') { if (G.run.state.canWait && G.run.waitHere()) pump(); return true; }
  if (k === 'escape') { openPause(); return true; }
  return false;
});
window.addEventListener('pointerdown', () => audio.unlock());

// ---- one frame --------------------------------------------------------------------------------------
function updateTrans(dt) {
  const T = G.trans; if (!T) return;
  T.t += dt;
  if (T.kind === 'toNight') {
    // fade out on the dusk view, a line of text, fade in on the road in the dark
    if (T.t < 1.0) ui.setFade(T.t / 1.0);
    else {
      if (!T.switched) { T.switched = true; world.setEnv('drive'); ui.setFade(1); }
      const a = Math.min(smooth(1.0, 1.5, T.t), 1 - smooth(3.4, 3.9, T.t));
      ui.setInter(T.t < 3.9 ? TX.later : '', a);
      if (T.t > 3.9) ui.setFade(1 - smooth(3.9, 5.2, T.t));
      if (T.t >= 5.2) { ui.setFade(0); ui.setInter(''); G.trans = null; ui.toast(TX.objective, 'info'); }
    }
  } else if (T.kind === 'cutIn') {
    ui.setFade(1 - smooth(0.5, 1.5, T.t)); if (T.t >= 1.5) { ui.setFade(0); G.trans = null; }
  } else if (T.kind === 'toSummary') {
    if (T.t < 1.2) ui.setFade(smooth(0.2, 1.2, T.t));
    else {
      if (!T.switched) {
        T.switched = true; G.scene = 'summary'; world.setEnv('stage'); rig.name = null; rigGo('title', 0); ui.setHud({ show: false }); audio.quiet();
        ui.showSummary(G.summary, { session }, (what) => { if (what === 'enter') begin(); });
      }
      ui.setFade(1 - smooth(1.4, 2.4, T.t)); if (T.t >= 2.4) { ui.setFade(0); G.trans = null; }
    }
  }
}

function stepRun(dt) {
  const run = G.run, st = run.state;
  if (st.phase !== 'drive' || st.pending || G.trans || G.uiHold || G.paused || G.nextCard) { G.input = { throttle: 0, brake: 0, steer: 0 }; return; }
  let inp;
  if (G.bot) {
    const a = G.bot.drive(run); inp = a.input;
    if (a.call && run.openCall()) { pump(); return; }
    if (a.wait && run.waitHere()) { pump(); return; }
  } else inp = input.poll();
  G.input = inp;
  const n = Math.max(1, Math.ceil(dt / (1 / 30)));
  for (let i = 0; i < n && !st.pending && !st.done; i++) run.step(dt / n, inp);
  pump();
}

function placeVehicles(dt) {
  const inRun = G.scene === 'run', st = inRun ? G.run.state : null, c = st ? st.car : START, night = world.env === 'drive';
  const drivePhase = !!st && (st.phase === 'drive' || st.phase === 'done') && night;
  // body movement: dive under braking, lean in corners, a little shake from the gravel
  const acc = dt > 0 ? (c.v - G.prevV) / dt : 0; G.prevV = c.v;
  const lat = c.v * c.v * Math.tan(c.steer || 0) / 3.7, shake = Math.min(1, Math.abs(c.v) / 9) * (1 + 2 * (c.off || 0));
  let leanT = clamp(-lat * 0.011, -0.045, 0.045), diveT = clamp(acc * 0.007, -0.035, 0.028), sinkT = 0;
  if (st && st.stuck) { sinkT = -0.15; leanT += 0.035; }
  if (st && st.damaged) { leanT -= 0.03; diveT -= 0.014; }
  const kf = Math.min(1, dt * 5);
  G.lean += (leanT - G.lean) * kf; G.dive += (diveT - G.dive) * kf; G.sink += (sinkT - G.sink) * Math.min(1, dt * 1.5);
  const bumpL = (Math.sin(c.s * 1.7) * 0.0035 + Math.sin(c.s * 4.3 + 1) * 0.002) * shake, bumpD = Math.sin(c.s * 2.3 + 2) * 0.003 * shake;
  const spinning = st && st.stuck && G.input.throttle > 0 ? 1 : 0;
  G.spinExtra += spinning * dt * 22;
  pickup.faults.lights = faultNow('inspect.lights');
  pickup.faults.tires = faultNow('inspect.tires') || !!(st && st.damaged);
  pickup.faults.load = faultNow('inspect.load');
  const cab = drivePhase && G.view === 'cab' && !G.shot;
  world.lightsOff();
  pickup.place({ s: c.s, u: c.u, yaw: c.yaw, steer: c.steer, spin: (c.spin || 0) + G.spinExtra, lean: G.lean + bumpL, dive: G.dive + bumpD, sink: G.sink,
    brake: G.input.brake > 0 && c.v > 0.2, view: cab ? 'cab' : null }, true);
  pickup.radioLamp.material.uniforms.uPower.value = drivePhase ? (ui.capT ? 1.1 : 0.22) : 0;

  // the logging truck
  const tr = st ? st.truck : null; let gap = null;
  if (tr && tr.active && drivePhase) {
    gap = tr.s - c.s;
    G.truckSpin += tr.v * dt / 0.52; G.truckTrail += (tr.u - G.truckTrail) * Math.min(1, dt * 0.8);
    truck.headPower = lerp(34, 240, smooth(26, 90, gap));     // dipped as it closes, so the cab view is not washed out
    truck.place({ s: tr.s, u: tr.u, uTrail: G.truckTrail, spin: G.truckSpin }, true);
  } else truck.place({ hidden: true }, false);

  // camera
  if (drivePhase) {
    const enc = st.enc;
    let yawT = clamp(bendAhead(c.s, 22) * 0.55, -0.3, 0.3) + (c.steer || 0) * 0.25 - c.yaw * 0.35, pitchT = 0.04;
    // stopped for the truck: watch it come and go by, then look ahead again
    if (tr && tr.active && tr.s - c.s > -7 && (enc === 'waiting' || enc === 'squeeze' || enc === 'passed' || enc === 'after')) {
      yawT = clamp(Math.atan2(tr.u - c.u, Math.max(1.5, tr.s + 2 - c.s)) - c.yaw, -1.3, 0.5); pitchT = 0.04;
    }
    G.lookYaw += (yawT - G.lookYaw) * Math.min(1, dt * 3.2);
    if (G.view === 'cab') { pickup.cabCamera(cam, G.lookYaw, pitchT); engine.setDial('fov', 62); }
    else {
      pickup.point(-8.2, 3.5, 0, _a); pickup.point(7 + Math.cos(G.lookYaw) * 3, 1.0, Math.sin(G.lookYaw) * 6, _b);
      const k = G.chaseInit ? Math.min(1, dt * 7) : 1; G.chaseInit = true;
      cam.position.lerp(_a, k); cam.up.set(0, 1, 0); cam.lookAt(_b); engine.setDial('fov', 58);
    }
  } else { G.chaseInit = false; rigUpdate(dt); }
  if (G.shot) G.shot(dt);                   // a camera placed by hand: film.js and the dev stills

  audio.drive({ on: drivePhase && !G.trans && !G.paused, speed: c.v, throttle: G.input.throttle, off: c.off, spin: spinning, truck: gap });
  return gap;
}

function tick(dt, render = true) {
  G.clock += dt; ui.tick(dt);
  if (G.radioQ.length && G.clock >= G.radioAt) { const ev = G.radioQ.shift(); ui.radioSay(ev.who, ev.text); audio.say(ev.text, ev.who); G.radioAt = G.clock + 2.3; }
  updateTrans(dt);
  if (G.nextCard && G.clock >= G.nextCard.at && !(G.trans && G.trans.kind !== 'cutIn')) { const p = G.nextCard.p; G.nextCard = null; showCard(p); }
  if (G.scene === 'run') stepRun(dt);
  const gap = placeVehicles(dt);
  if (G.scene === 'run') {
    const st = G.run.state, show = st.phase === 'drive' && world.env === 'drive';
    ui.setHud({ show, kmh: Math.abs(st.car.v) * 3.6, channel: st.radio.working ? R.channel : R.wrongChannel, radioOk: st.radio.working, prompt: st.canWait && driving() ? TX.waitPrompt : null });
  }
  // hands-off play (?auto=policy)
  if (POLICIES[G.botName] || G.bot) {
    if (G.scene === 'title' && G.clock > 1.2 && ui.screenKind === 'title') begin();
    else if (ui.card && G.clock >= G.autoAt) {
      const p = ui.card; ui.choose(p.kind === 'feedback' ? 'next' : p.kind === 'pause' ? 'resume' : G.bot ? G.bot.answer(G.run) : null);
    }
  }
  if (DEBUG) {
    const st = G.run && G.run.state;
    dbg.textContent = `${AUTO ? 'auto' : linkLevel ? 'link' : 'picked'} ${tierName} rung ${gov.rung} ${engine.size.x}x${engine.size.y} ${perf.ms.toFixed(1)} ms` + (st ? `\ns ${st.car.s.toFixed(0)} u ${st.car.u.toFixed(1)} v ${(st.car.v * 3.6).toFixed(0)} ${st.phase}/${st.enc}` + (gap != null ? ` gap ${gap.toFixed(0)}` : '') : '');
  }
  if (render) world.frame(Math.min(dt, 0.05));
}

// ---- frame loop, resolution scaling, automatic tier ------------------------------------------------------
function monitor(real) {
  if (document.hidden) return;
  const ms = real * 1000;
  if (ms < 400) perf.ms += (ms - perf.ms) * 0.06;
  const r = gov.sample(ms);
  if (r >= 0) world.setRung(r);
  // last resort, on the title screen only (never during play): already on the bottom rung and still
  // very slow, so reload once on the next lighter level (less terrain detail, smaller images)
  if (AUTO && G.scene === 'title' && tierName !== 'light' && gov.rung === RUNGS.length - 1) {
    perf.slowTitle = gov.ms > 45 ? perf.slowTitle + real : 0;
    if (perf.slowTitle > 3 && store.set('rr.autoTier', LEVEL_ORDER[LEVEL_ORDER.indexOf(tierName) - 1])) location.reload();
  }
}
// The same measuring and adapting without the browser's frame clock, for automation and hidden
// tabs: every frame is drawn, the graphics chip is made to finish, and the real time it took is
// fed to the controller. `load` draws the scene extra times per frame to pretend the machine is slower.
function selfTimed(seconds, o = {}) {
  const gl = engine.renderer.getContext(), px = new Uint8Array(4), seen = [], steps = []; let t = 0, pending = null;
  while (t < seconds) {
    const t0 = performance.now();
    tick(1 / 60, true); for (let i = 0; i < (o.load | 0); i++) world.frame(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let ms = performance.now() - t0; seen.push(ms);
    // the cost of a quality step: the frame before it, the step itself, the first frame after it
    if (pending) { pending.after = +ms.toFixed(1); steps.push(pending); pending = null; }
    if (o.vsync !== false) ms = Math.ceil(ms / 16.667) * 16.667;       // what a 60 Hz screen would show
    t += ms / 1000; const r = gov.sample(ms);
    if (r >= 0) { const t1 = performance.now(); world.setRung(r); pending = { rung: r, before: +seen[seen.length - 1].toFixed(1), step: +(performance.now() - t1).toFixed(2) }; }
  }
  const tail = seen.slice(-40).sort((a, b) => a - b);
  return { rung: gov.rung, ms: +tail[tail.length >> 1].toFixed(1), frames: seen.length, width: engine.size.x, height: engine.size.y, fogSteps: world.fogSteps, steps };
}
let last = performance.now();
function loop(t) {
  const real = (t - last) / 1000; last = t;
  if (!G.manual) {
    monitor(real);
    let left = Math.min(0.06, real) * G.speed;
    while (left > 1e-5) { const d = Math.min(left, 1 / 30); left -= d; tick(d, left <= 1e-5); }
  }
  requestAnimationFrame(loop);
}

// ---- hooks for tests and automation -----------------------------------------------------------------
async function snap(name, o = {}) {
  const W = o.w || 1280, sc = W / window.innerWidth, H = Math.round(window.innerHeight * sc);
  world.resize(window.innerWidth, window.innerHeight, 1, [W, H]);
  for (let i = 0; i < (o.settle ?? 4); i++) tick(0, true);          // a few frames so the picture settles at the new size
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.drawImage(canvas, 0, 0, W, H);
  resize();
  if (o.ui !== false) {
    try {
      const css = [...document.styleSheets].map((ss) => [...ss.cssRules].map((r) => r.cssText).join('\n')).join('\n');
      const html = new XMLSerializer().serializeToString(uiRoot);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${window.innerWidth}" height="${window.innerHeight}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${window.innerWidth}px;height:${window.innerHeight}px"><style>${css.replace(/</g, '&lt;')}</style>${html}</div></foreignObject></svg>`;
      const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode(); g.drawImage(img, 0, 0, W, H);
    } catch (e) { console.warn('snap: could not draw the interface', e); }
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
  if (o.blob) return blob;
  const res = await fetch('/__save?name=' + encodeURIComponent(name + '.jpg'), { method: 'POST', body: blob });
  return res.text();
}
function bench(n = 40) {
  const gl = engine.renderer.getContext(), t = performance.now();
  for (let i = 0; i < n; i++) world.frame(1 / 60);
  gl.finish(); const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { tier: tierName, rung: world.rung, ms: +((performance.now() - t) / n).toFixed(2), width: engine.size.x, height: engine.size.y, env: world.env, condition: world.condition.name };
}
window.__game = {
  events, status, onReport, scenario: S, world, ui, G, pickup, truck, tier: tierName, level: tierName, session, playerId: pid,
  get run() { return G.run; }, get state() { return G.run ? G.run.state : null; }, get scene() { return G.scene; },
  begin, tick, snap, bench, selfTimed, gov, auto: AUTO,
  setRung(i) { gov.lock(i); world.setRung(i); }, autoGraphics() { gov.unlock(); },
  // step the whole game forward without a clock: advance(12) plays 12 seconds
  advance(seconds, o = {}) {
    const step = o.step || 1 / 30, n = Math.ceil(seconds / step), every = o.renderEvery || 8;
    for (let i = 0; i < n; i++) { tick(step, i === n - 1 || i % every === 0); if (o.until && o.until()) return i * step; }
    return seconds;
  },
  setManual(on) { G.manual = !!on; },
  setBot(name) { G.botName = name || null; G.bot = name && G.run ? createBot(name, road) : null; },
  // a camera placed by hand, in road coordinates: setShot([s, u, height], [s, u, height], fov); setShot() hands it back
  setShot(from, to, fov = 50) {
    G.shot = from ? () => { const a = route.toWorld(from[0], from[1]), b = route.toWorld(to[0], to[1]); cam.position.set(a[0], a[1] + from[2], a[2]); cam.up.set(0, 1, 0); cam.lookAt(b[0], b[1] + to[2], b[2]); engine.setDial('fov', fov); } : null;
  },
  key(k) { window.dispatchEvent(new KeyboardEvent('keydown', { key: k })); },
};

window.__game.film = createFilm({ world, G, ui, tick, begin, resize, setBot: (n) => window.__game.setBot(n), scene: () => G.scene, state: () => (G.run ? G.run.state : null) });

// Draw one frame of the drive with both vehicles in view while the loading screen is still up, so
// every shader is compiled now and nothing stalls later when the night falls or the truck appears.
world.setEnv('drive'); pickup.place({ ...START }, true); truck.place({ s: START.s + 30, u: 0, uTrail: 0, spin: 0 }, true);
world.view(START.s - 12, 0, 2, 0, 0); world.frame(0); pickup.place({ ...START, view: 'cab' }, true); world.frame(0);
truck.place({ hidden: true }, false); world.setEnv('stage');

// first picture: the staging area at dusk
pickup.place({ ...START }, true); setRadioStation();
showTitle();
tick(0, true);
requestAnimationFrame(loop);
