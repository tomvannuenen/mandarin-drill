// Book tab: plays textbook audio that was loaded from a private pack file into this device's IndexedDB.
import { parseBundle } from './lib/bundle.js';

const DB_NAME = 'chinese-book';
const LAST_KEY = 'book.last';
const SPEEDS = [1, 0.75, 0.5];

const $ = (id) => document.getElementById(id);
const player = new Audio();
let meta = null; // {title, lessons, names}
let current = null; // track name
let objectUrl = null;
let repeat = false;
let speedIdx = 0;

// ---------- storage

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('tracks');
      req.result.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const request = fn(t); // an IDBRequest for reads, undefined for writes
    t.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage failed (is the phone full?)'));
  });
}

async function saveBook(parsed) {
  await tx(['tracks', 'meta'], 'readwrite', (t) => {
    t.objectStore('tracks').clear();
    for (const tr of parsed.tracks) t.objectStore('tracks').put(new Blob([tr.bytes], { type: 'audio/mpeg' }), tr.name);
    t.objectStore('meta').put({ title: parsed.title, lessons: parsed.lessons, names: parsed.tracks.map((tr) => tr.name) }, 'book');
  });
}

const loadMeta = () => tx(['meta'], 'readonly', (t) => t.objectStore('meta').get('book'));
const loadTrack = (name) => tx(['tracks'], 'readonly', (t) => t.objectStore('tracks').get(name));

async function removeBook() {
  await tx(['tracks', 'meta'], 'readwrite', (t) => {
    t.objectStore('tracks').clear();
    t.objectStore('meta').clear();
  });
}

function remember() {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ name: current, time: player.currentTime }));
  } catch {}
}

function recall() {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY)) || null;
  } catch {
    return null;
  }
}

// ---------- player

const lessonOf = (name) => parseInt(name.split('-')[0], 10);
const trackLabel = (name) => (lessonOf(name) === 0 ? 'Intro' : name.replace(/^0/, ''));

async function select(name, { autoplay = true, at = 0 } = {}) {
  const blob = await loadTrack(name);
  if (!blob) return;
  current = name;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  player.src = objectUrl;
  player.playbackRate = SPEEDS[speedIdx];
  player.addEventListener('loadedmetadata', () => { if (at) player.currentTime = at; }, { once: true });
  if (autoplay) player.play().catch(() => {});
  const lesson = lessonOf(name);
  $('player-title').textContent = `Lesson ${lesson} · ${trackLabel(name)}`;
  $('player-sub').textContent = meta.lessons[lesson] || '';
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: `Lesson ${lesson} · ${trackLabel(name)}`, artist: meta.title });
  }
  $('player').hidden = false;
  highlight();
  remember();
}

function step(delta) {
  if (!current) return;
  const i = meta.names.indexOf(current) + delta;
  if (i >= 0 && i < meta.names.length) select(meta.names[i]);
}

function highlight() {
  for (const b of document.querySelectorAll('.track')) b.classList.toggle('active', b.dataset.name === current);
  $('pl-play').textContent = player.paused ? '▶' : '⏸';
}

// ---------- rendering

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

export async function renderBook() {
  meta = await loadMeta().catch(() => null);
  $('book-empty').hidden = !!meta;
  $('book-loaded').hidden = !meta;
  if (!meta) {
    $('player').hidden = true;
    return;
  }
  $('book-title').textContent = meta.title;
  if (!current) {
    const last = recall();
    if (last?.name && meta.names.includes(last.name)) await select(last.name, { autoplay: false, at: last.time });
  }
  const lessons = [...new Set(meta.names.map(lessonOf))];
  const open = current ? lessonOf(current) : null;
  $('book-list').replaceChildren(
    ...lessons.map((l) =>
      el(
        'details',
        { class: 'lesson', ...(l === open ? { open: '' } : {}) },
        el('summary', {}, el('b', {}, l === 0 ? 'Intro' : `Lesson ${l}`), ' ', el('span', { lang: 'zh-Hans' }, l ? meta.lessons[l] || '' : '')),
        el(
          'div',
          { class: 'tracks' },
          ...meta.names
            .filter((n) => lessonOf(n) === l)
            .map((n) => el('button', { class: 'track', 'data-name': n, onclick: () => select(n) }, trackLabel(n)))
        )
      )
    )
  );
  $('player').hidden = !current;
  highlight();
}

async function importPack(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const status = $('book-status');
  try {
    status.textContent = 'Loading…';
    const parsed = parseBundle(await file.arrayBuffer());
    await saveBook(parsed);
    navigator.storage?.persist?.().catch(() => {});
    status.textContent = `Loaded ${parsed.tracks.length} tracks.`;
    await renderBook();
  } catch (err) {
    status.textContent = `Could not load: ${err.message}`;
  }
}

export function initBook() {
  $('book-file').addEventListener('change', importPack);
  $('book-remove').addEventListener('click', async () => {
    if (!confirm('Remove the book audio from this device? You can load it again later.')) return;
    player.pause();
    current = null;
    try { localStorage.removeItem(LAST_KEY); } catch {}
    await removeBook();
    renderBook();
  });
  $('pl-play').addEventListener('click', () => (player.paused ? player.play() : player.pause()));
  $('pl-back').addEventListener('click', () => { player.currentTime = Math.max(0, player.currentTime - 5); });
  $('pl-prev').addEventListener('click', () => step(-1));
  $('pl-next').addEventListener('click', () => step(1));
  $('pl-speed').addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    player.playbackRate = SPEEDS[speedIdx];
    $('pl-speed').textContent = `${SPEEDS[speedIdx]}×`;
  });
  $('pl-repeat').addEventListener('click', () => {
    repeat = !repeat;
    $('pl-repeat').classList.toggle('on', repeat);
  });
  $('pl-seek').addEventListener('input', (e) => {
    if (player.duration) player.currentTime = (e.target.value / 1000) * player.duration;
  });

  let lastSave = 0;
  player.addEventListener('timeupdate', () => {
    if (player.duration) $('pl-seek').value = (player.currentTime / player.duration) * 1000;
    if (Date.now() - lastSave > 3000) { lastSave = Date.now(); remember(); }
  });
  player.addEventListener('play', highlight);
  player.addEventListener('pause', () => { highlight(); remember(); });
  player.addEventListener('ended', () => {
    if (repeat) { player.currentTime = 0; player.play(); } else step(1);
  });

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => player.play());
    ms.setActionHandler('pause', () => player.pause());
    ms.setActionHandler('previoustrack', () => step(-1));
    ms.setActionHandler('nexttrack', () => step(1));
    ms.setActionHandler('seekbackward', () => { player.currentTime = Math.max(0, player.currentTime - 5); });
  }
}
