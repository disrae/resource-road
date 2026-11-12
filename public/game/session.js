// Who is playing and which session they belong to. No login and no name: the session code comes
// from the link, the player id is a random string kept in this browser.
const CLEAN = /[^A-Za-z0-9_.-]/g;

// ?s=CODE, ?session=CODE, #s=CODE or #session=CODE. Returns null when the link has none.
export function sessionFromLink(search = '', hash = '') {
  const q = new URLSearchParams(search), h = new URLSearchParams(String(hash).replace(/^#/, ''));
  const raw = q.get('s') || q.get('session') || h.get('s') || h.get('session') || '';
  const code = raw.replace(CLEAN, '').slice(0, 40);
  return code || null;
}
export function randomId(n = 12) {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789'; let out = '';
  const buf = new Uint8Array(n);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(buf); else for (let i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
  for (let i = 0; i < n; i++) out += abc[buf[i] % abc.length];
  return out;
}
// The same anonymous id each time this browser plays. Falls back to a fresh id when storage is unavailable.
export function playerId(storage) {
  const KEY = 'rr.player';
  try { let id = storage.getItem(KEY); if (!id) { id = 'p_' + randomId(); storage.setItem(KEY, id); } return id; } catch (e) { return 'p_' + randomId(); }
}
// What the run's variations are drawn from: the session code, so a whole session meets the same
// faults and pullouts; a random seed when the link carries no code.
export function seedFor(session) { return session || 'solo-' + randomId(8); }
