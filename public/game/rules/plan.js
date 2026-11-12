// What varies between runs. Everything is drawn from one seed text (the session code from the
// link), so everyone in the same session meets the same faults, the same pullouts and the same
// truck, and their decisions can be compared. Pure: no browser, no clock.
import { hashString, mulberry32, shuffle, between } from './rng.js';

export function makePlan(scenario, seedText) {
  const seed = hashString(String(seedText) + '|' + scenario.id), rnd = mulberry32(seed);
  const I = scenario.inspection, ids = I.items.map((it) => it.id);
  const count = Math.round(between(I.faultCount, rnd));
  const faulty = new Set(shuffle(ids, rnd).slice(0, count));
  const faults = {}; for (const id of ids) faults[id] = faulty.has(id);
  // one firm, one mud, one rock pullout; the order is drawn. Extra pullouts (if the scenario has more) are firm.
  const kinds = shuffle(['sound', 'mud', 'rock'], rnd);
  const surfaces = scenario.layout.pullouts.map((_, i) => kinds[i] || 'sound');
  const T = scenario.truck;
  return {
    seedText: String(seedText), seed, faults, surfaces,
    truckSpeed: between(T.speed, rnd),
    truckStartS: T.startKm * scenario.road.kmSpacing + between(T.startJitter, rnd),
  };
}
