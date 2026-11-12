// WHERE THE SCENARIO COMES FROM. As shipped: the built-in scenario (scenario.js), optionally with
// changes laid over it from a JSON file named in the link:
//
//   ?scenario=<address of a JSON file>
//
// This is how a real location, or any other detail that must not be in this (public) repository,
// reaches the game: the file lives outside the repository (on the work side's own server, or
// handed out by its backend together with the session) and only the link points at it.
// NEVER commit a real incident location to this repository.
//
// The JSON holds only the parts that differ, in the same shape as scenario.js, e.g.
//   { "id": "site-visit-3", "road": { "name": "..." }, "location": { ... } }
// Objects are merged key by key; lists and single values replace the built-in ones.
//
// Only addresses on the game's own site are fetched, plus the origins listed here. Add the origin
// of the work side's backend to allow it (an origin is scheme and host, e.g. 'https://example.org').
export const ALLOWED_ORIGINS = [];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// base with extra laid over it (neither is changed)
export function overlay(base, extra) {
  if (!isObj(base) || !isObj(extra)) return extra === undefined ? base : extra;
  const out = { ...base };
  for (const k of Object.keys(extra)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = isObj(base[k]) && isObj(extra[k]) ? overlay(base[k], extra[k]) : extra[k];
  }
  return out;
}

// A location block may give the pullout positions (metres along the road from the first
// kilometre board). They replace the positions in layout.pullouts, keeping length and width.
export function withLocation(scenario) {
  const loc = scenario.location;
  if (!loc || !Array.isArray(loc.pullouts) || !loc.pullouts.length) return scenario;
  const pullouts = scenario.layout.pullouts.map((p, i) => (typeof loc.pullouts[i] === 'number' ? { ...p, s: loc.pullouts[i] } : p));
  return { ...scenario, layout: { ...scenario.layout, pullouts } };
}

// query: the link's URLSearchParams. Resolves to the scenario to play. If the file cannot be
// loaded the built-in scenario is played and `sourceError` on the result says why.
export async function loadScenario(base, query, o = {}) {
  const address = query && query.get('scenario');
  if (!address) return withLocation(base);
  const here = o.origin || globalThis.location.origin, get = o.fetch || globalThis.fetch;
  try {
    const url = new URL(address, o.href || globalThis.location.href);
    if (url.origin !== here && !ALLOWED_ORIGINS.includes(url.origin) && !(o.allow || []).includes(url.origin)) throw new Error('scenario files from ' + url.origin + ' are not allowed (see scenario-source.js)');
    const res = await get(url.href, { credentials: 'omit' });
    if (!res.ok) throw new Error('could not load the scenario file (' + res.status + ')');
    return withLocation(overlay(base, await res.json()));
  } catch (e) {
    console.warn('Playing the built-in scenario:', e.message || e);
    return { ...withLocation(base), sourceError: String(e.message || e) };
  }
}
