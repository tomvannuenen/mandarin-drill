import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBundle } from '../lib/bundle.js';

// Same layout as tools/pack_book.py: "CPK1", uint32 LE header length, JSON header, data.
function makeBundle(header, chunks) {
  const enc = new TextEncoder();
  const head = enc.encode(JSON.stringify(header));
  const size = 8 + head.length + chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(size);
  buf.set(enc.encode('CPK1'), 0);
  new DataView(buf.buffer).setUint32(4, head.length, true);
  buf.set(head, 8);
  let pos = 8 + head.length;
  for (const c of chunks) { buf.set(c, pos); pos += c.length; }
  return buf.buffer;
}

test('parseBundle returns header and track bytes', () => {
  const header = {
    title: 'Book',
    lessons: { 1: 'One' },
    tracks: [
      { name: '01-1', lesson: 1, offset: 0, size: 3 },
      { name: '01-2', lesson: 1, offset: 3, size: 2 },
    ],
  };
  const { title, lessons, tracks } = parseBundle(makeBundle(header, [new Uint8Array([1, 2, 3]), new Uint8Array([9, 8])]));
  assert.equal(title, 'Book');
  assert.equal(lessons[1], 'One');
  assert.deepEqual(tracks.map((t) => [t.name, t.lesson, [...t.bytes]]), [['01-1', 1, [1, 2, 3]], ['01-2', 1, [9, 8]]]);
});

test('parseBundle rejects other files', () => {
  assert.throws(() => parseBundle(new Uint8Array([80, 75, 3, 4, 0, 0, 0, 0]).buffer), /not a book audio file/);
});
