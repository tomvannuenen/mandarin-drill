// Ways of practising a phrase besides the plain "say it" test, and what the answer log says about which of
// them work for this learner. A method is judged by what happens next: was the phrase said right at its
// following "say it" card? Methods that keep losing are used less, and dropped once that is clear.
import { cardKey } from './cards.js';
import { localDate, LOG_LIMIT } from './store.js';

// echo: hear it and repeat. chain: build it up from the end, a word at a time. ear: hear it, pick the meaning.
// fill: hear it, pick the missing word. match: hear it, is this what it means? tone: hear a word, pick its
// tones. dictate: hear it, tap the pinyin back into order. pairs: match four sounds to four meanings.
// build: tap the word tiles into order (a card type of its own).
export const ACTIVITIES = ['echo', 'chain', 'ear', 'fill', 'match', 'tone', 'dictate', 'pairs'];
export const METHODS = [...ACTIVITIES, 'build', 'listen'];
export const ROUND_GAMES = ['ear', 'match', 'pairs']; // quick listening games for the middle of a session
export const METHOD_NAME = {
  echo: 'Listen and repeat', chain: 'Build it up', ear: 'Pick by ear', fill: 'Missing word by ear',
  match: 'Right or wrong', tone: 'Pick the tones', dictate: 'Rebuild by ear', pairs: 'Match the pairs',
  build: 'Word tiles', listen: 'Listening card', none: 'Just testing',
};

const MIN_TRIES = 8; // results needed before a method can be judged
const DROP_GAP = 0.25; // this far behind the best method = dropped
const PARTICLES = new Set(['嗎', '吧', '呢', '了', '的', '啊', '㗎', '呀', '喎', '啦']);

const split = (key) => {
  const i = key.lastIndexOf(':');
  return [key.slice(0, i), key.slice(i + 1)];
};

// {method: {n, ok}}: retention, not the moment. The first "say it" answer of each later day is credited to the
// last other thing done with that phrase on an earlier day; 'none' collects the days nothing else was done.
// Answers on the same day as the practice don't count: anything sticks for ten minutes.
export function methodStats(log) {
  const stats = {};
  const last = {}; // id -> {method, day}
  const said = {}; // id -> day of the latest "say it"
  for (const [t, key, rating] of log) {
    const [id, type] = split(key);
    if (id.startsWith('w/') || id.startsWith('c/')) continue;
    const day = localDate(new Date(t));
    if (type !== 'say') {
      if (METHODS.includes(type)) last[id] = { method: type, day };
      continue;
    }
    const firstToday = said[id] !== day;
    const met = id in said;
    said[id] = day;
    if (!firstToday) continue;
    let method = null;
    if (last[id] && last[id].day < day) method = last[id].method;
    else if (!last[id] && met) method = 'none';
    if (last[id] && last[id].day < day) delete last[id];
    if (!method) continue;
    const s = (stats[method] ||= { n: 0, ok: 0 });
    s.n += 1;
    if (rating >= 3) s.ok += 1;
  }
  return stats;
}

const rate = (s) => (s && s.n ? s.ok / s.n : 0);

// Methods with enough results that trail the best one clearly.
export function dropped(stats, candidates = METHODS) {
  const judged = candidates.filter((m) => (stats[m]?.n || 0) >= MIN_TRIES);
  if (judged.length < 2) return [];
  const best = Math.max(...judged.map((m) => rate(stats[m])));
  // Hearing a phrase and repeating it is how every new one starts: it is never dropped.
  return judged.filter((m) => m !== 'echo' && rate(stats[m]) < best - DROP_GAP);
}

// Mostly the method with the best record, but untried ones get their turn: the fewer results a method has,
// the more chance moves its score.
export function pickMethod(stats, candidates, rand = Math.random) {
  const out = new Set(dropped(stats, candidates));
  const pool = candidates.filter((m) => !out.has(m));
  if (!pool.length) return candidates[0] || null;
  const score = (m) => {
    const s = stats[m] || { n: 0, ok: 0 };
    return (s.ok + 1) / (s.n + 2) + rand() / Math.sqrt(s.n + 1);
  };
  return pool.map((m) => ({ m, v: score(m) })).sort((a, b) => b.v - a.v)[0].m;
}

// Short messages about a change in what the session uses: a way of practising dropped, back in, or now the one
// with the best record. prev is the state returned last time ({dropped: [], lead}); pass it back in next time.
export function methodNews(stats, prev = null) {
  const pct = (m) => Math.round(100 * rate(stats[m]));
  const out = dropped(stats);
  const judged = METHODS.filter((m) => (stats[m]?.n || 0) >= MIN_TRIES && !out.includes(m));
  const lead = judged.sort((a, b) => rate(stats[b]) - rate(stats[a]) || stats[b].n - stats[a].n)[0] || null;
  const state = { dropped: out, lead };
  if (!prev) return { state, news: [] };
  const news = [];
  for (const m of out) {
    if (!prev.dropped.includes(m)) news.push(`Dropped ${METHOD_NAME[m]}: ${pct(m)}% stuck${lead ? `, against ${pct(lead)}% for ${METHOD_NAME[lead]}` : ''}.`);
  }
  for (const m of prev.dropped) if (!out.includes(m)) news.push(`${METHOD_NAME[m]} is back in.`);
  if (lead && lead !== prev.lead) news.push(`More ${METHOD_NAME[lead]} from now on: ${pct(lead)}% stuck, the best so far.`);
  return { state, news };
}

// Which activities make sense for this sentence. others = how many other phrases could serve as wrong answers.
export function applicable(entry, others, { tiles = true, tones = true } = {}) {
  const n = (entry.words || []).length;
  return [
    'echo',
    ...(n >= 3 ? ['chain', 'dictate'] : []),
    ...(others >= 3 ? ['ear', 'match'] : []),
    ...(n >= 2 && others >= 3 ? ['fill'] : []),
    ...(tones ? ['tone'] : []),
    ...(tiles && n >= 3 ? ['build'] : []),
  ];
}

// Building a sentence up from its end: [[last words], [one more in front], … , [all]]. A final particle never
// stands alone (一下嗎, not 嗎).
export function chainSteps(words) {
  const n = words.length;
  const first = n > 1 && PARTICLES.has(words[n - 1].zh) ? 2 : 1;
  const steps = [];
  for (let k = Math.min(first, n); k <= n; k++) steps.push(words.slice(n - k));
  return steps;
}

// A phrase needs more exposure when its latest "say it" went wrong: it is practised another way before it
// is tested again.
export function needsExposure(progress, id) {
  const key = cardKey(id, 'say');
  for (let i = progress.log.length - 1; i >= 0; i--) {
    if (progress.log[i][1] === key) return progress.log[i][2] < 3;
  }
  return false;
}

// How a phrase is going for this learner: 'new' (never met), 'hard' (the last try at saying it went wrong, or it
// was forgotten and is being relearned), 'solid' (said right on two days and holding for a week), else 'learning'.
export function strengthOf(progress, id) {
  const card = progress.cards[cardKey(id, 'say')];
  if (!card) return 'new';
  if (card.state === 3 || needsExposure(progress, id)) return 'hard';
  if ((progress.goodCounts[id] || 0) >= 2 && (card.stability || 0) >= 7) return 'solid';
  return 'learning';
}

// Record an activity: it goes in the answer log (and keeps the streak) but has no review schedule of its own.
export function logActivity(progress, id, method, rating, now, ms = null) {
  progress.log.push([now.getTime(), `${id}:${method}`, rating, ms]);
  if (progress.log.length > LOG_LIMIT) progress.log.splice(0, progress.log.length - LOG_LIMIT);
  const s = progress.stats;
  const today = localDate(now);
  if (s.lastStudyDate !== today) {
    const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    s.streak = s.lastStudyDate === yesterday ? s.streak + 1 : 1;
    s.lastStudyDate = today;
  }
}
