// Everything drawn over the 3D view: title, question cards, the radio call builder, the dash
// read-outs, debriefs and the personal end screen. Plain DOM, no framework. All wording comes
// from the scenario file or from the LABELS below.
import { icon } from './icons.js';

export const LABELS = {
  start: 'Start', pressEnter: 'Press Enter', loading: 'Building the road',
  walk: 'Walk-around', of: 'of', send: 'Send', cancel: 'Cancel', kilometre: 'Kilometre', direction: 'Direction',
  up: 'Up', down: 'Down', callTip: 'Keys: 0 to 3 for the kilometre, up or down arrow for the direction, Enter to send, Esc to cancel.',
  heard: 'On the radio', you: 'You', gauge: 'Gauge', placard: 'Door placard', yourRadio: 'Your radio is on', signSays: 'Read the sign at the road entrance',
  whatWorks: 'What works', also: 'Also', safeOf: 'safe decisions', again: 'Play again', session: 'Session', solo: 'Practice run (no session code)',
  missed: 'Missed on the walk-around', remember: 'Take away', right: 'Right.', notQuite: 'Not quite.',
  paused: 'Paused', resume: 'Resume', restart: 'Start again', graphics: 'Graphics', sound: 'Sound', on: 'on', off: 'off',
  keys: [['Arrow keys or W A S D', 'Drive'], ['R', 'Radio'], ['C', 'Change view'], ['Enter', 'Choose'], ['M', 'Sound'], ['Esc', 'Pause']],
  hint: 'R radio   C view   Esc pause',
};

const h = (tag, cls, kids) => {
  const e = document.createElement(tag); if (cls) e.className = cls;
  if (kids != null) for (const k of [].concat(kids)) { if (k == null || k === false) continue; e.append(k.nodeType ? k : document.createTextNode(String(k))); }
  return e;
};
const svg = (name, cls = '') => { const s = h('span', 'ic ' + cls); s.innerHTML = icon(name); return s; };

export function createUI(root, scenario) {
  const S = scenario, R = S.road;
  root.innerHTML = '';
  const fadeEl = h('div', 'fade'), inter = h('div', 'inter'), toasts = h('div', 'toasts'), cardWrap = h('div', 'card-wrap'), screen = h('div', 'screen');
  const speedN = h('b', null, '0'), speed = h('div', 'speed', [speedN, h('span', null, 'km/h')]);
  const radCh = h('span', 'ch', R.channel), radCap = h('span', 'cap'), radWho = h('span', 'who');
  const radio = h('div', 'radio', [svg('radio'), radCh, radWho, radCap]);
  const prompt = h('div', 'prompt'), keys = h('div', 'keys', LABELS.hint);
  const hud = h('div', 'hud', [speed, radio, keys, prompt]);
  root.append(hud, toasts, inter, fadeEl, cardWrap, screen);
  hud.style.display = 'none';

  const ui = { card: null, onAnswer: null, locked: 0, capT: 0, time: 0, toastList: [], screenKind: null, onScreen: null };
  let opts = [], sel = -1, call = null;

  const closeCard = () => { cardWrap.innerHTML = ''; cardWrap.classList.remove('show'); ui.card = null; opts = []; sel = -1; call = null; };
  const answer = (choice) => { if (ui.time < ui.locked || !ui.card) return; const fn = ui.onAnswer; const p = ui.card; closeCard(); if (fn) fn(choice, p); };
  const mark = () => opts.forEach((o, i) => o.el.classList.toggle('sel', i === sel));
  function optionList(list) {
    const box = h('div', 'opts');
    opts = list.map((o, i) => {
      const el = h('button', 'opt', [h('kbd', null, String(i + 1)), h('span', null, o.text)]); el.tabIndex = -1;
      el.addEventListener('click', () => answer(o.id)); el.addEventListener('mouseenter', () => { sel = i; mark(); });
      box.append(el); return { el, id: o.id };
    });
    if (list.length === 1) { sel = 0; mark(); }
    return box;
  }
  function gauge(g, fault) {
    const val = fault ? g.fault : g.ok, a = -120 + 240 * Math.min(1, val / (g.placard * 1.5));
    const d = h('div', 'gauge');
    d.innerHTML = `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="g-rim"/><path d="M21 95 A52 52 0 1 1 99 95" class="g-arc"/><g transform="rotate(${a} 60 60)"><path d="M60 62 L60 18" class="g-needle"/></g><circle cx="60" cy="60" r="5" class="g-hub"/></svg>`;
    d.append(h('div', 'g-text', [h('div', null, [LABELS.gauge + ': ', h('b', null, val + ' ' + g.unit)]), h('div', null, LABELS.placard + ': ' + g.placard + ' ' + g.unit)]));
    return d;
  }

  function showCard(p) {
    closeCard(); ui.card = p; ui.locked = ui.time + 0.35;
    const c = h('div', 'card k-' + p.kind + (p.outcome ? ' o-' + p.outcome : ''));
    if (p.kind === 'intro') {
      c.append(h('h2', null, p.title), h('p', 'lead', p.text), optionList(p.options));
    } else if (p.kind === 'inspect') {
      c.append(h('div', 'eyebrow', [svg('clipboard'), `${LABELS.walk} ${p.step} ${LABELS.of} ${p.steps}`]), h('h2', null, p.title), h('p', 'lead', p.text));
      if (p.gauge) c.append(gauge(p.gauge, p.fault));
      if (p.view === 'radio') c.append(h('div', 'unit', [svg('radio'), h('span', null, LABELS.yourRadio), h('b', 'lcd', p.fault ? R.wrongChannel : R.channel)]), h('p', 'small', LABELS.signSays));
      c.append(optionList(p.options));
      c.classList.add('side');
    } else if (p.kind === 'heard') {
      c.append(h('div', 'eyebrow', [svg('radio'), LABELS.heard + '  ' + p.title]), h('p', 'quote', '“' + p.heard + '”'), h('p', 'lead', p.text), optionList(p.options));
    } else if (p.kind === 'choice') {
      c.append(h('div', 'eyebrow', [svg('radio'), p.title]));
      if (p.lead) c.append(h('p', 'quote plain', p.lead));
      c.append(h('p', 'lead', p.text), optionList(p.options));
    } else if (p.kind === 'note') {
      c.append(h('div', 'eyebrow', [svg('alert'), p.title]), h('p', 'lead', p.text), optionList(p.options));
    } else if (p.kind === 'feedback') {
      c.append(h('div', 'verdict ' + (p.safe ? 'good' : 'bad'), [svg(p.safe ? 'check' : 'x'), p.safe ? LABELS.right : LABELS.notQuite]), h('p', 'lead', p.text), optionList(p.options));
    } else if (p.kind === 'debrief') {
      c.append(h('div', 'verdict ' + (p.outcome === 'clean' ? 'good' : 'bad'), [svg(p.outcome === 'clean' ? 'check' : 'alert'), p.title]), h('p', 'lead', p.text));
      for (const x of p.extra || []) c.append(h('p', 'lead', x));
      c.append(h('div', 'works', [h('b', null, LABELS.whatWorks), h('p', null, p.right)]), optionList(p.options));
    } else if (p.kind === 'pause') {
      c.append(h('h2', null, LABELS.paused), keyTable(), optionList(p.options));
    } else if (p.kind === 'call') {
      call = { km: null, dir: null, kms: p.kms };
      const kmSlot = h('b', 'slot', '?'), dirSlot = h('b', 'slot', '?');
      const kmBtns = p.kms.map((km) => { const b = h('button', 'pick', String(km)); b.tabIndex = -1; b.addEventListener('click', () => setCall({ km })); return b; });
      const dirBtns = p.dirs.map((d) => { const b = h('button', 'pick wide', [svg(d === 'up' ? 'arrowUp' : 'arrowDown'), d === 'up' ? LABELS.up : LABELS.down]); b.tabIndex = -1; b.addEventListener('click', () => setCall({ dir: d })); return b; });
      const send = h('button', 'opt send', [h('kbd', null, 'Enter'), h('span', null, LABELS.send)]); send.tabIndex = -1; send.addEventListener('click', () => sendCall());
      const cancel = h('button', 'opt ghost', [h('kbd', null, 'Esc'), h('span', null, LABELS.cancel)]); cancel.tabIndex = -1; cancel.addEventListener('click', () => answer(null));
      call.paint = () => {
        kmSlot.textContent = call.km == null ? '?' : call.km; dirSlot.textContent = call.dir || '?';
        kmSlot.classList.toggle('set', call.km != null); dirSlot.classList.toggle('set', !!call.dir);
        kmBtns.forEach((b, i) => b.classList.toggle('sel', p.kms[i] === call.km)); dirBtns.forEach((b, i) => b.classList.toggle('sel', p.dirs[i] === call.dir));
        send.classList.toggle('ready', call.km != null && !!call.dir);
      };
      c.append(h('div', 'eyebrow', [svg('radio'), p.title]),
        h('p', 'quote say', ['“' + p.road + ', ', kmSlot, ' kilometre, ', dirSlot, ', ' + p.vehicle + '.”']),
        h('div', 'row', [h('span', 'lab', LABELS.kilometre), ...kmBtns]), h('div', 'row', [h('span', 'lab', LABELS.direction), ...dirBtns]),
        h('div', 'actions', [send, cancel]), h('p', 'small', LABELS.callTip));
      call.paint();
    }
    cardWrap.append(c); cardWrap.classList.add('show'); cardWrap.classList.toggle('side', c.classList.contains('side'));
  }
  function setCall(v) { if (!call) return; Object.assign(call, v); call.paint(); }
  function sendCall() { if (call && call.km != null && call.dir) answer({ km: call.km, dir: call.dir }); }
  function keyTable() { return h('div', 'keytable', LABELS.keys.map(([k, v]) => h('div', null, [h('kbd', null, k), h('span', null, v)]))); }

  // returns true when the key was used by something on screen
  function key(e) {
    const k = e.key;
    if (ui.screenKind) {
      if ((k === 'Enter' || k === ' ') && !e.repeat && ui.time > ui.locked && ui.onScreen) { const fn = ui.onScreen; fn('enter'); return true; }
      if ((k === 'g' || k === 'G') && ui.onScreen) { ui.onScreen('graphics'); return true; }
      return false;
    }
    if (!ui.card) return false;
    if (e.repeat) return true;
    if (call) {
      if (/^[0-9]$/.test(k) && call.kms.includes(+k)) setCall({ km: +k });
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { const i = call.kms.indexOf(call.km); setCall({ km: call.kms[Math.min(call.kms.length - 1, i + 1)] }); }
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A') { const i = call.km == null ? call.kms.length : call.kms.indexOf(call.km); setCall({ km: call.kms[Math.max(0, i - 1)] }); }
      else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'u' || k === 'U') setCall({ dir: 'up' });
      else if (k === 'ArrowDown' || k === 's' || k === 'S') setCall({ dir: 'down' });
      else if (k === 'Enter') sendCall();
      else if (k === 'Escape' || k === 'r' || k === 'R') answer(null);
      return true;
    }
    if (/^[1-9]$/.test(k) && +k <= opts.length) { sel = +k - 1; mark(); answer(opts[sel].id); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S' || k === 'ArrowRight') { sel = Math.min(opts.length - 1, sel + 1); mark(); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'ArrowLeft') { sel = sel < 0 ? opts.length - 1 : Math.max(0, sel - 1); mark(); }
    else if ((k === 'Enter' || k === ' ') && sel >= 0) answer(opts[sel].id);
    else if (k === 'Escape' && ui.card.kind === 'pause') answer('resume');
    return true;
  }

  function toast(text, tone = 'info') {
    const el = h('div', 'toast ' + tone, [svg(tone === 'good' ? 'check' : tone === 'bad' ? 'alert' : 'info'), h('span', null, text)]);
    toasts.append(el); ui.toastList.push({ el, until: ui.time + 5.5 });
    while (ui.toastList.length > 2) ui.toastList.shift().el.remove();
  }
  function radioSay(who, text) {
    radWho.textContent = who === 'me' ? LABELS.you : ''; radCap.textContent = text; radio.classList.add('live'); radio.classList.toggle('me', who === 'me'); radio.classList.toggle('static', who === 'static');
    ui.capT = ui.time + Math.max(5, text.length * 0.09);
  }
  function setHud(o) {
    hud.style.display = o.show ? '' : 'none';
    if (!o.show) return;
    speedN.textContent = String(Math.round(o.kmh)); speed.classList.toggle('fast', o.kmh > (S.layout.speedLimit || 50) + 1);
    radCh.textContent = o.channel; radio.classList.toggle('dead', !o.radioOk);
    prompt.innerHTML = '';
    if (o.prompt) { prompt.append(h('kbd', null, 'Enter'), h('span', null, o.prompt)); prompt.classList.add('show'); } else prompt.classList.remove('show');
  }
  function tick(dt) {
    ui.time += dt;
    if (ui.capT && ui.time > ui.capT) { ui.capT = 0; radio.classList.remove('live', 'me', 'static'); radCap.textContent = ''; radWho.textContent = ''; }
    ui.toastList = ui.toastList.filter((t) => { if (ui.time > t.until) { t.el.remove(); return false; } t.el.style.opacity = String(Math.min(1, (t.until - ui.time) / 0.6)); return true; });
  }
  const setFade = (a) => { fadeEl.style.opacity = String(a); fadeEl.style.display = a > 0.001 ? '' : 'none'; };
  const setInter = (text, a = 1) => { inter.textContent = text || ''; inter.style.opacity = String(text ? a : 0); inter.style.display = text ? '' : 'none'; };

  function showTitle(info, on) {
    ui.screenKind = 'title'; ui.onScreen = on; ui.locked = ui.time + 0.3;
    screen.className = 'screen title show'; screen.innerHTML = '';
    const go = h('button', 'opt sel big', [h('kbd', null, 'Enter'), h('span', null, LABELS.start)]); go.tabIndex = -1; go.addEventListener('click', () => on('enter'));
    const gfx = h('button', 'link', `${LABELS.graphics}: ${info.tierLabel}  (G)`); gfx.tabIndex = -1; gfx.addEventListener('click', () => on('graphics'));
    screen.append(h('div', 'title-box', [h('h1', null, S.title), h('p', 'sub', S.subtitle), go, keyTable(),
      h('p', 'small', [info.session ? `${LABELS.session} ${info.session}` : LABELS.solo, '   ', gfx])]));
  }
  function showLoading() { ui.screenKind = 'loading'; screen.className = 'screen loading show'; screen.innerHTML = ''; screen.append(h('div', 'title-box', [h('h1', null, S.title), h('p', 'sub', LABELS.loading)])); }
  function showSummary(sum, info, on) {
    ui.screenKind = 'summary'; ui.onScreen = on; ui.locked = ui.time + 1.0;
    screen.className = 'screen summary show'; screen.innerHTML = '';
    const good = sum.outcome === 'clean';
    const head = h('div', 'sum-head', [h('div', 'verdict ' + (good ? 'good' : 'bad'), [svg(good ? 'check' : 'alert'), sum.outcomeLabel]),
      h('div', 'score', [h('b', null, `${sum.safe} ${LABELS.of} ${sum.total}`), ' ' + LABELS.safeOf])]);
    const groups = [...new Set(sum.rows.map((r) => r.group))];
    const cols = h('div', 'sum-cols', groups.map((g) => h('div', 'grp', [h('h3', null, g), ...sum.rows.filter((r) => r.group === g).map((r) =>
      h('div', 'r ' + (r.safe ? 'good' : 'bad'), [svg(r.safe ? 'check' : 'x'), h('span', null, [h('b', null, r.label), h('em', null, r.choiceLabel)])]))])));
    const box = h('div', 'sum-box', [h('h2', null, S.summary.title), head, cols]);
    if (sum.missed.length) box.append(h('div', 'works bad', [h('b', null, LABELS.missed), ...sum.missed.map((m) => h('p', null, m))]));
    box.append(h('div', 'works', [h('b', null, LABELS.remember), h('ul', null, sum.takeaways.map((t) => h('li', null, t)))]));
    const again = h('button', 'opt sel big', [h('kbd', null, 'Enter'), h('span', null, LABELS.again)]); again.tabIndex = -1; again.addEventListener('click', () => on('enter'));
    box.append(h('div', 'actions', [again, h('span', 'small', info.session ? `${LABELS.session} ${info.session}` : LABELS.solo)]));
    screen.append(box);
  }
  function hideScreen() { ui.screenKind = null; ui.onScreen = null; screen.className = 'screen'; screen.innerHTML = ''; }

  return Object.assign(ui, { showCard, closeCard, key, toast, radioSay, setHud, tick, setFade, setInter, showTitle, showLoading, showSummary, hideScreen, root,
    choose(choice) { answer(choice); }, options: () => opts.map((o) => o.id) });
}
