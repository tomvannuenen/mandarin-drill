import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults, applyReview, localDate, newToday } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { charId, charItems, newCharCards, newBuildCards, knowsWord, tiles, isBuilt, markReading, readingTrouble } from '../lib/chars.js';
import { buildQueue } from '../lib/session.js';

const NOW = new Date(2026, 8, 28, 9);
const w = (zh, roman, gloss) => ({ zh, roman, gloss });
const ITEMS = [
  { id: 'wo', kind: 'word', deck: 'mandarin', zh: '我', words: [w('我', 'wǒ', 'I')], audio: { v: ['wo.mp3', 'wo-s.mp3'] } },
  { id: 'a', kind: 'phrase', deck: 'mandarin', zh: '我喜歡喝咖啡', en: 'I like coffee', words: [w('我', 'wǒ', 'I'), w('喜歡', 'xǐ-huān', 'to like'), w('喝', 'hē', 'drink'), w('咖啡', 'kā-fēi', 'coffee')] },
  { id: 'b', kind: 'phrase', deck: 'mandarin', zh: '你喜歡喝什麼？', en: 'What do you like to drink?', words: [w('你', 'nǐ', 'you'), w('喜歡', 'xǐ-huān', 'to like'), w('喝', 'hē', 'drink'), w('什麼', 'shé-me', 'what')] },
  { id: 'p', kind: 'pattern', deck: 'mandarin', zh: '我是___人', fills: [{ fillId: 'helan', zh: '我是荷蘭人', en: 'I am Dutch', words: [w('我', 'wǒ', 'I'), w('是', 'shì', 'am'), w('荷蘭', 'Hé-lán', 'NL'), w('人', 'rén', 'person')] }] },
  { id: 'y', kind: 'phrase', deck: 'cantonese', zh: '唔該', words: [w('唔該', 'm4-goi1', 'thanks')] },
];
const seen = (p, ...ids) => ids.forEach((id) => { p.cards[`${id}:say`] = grade(null, 3, NOW); });

test('charItems collects words from phrases you have met, most frequent first, with an example', () => {
  const p = defaults();
  seen(p, 'a', 'b');
  const list = charItems(ITEMS, p, 'mandarin');
  assert.deepEqual(list.slice(0, 2).map((c) => [c.zh, c.freq]), [['喜歡', 2], ['喝', 2]]);
  const wo = list.find((c) => c.zh === '我');
  assert.equal(wo.id, charId('mandarin', '我'));
  assert.equal(wo.kind, 'char');
  assert.deepEqual(wo.audio, { v: ['wo.mp3', 'wo-s.mp3'] }); // the word card's own recording
  assert.equal(list.find((c) => c.zh === '什麼').example.zh, '你喜歡喝什麼？');
  assert.ok(!list.some((c) => c.zh === '荷蘭'), 'pattern not met yet');
});

test('newCharCards respects the daily limit, counted per deck', () => {
  const p = defaults();
  seen(p, 'a', 'b');
  const list = charItems(ITEMS, p, 'mandarin');
  assert.equal(newCharCards(list, p, 'mandarin', NOW, 3).length, 3);
  p.stats.newCounts['mandarin:char'] = { date: localDate(NOW), n: 2 };
  assert.deepEqual(newCharCards(list, p, 'mandarin', NOW, 3).map((q) => q.type), ['char']);
});

test('build cards appear once a multi-word phrase is solid', () => {
  const p = defaults();
  seen(p, 'a', 'b', 'p');
  p.goodCounts = { a: 2, p: 2, wo: 5 };
  assert.deepEqual(newBuildCards(ITEMS, p, 'mandarin', NOW, 5).map((q) => q.key), ['a:build', 'p:build']);
  assert.equal(newBuildCards(ITEMS, p, 'mandarin', NOW, 1).length, 1);
});

test('reviewing new char and build cards counts toward their own daily limits', () => {
  const p = defaults();
  applyReview(p, { id: charId('mandarin', '喝'), type: 'char', deck: 'mandarin' }, 3, grade(null, 3, NOW), NOW);
  applyReview(p, { id: 'a', type: 'build', deck: 'mandarin' }, 3, grade(null, 3, NOW), NOW);
  assert.equal(newToday(p, NOW, 'mandarin:char'), 1);
  assert.equal(newToday(p, NOW, 'mandarin:build'), 1);
  assert.equal(newToday(p, NOW, 'mandarin'), 0);
});

test('due char and build cards come back through buildQueue, but chars are never new say cards', () => {
  const p = defaults();
  seen(p, 'a');
  const cid = charId('mandarin', '喝');
  p.cards[`${cid}:char`] = { ...grade(null, 3, NOW), due: '2020-01-01T00:00:00Z' };
  p.cards['a:build'] = { ...grade(null, 3, NOW), due: '2020-01-01T00:00:00Z' };
  const q = buildQueue([...ITEMS.filter((i) => i.deck === 'mandarin'), ...charItems(ITEMS, p, 'mandarin')], p, NOW, 0);
  assert.deepEqual(q.map((c) => c.key).sort(), [`${cid}:char`, 'a:build'].sort());
});

test('knowsWord after recognising it on two different days', () => {
  const p = defaults();
  const cid = charId('mandarin', '喝');
  assert.equal(knowsWord(p, 'mandarin', '喝'), false);
  p.cards[`${cid}:char`] = grade(null, 3, NOW);
  p.goodCounts[cid] = 2;
  assert.equal(knowsWord(p, 'mandarin', '喝'), true);
});

test('tiles are the sentence words plus decoys, shuffled; isBuilt checks the order', () => {
  const entry = ITEMS[2];
  const pool = charItems(ITEMS, Object.assign(defaults(), { cards: { 'a:say': {}, 'b:say': {} } }), 'mandarin');
  const t = tiles(entry, pool, () => 0.42, 2);
  assert.equal(t.length, 6);
  assert.equal(t.filter((x) => x.decoy).length, 2);
  for (const d of t.filter((x) => x.decoy)) assert.ok(!entry.words.some((ww) => ww.zh === d.zh));
  assert.equal(isBuilt(entry, ['你', '喜歡', '喝', '什麼']), true);
  assert.equal(isBuilt(entry, ['喜歡', '你', '喝', '什麼']), false);
});

test('missing a Read it card marks a reading problem, separate from speaking trouble spots', () => {
  const p = defaults();
  markReading(p, 'mandarin', '喝', false, NOW);
  assert.deepEqual(readingTrouble(p, 'mandarin').map((t) => [t.zh, t.score]), [['喝', 2]]);
  assert.deepEqual(p.weak, {}, 'no speaking trouble spot');
  const later = (d) => new Date(NOW.getTime() + d * 86400000);
  markReading(p, 'mandarin', '喝', true, NOW); // same day: no credit
  markReading(p, 'mandarin', '喝', true, later(1));
  markReading(p, 'mandarin', '喝', true, later(1));
  assert.equal(readingTrouble(p, 'mandarin')[0].score, 1);
  markReading(p, 'mandarin', '喝', true, later(2));
  assert.deepEqual(readingTrouble(p, 'mandarin'), []);
});

test('a word with a reading problem gets its pinyin support back', () => {
  const p = defaults();
  const cid = charId('mandarin', '喝');
  p.cards[`${cid}:char`] = grade(null, 3, NOW);
  p.goodCounts[cid] = 3;
  assert.equal(knowsWord(p, 'mandarin', '喝'), true);
  markReading(p, 'mandarin', '喝', false, NOW);
  assert.equal(knowsWord(p, 'mandarin', '喝'), false);
});
