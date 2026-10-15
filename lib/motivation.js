// Motivators: coach-week readiness and "what I can say".

export function isSolid(progress, id) {
  return (progress.goodCounts[id] || 0) >= 2;
}

export function weekReadiness(items, progress) {
  const weeks = items.filter((i) => i.week).map((i) => i.week);
  if (!weeks.length) return null;
  const week = Math.max(...weeks);
  const mine = items.filter((i) => i.week === week);
  return { week, solid: mine.filter((i) => isSolid(progress, i.id)).length, total: mine.length };
}

export function daysUntil(weekday, now) {
  return (weekday - now.getDay() + 7) % 7;
}

export function canSay(items, progress) {
  const groups = new Map();
  for (const i of items) {
    if (!i.topic) continue;
    if (!groups.has(i.topic)) groups.set(i.topic, []);
    groups.get(i.topic).push({ id: i.id, zh: i.zh, en: i.en, solid: isSolid(progress, i.id) });
  }
  return [...groups].map(([topic, list]) => ({ topic, items: list, solid: list.filter((x) => x.solid).length, total: list.length }));
}

