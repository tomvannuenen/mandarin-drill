// Numbers by ear: sums with one-digit numbers ("三加四等於幾？") and prices ("二十五塊"), made up fresh each time.
// Written in Traditional like the rest of the deck; the app shows Simplified if that is the chosen script.
const ZH = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PY = ['líng', 'yī', 'èr', 'sān', 'sì', 'wǔ', 'liù', 'qī', 'bā', 'jiǔ'];

// 0–100 as {zh, roman}. With money, 2 is 兩 (兩塊, never 二塊).
export function numZh(n, { money = false } = {}) {
  if (money && n === 2) return { zh: '兩', roman: 'liǎng' };
  if (n < 10) return { zh: ZH[n], roman: PY[n] };
  if (n === 100) return { zh: '一百', roman: 'yì-bǎi' };
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const zh = `${tens > 1 ? ZH[tens] : ''}十${ones ? ZH[ones] : ''}`;
  const roman = [...(tens > 1 ? [PY[tens]] : []), 'shí', ...(ones ? [PY[ones]] : [])].join('-');
  return { zh, roman };
}

const pick = (rand, lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

// Three wrong answers near the right one (the ones you'd mix up), all different, inside [lo, hi].
function near(answer, rand, lo, hi, swap = false) {
  const out = new Set();
  const tries = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10];
  if (swap && answer >= 10 && answer % 10) out.add((answer % 10) * 10 + Math.floor(answer / 10)); // 25 ↔ 52
  for (const x of tries.sort(() => rand() - 0.5)) if (out.size < 3 && x >= lo && x <= hi && x !== answer) out.add(x);
  while (out.size < 3) {
    const x = pick(rand, lo, hi);
    if (x !== answer) out.add(x);
  }
  return [...out].slice(0, 3);
}

// "三加四等於幾？" → 七. Subtraction never goes below 1.
export function sumQuestion(rand = Math.random) {
  const plus = rand() < 0.5;
  const a = plus ? pick(rand, 1, 9) : pick(rand, 2, 9);
  const b = plus ? pick(rand, 1, 9) : pick(rand, 1, a - 1);
  const answer = plus ? a + b : a - b;
  const A = numZh(a);
  const B = numZh(b);
  const C = numZh(answer);
  const op = plus ? { zh: '加', roman: 'jiā', en: '+' } : { zh: '減', roman: 'jiǎn', en: '−' };
  return {
    mode: 'sum', answer,
    question: { zh: `${A.zh}${op.zh}${B.zh}等於幾？`, roman: `${A.roman} ${op.roman} ${B.roman} děng-yú jǐ?` },
    full: { zh: `${A.zh}${op.zh}${B.zh}等於${C.zh}`, roman: `${A.roman} ${op.roman} ${B.roman} děng-yú ${C.roman}`, en: `${a} ${op.en} ${b} = ${answer}` },
    words: [{ ...A, gloss: String(a) }, { zh: op.zh, roman: op.roman, gloss: plus ? 'plus' : 'minus' }, { ...B, gloss: String(b) },
      { zh: '等於', roman: 'děng-yú', gloss: 'equals' }, { ...C, gloss: String(answer) }],
    options: [answer, ...near(answer, rand, plus ? 2 : 1, plus ? 18 : 8)].sort(() => rand() - 0.5),
  };
}

// "二十五塊" → 25: the answer to 多少錢？
export function priceQuestion(rand = Math.random) {
  const answer = pick(rand, 1, 100);
  const N = numZh(answer, { money: true });
  return {
    mode: 'price', answer,
    question: { zh: `${N.zh}塊`, roman: `${N.roman} kuài` },
    full: { zh: `${N.zh}塊`, roman: `${N.roman} kuài`, en: `${answer} yuan (dollars)` },
    words: [{ ...N, gloss: String(answer) }, { zh: '塊', roman: 'kuài', gloss: 'yuan, dollar (spoken)' }],
    options: [answer, ...near(answer, rand, 1, 100, true)].sort(() => rand() - 0.5),
  };
}
