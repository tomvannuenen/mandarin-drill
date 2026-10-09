// Mini-conversations: step through a short dialogue. Their lines are heard first (text on tap);
// your lines show the English, you say it, then check.
import { $, el, play, renderRoman } from './ui.js';
import { localDate } from './lib/store.js';
import { icon } from './icons.js';

let ctx = null;
let state = null; // {convo, i, revealed, voices: {them, you}, bubbles: []}

function entryOf(turn) {
  const item = ctx.byId()[turn.ref];
  return item.kind === 'pattern' ? item.fills.find((f) => f.fillId === turn.fill) : item;
}

// How many of your own lines you have already met as cards.
export function convoStatus(convo, progress) {
  const mine = convo.turns.filter((t) => t.who === 'you');
  const learned = mine.filter((t) => progress.cards[`${t.ref}:say`]).length;
  return { learned, total: mine.length, ready: learned === mine.length, done: progress.convos[convo.id]?.n || 0 };
}

export function initConvo(c) {
  ctx = c;
  $('cv-next').addEventListener('click', advance);
  $('cv-again').addEventListener('click', () => startConvo(state.convo));
}

export function startConvo(convo) {
  const pool = [...ctx.decks()[convo.deck].voices].sort(() => Math.random() - 0.5);
  state = { convo, i: 0, revealed: false, voices: { them: pool[0], you: pool[1] || pool[0] }, bubbles: [] };
  $('cv-title').textContent = convo.title;
  $('cv-log').replaceChildren();
  $('cv-end').hidden = true;
  $('cv-next').hidden = false;
  ctx.show('convo');
  ctx.syncScriptViews(convo.deck);
  showTurn();
}

function speak(entry, who) {
  const v = entry.audio[state.voices[who]] ? state.voices[who] : Object.keys(entry.audio)[0];
  play(entry.audio[v][0]);
}

function showTurn() {
  const turn = state.convo.turns[state.i];
  const entry = entryOf(turn);
  const d = state.convo.deck;
  const body = el('div', { class: 'cv-body' });
  const bubble = el('div', { class: `cv-bubble ${turn.who}` },
    el('span', { class: 'cv-who' }, turn.who === 'them' ? 'They say' : 'You say'),
    body);
  if (turn.who === 'them') {
    body.append(el('button', { class: 'icon-btn', 'aria-label': 'Play', onclick: () => speak(entry, 'them') }, icon('play')), el('span', { class: 'muted' }, ' listen, then tap Show'));
    speak(entry, 'them');
  } else {
    body.append(el('p', { class: 'cv-cue' }, entry.en));
  }
  state.current = { turn, entry, bubble, body, d };
  $('cv-log').append(bubble);
  bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
  state.revealed = false;
  $('cv-next').textContent = turn.who === 'them' ? 'Show' : 'Check';
}

function reveal() {
  const { turn, entry, body, d } = state.current;
  body.replaceChildren(
    renderRoman(el('p', { class: 'cv-roman' }), entry.roman, d),
    ctx.zhNode('p', { class: 'cv-zh' }, entry.zh, d),
    el('p', { class: 'cv-en' }, entry.en),
    el('button', { class: 'icon-btn', 'aria-label': 'Play', onclick: () => speak(entry, turn.who) }, icon('play')));
  if (turn.who === 'you') speak(entry, 'you');
  state.revealed = true;
  $('cv-next').textContent = state.i + 1 < state.convo.turns.length ? 'Next' : 'Finish';
  state.current.bubble.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function advance() {
  if (!state) return;
  if (!state.revealed) return reveal();
  state.i += 1;
  if (state.i < state.convo.turns.length) return showTurn();
  const p = ctx.progress();
  const rec = (p.convos[state.convo.id] ||= { n: 0, last: null });
  rec.n += 1;
  rec.last = localDate(new Date());
  ctx.persist();
  $('cv-next').hidden = true;
  $('cv-end').hidden = false;
  $('cv-end-text').textContent = rec.n === 1 ? 'First run done!' : `Done ${rec.n} times.`;
}
