// The one-tap daily session and what it achieved.
import { buildQueue } from './session.js';
import { planIsCurrent } from './plan.js';
import { isSolid } from './motivation.js';
import { newCharCards, newBuildCards, readingTrouble, charId } from './chars.js';

const MAX_CARDS = 40;
const DAY = 86400000;

// Trouble-spot drills and today's focus first (warm up on what's weak), then reviews with new cards mixed in.
export function composeToday({ items, drills, chars = [], progress, plan, now, newLimit, deck, charLimit = 3, buildLimit = 2, characters = true }) {
  if (!characters) [chars, charLimit, buildLimit] = [[], 0, 0];
  const base = buildQueue([...items, ...drills, ...chars], progress, now, newLimit, deck, { characters });
  // A few new word cards and sentence builds a day, mixed in like new cards.
  base.push(...newCharCards(chars, progress, deck, now, charLimit), ...newBuildCards(items, progress, deck, now, buildLimit));
  const isNew = (q) => !progress.cards[q.key];
  const drillQ = base.filter((q) => q.id.startsWith('w/'));
  const seen = new Set(drillQ.map((q) => q.key));
  const focusQ = [];
  // Words that are hard to read come back first, as Read it cards.
  const known = new Set(chars.map((c) => c.zh));
  for (const { zh } of readingTrouble(progress, deck)) {
    const key = `${charId(deck, zh)}:char`;
    if (known.has(zh) && !seen.has(key)) {
      focusQ.push({ key, id: charId(deck, zh), type: 'char', deck });
      seen.add(key);
    }
  }
  if (planIsCurrent(plan, now)) {
    const ids = new Set(items.map((i) => i.id));
    for (const id of plan.items || []) {
      const key = `${id}:say`;
      if (ids.has(id) && progress.cards[key] && !seen.has(key)) {
        focusQ.push({ key, id, type: 'say', deck });
        seen.add(key);
      }
    }
  }
  const rest = base.filter((q) => !seen.has(q.key));
  // New speaking cards are the day's lesson: when the session is full, everything else gives way to them
  // (focus, then reviews, then newly unlocked listen/read/word cards wait for the next session).
  const sayNew = rest.filter((q) => isNew(q) && q.type === 'say');
  const room = Math.max(0, MAX_CARDS - sayNew.length);
  const head = [...drillQ, ...focusQ].slice(0, room);
  const reviews = rest.filter((q) => !isNew(q)).slice(0, room - head.length);
  const fresh = [...sayNew, ...rest.filter((q) => isNew(q) && q.type !== 'say').slice(0, room - head.length - reviews.length)];
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
