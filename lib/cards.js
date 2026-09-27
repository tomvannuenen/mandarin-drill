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

// Each card showing rotates between the recorded voices.
export function pickVoice(entry, rand = Math.random) {
  const voices = Object.keys(entry.audio);
  return voices[Math.floor(rand() * voices.length)];
}

// Tapping play again moves on to the next speaker.
export function nextVoice(entry, current) {
  const voices = Object.keys(entry.audio);
  return voices[(voices.indexOf(current) + 1) % voices.length];
}
