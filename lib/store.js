// Progress persistence (localStorage), export/import, and review bookkeeping.
const KEY = 'mandarin.progress.v1';
export const LOG_LIMIT = 4000; // answers kept for the weekly check-in

export function defaults() {
  return {
    cards: {},
    goodCounts: {}, // days on which the say card was answered Good/Easy (unlocks listen/read)
    lastGood: {},
    stats: { streak: 0, lastStudyDate: null, newCounts: {} }, // newCounts: {deck: {date, n}}
    weak: {}, // trouble spots: {'w/<deck>/<word>': {score, flags}}
    missions: [], // [{date, id}] real-life missions done
    log: [], // [[timeMs, cardKey, rating]] recent answers
    tones: {}, // tone check results: {tone or 'a-b' pair: [right, total]}
    convos: {}, // mini-conversations: {id: {n, last}}
    planApplied: null, // date of the last daily plan whose focus words were added
    lastExport: null,
    settings: { newPerDay: 10, deck: 'mandarin', lessonDay: null, reading: false },
  };
}

function merge(obj) {
  const d = defaults();
  const stats = { ...(obj.stats || {}) };
  if (stats.newCount) {
    // v1 kept one counter for the (then only) Mandarin deck.
    stats.newCounts = { mandarin: stats.newCount, ...(stats.newCounts || {}) };
    delete stats.newCount;
  }
  obj = { ...obj, stats };
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

export function newToday(progress, now, deck = 'mandarin') {
  const nc = progress.stats.newCounts[deck];
  return nc && nc.date === localDate(now) ? nc.n : 0;
}

export function applyReview(progress, { id, type, deck = 'mandarin' }, rating, newState, now) {
  const key = `${id}:${type}`;
  const wasNew = !progress.cards[key];
  progress.log.push([now.getTime(), key, rating]);
  if (progress.log.length > LOG_LIMIT) progress.log.splice(0, progress.log.length - LOG_LIMIT);
  progress.cards[key] = newState;
  const today = localDate(now);
  if (type === 'say') {
    if (rating >= 3 && progress.lastGood[id] !== today) {
      progress.goodCounts[id] = (progress.goodCounts[id] || 0) + 1;
      progress.lastGood[id] = today;
    }
    if (wasNew) progress.stats.newCounts[deck] = { date: today, n: newToday(progress, now, deck) + 1 };
  }
  const s = progress.stats;
  if (s.lastStudyDate !== today) {
    const yesterday = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    s.streak = s.lastStudyDate === yesterday ? s.streak + 1 : 1;
    s.lastStudyDate = today;
  }
  return progress;
}
