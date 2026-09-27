// The one-tap daily session and what it achieved.
import { buildQueue } from './session.js';
import { planIsCurrent } from './plan.js';
import { isSolid } from './motivation.js';

const MAX_CARDS = 40;
const DAY = 86400000;

// Trouble-spot drills and today's focus first (warm up on what's weak), then reviews with new cards mixed in.
export function composeToday({ items, drills, progress, plan, now, newLimit, deck }) {
  const base = buildQueue([...items, ...drills], progress, now, newLimit, deck);
  const isNew = (q) => !progress.cards[q.key];
  const drillQ = base.filter((q) => q.id.startsWith('w/'));
  const seen = new Set(drillQ.map((q) => q.key));
  const focusQ = [];
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
  const reviews = rest.filter((q) => !isNew(q));
  const fresh = rest.filter(isNew);
  // One new card after every review (or two) keeps the session varied.
  const mixed = [];
  const step = Math.max(1, Math.round(reviews.length / Math.max(1, fresh.length)));
  let f = 0;
  reviews.forEach((r, i) => {
    mixed.push(r);
    if ((i + 1) % step === 0 && f < fresh.length) mixed.push(fresh[f++]);
  });
  while (f < fresh.length) mixed.push(fresh[f++]);
  const queue = [...drillQ, ...focusQ, ...mixed].slice(0, MAX_CARDS);
  const focus = queue.filter((q) => drillQ.includes(q) || focusQ.includes(q)).length;
  const newCount = queue.filter((q) => fresh.includes(q)).length;
  return { queue, counts: { focus, reviews: queue.length - focus - newCount, fresh: newCount } };
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
