// Scene dials, presets and URL (de)serialisation. Pure JS, unit-tested in node.

// key: [min, max, default, step, label, unit, group]
export const DIALS = {
  seed:        [1, 99999, 7, 1, 'Terrain seed', '', 'Land'],
  season:      [0, 1, 0.42, 0.005, 'Season', '', 'Land'],
  time:        [0, 24, 5.8, 0.01, 'Time of day', 'h', 'Sky'],
  daySpeed:    [0, 120, 0, 0.5, 'Day speed', 'min/s', 'Sky'],
  highCloud:   [0, 1, 0.25, 0.01, 'High cloud', '', 'Sky'],
  haze:        [0, 1, 0.3, 0.01, 'Haze', '', 'Sky'],
  moisture:    [0, 1.3, 0.72, 0.005, 'Moisture', '', 'Weather'],
  cloudBase:   [0, 2600, 700, 10, 'Cloud base', 'm', 'Weather'],
  inversion:   [0, 1, 0.2, 0.01, 'Inversion', '', 'Weather'],
  temperature: [-12, 30, 11, 0.1, 'Sea-level temp', 'C', 'Weather'],
  windDir:     [0, 360, 250, 1, 'Wind from', 'deg', 'Weather'],
  windSpeed:   [0, 30, 7, 0.1, 'Wind speed', 'm/s', 'Weather'],
  precip:      [0, 1, 0.3, 0.01, 'Rain / snow', '', 'Weather'],
  weatherSpeed:[0, 240, 40, 1, 'Weather speed', 'x', 'Weather'],
  exposure:    [-2.5, 2.5, 0, 0.05, 'Exposure', 'EV', 'Look'],
  contrast:    [0, 1, 0.5, 0.01, 'Contrast', '', 'Look'],
  saturation:  [0, 1.6, 1, 0.01, 'Saturation', '', 'Look'],
  warmth:      [-1, 1, 0, 0.01, 'Warmth', '', 'Look'],
  fov:         [18, 95, 52, 1, 'Field of view', 'deg', 'Look'],
};

export const DIAL_KEYS = Object.keys(DIALS);
const CYCLIC = { windDir: 360, time: 24, season: 1 };

export function defaults() {
  const o = {};
  for (const k of DIAL_KEYS) o[k] = DIALS[k][2];
  return o;
}

export function clampDial(k, v) {
  const d = DIALS[k];
  if (!d || !Number.isFinite(v)) return d ? d[2] : v;
  if (CYCLIC[k] && k !== 'season') { const m = CYCLIC[k]; v = ((v % m) + m) % m; }
  return Math.min(d[1], Math.max(d[0], v));
}

// Presets only set the dials they care about. view = [camera altitude, look-at altitude] at the mouth of the inlet.
export const PRESETS = [
  { id: 'inversion', view: [1900, 900], name: 'Morning inversion', blurb: 'Peaks above a cloud sea, first light',
    d: { time: 6.9, moisture: 0.95, cloudBase: 250, inversion: 1, temperature: 6, windDir: 265, windSpeed: 2.2, precip: 0, highCloud: 0.2, haze: 0.25, season: 0.78 } },
  { id: 'marine', view: [1300, 300], name: 'Marine layer rolling in', blurb: 'Low stratus sliding up the inlet',
    d: { time: 19.1, moisture: 0.82, cloudBase: 180, inversion: 0.85, temperature: 15, windDir: 270, windSpeed: 8, precip: 0, highCloud: 0.35, haze: 0.35, season: 0.5 } },
  { id: 'river', view: [70, 500], name: 'Atmospheric river', blurb: 'Deep moisture, rain on every windward slope',
    d: { time: 13.5, moisture: 1.25, cloudBase: 420, inversion: 0, temperature: 9, windDir: 235, windSpeed: 19, precip: 1, highCloud: 0.9, haze: 0.6, season: 0.88 } },
  { id: 'clearing', view: [300, 900], name: 'Clearing storm at sunset', blurb: 'Torn cloud, shafts of low sun',
    d: { time: 19.3, moisture: 0.6, cloudBase: 900, inversion: 0.1, temperature: 12, windDir: 285, windSpeed: 11, precip: 0.35, highCloud: 0.45, haze: 0.3, season: 0.45 } },
  { id: 'alpenglow', view: [900, 1700], name: 'Alpenglow', blurb: 'Pink snow, valley mist, deep blue shadow',
    d: { time: 15.85, moisture: 0.5, cloudBase: 250, inversion: 0.8, temperature: -2, windDir: 300, windSpeed: 2, precip: 0, highCloud: 0.18, haze: 0.2, season: 0.04 } },
  { id: 'moon', view: [1300, 1000], name: 'Moonlit fog', blurb: 'Silver fog under a high moon and stars',
    d: { time: 0.6, moisture: 0.9, cloudBase: 150, inversion: 0.9, temperature: 3, windDir: 80, windSpeed: 1.6, precip: 0, highCloud: 0.08, haze: 0.2, season: 0.92 } },
  { id: 'bluebird', view: [1500, 1500], name: 'Bluebird day', blurb: 'Cold, clear, a few caps on the summits',
    d: { time: 11.2, moisture: 0.38, cloudBase: 1900, inversion: 0.1, temperature: 5, windDir: 320, windSpeed: 6, precip: 0, highCloud: 0.05, haze: 0.08, season: 0.12 } },
];

// Interpolate dials a -> b. Cyclic dials (wind direction, time) take the short way round.
export function lerpDials(a, b, t) {
  const o = {};
  for (const k of DIAL_KEYS) {
    const x = a[k], y = b[k];
    if (k === 'seed') { o[k] = t < 0.5 ? x : y; continue; }
    if (CYCLIC[k] && k !== 'season') {
      const m = CYCLIC[k];
      let d = ((y - x) % m + m) % m; if (d > m / 2) d -= m;
      o[k] = ((x + d * t) % m + m) % m;
    } else o[k] = x + (y - x) * t;
  }
  return o;
}

const SHORT = {
  seed: 's', season: 'se', time: 't', daySpeed: 'ds', highCloud: 'hc', haze: 'hz', moisture: 'm',
  cloudBase: 'cb', inversion: 'iv', temperature: 'tc', windDir: 'wd', windSpeed: 'ws', precip: 'p',
  weatherSpeed: 'wx', exposure: 'ev', contrast: 'ct', saturation: 'sa', warmth: 'wa', fov: 'f',
};
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const r3 = (v) => String(Math.round(v * 1000) / 1000);

// state = { dials, cam: {pos:[x,y,z], yaw, pitch}, quality?: string }
export function encodeState(state) {
  const parts = [];
  for (const k of DIAL_KEYS) parts.push(`${SHORT[k]}=${r3(state.dials[k])}`);
  if (state.cam) {
    const c = state.cam;
    parts.push('c=' + [c.pos[0], c.pos[1], c.pos[2]].map((v) => Math.round(v * 10) / 10).join(',') +
      ',' + r3(c.yaw) + ',' + r3(c.pitch));
  }
  if (state.quality) parts.push('q=' + state.quality);
  return parts.join('&');
}

export function decodeState(hash) {
  const dials = defaults();
  const out = { dials, cam: null, quality: null };
  const s = String(hash || '').replace(/^#/, '');
  if (!s) return out;
  for (const part of s.split('&')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i), val = part.slice(i + 1);
    if (key === 'c') {
      const n = val.split(',').map(Number);
      if (n.length === 5 && n.every(Number.isFinite)) out.cam = { pos: [n[0], n[1], n[2]], yaw: n[3], pitch: n[4] };
    } else if (key === 'q') {
      if (/^[a-z]{1,8}$/.test(val)) out.quality = val;
    } else if (LONG[key]) {
      const v = Number(val);
      if (Number.isFinite(v)) dials[LONG[key]] = clampDial(LONG[key], v);
    }
  }
  dials.seed = Math.round(dials.seed);
  return out;
}

export function seasonName(s) {
  return ['Midwinter', 'Late winter', 'Spring', 'Early summer', 'High summer', 'Late summer', 'Autumn', 'Early winter'][Math.floor(((s % 1) + 1) % 1 * 8) % 8];
}
