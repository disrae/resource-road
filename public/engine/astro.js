// Sun / moon geometry and a small CPU atmosphere model for light colours.
// World axes: +x east, +y up, +z south. Latitude is fixed near Vancouver.
const LAT = 49.3 * Math.PI / 180;
const D2R = Math.PI / 180;

function enuToWorld(H, dec) {
  const e = -Math.cos(dec) * Math.sin(H);
  const n = Math.cos(LAT) * Math.sin(dec) - Math.sin(LAT) * Math.cos(dec) * Math.cos(H);
  const u = Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H);
  return [e, u, -n];
}

// time in hours (solar time), season 0 = midwinter, 0.5 = midsummer.
export function sunDirection(time, season) {
  const dec = -23.44 * D2R * Math.cos(2 * Math.PI * season);
  return enuToWorld((time - 12) * 15 * D2R, dec);
}

// A near-full moon: roughly opposite the sun, riding high in winter and low in summer.
export function moonDirection(time, season) {
  const dec = 21 * D2R * Math.cos(2 * Math.PI * season);
  return enuToWorld((time - 12) * 15 * D2R + Math.PI * 0.94, dec);
}

export const elevation = (d) => Math.asin(Math.max(-1, Math.min(1, d[1])));

// Relative optical air mass (Kasten & Young), usable slightly below the horizon.
export function airMass(elRad) {
  const e = Math.max(-1.5, elRad / D2R);
  return 1 / (Math.sin(Math.max(e, -1.5) * D2R) + 0.50572 * Math.pow(e + 6.07995, -1.6364));
}

const TAU_R = [0.0487, 0.1134, 0.278];     // vertical Rayleigh optical depth, RGB
const TAU_O = [0.012, 0.032, 0.003];       // ozone (Chappuis band)

// Colour of direct light from a body at elevation el, for an observer at height y (m).
export function transmittance(elRad, haze = 0.3, y = 0) {
  const m = airMass(elRad) * Math.exp(-Math.max(0, y) / 8400);
  const tm = 0.035 + 0.22 * haze;
  const below = Math.min(1, Math.max(0, (elRad / D2R + 1.6) / 1.6)); // fades out by -1.6 deg
  const f = below * below * (3 - 2 * below);
  return [0, 1, 2].map((i) => Math.exp(-m * (TAU_R[i] + TAU_O[i] + tm)) * f);
}

// Everything the renderer needs to know about the lights for a given time.
export function lighting(time, season, haze) {
  const sun = sunDirection(time, season), moon = moonDirection(time, season);
  const sEl = elevation(sun), mEl = elevation(moon);
  const sunT = transmittance(sEl, haze);
  const moonT = transmittance(mEl, haze);
  const SUN = 22.0, MOON = 0.05;                       // radiometric scales (arbitrary units)
  const sunCol = sunT.map((v) => v * SUN);
  const moonCol = moonT.map((v, i) => v * MOON * [0.82, 0.9, 1.0][i]);
  // primary light: sun until it is well set, then the moon fades in
  const useSun = sEl > -3.0 * D2R;
  const moonFade = Math.min(1, Math.max(0, (-3.0 * D2R - sEl) / (5 * D2R)));
  const day = Math.min(1, Math.max(0, (sEl / D2R + 7) / 14));    // 0 night .. 1 day
  const night = 1 - Math.min(1, Math.max(0, (sEl / D2R + 12) / 10));
  return {
    sun, moon, sunEl: sEl, moonEl: mEl,
    sunCol, moonCol: moonCol.map((v) => v * (useSun ? 0 : moonFade)),
    lightDir: useSun ? sun : moon,
    lightCol: useSun ? sunCol : moonCol.map((v) => v * moonFade),
    day, night,
    // auto exposure: brighten twilight and night so the scene stays readable
    autoExposure: Math.pow(2, 6.6 * night + 1.7 * (1 - day) * (1 - night)),
  };
}
