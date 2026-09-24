import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toneOf, pinyinWords } from '../lib/tones.js';
import { grade, isDue } from '../lib/srs.js';
import { cardKey, unlocked, pickFill, UNLOCK_GOOD } from '../lib/cards.js';
import { buildQueue, shouldRequeue } from '../lib/session.js';
import { defaults, load, save, exportJSON, importJSON, applyReview, localDate, newToday } from '../lib/store.js';

const NOW = new Date(2026, 8, 23, 10, 0, 0);
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const later = (ms) => new Date(NOW.getTime() + ms);

// ---- tones
test('toneOf reads tone marks, neutral is 5', () => {
  assert.deepEqual(['mā', 'má', 'mǎ', 'mà', 'ma', 'Xiāng', 'ma?'].map(toneOf), [1, 2, 3, 4, 5, 1, 5]);
});

test('pinyinWords splits words on spaces and syllables on hyphens', () => {
  assert.deepEqual(pinyinWords('wǒ xǐ-huān ma?'), [
    [{ text: 'wǒ', tone: 3 }],
    [{ text: 'xǐ', tone: 3 }, { text: 'huān', tone: 1 }],
    [{ text: 'ma?', tone: 5 }],
  ]);
});

// ---- srs
test('grade creates a card from nothing and survives JSON round-trip', () => {
  const s1 = grade(null, 3, NOW);
  assert.equal(typeof s1.due, 'string');
  const s2 = grade(JSON.parse(JSON.stringify(s1)), 3, later(DAY));
  assert.equal(s2.reps, 2);
  assert.ok(new Date(s2.due) > later(DAY));
});

test('Again schedules sooner than Easy', () => {
  const again = grade(null, 1, NOW);
  const easy = grade(null, 4, NOW);
  assert.ok(new Date(again.due) < new Date(easy.due));
});

test('isDue compares due date to now', () => {
  const s = grade(null, 4, NOW);
  assert.equal(isDue(s, NOW), false);
  assert.equal(isDue(s, later(365 * DAY)), true);
});

// ---- cards
test('cardKey', () => assert.equal(cardKey('xiexie', 'say'), 'xiexie:say'));

test('unlocked after UNLOCK_GOOD good say answers', () => {
  const p = defaults();
  assert.equal(unlocked('a', p), false);
  p.goodCounts.a = UNLOCK_GOOD - 1;
  assert.equal(unlocked('a', p), false);
  p.goodCounts.a = UNLOCK_GOOD;
  assert.equal(unlocked('a', p), true);
});

const PATTERN = {
  id: 'he-x', kind: 'pattern',
  fills: [{ fillId: 'kafei', zh: '我喜歡喝咖啡' }, { fillId: 'shui', zh: '我喜歡喝水' }, { fillId: 'pijiu', zh: '我喜歡喝啤酒' }],
};

test('pickFill prefers fills whose word has been introduced', () => {
  const p = defaults();
  p.cards['shui:say'] = grade(null, 3, NOW);
  for (const r of [0, 0.5, 0.99]) assert.equal(pickFill(PATTERN, p, () => r).fillId, 'shui');
});

test('pickFill falls back to any fill', () => {
  assert.equal(pickFill(PATTERN, defaults(), () => 0.99).fillId, 'pijiu');
});

// ---- session
const ITEMS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

test('buildQueue: due cards first (oldest first), then new say cards in order up to limit', () => {
  const p = defaults();
  p.cards['c:say'] = { ...grade(null, 3, NOW), due: later(-2 * DAY).toISOString() };
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(-1 * DAY).toISOString() };
  const q = buildQueue(ITEMS, p, NOW, 1);
  assert.deepEqual(q.map((c) => c.key), ['c:say', 'a:say', 'b:say']);
});

test('buildQueue skips cards not yet due and items no longer present', () => {
  const p = defaults();
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.cards['gone:say'] = { ...grade(null, 3, NOW), due: later(-DAY).toISOString() };
  const q = buildQueue(ITEMS, p, NOW, 10);
  assert.deepEqual(q.map((c) => c.key), ['b:say', 'c:say', 'd:say']);
});

test('buildQueue introduces coach weeks before extra sets', () => {
  const items = [{ id: 'v1', set: 'Verbs' }, { id: 'w1', week: 1 }, { id: 'v2', set: 'Verbs' }, { id: 'w2', week: 2 }];
  assert.deepEqual(buildQueue(items, defaults(), NOW, 3).map((c) => c.id), ['w1', 'w2', 'v1']);
});

test('buildQueue counts new cards already introduced today against the limit', () => {
  const p = defaults();
  p.stats.newCount = { date: localDate(NOW), n: 2 };
  assert.equal(buildQueue(ITEMS, p, NOW, 3).length, 1);
});

test('buildQueue adds unlocked listen/read cards without using the new limit', () => {
  const p = defaults();
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.goodCounts.a = UNLOCK_GOOD;
  const q = buildQueue(ITEMS, p, NOW, 0);
  assert.deepEqual(q.map((c) => c.key), ['a:listen', 'a:read']);
});

test('shouldRequeue for cards due within 20 minutes', () => {
  assert.equal(shouldRequeue({ due: later(10 * MIN).toISOString() }, NOW), true);
  assert.equal(shouldRequeue({ due: later(DAY).toISOString() }, NOW), false);
});

// ---- store
function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}

test('load returns defaults for empty or broken storage', () => {
  assert.deepEqual(load(memStorage()), defaults());
  const bad = { getItem: () => { throw new Error('denied'); }, setItem() {} };
  assert.deepEqual(load(bad), defaults());
  const garbage = memStorage();
  garbage.setItem('mandarin.progress.v1', '{not json');
  assert.deepEqual(load(garbage), defaults());
});

test('save then load round-trips', () => {
  const st = memStorage();
  const p = defaults();
  p.goodCounts.a = 3;
  assert.equal(save(st, p), true);
  assert.deepEqual(load(st), p);
});

test('save reports failure instead of throwing', () => {
  assert.equal(save({ setItem() { throw new Error('quota'); } }, defaults()), false);
});

test('export/import round-trip; import rejects garbage', () => {
  const p = defaults();
  p.cards['a:say'] = grade(null, 3, NOW);
  assert.deepEqual(importJSON(exportJSON(p)), p);
  assert.throws(() => importJSON('nope'));
  assert.throws(() => importJSON('{"hello": 1}'));
});

test('applyReview records card, good count, new count and streak', () => {
  const p = defaults();
  const s = grade(null, 3, NOW);
  applyReview(p, { id: 'a', type: 'say' }, 3, s, NOW);
  assert.equal(p.cards['a:say'], s);
  assert.equal(p.goodCounts.a, 1);
  assert.equal(newToday(p, NOW), 1);
  assert.deepEqual([p.stats.streak, p.stats.lastStudyDate], [1, localDate(NOW)]);

  applyReview(p, { id: 'a', type: 'say' }, 1, s, NOW); // Again: no good count, not new, same day
  assert.equal(p.goodCounts.a, 1);
  assert.equal(newToday(p, NOW), 1);
  assert.equal(p.stats.streak, 1);

  applyReview(p, { id: 'a', type: 'listen' }, 4, s, NOW); // listen does not count toward unlock or new limit
  assert.equal(p.goodCounts.a, 1);
  assert.equal(newToday(p, NOW), 1);
});

test('good answers count at most once per day toward unlocking', () => {
  const p = defaults();
  const s = grade(null, 3, NOW);
  applyReview(p, { id: 'a', type: 'say' }, 3, s, NOW);
  applyReview(p, { id: 'a', type: 'say' }, 3, s, later(10 * MIN));
  assert.equal(p.goodCounts.a, 1);
  applyReview(p, { id: 'a', type: 'say' }, 3, s, later(DAY));
  assert.equal(p.goodCounts.a, 2);
});

test('streak continues on consecutive days and resets after a gap', () => {
  const p = defaults();
  const s = grade(null, 3, NOW);
  applyReview(p, { id: 'a', type: 'say' }, 3, s, NOW);
  applyReview(p, { id: 'b', type: 'say' }, 3, s, later(DAY));
  assert.equal(p.stats.streak, 2);
  assert.equal(newToday(p, later(DAY)), 1);
  applyReview(p, { id: 'c', type: 'say' }, 3, s, later(4 * DAY));
  assert.equal(p.stats.streak, 1);
});
