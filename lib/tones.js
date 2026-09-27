// Tone detection and word/syllable splitting for coloured romanisation.
// Convention: words separated by spaces, syllables within a word by '-'.
// Mandarin pinyin uses tone marks (5 = neutral); Cantonese Jyutping uses a trailing digit 1-6.
const MARKS = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };

export function toneOf(syl) {
  for (const ch of syl.normalize('NFD')) if (MARKS[ch]) return MARKS[ch];
  return 5;
}

function jyutpingTone(syl) {
  const m = syl.match(/([1-6])\W*$/);
  return m ? Number(m[1]) : 0;
}

export function romanWords(text, deck = 'mandarin') {
  const tone = deck === 'cantonese' ? jyutpingTone : toneOf;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.split('-').filter(Boolean).map((t) => ({ text: t, tone: tone(t) })));
}
