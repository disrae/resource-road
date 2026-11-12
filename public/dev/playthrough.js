// Development helper, not part of the game. Loaded by hand in the browser console (or by an
// automation script) on a page opened with ?manual=1:
//
//   await import('/dev/playthrough.js');
//   await playthrough('good', 'pg', { driveEvery: 25 });   // call again until it reports done=true
//
// It lets one of the scripted players (see game/rules/bot.js) play a whole run with the game
// stepped by hand, and saves a still of every card and of the drive every `driveEvery` seconds
// through the dev server (shots/tmp/). One call works for at most `wall` ms so an automation
// tool with a time limit can call it repeatedly; the state is kept in window.PT.
window.PT = null;
window.playthrough = async (policy, prefix, o = {}) => {
  const g = window.__game;
  if (!window.PT || window.PT.prefix !== prefix) { g.setBot(policy); window.PT = { prefix, n: 0, last: null, t: 0, log: [], lastDrive: -99, done: false }; }
  const P = window.PT, W = o.w || 800, wall = performance.now(); const from = P.log.length;
  while (g.scene !== 'summary' && P.t < (o.max || 900) && performance.now() - wall < (o.wall || 28000)) {
    const dt = g.advance(0.5, { renderEvery: 1000, until: () => g.ui.card && g.ui.card !== P.last });
    P.t += dt + 1 / 30;
    const c = g.ui.card, st = g.state;
    if (c && c !== P.last) {
      P.last = c; g.advance(0.07, { renderEvery: 1000 }); P.t += 0.07;
      const nm = `${prefix}-${String(P.n++).padStart(2, '0')}-${c.kind}-${(c.id || c.title || '').toString().replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`;
      if (!o.only || o.only(c)) await g.snap(nm, { w: W });
      P.log.push(`${P.t.toFixed(0)}s ${nm} s=${st ? st.car.s.toFixed(0) : ''}`);
    } else if (!c && st && st.phase === 'drive' && o.driveEvery && P.t - P.lastDrive > o.driveEvery) {
      P.lastDrive = P.t;
      const nm = `${prefix}-${String(P.n++).padStart(2, '0')}-drive-${st.car.s.toFixed(0)}`;
      await g.snap(nm, { w: W }); P.log.push(`${P.t.toFixed(0)}s ${nm} enc=${st.enc}`);
    }
  }
  if (g.scene === 'summary' && !P.done) { P.done = true; g.advance(3, { renderEvery: 1000 }); await g.snap(`${prefix}-${String(P.n++).padStart(2, '0')}-summary`, { w: W }); }
  return P.log.slice(from).join('\n') + `\nt=${P.t.toFixed(0)} scene=${g.scene} done=${P.done} events=${g.events.length}`;
};

// Let a scripted player play (no stills) until the pickup has passed road position `s` (metres),
// the summary screen is reached, or `wall` ms have gone by. Returns where it stopped.
window.runTo = (policy, s, o = {}) => {
  const g = window.__game, wall = performance.now();
  if (!window.RT || window.RT !== policy) { g.setBot(policy); window.RT = policy; }
  while (g.scene !== 'summary' && performance.now() - wall < (o.wall || 25000)) {
    const st = g.state;
    if (st && st.phase === 'drive' && st.car.s >= s && !g.ui.card) break;
    if (o.enc && st && st.enc === o.enc) break;
    g.advance(0.5, { renderEvery: 1000 });
  }
  const st = g.state;
  return { scene: g.scene, s: st ? +st.car.s.toFixed(0) : null, enc: st ? st.enc : null, phase: st ? st.phase : null };
};
