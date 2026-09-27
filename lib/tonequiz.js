// Tone check: hear a known word, pick its tones. Results per tone and tone pair drive which words come next.
import { toneOf, setTone } from './tones.js';

const syls = (roman) => roman.split(/[\s-]+/).filter(Boolean).map((s) => s.replace(/[^\p{L}\u0300-\u036f]/gu, ''));

export function toneSeq(roman) {
  return syls(roman).map(toneOf);
}

function withTones(roman, tones) {
  let i = 0;
  return roman.replace(/[\p{L}\u0300-\u036f]+/gu, (s) => setTone(s, tones[i++]));
}

export function options(roman, rand = Math.random) {
  const right = toneSeq(roman);
  const pool = right.length === 1 && right[0] !== 5 ? [1, 2, 3, 4] : [1, 2, 3, 4, 5];
  const seen = new Set([right.join()]);
  const out = [roman];
  const add = (tones) => {
    if (out.length < 4 && !seen.has(tones.join())) { seen.add(tones.join()); out.push(withTones(roman, tones)); }
  };
  for (let tries = 0; tries < 60 && out.length < 4; tries++) {
    const t = [...right];
    const changes = t.length > 1 && rand() < 0.3 ? 2 : 1;
    for (let c = 0; c < changes; c++) {
      const i = Math.floor(rand() * t.length);
      const alt = pool.filter((x) => x !== right[i]);
      t[i] = alt[Math.floor(rand() * alt.length)];
    }
    add(t);
  }
  // Fallback for unlucky randomness: walk through single-syllable changes in order.
  for (let i = 0; i < right.length && out.length < 4; i++) {
    for (const x of pool) if (x !== right[i]) add(right.map((v, j) => (j === i ? x : v)));
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function bump(stats, key, ok) {
  const s = (stats[key] ||= [0, 0]);
  if (ok) s[0] += 1;
  s[1] += 1;
}

export function scoreAnswer(stats, heard, picked) {
  const h = toneSeq(heard);
  const p = toneSeq(picked);
  const ok = h.map((t, i) => t === p[i]);
  h.forEach((t, i) => bump(stats, String(t), ok[i]));
  for (let i = 0; i + 1 < h.length; i++) bump(stats, `${h[i]}-${h[i + 1]}`, ok[i] && ok[i + 1]);
  return ok.every(Boolean);
}

export function candidates(items, progress) {
  return items.filter(
    (i) => i.deck === 'mandarin' && i.kind !== 'pattern' && i.words?.length === 1 && i.audio && progress.cards[`${i.id}:say`]
  );
}

const errRate = (stats, key) => {
  const [ok, n] = stats[key] || [0, 0];
  return (n - ok + 1) / (n + 3);
};

export function pickQuestion(words, stats, rand = Math.random) {
  const weights = words.map((w) => {
    const t = toneSeq(w.roman);
    const keys = [...t.map(String), ...t.slice(1).map((x, i) => `${t[i]}-${x}`)];
    const err = keys.reduce((a, k) => a + errRate(stats, k), 0) / keys.length;
    return err * err + 0.02;
  });
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < words.length; i++) if ((r -= weights[i]) <= 0) return words[i];
  return words[words.length - 1];
}

export function toneStats(stats) {
  return Object.entries(stats)
    .filter(([k]) => !k.includes('-'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tone, [ok, n]]) => ({ tone, pct: Math.round((100 * ok) / n), n }));
}
