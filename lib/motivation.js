// Motivators: coach-week readiness, "what I can say", and real-life missions.
import { localDate } from './store.js';

const MISSION_REST_DAYS = 14;
const DAY = 86400000;

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

function hash(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

export function pickMission(items, progress, now, skip = 0) {
  const recent = new Set(
    progress.missions.filter((m) => now - new Date(`${m.date}T12:00:00`) < MISSION_REST_DAYS * DAY).map((m) => m.id)
  );
  const pool = items
    .filter((i) => i.mission && isSolid(progress, i.id) && !recent.has(i.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!pool.length) return null;
  return pool[(hash(localDate(now)) + skip) % pool.length];
}

export function markMissionDone(progress, id, now) {
  progress.missions.push({ date: localDate(now), id });
}

export function missionDoneToday(progress, now) {
  const today = localDate(now);
  return progress.missions.some((m) => m.date === today);
}
