// Weekly check-in: a summary of the last week's answers, readable in the app and pasteable to Claude.
import { localDate } from './store.js';

const DAY = 86400000;

function deckOf(id, byId) {
  if (id.startsWith('w/')) return id.split('/')[1];
  return byId[id]?.deck;
}

export function weekSummary(progress, items, now, days = 7) {
  const since = now.getTime() - days * DAY;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const firstSeen = {};
  for (const [t, key] of progress.log) if (!(key in firstSeen)) firstSeen[key] = t;
  const recent = progress.log.filter(([t]) => t >= since);

  const byDeck = {};
  const misses = {};
  for (const [, key, rating] of recent) {
    const id = key.slice(0, key.lastIndexOf(':'));
    const d = deckOf(id, byId);
    if (d) byDeck[d] = (byDeck[d] || 0) + 1;
    if (rating === 1 && byId[id]) misses[id] = (misses[id] || 0) + 1;
  }
  const mostMissed = Object.entries(misses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, n]) => ({ id, misses: n, zh: byId[id].zh, roman: byId[id].roman, en: byId[id].en }));
  const spots = Object.entries(progress.weak)
    .filter(([, w]) => w.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([id, w]) => ({ deck: id.split('/')[1], zh: id.split('/').slice(2).join('/'), score: w.score, flags: w.flags }));
  const sinceDate = localDate(new Date(since));

  return {
    days,
    reviews: recent.length,
    right: recent.filter(([, , r]) => r >= 3).length,
    daysStudied: new Set(recent.map(([t]) => localDate(new Date(t)))).size,
    newCards: Object.values(firstSeen).filter((t) => t >= since).length,
    byDeck,
    mostMissed,
    spots,
    missions: progress.missions.filter((m) => m.date >= sinceDate).length,
    conversations: Object.entries(progress.convos || {}).filter(([, c]) => c.last >= sinceDate).map(([id]) => id),
    tones: progress.tones || {},
  };
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);

export function checkinText(s, readiness) {
  const lines = [
    `說 weekly check-in · last ${s.days} days`,
    `Reviews: ${s.reviews} (${pct(s.right, s.reviews)}% right) · days studied: ${s.daysStudied}/${s.days} · new cards: ${s.newCards}`,
  ];
  const decks = Object.entries(s.byDeck).map(([d, n]) => `${d} ${n}`).join(', ');
  if (decks) lines.push(`By language: ${decks}`);
  if (readiness) lines.push(`Coach week ${readiness.week}: ${readiness.solid}/${readiness.total} solid`);
  if (s.mostMissed.length) lines.push(`Most missed: ${s.mostMissed.map((m) => `${m.zh} (${m.roman}, "${m.en}") ×${m.misses}`).join('; ')}`);
  if (s.spots.length) lines.push(`Trouble spots: ${s.spots.map((t) => `${t.zh} [${t.deck}, missed ${t.flags}×]`).join('; ')}`);
  const tones = Object.entries(s.tones).filter(([, [, n]]) => n >= 3);
  if (tones.length) lines.push(`Tone check: ${tones.map(([t, [ok, n]]) => `${t.includes('-') ? `tones ${t}` : `tone ${t}`} ${pct(ok, n)}% (${n})`).join(', ')}`);
  lines.push(`Real-life missions done: ${s.missions}`);
  if (s.conversations.length) lines.push(`Conversations practised: ${s.conversations.join(', ')}`);
  return lines.join('\n');
}
