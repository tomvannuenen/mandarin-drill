// FSRS scheduling over ts-fsrs. States are stored as plain JSON (ISO date strings).
import { fsrs, generatorParameters, createEmptyCard } from '../vendor/ts-fsrs.js';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

function revive(state) {
  return {
    ...state,
    due: new Date(state.due),
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  };
}

export function grade(state, rating, now) {
  const card = state ? revive(state) : createEmptyCard(now);
  return JSON.parse(JSON.stringify(scheduler.next(card, now, rating).card));
}

export function isDue(state, now) {
  return new Date(state.due) <= now;
}
