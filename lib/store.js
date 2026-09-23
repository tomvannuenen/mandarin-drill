// Progress persistence (localStorage), export/import, and review bookkeeping.
const KEY = 'mandarin.progress.v1';

export function defaults() {
  return {
    cards: {},
    goodCounts: {},
    stats: { streak: 0, lastStudyDate: null, newCount: { date: null, n: 0 } },
    lastExport: null,
    settings: { newPerDay: 10 },
  };
}

function merge(obj) {
  const d = defaults();
  return {
    ...d,
    ...obj,
    stats: { ...d.stats, ...(obj.stats || {}) },
    settings: { ...d.settings, ...(obj.settings || {}) },
  };
}

export function load(storage) {
  try {
    const raw = storage.getItem(KEY);
    return raw ? merge(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

export function save(storage, progress) {
  try {
    storage.setItem(KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

export function exportJSON(progress) {
  return JSON.stringify(progress, null, 1);
}

export function importJSON(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== 'object' || typeof obj.cards !== 'object' || obj.cards === null) {
    throw new Error('Not a progress backup file');
  }
  return merge(obj);
}

export function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function newToday(progress, now) {
  const nc = progress.stats.newCount;
  return nc.date === localDate(now) ? nc.n : 0;
}

export function applyReview(progress, { id, type }, rating, newState, now) {
  const key = `${id}:${type}`;
  const wasNew = !progress.cards[key];
  progress.cards[key] = newState;
  const today = localDate(now);
  if (type === 'say') {
    if (rating >= 3) progress.goodCounts[id] = (progress.goodCounts[id] || 0) + 1;
    if (wasNew) progress.stats.newCount = { date: today, n: newToday(progress, now) + 1 };
  }
  const s = progress.stats;
  if (s.lastStudyDate !== today) {
    const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    s.streak = s.lastStudyDate === yesterday ? s.streak + 1 : 1;
    s.lastStudyDate = today;
  }
  return progress;
}
