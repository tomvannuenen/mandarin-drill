// Tone detection and word/syllable splitting for coloured pinyin.
// Pinyin convention: words separated by spaces, syllables within a word by '-'.
const MARKS = { '̄': 1, '́': 2, '̌': 3, '̀': 4 };

export function toneOf(syl) {
  for (const ch of syl.normalize('NFD')) if (MARKS[ch]) return MARKS[ch];
  return 5;
}

export function pinyinWords(pinyin) {
  return pinyin
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.split('-').filter(Boolean).map((text) => ({ text, tone: toneOf(text) })));
}
