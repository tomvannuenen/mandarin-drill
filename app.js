import { $, el, play, renderRoman, speakText, LANG_ATTR } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { grade } from './lib/srs.js';
import { pickFill, pickVoice, nextVoice } from './lib/cards.js';
import { buildQueue, shouldRequeue } from './lib/session.js';
import { load, save, exportJSON, importJSON, applyReview, localDate } from './lib/store.js';
import { initBook, renderBook } from './book.js';
import { initTones, startTones, toneWords, toneBars } from './tonecheck.js';
import { initConvo, startConvo, convoStatus } from './convo.js';
import { weekSummary, checkinText, coachBrief } from './lib/checkin.js';
import { applyPlan, planIsCurrent } from './lib/plan.js';
import { level, hintText } from './lib/ladder.js';
import { addWish, wishStatus } from './lib/wishes.js';
import { canRecord, startRecording, stopRecording, isRecording, compare, share as shareRecording } from './rec.js';
import { loadConfig, saveConfig, testConnection, pushProgress, pullProgress, pullPlan, DEFAULT_REPO } from './lib/sync.js';
import { flagWord, credit, troubleSpots, drillItems, drillPrompt } from './lib/weak.js';
import { weekReadiness, daysUntil, canSay, pickMission, markMissionDone, missionDoneToday } from './lib/motivation.js';
import { composeToday, snapshot, outcome, dueSoon, estimateMinutes } from './lib/today.js';
import { charItems, knowsWord, tiles, isBuilt, markReading, readingTrouble, charId } from './lib/chars.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LANG_NAME = { mandarin: 'Mandarin', cantonese: 'Cantonese' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Which tab each screen belongs to; screens without a tab are full-screen.
const TAB_OF = { home: 'home', done: 'home', explore: 'explore', browse: 'explore', book: 'explore', wish: 'explore', me: 'me', checkin: 'me', settings: 'me' };
const ACCENT = { tw: 'TW', cn: 'CN', hk: 'HK', coach: 'Coach' };

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const nullStorage = { getItem: () => null, setItem() {} };

let allItems = [];
let byId = {};
let decks = {}; // {deck: {label, voices}}
let conversations = [];
let wordAudio = {}; // '<deck>/<word>' -> audio of the word's own card
let plan = null; // Claude's daily focus note
let syncCfg = loadConfig();
let syncDirty = false;
let syncTimer = null;
let syncError = '';
let version = '';
let progress = load(storage || nullStorage);
let extraNew = 0;
let missionSkip = 0;
let session = null; // { queue, pos, total, done, right, graded, startedAt, before, convo, current: {card, c} }
let pendingEnd = null; // session results waiting for a chained conversation to finish

const deck = () => (decks[progress.settings.deck] ? progress.settings.deck : 'mandarin');
const items = () => allItems.filter((i) => i.deck === deck());

// Deck items plus practice items for the current trouble spots (kept in byId so queued drills still resolve).
function drills() {
  const d = drillItems(allItems, progress, deck());
  for (const x of d) byId[x.id] = x;
  return d;
}
const studyItems = () => [...items(), ...drills()];

// Words from phrases you've met, as virtual word-card items (kept in byId so queued cards resolve).
function chars() {
  const c = charItems(allItems, progress, deck());
  for (const x of c) byId[x.id] = x;
  return c;
}

// ---------- persistence and sync

function persist() {
  save(storage || nullStorage, progress);
  if (syncCfg) {
    syncDirty = true;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 20000);
  }
}

// Upload progress to the private repo (debounced; also on leaving the app and after a session).
async function syncNow() {
  clearTimeout(syncTimer);
  if (!syncCfg || !syncDirty || !navigator.onLine) return;
  syncDirty = false;
  try {
    await pushProgress(syncCfg, exportJSON(progress));
    syncError = '';
  } catch (err) {
    syncDirty = true;
    syncError = err.message;
  }
  if (!$('view-settings').hidden) renderSync();
}

async function syncOnOpen() {
  if (!syncCfg || !navigator.onLine) return;
  try {
    if (!Object.keys(progress.cards).length) {
      const remote = await pullProgress(syncCfg);
      if (remote && Object.keys(importJSON(remote).cards).length && confirm('Restore your progress from sync?')) {
        progress = importJSON(remote);
        save(storage || nullStorage, progress);
      }
    }
    plan = await pullPlan(syncCfg);
    if (applyPlan(progress, plan, new Date())) persist();
    if (!$('view-home').hidden) renderHome();
  } catch (err) {
    syncError = err.message;
  }
}

function renderSync() {
  const box = $('sync-box');
  if (syncCfg) {
    const when = syncCfg.lastSync ? new Date(syncCfg.lastSync).toLocaleString() : 'not yet';
    box.replaceChildren(
      el('p', { class: 'muted' }, `Connected to ${syncCfg.repo} (private). Last synced ${when}. Claude reads this to follow your progress and writes your daily note here.`),
      ...(syncError ? [el('p', { class: 'muted error' }, `Last problem: ${syncError}`)] : []),
      el('div', { class: 'button-row' },
        el('button', { class: 'btn', onclick: () => { syncDirty = true; syncNow(); } }, 'Sync now'),
        el('button', { class: 'link small', onclick: () => {
          if (!confirm('Stop syncing? Your progress stays on this phone.')) return;
          syncCfg = null; saveConfig(null); renderSync();
        } }, 'Disconnect'))
    );
    return;
  }
  const input = el('input', { type: 'password', class: 'token-input', placeholder: 'github_pat_…', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const status = el('p', { class: 'muted' });
  box.replaceChildren(
    el('p', { class: 'muted' }, 'Lets Claude follow your progress and write a daily note. Also backs up your progress. One-time setup on GitHub:'),
    el('ol', { class: 'muted steps' },
      el('li', {}, 'Open ', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'GitHub → new fine-grained token'), '.'),
      el('li', {}, 'Repository access: Only select repositories → mandarin-progress.'),
      el('li', {}, 'Permissions → Contents: Read and write. Expiration: 1 year.'),
      el('li', {}, 'Generate, copy the key, paste it below.')),
    input,
    el('button', { class: 'btn primary', onclick: async () => {
      const cfg = { repo: DEFAULT_REPO, token: input.value.trim() };
      if (!cfg.token) return;
      status.textContent = 'Checking…';
      try {
        await testConnection(cfg);
        syncCfg = cfg;
        saveConfig(cfg);
        syncDirty = true;
        await syncNow();
        await syncOnOpen();
        renderSync();
      } catch (err) {
        status.textContent = `Could not connect: ${err.message}`;
      }
    } }, 'Connect'),
    status
  );
}

// ---------- navigation

function applyReadingMode() {
  document.body.classList.toggle('pinyin-first', !progress.settings.reading);
}

function renderDeckPills() {
  const other = Object.keys(decks).find((d) => d !== deck());
  for (const pill of document.querySelectorAll('.deck-pill')) {
    pill.textContent = decks[deck()]?.label || '';
    pill.setAttribute('lang', LANG_ATTR[deck()]);
    pill.setAttribute('aria-label', `Switch to ${LANG_NAME[other] || 'other language'}`);
  }
}

function switchDeck() {
  const keys = Object.keys(decks);
  progress.settings.deck = keys[(keys.indexOf(deck()) + 1) % keys.length];
  extraNew = 0;
  missionSkip = 0;
  persist();
  show(currentView);
}

let currentView = 'home';
function show(view) {
  currentView = view;
  applyReadingMode();
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  const tab = TAB_OF[view];
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === tab);
  document.body.classList.toggle('fullscreen', !tab);
  $('which').hidden = true;
  renderDeckPills();
  ({ home: renderHome, explore: renderExplore, browse: renderBrowse, me: renderMe, settings: renderSettings,
    book: renderBook, checkin: renderCheckin, wish: renderWishes })[view]?.();
  window.scrollTo(0, 0);
}

// ---------- shared bits

function voiceTag(id) {
  return ACCENT[id.split('-')[0]] || '';
}

// A concrete sentence for display: patterns use your own answer ('mine') or one of their known fills.
function sample(item) {
  if (item.kind !== 'pattern') return item;
  return item.fills.find((f) => f.fillId === item.mine) || pickFill(item, progress);
}

// Pinyin first (coloured), then English and small characters; tapping plays it in a rotating voice.
function sayLine(entry, d) {
  return el(
    'button',
    { class: 'say-line', onclick: () => play(entry.audio[pickVoice(entry)][0]) },
    el('span', { class: 'say-top' }, renderRoman(el('span', { class: 'say-roman' }), entry.roman, d), icon('play', 'say-play')),
    el('span', { class: 'say-en' }, entry.en),
    el('span', { class: 'say-zh', lang: LANG_ATTR[d] }, entry.zh)
  );
}

// Say a single word: its own recording if it has a card, otherwise the phone's voice.
function speakWord(zh, d, preferVoice = null) {
  const audio = wordAudio[`${d}/${zh}`];
  if (!audio) return speakText(zh, d);
  const v = audio[preferVoice] ? preferVoice : pickVoice({ audio });
  play(audio[v][0]);
}

// Pinyin and meaning of a word as it appears inside any phrase.
function wordInfo(zh) {
  for (const i of allItems) for (const e of i.fills || [i]) for (const w of e.words || []) if (w.zh === zh) return w;
  return null;
}

function minutes(n) {
  return n <= 1 ? 'about a minute' : `about ${n} minutes`;
}

function card(...children) {
  return el('section', { class: 'paper-card' }, ...children);
}

function newLimit() {
  return progress.settings.newPerDay + extraNew;
}

function todayPlan(now = new Date()) {
  return composeToday({ items: items(), drills: drills(), chars: chars(), progress, plan, now, newLimit: newLimit(), deck: deck() });
}

function readyConversation() {
  const today = localDate(new Date());
  return conversations
    .filter((c) => c.deck === deck())
    .map((c) => ({ c, st: convoStatus(c, progress) }))
    .filter(({ c, st }) => st.ready && progress.convos[c.id]?.last !== today)
    .sort((a, b) => a.st.done - b.st.done)[0]?.c || null;
}

// ---------- today

function renderHome() {
  const now = new Date();
  const s = progress.stats;
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const alive = s.lastStudyDate === localDate(now) || s.lastStudyDate === yesterday;
  $('today-eyebrow').textContent = [WEEKDAYS[now.getDay()], alive && s.streak ? `${s.streak}-day streak` : ''].filter(Boolean).join(' · ');
  const h = now.getHours();
  $('greeting').textContent = `${h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'}, Tom.`;

  const note = planIsCurrent(plan, now) && plan.message
    ? plan.message
    : 'Say each answer out loud before you check it. Speaking is what makes it stick.';
  $('today-note').textContent = note;

  const { queue, counts } = todayPlan(now);
  const convo = readyConversation();
  $('start-block').hidden = !queue.length;
  $('rest-block').hidden = !!queue.length;
  if (queue.length) {
    const parts = [
      counts.focus && `${counts.focus} focus`,
      counts.reviews && `${counts.reviews} review${counts.reviews === 1 ? '' : 's'}`,
      counts.fresh && `${counts.fresh} new`,
      counts.chars && `${counts.chars} characters`,
      counts.builds && `${counts.builds} to build`,
      convo && '1 conversation',
    ].filter(Boolean);
    const m = minutes(estimateMinutes(queue.length) + (convo ? 2 : 0));
    $('start-sub').textContent = `${m[0].toUpperCase()}${m.slice(1)} · ${parts.join(', ')}`;
  } else {
    const soon = dueSoon(progress, items(), now);
    $('rest-sub').textContent = soon ? `Next: ${soon} review${soon === 1 ? '' : 's'} by tomorrow.` : 'Come back tomorrow.';
    $('more').hidden = !items().some((i) => !progress.cards[`${i.id}:say`]);
  }

  const totalSeen = allItems.filter((i) => progress.cards[`${i.id}:say`]).length;
  const stale = !syncCfg && (!progress.lastExport || now - new Date(progress.lastExport) > WEEK_MS);
  $('export-banner').hidden = !(stale && totalSeen >= 10);

  renderMission(now);
}

function renderMission(now) {
  const slot = $('mission-slot');
  if (missionDoneToday(progress, now)) {
    const n = progress.missions.length;
    slot.replaceChildren(card(el('p', { class: 'eyebrow' }, "Today's mission"), el('p', { class: 'mission-what' }, `Done. ${n} real-life mission${n === 1 ? '' : 's'} so far.`)));
    return;
  }
  const m = pickMission(items(), progress, now, missionSkip);
  if (!m) {
    slot.replaceChildren();
    return;
  }
  slot.replaceChildren(card(
    el('p', { class: 'eyebrow' }, "Today's mission"),
    el('p', { class: 'mission-what' }, m.mission),
    sayLine(sample(m), deck()),
    el('div', { class: 'mission-foot' },
      el('button', { class: 'link small', onclick: () => { missionSkip += 1; renderMission(new Date()); } }, 'Another one'),
      el('button', { class: 'btn primary small', onclick: () => { markMissionDone(progress, m.id, new Date()); persist(); renderMission(new Date()); } }, 'I did it'))
  ));
}

// ---------- practice

function contentFor(card) {
  const item = byId[card.id];
  if (card.type === 'char') {
    const word = { zh: item.zh, roman: item.roman, gloss: item.gloss };
    return {
      char: true, zh: item.zh, roman: item.roman, en: item.gloss, words: [word], example: item.example,
      audio: item.audio, voice: item.audio ? pickVoice(item) : null, played: false, deck: item.deck, flagged: new Set(),
      ...tracking(),
    };
  }
  if (card.type === 'build') {
    const entry = item.kind === 'pattern'
      ? (item.fills.find((f) => f.fillId === item.mine) || pickFill(item, progress))
      : item;
    return {
      build: true, entry, zh: entry.zh, roman: entry.roman, en: entry.en, words: entry.words, audio: entry.audio,
      voice: pickVoice(entry), played: false, deck: item.deck, flagged: new Set(),
      tiles: tiles(entry, chars()), picked: [], tries: 0, result: null,
      ...tracking(),
    };
  }
  if (item.kind === 'drill') {
    const p = drillPrompt(item);
    const word = { zh: item.zh, roman: item.roman, gloss: item.gloss };
    const src = p.mode === 'gap' ? p.context : { words: [word], audio: item.audio || item.contexts[0]?.audio };
    return {
      drill: p.mode, target: item.zh, context: p.context, zh: item.zh, en: item.gloss, roman: item.roman,
      words: src.words, audio: src.audio, voice: pickVoice(src), played: false, deck: item.deck, flagged: new Set(),
      ...tracking(),
    };
  }
  let src = item.kind === 'pattern' ? pickFill(item, progress) : item;
  const lvl = card.type === 'say' ? level(progress, { id: item.id, situation: src.situation }, new Date()) : 'normal';
  // A situation about you ("Someone asks where you're from") needs your own answer, not a random fill.
  if (lvl === 'situation' && item.mine) src = item.fills.find((f) => f.fillId === item.mine) || src;
  return {
    zh: src.zh, roman: src.roman, en: src.en, words: src.words, audio: src.audio, situation: src.situation,
    voice: pickVoice(src), played: false, note: item.note, deck: item.deck, flagged: new Set(), level: lvl,
    ...tracking(),
  };
}

// What the app quietly notices while a card is up; logged with the grade.
function tracking() {
  return { shownAt: performance.now(), revealMs: null, replays: 0, lookups: new Set(), hint: false };
}

function showAccent() {
  const tag = session.current.c.voice ? voiceTag(session.current.c.voice) : '';
  $('voice-flag').textContent = tag;
  const speaker = document.querySelector('#prompt .speaker');
  if (speaker) speaker.textContent = tag;
}

// First play uses the card's voice; each further tap on play moves to the next speaker.
function playCurrent({ slow = false, next = false } = {}) {
  const c = session?.current?.c;
  if (!c) return;
  if (next && c.played && c.audio) c.voice = nextVoice(c, c.voice);
  if (c.played) c.replays += 1;
  c.played = true;
  showAccent();
  if (!c.audio) return speakText(c.zh, c.deck, slow ? 0.55 : 0.85);
  play(c.audio[c.voice][slow ? 1 : 0]);
}

// Answer shown word by word; tap a word for its meaning.
function renderWords(c) {
  const lang = LANG_ATTR[c.deck];
  const gloss = $('a-gloss');
  gloss.hidden = true;
  $('a-words').replaceChildren(
    ...c.words.map((w) => {
      const btn = el(
        'button',
        { class: `wg${w.zh === c.target && c.drill === 'gap' ? ' target' : ''}`, 'data-zh': w.zh, 'aria-label': `${w.zh}: ${w.gloss}` },
        el('span', { class: 'wg-zh', lang }, w.zh),
        renderRoman(el('span', { class: 'wg-roman' }), w.roman, c.deck)
      );
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        for (const b of $('a-words').children) b.classList.remove('active');
        gloss.hidden = wasActive;
        if (wasActive) return speakWord(w.zh, c.deck, c.voice);
        btn.classList.add('active');
        c.lookups.add(w.zh);
        speakWord(w.zh, c.deck, c.voice);
        gloss.replaceChildren(renderRoman(el('b'), w.roman, c.deck), ` = ${w.gloss}`);
      });
      return btn;
    })
  );
}

// A small button that reveals a hint (first letters of the pinyin by default) and records that it was used.
function hintButton(c, label = 'Hint', text = () => hintText(c.roman, c.deck)) {
  const b = el('button', { class: 'hint-btn' }, icon('bulb'), label);
  b.addEventListener('click', () => {
    c.hint = true;
    b.replaceWith(el('p', { class: 'hint-line' }, text()));
  });
  return b;
}

// Sentence building: tap word tiles into order. Pinyin shows under words you can't read yet.
function renderBuild(c) {
  const line = el('div', { class: 'build-line' });
  const pool = el('div', { class: 'build-pool' });
  const tileEl = (t) => {
    const b = el('button', { class: 'tile' }, el('span', { class: 'tile-zh', lang: LANG_ATTR[c.deck] }, t.zh));
    if (!knowsWord(progress, c.deck, t.zh)) b.append(renderRoman(el('span', { class: 'tile-roman' }), t.roman, c.deck));
    return b;
  };
  const draw = () => {
    line.replaceChildren(...(c.picked.length ? c.picked.map((t) => {
      const b = tileEl(t);
      b.addEventListener('click', () => { if (c.result) return; c.picked = c.picked.filter((x) => x !== t); draw(); });
      return b;
    }) : [el('span', { class: 'build-empty' }, 'Tap the words in order')]));
    pool.replaceChildren(...c.tiles.map((t) => {
      const b = tileEl(t);
      const used = c.picked.includes(t);
      b.classList.toggle('used', used);
      b.addEventListener('click', () => {
        if (used || c.result) return;
        speakWord(t.zh, c.deck);
        c.picked.push(t);
        draw();
        if (c.picked.length === c.words.length) checkBuild(c, line);
      });
      return b;
    }));
  };
  draw();
  c.redraw = draw;
  return [el('p', { class: 'prompt-en' }, c.en), line, pool];
}

function checkBuild(c, line) {
  if (isBuilt(c.entry, c.picked.map((t) => t.zh))) return finishBuild(c.tries === 0 ? 3 : 2);
  c.tries += 1;
  line.classList.add('wrong');
  setTimeout(() => {
    line.classList.remove('wrong');
    if (c.tries >= 2) return finishBuild(1);
    c.picked = [];
    c.redraw();
  }, 700);
}

// Show the right sentence, play it, and grade automatically: first try = Got it, second = Almost, else Didn't know.
function finishBuild(rating) {
  const { c } = session.current;
  if (c.result) return;
  c.result = rating;
  c.revealMs = Math.round(performance.now() - c.shownAt);
  $('card-kind').textContent = rating === 3 ? 'Well built' : rating === 2 ? 'Got there' : "Here's how it goes";
  $('answer').hidden = false;
  $('reveal').hidden = true;
  $('continue').hidden = false;
  playCurrent();
}

function promptFor(card, c) {
  const lang = LANG_ATTR[c.deck];
  if (c.build) return renderBuild(c);
  if (c.char) return [el('p', { class: 'prompt-char', lang }, c.zh), el('p', { class: 'muted' }, 'Say it out loud'), hintButton(c)];
  if (c.drill === 'gap') {
    // The sentence in pinyin with the missing word blanked; characters only when practising reading.
    const words = c.context.words;
    const romanGap = el('p', { class: 'prompt-gap-roman' }, ...words.flatMap((w, i) => [
      ...(i ? [' '] : []),
      w.zh === c.target ? el('span', { class: 'gap' }, '＿＿') : renderRoman(el('span'), w.roman, c.deck),
    ]));
    const parts = [el('p', { class: 'prompt-en' }, c.context.en), romanGap];
    if (progress.settings.reading) {
      parts.push(el('p', { class: 'prompt-gap', lang }, ...words.map((w) => (w.zh === c.target ? el('span', { class: 'gap' }, '＿＿') : w.zh))));
    }
    return parts;
  }
  if (c.drill === 'word') return [el('p', { class: 'prompt-en' }, c.en), el('p', { class: 'muted' }, 'one word'), hintButton(c)];
  if (card.type === 'say') {
    if (c.level === 'situation') return [el('p', { class: 'prompt-situation' }, c.situation), hintButton(c, 'Show the English', () => c.en)];
    if (c.level === 'speed') return [el('p', { class: 'prompt-en' }, c.en), el('div', { class: 'speed-bar' }, el('div', { class: 'speed-fill' }))];
    if (c.level === 'hint') {
      c.hint = true;
      return [el('p', { class: 'prompt-en' }, c.en), el('p', { class: 'hint-line' }, hintText(c.roman, c.deck))];
    }
    return [el('p', { class: 'prompt-en' }, c.en), hintButton(c)];
  }
  if (card.type === 'read') return [el('p', { class: 'prompt-zh', lang }, c.zh)];
  return [
    el('button', { class: 'icon-btn huge', 'aria-label': 'Play, then next voice', onclick: () => playCurrent({ next: true }) }, icon('play')),
    el('p', { class: 'speaker' }),
  ];
}

function startSession(queue, { convo = null } = {}) {
  if (!queue.length) return;
  session = {
    queue, pos: 0, total: queue.length, done: 0, right: 0, graded: 0,
    startedAt: Date.now(), before: snapshot(progress), convo,
  };
  show('study');
  showCard();
}

function startToday() {
  startSession(todayPlan().queue, { convo: readyConversation() });
}

function showCard() {
  if (session.pos >= session.queue.length) return finishSession();
  const card = session.queue[session.pos];
  const c = contentFor(card);
  session.current = { card, c };

  $('card-kind').textContent = c.build ? 'Build the sentence'
    : c.char ? 'Read it'
    : c.drill
    ? 'Trouble spot'
    : c.level === 'situation' ? 'What would you say?'
    : c.level === 'speed' ? 'Speed round: say it before the bar runs out'
    : { say: `Say it in ${LANG_NAME[c.deck]}`, listen: 'What does this mean?', read: 'Read it aloud' }[card.type];
  $('prompt').replaceChildren(...promptFor(card, c));
  if (!c.drill && card.type === 'listen') playCurrent();

  renderWords(c);
  showAccent();
  $('rec').hidden = !canRecord();
  $('rec').replaceChildren(icon('mic'));
  $('rec').classList.remove('recording');
  $('rec-row').hidden = true;
  $('a-en').textContent = c.en;
  $('a-en').hidden = (card.type === 'say' && c.level !== 'situation' && !c.drill) || c.build;
  $('a-example').hidden = !c.example;
  $('a-example').replaceChildren(...(c.example ? [el('p', { class: 'section' }, 'In a phrase you know'), sayLine(c.example, c.deck)] : []));
  $('continue').hidden = true;
  $('reveal').textContent = c.build ? "I'm stuck, show me" : 'Show answer';
  $('a-note').textContent = c.note || '';
  $('a-note').hidden = !c.note;
  $('answer').hidden = true;
  $('reveal').hidden = false;
  $('grades').hidden = true;
  $('which').hidden = true;
  for (const g of document.querySelectorAll('#grades .grade')) g.classList.remove('picked');

  $('progress-bar').style.width = `${(session.done / Math.max(session.total, session.done + 1)) * 100}%`;
  $('progress-text').textContent = `${Math.min(session.done + 1, session.total)} of ${session.total}`;
}

function reveal() {
  if (!session || !$('answer').hidden) return;
  if (session.current.c.build) return finishBuild(1);
  session.current.c.revealMs = Math.round(performance.now() - session.current.c.shownAt);
  $('answer').hidden = false;
  $('reveal').hidden = true;
  $('grades').hidden = false;
  document.querySelector('#prompt .hint-btn')?.remove();
  if (session.current.card.type !== 'listen') playCurrent();
}

// Grading: after "Didn't know" or "Almost" on a multi-word answer, ask which part tripped you up.
function rate(rating) {
  if (!session || $('grades').hidden || !$('which').hidden) return;
  const { c } = session.current;
  if (rating < 3 && c.words.length > 1 && !c.build && !c.char) {
    document.querySelector(`#grades [data-rating="${rating}"]`).classList.add('picked');
    session.current.pending = rating;
    $('which-chips').replaceChildren(...c.words.map((w) => {
      const chip = el('button', { class: 'chip' }, renderRoman(el('span'), w.roman, c.deck), el('small', {}, w.gloss));
      chip.addEventListener('click', () => {
        speakWord(w.zh, c.deck, c.voice);
        if (c.flagged.has(w.zh)) c.flagged.delete(w.zh);
        else c.flagged.add(w.zh);
        chip.classList.toggle('on', c.flagged.has(w.zh));
        document.querySelector(`#a-words [data-zh="${CSS.escape(w.zh)}"]`)?.classList.toggle('missed', c.flagged.has(w.zh));
      });
      return chip;
    }));
    $('which').hidden = false;
    return;
  }
  commit(rating);
}

function commit(rating) {
  const { card, c } = session.current;
  const now = new Date();
  const state = grade(progress.cards[card.key] || null, rating, now);
  applyReview(progress, card, rating, state, now, {
    ms: c.revealMs, voice: c.voice, replays: c.replays, lookups: [...c.lookups], hint: c.hint,
  });
  if (c.char) markReading(progress, c.deck, c.zh, rating >= 3, now); // reading, not speaking
  else if (rating >= 3) credit(progress, c.deck, c.drill ? [{ zh: c.target }] : c.words, now);
  for (const zh of c.flagged) {
    // A newly missed word gets a practice card straight away, shown again later in this session.
    const id = flagWord(progress, c.deck, zh, now);
    const key = `${id}:say`;
    if (!progress.cards[key]) progress.cards[key] = grade(null, 1, now);
    drills();
    if (!session.queue.slice(session.pos + 1).some((q) => q.key === key)) session.queue.push({ key, id, type: 'say', deck: c.deck });
  }
  persist();
  session.graded += 1;
  if (rating >= 3) session.right += 1;
  session.pos += 1;
  if (shouldRequeue(state, now)) session.queue.push(card);
  else session.done += 1;
  showCard();
}

function finishSession() {
  const s = session;
  session = null;
  const results = {
    cards: s.graded,
    minutes: Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)),
    pct: s.graded ? Math.round((100 * s.right) / s.graded) : 0,
    ...outcome(s.before, progress, allItems, deck()),
  };
  syncNow();
  if (s.convo) {
    pendingEnd = results;
    startConvo(s.convo);
    return;
  }
  renderDone(results);
}

function renderDone(r) {
  pendingEnd = null;
  show('done');
  $('done-title').textContent = r.pct >= 80 ? 'Nicely done.' : r.pct >= 50 ? 'Good work.' : 'That was a hard one. Well done for showing up.';
  $('done-stats').replaceChildren(
    ...[[r.cards, 'cards'], [r.minutes, 'minutes'], [`${r.pct}%`, 'got it']].map(([n, l]) => el('div', { class: 'stat' }, el('b', {}, String(n)), el('span', {}, l)))
  );
  $('done-solid').replaceChildren(...(r.solid.length ? [
    el('p', { class: 'section' }, 'Now solid'),
    ...r.solid.map((item, i) => {
      const seal = el('span', { class: 'seal seal-small stamp-in', style: `animation-delay:${0.3 + i * 0.25}s` }, el('span', { lang: 'zh-Hant-TW' }, '成'));
      return el('div', { class: 'stamp-row' }, sayLine(sample(item), item.deck), seal);
    }),
  ] : []));
  const changes = [];
  for (const zh of r.cleared) {
    changes.push(el('div', { class: 'change' }, icon('check'), el('span', {}, el('b', {}, (wordInfo(zh)?.roman || zh).replace(/-/g, '')), ' is off your trouble list')));
  }
  const soon = dueSoon(progress, items(), new Date());
  changes.push(el('div', { class: 'change info' }, icon('calendar'), el('span', {}, soon ? `Tomorrow: ${soon} review${soon === 1 ? '' : 's'}, ${minutes(estimateMinutes(soon))}` : 'Nothing due tomorrow. Enjoy the day off.')));
  $('done-changes').replaceChildren(el('p', { class: 'section' }, 'What changed'), ...changes);
}

// ---------- explore

function renderExplore() {
  $('explore-convos').replaceChildren(...conversations.filter((c) => c.deck === deck()).map((c) => {
    const st = convoStatus(c, progress);
    const status = st.done ? `done ${st.done}×` : st.ready ? 'ready' : `${st.learned} of ${st.total} lines met`;
    return el('button', { class: `convo-row${st.ready ? ' ready' : ''}`, onclick: () => startConvo(c) }, icon('chat'), el('span', {}, c.title), el('span', { class: 'muted' }, status));
  }));
  const words = deck() === 'mandarin' ? toneWords(allItems, progress) : [];
  $('tones-row').hidden = deck() !== 'mandarin';
  $('tones-sub').textContent = words.length ? '10 questions' : 'after a few words';
  $('browse-sub').textContent = `${items().length}`;
  const wishes = wishStatus(progress, allItems);
  const waiting = wishes.filter((w) => !w.item).length;
  $('wish-sub').textContent = wishes.length ? `${wishes.length - waiting} ready${waiting ? `, ${waiting} waiting` : ''}` : '';
}

function groupLabel(item) {
  return item.set || `Week ${item.week}`;
}

function rowParts(entry, d, badge) {
  return [
    el('span', { class: 'zh-s', lang: LANG_ATTR[d] }, entry.zh, ...(badge ? [el('span', { class: 'badge' }, badge)] : [])),
    el('span', { class: 'en-s' }, entry.en),
    renderRoman(el('span', { class: 'pinyin-s' }), entry.roman, d),
  ];
}

function browseRow(entry, d) {
  return el('button', { class: 'row', onclick: () => play(entry.audio[pickVoice(entry)][0]) }, ...rowParts(entry, d));
}

function renderBrowse() {
  const list = items();
  const d = deck();
  // Newest group first: groups ordered by where they first appear in the data, reversed.
  const labels = [...new Set(list.map(groupLabel))].reverse();
  $('browse-list').replaceChildren(...labels.map((label) => el('div', { class: 'week' },
    el('h3', {}, label),
    ...list.filter((i) => groupLabel(i) === label).map((i) => (i.kind !== 'pattern'
      ? browseRow(i, d)
      : el('details', { class: 'pattern' },
        el('summary', { class: 'row' }, ...rowParts(i, d, 'pattern')),
        el('div', { class: 'fills' }, ...i.fills.map((f) => browseRow(f, d)))))))));
}

// ---------- me

function renderMe() {
  const now = new Date();
  const list = items();
  const d = deck();

  $('me-cansay').replaceChildren(...canSay(list, progress).map((g) => el('details', { class: 'sit' },
    el('summary', {},
      el('span', { class: 'sit-name' }, g.topic),
      el('span', { class: 'dots', 'aria-hidden': 'true' }, ...g.items.map((i) => el('i', { class: i.solid ? 'on' : '' }))),
      el('span', { class: 'muted' }, `${g.solid}/${g.total}`)),
    el('ul', {}, ...g.items.map((i) => el('li', { class: i.solid ? 'solid' : '' }, el('span', { class: 'mark' }, i.solid ? '✓' : '·'), sayLine(sample(byId[i.id]), d)))))));

  const r = d === 'mandarin' ? weekReadiness(list, progress) : null;
  if (r) {
    const day = progress.settings.lessonDay;
    const n = day == null ? null : daysUntil(day, now);
    const when = n == null ? el('button', { class: 'link small', 'data-go': 'settings' }, 'Set lesson day')
      : el('span', { class: 'muted' }, n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`);
    $('me-lesson').replaceChildren(el('p', { class: 'section' }, 'Your lessons'), card(
      el('div', { class: 'top' }, el('span', { class: 'eyebrow' }, day == null ? `Week ${r.week}` : `Lesson ${WEEKDAYS[day]}`), when),
      el('p', { class: 'lesson-num' }, `${r.solid} of ${r.total} ready`),
      el('div', { class: 'meter' }, el('div', { class: 'meter-fill', style: `width:${(100 * r.solid) / r.total}%` })),
      el('div', { class: 'button-row' }, el('button', { class: 'btn small', 'data-go': 'checkin' }, 'Notes for coach'), el('button', { class: 'btn small', 'data-go': 'checkin' }, 'This week'))
    ));
  } else {
    $('me-lesson').replaceChildren();
  }

  const spots = troubleSpots(progress, d);
  const info = Object.fromEntries(drills().map((x) => [x.zh, x]));
  const reading = readingTrouble(progress, d).filter((t) => progress.cards[`${charId(d, t.zh)}:char`]);
  chars();
  $('me-spots').replaceChildren(
    ...(spots.length ? [
      el('p', { class: 'section' }, 'Hard to say'),
      el('div', { class: 'spots' }, ...spots.slice(0, 10).map((t) => el('button', { class: 'spot', onclick: () => speakWord(t.zh, d) }, renderRoman(el('span'), info[t.zh]?.roman || t.zh, d), el('small', {}, info[t.zh]?.gloss || '')))),
      el('button', { class: 'btn small', onclick: () => startSession(drills().map((x) => ({ key: `${x.id}:say`, id: x.id, type: 'say', deck: x.deck }))) }, `Practise saying ${spots.length}`),
    ] : []),
    ...(reading.length ? [
      el('p', { class: 'section' }, 'Hard to read'),
      el('div', { class: 'spots' }, ...reading.slice(0, 10).map((t) => {
        const info2 = byId[charId(d, t.zh)];
        return el('button', { class: 'spot read-spot', onclick: () => speakWord(t.zh, d) }, el('span', { class: 'spot-zh', lang: LANG_ATTR[d] }, t.zh), el('small', {}, info2 ? `${info2.roman.replace(/-/g, '')} · ${info2.gloss}` : ''));
      })),
      el('button', { class: 'btn small', onclick: () => startSession(reading.map((t) => ({ key: `${charId(d, t.zh)}:char`, id: charId(d, t.zh), type: 'char', deck: d }))) }, `Practise reading ${reading.length}`),
    ] : [])
  );

  $('me-tones').replaceChildren(...(d === 'mandarin' ? [el('p', { class: 'section' }, 'Tones'), toneBars(progress.tones)] : []));
  const n = progress.missions.length;
  const known = chars().filter((x) => knowsWord(progress, d, x.zh)).length;
  $('me-missions').textContent = [known && `You can read ${known} word${known === 1 ? '' : 's'}.`, n && `${n} real-life mission${n === 1 ? '' : 's'} done.`].filter(Boolean).join(' ');
}

// ---------- weekly check-in

function renderCheckin() {
  const now = new Date();
  const text = checkinText(weekSummary(progress, allItems, now), weekReadiness(allItems.filter((i) => i.deck === 'mandarin'), progress));
  $('ci-body').textContent = text;
  $('ci-status').textContent = '';
  $('ci-copy').onclick = () => navigator.clipboard.writeText(text).then(() => { $('ci-status').textContent = 'Copied.'; }).catch(() => { $('ci-status').textContent = 'Could not copy. Use Share instead.'; });
  $('ci-share').hidden = !navigator.share;
  $('ci-share').onclick = () => navigator.share({ title: '說 weekly check-in', text }).catch(() => {});

  const glossOf = {};
  for (const i of allItems) for (const e of i.fills || [i]) for (const w of e.words || []) glossOf[w.zh] ||= { roman: w.roman, gloss: w.gloss };
  const brief = (planIsCurrent(plan, now) && plan.coachNote) || coachBrief(weekSummary(progress, allItems, now), progress, glossOf, now);
  $('ci-coach').textContent = brief;
  $('ci-coach-copy').onclick = () => navigator.clipboard.writeText(brief).then(() => { $('ci-status').textContent = 'Coach notes copied.'; }).catch(() => {});
  $('ci-coach-share').hidden = !navigator.share;
  $('ci-coach-share').onclick = () => navigator.share({ title: 'Notes for my Chinese lesson', text: brief }).catch(() => {});
}

// ---------- I wish I could say…

function renderWishes() {
  $('wish-deck').value = deck();
  $('wish-list').replaceChildren(...wishStatus(progress, allItems).map((w) =>
    el('div', { class: `wish${w.item ? ' ready' : ''}` },
      el('p', { class: 'wish-text' }, `"${w.text}"`, w.where ? el('span', { class: 'muted' }, ` · ${w.where}`) : ''),
      w.item ? sayLine(w.item, w.item.deck) : el('p', { class: 'muted' }, 'On its way: it becomes a card soon.'))));
}

function saveWish() {
  const w = addWish(progress, $('wish-text').value, $('wish-where').value, $('wish-deck').value, new Date());
  if (!w) return;
  persist();
  syncDirty = true;
  syncNow();
  $('wish-text').value = '';
  $('wish-where').value = '';
  $('wish-status').textContent = syncCfg ? 'Saved. Claude will turn it into a card.' : 'Saved on this phone. Connect sync in Settings so Claude can see it.';
  renderWishes();
}

// ---------- settings

function renderSettings() {
  $('new-per-day').value = progress.settings.newPerDay;
  $('lesson-day').value = progress.settings.lessonDay ?? '';
  $('reading').checked = !!progress.settings.reading;
  renderSync();
  $('last-export').textContent = progress.lastExport ? `Last export: ${new Date(progress.lastExport).toLocaleDateString()}` : 'Not exported yet.';
  const counts = Object.keys(decks).map((d) => `${allItems.filter((i) => i.deck === d).length} ${LANG_NAME[d]}`);
  $('version').textContent = `Content version ${version} · ${counts.join(' · ')}`;
}

function exportProgress() {
  progress.lastExport = new Date().toISOString();
  persist();
  const blob = new Blob([exportJSON(progress)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `chinese-progress-${localDate(new Date())}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  renderSettings();
}

async function importProgress(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const incoming = importJSON(await file.text());
    const n = Object.keys(incoming.cards).length;
    if (!confirm(`Replace current progress with this backup (${n} cards)?`)) return;
    progress = incoming;
    persist();
    alert('Progress imported.');
    renderSettings();
  } catch (err) {
    alert(`Could not import: ${err.message}`);
  }
}

function resetProgress() {
  if (!confirm('Delete all progress on this device (both languages)? Export first if you want a backup.')) return;
  if (!confirm('Really reset? This cannot be undone.')) return;
  const settings = progress.settings;
  progress = load(nullStorage);
  progress.settings = settings;
  persist();
  show('home');
}

// ---------- wiring

function wire() {
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    // Closing a conversation that ended a session still shows what the session achieved.
    if (go && currentView === 'convo' && pendingEnd) renderDone(pendingEnd);
    else if (go) show(go.dataset.go);
    if (e.target.closest('.deck-pill')) switchDeck();
  });
  $('start').addEventListener('click', startToday);
  $('more').addEventListener('click', () => { extraNew += 5; startToday(); });
  $('quit').addEventListener('click', () => { session = null; show('home'); });
  $('reveal').addEventListener('click', reveal);
  $('continue').addEventListener('click', () => { if (session?.current?.c.result) commit(session.current.c.result); });
  $('play').addEventListener('click', () => playCurrent({ next: true }));
  $('play-slow').addEventListener('click', () => playCurrent({ slow: true }));
  for (const b of document.querySelectorAll('#grades .grade')) b.addEventListener('click', () => rate(Number(b.dataset.rating)));
  $('which-next').addEventListener('click', () => { $('which').hidden = true; commit(session.current.pending); });
  $('which-skip').addEventListener('click', () => {
    session.current.c.flagged.clear();
    $('which').hidden = true;
    commit(session.current.pending);
  });
  $('tones-row').addEventListener('click', startTones);
  $('cv-done').addEventListener('click', () => (pendingEnd ? renderDone(pendingEnd) : show('explore')));
  document.addEventListener('keydown', (e) => {
    if (!session || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!$('which').hidden) $('which-next').click();
      else reveal();
    }
    if (['1', '2', '3'].includes(e.key)) rate(Number(e.key));
  });
  $('new-per-day').addEventListener('change', (e) => {
    progress.settings.newPerDay = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0));
    persist();
    renderSettings();
  });
  $('reading').addEventListener('change', (e) => {
    progress.settings.reading = e.target.checked;
    persist();
    applyReadingMode();
  });
  $('lesson-day').addEventListener('change', (e) => {
    progress.settings.lessonDay = e.target.value === '' ? null : Number(e.target.value);
    persist();
  });
  $('wish-save').addEventListener('click', saveWish);
  $('rec').addEventListener('click', async () => {
    const c = session?.current?.c;
    if (!c) return;
    const idle = () => { $('rec').replaceChildren(icon('mic')); $('rec').classList.remove('recording'); };
    try {
      if (!isRecording()) {
        await startRecording();
        $('rec').replaceChildren(icon('stop'));
        $('rec').classList.add('recording');
        return;
      }
      c.recording = await stopRecording();
      idle();
      $('rec-row').hidden = false;
      $('rec-share').hidden = !navigator.canShare;
      compare(c.recording, c.audio[c.voice][0]);
    } catch {
      idle();
    }
  });
  $('rec-play').addEventListener('click', () => {
    const c = session?.current?.c;
    if (c?.recording) compare(c.recording, c.audio[c.voice][0]);
  });
  $('rec-share').addEventListener('click', () => {
    const c = session?.current?.c;
    if (c?.recording) shareRecording(c.recording, `me-${c.roman.replace(/[^a-z]/gi, '').slice(0, 20)}`).catch(() => {});
  });
  $('export').addEventListener('click', exportProgress);
  $('import').addEventListener('change', importProgress);
  $('reset').addEventListener('click', resetProgress);
}

async function init() {
  hydrateIcons();
  wire();
  initBook();
  const ctx = { allItems: () => allItems, progress: () => progress, persist, show, byId: () => byId, decks: () => decks };
  initTones(ctx);
  initConvo(ctx);
  $('tq-again').addEventListener('click', startTones);
  const res = await fetch('phrases.json');
  const data = await res.json();
  allItems = data.items;
  decks = data.decks;
  conversations = data.conversations || [];
  version = data.version;
  byId = Object.fromEntries(allItems.map((i) => [i.id, i]));
  for (const i of allItems) if (i.kind !== 'pattern' && i.words?.length === 1 && i.audio) wordAudio[`${i.deck}/${i.words[0].zh}`] = i.audio;
  document.addEventListener('visibilitychange', () => { if (document.hidden) syncNow(); });
  syncOnOpen();
  show('home');

  if ('serviceWorker' in navigator) {
    // A new version took over (not the first install): reload so app code matches the new data,
    // unless a study session is in progress.
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !session) location.reload();
    });
    // Once a service worker controls the page, ask it to cache all audio for offline use.
    await navigator.serviceWorker.register('sw.js').catch(() => null);
    const urls = allItems.flatMap((i) => (i.fills || [i]).flatMap((x) => Object.values(x.audio).flat()));
    const send = () => navigator.serviceWorker.controller?.postMessage({ type: 'cache-audio', urls: [...new Set(urls)] });
    if (navigator.serviceWorker.controller) send();
    else navigator.serviceWorker.addEventListener('controllerchange', send, { once: true });
  }
}

init().catch((err) => {
  document.getElementById('app').replaceChildren(el('p', {}, `Could not load phrases: ${err.message}`));
});
