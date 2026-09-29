// Characters, a little at a time: word cards (see characters → say it) for words from phrases you already
// know, most frequent first; and sentence building with word tiles once you can say a phrase.
import { isSolid } from './motivation.js';
import { newToday, localDate } from './store.js';

export const charId = (deck, zh) => `c/${deck}/${zh}`;
const entriesOf = (item) => (item.kind === 'pattern' ? item.fills : [item]);
const HAN = /[㐀-鿿]/;

// Virtual "char" items for every word in phrases you have met: {id, kind, deck, zh, roman, gloss, freq, audio, example}.
export function charItems(items, progress, deck) {
  // Words with a card of their own have their own recording (whether or not that card has been met).
  const ownAudio = new Map();
  for (const item of items) {
    if (item.deck === deck && item.kind !== 'pattern' && item.words?.length === 1 && item.audio) ownAudio.set(item.words[0].zh, item.audio);
  }
  const words = new Map();
  for (const item of items) {
    if (item.deck !== deck || !progress.cards[`${item.id}:say`]) continue;
    for (const entry of entriesOf(item)) {
      for (const w of entry.words || []) {
        if (!HAN.test(w.zh)) continue;
        const rec = words.get(w.zh) || { id: charId(deck, w.zh), kind: 'char', deck, zh: w.zh, roman: w.roman, gloss: w.gloss, freq: 0, audio: ownAudio.get(w.zh) || null, example: null };
        rec.freq += 1;
        if (entry.words.length > 1 && !rec.example) rec.example = entry;
        words.set(w.zh, rec);
      }
    }
  }
  return [...words.values()].sort((a, b) => b.freq - a.freq);
}

export function newCharCards(chars, progress, deck, now, limit) {
  const room = Math.max(0, limit - newToday(progress, now, `${deck}:char`));
  return chars
    .filter((c) => !progress.cards[`${c.id}:char`])
    .slice(0, room)
    .map((c) => ({ key: `${c.id}:char`, id: c.id, type: 'char', deck }));
}

// Build cards for multi-word phrases you can already say.
export function newBuildCards(items, progress, deck, now, limit) {
  const room = Math.max(0, limit - newToday(progress, now, `${deck}:build`));
  return items
    .filter((i) => i.deck === deck && i.kind !== 'word' && i.kind !== 'char' && i.kind !== 'drill')
    .filter((i) => isSolid(progress, i.id) && !progress.cards[`${i.id}:build`])
    .filter((i) => entriesOf(i).some((e) => (e.words || []).length >= 2))
    .slice(0, room)
    .map((i) => ({ key: `${i.id}:build`, id: i.id, type: 'build', deck }));
}

// Reading problems are kept apart from speaking trouble spots: missing a Read it card means you can't
// read the characters yet, not that you can't say the word. Recovery: right on two later days.
export function markReading(progress, deck, zh, ok, now) {
  const store = (progress.weakChars ||= {});
  const key = `${deck}/${zh}`;
  const today = localDate(now);
  const w = store[key];
  if (!ok) {
    store[key] = { score: (w?.score || 0) + 2, flags: (w?.flags || 0) + 1, lastDay: today };
  } else if (w && w.score > 0 && w.lastDay !== today) {
    w.score -= 1;
    w.lastDay = today;
  }
}

export function readingTrouble(progress, deck) {
  const prefix = `${deck}/`;
  return Object.entries(progress.weakChars || {})
    .filter(([k, w]) => k.startsWith(prefix) && w.score > 0)
    .map(([k, w]) => ({ zh: k.slice(prefix.length), score: w.score, flags: w.flags }))
    .sort((a, b) => b.score - a.score);
}

// You "know" a word once you've recognised it on two different days (and it isn't a current reading problem);
// its pinyin support can then fade.
export function knowsWord(progress, deck, zh) {
  const id = charId(deck, zh);
  if ((progress.weakChars?.[`${deck}/${zh}`]?.score || 0) > 0) return false;
  return !!progress.cards[`${id}:char`] && (progress.goodCounts[id] || 0) >= 2;
}

// The sentence's words plus a few decoys from your other words, shuffled.
export function tiles(entry, pool, rand = Math.random, decoys = 2) {
  const inSentence = new Set(entry.words.map((w) => w.zh));
  const own = entry.words.map((w, i) => ({ ...w, key: `w${i}`, decoy: false }));
  const others = pool.filter((c) => !inSentence.has(c.zh));
  const picked = [];
  while (picked.length < decoys && others.length) picked.push(others.splice(Math.floor(rand() * others.length), 1)[0]);
  const all = [...own, ...picked.map((c, i) => ({ zh: c.zh, roman: c.roman, gloss: c.gloss, key: `d${i}`, decoy: true }))];
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all;
}

export function isBuilt(entry, pickedZh) {
  return pickedZh.length === entry.words.length && entry.words.every((w, i) => w.zh === pickedZh[i]);
}

// One-time cleanup for data from before reading and speaking were kept apart: a speaking trouble spot is really
// a reading problem when a sentence containing the word failed as a read-aloud card, yet the latest attempt at
// saying it went fine. Returns the words moved.
export function reclassifyReadingFlags(progress, items, deck, now) {
  const moved = [];
  const prefix = `w/${deck}/`;
  for (const [key, w] of Object.entries(progress.weak)) {
    if (!key.startsWith(prefix) || !(w.score > 0)) continue;
    const zh = key.slice(prefix.length);
    const ids = items
      .filter((i) => i.deck === deck && entriesOf(i).some((e) => (e.words || []).some((x) => x.zh === zh)))
      .map((i) => i.id);
    const readFailed = progress.log.some(([, k, r]) => r < 3 && ids.some((id) => k === `${id}:read`));
    const sayKeys = new Set([`${key}:say`, ...ids.map((id) => `${id}:say`)]);
    const lastSay = [...progress.log].reverse().find(([, k]) => sayKeys.has(k));
    if (readFailed && lastSay && lastSay[2] >= 3) {
      w.score = 0;
      markReading(progress, deck, zh, false, now);
      moved.push(zh);
    }
  }
  return moved;
}
