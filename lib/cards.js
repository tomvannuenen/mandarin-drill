// Card identity, unlock rule for listen/read cards, and pattern fill selection.
// Listen/read cards unlock once the say card was answered well on this many different days.
export const UNLOCK_GOOD = 2;
export const TYPES = ['say', 'listen', 'read'];

export function cardKey(id, type) {
  return `${id}:${type}`;
}

export function unlocked(id, progress) {
  return (progress.goodCounts[id] || 0) >= UNLOCK_GOOD;
}

// Prefer fills whose word has already been introduced, so patterns use known vocabulary.
export function pickFill(item, progress, rand = Math.random) {
  const known = item.fills.filter((f) => progress.cards[cardKey(f.fillId, 'say')]);
  const pool = known.length ? known : item.fills;
  return pool[Math.floor(rand() * pool.length)];
}
