// Tone check: 10 quick questions. Hear a word you know, pick the right tones.
import { $, el, play, renderRoman, LANG_ATTR } from './ui.js';
import { pickVoice } from './lib/cards.js';
import { candidates, pickQuestion, options, scoreAnswer, toneStats } from './lib/tonequiz.js';

const ROUND = 10;
const TONE_NAME = { 1: '1st (high)', 2: '2nd (rising)', 3: '3rd (dip)', 4: '4th (falling)', 5: 'neutral' };
let ctx = null;
let round = null;

const plain = (roman) => roman.replace(/-/g, '');

export function toneWords(items, progress) {
  return candidates(items, progress);
}

// Accuracy bars per tone, used on the home screen and after a round.
export function toneBars(stats) {
  const rows = toneStats(stats);
  if (!rows.length) return el('p', { class: 'dash-line hint' }, 'No results yet. A round takes about a minute.');
  return el('div', { class: 'tone-bars' }, ...rows.map((r) =>
    el('div', { class: 'tone-row' },
      el('span', { class: `tone-name tone${r.tone}` }, TONE_NAME[r.tone] || r.tone),
      el('div', { class: 'meter' }, el('div', { class: `meter-fill${r.pct < 70 ? ' weak' : ''}`, style: `width:${r.pct}%` })),
      el('span', { class: 'tone-pct' }, `${r.pct}%`))));
}

export function initTones(c) {
  ctx = c;
  $('tq-play').addEventListener('click', () => play(round?.q && round.q.w.audio[round.q.voice][0]));
  $('tq-next').addEventListener('click', next);
}

export function startTones() {
  const words = toneWords(ctx.allItems(), ctx.progress());
  if (!words.length) return;
  round = { n: 0, right: 0, words };
  ctx.show('tones');
  ask();
}

function ask() {
  const w = pickQuestion(round.words, ctx.progress().tones);
  round.q = { w, voice: pickVoice(w), answered: false };
  $('tq-count').textContent = `${round.n + 1} / ${ROUND}`;
  $('tq-bar').style.width = `${(100 * round.n) / ROUND}%`;
  $('tq-feedback').hidden = true;
  $('tq-next').hidden = true;
  $('tq-result').hidden = true;
  $('tq-question').hidden = false;
  $('tq-options').replaceChildren(...options(w.roman).map((opt) =>
    el('button', { class: 'tq-opt', 'data-roman': opt, onclick: () => answer(opt) }, plain(opt))));
  play(w.audio[round.q.voice][0]);
}

function answer(opt) {
  if (round.q.answered) return;
  round.q.answered = true;
  const { w } = round.q;
  const right = scoreAnswer(ctx.progress().tones, w.roman, opt);
  ctx.persist();
  if (right) round.right += 1;
  for (const b of $('tq-options').children) {
    b.classList.toggle('right', b.dataset.roman === w.roman);
    b.classList.toggle('wrong', b.dataset.roman === opt && !right);
  }
  $('tq-zh').textContent = w.zh;
  $('tq-zh').setAttribute('lang', LANG_ATTR.mandarin);
  renderRoman($('tq-roman'), w.roman, 'mandarin');
  $('tq-en').textContent = w.en;
  $('tq-feedback').hidden = false;
  $('tq-next').hidden = false;
  $('tq-next').textContent = round.n + 1 < ROUND ? 'Next' : 'See results';
  play(w.audio[round.q.voice][0]);
}

function next() {
  round.n += 1;
  if (round.n < ROUND) return ask();
  $('tq-bar').style.width = '100%';
  $('tq-question').hidden = true;
  $('tq-feedback').hidden = true;
  $('tq-next').hidden = true;
  $('tq-result').hidden = false;
  $('tq-score').textContent = `${round.right} of ${ROUND} right`;
  $('tq-bars').replaceChildren(toneBars(ctx.progress().tones));
}

export { ROUND };
