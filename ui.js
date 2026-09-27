// Shared DOM and audio helpers for the app screens.
import { romanWords } from './lib/tones.js';

export const LANG_ATTR = { mandarin: 'zh-Hant-TW', cantonese: 'zh-Hant-HK' };
export const $ = (id) => document.getElementById(id);

const audio = new Audio();
export function play(src) {
  if (!src) return;
  audio.src = src;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

export function renderRoman(target, text, d) {
  const prefix = d === 'cantonese' ? 'jtone' : 'tone';
  // Pinyin joins a word's syllables (xǐhuān); Jyutping conventionally spaces them (zung1 ji3).
  const joiner = d === 'cantonese' ? ' ' : '';
  const words = romanWords(text, d).map((word) =>
    el('span', { class: 'w' }, ...word.flatMap((s, i) => {
      const syl = el('span', { class: `${prefix}${s.tone}` }, s.text);
      return i && joiner ? [joiner, syl] : [syl];
    }))
  );
  target.replaceChildren(...words.flatMap((w, i) => (i ? [' ', w] : [w])));
  return target;
}
