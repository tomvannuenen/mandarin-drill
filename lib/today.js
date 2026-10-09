// The one-tap daily session and what it achieved.
import { buildQueue } from './session.js';
import { planIsCurrent } from './plan.js';
import { isSolid } from './motivation.js';
import { newCharCards, newBuildCards, readingTrouble, charId } from './chars.js';
import { localDate } from './store.js';
import { ACTIVITIES, applicable, pickMethod, needsExposure, dropped } from './methods.js';

const DAY = 86400000;
// The shape of a day's session, by what each card asks of you. Speaking sentences is the centre; single words,
// characters and easy listening cards are kept to a few. withActivities adds the listening tasks, tones and the
// closing passage on top (about 35 cards in all).
export const MIX = {
  say: 11, // say a sentence from its meaning: due reviews, new phrases, and soon-due ones to fill the share
  drills: 3, // trouble words (asked inside a sentence where one exists)
  chars: 4, // word cards: the hardest to read, due reviews, new ones
  read: 2, // read a sentence aloud
  listen: 1, // "what does this mean" listening card
  builds: 4, // word order with tiles
};
const WARM_READ = 2; // hardest-to-read words that come back regardless of their schedule
const WARM_PLAN = 4; // today's focus phrases
const SOON_DAYS = 3; // how far ahead a speaking review may be pulled to fill the speaking share

// A few trouble words open the session; the rest is spread evenly so no kind of card comes in a block.
export function composeToday({ items, drills, chars = [], progress, plan, now, newLimit, deck, charLimit = 2, buildLimit = 3, characters = true, topUp = true }) {
  if (!characters) [chars, charLimit, buildLimit] = [[], 0, 0];
  const base = buildQueue([...items, ...drills, ...chars], progress, now, newLimit, deck, { characters });
  base.push(...newCharCards(chars, progress, deck, now, charLimit), ...newBuildCards(items, progress, deck, now, buildLimit));
  const isNew = (q) => !progress.cards[q.key];
  const isDrill = (q) => q.id.startsWith('w/');
  const of = (type) => base.filter((q) => q.type === type && !isDrill(q));
  // New material always gets its place; reviews fill what is left of each share, oldest first.
  const share = (list, n) => {
    const fresh = list.filter(isNew);
    return [...fresh, ...list.filter((q) => !isNew(q)).slice(0, Math.max(0, n - fresh.length))];
  };

  const weakness = (q) => progress.weak[q.id]?.score || 0;
  const head = base.filter(isDrill).map((q, n) => ({ q, n }))
    .sort((a, b) => weakness(b.q) - weakness(a.q) || a.n - b.n).slice(0, MIX.drills).map(({ q }) => q);

  // Speaking: new phrases, today's focus, what is due, then phrases due in the next days.
  const sayBase = of('say');
  const sayKeys = new Set(sayBase.map((q) => q.key));
  const focus = [];
  if (planIsCurrent(plan, now)) {
    const ids = new Set(items.map((i) => i.id));
    for (const id of (plan.items || []).slice(0, WARM_PLAN)) {
      const key = `${id}:say`;
      if (ids.has(id) && progress.cards[key] && !sayKeys.has(key)) {
        focus.push({ key, id, type: 'say', deck });
        sayKeys.add(key);
      }
    }
  }
  const soon = items
    .filter((i) => !i.id.startsWith('w/') && !i.id.startsWith('c/') && progress.cards[`${i.id}:say`] && !sayKeys.has(`${i.id}:say`))
    .map((i) => ({ i, due: new Date(progress.cards[`${i.id}:say`].due).getTime() }))
    .filter(({ due }) => topUp && due - now.getTime() <= SOON_DAYS * DAY)
    .sort((a, b) => a.due - b.due)
    .map(({ i }) => ({ key: `${i.id}:say`, id: i.id, type: 'say', deck }));
  const say = share([...sayBase.filter(isNew), ...focus, ...sayBase.filter((q) => !isNew(q)), ...soon], MIX.say);

  // Characters: the words that are hardest to read come back regardless of schedule (not twice in a day).
  const known = new Set(chars.map((c) => c.zh));
  const today = localDate(now);
  const charBase = of('char');
  const hard = readingTrouble(progress, deck)
    .filter(({ zh, lastDay }) => lastDay !== today && known.has(zh))
    .slice(0, WARM_READ)
    .map(({ zh }) => ({ key: `${charId(deck, zh)}:char`, id: charId(deck, zh), type: 'char', deck }));
  const hardKeys = new Set(hard.map((q) => q.key));
  const charQ = share([...charBase.filter(isNew), ...hard, ...charBase.filter((q) => !isNew(q) && !hardKeys.has(q.key))], MIX.chars);

  const lists = [say, charQ, of('read').slice(0, MIX.read), of('listen').slice(0, MIX.listen), share(of('build'), MIX.builds)];
  // Spread each kind evenly through the session.
  const rest = lists
    .flatMap((list, l) => list.map((q, i) => ({ q, at: (i + 0.5) / list.length, l })))
    .sort((a, b) => a.at - b.at || a.l - b.l)
    .map(({ q }) => q);
  const queue = [...head, ...rest];
  const newOnes = queue.filter(isNew);
  const count = (type) => newOnes.filter((q) => q.type === type).length;
  return {
    queue,
    counts: {
      focus: head.length,
      reviews: queue.length - head.length - count('say') - count('char') - count('build'),
      fresh: count('say'), chars: count('char'), builds: count('build'),
    },
  };
}

const GAP = 4; // cards between practising a phrase and being tested on it
// Listening tasks per session, the harder kinds twice: rebuild by ear, missing word, pick by ear, right or wrong.
const LISTENING = ['dictate', 'fill', 'dictate', 'ear', 'match'];
const PAIRS = 4;
const PASSAGE = 5; // sentences in the closing listening passage

// Weave practice into the day's queue:
// - a new phrase is first heard and repeated (whole, or built up from the end), and tested a few cards later;
// - a phrase whose last test went wrong is practised another way before it is tested again;
// - listening tasks and a little tone work are spread through the session, on the shakiest phrases;
// - a short passage to listen through closes it.
// Which way of practising is chosen follows what has worked before (stats from methodStats).
export function withActivities({ queue, items, progress, stats = {}, deck, tiles = true, tones = deck === 'mandarin', extras = true, rand = Math.random }) {
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
  // Listening with a task, weighted to the harder kinds, plus a little tone work: each on a different phrase
  // (the shakiest first), spread through the session. A kind that was dropped gives its place to the others.
  const gone = new Set(dropped(stats));
  const stability = (id) => progress.cards[`${id}:say`]?.stability ?? 0;
  // Phrases already being tested today come last: the listening goes to the others first.
  const tested = new Set(queue.filter((q) => q.type === 'say').map((q) => q.id));
  const pool = items
    .filter((i) => phrase(i.id) && progress.cards[`${i.id}:say`] && !practised.has(i.id))
    .map((i, n) => ({ i, n }))
    .sort((a, b) => tested.has(a.i.id) - tested.has(b.i.id) || stability(a.i.id) - stability(b.i.id) || a.n - b.n)
    .map(({ i }) => i);
  const extra = [];
  // (Only in the day's main session: a later top-up session is just what is due.)
  if (extras && met >= 4) {
    const fits = (m, i) => applicable(entryOf(i), met, { tiles: false, tones }).includes(m);
    const wanted = [...LISTENING.filter((m) => !gone.has(m)), ...(tones && !gone.has('tone') ? ['tone', 'tone'] : [])];
    for (const m of wanted) {
      const at = pool.findIndex((i) => fits(m, i));
      if (at >= 0) extra.push(act(pool.splice(at, 1)[0].id, m));
    }
    // Match the pairs is one card holding four phrases.
    if (!gone.has('pairs') && pool.length >= PAIRS) {
      const four = pool.splice(0, PAIRS);
      extra.push({ ...act(four[0].id, 'pairs'), ids: four.map((i) => i.id) });
    }
  }
  // Slot them in evenly from a third of the way in.
  extra.forEach((card, n) => {
    const at = Math.round(out.length * (0.3 + (0.65 * (n + 0.5)) / extra.length));
    out.splice(Math.min(out.length, at + n), 0, card);
  });
  // The session closes on a short passage to listen through: today's sentences, one after the other.
  const heard = [...new Set(out.filter((q) => q.type === 'say' && phrase(q.id)).map((q) => q.id))].slice(0, PASSAGE);
  if (extras && heard.length >= 3) out.push({ ...act(heard[0], 'passage'), ids: heard });
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
