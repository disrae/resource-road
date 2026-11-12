// Keyboard, and a gamepad if one is plugged in (optional: the game is fully playable on keys).
//   drive: arrow keys or W A S D. Holding brake at a standstill reverses.
//   onKey(e) gets every key press first (cards and screens use it); return true to swallow it.
const DRIVE = { ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' };
const PAD_KEYS = { 0: 'Enter', 1: 'Escape', 2: 'r', 3: 'c', 9: 'Escape', 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight' };

export function createInput(target, onKey) {
  const held = new Set(), padPrev = {};
  const st = { throttle: 0, brake: 0, steer: 0, pad: false };
  const clear = () => held.clear();
  target.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (DRIVE[e.key] || e.key === ' ' || e.key === 'Enter') e.preventDefault();
    if (onKey(e)) return;
    if (DRIVE[e.key]) held.add(DRIVE[e.key]);
  });
  target.addEventListener('keyup', (e) => { if (DRIVE[e.key]) held.delete(DRIVE[e.key]); });
  target.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', clear);

  function poll() {
    let throttle = held.has('up') ? 1 : 0, brake = held.has('down') ? 1 : 0, steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected && p.mapping === 'standard') { gp = p; break; }
    st.pad = !!gp;
    if (gp) {
      const ax = gp.axes[0] || 0, dead = 0.14;
      if (Math.abs(ax) > dead) steer = Math.max(-1, Math.min(1, steer + Math.sign(ax) * (Math.abs(ax) - dead) / (1 - dead)));
      throttle = Math.max(throttle, gp.buttons[7] ? gp.buttons[7].value : 0);
      brake = Math.max(brake, gp.buttons[6] ? gp.buttons[6].value : 0);
      for (const [i, key] of Object.entries(PAD_KEYS)) {
        const down = !!(gp.buttons[i] && gp.buttons[i].pressed);
        if (down && !padPrev[i]) onKey({ key, repeat: false, pad: true, preventDefault() {} });
        padPrev[i] = down;
      }
    }
    st.throttle = throttle; st.brake = brake; st.steer = steer;
    return st;
  }
  return { poll, clear, state: st };
}
