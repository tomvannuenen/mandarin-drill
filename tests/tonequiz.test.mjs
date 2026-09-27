import { test } from 'node:test';
import assert from 'node:assert/strict';

import { setTone } from '../lib/tones.js';
import { toneSeq, options, scoreAnswer, candidates, pickQuestion, toneStats } from '../lib/tonequiz.js';

test('setTone moves the tone mark to the right vowel', () => {
  assert.equal(setTone('hǎo', 4), 'hào');
  assert.equal(setTone('xie', 4), 'xiè');
  assert.equal(setTone('guó', 3), 'guǒ');
  assert.equal(setTone('shuǐ', 1), 'shuī');
  assert.equal(setTone('lǜ', 2), 'lǘ');
  assert.equal(setTone('ma', 5), 'ma');
  assert.equal(setTone('Hé', 1), 'Hē');
  assert.equal(setTone('ōu', 3), 'ǒu');
});

test('toneSeq reads the tones of a word', () => {
  assert.deepEqual(toneSeq('kā-fēi'), [1, 1]);
  assert.deepEqual(toneSeq('xiè-xie'), [4, 5]);
});

test('options gives the right answer plus three different tone patterns', () => {
  const opts = options('kā-fēi', () => 0.3);
  assert.equal(opts.length, 4);
  assert.ok(opts.includes('kā-fēi'));
  assert.equal(new Set(opts).size, 4);
  for (const o of opts) assert.equal(o.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), 'ka-fei');
});

test('options works for one-syllable words', () => {
  const opts = options('hē', Math.random);
  assert.deepEqual(new Set(opts.map((o) => toneSeq(o)[0])).size, 4);
});

test('scoreAnswer credits each syllable and adjacent pair', () => {
  const stats = {};
  scoreAnswer(stats, 'wǒ-men', 'wǒ-men');
  scoreAnswer(stats, 'xǐ-huān', 'xí-huān'); // heard 3-1, picked 2-1
  assert.deepEqual(stats['3'], [1, 2]);
  assert.deepEqual(stats['1'], [1, 1]);
  assert.deepEqual(stats['3-5'], [1, 1]);
  assert.deepEqual(stats['3-1'], [0, 1]);
});

test('candidates are single-word entries the learner has seen', () => {
  const items = [
    { id: 'kafei', kind: 'word', deck: 'mandarin', roman: 'kā-fēi', words: [{ zh: '咖啡' }], audio: {} },
    { id: 'long', kind: 'phrase', deck: 'mandarin', roman: 'wǒ xǐ-huān', words: [{}, {}], audio: {} },
    { id: 'new', kind: 'word', deck: 'mandarin', roman: 'hē', words: [{}], audio: {} },
    { id: 'yue', kind: 'word', deck: 'cantonese', roman: 'jam2', words: [{}], audio: {} },
  ];
  const progress = { cards: { 'kafei:say': {}, 'long:say': {}, 'yue:say': {} } };
  assert.deepEqual(candidates(items, progress).map((i) => i.id), ['kafei']);
});

test('pickQuestion favours words with weak tones', () => {
  const words = [{ id: 'a', roman: 'mā' }, { id: 'b', roman: 'mǎ' }];
  const stats = { 1: [20, 20], 3: [2, 20] };
  let b = 0;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i++) if (pickQuestion(words, stats, rand).id === 'b') b++;
  assert.ok(b > 300, `picked weak word ${b}/400 times`);
});

test('toneStats reports accuracy per tone', () => {
  assert.deepEqual(toneStats({ 1: [3, 4], 3: [1, 4], '3-4': [0, 2] }), [
    { tone: '1', pct: 75, n: 4 },
    { tone: '3', pct: 25, n: 4 },
  ]);
});
