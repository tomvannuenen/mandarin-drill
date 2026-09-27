// Difficulty ladder for "say it" cards, based on how this phrase has been going:
// hint (keeps slipping) → normal → situation (solid: no English, just the situation) → speed (mastered).
const SOLID_STABILITY = 7; // days
const MASTERED_STABILITY = 21;

export function level(progress, item, now) {
  const s = progress.cards[`${item.id}:say`];
  if (!s) return 'normal';
  const recent = progress.log.filter((e) => e[1] === `${item.id}:say`).slice(-5);
  if (recent.filter((e) => e[2] === 1).length >= 2) return 'hint';
  const solid = (progress.goodCounts[item.id] || 0) >= 2 && s.state === 2;
  if (solid && s.stability >= MASTERED_STABILITY) return 'speed';
  if (solid && s.stability >= SOLID_STABILITY && item.situation) return 'situation';
  return 'normal';
}

// First letter of every syllable, keeping word boundaries and final punctuation: "w_ l_z_ H_l_".
export function hintText(roman) {
  return roman
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const tail = word.match(/[?!.,…]*$/)[0];
      return word.slice(0, word.length - tail.length).split('-').filter(Boolean).map((syl) => `${[...syl.normalize('NFC')][0]}_`).join('') + tail;
    })
    .join(' ');
}
