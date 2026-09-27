// "Today's focus": a daily plan written by a scheduled Claude task into the private sync repo.
// {date: 'YYYY-MM-DD', message, words: [{deck, zh}], items: [itemId]}
import { localDate } from './store.js';
import { grade } from './srs.js';
import { flagWord } from './weak.js';

const DAY = 86400000;

// New plans push their focus words into the trouble spots once, with a practice card due now.
export function applyPlan(progress, plan, now) {
  if (!plan?.date || progress.planApplied === plan.date) return false;
  for (const { deck, zh } of plan.words || []) {
    const id = flagWord(progress, deck, zh, now);
    progress.cards[`${id}:say`] ||= grade(null, 1, now);
  }
  progress.planApplied = plan.date;
  return true;
}

export function planIsCurrent(plan, now) {
  if (!plan?.date) return false;
  const age = new Date(`${localDate(now)}T12:00:00`) - new Date(`${plan.date}T12:00:00`);
  return age >= 0 && age <= DAY;
}
