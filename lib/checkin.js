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
    reading: Object.entries(progress.weakChars || {})
      .filter(([, w]) => w.score > 0)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([k, w]) => ({ deck: k.split('/')[0], zh: k.split('/').slice(1).join('/'), score: w.score, flags: w.flags })),
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
  if (s.spots.length) lines.push(`Hard to say (trouble spots): ${s.spots.map((t) => `${t.zh} [${t.deck}, missed ${t.flags}×]`).join('; ')}`);
  if (s.reading.length) lines.push(`Hard to read (characters): ${s.reading.map((t) => `${t.zh} [${t.deck}, missed ${t.flags}×]`).join('; ')}`);
  const tones = Object.entries(s.tones).filter(([, [, n]]) => n >= 3);
  if (tones.length) lines.push(`Tone check: ${tones.map(([t, [ok, n]]) => `${t.includes('-') ? `tones ${t}` : `tone ${t}`} ${pct(ok, n)}% (${n})`).join(', ')}`);
  lines.push(`Real-life missions done: ${s.missions}`);
  if (s.conversations.length) lines.push(`Conversations practised: ${s.conversations.join(', ')}`);
  return lines.join('\n');
}

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: 'neutral' };

// A short brief to share with the coach before a lesson. glossOf: {word: {roman, gloss}}.
export function coachBrief(s, progress, glossOf, now) {
  const since = now.getTime() - s.days * DAY;
  const lines = [`Notes for my Chinese lesson (last ${s.days} days)`, ''];
  lines.push(`• I practised ${s.reviews} times on ${s.daysStudied} days, ${pct(s.right, s.reviews)}% right.`);
  const slipping = s.spots.filter((t) => t.deck === 'mandarin').slice(0, 5)
    .map((t) => (glossOf[t.zh] ? `${glossOf[t.zh].roman.replace(/-/g, '')} (${glossOf[t.zh].gloss})` : t.zh));
  if (slipping.length) lines.push(`• Words that keep slipping when I speak: ${slipping.join(', ')}.`);
  const unread = s.reading.filter((t) => t.deck === 'mandarin').slice(0, 5)
    .map((t) => `${t.zh}${glossOf[t.zh] ? ` (${glossOf[t.zh].roman.replace(/-/g, '')})` : ''}`);
  if (unread.length) lines.push(`• Characters I find hard to read: ${unread.join(', ')}.`);
  const hard = s.mostMissed.slice(0, 3).map((m) => `${m.roman.replace(/-/g, '')} ("${m.en}")`);
  if (hard.length) lines.push(`• Hardest phrases: ${hard.join('; ')}.`);
  const conf = Object.entries(progress.toneConfusions || {}).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, n]) => { const [h, p] = k.split('>'); return `a ${ORD[h]} tone as a ${ORD[p]} tone (${n}×)`; });
  if (conf.length) lines.push(`• In tone practice I often hear ${conf.join(', and ')}.`);
  const wishes = (progress.wishes || []).filter((w) => w.t >= since).map((w) => `"${w.text}"`);
  if (wishes.length) lines.push(`• Things I wanted to say this week: ${wishes.join(', ')}.`);
  lines.push('', 'Could we practise these in conversation?');
  return lines.join('\n');
}
