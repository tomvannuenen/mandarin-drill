import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { composeToday, snapshot, outcome, dueSoon, estimateMinutes } from '../lib/today.js';

const NOW = new Date(2026, 8, 27, 8);
const DAY = 86400000;
const past = (d) => ({ ...grade(null, 3, NOW), due: new Date(NOW.getTime() - d * DAY).toISOString() });
const future = (d) => ({ ...grade(null, 3, NOW), due: new Date(NOW.getTime() + d * DAY).toISOString() });
const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, deck: 'mandarin', week: 1 }));

test('composeToday puts trouble spots and focus first, then reviews mixed with new cards', () => {
  const p = defaults();
  p.cards['a:say'] = past(1);
  p.cards['b:say'] = past(2);
  p.cards['c:say'] = future(3); // not due, but in today's focus
  p.cards['w/mandarin/來自:say'] = past(0);
  const drills = [{ id: 'w/mandarin/來自', kind: 'drill', deck: 'mandarin' }];
  const plan = { date: '2026-09-27', items: ['c'] };
  const { queue, counts } = composeToday({ items: ITEMS, drills, progress: p, plan, now: NOW, newLimit: 2, deck: 'mandarin' });
  assert.deepEqual(queue.map((q) => q.key), ['w/mandarin/來自:say', 'c:say', 'b:say', 'd:say', 'a:say', 'e:say']);
  assert.deepEqual(counts, { focus: 2, reviews: 2, fresh: 2, chars: 0, builds: 0 });
});

test('composeToday mixes in a few new word cards and sentence builds', () => {
  const p = defaults();
  const items = [
    { id: 'a', kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '我' }, { zh: '喝' }] },
    { id: 'b', kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '你' }, { zh: '好' }] },
  ];
  p.cards['a:say'] = future(9);
  p.cards['b:say'] = past(1);
  p.goodCounts.a = 2;
  const chars = ['我', '喝', '你', '好'].map((zh) => ({ id: `c/mandarin/${zh}`, kind: 'char', deck: 'mandarin', zh }));
  const { queue, counts } = composeToday({ items, drills: [], chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', charLimit: 3, buildLimit: 2 });
  assert.deepEqual(queue.map((q) => q.type).sort(), ['build', 'char', 'char', 'char', 'listen', 'say'].sort());
  assert.deepEqual([counts.chars, counts.builds], [3, 1]);
});

test('composeToday puts words that are hard to read up front, as Read it cards', () => {
  const p = defaults();
  const items = [{ id: 'a', kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '我' }, { zh: '喝' }] }];
  p.cards['a:say'] = future(9);
  p.cards['c/mandarin/喝:char'] = future(5);
  p.weakChars = { 'mandarin/喝': { score: 2, flags: 1 } };
  const chars = [{ id: 'c/mandarin/喝', kind: 'char', deck: 'mandarin', zh: '喝' }];
  const { queue } = composeToday({ items, drills: [], chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', charLimit: 0, buildLimit: 0 });
  assert.equal(queue[0].key, 'c/mandarin/喝:char');
});

test('composeToday ignores stale plans and caps long days', () => {
  const p = defaults();
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, deck: 'mandarin', week: 1 }));
  for (const it of many) p.cards[`${it.id}:say`] = past(1);
  const old = { date: '2026-09-20', items: ['x59'] };
  const { queue } = composeToday({ items: many, drills: [], progress: p, plan: old, now: NOW, newLimit: 5, deck: 'mandarin' });
  assert.equal(queue.length, 40);
});

test('outcome reports phrases that became solid and trouble spots that cleared', () => {
  const p = defaults();
  p.goodCounts = { a: 1, b: 2 };
  p.weak = { 'w/mandarin/來自': { score: 1 }, 'w/mandarin/什麼': { score: 2 } };
  const before = snapshot(p);
  p.goodCounts.a = 2;
  p.weak['w/mandarin/來自'].score = 0;
  const out = outcome(before, p, ITEMS, 'mandarin');
  assert.deepEqual(out.solid.map((i) => i.id), ['a']);
  assert.deepEqual(out.cleared, ['來自']);
});

test('dueSoon counts cards due before the end of tomorrow', () => {
  const p = defaults();
  p.cards['a:say'] = future(0.5);
  p.cards['b:say'] = future(1.2);
  p.cards['c:say'] = future(5);
  assert.equal(dueSoon(p, ITEMS, NOW), 2);
});

test('estimateMinutes rounds about 30 seconds per card', () => {
  assert.equal(estimateMinutes(19), 10);
  assert.equal(estimateMinutes(1), 1);
});
