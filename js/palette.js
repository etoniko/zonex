/** Shared player palette (menu + server whitelist). */
export const PLAYER_COLORS = [
  '#ff3b5c',
  '#ff7a1a',
  '#f5b800',
  '#22c55e',
  '#06b6d4',
  '#2f6bff',
  '#a855f7',
  '#ec4899',
];

/** White swatch = random server pick. */
export const RANDOM_COLOR_IDX = 255;

/** @returns {number} index or -1 */
export function colorIndex(hex) {
  const h = String(hex || '').toLowerCase();
  if (h === 'random' || h === '#ffffff' || h === '#fff') return RANDOM_COLOR_IDX;
  return PLAYER_COLORS.findIndex((c) => c === h);
}

/** Valid fixed index → hex; random/invalid → null. */
export function colorAt(idx) {
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= PLAYER_COLORS.length) return null;
  return PLAYER_COLORS[i];
}

export function randomPlayerColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}
