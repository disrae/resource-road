// ============================================================================================
// THE REPORTING SEAM. This is the one module to replace to send a run to a backend.
//
// The game calls report(event) once for the start of a run, once for every decision, and once
// for the end of the run. As shipped, events only go into a list in memory (window.__game.events)
// and, with ?debug=1 in the link, to the console. Nothing leaves the browser.
//
// To wire a backend (for example a Convex mutation), change the body of `deliver` below and
// nothing else. `deliver` may be async; the game never waits for it and a failure never stops
// the run (errors are caught and counted in `failed`).
//
// Event shapes (all plain JSON; `v` is the shape version):
//
//   { v: 1, type: 'run_start', runId, session, playerId, at,
//     scenarioId, seed, tier, plan: { faults: { [inspectionId]: boolean }, surfaces: [..] } }
//
//   { v: 1, type: 'decision', runId, session, playerId, at,
//     seq,            // 1, 2, 3 ... in the order decisions were made in this run
//     id,             // stable decision id, e.g. 'call.mustcall' (the catalogue is in scenario.js: `decisions`)
//     choice,         // one of the choice keys listed for that id in the catalogue
//     safe,           // true if it was the safe choice
//     ms,             // time taken to decide, in milliseconds (null where there was nothing to time)
//     detail }        // small object, differs per decision (e.g. { fault: true } for inspection items)
//
//   { v: 1, type: 'run_end', runId, session, playerId, at,
//     outcome,        // 'clean' | 'stuck' | 'damaged' | 'late' | 'nearMiss'
//     outcomes,       // everything that went wrong, e.g. ['late', 'stuck']
//     safe, total,    // how many of the decisions were the safe choice
//     driveSeconds, durationMs }
//
//   session   the code from the link (?s=CODE or #s=CODE), or null when the link carried none
//   playerId  anonymous random id kept in this browser (no name, no login)
//   runId     random id, new for every run (a restart is a new run)
//   at        ISO time on the player's clock
// ============================================================================================

async function deliver(event) {
  // Replace this body to send the event somewhere. Example:
  //   await convex.mutation(api.runs.record, event);
  void event;
}

export const events = [];          // everything reported since the page loaded
export const status = { sent: 0, failed: 0, debug: false };
const listeners = new Set();

export function report(event) {
  events.push(event);
  if (status.debug) console.log('[report]', event.type, event.id || '', event);
  for (const fn of listeners) { try { fn(event); } catch (e) { /* a listener must never break the game */ } }
  try { Promise.resolve(deliver(event)).then(() => { status.sent++; }, () => { status.failed++; }); } catch (e) { status.failed++; }
}
// for the dev events page and tests
export function onReport(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setDebug(on) { status.debug = !!on; }

// Stamps every event of one run with the same ids. The game uses this; a backend never needs to change it.
export function createRunReporter({ session, playerId, runId, now = () => new Date().toISOString() }) {
  const base = () => ({ v: 1, runId, session: session || null, playerId, at: now() });
  const t0 = Date.now();
  return {
    runId,
    start(info) { report({ ...base(), type: 'run_start', ...info }); },
    decision(d) { report({ ...base(), type: 'decision', seq: d.seq, id: d.id, choice: d.choice, safe: d.safe, ms: d.ms, detail: d.detail || {} }); },
    end(summary) { report({ ...base(), type: 'run_end', outcome: summary.outcome, outcomes: summary.outcomes, safe: summary.safe, total: summary.total, driveSeconds: summary.seconds, durationMs: Date.now() - t0 }); },
  };
}
