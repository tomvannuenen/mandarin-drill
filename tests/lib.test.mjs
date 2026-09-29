import { test } from 'node:test';
import assert from 'node:assert/strict';

import { toneOf, romanWords } from '../lib/tones.js';
import { grade, isDue } from '../lib/srs.js';
import { cardKey, unlocked, pickFill, pickVoice, nextVoice, UNLOCK_GOOD } from '../lib/cards.js';
import { buildQueue, shouldRequeue } from '../lib/session.js';
import { defaults, load, save, exportJSON, importJSON, applyReview, localDate, newToday } from '../lib/store.js';

const NOW = new Date(2026, 8, 23, 10, 0, 0);
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const later = (ms) => new Date(NOW.getTime() + ms);

function memStorage() {
  const m = {};
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } };
}

// ---- tones
test('toneOf reads tone marks, neutral is 5', () => {
  assert.deepEqual(['mā', 'má', 'mǎ', 'mà', 'ma', 'Xiāng', 'ma?'].map(toneOf), [1, 2, 3, 4, 5, 1, 5]);
});

test('romanWords splits words on spaces and syllables on hyphens', () => {
  assert.deepEqual(romanWords('wǒ xǐ-huān ma?'), [
    [{ text: 'wǒ', tone: 3 }],
    [{ text: 'xǐ', tone: 3 }, { text: 'huān', tone: 1 }],
    [{ text: 'ma?', tone: 5 }],
  ]);
});

test('romanWords reads Jyutping tone digits for Cantonese', () => {
  assert.deepEqual(romanWords('m4-goi1 maa3?', 'cantonese'), [
    [{ text: 'm4', tone: 4 }, { text: 'goi1', tone: 1 }],
    [{ text: 'maa3?', tone: 3 }],
  ]);
  assert.equal(romanWords('ngo5', 'cantonese')[0][0].tone, 5);
  assert.equal(romanWords('…', 'cantonese')[0][0].tone, 0);
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

test('pickVoice picks one of the entry voices', () => {
  const entry = { audio: { a: ['a.mp3', 'a-s.mp3'], b: ['b.mp3', 'b-s.mp3'], c: ['c.mp3', 'c-s.mp3'] } };
  assert.equal(pickVoice(entry, () => 0), 'a');
  assert.equal(pickVoice(entry, () => 0.99), 'c');
});

test('nextVoice cycles through the entry voices', () => {
  const entry = { audio: { a: [], b: [], c: [] } };
  assert.deepEqual(['a', 'b', 'c'].map((v) => nextVoice(entry, v)), ['b', 'c', 'a']);
  assert.equal(nextVoice(entry, 'unknown'), 'a');
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
  p.stats.newCounts.mandarin = { date: localDate(NOW), n: 2 };
  assert.equal(buildQueue(ITEMS, p, NOW, 3).length, 1);
});

test('new-card limits are counted per deck', () => {
  const p = defaults();
  p.stats.newCounts.mandarin = { date: localDate(NOW), n: 3 };
  assert.equal(buildQueue(ITEMS, p, NOW, 3, 'mandarin').length, 0);
  assert.equal(buildQueue(ITEMS, p, NOW, 3, 'cantonese').length, 3);
  const s = grade(null, 3, NOW);
  applyReview(p, { id: 'y', type: 'say', deck: 'cantonese' }, 3, s, NOW);
  assert.equal(newToday(p, NOW, 'cantonese'), 1);
  assert.equal(newToday(p, NOW, 'mandarin'), 3);
});

test('old single new-count is migrated to the Mandarin deck', () => {
  const st = memStorage();
  st.setItem('mandarin.progress.v1', JSON.stringify({ cards: {}, stats: { streak: 2, newCount: { date: localDate(NOW), n: 4 } } }));
  const p = load(st);
  assert.equal(newToday(p, NOW, 'mandarin'), 4);
  assert.equal(p.stats.streak, 2);
});

test('buildQueue adds unlocked listen/read cards without using the new limit', () => {
  const p = defaults();
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.goodCounts.a = UNLOCK_GOOD;
  p.settings.reading = true;
  const q = buildQueue(ITEMS, p, NOW, 0);
  assert.deepEqual(q.map((c) => c.key), ['a:listen', 'a:read']);
});

test('buildQueue leaves out reading cards unless reading practice is on', () => {
  const p = defaults();
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.cards['b:read'] = { ...grade(null, 3, NOW), due: later(-DAY).toISOString() };
  p.goodCounts.a = UNLOCK_GOOD;
  assert.deepEqual(buildQueue(ITEMS, p, NOW, 0).map((c) => c.key), ['a:listen']);
  p.settings.reading = true;
  assert.deepEqual(buildQueue(ITEMS, p, NOW, 0).map((c) => c.key), ['b:read', 'a:listen', 'a:read']);
});

test('drill and word-card ids never grow listen or read cards', () => {
  const p = defaults();
  p.settings.reading = true;
  const items = [{ id: 'w/mandarin/高興', kind: 'drill' }, { id: 'c/mandarin/高興', kind: 'char' }, { id: 'a' }];
  p.cards['w/mandarin/高興:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.cards['w/mandarin/高興:read'] = { ...grade(null, 3, NOW), due: later(-DAY).toISOString() }; // left over from the old bug
  p.cards['a:say'] = { ...grade(null, 3, NOW), due: later(DAY).toISOString() };
  p.goodCounts['w/mandarin/高興'] = 5;
  p.goodCounts['c/mandarin/高興'] = 5;
  assert.deepEqual(buildQueue(items, p, NOW, 0).map((c) => c.key), []);
});

test('shouldRequeue for cards due within 20 minutes', () => {
  assert.equal(shouldRequeue({ due: later(10 * MIN).toISOString() }, NOW), true);
  assert.equal(shouldRequeue({ due: later(DAY).toISOString() }, NOW), false);
});

// ---- store

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
