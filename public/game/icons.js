// Drawn icons (simple stroked SVG in the style of the Lucide set). No emoji anywhere in the game.
const P = {
  radio: '<rect x="5" y="8" width="14" height="13" rx="2"/><path d="M8 8V3"/><path d="M9 12h6"/><circle cx="12" cy="16.5" r="1.6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
  alert: '<path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4"/><path d="M12 17.2v.3"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.3"/>',
  arrowUp: '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>',
  arrowDown: '<path d="M12 4v15"/><path d="m6 13 6 6 6-6"/>',
  volume: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="m17 9.5 4 5"/><path d="m21 9.5-4 5"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
}
