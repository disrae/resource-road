// WHERE A SCENARIO HAPPENS. The world is built from two things, and this file is the one place
// that decides both:
//
//   terrain   a height in metres for any world position (x east, z south, metres from the centre
//             of the 16 km square the engine simulates). Today that is the Mistline engine's
//             generated mountain terrain. A real-terrain source (elevation tiles, satellite
//             colour) will come in through the engine; nothing here or in the game depends on
//             how the heights were made.
//   road      the centreline the corridor is built along. Today it is traced over the terrain
//             like a surveyed side-hill road (route.js). With a `location` block in the scenario
//             it follows that block's road line instead.
//
// Everything else (the rules, the cards, the reporting) only knows distances along the road, so a
// real place needs no change outside this file, route.js and the engine's terrain.
//
// placeFor(scenario) -> { terrain: 'generated', road: options for buildRoute(), layout }
import { ROUTE_DEFAULTS } from './route.js';

const M_PER_DEG = 110574;                    // metres per degree of latitude

// [lat, lon] in decimal degrees -> world [x, z] in metres, with `centre` put at `anchor`.
// A flat local projection: good to well under a metre over the few kilometres of one road.
export function project(latLon, centre, anchor = [0, 0]) {
  const east = (latLon[1] - centre[1]) * 111320 * Math.cos(centre[0] * Math.PI / 180);
  const north = (latLon[0] - centre[0]) * M_PER_DEG;
  return [anchor[0] + east, anchor[1] - north];
}

export function placeFor(scenario) {
  const loc = scenario.location || null, layout = scenario.layout;
  const place = { terrain: 'generated', road: {}, layout, location: loc };
  if (!loc) return place;
  // On generated terrain the centre of the location is put where the built-in road starts, a part
  // of the generated mountains known to carry a road well. A real-terrain source would centre the
  // terrain itself on loc.centre and use anchor [0, 0].
  const anchor = ROUTE_DEFAULTS.start;
  if (Array.isArray(loc.road) && loc.road.length > 1) {
    const centre = loc.centre || loc.road[0];
    place.road = { path: loc.road.map((p) => project(p, centre, anchor)), pathZero: loc.zeroAt || 0 };
  } else if (typeof loc.startHeading === 'number') {
    // no road line: trace a road over the terrain, setting off in this compass direction
    place.road = { heading: loc.startHeading - 90 };
  }
  return place;
}
