import { pinyinWords } from './lib/tones.js';
import { grade } from './lib/srs.js';
import { pickFill } from './lib/cards.js';
import { buildQueue, shouldRequeue } from './lib/session.js';
import { load, save, exportJSON, importJSON, applyReview, localDate } from './lib/store.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KIND_LABEL = { say: 'Say it in Mandarin', listen: 'What does this mean?', read: 'Read it aloud' };

const $ = (id) => document.getElementById(id);
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const nullStorage = { getItem: () => null, setItem() {} };

let items = [];
let byId = {};
let version = '';
let progress = load(storage || nullStorage);
let extraNew = 0;
let session = null; // { queue, pos, total, done, current: {card, item, content} }

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

function renderPinyin(target, pinyin) {
  const words = pinyinWords(pinyin).map((word) =>
    el('span', { class: 'w' }, ...word.map((s) => el('span', { class: `tone${s.tone}` }, s.text)))
  );
  target.replaceChildren(...words.flatMap((w, i) => (i ? [' ', w] : [w])));
  return target;
}

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${view}`;
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.go === view);
  document.body.classList.toggle('studying', view === 'study');
  if (view === 'home') renderHome();
  if (view === 'browse') renderBrowse();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}

// ---------- home

function newLimit() {
  return progress.settings.newPerDay + extraNew;
}

function renderHome() {
  const now = new Date();
  const queue = buildQueue(items, progress, now, newLimit());
  const fresh = queue.filter((c) => !progress.cards[c.key]).length;
  $('due-count').textContent = queue.length;
  $('due-label').textContent = queue.length
    ? `cards today · ${queue.length - fresh} review, ${fresh} new`
    : 'All done for today';
  $('start').hidden = queue.length === 0;
  const unseen = items.some((i) => !progress.cards[`${i.id}:say`]);
  $('more').hidden = queue.length > 0 || !unseen;

  const s = progress.stats;
  const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const alive = s.lastStudyDate === localDate(now) || s.lastStudyDate === yesterday;
  $('streak').textContent = alive && s.streak ? `🔥 ${s.streak} day${s.streak === 1 ? '' : 's'}` : '';

  const learned = items.filter((i) => progress.cards[`${i.id}:say`]?.state === 2).length;
  const seen = items.filter((i) => progress.cards[`${i.id}:say`]).length;
  $('learned').textContent = `${learned} learned · ${seen} seen · ${items.length} total`;

  const hasProgress = Object.keys(progress.cards).length > 0;
  const stale = !progress.lastExport || now - new Date(progress.lastExport) > WEEK_MS;
  $('export-banner').hidden = !(hasProgress && stale && seen >= 10);
}

// ---------- study

function contentFor(card) {
  const item = byId[card.id];
  const src = item.kind === 'pattern' ? pickFill(item, progress) : item;
  return { item, zh: src.zh, pinyin: src.pinyin, en: src.en, audio: src.audio, audioSlow: src.audioSlow, note: item.note };
}

function startSession() {
  const queue = buildQueue(items, progress, new Date(), newLimit());
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

  $('card-kind').textContent = KIND_LABEL[card.type];
  const prompt = $('prompt');
  if (card.type === 'say') {
    prompt.replaceChildren(el('p', { class: 'prompt-en' }, c.en));
  } else if (card.type === 'read') {
    prompt.replaceChildren(el('p', { class: 'prompt-zh', lang: 'zh-Hant-TW' }, c.zh));
  } else {
    prompt.replaceChildren(
      el('button', { class: 'prompt-audio audio-btn', 'aria-label': 'Play again', onclick: () => play(c.audio) }, '🔊')
    );
    play(c.audio);
  }

  $('a-zh').textContent = c.zh;
  renderPinyin($('a-pinyin'), c.pinyin);
  $('a-en').textContent = c.en;
  $('a-en').hidden = card.type === 'say'; // already shown as the prompt
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
  if (session.current.card.type !== 'listen') play(session.current.c.audio);
}

function rate(rating) {
  if (!session || $('grades').hidden) return;
  const { card } = session.current;
  const now = new Date();
  const state = grade(progress.cards[card.key] || null, rating, now);
  applyReview(progress, card, rating, state, now);
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

function rowParts(entry, badge) {
  return [
    el('span', { class: 'zh-s', lang: 'zh-Hant-TW' }, entry.zh, ...(badge ? [el('span', { class: 'badge' }, badge)] : [])),
    el('span', { class: 'en-s' }, entry.en),
    renderPinyin(el('span', { class: 'pinyin-s' }), entry.pinyin),
  ];
}

function browseRow(entry) {
  return el('button', { class: 'row', onclick: () => play(entry.audio) }, ...rowParts(entry));
}

function renderBrowse() {
  const weeks = [...new Set(items.map((i) => i.week))].sort((a, b) => b - a);
  $('browse-list').replaceChildren(
    ...weeks.map((w) =>
      el(
        'div',
        { class: 'week' },
        el('h3', {}, `Week ${w}`),
        ...items
          .filter((i) => i.week === w)
          .map((i) => {
            if (i.kind !== 'pattern') return browseRow(i);
            return el(
              'details',
              { class: 'pattern' },
              el('summary', { class: 'row' }, ...rowParts(i, 'pattern')),
              el('div', { class: 'fills' }, ...i.fills.map((f) => browseRow(f)))
            );
          })
      )
    )
  );
}

// ---------- settings

function renderSettings() {
  $('new-per-day').value = progress.settings.newPerDay;
  $('last-export').textContent = progress.lastExport
    ? `Last export: ${new Date(progress.lastExport).toLocaleDateString()}`
    : 'Not exported yet.';
  $('version').textContent = `Content version ${version} · ${items.length} items`;
}

function exportProgress() {
  progress.lastExport = new Date().toISOString();
  persist();
  const blob = new Blob([exportJSON(progress)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: `mandarin-progress-${localDate(new Date())}.json` });
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
  if (!confirm('Delete all progress on this device? Export first if you want a backup.')) return;
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
  $('start').addEventListener('click', startSession);
  $('more').addEventListener('click', () => { extraNew += 5; startSession(); });
  $('quit').addEventListener('click', () => { session = null; show('home'); });
  $('reveal').addEventListener('click', reveal);
  $('play').addEventListener('click', () => play(session?.current.c.audio));
  $('play-slow').addEventListener('click', () => play(session?.current.c.audioSlow));
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
  $('export').addEventListener('click', exportProgress);
  $('import').addEventListener('change', importProgress);
  $('reset').addEventListener('click', resetProgress);
}

async function init() {
  wire();
  const res = await fetch('phrases.json');
  const data = await res.json();
  items = data.items;
  version = data.version;
  byId = Object.fromEntries(items.map((i) => [i.id, i]));
  show('home');

  if ('serviceWorker' in navigator) {
    // Once a service worker controls the page, ask it to cache all audio for offline use.
    await navigator.serviceWorker.register('sw.js').catch(() => null);
    const urls = items.flatMap((i) => (i.fills || [i]).flatMap((x) => [x.audio, x.audioSlow]));
    const send = () => navigator.serviceWorker.controller?.postMessage({ type: 'cache-audio', urls });
    if (navigator.serviceWorker.controller) send();
    else navigator.serviceWorker.addEventListener('controllerchange', send, { once: true });
  }
}

init().catch((err) => {
  document.getElementById('app').replaceChildren(el('p', {}, `Could not load phrases: ${err.message}`));
});
