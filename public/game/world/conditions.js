// Weather and time of day for the drive. The scenario file picks one by name (look.condition)
// and can change any part of it (look.conditionTweaks). The opening scene at the staging area
// always uses the scenario's look.stage dials.
//
//   dials      the Mistline engine's own weather dials (time of day in hours, moisture 0..1.3,
//              cloudBase in metres, temperature at sea level in C, precip 0..1, highCloud 0..1,
//              haze 0..1, wind). Anything left out keeps the value from look.stage.
//   fog        null, or { visibility } in metres: ground fog on the road, up to the scenario's
//              look.fogTop altitude. `top` here overrides that altitude.
//   dark       true: night. The exposure is fixed (exposure = brightness) so the dark stays dark
//              and the headlights make the picture. false: the engine meters the scene as usual.
//   snow       0..1 snow lying on the road, the verges, roofs and loads.
//   rain       0..1 falling rain drawn over the picture.
//
// "nightFog" is the condition the game was built and tuned for. The others use what the engine
// can already do and are there so the game can be reused; see HANDOVER.md for which were checked.
export const CONDITIONS = {
  nightFog: { label: 'Night, fog', dials: { time: 20.4 }, fog: { visibility: 95 }, dark: true, exposure: 7, snow: 0, rain: 0 },
  dusk: { label: 'Dusk, clear road', dials: { time: 17.6 }, fog: null, dark: false, snow: 0, rain: 0 },
  clearDay: { label: 'Clear day', dials: { time: 13.5, moisture: 0.35, cloudBase: 1900, inversion: 0.1, temperature: 15, precip: 0, highCloud: 0.12, haze: 0.2 },
    fog: null, dark: false, snow: 0, rain: 0 },
  coldSnow: { label: 'Cold, snow on the ground', dials: { time: 11.5, moisture: 0.5, cloudBase: 1500, inversion: 0.25, temperature: -7, precip: 0.2, highCloud: 0.5, haze: 0.3 },
    fog: null, dark: false, snow: 1, rain: 0 },
  rain: { label: 'Rain, low cloud', dials: { time: 15.5, moisture: 1.05, cloudBase: 520, inversion: 0.1, temperature: 8, precip: 0.95, highCloud: 0.9, haze: 0.5 },
    fog: { visibility: 420, top: 5000 }, dark: false, snow: 0, rain: 1 },
  nightClear: { label: 'Night, no fog', dials: { time: 20.4 }, fog: { visibility: 900, top: 5000 }, dark: true, exposure: 7, snow: 0, rain: 0 },
};

// The condition a scenario asks for: a name, plus optional tweaks laid over it.
export function conditionFor(look, override = null) {
  const name = CONDITIONS[override] ? override : CONDITIONS[look.condition] ? look.condition : 'nightFog';
  const base = CONDITIONS[name], tw = override ? {} : look.conditionTweaks || {};
  return { ...base, ...tw, name, dials: { ...base.dials, ...(tw.dials || {}) }, fog: tw.fog === null ? null : base.fog || tw.fog ? { ...(base.fog || {}), ...(tw.fog || {}) } : null };
}
