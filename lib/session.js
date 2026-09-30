// Builds the study queue: due reviews, then newly unlocked listen/read cards, then new say cards.
import { cardKey, unlocked } from './cards.js';
import { isDue } from './srs.js';
import { newToday } from './store.js';

const REQUEUE_MS = 20 * 60 * 1000;

export function buildQueue(items, progress, now, newLimit, deck = 'mandarin', { characters = true } = {}) {
  const ids = new Set(items.map((i) => i.id));
  // Reading (characters → sound) is opt-in; speaking and listening always run. A deck can switch off all
  // character work (read-aloud, word and build cards) while you're starting out.
  const types = characters && progress.settings?.reading ? ['listen', 'read'] : ['listen'];
  const allowed = new Set(['say', ...(characters ? ['char', 'build'] : []), ...types]);
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

// Practise one lesson week: its speaking cards, least secure first (never met, then lowest stability), so repeated
// sessions work through the whole week. Drill and character entries aren't lesson material.
export function weekQueue(items, progress, week, limit = 15) {
  const strength = (id) => progress.cards[cardKey(id, 'say')]?.stability ?? -1;
  return items
    .filter((i) => i.week === week && !i.id.startsWith('w/') && !i.id.startsWith('c/'))
    .map((i, n) => ({ i, s: strength(i.id), n }))
    .sort((a, b) => a.s - b.s || a.n - b.n)
    .slice(0, limit)
    .map(({ i }) => ({ key: cardKey(i.id, 'say'), id: i.id, type: 'say', deck: i.deck }));
}

// Lesson weeks present in these items, newest first.
export function lessonWeeks(items) {
  return [...new Set(items.filter((i) => i.week).map((i) => i.week))].sort((a, b) => b - a);
}

// Cards still being learned (seen, but not yet through their learning steps, or forgotten and relearning).
// Beginners get no new cards while too many of these are open.
export function shakyCount(items, progress) {
  return items.filter((i) => [1, 3].includes(progress.cards[cardKey(i.id, 'say')]?.state)).length;
}
