// "I wish I could say…": phrases the learner needed in real life. Claude turns them into cards
// (items carrying `wish: <wish id>`), which are then introduced before anything else.
export function addWish(progress, text, where, deck, now) {
  const clean = text.trim();
  if (!clean) return null;
  const wish = { id: `wish-${now.getTime()}`, t: now.getTime(), text: clean, where: where.trim(), deck };
  (progress.wishes ||= []).push(wish);
  return wish;
}

// Newest first, each with the card it became (if any).
export function wishStatus(progress, items) {
  const byWish = Object.fromEntries(items.filter((i) => i.wish).map((i) => [i.wish, i]));
  return [...(progress.wishes || [])].sort((a, b) => b.t - a.t).map((w) => ({ ...w, item: byWish[w.id] || null }));
}
