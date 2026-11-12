// Sound, all synthesised in the browser (no audio files): engine, gravel, the logging truck,
// horn, radio squelch, and the bumps and bangs. Optional spoken radio calls use the browser's own
// speech voice. Nothing here is needed to play: every call is also shown as text.
// The audio context is only created after the first key press or click (browsers require that).

export function createAudio({ muted = false, voice = true } = {}) {
  let ctx = null, master = null, noiseBuf = null, eng = null, grav = null, trk = null;
  const A = { muted, voice, ready: false };

  function noise() {
    if (noiseBuf) return noiseBuf;
    const n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); let b = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b = b * 0.6 + w * 0.4; d[i] = b * 1.6; }
    return noiseBuf;
  }
  const gain = (v, to = master) => { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; };
  const filt = (type, f, q, to) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.connect(to); return b; };
  const osc = (type, f, to) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(to); o.start(); return o; };
  const loopNoise = (to) => { const s = ctx.createBufferSource(); s.buffer = noise(); s.loop = true; s.connect(to); s.start(); return s; };

  // call from a key press or click
  function unlock() {
    if (A.ready || A.muted) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      ctx = new AC(); master = gain(0.8, ctx.destination);
      // the pickup: two saws and a sub through a low-pass
      const eg = gain(0), ef = filt('lowpass', 220, 1.2, eg);
      eng = { g: eg, f: ef, a: osc('sawtooth', 52, ef), b: osc('sawtooth', 78.4, ef), c: osc('triangle', 26, eg) };
      const gg = gain(0), gf = filt('bandpass', 900, 0.5, gg); loopNoise(gf); grav = { g: gg, f: gf };
      const tg = gain(0), tf = filt('lowpass', 150, 2, tg);
      trk = { g: tg, f: tf, a: osc('sawtooth', 34, tf), b: osc('square', 51.3, tf) }; loopNoise(filt('lowpass', 420, 0.4, tg));
      A.ready = true;
    } catch (e) { ctx = null; }
  }

  // every frame while driving: speed (m/s), throttle 0..1, how far off the road, truck distance (m, or null)
  function drive(o) {
    if (!A.ready) return;
    const t = ctx.currentTime, v = Math.abs(o.speed || 0), on = o.on ? 1 : 0;
    const f = 44 + v * 4.2 + (o.throttle || 0) * 16 + (o.spin || 0) * 60;
    eng.a.frequency.setTargetAtTime(f, t, 0.08); eng.b.frequency.setTargetAtTime(f * 1.505, t, 0.08); eng.c.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    eng.f.frequency.setTargetAtTime(170 + v * 22 + (o.throttle || 0) * 260, t, 0.1);
    eng.g.gain.setTargetAtTime(on * (0.045 + 0.05 * (o.throttle || 0) + 0.002 * v), t, 0.12);
    grav.g.gain.setTargetAtTime(on * Math.min(0.2, v * 0.011 * (1 + (o.off || 0) * 1.5) + (o.spin || 0) * 0.16), t, 0.1);
    grav.f.frequency.setTargetAtTime(600 + v * 90, t, 0.2);
    const d = o.truck;
    trk.g.gain.setTargetAtTime(on && d != null ? Math.min(0.5, 14 / (8 + Math.abs(d)) ** 1.25) : 0, t, 0.15);
    trk.f.frequency.setTargetAtTime(d != null ? 120 + 2600 / (10 + Math.abs(d)) : 120, t, 0.2);
  }
  function quiet() { if (A.ready) drive({ on: false }); }

  function burst(dur, freq, q, vol, type = 'bandpass') {
    const g = gain(0), f = filt(type, freq, q, g), s = ctx.createBufferSource(), t = ctx.currentTime;
    s.buffer = noise(); s.connect(f); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  function tone(type, f0, f1, dur, vol, at = 0) {
    const g = gain(0), o = ctx.createOscillator(), t = ctx.currentTime + at;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  function horn(dur) {
    const t = ctx.currentTime, g = gain(0), f = filt('lowpass', 1500, 0.7, g);
    for (const hz of [277, 349, 415]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz; o.connect(f); o.start(t); o.stop(t + dur + 0.2); }
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.3, t + 0.06); g.gain.setValueAtTime(0.3, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.15);
  }
  function sfx(name) {
    if (!A.ready || A.muted) return;
    if (name === 'horn') horn(0.9);
    else if (name === 'horn-long') horn(2.4);
    else if (name === 'squelch') burst(0.16, 2400, 1.2, 0.12);
    else if (name === 'static') burst(0.9, 1800, 0.6, 0.07);
    else if (name === 'thump') { tone('sine', 120, 45, 0.22, 0.4); burst(0.12, 300, 0.8, 0.12, 'lowpass'); }
    else if (name === 'bang') { tone('sine', 160, 38, 0.4, 0.6); burst(0.3, 900, 0.5, 0.35); tone('sawtooth', 700, 180, 1.4, 0.05, 0.3); }
    else if (name === 'spin') { burst(1.6, 700, 0.6, 0.3); tone('sawtooth', 90, 190, 1.4, 0.12); }
    else if (name === 'click') tone('square', 880, 660, 0.05, 0.04);
    else if (name === 'good') { tone('sine', 660, 660, 0.12, 0.08); tone('sine', 880, 880, 0.18, 0.08, 0.1); }
    else if (name === 'bad') tone('triangle', 220, 150, 0.3, 0.12);
  }
  // a call heard on the radio
  function say(text, who) {
    if (A.muted) return;
    sfx(who === 'static' ? 'static' : 'squelch');
    if (!A.voice || who === 'me' || who === 'static' || !window.speechSynthesis) return;
    try {
      const u = new SpeechSynthesisUtterance(text); u.rate = 1.08; u.pitch = who === 'other' ? 1.0 : 0.75; u.volume = 0.85; u.lang = 'en-CA';
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) { /* no voice: the caption is enough */ }
  }
  function setMuted(m) {
    A.muted = !!m;
    if (A.muted) { if (master) master.gain.value = 0; try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    else if (master) master.gain.value = 0.8; else unlock();
  }
  return Object.assign(A, { unlock, drive, quiet, sfx, say, setMuted });
}
