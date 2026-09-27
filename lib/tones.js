// Tone detection and word/syllable splitting for coloured romanisation.
// Convention: words separated by spaces, syllables within a word by '-'.
// Mandarin pinyin uses tone marks (5 = neutral); Cantonese Jyutping uses a trailing digit 1-6.
const TONE_MARK = { 1: '\u0304', 2: '\u0301', 3: '\u030c', 4: '\u0300' }; // combining macron, acute, caron, grave
const MARKS = Object.fromEntries(Object.entries(TONE_MARK).map(([t, m]) => [m, Number(t)]));
const DIAERESIS = '\u0308'; // the dots of ü

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

// Put a tone mark on a pinyin syllable (5 = neutral, no mark), following the usual placement rules:
// a or e first, then the o of "ou", otherwise the last vowel.
export function setTone(syl, tone) {
  const bare = [...syl.normalize('NFD')].filter((ch) => !MARKS[ch]).join('');
  if (!TONE_MARK[tone]) return bare.normalize('NFC');
  const chars = [...bare];
  const lower = bare.toLowerCase();
  let idx = lower.search(/[ae]/);
  if (idx < 0) idx = lower.indexOf('ou');
  if (idx < 0) {
    for (let i = chars.length - 1; i >= 0; i--) {
      if (/[iouv]/i.test(chars[i])) { idx = i; break; }
    }
  }
  if (idx < 0) return bare.normalize('NFC');
  const at = chars[idx + 1] === DIAERESIS ? idx + 2 : idx + 1; // mark goes after the dots of ü
  chars.splice(at, 0, TONE_MARK[tone]);
  return chars.join('').normalize('NFC');
}
