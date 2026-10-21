import { test } from 'node:test';
import assert from 'node:assert/strict';

import { numZh, sumQuestion, priceQuestion } from '../lib/numbers.js';

test('numbers in Chinese, with 兩 for money', () => {
  assert.deepEqual(numZh(7), { zh: '七', roman: 'qī' });
  assert.deepEqual(numZh(10), { zh: '十', roman: 'shí' });
  assert.deepEqual(numZh(15), { zh: '十五', roman: 'shí-wǔ' });
  assert.deepEqual(numZh(25), { zh: '二十五', roman: 'èr-shí-wǔ' });
  assert.deepEqual(numZh(40), { zh: '四十', roman: 'sì-shí' });
  assert.deepEqual(numZh(100), { zh: '一百', roman: 'yì-bǎi' });
  assert.equal(numZh(2, { money: true }).zh, '兩');
  assert.equal(numZh(22, { money: true }).zh, '二十二');
});

test('sums: one-digit numbers, no negatives, four different options including the answer', () => {
  for (let seed = 0; seed < 200; seed++) {
    let x = seed;
    const rand = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    const q = sumQuestion(rand);
    assert.ok(q.answer >= 1 && q.answer <= 18);
    assert.equal(new Set(q.options).size, 4);
    assert.ok(q.options.includes(q.answer));
    assert.match(q.question.zh, /^[一二三四五六七八九][加減][一二三四五六七八九]等於幾？$/);
  }
});

test('prices: 1 to 100 kuai, options include the digit swap', () => {
  const q = priceQuestion(() => 0.24); // 25
  assert.equal(q.answer, 25);
  assert.equal(q.question.zh, '二十五塊');
  assert.ok(q.options.includes(52));
  assert.equal(priceQuestion(() => 0.01).question.zh, '兩塊');
});
