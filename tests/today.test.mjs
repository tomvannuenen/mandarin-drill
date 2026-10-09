import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { composeToday, withActivities, snapshot, outcome, dueSoon, estimateMinutes } from '../lib/today.js';

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

test('composeToday always leaves room for the new speaking cards', () => {
  const p = defaults();
  const ids = Array.from({ length: 60 }, (_, i) => `i${i}`);
  const items = ids.map((id) => ({ id, kind: 'phrase', deck: 'mandarin', week: 1 }));
  // 30 phrases are due and have unlocked listen cards that were never shown; 30 are unseen.
  for (const id of ids.slice(0, 30)) {
    p.cards[`${id}:say`] = past(1);
    p.goodCounts[id] = 2;
  }
  const { queue, counts } = composeToday({ items, drills: [], progress: p, plan: null, now: NOW, newLimit: 10, deck: 'mandarin' });
  assert.equal(queue.length, 32);
  assert.deepEqual(queue.filter((q) => !p.cards[q.key] && q.type === 'say').map((q) => q.id), ids.slice(30, 40));
  assert.equal(counts.reviews, 22);
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

test('a word that is hard to read gets a Read it card even before it had one', () => {
  const p = defaults();
  const items = [{ id: 'a', kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '高興' }] }];
  p.cards['a:say'] = future(9);
  p.weakChars = { 'mandarin/高興': { score: 2, flags: 1 }, 'mandarin/不在': { score: 2, flags: 1 } };
  const chars = [{ id: 'c/mandarin/高興', kind: 'char', deck: 'mandarin', zh: '高興' }];
  const { queue } = composeToday({ items, drills: [], chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', charLimit: 0, buildLimit: 0 });
  assert.deepEqual(queue.map((q) => q.key), ['c/mandarin/高興:char']);
});

test('composeToday ignores stale plans and caps long days', () => {
  const p = defaults();
  const many = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}`, deck: 'mandarin', week: 1 }));
  for (const it of many) p.cards[`${it.id}:say`] = past(1);
  const old = { date: '2026-09-20', items: ['x59'] };
  const { queue } = composeToday({ items: many, drills: [], progress: p, plan: old, now: NOW, newLimit: 5, deck: 'mandarin' });
  assert.equal(queue.length, 32);
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

test('a deck without character work gets no read, word or build cards', () => {
  const p = defaults();
  p.settings.reading = true;
  p.cards['a:say'] = past(1);
  p.cards['a:read'] = past(1);
  p.cards['a:build'] = past(1);
  p.cards['c/mandarin/好:char'] = past(1);
  const chars = [{ id: 'c/mandarin/好', kind: 'char', deck: 'mandarin', zh: '好' }];
  const { queue } = composeToday({ items: ITEMS, drills: [], chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', characters: false });
  assert.deepEqual(queue.map((q) => q.key), ['a:say']);
});

test('composeToday keeps the warm-up short and always fits the new words and builds', () => {
  const p = defaults();
  const words = '一二三四五六七八九十百千'.split('');
  const items = Array.from({ length: 45 }, (_, n) => ({ id: `i${n}`, kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '我' }, { zh: '喝' }] }));
  for (const { id } of items) {
    p.cards[`${id}:say`] = past(1);
    p.cards[`${id}:listen`] = past(1);
    p.goodCounts[id] = 2;
  }
  const drills = words.map((zh) => ({ id: `w/mandarin/${zh}`, kind: 'drill', deck: 'mandarin', zh }));
  const chars = [...words, '我', '喝', '你'].map((zh) => ({ id: `c/mandarin/${zh}`, kind: 'char', deck: 'mandarin', zh }));
  words.forEach((zh, n) => {
    p.weak[`w/mandarin/${zh}`] = { score: n + 1, flags: 1 };
    p.cards[`w/mandarin/${zh}:say`] = past(1);
    p.weakChars[`mandarin/${zh}`] = { score: n + 1, flags: 1, lastDay: '2026-09-20' };
    p.cards[`c/mandarin/${zh}:char`] = future(5);
  });
  const { queue, counts } = composeToday({ items, drills, chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin' });
  assert.equal(queue.length, 32);
  assert.deepEqual(queue.slice(0, 5).map((q) => q.id), ['千', '百', '十', '九', '八'].map((zh) => `w/mandarin/${zh}`), 'the five weakest drills');
  assert.deepEqual(queue.slice(5, 8).map((q) => q.key), ['千', '百', '十'].map((zh) => `c/mandarin/${zh}:char`), 'the three hardest to read');
  assert.equal(counts.focus, 8);
  assert.deepEqual([counts.chars, counts.builds], [3, 3], 'new word cards and builds are never squeezed out');
});

test('a hard-to-read word already handled today does not open the next session again', () => {
  const p = defaults();
  const items = [{ id: 'a', kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '我' }, { zh: '喝' }] }];
  p.cards['a:say'] = future(9);
  p.cards['c/mandarin/喝:char'] = future(5);
  p.weakChars = { 'mandarin/喝': { score: 2, flags: 1, lastDay: '2026-09-27' } };
  const chars = [{ id: 'c/mandarin/喝', kind: 'char', deck: 'mandarin', zh: '喝' }];
  const { queue } = composeToday({ items, drills: [], chars, progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', charLimit: 0, buildLimit: 0 });
  assert.deepEqual(queue, []);
});

test('withActivities: a new phrase is heard first and tested a few cards later; a failed one is practised before its retest', () => {
  const w = (n) => Array.from({ length: n }, (_, i) => ({ zh: `字${i}`, roman: 'zi' }));
  const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, kind: 'phrase', deck: 'mandarin', words: w(4), en: id }));
  items.push({ id: 'new', kind: 'phrase', deck: 'mandarin', words: w(4), en: 'new' });
  const p = defaults();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) p.cards[`${id}:say`] = past(1);
  p.log.push([NOW.getTime() - DAY, 'b:say', 1]); // b went wrong last time
  const say = (id) => ({ key: `${id}:say`, id, type: 'say', deck: 'mandarin' });
  const queue = [say('new'), say('a'), say('b'), say('c'), say('d'), say('e'), say('f')];
  const out = withActivities({ queue, items, progress: p, stats: {}, deck: 'mandarin', rand: () => 0 });
  const keys = out.map((q) => q.key);
  assert.ok(['new:echo', 'new:chain'].includes(keys[0]), 'the new phrase is introduced by ear');
  assert.equal(keys.indexOf('new:say') - 0 >= 4, true, 'and tested a few cards later');
  const bPractice = keys.findIndex((k) => k.startsWith('b:') && k !== 'b:say');
  assert.ok(bPractice >= 0 && bPractice < keys.indexOf('b:say'), 'b is practised another way before its test');
  assert.equal(keys.filter((k) => k.endsWith(':say')).length, 7, 'no test is lost');
  assert.equal(out.filter((q) => q.type === 'ear' && !['new', 'b'].includes(q.id)).length, 4, 'a short listening round');
  assert.equal(out.find((q) => q.key === keys[0]).activity, true);
});
