// HSK 1 characters: the book's words and their single characters, practised by reading them (Read it, the same
// word card as in the daily session) and by typing them on a Chinese keyboard (Type it).
import { charId } from './chars.js';
import { isDue } from './srs.js';

const DECK = 'mandarin';
export const HSK_MODES = { read: 'char', type: 'type' };

// The HSK entries as word-card items. sound(zh) gives a word's recording; a character read differently from its
// usual reading (覺 in 睡覺) is heard through its word.
export function hskItems(entries, sound = () => null) {
  return entries.map((e) => {
    const from = e.single ? entries.find((x) => x.zh === e.from) : null;
    const fromAudio = from && sound(from.zh);
    return {
      id: charId(DECK, e.zh), kind: 'char', deck: DECK, zh: e.zh, roman: e.roman, gloss: e.en,
      script: e.script || 'hk', zhDisp: e.zhDisp || e.zh, zhS: e.zhS || null, freq: 0,
      audio: sound(e.sound || e.zh), lesson: e.lesson, single: !!e.single,
      example: fromAudio ? { zh: from.zh, roman: from.roman, en: from.en, audio: fromAudio, inWord: true } : null,
    };
  });
}

// What to practise: words, single characters, or both.
export function hskPool(list, lessons, what = 'both') {
  const on = new Set(lessons);
  return list
    .map((x, n) => ({ x, n }))
    .filter(({ x }) => on.has(x.lesson) && (what === 'both' || (what === 'chars') === x.single))
    .sort((a, b) => a.x.lesson - b.x.lesson || a.n - b.n)
    .map(({ x }) => x);
}

// A round: what is due first, then what you haven't met (in book order), then the weakest of the rest.
export function hskQueue(pool, progress, mode, now, limit = 15) {
  const type = HSK_MODES[mode];
  const card = (x) => progress.cards[`${x.id}:${type}`];
  const due = pool.filter((x) => card(x) && isDue(card(x), now)).sort((a, b) => new Date(card(a).due) - new Date(card(b).due));
  const fresh = pool.filter((x) => !card(x));
  const rest = pool.filter((x) => card(x) && !isDue(card(x), now)).sort((a, b) => (card(a).stability || 0) - (card(b).stability || 0));
  return [...due, ...fresh, ...rest].slice(0, limit).map((x) => ({ key: `${x.id}:${type}`, id: x.id, type, deck: DECK }));
}

// How many cards in this pool are waiting: due again, or never practised.
export function hskWaiting(pool, progress, mode, now) {
  const type = HSK_MODES[mode];
  return pool.filter((x) => { const c = progress.cards[`${x.id}:${type}`]; return !c || isDue(c, now); }).length;
}

// Typed characters match in either script, character by character; spaces and punctuation don't count.
export function typedMatches(typed, zh, t2s = {}) {
  const clean = (s) => [...(s || '').normalize('NFC').replace(/[\s\p{P}]/gu, '')];
  const got = clean(typed);
  const want = clean(zh);
  return got.length === want.length && want.every((ch, i) => got[i] === ch || got[i] === t2s[ch]);
}

// One dot per entry, from both of its cards: hollow until practised, red while it is a reading problem or
// being relearned, green once both reading and typing are well in.
export function hskLevel(progress, x) {
  const cards = Object.values(HSK_MODES).map((t) => progress.cards[`${x.id}:${t}`]).filter(Boolean);
  if (!cards.length) return 'new';
  if ((progress.weakChars?.[`${DECK}/${x.zh}`]?.score || 0) > 0 || cards.some((c) => c.state === 3)) return 'hard';
  if (cards.length === 2 && cards.every((c) => (c.stability || 0) >= 7)) return 'solid';
  return 'learning';
}
