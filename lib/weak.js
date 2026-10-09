// Trouble spots: words the learner flagged as missed get their own practice cards
// until correct answers on later days wear their score down to zero.
import { localDate } from './store.js';

const FLAG_POINTS = 2;

export const drillId = (deck, zh) => `w/${deck}/${zh}`;

export function flagWord(progress, deck, zh, now) {
  const id = drillId(deck, zh);
  const w = (progress.weak[id] ||= { score: 0, flags: 0 });
  w.score += FLAG_POINTS;
  w.flags += 1;
  w.lastDay = localDate(now); // no recovery credit on the day of a miss
  return id;
}

// A correct answer containing a weak word counts toward its recovery, once per day.
export function credit(progress, deck, words, now) {
  const today = localDate(now);
  for (const { zh } of words) {
    const w = progress.weak[drillId(deck, zh)];
    if (w && w.score > 0 && w.lastDay !== today) {
      w.score -= 1;
      w.lastDay = today;
    }
  }
}

export function troubleSpots(progress, deck) {
  const prefix = `w/${deck}/`;
  return Object.entries(progress.weak)
    .filter(([id, w]) => id.startsWith(prefix) && w.score > 0)
    .map(([id, w]) => ({ id, zh: id.slice(prefix.length), score: w.score }))
    .sort((a, b) => b.score - a.score);
}

function entriesOf(item) {
  return item.kind === 'pattern' ? item.fills : [item];
}

// Virtual study items for the current trouble spots, with the word's romanisation, meaning and
// the sentences it appears in.
export function drillItems(items, progress, deck) {
  const spots = troubleSpots(progress, deck);
  if (!spots.length) return [];
  const info = {};
  for (const item of items.filter((i) => i.deck === deck)) {
    for (const entry of entriesOf(item)) {
      for (const w of entry.words || []) {
        const rec = (info[w.zh] ||= { roman: w.roman, gloss: w.gloss, contexts: [], audio: null });
        if (entry.words.length > 1 && !rec.contexts.includes(entry)) rec.contexts.push(entry);
        if (entry.words.length === 1 && entry.audio) rec.audio = entry.audio; // the word has its own recording
      }
    }
  }
  return spots
    .filter((s) => info[s.zh])
    .map((s) => ({ id: s.id, kind: 'drill', deck, zh: s.zh, ...info[s.zh] }));
}

// A trouble word is mostly asked inside a sentence it occurs in: that is where it has to come out right.
export function drillPrompt(item, rand = Math.random) {
  if (item.contexts.length && rand() < 0.85) {
    return { mode: 'gap', context: item.contexts[Math.floor(rand() * item.contexts.length)] };
  }
  return { mode: 'word' };
}
