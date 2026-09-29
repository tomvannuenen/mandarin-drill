// Shared DOM and audio helpers for the app screens.
import { romanWords } from './lib/tones.js';

export const LANG_ATTR = { mandarin: 'zh-Hant-TW', cantonese: 'zh-Hant-HK' };
export const $ = (id) => document.getElementById(id);

const audio = new Audio();
export function play(src, rate = 1) {
  if (!src) return;
  audio.src = src;
  audio.currentTime = 0;
  audio.playbackRate = rate;
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

// Fallback for words without a recording: the phone's own voice (iPhone has Taiwan and Hong Kong voices).
const TTS_LANG = { mandarin: 'zh-TW', cantonese: 'zh-HK' };
export function speakText(text, deck = 'mandarin', rate = 0.85) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = TTS_LANG[deck] || 'zh-TW';
  u.rate = rate;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.replace('_', '-') === u.lang);
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
