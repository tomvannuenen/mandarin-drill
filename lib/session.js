// Builds the study queue: due reviews, then newly unlocked listen/read cards, then new say cards.
import { cardKey, unlocked } from './cards.js';
import { isDue } from './srs.js';
import { newToday } from './store.js';

const REQUEUE_MS = 20 * 60 * 1000;

export function buildQueue(items, progress, now, newLimit) {
  const ids = new Set(items.map((i) => i.id));
  const due = Object.entries(progress.cards)
    .map(([key, state]) => {
      const i = key.lastIndexOf(':');
      return { key, id: key.slice(0, i), type: key.slice(i + 1), state };
    })
    .filter((c) => ids.has(c.id) && isDue(c.state, now))
    .sort((a, b) => new Date(a.state.due) - new Date(b.state.due))
    .map(({ key, id, type }) => ({ key, id, type }));

  const unlockedNew = [];
  for (const { id } of items) {
    if (!unlocked(id, progress)) continue;
    for (const type of ['listen', 'read']) {
      const key = cardKey(id, type);
      if (!progress.cards[key]) unlockedNew.push({ key, id, type });
    }
  }

  const room = Math.max(0, newLimit - newToday(progress, now));
  // Coach material (weeks) is introduced before extra sets such as "Verbs".
  const unseen = items.filter(({ id }) => !progress.cards[cardKey(id, 'say')]);
  const fresh = [...unseen.filter((i) => !i.set), ...unseen.filter((i) => i.set)]
    .slice(0, room)
    .map(({ id }) => ({ key: cardKey(id, 'say'), id, type: 'say' }));

  return [...due, ...unlockedNew, ...fresh];
}

// Short learning steps (e.g. 10 minutes) are shown again before the session ends.
export function shouldRequeue(state, now) {
  return new Date(state.due) - now <= REQUEUE_MS;
}
