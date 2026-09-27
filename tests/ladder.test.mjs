import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { level, hintText } from '../lib/ladder.js';

const NOW = new Date(2026, 8, 27, 9);
const card = (o) => ({ state: 2, stability: 3, reps: 3, lapses: 0, due: '2026-10-01T00:00:00Z', ...o });

test('new or ordinary phrases get the normal prompt', () => {
  const p = defaults();
  assert.equal(level(p, { id: 'a' }, NOW), 'normal');
  p.cards['a:say'] = card({});
  assert.equal(level(p, { id: 'a' }, NOW), 'normal');
});

test('phrases missed repeatedly get a hint', () => {
  const p = defaults();
  p.cards['a:say'] = card({ lapses: 1 });
  p.log = [[1, 'a:say', 1], [2, 'a:say', 3], [3, 'a:say', 1]];
  assert.equal(level(p, { id: 'a' }, NOW), 'hint');
});

test('solid phrases with a situation get the situation prompt', () => {
  const p = defaults();
  p.cards['a:say'] = card({ stability: 9 });
  p.goodCounts.a = 2;
  assert.equal(level(p, { id: 'a', situation: 'A student asks…' }, NOW), 'situation');
  assert.equal(level(p, { id: 'a' }, NOW), 'normal');
});

test('mastered phrases get a speed round', () => {
  const p = defaults();
  p.cards['a:say'] = card({ stability: 30 });
  p.goodCounts.a = 4;
  assert.equal(level(p, { id: 'a', situation: 'x' }, NOW), 'speed');
});

test('hintText shows the first letter of each syllable', () => {
  assert.equal(hintText('wǒ lái-zì Hé-lán'), 'w_ l_z_ H_l_');
  assert.equal(hintText('nǐ hǎo ma?'), 'n_ h_ m_?');
  assert.equal(hintText('m4-goi1 maai4-daan1', 'cantonese'), 'm_g_ m_d_');
});
