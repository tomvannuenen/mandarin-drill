import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { troubleSpots } from '../lib/weak.js';
import { applyPlan, planIsCurrent } from '../lib/plan.js';
import { toBase64, fromBase64 } from '../lib/sync.js';

const NOW = new Date(2026, 8, 27, 8);
const PLAN = { date: '2026-09-27', message: 'Focus on láizì', words: [{ deck: 'mandarin', zh: '來自' }], items: ['wo-laizi-x'] };

test('applyPlan turns the focus words into trouble spots once per plan', () => {
  const p = defaults();
  assert.equal(applyPlan(p, PLAN, NOW), true);
  assert.deepEqual(troubleSpots(p, 'mandarin').map((t) => t.zh), ['來自']);
  assert.ok(p.cards['w/mandarin/來自:say'], 'practice card is due');
  assert.equal(applyPlan(p, PLAN, NOW), false);
  assert.equal(troubleSpots(p, 'mandarin')[0].score, 2);
});

test('applyPlan ignores empty plans', () => {
  const p = defaults();
  assert.equal(applyPlan(p, { date: null, words: [] }, NOW), false);
  assert.equal(applyPlan(p, null, NOW), false);
});

test('a plan is shown on its day and the day after', () => {
  assert.equal(planIsCurrent(PLAN, NOW), true);
  assert.equal(planIsCurrent(PLAN, new Date(2026, 8, 28, 20)), true);
  assert.equal(planIsCurrent(PLAN, new Date(2026, 8, 29, 8)), false);
  assert.equal(planIsCurrent({ date: null }, NOW), false);
});

test('base64 round-trips Chinese text', () => {
  const s = JSON.stringify({ zh: '我來自荷蘭', roman: 'wǒ láizì' });
  assert.equal(fromBase64(toBase64(s)), s);
  assert.equal(fromBase64(toBase64(s).replace(/(.{10})/g, '$1\n')), s); // GitHub wraps base64 lines
});
