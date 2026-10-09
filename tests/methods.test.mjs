import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { methodStats, methodNews, dropped, pickMethod, applicable, chainSteps, needsExposure, logActivity } from '../lib/methods.js';
import { adaptiveNew, mayReturn } from '../lib/session.js';

const DAY = 86400000;
const T0 = new Date(2026, 9, 1, 10).getTime();
const at = (day, min = 0) => T0 + day * DAY + min * 60000;

test('methodStats credits the practice done before with the first say-it answer of a later day', () => {
  const log = [
    [at(0), 'a:say', 1], // first meeting: nothing to credit
    [at(0, 1), 'a:chain', 3],
    [at(0, 5), 'a:say', 3], // same day as the practice: doesn't count
    [at(1), 'a:say', 3], // chain worked
    [at(1, 5), 'a:say', 3], // second answer that day: ignored
    [at(2), 'a:say', 1], // nothing in between: none
    [at(2, 1), 'a:ear', 1],
    [at(3), 'a:say', 1], // ear didn't help
    [at(3), 'w/mandarin/吃:say', 3], // drills are not phrases
  ];
  assert.deepEqual(methodStats(log), { chain: { n: 1, ok: 1 }, none: { n: 1, ok: 0 }, ear: { n: 1, ok: 0 } });
});

test('a method that clearly trails is dropped, and the rest are tried by record with a turn for the untried', () => {
  const stats = { echo: { n: 10, ok: 9 }, ear: { n: 10, ok: 4 }, chain: { n: 3, ok: 0 } };
  assert.deepEqual(dropped(stats), ['ear']);
  assert.equal(pickMethod(stats, ['echo', 'ear'], () => 0), 'echo');
  assert.equal(pickMethod(stats, ['ear'], () => 0), 'ear', 'the only option stays usable');
  assert.equal(pickMethod(stats, ['echo', 'fill'], () => 0.99), 'fill', 'an untried method gets its chance');
  assert.equal(pickMethod({}, ['echo', 'chain'], () => 0), 'echo');
});

test('applicable and chainSteps fit the sentence', () => {
  const w = (...zh) => zh.map((z) => ({ zh: z }));
  assert.deepEqual(applicable({ words: w('謝謝') }, 10), ['echo', 'ear', 'match', 'tone']);
  assert.deepEqual(applicable({ words: w('我', '要', '這個') }, 10), ['echo', 'chain', 'dictate', 'ear', 'match', 'fill', 'tone', 'build']);
  assert.deepEqual(applicable({ words: w('我', '要', '這個') }, 1, { tiles: false, tones: false }), ['echo', 'chain', 'dictate']);
  const steps = chainSteps(w('可以', '用', '英文', '解釋', '一下', '嗎')).map((s) => s.map((x) => x.zh).join(''));
  assert.deepEqual(steps, ['一下嗎', '解釋一下嗎', '英文解釋一下嗎', '用英文解釋一下嗎', '可以用英文解釋一下嗎']);
  assert.deepEqual(chainSteps(w('我', '要', '這個')).map((s) => s.length), [1, 2, 3]);
});

test('needsExposure follows the latest say-it answer; activities are logged without a schedule', () => {
  const p = defaults();
  assert.equal(needsExposure(p, 'a'), false);
  p.log.push([at(0), 'a:say', 3], [at(1), 'a:say', 2]);
  assert.equal(needsExposure(p, 'a'), true);
  logActivity(p, 'a', 'echo', 3, new Date(at(1, 1)), 1200);
  assert.equal(needsExposure(p, 'a'), true, 'practice alone does not clear it');
  assert.deepEqual(p.cards, {});
  assert.equal(p.log.at(-1)[1], 'a:echo');
  assert.equal(p.stats.streak, 1);
});

test('pace: fewer new phrases while many are shaky, and a session cannot grow without end', () => {
  assert.equal(adaptiveNew(10, 0), 10);
  assert.equal(adaptiveNew(10, 4), 6);
  assert.equal(adaptiveNew(10, 9), 3);
  assert.equal(adaptiveNew(10, 12), 0);
  assert.equal(adaptiveNew(2, 0), 2);
  assert.equal(mayReturn(1, 10), true);
  assert.equal(mayReturn(2, 10), false, 'a card returns once');
  assert.equal(mayReturn(1, 60), false, 'nothing returns in a long session');
});

test('methodNews reports a way of practising being dropped, coming back, or taking the lead, once', () => {
  const first = methodNews({ echo: { n: 8, ok: 6 } }, null);
  assert.deepEqual(first, { state: { dropped: [], lead: 'echo' }, news: [] }, 'nothing to compare with yet');
  const stats = { echo: { n: 10, ok: 8 }, ear: { n: 10, ok: 4 }, chain: { n: 9, ok: 9 } };
  const { state, news } = methodNews(stats, first.state);
  assert.deepEqual(state, { dropped: ['ear'], lead: 'chain' });
  assert.deepEqual(news, [
    'Dropped Pick by ear: 40% stuck, against 100% for Build it up.',
    'More Build it up from now on: 100% stuck, the best so far.',
  ]);
  assert.deepEqual(methodNews(stats, state).news, [], 'no repeat');
  const back = methodNews({ ...stats, ear: { n: 14, ok: 11 } }, state);
  assert.deepEqual(back.news, ['Pick by ear is back in.']);
});
