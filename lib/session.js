// Builds the study queue: due reviews, then newly unlocked listen/read cards, then new say cards.
import { cardKey, unlocked } from './cards.js';
import { isDue } from './srs.js';
import { newToday } from './store.js';

const REQUEUE_MS = 20 * 60 * 1000;

export function buildQueue(items, progress, now, newLimit, deck = 'mandarin') {
  const ids = new Set(items.map((i) => i.id));
  // Reading (characters → sound) is opt-in; speaking and listening always run.
  const types = progress.settings?.reading ? ['listen', 'read'] : ['listen'];
  const allowed = new Set(['say', 'char', 'build', ...types]);
  // Word (char) items and trouble-spot drills only ever come back as due reviews; new ones are added elsewhere.
  const phrases = items.filter((i) => i.kind !== 'char' && i.kind !== 'drill');
  // Drills are speaking-only and word cards reading-only (older data may hold stray cards for them).
  const fits = (id, type) => (id.startsWith('w/') ? type === 'say' : id.startsWith('c/') ? type === 'char' : type !== 'char');
  const due = Object.entries(progress.cards)
    .map(([key, state]) => {
      const i = key.lastIndexOf(':');
      return { key, id: key.slice(0, i), type: key.slice(i + 1), state };
    })
    .filter((c) => ids.has(c.id) && allowed.has(c.type) && fits(c.id, c.type) && isDue(c.state, now))
    .sort((a, b) => new Date(a.state.due) - new Date(b.state.due))
    .map(({ key, id, type }) => ({ key, id, type, deck }));

  const unlockedNew = [];
  for (const { id } of phrases) {
    if (!unlocked(id, progress)) continue;
    for (const type of types) {
      const key = cardKey(id, type);
      if (!progress.cards[key]) unlockedNew.push({ key, id, type, deck });
    }
  }

  const room = Math.max(0, newLimit - newToday(progress, now, deck));
  // Your own wished-for phrases first, then coach material (weeks), then extra sets such as "Verbs".
  const unseen = phrases.filter(({ id }) => !progress.cards[cardKey(id, 'say')]);
  const fresh = [...unseen.filter((i) => i.wish), ...unseen.filter((i) => !i.wish && !i.set), ...unseen.filter((i) => !i.wish && i.set)]
    .slice(0, room)
    .map(({ id }) => ({ key: cardKey(id, 'say'), id, type: 'say', deck }));

  return [...due, ...unlockedNew, ...fresh];
}

// Short learning steps (e.g. 10 minutes) are shown again before the session ends.
export function shouldRequeue(state, now) {
  return new Date(state.due) - now <= REQUEUE_MS;
}
