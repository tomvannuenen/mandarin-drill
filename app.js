import { $, el, play, renderRoman, speakText, LANG_ATTR, SCRIPT_LANG, SCRIPT_LABEL } from './ui.js';
import { icon, hydrateIcons } from './icons.js';
import { grade } from './lib/srs.js';
import { pickFill, pickVoice, nextVoice } from './lib/cards.js';
import { buildQueue, shouldRequeue, weekQueue, orderQueue, lessonWeeks, shakyCount, adaptiveNew, mayReturn, SESSION_CAP } from './lib/session.js';
import { ACTIVITIES, METHODS, METHOD_NAME, methodStats, methodNews, dropped, pickMethod, applicable, chainSteps, logActivity, strengthOf } from './lib/methods.js';
import { options as toneOptions, toneSeq, scoreAnswer } from './lib/tonequiz.js';
import { load, save, exportJSON, importJSON, applyReview, localDate } from './lib/store.js';
import { initBook, renderBook } from './book.js';
import { syncCoach, coachUrls } from './coach.js';
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
import { composeToday, withActivities, snapshot, outcome, dueSoon, estimateMinutes } from './lib/today.js';
import { charItems, knowsWord, tiles, isBuilt, markReading, readingTrouble, charId, reclassifyReadingFlags, displayFor } from './lib/chars.js';

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
let noteGloss = {}; // {deck: {chinese inside a note: {r romanisation, e English, k?: 'mandarin'}}}
let hanzi = {}; // {character: {d meaning, p pinyin, c components, s meaning part, ph sound part, h hint}}
let t2s = {}; // {Traditional: Simplified} for the Mandarin deck's characters
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

// Script: Mandarin can be shown in Simplified. 'auto' keeps everything Traditional except word cards, which mix.
const simplified = (d) => d === 'mandarin' && progress.settings.script === 'cn';
const zs = (text, d) => (simplified(d) ? [...text].map((ch) => t2s[ch] || ch).join('') : text);
const zl = (d) => (simplified(d) ? SCRIPT_LANG.cn : LANG_ATTR[d]);
const HAN_RUN = /([㐀-鿿]+)/;
// Text with Chinese in it (notes): the characters get the same font and script as the card's own.
function mixedText(text, d, lang = null) {
  return text.split(HAN_RUN).map((part, i) => (i % 2 ? el('span', { class: 'zh-inline', lang: lang || zl(d) }, lang ? part : zs(part, d)) : part));
}

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

// Add the coach's recorded clips as an extra voice on the cards the coach said (and drop ones that were removed).
async function attachCoach() {
  const urls = await coachUrls().catch(() => ({}));
  for (const item of allItems) {
    const entries = item.kind === 'pattern' ? item.fills.map((f) => [`${item.id}--${f.fillId}`, f]) : [[item.id, item]];
    for (const [key, entry] of entries) {
      if (!entry.audio) continue;
      if (urls[key]) entry.audio.coach = [urls[key], urls[key]];
      else delete entry.audio.coach;
    }
  }
  for (const [k, a] of Object.entries(wordAudio)) {
    const item = allItems.find((i) => `${i.deck}/${i.words?.[0]?.zh}` === k && i.words?.length === 1);
    if (item?.audio) wordAudio[k] = item.audio;
  }
}

async function syncOnOpen() {
  if (!syncCfg || !navigator.onLine) return;
  syncCoach(syncCfg).then((n) => (n ? attachCoach() : null)).catch(() => {});
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
    el('span', { class: 'say-zh', lang: zl(d) }, zs(entry.zh, d))
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
function wordInfo(zh, d = deck()) {
  for (const i of allItems) if (i.deck === d) for (const e of i.fills || [i]) for (const w of e.words || []) if (w.zh === zh) return w;
  return null;
}

function minutes(n) {
  return n <= 1 ? 'about a minute' : `about ${n} minutes`;
}

function card(...children) {
  return el('section', { class: 'paper-card' }, ...children);
}

function newLimit() {
  const cfg = decks[deck()] || {};
  if (cfg.maxShaky && shakyCount(items(), progress) >= cfg.maxShaky) return extraNew;
  if (cfg.newPerDay != null) return cfg.newPerDay + extraNew;
  // Fewer new phrases while earlier ones are still shaky; "Learn more" always adds on top.
  return adaptiveNew(progress.settings.newPerDay, shakyCount(items(), progress)) + extraNew;
}

function todayPlan(now = new Date()) {
  const cfg = decks[deck()] || {};
  // A beginner deck skips character work and warms up on only its weakest few words.
  const weakest = (x) => -(progress.weak[x.id]?.score || 0);
  const d = cfg.maxDrills ? drills().sort((a, b) => weakest(a) - weakest(b)).slice(0, cfg.maxDrills) : drills();
  const characters = cfg.characters !== false;
  return composeToday({ items: items(), drills: d, chars: characters ? chars() : [], progress, plan, now, newLimit: newLimit(), deck: deck(), characters });
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

  // One line, straight from what the app tracks: what's hard to say and what's hard to read.
  const roman = (zh) => (wordInfo(zh)?.roman || zh).replace(/-/g, '');
  const say = troubleSpots(progress, deck()).slice(0, 3).map((t) => roman(t.zh));
  const read = decks[deck()]?.characters === false ? [] : readingTrouble(progress, deck()).slice(0, 3).map((t) => roman(t.zh));
  const note = [say.length && `Say: ${say.join(', ')}`, read.length && `Read: ${read.join(', ')}`].filter(Boolean).join('  ·  ');
  // A change in how the session practises is announced for the rest of that day.
  const news = progress.methodNews?.date === localDate(now) ? progress.methodNews.lines : [];
  $('today-note').replaceChildren(...[note, ...news].filter(Boolean).flatMap((line, i) => [...(i ? [el('br')] : []), line]));
  $('today-note').hidden = !note && !news.length;

  const { queue, counts } = todayPlan(now);
  const convo = readyConversation();
  $('start-block').hidden = !queue.length;
  $('rest-block').hidden = !!queue.length;
  if (queue.length) {
    const parts = [
      counts.focus && `${counts.focus} focus`,
      counts.reviews && `${counts.reviews} review${counts.reviews === 1 ? '' : 's'}`,
      counts.fresh && `${counts.fresh} new`,
      counts.chars && `${counts.chars} character${counts.chars === 1 ? '' : 's'}`,
      counts.builds && `${counts.builds} to build`,
      convo && '1 conversation',
    ].filter(Boolean);
    const m = minutes(estimateMinutes(queue.length) + (convo ? 2 : 0));
    $('start-sub').textContent = `${m[0].toUpperCase()}${m.slice(1)} · ${parts.join(', ')}`;
  } else {
    const soon = dueSoon(progress, items(), now);
    $('rest-sub').textContent = soon ? `Next: ${soon} review${soon === 1 ? '' : 's'} by tomorrow.` : 'Come back tomorrow.';
    $('more').hidden = !items().some((i) => !progress.cards[`${i.id}:say`]);
    $('more').textContent = `Learn ${decks[deck()]?.newPerDay || 5} more`;
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

// A word's meaning as a single plain word or two, for the word-for-word line ("to be at / in" -> "at").
function plainGloss(gloss) {
  const first = gloss.split(/[;,/(]/)[0].trim() || gloss;
  return first.replace(/^to be /, '').replace(/^to /, '');
}

const REGISTER_LABEL = { everyday: 'Everyday', casual: 'Casual, with friends', polite: 'Polite', formal: 'Formal' };

function contentFor(card) {
  const item = byId[card.id];
  if (card.activity) return activityContent(card, item);
  if (card.type === 'char') {
    const { script, zhDisp } = displayFor(item, progress.settings.script);
    const word = { zh: item.zh, roman: item.roman, gloss: item.gloss, script, zhDisp, zhS: item.zhS };
    return {
      char: true, zh: item.zh, zhDisp, zhS: item.zhS, script, roman: item.roman, en: item.gloss, words: [word], example: item.example,
      audio: item.audio, voice: item.audio ? pickVoice(item) : null, played: false, deck: item.deck, flagged: new Set(),
      ...tracking(),
    };
  }
  if (card.type === 'build') {
    // A pattern is built with a different word each time: the order has to be worked out, not remembered.
    const entry = item.kind === 'pattern' ? pickFill(item, progress) : item;
    return {
      build: true, order: item.order, entry, zh: entry.zh, roman: entry.roman, en: entry.en, words: entry.words, audio: entry.audio,
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
    voice: pickVoice(src), played: false, note: item.note, register: item.register, swap: item.swap, order: item.order,
    deck: item.deck, flagged: new Set(), level: lvl,
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
  if (c.voice === 'coach') return play(c.audio.coach[0], slow ? 0.7 : 1); // one recording, slowed down
  play(c.audio[c.voice][slow ? 1 : 0]);
}

// Answer shown word by word; tap a word for its meaning. A :char card shows the same script as its prompt.
function renderWords(c) {
  const lang = zl(c.deck);
  const gloss = $('a-gloss');
  gloss.hidden = true;
  renderChars(null);
  $('a-words').replaceChildren(
    ...c.words.map((w) => {
      const disp = c.char ? (w.zhDisp || w.zh) : zs(w.zh, c.deck);
      const wLang = c.char ? (SCRIPT_LANG[w.script] || lang) : lang;
      const btn = el(
        'button',
        // A dot marks a word that is a current trouble spot: to say, or on a Read it card to read.
        { class: `wg${w.zh === c.target && c.drill === 'gap' ? ' target' : ''}${w.zh === c.swap?.word ? ' swappable' : ''}${(c.char ? progress.weakChars?.[`${c.deck}/${w.zh}`]?.score : progress.weak[`w/${c.deck}/${w.zh}`]?.score) > 0 ? ' weak' : ''}`, 'data-zh': w.zh, 'aria-label': `${disp}: ${w.gloss}` },
        el('span', { class: 'wg-zh', lang: wLang }, disp),
        renderRoman(el('span', { class: 'wg-roman' }), w.roman, c.deck)
      );
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        for (const b of $('a-words').children) b.classList.remove('active');
        gloss.hidden = wasActive;
        renderChars(wasActive ? null : { text: disp, roman: w.roman, lang: wLang, deck: c.deck });
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

// A note, with its Chinese tappable: a tap says it and shows its pinyin and meaning under the note.
const NOTE_RUN = /([㐀-鿿]+(?:…[㐀-鿿]+)*)/;
function noteNodes(text, d) {
  const out = el('span', { class: 'note-gloss', hidden: '' });
  const buttons = [];
  const open = (b, part, g) => {
    for (const x of buttons) x.classList.remove('on');
    b.classList.add('on');
    out.hidden = false;
    out.replaceChildren(el('span', { class: 'zh-inline', lang: zl(d) }, zs(part, d)), ' ', renderRoman(el('b'), g.r, g.k || d), ` = ${g.e}`);
  };
  const nodes = text.split(NOTE_RUN).map((part, i) => {
    if (!(i % 2)) return part;
    const g = noteGloss[d]?.[part];
    if (!g) return el('span', { class: 'zh-inline', lang: zl(d) }, zs(part, d));
    const b = el('button', { class: 'zh-inline note-zh', lang: zl(d) }, zs(part, d));
    b.addEventListener('click', () => {
      if (b.classList.contains('on') && buttons.length > 1) {
        b.classList.remove('on');
        out.hidden = true;
        return;
      }
      open(b, part, g);
      if (!part.includes('…')) speakText(part, g.k || d);
    });
    buttons.push(b);
    if (buttons.length === 1) b._first = [part, g];
    return b;
  });
  // A note with a single piece of Chinese shows its meaning straight away.
  if (buttons.length === 1) open(buttons[0], ...buttons[0]._first);
  return [...nodes, out];
}

// Under a tapped word: its characters, and under a tapped character its parts, as deep as they go.
// Every chip can be tapped; the trail (喜 › 口) leads back up.
function renderChars(word) {
  const box = $('a-chars');
  const chars = word ? [...word.text].filter((ch) => hanzi[ch]) : [];
  box.hidden = !chars.length;
  if (!chars.length) return box.replaceChildren();
  const mandarin = word.deck === 'mandarin';
  // In a word, a character's reading is the one it has there (bú yào, xǐhuān), not the dictionary's.
  const syllables = word.roman.split(/[-\s]+/);
  const inWord = [...word.text].length === syllables.length
    ? Object.fromEntries([...word.text].map((ch, i) => [ch, syllables[i]])) : {};
  const reading = (ch, top) => (top && inWord[ch]) || (mandarin ? hanzi[ch].p : '') || '';
  const chip = (ch, { top = false, role = '', onclick }) => el('button', { class: `hz-chip${role ? ` ${role}` : ''}`, onclick },
    el('span', { class: 'hz-zh', lang: word.lang }, ch),
    ...(reading(ch, top) ? [renderRoman(el('span', { class: 'hz-roman' }), reading(ch, top), word.deck)] : []),
    el('small', {}, [role === 'means' ? 'meaning' : role === 'sounds' ? 'sound' : '', hanzi[ch].d].filter(Boolean).join(' · ')));
  const detail = el('div', { class: 'hz-detail' });
  const open = (trail) => {
    const ch = trail[trail.length - 1];
    const e = hanzi[ch];
    for (const b of row.children) b.classList.toggle('active', b.dataset.ch === trail[0]);
    const parts = [...(e.c || '')].filter((p) => hanzi[p]);
    detail.replaceChildren(
      ...(trail.length > 1 ? [el('p', { class: 'hz-trail' }, ...trail.flatMap((t, i) => [
        ...(i ? [' › '] : []),
        el('button', { class: 'hz-crumb', lang: word.lang, onclick: () => open(trail.slice(0, i + 1)) }, t),
      ]))] : []),
      el('p', { class: 'hz-line' }, el('span', { class: 'hz-zh', lang: word.lang }, ch), ' ',
        ...(reading(ch, trail.length === 1) ? [renderRoman(el('b'), reading(ch, trail.length === 1), word.deck), ' '] : []),
        e.d ? `= ${e.d}` : ''),
      ...(e.h ? [el('p', { class: 'hz-hint' }, ...mixedText(e.h, word.deck, word.lang))] : []),
      ...(parts.length ? [el('div', { class: 'hz-row' }, ...parts.map((p) => chip(p, {
        role: p === e.s ? 'means' : p === e.ph ? 'sounds' : '', onclick: () => open([...trail, p]),
      })))] : [])
    );
  };
  const row = el('div', { class: 'hz-row' }, ...chars.map((ch) => {
    const b = chip(ch, { top: true, onclick: () => open([ch]) });
    b.dataset.ch = ch;
    return b;
  }));
  box.replaceChildren(...(chars.length > 1 ? [row] : []), detail);
  if (chars.length === 1) open([chars[0]]);
}

// The part of a phrase you can replace, and a few things to put there. Tap one to hear it.
function renderSwap(c) {
  const box = $('a-swap');
  box.hidden = !c.swap;
  if (!c.swap) return box.replaceChildren();
  box.replaceChildren(
    el('span', { class: 'swap-from', lang: zl(c.deck) }, zs(c.swap.word, c.deck)),
    el('span', { class: 'swap-arrow', 'aria-label': 'can be swapped for' }, '⇄'),
    ...c.swap.with.map((alt) => el('button', { class: 'swap-alt', onclick: () => speakText(alt.zh, c.deck) },
      el('span', { class: 'swap-zh', lang: zl(c.deck) }, zs(alt.zh, c.deck)),
      renderRoman(el('span', { class: 'swap-roman' }), alt.roman, c.deck),
      el('small', {}, alt.en)))
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
  const byEar = c.activity === 'dictate'; // heard, not read: the tiles are pinyin and there is no English
  const tileEl = (t) => {
    if (byEar) return el('button', { class: 'tile' }, renderRoman(el('span', { class: 'tile-zh tile-ear' }), t.roman, c.deck));
    const b = el('button', { class: 'tile' }, el('span', { class: 'tile-zh', lang: zl(c.deck) }, zs(t.zh, c.deck)));
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
  if (byEar) {
    return [
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play again', onclick: () => playCurrent({ next: true }) }, icon('play')),
      el('p', { class: 'speaker' }), line, pool,
    ];
  }
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

// Outside the card view (conversations, tone check): characters are tagged with their Traditional source, so
// the same 繁/简 button can redraw them in place.
function zhNode(tag, attrs, text, d) {
  return el(tag, { ...attrs, lang: zl(d), 'data-zh-src': text, 'data-zh-deck': d }, zs(text, d));
}

function syncScriptViews(d = null) {
  for (const b of document.querySelectorAll('[data-script-view]')) {
    if (d) b.dataset.scriptView = d;
    const deckOf = b.dataset.scriptView;
    b.hidden = deckOf !== 'mandarin';
    b.textContent = simplified(deckOf) ? '简' : '繁';
    b.setAttribute('aria-label', simplified(deckOf) ? 'Simplified characters. Switch to Traditional' : 'Traditional characters. Switch to Simplified');
  }
  for (const n of document.querySelectorAll('[data-zh-src]')) {
    n.textContent = zs(n.dataset.zhSrc, n.dataset.zhDeck);
    n.setAttribute('lang', zl(n.dataset.zhDeck));
  }
}

function switchScriptView() {
  progress.settings.script = simplified('mandarin') ? 'hk' : 'cn';
  persist();
  syncScriptViews();
}

// The 繁/简 button at the top of every Mandarin card: switches all characters, on this card and from now on.
function scriptNow(c) {
  return c.char ? c.script : simplified(c.deck) ? 'cn' : 'hk';
}

function switchScript() {
  if (!session?.current) return;
  const { card, c } = session.current;
  progress.settings.script = scriptNow(c) === 'cn' ? 'hk' : 'cn';
  persist();
  if (c.char) {
    Object.assign(c, displayFor(c, progress.settings.script));
    Object.assign(c.words[0], displayFor(c.words[0], progress.settings.script));
  }
  // Keep the word you had open, now in the other script.
  const open = [...$('a-words').children].findIndex((b) => b.classList.contains('active'));
  drawCard(card, c);
  if (open >= 0) $('a-words').children[open]?.click();
}

// Everything on the card that shows characters; safe to call again mid-card.
function drawCard(card, c) {
  $('prompt').replaceChildren(...promptFor(card, c));
  if (!$('answer').hidden) document.querySelector('#prompt .hint-btn')?.remove();
  renderWords(c);
  renderSwap(c);
  showAccent();
  $('a-note').replaceChildren(...(c.note ? noteNodes(c.note, c.deck) : []));
  $('a-note').hidden = !c.note;
  $('a-example').hidden = !c.example;
  $('a-example').replaceChildren(...(c.example ? [el('p', { class: 'section' }, 'In a phrase you know'), sayLine(c.example, c.deck)] : []));
  // Word order: the rule behind the sentence, and after a build the English words in Chinese order.
  $('a-order').replaceChildren(...(c.order ? mixedText(c.order, c.deck) : []));
  $('a-order').hidden = !c.order;
  const literal = (c.build || c.activity === 'chain') && c.words.every((w) => w.gloss) ? c.words.map((w) => plainGloss(w.gloss)) : [];
  $('a-literal').replaceChildren(...literal.flatMap((g, i) => [...(i ? [el('i', {}, '·')] : []), el('span', {}, g)]));
  $('a-literal').hidden = !literal.length;
  $('card-register').textContent = REGISTER_LABEL[c.register] || '';
  $('card-register').hidden = !c.register;
  const now = scriptNow(c);
  const label = now === 'cn' ? 'Simplified characters. Switch to Traditional' : 'Traditional characters. Switch to Simplified';
  const sw = $('script-switch');
  sw.hidden = c.deck !== 'mandarin';
  sw.textContent = now === 'cn' ? '简' : '繁';
  sw.setAttribute('aria-label', label);
  // The same switch sits with the answer's buttons, in reach once the answer is showing.
  const tool = $('script-tool');
  tool.hidden = c.deck !== 'mandarin';
  tool.replaceChildren(el('span', { class: now === 'cn' ? '' : 'on' }, '繁'), el('span', { class: now === 'cn' ? 'on' : '' }, '简'));
  tool.setAttribute('aria-label', label);
}

function promptFor(card, c) {
  const lang = zl(c.deck);
  if (c.build) return renderBuild(c);
  if (c.activity === 'echo') return [el('p', { class: 'prompt-en' }, c.en), el('p', { class: 'muted' }, 'Listen, then say it out loud')];
  if (c.activity === 'chain') {
    // The whole sentence, with the part not reached yet dimmed: it grows from the end.
    const on = c.words.length - c.steps[c.step].length;
    return [
      el('p', { class: 'prompt-en' }, c.en),
      el('div', { class: 'chain' }, ...c.words.map((w, i) => el('span', { class: `chain-w${i < on ? ' off' : ''}` },
        renderRoman(el('span', { class: 'chain-roman' }), w.roman, c.deck), el('span', { class: 'chain-zh', lang }, zs(w.zh, c.deck))))),
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play this part', onclick: () => playStep(c) }, icon('play')),
      el('p', { class: 'muted' }, 'Say the bright part out loud'),
    ];
  }
  if (c.activity === 'ear') {
    return [
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play again', onclick: () => playCurrent({ next: true }) }, icon('play')),
      el('p', { class: 'speaker' }),
      optionButtons(c, (o) => [o.text]),
    ];
  }
  if (c.activity === 'match') {
    return [
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play again', onclick: () => playCurrent({ next: true }) }, icon('play')),
      el('p', { class: 'speaker' }),
      el('p', { class: 'prompt-en' }, c.claim),
      optionButtons(c, (o) => [o.text]),
    ];
  }
  if (c.activity === 'tone') {
    return [
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play again', onclick: () => playCurrent({ next: true }) }, icon('play')),
      el('p', { class: 'speaker' }),
      el('p', { class: 'prompt-gap-roman' }, ...c.words.flatMap((w, i) => [
        ...(i ? [' '] : []),
        el('span', { class: w === c.toneWord ? 'tone-target' : 'tone-rest' }, noTones(w.roman)),
      ])),
      optionButtons(c, (o) => [renderRoman(el('span'), o.roman, c.deck)]),
    ];
  }
  if (c.activity === 'pairs') return renderPairs(c);
  if (c.activity === 'fill') {
    return [
      el('button', { class: 'icon-btn huge', 'aria-label': 'Play again', onclick: () => playCurrent({ next: true }) }, icon('play')),
      el('p', { class: 'speaker' }),
      el('p', { class: 'prompt-gap-roman' }, ...c.words.flatMap((w, i) => [
        ...(i ? [' '] : []),
        w.zh === c.gap && !c.result ? el('span', { class: 'gap' }, '＿＿') : renderRoman(el('span'), w.roman, c.deck),
      ])),
      optionButtons(c, (o) => [renderRoman(el('span'), o.word.roman, c.deck)]),
    ];
  }
  if (c.char) {
    return [
      el('p', { class: 'prompt-char', lang: SCRIPT_LANG[c.script] || lang }, c.zhDisp),
      el('span', { class: `script-badge script-${c.script}` }, SCRIPT_LABEL[c.script] || ''),
      el('p', { class: 'muted' }, 'Say it out loud'),
      hintButton(c),
    ];
  }
  if (c.drill === 'gap') {
    // The sentence in pinyin with the missing word blanked; characters only when practising reading.
    const words = c.context.words;
    const romanGap = el('p', { class: 'prompt-gap-roman' }, ...words.flatMap((w, i) => [
      ...(i ? [' '] : []),
      w.zh === c.target ? el('span', { class: 'gap' }, '＿＿') : renderRoman(el('span'), w.roman, c.deck),
    ]));
    const parts = [el('p', { class: 'prompt-en' }, c.context.en), romanGap];
    if (progress.settings.reading) {
      parts.push(el('p', { class: 'prompt-gap', lang }, ...words.map((w) => (w.zh === c.target ? el('span', { class: 'gap' }, '＿＿') : zs(w.zh, c.deck)))));
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
  if (card.type === 'read') return [el('p', { class: 'prompt-zh', lang }, zs(c.zh, c.deck))];
  return [
    el('button', { class: 'icon-btn huge', 'aria-label': 'Play, then next voice', onclick: () => playCurrent({ next: true }) }, icon('play')),
    el('p', { class: 'speaker' }),
  ];
}

function startSession(queue, { convo = null } = {}) {
  if (!queue.length) return;
  session = {
    queue, pos: 0, total: queue.length, done: 0, right: 0, graded: 0,
    startedAt: Date.now(), before: snapshot(progress), convo, shown: {}, used: {},
  };
  show('study');
  showCard();
}

function startToday() {
  const tiles = decks[deck()]?.characters !== false;
  const queue = withActivities({ queue: todayPlan().queue, items: items(), progress, stats: methodStats(progress.log), deck: deck(), tiles });
  startSession(queue, { convo: readyConversation() });
}

// Phrases of this deck you have met, other than this one: the wrong answers in the listening games.
function metPhrases(exceptId) {
  return items().filter((i) => i.id !== exceptId && progress.cards[`${i.id}:say`]);
}

// Another way to practise a phrase that just went wrong, chosen by what has worked before.
function practiceFor(id) {
  const item = byId[id];
  const tiles = decks[item.deck]?.characters !== false && item.kind !== 'word';
  // Not the way it was already practised in this session, if there is another.
  const all = applicable(item.fills?.[0] || item, metPhrases(id).length, { tiles, tones: item.deck === 'mandarin' });
  const fresh = all.filter((m) => !session.used[id]?.includes(m));
  const method = pickMethod(methodStats(progress.log), fresh.length ? fresh : all);
  (session.used[id] ||= []).push(method);
  return { key: `${id}:${method}`, id, type: method, deck: item.deck, ...(ACTIVITIES.includes(method) ? { activity: true } : {}) };
}

const shuffled = (list) => list.map((x) => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

const noTones = (roman) => roman.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/g, '').normalize('NFC').replace(/-/g, '');

// Match the pairs: four phrases on one card, sounds on the left, meanings on the right.
function pairsContent(card) {
  const rows = card.ids.map((id) => {
    const item = byId[id];
    const entry = item.kind === 'pattern' ? pickFill(item, progress) : item;
    return { id, entry, voice: pickVoice(entry), missed: false, done: false };
  });
  return {
    activity: 'pairs', rows, meanings: shuffled(rows), picked: null, zh: '', roman: '', en: '', words: [], audio: null, voice: null,
    played: false, deck: byId[card.id].deck, flagged: new Set(), ...tracking(),
  };
}

function activityContent(card, item) {
  if (card.type === 'pairs') return pairsContent(card);
  const entry = item.kind === 'pattern' ? pickFill(item, progress) : item;
  const c = {
    activity: card.type, zh: entry.zh, roman: entry.roman, en: entry.en, words: entry.words, audio: entry.audio,
    voice: pickVoice(entry), played: false, note: item.note, register: item.register, swap: item.swap, order: item.order,
    chunks: item.chunks, deck: item.deck, flagged: new Set(), ...tracking(),
  };
  if (card.type === 'chain') Object.assign(c, { steps: chainSteps(entry.words), step: 0 });
  if (card.type === 'ear') {
    const wrong = shuffled([...new Set(metPhrases(item.id).map((i) => (i.fills?.[0] || i).en))].filter((en) => en !== entry.en)).slice(0, 3);
    c.options = shuffled([{ text: entry.en, right: true }, ...wrong.map((text) => ({ text, right: false }))]);
  }
  if (card.type === 'fill') {
    // Leave out a word that carries meaning: a known trouble spot if there is one, otherwise the longest.
    const weakest = (w) => progress.weak[`w/${item.deck}/${w.zh}`]?.score || 0;
    const gap = [...entry.words].sort((a, b) => weakest(b) - weakest(a) || b.roman.length - a.roman.length)[0];
    const pool = new Map();
    for (const i of metPhrases(item.id)) for (const e of i.fills || [i]) for (const w of e.words || []) pool.set(w.roman, w);
    for (const w of entry.words) pool.delete(w.roman);
    c.gap = gap.zh;
    c.options = shuffled([{ word: gap, right: true }, ...shuffled([...pool.values()]).slice(0, 3).map((word) => ({ word, right: false }))]);
  }
  if (card.type === 'match') {
    const others = shuffled([...new Set(metPhrases(item.id).map((i) => (i.fills?.[0] || i).en))].filter((en) => en !== entry.en));
    const truth = Math.random() < 0.5 || !others.length;
    c.claim = truth ? entry.en : others[0];
    c.options = [{ text: 'Yes, that is it', right: truth }, { text: 'No, something else', right: !truth }];
  }
  if (card.type === 'tone') {
    // The word with the most tones to hear (never one that is all neutral, if there is a choice).
    const voiced = (w) => toneSeq(w.roman).filter((t) => t !== 5).length;
    c.toneWord = [...entry.words].sort((a, b) => voiced(b) - voiced(a))[0];
    c.options = toneOptions(c.toneWord.roman).map((roman) => ({ roman, right: roman === c.toneWord.roman }));
  }
  if (card.type === 'dictate') Object.assign(c, { build: true, entry, tiles: tiles(entry, chars()), picked: [], tries: 0, result: null });
  return c;
}

// The part of the sentence being built up right now, said by its own recording (or the phone's voice).
function playStep(c, slow = false) {
  const part = c.steps[c.step];
  if (part.length === c.words.length) return playCurrent({ slow });
  const src = c.chunks?.[part.length];
  if (src) play(src, slow ? 0.75 : 1);
  else speakText(part.map((w) => w.zh).join(''), c.deck, slow ? 0.55 : 0.85);
}

function renderPairs(c) {
  const draw = () => box.replaceChildren(
    el('div', { class: 'pairs-col' }, ...c.rows.map((r, n) => {
      const b = el('button', { class: `pair pair-sound${r.done ? ' done' : ''}${c.picked === r ? ' on' : ''}` }, icon('play'), el('span', {}, String(n + 1)));
      b.addEventListener('click', () => {
        play(r.entry.audio[r.voice][0]);
        if (r.done) return;
        c.picked = r;
        draw();
      });
      return b;
    })),
    el('div', { class: 'pairs-col' }, ...c.meanings.map((r) => {
      const b = el('button', { class: `pair pair-meaning${r.done ? ' done' : ''}` }, r.entry.en);
      b.addEventListener('click', () => {
        if (r.done || !c.picked) return;
        if (c.picked === r) {
          r.done = true;
          c.picked = null;
          draw();
          if (c.rows.every((x) => x.done)) finishActivity(c.rows.some((x) => x.missed) ? 2 : 3);
          return;
        }
        c.picked.missed = true;
        b.classList.add('wrong');
        setTimeout(() => b.classList.remove('wrong'), 500);
      });
      return b;
    }))
  );
  const box = el('div', { class: 'pairs' });
  draw();
  return [el('p', { class: 'muted' }, 'Tap a sound, then its meaning'), box];
}

function optionButtons(c, label) {
  return el('div', { class: 'opts' }, ...c.options.map((o) => {
    const b = el('button', { class: 'opt' }, ...label(o));
    b.dataset.right = o.right ? '1' : '';
    b.addEventListener('click', () => {
      if (c.result) return;
      b.classList.add(o.right ? 'right' : 'wrong');
      // Tone answers also feed the tone statistics, like the tone check does.
      if (c.activity === 'tone') scoreAnswer(progress.tones, c.toneWord.roman, o.roman, (progress.toneConfusions ||= {}));
      finishActivity(o.right ? 3 : 1);
    });
    return b;
  }));
}

// An activity is over: show the sentence, say it, and wait for Continue. Nothing is graded by hand.
function finishActivity(rating) {
  const { c } = session.current;
  if (c.result) return;
  c.result = rating;
  c.revealMs = Math.round(performance.now() - c.shownAt);
  for (const b of document.querySelectorAll('#prompt .opt')) if (b.dataset.right) b.classList.add('right');
  $('answer').hidden = false;
  $('reveal').hidden = true;
  $('continue').hidden = false;
  if (c.activity === 'pairs') {
    $('a-example').hidden = false;
    $('a-example').replaceChildren(...c.rows.map((r) => sayLine(r.entry, c.deck)));
    return;
  }
  playCurrent();
}

function showCard() {
  if (session.pos >= session.queue.length) return finishSession();
  const card = session.queue[session.pos];
  const c = contentFor(card);
  session.current = { card, c };

  $('card-kind').textContent = c.activity ? { echo: 'Listen and repeat', chain: 'Build it up', ear: 'What did you hear?', fill: 'Which word is missing?', match: 'Is this what you hear?', tone: 'Which tones?', dictate: 'Rebuild it by ear', pairs: 'Match the pairs' }[c.activity]
    : c.build ? 'Build the sentence'
    : c.char ? 'Read it'
    : c.drill
    ? 'Trouble spot'
    : c.level === 'situation' ? 'What would you say?'
    : c.level === 'speed' ? 'Speed round: say it before the bar runs out'
    : { say: `Say it in ${LANG_NAME[c.deck]}`, listen: 'What does this mean?', read: 'Read it aloud' }[card.type];
  // The dot before the card's title shows how this phrase is going (as in All phrases).
  const lvlId = card.ids ? null : card.id;
  if (lvlId && byId[lvlId] && !lvlId.startsWith('w/') && !lvlId.startsWith('c/')) $('card-kind').dataset.lvl = strengthOf(progress, lvlId);
  else delete $('card-kind').dataset.lvl;
  $('answer').hidden = true;
  drawCard(card, c);
  if (!c.drill && card.type === 'listen') playCurrent();

  $('rec').hidden = !canRecord();
  $('rec').replaceChildren(icon('mic'));
  $('rec').classList.remove('recording');
  $('rec-row').hidden = true;
  $('a-en').textContent = c.en;
  $('a-en').hidden = (card.type === 'say' && c.level !== 'situation' && !c.drill) || (c.build && !c.activity) || ['echo', 'chain', 'pairs'].includes(c.activity);
  $('continue').hidden = true;
  $('reveal').textContent = c.activity === 'chain' ? 'Next part' : c.build ? "I'm stuck, show me" : c.activity ? "I don't know" : 'Show answer';
  $('reveal').hidden = false;
  $('grades').hidden = true;
  $('which').hidden = true;
  for (const g of document.querySelectorAll('#grades .grade')) g.classList.remove('picked');

  if (c.activity === 'echo') finishActivity(3);
  else if (c.activity === 'chain') playStep(c);
  else if (c.activity === 'pairs') $('reveal').hidden = true;
  else if (c.activity) playCurrent();

  // Every card moves the counter on; a card that comes back later adds one to the total.
  $('progress-bar').style.width = `${(session.pos / session.queue.length) * 100}%`;
  $('progress-text').textContent = `${session.pos + 1} of ${session.queue.length}`;
}

function reveal() {
  if (!session || !$('answer').hidden) return;
  if (session.current.c.build) return finishBuild(1);
  if (session.current.c.activity === 'chain') {
    const { card, c } = session.current;
    c.step += 1;
    $('prompt').replaceChildren(...promptFor(card, c));
    return c.step === c.steps.length - 1 ? finishActivity(3) : playStep(c);
  }
  if (session.current.c.activity) return finishActivity(1);
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
    document.querySelector('#which .sheet-q').textContent = session.current.card.type === 'read' ? "Which word couldn't you read?" : 'Which part tripped you up?';
    $('which').hidden = false;
    return;
  }
  commit(rating);
}

function commit(rating) {
  const { card, c } = session.current;
  const now = new Date();
  if (c.activity === 'pairs') {
    for (const r of c.rows) logActivity(progress, r.id, 'pairs', r.missed ? 1 : 3, now, c.revealMs);
    persist();
    session.pos += 1;
    session.done += 1;
    return showCard();
  }
  if (c.activity) {
    logActivity(progress, card.id, c.activity, rating, now, c.revealMs);
    if (!session.used[card.id]?.includes(c.activity)) (session.used[card.id] ||= []).push(c.activity);
    persist();
    session.pos += 1;
    session.done += 1;
    return showCard();
  }
  const state = grade(progress.cards[card.key] || null, rating, now);
  applyReview(progress, card, rating, state, now, {
    ms: c.revealMs, voice: c.voice, replays: c.replays, lookups: [...c.lookups], hint: c.hint,
  });
  // Reading, not speaking. "Almost" neither flags the word nor counts toward its recovery.
  if (c.char) { if (rating !== 2) markReading(progress, c.deck, c.zh, rating >= 3, now); }
  else if (rating >= 3) credit(progress, c.deck, c.drill ? [{ zh: c.target }] : c.words, now);
  for (const zh of c.flagged) {
    // On a read-aloud card the problem is reading the characters, not saying the word.
    if (card.type === 'read') {
      markReading(progress, c.deck, zh, false, now);
      continue;
    }
    // A newly missed word gets a practice card straight away, shown again later in this session.
    const id = flagWord(progress, c.deck, zh, now);
    const key = `${id}:say`;
    if (!progress.cards[key]) progress.cards[key] = grade(null, 1, now);
    drills();
    if (session.pos < SESSION_CAP && !session.queue.slice(session.pos + 1).some((q) => q.key === key)) session.queue.push({ key, id, type: 'say', deck: c.deck });
  }
  persist();
  session.graded += 1;
  if (rating >= 3) session.right += 1;
  session.pos += 1;
  // A card comes back once at most, and not at all once the session is long. A phrase that went wrong is
  // first practised another way, then asked again.
  const shown = (session.shown[card.key] = (session.shown[card.key] || 0) + 1);
  if (shouldRequeue(state, now) && mayReturn(shown, session.pos)) {
    const phrase = card.type === 'say' && !card.id.startsWith('w/') && byId[card.id];
    if (rating < 3 && phrase) session.queue.push(practiceFor(card.id));
    session.queue.push(card);
  } else session.done += 1;
  showCard();
}

// Has what the session leans on changed? One short line per change, kept for the day.
function checkMethods() {
  const { state, news } = methodNews(methodStats(progress.log), progress.methodState);
  progress.methodState = state;
  if (news.length) progress.methodNews = { date: localDate(new Date()), lines: news };
  return news;
}

function finishSession() {
  const s = session;
  session = null;
  const news = checkMethods();
  persist();
  const results = {
    cards: s.graded,
    minutes: Math.max(1, Math.round((Date.now() - s.startedAt) / 60000)),
    pct: s.graded ? Math.round((100 * s.right) / s.graded) : 0,
    ...outcome(s.before, progress, allItems, deck()),
    news,
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
  for (const line of r.news || []) changes.push(el('div', { class: 'change' }, icon('target'), el('span', {}, line)));
  const soon = dueSoon(progress, items(), new Date());
  changes.push(el('div', { class: 'change info' }, icon('calendar'), el('span', {}, soon ? `Tomorrow: ${soon} review${soon === 1 ? '' : 's'}, ${minutes(estimateMinutes(soon))}` : 'Nothing due tomorrow. Enjoy the day off.')));
  $('done-changes').replaceChildren(el('p', { class: 'section' }, 'What changed'), ...changes);
}

// ---------- explore

function renderExplore() {
  const weekly = deck() === 'mandarin' ? items() : [];
  $('explore-weeks').replaceChildren(...lessonWeeks(weekly).map((w) => {
    const list = weekly.filter((i) => i.week === w && !i.id.startsWith('w/') && !i.id.startsWith('c/'));
    const solid = list.filter((i) => (progress.cards[`${i.id}:say`]?.stability || 0) >= 7).length;
    return el('button', { class: 'convo-row', onclick: () => startSession(weekQueue(weekly, progress, w)) },
      icon('list'), el('span', {}, `Week ${w} lesson`), el('span', { class: 'muted' }, `${solid} of ${list.length} solid`));
  }));
  $('explore-convos').replaceChildren(...conversations.filter((c) => c.deck === deck()).map((c) => {
    const st = convoStatus(c, progress);
    const status = st.done ? `done ${st.done}×` : st.ready ? 'ready' : `${st.learned} of ${st.total} lines met`;
    return el('button', { class: `convo-row${st.ready ? ' ready' : ''}`, onclick: () => startConvo(c) }, icon('chat'), el('span', {}, c.title), el('span', { class: 'muted' }, status));
  }));
  const orderQ = decks[deck()]?.characters === false ? [] : orderQueue(items(), progress, deck());
  $('order-row').hidden = decks[deck()]?.characters === false;
  $('order-sub').textContent = orderQ.length ? `${orderQ.length} sentences` : 'after a few phrases';
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

const LEVEL_NAME = { new: 'not met yet', learning: 'learning', hard: 'hard for you right now', solid: 'solid' };
function levelDot(id) {
  const lvl = strengthOf(progress, id);
  return el('i', { class: `lvl lvl-${lvl}`, role: 'img', 'aria-label': LEVEL_NAME[lvl] });
}

function rowParts(entry, d, badge) {
  return [
    el('span', { class: 'zh-s', lang: zl(d) }, ...(entry.id ? [levelDot(entry.id)] : []), zs(entry.zh, d), ...(badge ? [el('span', { class: 'badge' }, badge)] : [])),
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
  const tones = d === 'cantonese' ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  $('browse-legend').replaceChildren(
    el('span', {}, ...['solid', 'learning', 'hard', 'new'].flatMap((l) => [el('i', { class: `lvl lvl-${l}` }), `${LEVEL_NAME[l]}  `])),
    el('span', {}, 'Letter colours are tones: ', ...tones.flatMap((t) => [el('b', { class: `${d === 'cantonese' ? 'jtone' : 'tone'}${t}` }, d === 'mandarin' && t === 5 ? 'neutral' : `${t}`), ' ']))
  );
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
  const readable = new Set(chars().map((x) => x.zh));
  const reading = readingTrouble(progress, d).filter((t) => readable.has(t.zh));
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
        const shown = info2 ? displayFor(info2, progress.settings.script) : { script: 'hk', zhDisp: t.zh };
        const disp = shown.zhDisp;
        const spotLang = SCRIPT_LANG[shown.script] || LANG_ATTR[d];
        return el('button', { class: 'spot read-spot', onclick: () => speakWord(t.zh, d) },
          el('span', { class: 'spot-zh', lang: spotLang }, disp),
          ...(shown.script === 'cn' ? [el('span', { class: 'script-badge script-cn small' }, '简')] : []),
          el('small', {}, info2 ? `${info2.roman.replace(/-/g, '')} · ${info2.gloss}` : ''));
      })),
      el('button', { class: 'btn small', onclick: () => startSession(reading.map((t) => ({ key: `${charId(d, t.zh)}:char`, id: charId(d, t.zh), type: 'char', deck: d }))) }, `Practise reading ${reading.length}`),
    ] : []),
    ...whatWorks()
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

// How often a phrase was said right on a later day, by what was done with it before. Methods that clearly
// trail are dropped from the daily session.
function whatWorks() {
  const stats = methodStats(progress.log);
  const out = new Set(dropped(stats));
  const rows = [...METHODS, 'none'].filter((m) => stats[m]?.n).sort((a, b) => stats[b].ok / stats[b].n - stats[a].ok / stats[a].n);
  if (!rows.length) return [];
  return [
    el('p', { class: 'section' }, 'What works for you'),
    el('div', { class: 'works' }, ...rows.map((m) => {
      const { n, ok } = stats[m];
      const pct = Math.round((100 * ok) / n);
      return el('div', { class: `works-row${out.has(m) ? ' dropped' : ''}` },
        el('span', { class: 'works-name' }, METHOD_NAME[m]),
        el('span', { class: 'works-bar' }, el('i', { style: `width:${pct}%` })),
        el('span', { class: 'works-n' }, out.has(m) ? 'dropped' : `${pct}% of ${n}`));
    })),
    el('p', { class: 'muted small' }, 'Said right on a later day'),
  ];
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
  $('script').value = progress.settings.script || 'auto';
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
  $('more').addEventListener('click', () => { extraNew += decks[deck()]?.newPerDay || 5; startToday(); });
  $('quit').addEventListener('click', () => { session = null; show('home'); });
  $('reveal').addEventListener('click', reveal);
  $('script-switch').addEventListener('click', switchScript);
  $('script-tool').addEventListener('click', switchScript);
  for (const b of document.querySelectorAll('[data-script-view]')) b.addEventListener('click', switchScriptView);
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
  $('order-row').addEventListener('click', () => startSession(orderQueue(items(), progress, deck())));
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
  $('script').addEventListener('change', (e) => {
    progress.settings.script = e.target.value;
    persist();
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
  const ctx = { allItems: () => allItems, progress: () => progress, persist, show, byId: () => byId, decks: () => decks, zhNode, syncScriptViews };
  initTones(ctx);
  initConvo(ctx);
  $('tq-again').addEventListener('click', startTones);
  const res = await fetch('phrases.json');
  const data = await res.json();
  allItems = data.items;
  decks = data.decks;
  t2s = data.t2s || {};
  hanzi = data.hanzi || {};
  noteGloss = data.notes || {};
  conversations = data.conversations || [];
  version = data.version;
  byId = Object.fromEntries(allItems.map((i) => [i.id, i]));
  for (const i of allItems) if (i.kind !== 'pattern' && i.words?.length === 1 && i.audio) wordAudio[`${i.deck}/${i.words[0].zh}`] = i.audio;
  // One-time cleanup: speaking flags that really came from failed read-aloud cards become reading problems.
  if (!(progress.migrations || []).includes('reading-flags-v1')) {
    for (const d of Object.keys(decks)) reclassifyReadingFlags(progress, allItems, d, new Date());
    progress.migrations = [...(progress.migrations || []), 'reading-flags-v1'];
    persist();
  }
  await attachCoach();
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
    const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
    // Phones resume the app from the background without reloading, so look for a new version each time it's shown.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg?.update().catch(() => {});
    });
    const urls = allItems.flatMap((i) => [...(i.fills || [i]).flatMap((x) => Object.values(x.audio).flat()), ...Object.values(i.chunks || {})]);
    const send = () => navigator.serviceWorker.controller?.postMessage({ type: 'cache-audio', urls: [...new Set(urls)] });
    if (navigator.serviceWorker.controller) send();
    else navigator.serviceWorker.addEventListener('controllerchange', send, { once: true });
  }
}

init().catch((err) => {
  document.getElementById('app').replaceChildren(el('p', {}, `Could not load phrases: ${err.message}`));
});
