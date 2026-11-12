// Offline video capture. Every frame advances the game by exactly 1/fps seconds, however long it
// takes to draw, so a clip is smooth at any quality: meant for the Film graphics level (?q=film),
// which is too heavy to play live. Works at any level, in a browser with WebCodecs (Chrome, Edge).
//
// From the browser console (see HANDOVER.md, "Recording video"):
//   await __game.film.record({ move: 'pass', seconds: 20 })      // saves an .mp4 (download)
//
// A scripted player (rules/bot.js) drives. Only the 3D picture is recorded: the cards, the speed
// and radio display and the captions are page elements and are not in the clip.
import { Mp4Muxer } from './mp4mux.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const even = (v) => Math.max(2, Math.round(v / 2) * 2);
const CODECS = ['avc1.640034', 'avc1.640033', 'avc1.640032', 'avc1.64002A', 'avc1.640028', 'avc1.4D4028', 'avc1.42E01F'];

async function pickEncoderConfig(w, h, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const hw of ['prefer-hardware', 'no-preference', 'prefer-software']) {
    for (const codec of CODECS) {
      const cfg = { codec, width: w, height: h, framerate: fps, bitrate, avc: { format: 'avc' }, hardwareAcceleration: hw, latencyMode: 'quality' };
      try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return cfg; } catch (e) { /* try the next */ }
    }
  }
  return null;
}

// Ready-made camera moves. `ready(st)` says when the scripted run has reached the place where
// the clip starts; `cam(t, st, set)` places the camera for the frame at t seconds into the clip:
// set(from, to, fov) with from and to as [s along the road, u across it, height above it] in metres.
export const MOVES = {
  // the driver's view, as played
  cab: { label: 'Driver\'s view on the night road', ready: (st, o) => st.phase === 'drive' && st.car.s >= (o.at ?? 320) },
  // behind and above the pickup as it drives into the fog, drifting slowly from side to side
  follow: {
    label: 'Following the pickup',
    ready: (st, o) => st.phase === 'drive' && st.car.s >= (o.at ?? 320),
    cam(t, st, set) {
      const c = st.car, side = -1.6 + 1.5 * Math.sin(t * 0.21), back = 9.5 - 1.5 * Math.sin(t * 0.13 + 1);
      set([c.s - back, c.u * 0.5 + side, 2.7 + 0.5 * Math.sin(t * 0.17)], [c.s + 16, c.u * 0.7, 1.1], 52);
    },
  },
  // from the back of the pullout: the pickup parked in the foreground, the logging truck's lights
  // growing in the fog, the truck going by, the camera turning to watch it leave
  pass: {
    label: 'The logging truck passing the pullout',
    seconds: 16,
    // the clip starts when the truck is `gap` metres up the road (it comes at about 6 m a second)
    ready: (st, o) => st.enc === 'waiting' && st.truck.active && st.truck.s - st.car.s < (o.gap ?? 60),
    cam(t, st, set, mem) {
      const c = st.car, tr = st.truck;
      if (mem.s == null) { mem.s = c.s; mem.u = c.u; mem.look = tr.s; }
      // watch the truck, but never look further behind than 60 m down the road
      const want = Math.max(mem.s - 60, tr.s - 4);
      mem.look += (want - mem.look) * 0.12;
      set([mem.s - 8.5, mem.u + 1.3, 2.0 + 0.15 * Math.sin(t * 0.3)], [mem.look, 0.3, 1.9], 46);
    },
  },
};

// game: what main.js hands over (see there). Returns the object published as __game.film.
export function createFilm(game) {
  const { world, G } = game, engine = world.engine, route = world.route, cam = engine.camera;
  const film = { moves: MOVES, busy: false, last: null, progress: null };

  function setCam(from, to, fov) {
    const a = route.toWorld(from[0], from[1]), b = route.toWorld(to[0], to[1]);
    cam.position.set(a[0], a[1] + from[2], a[2]); cam.up.set(0, 1, 0); cam.lookAt(b[0], b[1] + to[2], b[2]);
    engine.setDial('fov', fov);
  }

  // Start a run with a scripted player and play it, without drawing, up to where the move starts.
  // Works for at most `wall` ms per call (so an automation tool with a time limit can call it
  // again); resolves to true when the place has been reached.
  film.prepare = async (o = {}) => {
    const move = MOVES[o.move || 'follow']; if (!move) throw new Error('unknown move: ' + o.move);
    const t0 = performance.now();
    if (!film.prepared || film.prepared !== (o.move || 'follow') || game.scene() !== 'run') {
      G.manual = true; G.film = true; game.setBot(o.policy || 'good'); game.begin();
      film.prepared = o.move || 'follow';
    }
    let n = 0;
    while (game.scene() === 'run' && !(game.state() && move.ready(game.state(), o) && !G.trans && !game.ui.card)) {
      game.tick(1 / 30, false);
      if (++n % 600 === 0) { await sleep(0); if (performance.now() - t0 > (o.wall || 20000)) return false; }
    }
    if (game.scene() !== 'run') { film.prepared = null; throw new Error('the run ended before the clip could start'); }
    return true;
  };

  // Record a clip. o: { move: 'follow' | 'pass' | 'cab', seconds = 12 (pass: 16), fps = 30, width = 1920,
  // height = 1080, bitrate (bits per second), save: 'download' (default) | 'dev' (the local dev
  // server writes it to shots/tmp/) | false, name, policy = 'good', at / gap (where the move starts) }.
  // Resolves to { blob, name, frames, width, height, fps, seconds, ms, codec, saved }.
  film.record = async (o = {}) => {
    if (film.busy) throw new Error('already recording');
    const moveName = o.move || 'follow', move = MOVES[moveName]; if (!move) throw new Error('unknown move: ' + moveName);
    const fps = o.fps || 30, w = even(o.width || 1920), h = even(o.height || 1080), total = Math.max(1, Math.round((o.seconds || move.seconds || 12) * fps));
    const bitrate = o.bitrate || Math.round(w * h * fps * 0.32);
    const cfg = await pickEncoderConfig(w, h, fps, bitrate);
    if (!cfg) throw new Error('This browser cannot encode H.264 with WebCodecs. Use a current Chrome or Edge.');
    film.busy = true; const t0 = performance.now(), wasManual = G.manual, wasView = G.view;
    let result = null;
    try {
      while (!(await film.prepare({ ...o, move: moveName, wall: 15000 }))) await sleep(0);
      const mem = {}; let t = 0;
      G.view = 'cab';
      G.shot = move.cam ? () => move.cam(t, game.state(), setCam, mem) : null;
      world.resize(w, h, 1, [w, h]);
      for (let i = 0; i < 8; i++) game.tick(0, true);                    // let the picture settle on frame one
      const muxer = new Mp4Muxer({ width: w, height: h, fps, codec: 'avc1' });
      let failure = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => { try { muxer.addChunk(chunk, meta); } catch (e) { failure = e; } }, error: (e) => { failure = e; } });
      enc.configure(cfg);
      for (let i = 0; i < total && !failure && !film.cancel; i++) {
        t = i / fps;
        game.tick(1 / fps, true);
        const frame = new VideoFrame(engine.canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
        frame.close();
        while (enc.encodeQueueSize > 3) await sleep(2);
        film.progress = { frame: i + 1, total, ms: Math.round(performance.now() - t0) };
        if (o.onProgress) o.onProgress(i + 1, total);
        if (i % 2 === 0) await sleep(0);
      }
      if (failure) throw failure;
      await enc.flush();
      if (failure) throw failure;
      try { enc.close(); } catch (e) { /* already closed */ }
      const blob = new Blob(muxer.finalize(), { type: 'video/mp4' });
      const name = o.name || `calling-up-${moveName}-${world.level}-${w}x${h}.mp4`;
      result = { blob, name, frames: muxer.frameCount, width: w, height: h, fps, seconds: muxer.frameCount / fps, ms: Math.round(performance.now() - t0), codec: cfg.codec, level: world.level, saved: null };
      const save = o.save === undefined ? 'download' : o.save;
      if (save === 'dev') result.saved = await (await fetch('/__save?name=' + encodeURIComponent(name), { method: 'POST', body: blob })).text();
      else if (save === 'download') {
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); result.saved = 'download';
      }
    } finally {
      G.shot = null; G.film = false; G.view = wasView; G.manual = wasManual; film.busy = false; film.cancel = false; film.prepared = null;
      game.resize();
    }
    film.last = result;
    return result;
  };
  film.stop = () => { film.cancel = true; };
  return film;
}
