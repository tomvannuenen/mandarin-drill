import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults, localDate } from '../lib/store.js';
import { drillId, flagWord, credit, troubleSpots, drillItems, drillPrompt } from '../lib/weak.js';
import { isSolid, weekReadiness, daysUntil, canSay, pickMission, markMissionDone, missionDoneToday } from '../lib/motivation.js';

const NOW = new Date(2026, 8, 23, 10); // a Wednesday
const DAY = 86400000;
const w = (zh, roman, gloss) => ({ zh, roman, gloss });
const ITEMS = [
  { id: 'laizi-x', kind: 'pattern', deck: 'mandarin', week: 1, topic: 'Intro', mission: 'Say where you are from', zh: '我來自___',
    fills: [{ fillId: 'helan', zh: '我來自荷蘭', en: 'I come from the Netherlands', words: [w('我', 'wǒ', 'I'), w('來自', 'lái-zì', 'to come from'), w('荷蘭', 'Hé-lán', 'NL')] }] },
  { id: 'xiexie', kind: 'phrase', deck: 'mandarin', week: 1, topic: 'Small talk', mission: 'Thank someone', zh: '謝謝', en: 'Thanks', words: [w('謝謝', 'xiè-xie', 'Thanks')] },
  { id: 'wo', kind: 'word', deck: 'mandarin', week: 1, zh: '我', en: 'I', words: [w('我', 'wǒ', 'I')], audio: { v: ['wo.mp3', 'wo-s.mp3'] } },
  { id: 'hao', kind: 'phrase', deck: 'mandarin', week: 2, topic: 'Small talk', zh: '很好', en: 'Very good', words: [w('很', 'hěn', 'very'), w('好', 'hǎo', 'good')] },
  { id: 'yue-x', kind: 'phrase', deck: 'cantonese', set: 'Basics', topic: 'Small talk', mission: 'Say hi', zh: '你好', en: 'Hi', words: [w('你好', 'nei5 hou2', 'Hi')] },
];

// ---- weak words
test('flagging a word makes it a trouble spot; correct sentences wear it down', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '來自', NOW);
  flagWord(p, 'mandarin', '來自', NOW);
  flagWord(p, 'mandarin', '我', NOW);
  assert.deepEqual(troubleSpots(p, 'mandarin').map((t) => [t.zh, t.score]), [['來自', 4], ['我', 2]]);
  credit(p, 'mandarin', ITEMS[0].fills[0].words, new Date(NOW.getTime() + DAY));
  credit(p, 'mandarin', ITEMS[0].fills[0].words, new Date(NOW.getTime() + 2 * DAY));
  assert.deepEqual(troubleSpots(p, 'mandarin').map((t) => [t.zh, t.score]), [['來自', 2]]);
  assert.deepEqual(troubleSpots(p, 'cantonese'), []);
});

test('recovery counts at most once per day, and not on the day of the miss', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '來自', NOW);
  credit(p, 'mandarin', [{ zh: '來自' }], NOW);
  assert.equal(troubleSpots(p, 'mandarin')[0].score, 2);
  const next = new Date(NOW.getTime() + DAY);
  credit(p, 'mandarin', [{ zh: '來自' }], next);
  credit(p, 'mandarin', [{ zh: '來自' }], next);
  assert.equal(troubleSpots(p, 'mandarin')[0].score, 1);
  credit(p, 'mandarin', [{ zh: '來自' }], new Date(NOW.getTime() + 2 * DAY));
  assert.deepEqual(troubleSpots(p, 'mandarin'), []);
});

test('drillItems builds practice items with meaning and example sentences, only while weak', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '來自', NOW);
  const [d] = drillItems(ITEMS, p, 'mandarin');
  assert.equal(d.id, drillId('mandarin', '來自'));
  assert.deepEqual([d.kind, d.zh, d.roman, d.gloss], ['drill', '來自', 'lái-zì', 'to come from']);
  assert.deepEqual(d.contexts.map((c) => c.zh), ['我來自荷蘭']);
  p.weak[d.id].score = 0;
  assert.deepEqual(drillItems(ITEMS, p, 'mandarin'), []);
});

test('drill items reuse the word card audio when there is one', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '我', NOW);
  flagWord(p, 'mandarin', '來自', NOW);
  const byZh = Object.fromEntries(drillItems(ITEMS, p, 'mandarin').map((d) => [d.zh, d]));
  assert.deepEqual(byZh['我'].audio, { v: ['wo.mp3', 'wo-s.mp3'] });
  assert.equal(byZh['來自'].audio, null);
});

test('drillPrompt alternates between the word alone and a gap in a sentence', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '來自', NOW);
  const [d] = drillItems(ITEMS, p, 'mandarin');
  assert.equal(drillPrompt(d, () => 0.9).mode, 'word');
  const gap = drillPrompt(d, () => 0.1);
  assert.equal(gap.mode, 'gap');
  assert.equal(gap.context.zh, '我來自荷蘭');
});

test('a word with no example sentence is always drilled alone', () => {
  const p = defaults();
  flagWord(p, 'mandarin', '謝謝', NOW);
  const [d] = drillItems(ITEMS, p, 'mandarin');
  assert.equal(drillPrompt(d, () => 0).mode, 'word');
});

// ---- motivation
test('solid means good on two different days', () => {
  const p = defaults();
  p.goodCounts.xiexie = 1;
  assert.equal(isSolid(p, 'xiexie'), false);
  p.goodCounts.xiexie = 2;
  assert.equal(isSolid(p, 'xiexie'), true);
});

test('weekReadiness covers the latest coach week', () => {
  const p = defaults();
  p.goodCounts.hao = 2;
  assert.deepEqual(weekReadiness(ITEMS, p), { week: 2, solid: 1, total: 1 });
});

test('daysUntil counts days to the next lesson weekday', () => {
  assert.equal(daysUntil(3, NOW), 0); // Wednesday
  assert.equal(daysUntil(5, NOW), 2); // Friday
  assert.equal(daysUntil(1, NOW), 5); // Monday
});

test('canSay groups phrases and patterns by topic, skipping words', () => {
  const p = defaults();
  p.goodCounts.xiexie = 2;
  const groups = canSay(ITEMS.filter((i) => i.deck === 'mandarin'), p);
  assert.deepEqual(groups.map((g) => [g.topic, g.solid, g.total]), [['Intro', 0, 1], ['Small talk', 1, 2]]);
});

test('pickMission only uses solid phrases with a mission, stable per day', () => {
  const p = defaults();
  assert.equal(pickMission(ITEMS, p, NOW), null);
  p.goodCounts.xiexie = 2;
  p.goodCounts['laizi-x'] = 2;
  const a = pickMission(ITEMS, p, NOW);
  assert.ok(['xiexie', 'laizi-x'].includes(a.id));
  assert.equal(pickMission(ITEMS, p, NOW).id, a.id);
  assert.notEqual(pickMission(ITEMS, p, NOW, 1).id, a.id); // "another one"
});

test('done missions rest for two weeks and count as done today', () => {
  const p = defaults();
  p.goodCounts.xiexie = 2;
  assert.equal(missionDoneToday(p, NOW), false);
  markMissionDone(p, 'xiexie', NOW);
  assert.equal(missionDoneToday(p, NOW), true);
  assert.equal(pickMission(ITEMS, p, new Date(NOW.getTime() + DAY)), null);
  assert.equal(pickMission(ITEMS, p, new Date(NOW.getTime() + 15 * DAY)).id, 'xiexie');
  assert.equal(p.missions[0].date, localDate(NOW));
});
