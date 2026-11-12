// Road signs: the channel and calling-rule signs at the road entrance, kilometre boards and the
// MUST CALL sign. The faces are drawn to a canvas from the scenario file, so editing the road
// name, channel or kilometres there changes every sign. Sign designs follow the BC forest
// service road sign standards in spirit (see HANDOVER.md); they are not exact reproductions.
import * as THREE from '../../vendor/three.module.min.js';
import { propMaterial } from '../render/materials.js';
import { Kit, tf } from './kit.js';

const W = 2048, H = 1024, FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

function arrowUp(g, cx, cy, size) {
  g.beginPath();
  g.moveTo(cx, cy - size); g.lineTo(cx + size * 0.62, cy - size * 0.2); g.lineTo(cx + size * 0.22, cy - size * 0.2);
  g.lineTo(cx + size * 0.22, cy + size); g.lineTo(cx - size * 0.22, cy + size); g.lineTo(cx - size * 0.22, cy - size * 0.2);
  g.lineTo(cx - size * 0.62, cy - size * 0.2); g.closePath(); g.fill();
}
function plate(g, x, y, w, h, bg, border = '#111') {
  g.fillStyle = border; g.fillRect(x, y, w, h);
  g.fillStyle = bg; g.beginPath(); g.roundRect(x + 12, y + 12, w - 24, h - 24, 22); g.fill();
}
function text(g, str, cx, cy, px, color = '#111', weight = 800, maxW = 0) {
  g.font = `${weight} ${px}px ${FONT}`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (maxW) { const m = g.measureText(str).width; if (m > maxW) g.font = `${weight} ${Math.floor(px * maxW / m)}px ${FONT}`; }
  g.fillText(str, cx, cy);
}

export function drawSignAtlas(scenario) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), R = scenario.road, YEL = '#f1bd12', WHT = '#ecece6';
  const name = R.name.toUpperCase(), cells = {};
  // road channel (yellow, black border)
  plate(g, 0, 0, 640, 448, YEL); cells.channel = [0, 0, 640, 448];
  text(g, 'ROAD CHANNEL', 320, 130, 84, '#111', 800, 560); text(g, R.channel, 320, 300, 190, '#111', 900, 560);
  // calling rules (white)
  plate(g, 640, 0, 640, 448, WHT); cells.rules = [640, 0, 640, 448];
  const up = R.upCalls === 'even' ? 'EVEN' : 'ODD', down = R.upCalls === 'even' ? 'ODD' : 'EVEN';
  text(g, R.signName, 960, 78, 76, '#111', 900, 560);
  g.fillStyle = '#111'; g.fillRect(672, 126, 576, 8);
  text(g, `UP: CALL ${up} KM`, 960, 196, 68, '#111', 800, 560);
  text(g, `DOWN: CALL ${down} KM`, 960, 282, 68, '#111', 800, 560);
  text(g, 'CALL AT EVERY MUST CALL SIGN', 960, 372, 44, '#111', 700, 560);
  // must call (white with a black header)
  plate(g, 1280, 0, 448, 448, WHT); cells.mustcall = [1280, 0, 448, 448];
  g.fillStyle = '#111'; g.fillRect(1292, 12, 424, 130); text(g, 'MUST CALL', 1504, 80, 84, '#fff', 900, 390);
  text(g, name, 1504, 206, 74, '#111', 800, 390);
  const mk = (scenario.radio.callPoints.find((p) => p.kind === 'mustcall') || { km: 1 }).km;
  text(g, `${mk} KM`, 1450, 330, 130, '#111', 900, 250); g.fillStyle = '#111'; arrowUp(g, 1650, 330, 64);
  // active hauling warning (orange)
  plate(g, 0, 448, 640, 352, '#f07f0c'); cells.hauling = [0, 448, 640, 352];
  text(g, 'ACTIVE HAULING', 320, 550, 84, '#111', 900, 560); text(g, 'YIELD TO LOGGING TRUCKS', 320, 652, 52, '#111', 800, 560); text(g, 'USE PULLOUTS', 320, 728, 52, '#111', 800, 560);
  // kilometre boards (yellow): road name, number, UP arrow
  const kms = []; for (let s = 0, km = R.startKm; s < 3070; s += R.kmSpacing, km++) kms.push(km);
  kms.slice(0, 4).forEach((km, i) => {
    const x = 640 + i * 320, y = 448; plate(g, x, y, 320, 448, YEL); cells['km' + km] = [x, y, 320, 448];
    text(g, name, x + 160, y + 70, 60, '#111', 800, 270); text(g, String(km), x + 160, y + 230, 230, '#111', 900, 270);
    text(g, 'UP', x + 110, y + 380, 70, '#111', 800); g.fillStyle = '#111'; arrowUp(g, x + 220, y + 376, 44);
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const uv = {}; for (const [k, [x, y, w, h]] of Object.entries(cells)) uv[k] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
  return { tex, uv, kms, canvas: c };
}

const POST = [0.17, 0.14, 0.1], BACK = [0.2, 0.2, 0.2], FACE = [0.82, 0.82, 0.82];
// faces: [{ cell, w, h, y }] stacked on one or two posts; the face looks along local +Z
function signGeo(uv, faces, posts = 1) {
  const k = new Kit(), top = Math.max(...faces.map((f) => f.y + f.h / 2)), wMax = Math.max(...faces.map((f) => f.w));
  const xs = posts === 2 ? [-wMax * 0.36, wMax * 0.36] : [0];
  for (const x of xs) k.box(0.1, top + 0.45, 0.1, tf(x, (top + 0.05) / 2 - 0.2, -0.07), POST, { gloss: 0.05 });
  for (const f of faces) {
    k.box(f.w, f.h, 0.025, tf(0, f.y, 0), BACK, { gloss: 0.3 });
    k.add(new THREE.PlaneGeometry(f.w - 0.01, f.h - 0.01), tf(0, f.y, 0.014), FACE, { gloss: 0.25, retro: 1, flat: false, uv: uv[f.cell] });
  }
  return k.build();
}

export function buildProps(world) {
  const { engine, route, scenario } = world, R = scenario.road;
  const atlas = drawSignAtlas(scenario), mat = propMaterial({ atlas: atlas.tex });
  const group = new THREE.Group(), signs = {};
  const place = (id, geo, s, u, toe = 0.12) => {
    const m = new THREE.Mesh(geo, mat), f = route.frame(s), w = route.toWorld(s, u);
    m.position.set(w[0], w[1], w[2]); m.rotation.y = Math.atan2(-f.tx, -f.tz) + (u > 0 ? toe : -toe);
    m.frustumCulled = false; group.add(m); signs[id] = { s, u, mesh: m };
  };
  const hw = route.halfWidth;
  place('entry', signGeo(atlas.uv, [{ cell: 'channel', w: 1.5, h: 1.05, y: 2.75 }, { cell: 'rules', w: 1.5, h: 1.05, y: 1.62 }], 2), -7, hw + 2.3, 0.2);
  place('hauling', signGeo(atlas.uv, [{ cell: 'hauling', w: 1.3, h: 0.72, y: 1.9 }]), 46, hw + 1.9);
  atlas.kms.slice(0, 4).forEach((km, i) => place('km' + km, signGeo(atlas.uv, [{ cell: 'km' + km, w: 0.62, h: 0.87, y: 1.75 }]), i * R.kmSpacing, hw + 1.5));
  place('mustcall', signGeo(atlas.uv, [{ cell: 'mustcall', w: 0.95, h: 0.95, y: 1.85 }]), scenario.layout.mustCallS, hw + 1.6);
  engine.scene.add(group);
  return { group, signs, atlas };
}
