import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { charId } from '../lib/chars.js';
import { buildQueue } from '../lib/session.js';
import { hskItems, hskPool, hskQueue, hskWaiting, typedMatches, hskLevel } from '../lib/hsk.js';

const NOW = new Date(2026, 9, 13, 9);
const DAY = 86400000;
const ENTRIES = [
  { zh: '老師', roman: 'lǎo-shī', en: 'teacher', lesson: 3, script: 'cn', zhDisp: '老师', zhS: '老师' },
  { zh: '睡覺', roman: 'shuì-jiào', en: 'to sleep', lesson: 13, script: 'cn', zhDisp: '睡觉', zhS: '睡觉' },
  { zh: '你', roman: 'nǐ', en: 'you', lesson: 1 },
  { zh: '師', roman: 'shī', en: 'teacher', lesson: 3, single: true, from: '老師', script: 'cn', zhDisp: '师', zhS: '师' },
  { zh: '覺', roman: 'jiào', en: 'sleep', lesson: 13, single: true, from: '睡覺', sound: '睡覺' },
];
const AUDIO = { 老師: { v: ['ls.mp3', 'ls.mp3'] }, 睡覺: { v: ['sj.mp3', 'sj.mp3'] }, 你: { v: ['ni.mp3', 'ni.mp3'] }, 師: { v: ['shi.mp3', 'shi.mp3'] } };
const LIST = hskItems(ENTRIES, (zh) => AUDIO[zh] || null);
const byZh = (zh) => LIST.find((x) => x.zh === zh);

test('hskItems makes word-card items; a character is heard in its word when read unusually', () => {
  const shi = byZh('師');
  assert.equal(shi.id, charId('mandarin', '師'));
  assert.equal(shi.kind, 'char');
  assert.equal(shi.single, true);
  assert.deepEqual(shi.audio, AUDIO['師']);
  assert.equal(shi.example.zh, '老師');
  assert.ok(shi.example.inWord);
  assert.deepEqual(byZh('覺').audio, AUDIO['睡覺']);
  assert.equal(byZh('老師').example, null);
});

test('hskPool picks lessons and kind, in book order', () => {
  assert.deepEqual(hskPool(LIST, [1, 3]).map((x) => x.zh), ['你', '老師', '師']);
  assert.deepEqual(hskPool(LIST, [1, 3], 'words').map((x) => x.zh), ['你', '老師']);
  assert.deepEqual(hskPool(LIST, [1, 3, 13], 'chars').map((x) => x.zh), ['師', '覺']);
});

test('hskQueue: due first, then unseen in book order, then the weakest; read and type are separate cards', () => {
  const p = defaults();
  const pool = hskPool(LIST, [1, 3, 13]);
  p.cards[`${byZh('睡覺').id}:char`] = { ...grade(null, 3, NOW), due: new Date(NOW - DAY).toISOString() };
  p.cards[`${byZh('你').id}:char`] = { ...grade(null, 3, NOW), due: new Date(+NOW + 5 * DAY).toISOString(), stability: 5 };
  const q = hskQueue(pool, p, 'read', NOW);
  assert.deepEqual(q.map((c) => byId(c.id)), ['睡覺', '老師', '師', '覺', '你']);
  assert.ok(q.every((c) => c.type === 'char' && c.key === `${c.id}:char`));
  const t = hskQueue(pool, p, 'type', NOW);
  assert.deepEqual(t.map((c) => byId(c.id)), ['你', '老師', '師', '睡覺', '覺']);
  assert.ok(t.every((c) => c.type === 'type'));
  assert.equal(hskWaiting(pool, p, 'read', NOW), 4);
  assert.equal(hskQueue(pool, p, 'read', NOW, 2).length, 2);
});
const byId = (id) => LIST.find((x) => x.id === id).zh;

test('typing cards stay out of the daily session', () => {
  const p = defaults();
  const id = byZh('老師').id;
  p.cards[`${id}:type`] = { ...grade(null, 3, NOW), due: new Date(NOW - DAY).toISOString() };
  p.cards[`${id}:char`] = { ...grade(null, 3, NOW), due: new Date(NOW - DAY).toISOString() };
  const q = buildQueue(LIST, p, NOW, 0, 'mandarin');
  assert.deepEqual(q.map((c) => c.key), [`${id}:char`]);
});

test('typedMatches accepts either script, ignores spaces and punctuation', () => {
  const t2s = { 師: '师', 謝: '谢' };
  assert.ok(typedMatches('老師', '老師', t2s));
  assert.ok(typedMatches('老师', '老師', t2s));
  assert.ok(typedMatches(' 谢謝你！', '謝謝你', t2s));
  assert.ok(!typedMatches('老', '老師', t2s));
  assert.ok(!typedMatches('老是', '老師', t2s));
  assert.ok(!typedMatches('', '老師', t2s));
});

test('hskLevel: new, learning, hard while a reading problem, solid when both cards are well in', () => {
  const p = defaults();
  const x = byZh('老師');
  assert.equal(hskLevel(p, x), 'new');
  p.cards[`${x.id}:char`] = { ...grade(null, 3, NOW), stability: 10 };
  assert.equal(hskLevel(p, x), 'learning');
  p.cards[`${x.id}:type`] = { ...grade(null, 3, NOW), stability: 10 };
  assert.equal(hskLevel(p, x), 'solid');
  p.weakChars = { 'mandarin/老師': { score: 2 } };
  assert.equal(hskLevel(p, x), 'hard');
});
