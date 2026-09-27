import { romanWords } from './lib/tones.js';
import { grade } from './lib/srs.js';
import { pickFill, pickVoice, nextVoice } from './lib/cards.js';
import { buildQueue, shouldRequeue } from './lib/session.js';
import { load, save, exportJSON, importJSON, applyReview, localDate } from './lib/store.js';
import { initBook, renderBook } from './book.js';
import { drillId, flagWord, credit, troubleSpots, drillItems, drillPrompt } from './lib/weak.js';
import { weekReadiness, daysUntil, canSay, pickMission, markMissionDone, missionDoneToday } from './lib/motivation.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LANG_NAME = { mandarin: 'Mandarin', cantonese: 'Cantonese' };
const LANG_ATTR = { mandarin: 'zh-Hant-TW', cantonese: 'zh-Hant-HK' };

const $ = (id) => document.getElementById(id);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const nullStorage = { getItem: () => null, setItem() {} };

let allItems = [];
let byId = {};
let voices = {}; // {voiceId: {flag, name}}
let decks = {}; // {deck: {label, voices}}
let version = '';
let progress = load(storage || nullStorage);
let extraNew = 0;
let missionSkip = 0;
let session = null; // { queue, pos, total, done, current: {card, c} }

const deck = () => (decks[progress.settings.deck] ? progress.settings.deck : 'mandarin');
const items = () => allItems.filter((i) => i.deck === deck());
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Deck items plus practice items for the current trouble spots (kept in byId so queued drills still resolve).
function studyItems() {
  const drills = drillItems(allItems, progress, deck());
  for (const d of drills) byId[d.id] = d;
  return [...items(), ...drills];
}

const audio = new Audio();
function play(src) {
  if (!src) return;
  audio.src = src;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

function persist() {
  save(storage || nullStorage, progress);
}

// ---------- rendering helpers

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function renderRoman(target, text, d) {
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

function voiceFlag(id) {
  return voices[id]?.flag || '';
}

function renderDeckSwitch() {
  for (const box of document.querySelectorAll('.deck-switch')) {
    box.replaceChildren(
      ...Object.entries(decks).map(([d, cfg]) =>
        el(
          'button',
          {
            class: `deck-btn${d === deck() ? ' active' : ''}`,
            lang: LANG_ATTR[d],
            onclick: () => {
              progress.settings.deck = d;
              extraNew = 0;
              persist();
              show(document.querySelector('.tab.active')?.dataset.go || 'home');
            },
          },
          cfg.label
        )
      )
    );
  }
}

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === view);
  document.body.classList.toggle('studying', view === 'study');
  renderDeckSwitch();
  if (view === 'home') renderHome();
  if (view === 'browse') renderBrowse();
  if (view === 'settings') renderSettings();
  if (view === 'book') renderBook();
  window.scrollTo(0, 0);
}

// ---------- home

function newLimit() {
  return progress.settings.newPerDay + extraNew;
}

function renderHome() {
  const now = new Date();
  const list = items();
  const queue = buildQueue(studyItems(), progress, now, newLimit(), deck());
  const fresh = queue.filter((c) => !progress.cards[c.key]).length;
  $('due-count').textContent = queue.length;
  $('due-label').textContent = queue.length
    ? `${LANG_NAME[deck()]} cards today · ${queue.length - fresh} review, ${fresh} new`
    : `All ${LANG_NAME[deck()]} done for today`;
  $('start').hidden = queue.length === 0;
  const unseen = list.some((i) => !progress.cards[`${i.id}:say`]);
  $('more').hidden = queue.length > 0 || !unseen;

  const s = progress.stats;
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const alive = s.lastStudyDate === localDate(now) || s.lastStudyDate === yesterday;
  $('streak').textContent = alive && s.streak ? `🔥 ${s.streak} day${s.streak === 1 ? '' : 's'}` : '';

  const learned = list.filter((i) => progress.cards[`${i.id}:say`]?.state === 2).length;
  const seen = list.filter((i) => progress.cards[`${i.id}:say`]).length;
  $('learned').textContent = `${learned} learned · ${seen} seen · ${list.length} total`;

  const totalSeen = allItems.filter((i) => progress.cards[`${i.id}:say`]).length;
  const stale = !progress.lastExport || now - new Date(progress.lastExport) > WEEK_MS;
  $('export-banner').hidden = !(stale && totalSeen >= 10);
  renderDash(list, now);
}

function dashCard(title, ...children) {
  return el('section', { class: 'dash-card' }, el('h3', {}, title), ...children);
}

function renderDash(list, now) {
  const lang = LANG_ATTR[deck()];
  const parts = [];

  // Coach readiness (Mandarin weeks only)
  const r = deck() === 'mandarin' ? weekReadiness(list, progress) : null;
  if (r) {
    const day = progress.settings.lessonDay;
    const n = day == null ? null : daysUntil(day, now);
    const when = n == null ? el('button', { class: 'link', 'data-go': 'settings' }, 'Set your lesson day')
      : n === 0 ? 'Lesson today' : `Lesson in ${n} day${n === 1 ? '' : 's'} (${WEEKDAYS[day]})`;
    parts.push(dashCard(
      `Ready for the coach · Week ${r.week}`,
      el('div', { class: 'meter' }, el('div', { class: 'meter-fill', style: `width:${(100 * r.solid) / r.total}%` })),
      el('p', { class: 'dash-line' }, `${r.solid} of ${r.total} cards solid · `, when)
    ));
  }

  // Real-life mission
  const done = missionDoneToday(progress, now);
  const m = done ? null : pickMission(list, progress, now, missionSkip);
  if (done) {
    parts.push(dashCard('Today\'s mission', el('p', { class: 'dash-line' }, `✓ Done. ${progress.missions.length} mission${progress.missions.length === 1 ? '' : 's'} so far.`)));
  } else if (m) {
    parts.push(dashCard(
      'Today\'s mission',
      el('p', { class: 'mission' }, m.mission),
      el('p', { class: 'mission-zh', lang }, m.zh.replace('___', '…')),
      el('div', { class: 'button-row' },
        el('button', { class: 'primary', onclick: () => { markMissionDone(progress, m.id, new Date()); persist(); renderHome(); } }, 'I did it'),
        el('button', { class: 'secondary', onclick: () => { missionSkip += 1; renderHome(); } }, 'Another one'))
    ));
  } else {
    parts.push(dashCard('Today\'s mission', el('p', { class: 'dash-line hint' }, 'Missions appear once phrases are solid (said right on two different days).')));
  }

  // Trouble spots
  const spots = troubleSpots(progress, deck());
  if (spots.length) {
    const drills = studyItems().filter((i) => i.kind === 'drill');
    const info = Object.fromEntries(drills.map((d) => [d.zh, d]));
    parts.push(dashCard(
      'Trouble spots',
      el('div', { class: 'spots' }, ...spots.slice(0, 8).map((t) =>
        el('span', { class: 'spot' }, el('span', { lang }, t.zh), ' ', el('span', { class: 'hint' }, info[t.zh]?.gloss || '')))),
      el('button', { class: 'secondary', onclick: () => startSession(drills.map((d) => ({ key: `${d.id}:say`, id: d.id, type: 'say', deck: d.deck }))) },
        `Practise ${drills.length} now`)
    ));
  }

  // What I can say
  const groups = canSay(list, progress);
  if (groups.length) {
    const total = groups.reduce((n, g) => n + g.solid, 0);
    parts.push(dashCard(
      `What I can say · ${total}`,
      ...groups.map((g) => el('details', { class: 'can' },
        el('summary', {}, el('span', {}, g.topic), el('span', { class: 'hint' }, ` ${g.solid}/${g.total}`)),
        el('ul', {}, ...g.items.map((i) => el('li', { class: i.solid ? 'solid' : '' },
          i.solid ? '✓ ' : '· ', el('span', { lang }, i.zh.replace('___', '…')), el('span', { class: 'hint' }, ` ${i.en.replace('___', '…')}`))))))
    ));
  }
  $('dash').replaceChildren(...parts);
}

// ---------- study

function contentFor(card) {
  const item = byId[card.id];
  if (item.kind === 'drill') {
    const p = drillPrompt(item);
    const word = { zh: item.zh, roman: item.roman, gloss: item.gloss };
    const src = p.mode === 'gap' ? p.context : { words: [word], audio: item.audio || item.contexts[0]?.audio };
    return {
      drill: p.mode, target: item.zh, context: p.context, zh: item.zh, en: item.gloss,
      words: src.words, audio: src.audio, voice: pickVoice(src), played: false, deck: item.deck, flagged: new Set(),
    };
  }
  const src = item.kind === 'pattern' ? pickFill(item, progress) : item;
  return {
    zh: src.zh, roman: src.roman, en: src.en, words: src.words, audio: src.audio,
    voice: pickVoice(src), played: false, note: item.note, deck: item.deck, flagged: new Set(),
  };
}

function showFlag() {
  const flag = voiceFlag(session.current.c.voice);
  $('voice-flag').textContent = flag;
  const speaker = document.querySelector('#prompt .speaker');
  if (speaker) speaker.textContent = flag;
}

// First play uses the card's voice; each further tap on 🔊 moves to the next speaker.
function playCurrent({ slow = false, next = false } = {}) {
  const c = session?.current?.c;
  if (!c) return;
  if (next && c.played) c.voice = nextVoice(c, c.voice);
  c.played = true;
  showFlag();
  play(c.audio[c.voice][slow ? 1 : 0]);
}

// Answer shown word by word. Tap a word for its meaning; mark it as missed to practise it later.
function renderWords(c) {
  const lang = LANG_ATTR[c.deck];
  const gloss = $('a-gloss');
  gloss.hidden = true;
  const multi = c.words.length > 1 || c.drill;
  $('a-words').replaceChildren(
    ...c.words.map((w) => {
      const btn = el(
        'button',
        { class: `wg${w.zh === c.target && c.drill === 'gap' ? ' target' : ''}`, 'aria-label': `${w.zh}: ${w.gloss}` },
        el('span', { class: 'wg-zh', lang }, w.zh),
        renderRoman(el('span', { class: 'wg-roman' }), w.roman, c.deck)
      );
      btn.addEventListener('click', () => {
        const wasActive = btn.classList.contains('active');
        for (const b of $('a-words').children) b.classList.remove('active');
        gloss.hidden = wasActive;
        if (wasActive) return;
        btn.classList.add('active');
        const parts = [el('b', { lang }, w.zh), ` = ${w.gloss}`];
        if (multi) {
          const miss = el('button', { class: `miss${c.flagged.has(w.zh) ? ' on' : ''}` }, c.flagged.has(w.zh) ? '✗ Missed' : 'I missed this');
          miss.addEventListener('click', () => {
            if (c.flagged.has(w.zh)) c.flagged.delete(w.zh);
            else c.flagged.add(w.zh);
            btn.classList.toggle('missed', c.flagged.has(w.zh));
            miss.classList.toggle('on', c.flagged.has(w.zh));
            miss.textContent = c.flagged.has(w.zh) ? '✗ Missed' : 'I missed this';
          });
          parts.push(miss);
        }
        gloss.replaceChildren(...parts);
      });
      return btn;
    })
  );
}

function promptFor(card, c) {
  const lang = LANG_ATTR[c.deck];
  if (c.drill === 'gap') {
    return [
      el('p', { class: 'prompt-en' }, c.context.en),
      el('p', { class: 'prompt-gap', lang }, ...c.context.words.map((w) => (w.zh === c.target ? el('span', { class: 'gap' }, '＿＿') : w.zh))),
    ];
  }
  if (c.drill === 'word') return [el('p', { class: 'prompt-en' }, c.en), el('p', { class: 'hint' }, 'one word')];
  if (card.type === 'say') return [el('p', { class: 'prompt-en' }, c.en)];
  if (card.type === 'read') return [el('p', { class: 'prompt-zh', lang }, c.zh)];
  return [
    el('button', { class: 'prompt-audio audio-btn', 'aria-label': 'Play, then next voice', onclick: () => playCurrent({ next: true }) }, '🔊'),
    el('p', { class: 'speaker' }),
  ];
}

function startSession(queueOverride) {
  const queue = queueOverride || buildQueue(studyItems(), progress, new Date(), newLimit(), deck());
  if (!queue.length) return;
  session = { queue, pos: 0, total: queue.length, done: 0 };
  show('study');
  showCard();
}

function showCard() {
  if (session.pos >= session.queue.length) return finishSession();
  const card = session.queue[session.pos];
  const c = contentFor(card);
  session.current = { card, c };

  $('card-kind').textContent = c.drill
    ? 'Trouble spot'
    : { say: `Say it in ${LANG_NAME[c.deck]}`, listen: 'What does this mean?', read: 'Read it aloud' }[card.type];
  $('prompt').replaceChildren(...promptFor(card, c));
  if (!c.drill && card.type === 'listen') playCurrent();

  renderWords(c);
  showFlag();
  $('a-en').textContent = c.en;
  $('a-en').hidden = card.type === 'say'; // already shown as the prompt (drills are say cards too)
  $('a-note').textContent = c.note || '';
  $('a-note').hidden = !c.note;
  $('answer').hidden = true;
  $('reveal').hidden = false;
  $('grades').hidden = true;

  const pct = (session.done / Math.max(session.total, session.done + 1)) * 100;
  $('progress-bar').style.width = `${pct}%`;
  $('progress-text').textContent = `${session.queue.length - session.pos} left`;
}

function reveal() {
  if (!session || !$('answer').hidden) return;
  $('answer').hidden = false;
  $('reveal').hidden = true;
  $('grades').hidden = false;
  if (session.current.card.type !== 'listen') playCurrent();
}

function rate(rating) {
  if (!session || $('grades').hidden) return;
  const { card, c } = session.current;
  const now = new Date();
  const state = grade(progress.cards[card.key] || null, rating, now);
  applyReview(progress, card, rating, state, now);
  if (rating >= 3) credit(progress, c.deck, c.drill ? [{ zh: c.target }] : c.words.filter((w) => !c.flagged.has(w.zh)), now);
  for (const zh of c.flagged) {
    // A newly missed word gets a practice card straight away, shown again later in this session.
    const id = flagWord(progress, c.deck, zh, now);
    const key = `${id}:say`;
    if (!progress.cards[key]) progress.cards[key] = grade(null, 1, now);
    studyItems();
    if (!session.queue.slice(session.pos + 1).some((q) => q.key === key)) session.queue.push({ key, id, type: 'say', deck: c.deck });
  }
  persist();
  session.pos += 1;
  if (shouldRequeue(state, now)) session.queue.push(card);
  else session.done += 1;
  showCard();
}

function finishSession() {
  const n = session.done;
  session = null;
  $('done-text').textContent = `${n} card${n === 1 ? '' : 's'} done. See you tomorrow!`;
  show('done');
}

// ---------- browse

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

function groupLabel(item) {
  return item.set || `Week ${item.week}`;
}

function renderBrowse() {
  const list = items();
  const d = deck();
  // Newest group first: groups ordered by where they first appear in the data, reversed.
  const labels = [...new Set(list.map(groupLabel))].reverse();
  $('browse-list').replaceChildren(
    ...labels.map((label) =>
      el(
        'div',
        { class: 'week' },
        el('h3', {}, label),
        ...list
          .filter((i) => groupLabel(i) === label)
          .map((i) => {
            if (i.kind !== 'pattern') return browseRow(i, d);
            return el(
              'details',
              { class: 'pattern' },
              el('summary', { class: 'row' }, ...rowParts(i, d, 'pattern')),
              el('div', { class: 'fills' }, ...i.fills.map((f) => browseRow(f, d)))
            );
          })
      )
    )
  );
}

// ---------- settings

function renderSettings() {
  $('new-per-day').value = progress.settings.newPerDay;
  $('lesson-day').value = progress.settings.lessonDay ?? '';
  $('last-export').textContent = progress.lastExport
    ? `Last export: ${new Date(progress.lastExport).toLocaleDateString()}`
    : 'Not exported yet.';
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
    if (go) show(go.dataset.go);
  });
  $('start').addEventListener('click', () => startSession());
  $('more').addEventListener('click', () => { extraNew += 5; startSession(); });
  $('quit').addEventListener('click', () => { session = null; show('home'); });
  $('reveal').addEventListener('click', reveal);
  $('play').addEventListener('click', () => playCurrent({ next: true }));
  $('play-slow').addEventListener('click', () => playCurrent({ slow: true }));
  for (const b of document.querySelectorAll('#grades button')) {
    b.addEventListener('click', () => rate(Number(b.dataset.rating)));
  }
  document.addEventListener('keydown', (e) => {
    if (!session || e.target.tagName === 'INPUT') return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); reveal(); }
    if (['1', '2', '3', '4'].includes(e.key)) rate(Number(e.key));
  });
  $('new-per-day').addEventListener('change', (e) => {
    const n = Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0));
    progress.settings.newPerDay = n;
    persist();
    renderSettings();
  });
  $('lesson-day').addEventListener('change', (e) => {
    progress.settings.lessonDay = e.target.value === '' ? null : Number(e.target.value);
    persist();
  });
  $('export').addEventListener('click', exportProgress);
  $('import').addEventListener('change', importProgress);
  $('reset').addEventListener('click', resetProgress);
}

async function init() {
  wire();
  initBook();
  const res = await fetch('phrases.json');
  const data = await res.json();
  allItems = data.items;
  voices = data.voices;
  decks = data.decks;
  version = data.version;
  byId = Object.fromEntries(allItems.map((i) => [i.id, i]));
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
