// Automatic graphics. A small controller that watches the real frame time all the way through a
// run and moves the picture quality down or up a ladder of rungs to hold a playable frame rate
// on whatever machine the player has. Pure (no browser code): tested in node, used by main.js.
//
// Every rung only changes numbers the renderer reads each frame (render resolution, fog march
// steps, cloud march steps, how far trees and plants are drawn), so a change needs no shader
// compile and causes no hitch. world.setRung() applies a rung.
//
// The ladder, best first. Each step down takes away the thing a player is least likely to notice:
//   res   render resolution, as a fraction of the tier's resolution
//   fog   fraction of the full number of steps in the headlight fog march
//   range fraction of the full draw distance of trees and roadside plants
//   cloud fraction of the full number of steps in the cloud march (dusk view)
export const RUNGS = [
  { res: 1.00, fog: 1.00, range: 1.00, cloud: 1.00 },
  { res: 0.86, fog: 1.00, range: 1.00, cloud: 1.00 },
  { res: 0.86, fog: 0.72, range: 1.00, cloud: 0.80 },
  { res: 0.74, fog: 0.72, range: 0.85, cloud: 0.80 },
  { res: 0.74, fog: 0.50, range: 0.85, cloud: 0.62 },
  { res: 0.64, fog: 0.50, range: 0.70, cloud: 0.62 },
  { res: 0.55, fog: 0.36, range: 0.70, cloud: 0.50 },
  { res: 0.47, fog: 0.36, range: 0.55, cloud: 0.50 },
  { res: 0.40, fog: 0.28, range: 0.55, cloud: 0.40 },
];

// Rules (all times in seconds of play, frame times in milliseconds):
//   - Average frame time above `slow` for `downAfter`: step down one rung (two if it is very slow).
//     Above the `comfort` rung `slow` is 30 ms, so the game gives up a little quality to reach a
//     smooth 60 frames a second. At and below `comfort` it is `slowLow` (40 ms): from there on it
//     only gives up more quality to stay above 30 frames a second.
//   - Average below `good` for `upAfter`: try one rung up.
//   - If a step up has to be undone within `regret` seconds, wait longer before the next try
//     (8 s, then 20, 50, 125, up to 240), so it never flips back and forth.
//   - After any change, wait `settle` before judging again. Frames longer than 400 ms (the tab
//     was hidden, the machine stalled) are ignored.
export function createGovernor(o = {}) {
  const n = o.rungs || RUNGS.length;
  const cfg = { slow: 30, slowLow: 40, good: 19.5, comfort: 4, downAfter: 1.2, upAfter: 4, settle: 1.0, regret: 12, firstWait: 8, maxWait: 240, ...o };
  const g = {
    rung: Math.max(0, Math.min(n - 1, o.start || 0)), best: o.best || 0, worst: o.worst ?? n - 1,
    ms: 0, t: 0, changes: 0, locked: false, log: [],
    over: 0, under: 0, holdUntil: 0, blockUntil: 0, wait: cfg.firstWait, lastUpAt: -1e9, fresh: true,
  };
  function set(r, why) {
    g.rung = r; g.over = g.under = 0; g.holdUntil = g.t + cfg.settle; g.fresh = true; g.changes++;
    g.log.push({ t: +g.t.toFixed(1), rung: r, ms: +g.ms.toFixed(1), why });
    if (g.log.length > 60) g.log.shift();
    return r;
  }
  // One frame took `ms`. Returns the new rung when it changes, otherwise -1.
  g.sample = (ms) => {
    if (g.locked || !(ms > 0) || ms > 400) return -1;
    const dt = ms / 1000; g.t += dt;
    if (g.t < g.holdUntil) return -1;
    g.ms = g.fresh ? ms : g.ms + (ms - g.ms) * Math.min(1, dt / 0.6); g.fresh = false;
    const slow = g.rung < cfg.comfort ? cfg.slow : cfg.slowLow;
    if (g.ms > slow) { g.over += dt; g.under = 0; }
    else if (g.ms < cfg.good) { g.under += dt; g.over = 0; }
    else { g.over = Math.max(0, g.over - dt); g.under = 0; }
    if (g.over > cfg.downAfter && g.rung < g.worst) {
      if (g.t - g.lastUpAt < cfg.regret) g.wait = Math.min(cfg.maxWait, g.wait * 2.5);
      g.blockUntil = g.t + g.wait;
      return set(Math.min(g.worst, g.rung + (g.ms > slow * 1.7 ? 2 : 1)), 'slow');
    }
    if (g.under > cfg.upAfter && g.rung > g.best && g.t > g.blockUntil) { g.lastUpAt = g.t; return set(g.rung - 1, 'room'); }
    return -1;
  };
  // pin to one rung (a manual graphics choice) or hand control back
  g.lock = (rung) => { g.locked = true; if (rung != null) g.rung = Math.max(0, Math.min(n - 1, rung)); return g.rung; };
  g.unlock = () => { g.locked = false; g.fresh = true; g.over = g.under = 0; };
  return g;
}
