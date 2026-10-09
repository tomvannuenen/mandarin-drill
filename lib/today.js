// The one-tap daily session and what it achieved.
import { buildQueue } from './session.js';
import { planIsCurrent } from './plan.js';
import { isSolid } from './motivation.js';
import { newCharCards, newBuildCards, readingTrouble, charId } from './chars.js';
import { localDate } from './store.js';
import { ACTIVITIES, ROUND_GAMES, applicable, pickMethod, needsExposure } from './methods.js';

const MAX_CARDS = 32;
const DAY = 86400000;
// The warm-up stays short so it can't crowd out the rest of the day.
const WARM_SAY = 5; // weakest trouble-spot drills
const WARM_READ = 3; // hardest-to-read words
const WARM_PLAN = 4; // today's focus phrases

// Trouble-spot drills and today's focus first (warm up on what's weak), then reviews with new cards mixed in.
export function composeToday({ items, drills, chars = [], progress, plan, now, newLimit, deck, charLimit = 3, buildLimit = 3, characters = true }) {
  if (!characters) [chars, charLimit, buildLimit] = [[], 0, 0];
  const base = buildQueue([...items, ...drills, ...chars], progress, now, newLimit, deck, { characters });
  // A few new word cards and sentence builds a day, mixed in like new cards.
  base.push(...newCharCards(chars, progress, deck, now, charLimit), ...newBuildCards(items, progress, deck, now, buildLimit));
  const isNew = (q) => !progress.cards[q.key];
  // The weakest few trouble spots open the session; other due drills take their turn among the reviews.
  const weakness = (q) => progress.weak[q.id]?.score || 0;
  const drillQ = base.filter((q) => q.id.startsWith('w/')).map((q, n) => ({ q, n }))
    .sort((a, b) => weakness(b.q) - weakness(a.q) || a.n - b.n).slice(0, WARM_SAY).map(({ q }) => q);
  const seen = new Set(drillQ.map((q) => q.key));
  const focusQ = [];
  // The words that are hardest to read come back first, as Read it cards: a few a day, and not again on a day
  // they were already handled. Their own review schedule brings the others back.
  const known = new Set(chars.map((c) => c.zh));
  const today = localDate(now);
  let reads = 0;
  for (const { zh, lastDay } of readingTrouble(progress, deck)) {
    const key = `${charId(deck, zh)}:char`;
    if (reads < WARM_READ && lastDay !== today && known.has(zh) && !seen.has(key)) {
      focusQ.push({ key, id: charId(deck, zh), type: 'char', deck });
      seen.add(key);
      reads += 1;
    }
  }
  if (planIsCurrent(plan, now)) {
    const ids = new Set(items.map((i) => i.id));
    for (const id of (plan.items || []).slice(0, WARM_PLAN)) {
      const key = `${id}:say`;
      if (ids.has(id) && progress.cards[key] && !seen.has(key)) {
        focusQ.push({ key, id, type: 'say', deck });
        seen.add(key);
      }
    }
  }
  const rest = base.filter((q) => !seen.has(q.key));
  // New material is the day's lesson: the new speaking cards, new word cards and sentence builds always get
  // their place. When the session is full, everything else gives way to them (warm-up, then reviews; newly
  // unlocked listen/read cards wait for the next session).
  const lesson = (q) => isNew(q) && ['say', 'char', 'build'].includes(q.type);
  const mustNew = rest.filter(lesson);
  const room = Math.max(0, MAX_CARDS - mustNew.length);
  const head = [...drillQ, ...focusQ].slice(0, room);
  const reviews = rest.filter((q) => !isNew(q)).slice(0, room - head.length);
  const fresh = [...mustNew, ...rest.filter((q) => isNew(q) && !lesson(q)).slice(0, room - head.length - reviews.length)];
  // One new card after every review (or two) keeps the session varied.
  const mixed = [];
  const step = Math.max(1, Math.round(reviews.length / Math.max(1, fresh.length)));
  let f = 0;
  reviews.forEach((r, i) => {
    mixed.push(r);
    if ((i + 1) % step === 0 && f < fresh.length) mixed.push(fresh[f++]);
  });
  while (f < fresh.length) mixed.push(fresh[f++]);
  const queue = [...head, ...mixed].slice(0, MAX_CARDS);
  const focus = head.length;
  const newOnes = queue.filter((q) => fresh.includes(q));
  const charCount = newOnes.filter((q) => q.type === 'char').length;
  const buildCount = newOnes.filter((q) => q.type === 'build').length;
  return {
    queue,
    counts: { focus, reviews: queue.length - focus - newOnes.length, fresh: newOnes.length - charCount - buildCount, chars: charCount, builds: buildCount },
  };
}

const GAP = 4; // cards between practising a phrase and being tested on it
const EAR_ROUND = 4; // the listening section in the middle of the session

// Weave practice into the day's queue:
// - a new phrase is first heard and repeated (whole, or built up from the end), and tested a few cards later;
// - a phrase whose last test went wrong is practised another way before it is tested again;
// - a short listening round (hear it, pick the meaning) sits in the middle, made from the newest and shakiest phrases.
// Which way of practising is chosen follows what has worked before (stats from methodStats).
export function withActivities({ queue, items, progress, stats = {}, deck, tiles = true, tones = deck === 'mandarin', rand = Math.random }) {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const phrase = (id) => byId[id] && !id.startsWith('w/') && !id.startsWith('c/');
  const met = items.filter((i) => phrase(i.id) && progress.cards[`${i.id}:say`]).length;
  const entryOf = (i) => i.fills?.[0] || i;
  const act = (id, method) => ({ key: `${id}:${method}`, id, type: method, deck, ...(ACTIVITIES.includes(method) ? { activity: true } : {}) });
  const out = [];
  const waiting = []; // [{card, left}] tests held back until a few cards after their practice
  const practised = new Set();
  const step = () => {
    for (const w of waiting) w.left -= 1;
    while (waiting.length && waiting[0].left <= 0) out.push(waiting.shift().card);
  };
  for (const q of queue) {
    if (q.type === 'say' && phrase(q.id)) {
      const isNew = !progress.cards[q.key];
      if (isNew || needsExposure(progress, q.id)) {
        const options = applicable(entryOf(byId[q.id]), met, { tiles: tiles && byId[q.id].kind !== 'word' && !isNew, tones });
        // A new phrase has to be heard before anything can be asked about it; a long one is built up in parts.
        const long = entryOf(byId[q.id]).words?.length >= 5;
        const intro = options.filter((m) => (long ? m === 'chain' : m === 'echo' || m === 'chain'));
        const method = pickMethod(stats, isNew ? intro : options, rand);
        out.push(act(q.id, method));
        practised.add(q.id);
        step();
        waiting.push({ card: q, left: GAP });
        continue;
      }
    }
    out.push(q);
    step();
  }
  while (waiting.length) out.push(waiting.shift().card);
  // The listening round is one of the quick games, chosen like any other way of practising.
  const game = pickMethod(stats, ROUND_GAMES, rand);
  if (met >= 4 && game) {
    const stability = (id) => progress.cards[`${id}:say`]?.stability ?? 0;
    const round = items
      .filter((i) => phrase(i.id) && progress.cards[`${i.id}:say`] && !practised.has(i.id) && entryOf(i).words?.length >= 2)
      .map((i, n) => ({ i, n }))
      .sort((a, b) => stability(a.i.id) - stability(b.i.id) || a.n - b.n)
      .slice(0, EAR_ROUND)
      .map(({ i }) => act(i.id, game));
    // Match the pairs is one card holding all four phrases.
    const cards = game === 'pairs' ? (round.length === EAR_ROUND ? [{ ...round[0], ids: round.map((r) => r.id) }] : []) : round;
    out.splice(Math.ceil(out.length * 0.6), 0, ...cards);
  }
  return out;
}

export function snapshot(progress) {
  return {
    goodCounts: { ...progress.goodCounts },
    weak: Object.fromEntries(Object.entries(progress.weak).map(([k, w]) => [k, w.score])),
  };
}

export function outcome(before, progress, items, deck) {
  const solid = items.filter((i) => i.deck === deck && !(((before.goodCounts[i.id] || 0) >= 2)) && isSolid(progress, i.id));
  const prefix = `w/${deck}/`;
  const cleared = Object.entries(before.weak)
    .filter(([k, s]) => k.startsWith(prefix) && s > 0 && (progress.weak[k]?.score || 0) === 0)
    .map(([k]) => k.slice(prefix.length));
  return { solid, cleared };
}

export function dueSoon(progress, items, now) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime();
  const ids = new Set(items.map((i) => i.id));
  return Object.entries(progress.cards).filter(([k, s]) => ids.has(k.slice(0, k.lastIndexOf(':'))) && new Date(s.due).getTime() < end && new Date(s.due) > now).length;
}

export function estimateMinutes(cards) {
  return Math.max(1, Math.round(cards * 0.5));
}
