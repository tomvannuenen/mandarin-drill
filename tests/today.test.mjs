import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { composeToday, withActivities, MIX, snapshot, outcome, dueSoon, estimateMinutes } from '../lib/today.js';

const NOW = new Date(2026, 8, 27, 8);
const DAY = 86400000;
const past = (d) => ({ ...grade(null, 3, NOW), due: new Date(NOW.getTime() - d * DAY).toISOString() });
const future = (d) => ({ ...grade(null, 3, NOW), due: new Date(NOW.getTime() + d * DAY).toISOString() });
const ITEMS = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, deck: 'mandarin', week: 1 }));

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


test('composeToday opens on trouble words, then new phrases, focus and reviews', () => {
  const p = defaults();
  p.cards['a:say'] = past(1);
  p.cards['b:say'] = past(2);
  p.cards['c:say'] = future(9); // not due, but in today's focus
  p.cards['w/mandarin/來自:say'] = past(0);
  const drills = [{ id: 'w/mandarin/來自', kind: 'drill', deck: 'mandarin' }];
  const plan = { date: '2026-09-27', items: ['c'] };
  const { queue, counts } = composeToday({ items: ITEMS, drills, progress: p, plan, now: NOW, newLimit: 2, deck: 'mandarin' });
  assert.deepEqual(queue.map((q) => q.key), ['w/mandarin/來自:say', 'd:say', 'e:say', 'c:say', 'b:say', 'a:say']);
  assert.deepEqual(counts, { focus: 1, reviews: 3, fresh: 2, chars: 0, builds: 0 });
  const stale = composeToday({ items: ITEMS, drills, progress: p, plan: { date: '2026-09-20', items: ['c'] }, now: NOW, newLimit: 0, deck: 'mandarin' });
  assert.ok(!stale.queue.some((q) => q.key === 'c:say'), 'an old plan is ignored');
});

test('composeToday keeps each kind of card to its share, and new material always fits', () => {
  const p = defaults();
  const words = '一二三四五六七八九十'.split('');
  const items = Array.from({ length: 50 }, (_, n) => ({ id: `i${n}`, kind: 'phrase', deck: 'mandarin', week: 1, words: [{ zh: '我' }, { zh: '喝' }] }));
  for (const { id } of items.slice(0, 30)) {
    p.cards[`${id}:say`] = past(1);
    p.cards[`${id}:listen`] = past(1);
    p.cards[`${id}:read`] = past(1);
    p.cards[`${id}:build`] = past(1);
    p.goodCounts[id] = 2;
  }
  p.settings.reading = true;
  const drills = words.map((zh) => ({ id: `w/mandarin/${zh}`, kind: 'drill', deck: 'mandarin', zh }));
  const chars = words.map((zh) => ({ id: `c/mandarin/${zh}`, kind: 'char', deck: 'mandarin', zh }));
  words.forEach((zh, n) => {
    p.weak[`w/mandarin/${zh}`] = { score: n + 1, flags: 1 };
    p.cards[`w/mandarin/${zh}:say`] = past(1);
    if (n < 8) p.cards[`c/mandarin/${zh}:char`] = past(1);
  });
  const { queue, counts } = composeToday({ items, drills, chars, progress: p, plan: null, now: NOW, newLimit: 14, deck: 'mandarin' });
  const n = (f) => queue.filter(f).length;
  assert.deepEqual(queue.slice(0, MIX.drills).map((q) => q.id), ['十', '九', '八'].map((zh) => `w/mandarin/${zh}`), 'the weakest trouble words open');
  assert.equal(n((q) => q.id.startsWith('w/')), MIX.drills);
  assert.equal(n((q) => q.type === 'say' && !q.id.startsWith('w/')), 14, 'all 14 new phrases, though the share is 11');
  assert.equal(n((q) => q.type === 'char'), MIX.chars);
  assert.equal(n((q) => q.type === 'read'), MIX.read);
  assert.equal(n((q) => q.type === 'listen'), MIX.listen);
  assert.equal(n((q) => q.type === 'build'), MIX.builds);
  assert.deepEqual([counts.fresh, counts.chars, counts.builds], [14, 2, 0]);
  // No kind comes in a block: the two read-aloud cards sit in different halves.
  const reads = queue.map((q, i) => (q.type === 'read' ? i : -1)).filter((i) => i >= 0);
  assert.ok(reads[0] < queue.length / 2 && reads[1] > queue.length / 2);
});

test('composeToday fills the speaking share with phrases that are due soon', () => {
  const p = defaults();
  const items = Array.from({ length: 20 }, (_, n) => ({ id: `i${n}`, kind: 'phrase', deck: 'mandarin', week: 1 }));
  items.forEach(({ id }, n) => { p.cards[`${id}:say`] = n < 4 ? past(1) : future(n < 12 ? 2 : 9); });
  const { queue } = composeToday({ items, drills: [], progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin' });
  assert.equal(queue.length, MIX.say);
  assert.deepEqual(queue.slice(0, 4).map((q) => q.id), ['i0', 'i1', 'i2', 'i3'], 'what is due comes first');
  assert.ok(queue.every((q) => Number(q.id.slice(1)) < 12), 'nothing due more than a few days out');
  const again = composeToday({ items, drills: [], progress: p, plan: null, now: NOW, newLimit: 0, deck: 'mandarin', topUp: false });
  assert.equal(again.queue.length, 4, 'after the day is done, only what is really due');
});

test('withActivities: learn before test, practice after a miss, listening tasks, tones and a closing passage', () => {
  const w = (n) => Array.from({ length: n }, (_, i) => ({ zh: `字${i}`, roman: 'zì' }));
  const ids = 'abcdefghijklmnop'.split('');
  const items = ids.map((id) => ({ id, kind: 'phrase', deck: 'mandarin', words: w(4), en: id }));
  items.push({ id: 'new', kind: 'phrase', deck: 'mandarin', words: w(4), en: 'new' });
  const p = defaults();
  for (const id of ids) p.cards[`${id}:say`] = past(1);
  p.log.push([NOW.getTime() - DAY, 'b:say', 1]); // b went wrong last time
  const say = (id) => ({ key: `${id}:say`, id, type: 'say', deck: 'mandarin' });
  const queue = [say('new'), ...ids.slice(0, 6).map(say)];
  const out = withActivities({ queue, items, progress: p, stats: {}, deck: 'mandarin', rand: () => 0 });
  const keys = out.map((q) => q.key);
  assert.ok(['new:echo', 'new:chain'].includes(keys[0]), 'the new phrase is introduced by ear');
  assert.ok(keys.indexOf('new:say') >= 4, 'and tested a few cards later');
  const practice = keys.findIndex((k) => k.startsWith('b:') && k !== 'b:say');
  assert.ok(practice >= 0 && practice < keys.indexOf('b:say'), 'b is practised another way before its test');
  assert.equal(keys.filter((k) => k.endsWith(':say')).length, 7, 'no test is lost');
  const types = out.map((q) => q.type);
  const n = (t) => types.filter((x) => x === t).length;
  const bFirst = keys[practice].split(':')[1];
  assert.deepEqual([n('dictate'), n('fill'), n('ear'), n('match')].map((x, i) => x - (['dictate', 'fill', 'ear', 'match'][i] === bFirst ? 1 : 0)), [2, 1, 1, 1], 'five listening tasks, rebuilding by ear twice');
  assert.equal(n('tone') - (bFirst === 'tone' ? 1 : 0), 2);
  assert.equal(out.find((q) => q.type === 'pairs').ids.length, 4);
  const last = out.at(-1);
  assert.equal(last.type, 'passage');
  assert.deepEqual(last.ids, out.filter((q) => q.type === 'say').map((q) => q.id).slice(0, 5), "today's sentences, to listen through");
  assert.ok(out.filter((q) => ['dictate', 'fill', 'ear', 'match', 'tone'].includes(q.type) && q.id !== 'b').every((q) => !['new', 'a', 'c', 'd', 'e', 'f'].includes(q.id)), 'listening goes to phrases not tested today');
  const used = out.filter((q) => q.activity && q.type !== 'passage').flatMap((q) => q.ids || [q.id]);
  assert.equal(new Set(used).size, used.length, 'each on a different phrase');
  const later = withActivities({ queue, items, progress: p, stats: {}, deck: 'mandarin', extras: false, rand: () => 0 });
  assert.equal(later.length, queue.length + 2, 'a later session the same day: only the introduction and the practice');
  // A kind that was dropped gives up its place.
  const stats = { echo: { n: 10, ok: 9 }, dictate: { n: 10, ok: 2 } };
  const without = withActivities({ queue, items, progress: p, stats, deck: 'mandarin', rand: () => 0 });
  assert.equal(without.filter((q) => q.type === 'dictate').length, 0);
});
