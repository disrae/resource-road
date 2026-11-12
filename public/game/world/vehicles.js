// The pickup and the loaded logging truck: low-poly models built from primitives (no asset files),
// their lamps, and how they sit on the road. Vehicle space: +X forward, +Y up, +Z right.
import * as THREE from '../../vendor/three.module.min.js';
import { propMaterial, lampMaterial } from '../render/materials.js';
import { Kit, tf, rand } from './kit.js';

const PAINT = [0.6, 0.6, 0.58], BLACK = [0.03, 0.03, 0.034], GLASS = [0.012, 0.016, 0.02], TYRE = [0.022, 0.022, 0.022];
const RIM = [0.26, 0.26, 0.27], STEEL = [0.2, 0.2, 0.21], CHROME = [0.36, 0.36, 0.37];
const arc = (cx, cy, r, n = 12) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(Math.PI * i / n), cy + r * Math.sin(Math.PI * i / n)]);
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Euler(), _q = new THREE.Quaternion();

function wheelGeo(r, w, dual = false) {
  const k = new Kit(), rx = tf(0, 0, 0, Math.PI / 2, 0, 0);
  const one = (z) => {
    k.cyl(r, r, w, 16, tf(0, 0, z, Math.PI / 2), TYRE, { gloss: 0.12 });
    k.cyl(r * 0.6, r * 0.6, w + 0.02, 12, tf(0, 0, z, Math.PI / 2), RIM, { gloss: 0.5 });
    k.cyl(r * 0.2, r * 0.2, w + 0.06, 8, tf(0, 0, z, Math.PI / 2), BLACK, { gloss: 0.3 });
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; k.box(r * 0.2, 0.05, w + 0.03, tf(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, z, 0, 0, a + Math.PI / 2), [0.012, 0.012, 0.012], { gloss: 0.05 }); }
  };
  if (dual) { one(-w * 0.55); one(w * 0.55); } else one(0);
  void rx;
  return k.build();
}

// Where a vehicle sits: road position (s, u), heading relative to the road (yaw, + = turned right),
// direction of travel (+1 up the road, -1 down). Heights are sampled under the four wheels.
function poseOn(route, s, u, yaw, dir, wb, track, out) {
  const f = route.frame(s);
  const c = Math.cos(yaw) * dir, sn = Math.sin(yaw) * dir;       // heading in road coordinates (ds, du)
  const hx = f.tx * c - f.tz * sn, hz = f.tz * c + f.tx * sn;     // world heading
  const yAt = (dx, dz) => route.surface(s + dx * c - dz * sn, u + dx * sn + dz * c);
  const fl = yAt(wb / 2, -track / 2), fr = yAt(wb / 2, track / 2), rl = yAt(-wb / 2, -track / 2), rr = yAt(-wb / 2, track / 2);
  out.x = f.x - f.tz * u; out.z = f.z + f.tx * u; out.y = (fl + fr + rl + rr) / 4;
  out.rotY = Math.atan2(-hz, hx);
  out.pitch = Math.atan2((fl + fr - rl - rr) / 2, wb);
  out.roll = Math.atan2((fl + rl - fr - rr) / 2, track);
  out.hx = hx; out.hz = hz;
  return out;
}

// ---- pickup ---------------------------------------------------------------------------------
function pickupBody() {
  const k = new Kit(), W = 1.98, P = { gloss: 0.6 }, hz = W / 2;
  k.profile([[-2.95, 0.52], [-2.95, 0.86], [-1.02, 0.86], [-1.02, 1.9], [-0.9, 1.96], [0.5, 1.96], [0.64, 1.92], [1.3, 1.36], [2.72, 1.27], [2.93, 1.12], [2.95, 0.62], [2.8, 0.52]], W, null, PAINT, P);
  for (const z of [-1, 1]) {
    k.box(1.93, 0.5, 0.09, tf(-1.985, 1.09, z * 0.945), PAINT, P);                       // bed sides
    k.box(1.95, 0.03, 0.11, tf(-1.985, 1.35, z * 0.945), BLACK, { gloss: 0.2 });         // rail caps
    k.box(0.66, 0.4, 0.02, tf(0.2, 1.64, z * (hz + 0.004)), GLASS, { gloss: 0.95 });      // front door glass
    k.box(0.62, 0.4, 0.02, tf(-0.6, 1.64, z * (hz + 0.004)), GLASS, { gloss: 0.95 });     // rear door glass
    for (const x of [0.62, -0.2, -1.0]) k.box(0.012, 0.86, 0.012, tf(x, 0.98, z * (hz + 0.002)), [0.1, 0.1, 0.1], { gloss: 0.2 });   // door gaps
    for (const x of [0.3, -0.5]) k.box(0.12, 0.03, 0.03, tf(x, 1.3, z * (hz + 0.012)), BLACK, { gloss: 0.4 });                       // handles
    k.box(0.09, 0.17, 0.24, tf(0.78, 1.5, z * 1.12), BLACK, { gloss: 0.4 });              // mirror
    for (const x of [1.85, -1.85]) k.profile(arc(x, 0.44, 0.56), 0.06, tf(0, 0, z * (hz + 0.005)), BLACK, { gloss: 0.2, bevel: 0 });   // arch flares
    k.box(0.05, 0.78, 0.05, tf(-1.1, 1.72, z * 0.86), BLACK, { gloss: 0.3 });             // cab guard uprights
    k.box(1.2, 0.1, 0.07, tf(0, 0.5, z * (hz - 0.02)), BLACK, { gloss: 0.2 });            // sill step
    k.box(5.5, 0.16, 0.012, tf(0.02, 0.63, z * (hz + 0.003)), [0.05, 0.05, 0.055], { gloss: 0.2 });               // dark lower cladding
    k.box(2.6, 0.07, 0.012, tf(-0.2, 0.84, z * (hz + 0.006)), [0.85, 0.22, 0.03], { gloss: 0.3, retro: 0.5 });     // high-visibility stripe on the doors
  }
  k.box(0.05, 0.05, 1.77, tf(-1.1, 2.09, 0), BLACK, { gloss: 0.3 });
  k.box(0.16, 0.07, 0.6, tf(-0.2, 2.0, 0), [0.75, 0.33, 0.02], { gloss: 0.6 });           // amber beacon bar on the roof
  k.box(0.05, 0.05, 1.77, tf(-1.1, 1.78, 0), BLACK, { gloss: 0.3 });
  k.box(0.08, 0.5, W - 0.02, tf(-2.93, 1.09, 0), PAINT, P);                               // tailgate
  k.box(0.012, 0.09, 1.7, tf(-2.975, 0.98, 0), [0.85, 0.22, 0.03], { gloss: 0.3, retro: 0.5 });   // high-visibility strip
  k.box(1.9, 0.02, 1.8, tf(-1.98, 0.87, 0), [0.04, 0.04, 0.04], { gloss: 0.1 });          // bed liner
  k.box(0.02, 0.74, 1.72, tf(0.985, 1.655, 0, 0, 0, -0.689 + Math.PI / 2), GLASS, { gloss: 0.95 });   // windshield
  k.box(0.02, 0.38, 1.4, tf(-1.03, 1.64, 0), GLASS, { gloss: 0.95 });                     // rear window
  k.box(0.05, 0.4, 1.3, tf(2.94, 0.97, 0), BLACK, { gloss: 0.4 });                        // grille
  k.box(0.2, 0.26, W + 0.04, tf(2.97, 0.6, 0), STEEL, { gloss: 0.5 });                    // front bumper
  k.box(0.16, 0.2, W + 0.04, tf(-2.99, 0.58, 0), STEEL, { gloss: 0.5 });                  // rear bumper
  k.box(4.9, 0.24, 1.4, tf(0, 0.42, 0), BLACK, { gloss: 0.1 });                           // underbody
  k.cyl(0.012, 0.014, 2.7, 5, tf(-1.1, 3.4, 0.86), [0.5, 0.5, 0.5], { gloss: 0.3 });      // whip flag
  k.box(0.3, 0.2, 0.01, tf(-1.26, 4.6, 0.86), [0.9, 0.25, 0.03], { gloss: 0.2, retro: 0.3 });
  // spare tire standing in the bed against the cab guard
  k.cyl(0.4, 0.4, 0.26, 14, tf(-1.3, 1.28, -0.45, 0, 0, Math.PI / 2), TYRE, { gloss: 0.12 });
  k.cyl(0.24, 0.24, 0.27, 10, tf(-1.3, 1.28, -0.45, 0, 0, Math.PI / 2), RIM, { gloss: 0.5 });
  return k.build();
}

function cargo(tied) {
  const k = new Kit();
  if (tied) {
    k.box(0.26, 0.4, 0.36, tf(-1.45, 1.08, 0.55), [0.5, 0.03, 0.02], { gloss: 0.4 });
    k.box(0.55, 0.26, 0.34, tf(-1.55, 1.01, 0.12), [0.55, 0.42, 0.04], { gloss: 0.4 });
    k.box(0.04, 0.012, 1.1, tf(-1.5, 1.29, 0.35), [0.9, 0.3, 0.02], { gloss: 0.2 });
    k.box(0.04, 0.42, 0.012, tf(-1.5, 1.08, 0.76), [0.9, 0.3, 0.02], { gloss: 0.2 });
    k.box(0.04, 0.42, 0.012, tf(-1.5, 1.08, -0.08), [0.9, 0.3, 0.02], { gloss: 0.2 });
  } else {
    k.box(0.26, 0.4, 0.36, tf(-2.3, 1.0, 0.3, 1.45, 0.5, 0.1), [0.5, 0.03, 0.02], { gloss: 0.4 });
    k.box(0.55, 0.26, 0.34, tf(-1.9, 1.01, -0.15, 0, 0.7, 0), [0.55, 0.42, 0.04], { gloss: 0.4 });
  }
  return k.build();
}

// What the driver sees of their own truck: hood, dash, the wheel. Shown instead of the body in the cab view.
function cabView() {
  const k = new Kit(), DASH = [0.022, 0.022, 0.024];
  k.profile([[1.22, 0.9], [1.3, 1.36], [2.72, 1.27], [2.93, 1.12], [2.95, 0.8]], 1.98, null, PAINT, { gloss: 0.6 });   // hood
  k.box(0.75, 0.2, 1.9, tf(0.97, 1.33, 0, 0, 0, 0.1), DASH, { gloss: 0.12 });                 // dash top
  k.box(0.3, 0.1, 0.5, tf(0.78, 1.43, -0.42, 0, 0, 0.1), DASH, { gloss: 0.12 });              // instrument hood
  k.box(0.045, 0.9, 0.045, tf(0.98, 1.74, -0.96, 0, 0, 0.7), DASH, { gloss: 0.2 });           // A pillars
  k.box(0.045, 0.9, 0.045, tf(0.98, 1.74, 0.96, 0, 0, 0.7), DASH, { gloss: 0.2 });
  k.box(0.09, 0.17, 0.24, tf(0.78, 1.5, -1.12), BLACK, { gloss: 0.4 });                       // mirrors
  k.box(0.09, 0.17, 0.24, tf(0.78, 1.5, 1.12), BLACK, { gloss: 0.4 });
  k.box(0.16, 0.07, 0.2, tf(0.74, 1.47, 0.12, 0, 0, 0.1), [0.035, 0.035, 0.04], { gloss: 0.3 });   // the radio on the dash
  return k.build();
}
function steeringWheel() {
  const k = new Kit(), C = [0.03, 0.03, 0.032];
  k.add(new THREE.TorusGeometry(0.19, 0.018, 6, 20), tf(0, 0, 0, 0, Math.PI / 2, 0), C, { gloss: 0.3, flat: false });
  k.box(0.02, 0.03, 0.36, tf(0, 0, 0), C, { gloss: 0.3 });
  k.box(0.02, 0.19, 0.03, tf(0, -0.095, 0), C, { gloss: 0.3 });
  return k.build();
}

export function createPickup(world) {
  const { engine, route } = world;
  const mat = propMaterial({ dirt: 0.75 });
  const group = new THREE.Group(); group.rotation.order = 'YZX';
  const body = new THREE.Mesh(pickupBody(), mat); group.add(body);
  const cab = new THREE.Group(), cabMat = propMaterial({ dirt: 0.25 }); cab.add(new THREE.Mesh(cabView(), cabMat));
  const swPivot = new THREE.Group(); swPivot.position.set(0.66, 1.36, -0.42); swPivot.rotation.z = -0.42;
  const sw = new THREE.Mesh(steeringWheel(), cabMat); swPivot.add(sw); cab.add(swPivot);
  const radioLamp = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.03, 0.1), lampMaterial([0.5, 1, 0.55], 0)); radioLamp.position.set(0.657, 1.468, 0.12); radioLamp.rotation.z = 0.1; cab.add(radioLamp);
  group.add(cab);
  const wg = wheelGeo(0.42, 0.3), wheels = [];
  for (const [x, z] of [[1.85, -0.86], [1.85, 0.86], [-1.85, -0.86], [-1.85, 0.86]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.42, z);
    const w = new THREE.Mesh(wg, mat); pivot.add(w); group.add(pivot); wheels.push({ pivot, w });
  }
  const cargoLoose = new THREE.Mesh(cargo(false), mat), cargoTied = new THREE.Mesh(cargo(true), mat), cargoGroup = new THREE.Group();
  cargoGroup.add(cargoLoose, cargoTied); group.add(cargoGroup);
  const lampGeo = new THREE.BoxGeometry(0.05, 0.19, 0.36), tailGeo = new THREE.BoxGeometry(0.04, 0.36, 0.12);
  const head = [-1, 1].map((z) => { const m = new THREE.Mesh(lampGeo, lampMaterial([1, 0.93, 0.78], 0)); m.position.set(2.945, 1.0, z * 0.78); group.add(m); return m; });
  const tail = [-1, 1].map((z) => { const m = new THREE.Mesh(tailGeo, lampMaterial([1, 0.06, 0.03], 0)); m.position.set(-2.975, 1.1, z * 0.92); group.add(m); return m; });
  group.traverse((o) => { o.frustumCulled = false; });
  engine.scene.add(group);
  const pose = {}, P = {
    group, wheels, pose, faults: { lights: false, tires: false, load: false }, length: 5.9, width: 2.0,
    headPower: 380, lampPower: 30, eye: [0.55, 1.88, -0.42], radioLamp,
    // p: { s, u, yaw, steer, spin, lean, dive, hidden, brake }
    place(p, lightsOn = true) {
      group.visible = !p.hidden;
      const inCab = p.view === 'cab';
      body.visible = cargoGroup.visible = !inCab; cab.visible = inCab; sw.rotation.x = (p.steer || 0) * 5;
      for (const w of wheels) w.pivot.visible = !inCab;
      for (const m of [...head, ...tail]) m.visible = !inCab;
      poseOn(route, p.s, p.u, p.yaw || 0, 1, 3.7, 1.72, pose);
      group.position.set(pose.x, pose.y + (p.sink || 0), pose.z);
      group.rotation.set((pose.roll + (p.lean || 0)) * 1, pose.rotY, pose.pitch + (p.dive || 0));
      wheels.forEach((w, i) => { w.pivot.rotation.y = i < 2 ? -(p.steer || 0) : 0; w.w.rotation.z = -(p.spin || 0); });
      wheels[0].pivot.scale.y = P.faults.tires ? 0.9 : 1; wheels[0].pivot.position.y = P.faults.tires ? 0.38 : 0.42;
      cargoLoose.visible = !!P.faults.load; cargoTied.visible = !P.faults.load;
      group.updateMatrixWorld(true);
      const on = lightsOn;                     // a hidden body (driver's view) still carries its lamps
      _d.set(1, -0.045, 0).transformDirection(group.matrixWorld);
      const dir = [_d.x, _d.y, _d.z];
      [-1, 1].forEach((z, i) => {
        const lit = on && !(i === 1 && P.faults.lights);
        _v.set(3.0, 1.0, z * 0.78).applyMatrix4(group.matrixWorld);
        world.setSpot(i, [_v.x, _v.y, _v.z], dir, lit ? P.headPower : 0, 27, [1, 0.87, 0.68]);
        head[i].material.uniforms.uPower.value = lit ? P.lampPower : 0.02;
        _v.set(-3.05, 1.1, z * 0.92).applyMatrix4(group.matrixWorld);
        world.setPoint(i, [_v.x, _v.y, _v.z], on ? (p.brake ? 0.3 : 0.08) : 0, [1, 0.07, 0.03]);
        tail[i].material.uniforms.uPower.value = on ? (p.brake ? 5 : 1.2) : 0.01;
      });
      // the glow of the fog ahead falls softly back on the truck
      _v.set(4.5, 1.4, 0).applyMatrix4(group.matrixWorld); const fk = inCab ? 0.2 : 1; world.setFill([_v.x, _v.y, _v.z], 3.5, on ? [0.06 * fk, 0.052 * fk, 0.04 * fk] : [0, 0, 0]);
      return pose;
    },
    // put the camera at the driver's eyes, looking ahead turned by yaw (+ = right) and pitch
    cabCamera(cam, yaw = 0, pitch = 0) {
      _v.set(P.eye[0], P.eye[1], P.eye[2]).applyMatrix4(group.matrixWorld); cam.position.copy(_v);
      _e.set(pitch, -Math.PI / 2 - yaw, 0, 'YXZ'); cam.quaternion.copy(group.quaternion).multiply(_q.setFromEuler(_e));
    },
    // a point in vehicle space -> world
    point(x, y, z, out = new THREE.Vector3()) { return out.set(x, y, z).applyMatrix4(group.matrixWorld); },
  };
  return P;
}

// ---- logging truck -----------------------------------------------------------------------------
const CAB = [0.33, 0.04, 0.028];
function tractorBody() {
  const k = new Kit(), P = { gloss: 0.6 };
  k.box(7.6, 0.3, 1.0, tf(-2.6, 0.95, 0), BLACK, { gloss: 0.15 });                                   // frame
  k.profile([[1.36, 1.05], [1.36, 2.0], [1.15, 2.12], [-0.9, 2.26], [-0.9, 1.05]], 1.5, null, CAB, P);   // hood
  k.profile([[-0.9, 1.0], [-0.9, 2.3], [-0.74, 3.06], [-0.6, 3.16], [-2.5, 3.16], [-2.6, 3.06], [-2.6, 1.0]], 2.3, null, CAB, P);   // cab
  k.box(0.06, 0.92, 1.1, tf(1.38, 1.52, 0), CHROME, { gloss: 0.8 });                                  // grille
  for (let i = 0; i < 9; i++) k.box(0.07, 0.86, 0.02, tf(1.385, 1.52, -0.44 + i * 0.11), BLACK, { gloss: 0.3 });
  k.box(0.26, 0.36, 2.5, tf(1.52, 0.76, 0), CHROME, { gloss: 0.8 });                                  // bumper
  k.box(0.02, 0.7, 1.96, tf(-0.805, 2.68, 0, 0, 0, 0.2), GLASS, { gloss: 0.95 });                     // windshield
  k.box(0.02, 0.72, 0.05, tf(-0.795, 2.68, 0, 0, 0, 0.2), CAB, P);
  k.box(0.34, 0.05, 2.34, tf(-0.58, 3.1, 0, 0, 0, -0.18), BLACK, { gloss: 0.3 });                     // visor
  for (const z of [-1, 1]) {
    k.box(0.9, 0.6, 0.02, tf(-1.45, 2.62, z * 1.155), GLASS, { gloss: 0.95 });
    k.profile(arc(0, 0.56, 0.72), 0.5, tf(0, 0, z * 1.02), CAB, { gloss: 0.6, bevel: 0.02 });         // front fenders
    k.box(0.07, 0.5, 0.26, tf(-0.82, 2.62, z * 1.42), CHROME, { gloss: 0.8 });                        // mirrors
    k.box(0.04, 0.04, 0.3, tf(-0.82, 2.8, z * 1.25), BLACK, { gloss: 0.3 });
    k.cyl(0.085, 0.085, 2.3, 8, tf(-2.78, 2.75, z * 1.02), CHROME, { gloss: 0.8 });                   // stacks
    k.cyl(0.33, 0.33, 1.3, 12, tf(-1.9, 0.86, z * 1.02, 0, 0, Math.PI / 2), CHROME, { gloss: 0.8 });  // fuel tanks
    k.box(0.9, 0.06, 0.34, tf(-1.9, 0.5, z * 1.05), BLACK, { gloss: 0.2 });                           // steps
    k.box(0.16, 2.35, 0.13, tf(-5.25, 2.72, z * 1.32), STEEL, { gloss: 0.3 });                        // bunk stakes
    k.box(0.04, 0.6, 0.62, tf(-6.6, 0.7, z * 0.95), BLACK, { gloss: 0.1 });                           // mud flaps
  }
  k.box(0.14, 2.7, 2.44, tf(-3.02, 2.5, 0), STEEL, { gloss: 0.3 });                                   // cab guard
  k.box(0.32, 0.26, 2.7, tf(-5.25, 1.5, 0), STEEL, { gloss: 0.3 });                                   // bunk
  return k.build();
}
function trailerBody() {
  const k = new Kit();
  k.box(3.0, 0.3, 1.0, tf(0, 0.98, 0), BLACK, { gloss: 0.15 });
  k.box(0.32, 0.26, 2.7, tf(0, 1.5, 0), STEEL, { gloss: 0.3 });
  for (const z of [-1, 1]) {
    k.box(0.16, 2.35, 0.13, tf(0, 2.72, z * 1.32), STEEL, { gloss: 0.3 });
    k.box(0.04, 0.6, 0.62, tf(-1.4, 0.7, z * 0.95), BLACK, { gloss: 0.1 });
    k.box(0.02, 0.1, 0.5, tf(-1.52, 1.0, z * 0.9), [0.8, 0.8, 0.8], { gloss: 0.3, retro: 0.6 });
  }
  k.box(0.1, 0.16, 2.3, tf(-1.5, 1.0, 0), STEEL, { gloss: 0.3 });
  return k.build();
}
// the load: local +X runs from the tractor bunk back to the trailer bunk
function logLoad(span) {
  const k = new Kit(), rnd = rand(91);
  k.cyl(0.11, 0.11, span, 6, tf(span / 2, -0.42, 0, 0, 0, Math.PI / 2), STEEL, { gloss: 0.3 });        // the reach
  const rows = [5, 4, 5, 4, 3]; let y = 0.28;
  for (let r = 0; r < rows.length; r++) {
    const n = rows[r], pitch = 2.5 / 5;
    for (let i = 0; i < n; i++) {
      const rad = 0.2 + 0.07 * rnd(), len = span + 2.6 + 1.6 * rnd(), x0 = -1.5 + 0.5 * rnd(), z = (i - (n - 1) / 2) * pitch + (rnd() - 0.5) * 0.05;
      const sh = 0.7 + 0.6 * rnd(), bark = [0.12 * sh, 0.082 * sh, 0.055 * sh];
      const m = tf(x0 + len / 2, y + (rnd() - 0.5) * 0.04, z, rnd() * 6, 0, Math.PI / 2);
      k.cyl(rad * 0.82, rad, len, 8, m, bark, { gloss: 0.08, open: true });
      k.cyl(rad, rad, 0.02, 8, tf(x0, y, z, 0, 0, Math.PI / 2), [0.5, 0.37, 0.2], { gloss: 0.15 });    // butt ends face the cab
      k.cyl(rad * 0.82, rad * 0.82, 0.02, 8, tf(x0 + len, y, z, 0, 0, Math.PI / 2), [0.45, 0.33, 0.18], { gloss: 0.15 });
    }
    y += 0.42;
  }
  for (const x of [span * 0.25, span * 0.75]) {                                                         // wrappers
    k.box(0.05, 0.015, 2.5, tf(x, y - 0.17, 0), [0.25, 0.25, 0.25], { gloss: 0.5 });
    for (const z of [-1, 1]) k.box(0.05, y - 0.2, 0.015, tf(x, (y - 0.2) / 2, z * 1.26), [0.25, 0.25, 0.25], { gloss: 0.5 });
  }
  k.box(0.02, 0.3, 0.3, tf(span + 4.0, 0.9, 0), [0.9, 0.1, 0.05], { gloss: 0.2, retro: 0.5 });          // red flag on the overhang
  return k.build();
}

export function createLogTruck(world) {
  const { engine, route } = world;
  const mat = propMaterial({ dirt: 0.6 }), SPAN = 9.6;
  const tractor = new THREE.Group(), trailer = new THREE.Group(), load = new THREE.Group();
  tractor.rotation.order = trailer.rotation.order = 'YZX';
  tractor.add(new THREE.Mesh(tractorBody(), mat)); trailer.add(new THREE.Mesh(trailerBody(), mat)); load.add(new THREE.Mesh(logLoad(SPAN), mat));
  const single = wheelGeo(0.52, 0.32), dual = wheelGeo(0.52, 0.3, true), wheels = [];
  const addWheel = (g, geo, x, z) => { const w = new THREE.Mesh(geo, mat); w.position.set(x, 0.52, z); g.add(w); wheels.push(w); };
  addWheel(tractor, single, 0, -1.08); addWheel(tractor, single, 0, 1.08);
  for (const x of [-4.6, -5.9]) for (const z of [-0.92, 0.92]) addWheel(tractor, dual, x, z);
  for (const x of [-0.66, 0.66]) for (const z of [-0.92, 0.92]) addWheel(trailer, dual, x, z);
  const lamp = (g, geo, col, x, y, z) => { const m = new THREE.Mesh(geo, lampMaterial(col, 0)); m.position.set(x, y, z); g.add(m); return m; };
  const hg = new THREE.BoxGeometry(0.06, 0.2, 0.3), mg = new THREE.BoxGeometry(0.07, 0.07, 0.12), tg = new THREE.BoxGeometry(0.05, 0.14, 0.26);
  const heads = [-1, 1].map((z) => lamp(tractor, hg, [1, 0.9, 0.72], 1.42, 1.22, z * 0.98));
  const markers = [-0.84, -0.42, 0, 0.42, 0.84].map((z) => lamp(tractor, mg, [1, 0.5, 0.06], -0.62, 3.22, z));
  markers.push(lamp(tractor, mg, [1, 0.5, 0.06], 1.5, 0.98, -1.2), lamp(tractor, mg, [1, 0.5, 0.06], 1.5, 0.98, 1.2));
  const tails = [-1, 1].map((z) => lamp(trailer, tg, [1, 0.05, 0.03], -1.56, 1.0, z * 0.5));
  const root = new THREE.Group(); root.add(tractor, trailer, load);
  root.traverse((o) => { o.frustumCulled = false; });
  engine.scene.add(root);
  const pA = {}, pB = {}, a = new THREE.Vector3(), b = new THREE.Vector3(), m4 = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const T = {
    root, tractor, trailer, load, length: 19, width: 2.6, headPower: 240,
    // p: { s (front axle), u, hidden, spin }. The truck travels DOWN the road (kilometres decreasing).
    place(p, lightsOn = true) {
      root.visible = !p.hidden;
      const on = lightsOn && !p.hidden;
      if (!p.hidden) {
        poseOn(route, p.s + 2.95, p.u, 0, -1, 5.9, 2.0, pA);
        tractor.position.set(pA.x, pA.y, pA.z); tractor.rotation.set(pA.roll, pA.rotY, pA.pitch);
        // tractor origin is the front axle: shift back along its heading
        tractor.position.x += pA.hx * 2.95; tractor.position.z += pA.hz * 2.95; tractor.position.y += Math.tan(pA.pitch) * 2.95;
        const uT = p.u * 0.85 + (p.uTrail ?? p.u) * 0.15;
        poseOn(route, p.s + 5.25 + SPAN, uT, 0, -1, 1.4, 2.0, pB);
        trailer.position.set(pB.x, pB.y, pB.z); trailer.rotation.set(pB.roll, pB.rotY, pB.pitch);
        root.updateMatrixWorld(true);
        a.set(-5.25, 1.64, 0).applyMatrix4(tractor.matrixWorld); b.set(0, 1.64, 0).applyMatrix4(trailer.matrixWorld);
        X.subVectors(b, a).normalize(); Y.set(0, 1, 0); Z.crossVectors(X, Y).normalize(); Y.crossVectors(Z, X);
        m4.makeBasis(X, Y, Z); load.quaternion.setFromRotationMatrix(m4); load.position.copy(a);
        const spin = p.spin || 0; for (const w of wheels) w.rotation.z = -spin;
        root.updateMatrixWorld(true);
        _d.set(1, 0.0, 0).transformDirection(tractor.matrixWorld);
        const dir = [_d.x, _d.y, _d.z];
        [-1, 1].forEach((z, i) => {
          _v.set(1.5, 1.22, z * 0.98).applyMatrix4(tractor.matrixWorld);
          world.setSpot(2 + i, [_v.x, _v.y, _v.z], dir, on ? T.headPower : 0, 30, [1, 0.9, 0.74]);
        });
        _v.set(-0.5, 3.3, 0).applyMatrix4(tractor.matrixWorld); world.setPoint(2, [_v.x, _v.y, _v.z], on ? 0.25 : 0, [1, 0.5, 0.07]);
        _v.set(-1.7, 1.0, 0).applyMatrix4(trailer.matrixWorld); world.setPoint(3, [_v.x, _v.y, _v.z], on ? 0.15 : 0, [1, 0.06, 0.03]);
        _v.set(1.6, 1.0, 0).applyMatrix4(tractor.matrixWorld); world.setPoint(4, [_v.x, _v.y, _v.z], on ? 0.12 : 0, [1, 0.5, 0.07]);
        T.front = [pA.x + pA.hx * 2.95, pA.y, pA.z + pA.hz * 2.95];
      } else { world.setSpot(2, [0, 0, 0], [1, 0, 0], 0); world.setSpot(3, [0, 0, 0], [1, 0, 0], 0); for (const i of [2, 3, 4]) world.setPoint(i, [0, 0, 0], 0); }
      for (const h of heads) h.material.uniforms.uPower.value = on ? 30 : 0.02;
      for (const m of markers) m.material.uniforms.uPower.value = on ? 3 : 0.02;
      for (const t of tails) t.material.uniforms.uPower.value = on ? 1.5 : 0.01;
    },
  };
  return T;
}
