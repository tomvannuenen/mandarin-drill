import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults, applyReview, LOG_LIMIT } from '../lib/store.js';
import { grade } from '../lib/srs.js';
import { weekSummary, checkinText, coachBrief } from '../lib/checkin.js';

const NOW = new Date(2026, 8, 26, 20);
const DAY = 86400000;
const ago = (d) => new Date(NOW.getTime() - d * DAY);
const ITEMS = [
  { id: 'a', deck: 'mandarin', week: 2, kind: 'phrase', zh: '我來自荷蘭', roman: 'wǒ lái-zì Hé-lán', en: 'I come from NL' },
  { id: 'b', deck: 'mandarin', week: 2, kind: 'phrase', zh: '謝謝', roman: 'xiè-xie', en: 'Thanks' },
  { id: 'c', deck: 'cantonese', set: 'Basics', kind: 'phrase', zh: '唔該', roman: 'm4-goi1', en: 'Thanks' },
];

function review(p, id, rating, when, deck = 'mandarin') {
  applyReview(p, { id, type: 'say', deck }, rating, grade(null, rating, when), when);
}

test('applyReview keeps a capped answer log', () => {
  const p = defaults();
  review(p, 'a', 1, ago(1));
  assert.deepEqual(p.log[0].slice(1), ['a:say', 1]);
  p.log = Array.from({ length: LOG_LIMIT }, () => [0, 'x:say', 3]);
  review(p, 'b', 3, ago(0));
  assert.equal(p.log.length, LOG_LIMIT);
  assert.deepEqual(p.log.at(-1).slice(1), ['b:say', 3]);
});

test('applyReview logs response time, voice, replays and lookups when given', () => {
  const p = defaults();
  applyReview(p, { id: 'a', type: 'say' }, 3, grade(null, 3, NOW), NOW, { ms: 4200, voice: 'tw-yunjhe', replays: 2, lookups: ['來自'], hint: true });
  assert.deepEqual(p.log[0].slice(1), ['a:say', 3, 4200, 'tw-yunjhe', 2, ['來自'], 1]);
  applyReview(p, { id: 'b', type: 'say' }, 3, grade(null, 3, NOW), NOW);
  assert.deepEqual(p.log[1].slice(1), ['b:say', 3]);
});

test('weekSummary counts the last 7 days only', () => {
  const p = defaults();
  review(p, 'a', 1, ago(10)); // too old
  review(p, 'a', 1, ago(2));
  review(p, 'a', 1, ago(2));
  review(p, 'a', 3, ago(1));
  review(p, 'b', 3, ago(1));
  review(p, 'c', 4, ago(0), 'cantonese');
  p.missions.push({ date: '2026-09-25', id: 'b' });
  p.convos = { coffee: { n: 2, last: '2026-09-25' }, old: { n: 1, last: '2026-08-01' } };
  const s = weekSummary(p, ITEMS, NOW);
  assert.equal(s.reviews, 5);
  assert.equal(s.right, 3);
  assert.equal(s.daysStudied, 3);
  assert.deepEqual(s.byDeck, { mandarin: 4, cantonese: 1 });
  assert.deepEqual(s.mostMissed.map((m) => [m.id, m.misses]), [['a', 2]]);
  assert.equal(s.missions, 1);
  assert.deepEqual(s.conversations, ['coffee']);
});

test('checkinText is a readable summary with the details Claude needs', () => {
  const p = defaults();
  review(p, 'a', 1, ago(1));
  p.weak['w/mandarin/來自'] = { score: 2, flags: 1 };
  const text = checkinText(weekSummary(p, ITEMS, NOW), { week: 2, solid: 1, total: 2 });
  assert.match(text, /Reviews: 1 \(0% right\)/);
  assert.match(text, /Coach week 2: 1\/2 solid/);
  assert.match(text, /我來自荷蘭 .*×1/);
  assert.match(text, /Trouble spots: 來自/);
});

test('coachBrief is written for the coach, in pinyin and English', () => {
  const p = defaults();
  review(p, 'a', 1, ago(1));
  review(p, 'b', 3, ago(1));
  p.weak['w/mandarin/來自'] = { score: 2, flags: 2 };
  p.toneConfusions = { '2>3': 4, '4>1': 1 };
  p.wishes = [{ id: 'wish-1', t: ago(2).getTime(), text: 'Is this seat taken?', where: 'lecture', deck: 'mandarin' }];
  const glossOf = { 來自: { roman: 'lái-zì', gloss: 'to come from' } };
  const brief = coachBrief(weekSummary(p, ITEMS, NOW), p, glossOf, NOW);
  assert.match(brief, /practised 2 times/);
  assert.match(brief, /láizì \(to come from\)/);
  assert.match(brief, /2nd tone as a 3rd tone \(4×\)/);
  assert.match(brief, /"Is this seat taken\?"/);
  assert.doesNotMatch(brief, /4th tone as a 1st/); // single slips are noise
});
