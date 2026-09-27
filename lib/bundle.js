// Reads a book audio pack made by tools/pack_book.py:
// "CPK1" | uint32 LE header length | JSON header {title, lessons, tracks:[{name, lesson, offset, size}]} | track data
export function parseBundle(buffer) {
  const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
  if (magic !== 'CPK1') throw new Error('This is not a book audio file');
  const headLen = new DataView(buffer).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headLen)));
  const base = 8 + headLen;
  return {
    title: header.title,
    lessons: header.lessons,
    tracks: header.tracks.map((t) => ({ name: t.name, lesson: t.lesson, bytes: new Uint8Array(buffer, base + t.offset, t.size) })),
  };
}
