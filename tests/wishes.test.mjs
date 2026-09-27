import { test } from 'node:test';
import assert from 'node:assert/strict';

import { defaults } from '../lib/store.js';
import { addWish, wishStatus } from '../lib/wishes.js';
import { buildQueue } from '../lib/session.js';

const NOW = new Date(2026, 8, 27, 9);

test('addWish stores what you wanted to say, trimmed, with an id', () => {
  const p = defaults();
  const w = addWish(p, '  Is this seat taken? ', 'lecture hall', 'mandarin', NOW);
  assert.deepEqual([w.text, w.where, w.deck], ['Is this seat taken?', 'lecture hall', 'mandarin']);
  assert.match(w.id, /^wish-\d+$/);
  assert.equal(p.wishes.length, 1);
  assert.equal(addWish(p, '   ', '', 'mandarin', NOW), null);
});

test('wishStatus marks wishes that have become cards', () => {
  const p = defaults();
  const a = addWish(p, 'Is this seat taken?', '', 'mandarin', NOW);
  const b = addWish(p, 'Less ice please', '', 'cantonese', new Date(NOW.getTime() + 1000));
  const items = [{ id: 'zhe-li-you-ren-zuo-ma', wish: a.id, zh: '這裡有人坐嗎？', roman: 'zhè-lǐ yǒu rén zuò ma?' }];
  const st = wishStatus(p, items);
  assert.deepEqual(st.map((s) => [s.text, s.item?.id || null]), [['Less ice please', null], ['Is this seat taken?', 'zhe-li-you-ren-zuo-ma']]);
});

test('cards made from your wishes are introduced first', () => {
  const items = [{ id: 'w1', week: 1 }, { id: 'v1', set: 'Verbs' }, { id: 'mine', set: 'My phrases', wish: 'wish-1' }];
  assert.deepEqual(buildQueue(items, defaults(), NOW, 2).map((c) => c.id), ['mine', 'w1']);
});
