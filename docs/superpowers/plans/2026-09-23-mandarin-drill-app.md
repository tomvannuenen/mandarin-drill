# Mandarin Drill App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phone-first offline PWA for spaced-repetition speaking drills of weekly Mandarin (Traditional, Taiwan) coach material.

**Architecture:** `data/items.json` (hand-curated) → `tools/build.py` (validate, Traditional check, tone sandhi, pattern expansion, edge-tts audio) → `phrases.json` + `audio/`. A framework-free static frontend (ES modules in `lib/`, UI in `app.js`) schedules cards with vendored ts-fsrs and stores progress in localStorage. Hosted on GitHub Pages.

**Tech Stack:** Python 3 via `uv run` (PEP 723 deps: edge-tts, opencc-python-reimplemented), vanilla JS ES modules, ts-fsrs 5.4.2 (vendored ESM), Node 18 (`/opt/homebrew/opt/node@18/bin/node --test`) for JS tests, GitHub Pages.

Spec: `docs/superpowers/specs/2026-09-22-mandarin-srs-app-design.md`

---

## Verified facts (checked before planning)

- ts-fsrs 5.4.2 `dist/index.mjs` is a single self-contained ESM file (no imports). API: `fsrs(generatorParameters({...}))`, `createEmptyCard(date)`, `f.next(card, now, Rating.Good).card`. A new card graded Good goes to a 10-minute learning step (`state: 1`), so sessions must re-show short-interval cards.
- OpenCC `s2twp` on whole phrases leaves all week-1 Traditional text unchanged **except** 台 → 臺. Per-character `s2t` has many false positives (吃, 里, 后, 干) — so check whole strings with `s2twp` and allow 台 globally.
- `uvx --from edge-tts` works; voice `zh-TW-YunJheNeural`, slow = `-30%`.

## Data conventions

- `pinyin` in `data/items.json`: words separated by spaces, syllables within a word joined by `-` (e.g. `wǒ xǐ-huān hē kā-fēi`). One syllable per Han character. Punctuation (`？`, `……`) is allowed in `zh`; in pinyin, punctuation-only tokens (`…`) and trailing `?` are allowed and ignored for alignment.
- Pattern placeholders: `{cat}` in `zh`/`pinyin`/`en`. In `en`, `{cat}` uses the filler's `fillEn` if present, else `en`; `{cat:field}` uses the filler's `field` (e.g. `{country:demonym}`).
- Frontend displays pinyin by removing `-` inside words and colouring each syllable.

## File map

| File | Responsibility |
|---|---|
| `tools/pinyin.py` | syllable tokenising, tone detection, 不/一 sandhi, Han-count alignment |
| `tools/build.py` | load/validate items, Traditional check, pattern expansion, audio generation, write `phrases.json`, stamp SW version |
| `tests/test_pinyin.py`, `tests/test_build.py` | Python unit tests |
| `lib/tones.js` | `toneOf(syl)`, `pinyinWords(str)` for coloured rendering |
| `lib/srs.js` | `grade(state, rating, now)`, `isDue(state, now)` over ts-fsrs, JSON-safe state |
| `lib/cards.js` | `cardKey`, `unlocked`, `pickFill` |
| `lib/session.js` | `buildQueue`, `shouldRequeue` |
| `lib/store.js` | `load/save/exportJSON/importJSON/applyReview`, streak + new-card counters |
| `tests/*.test.mjs` | JS unit tests |
| `index.html`, `styles.css`, `app.js` | UI: home, study, browse, settings |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline + install |
| `data/items.json` | week-1 content |

---

### Task 1: Pinyin utilities (Python)

**Files:** Create `tools/pinyin.py`, `tests/test_pinyin.py`

API:
```python
def tone_of(syl: str) -> int            # 1-4 by tone mark, 5 = neutral
def syllables(pinyin: str) -> list[str] # split on spaces and '-', drop punctuation-only tokens, strip ?/！ etc.
def han_chars(zh: str) -> list[str]     # CJK Unified Ideographs only
def apply_sandhi(zh: str, pinyin: str, no_yi: bool=False) -> str
```
Sandhi rules (on aligned syllables, preserving the original separators):
- 不 `bù` + next tone 4 → `bú`
- 一 `yī` + next tone 4 or 5 → `yí`; + next tone 1–3 → `yì`; last syllable or `no_yi` → unchanged.

Tests (all must fail first, then pass):
```python
tone_of("mā")==1; tone_of("má")==2; tone_of("mǎ")==3; tone_of("mà")==4; tone_of("ma")==5; tone_of("ma?")==5
syllables("wǒ xǐ-huān hē kā-fēi")==["wǒ","xǐ","huān","hē","kā","fēi"]
syllables("wǒ jiào …")==["wǒ","jiào"]
syllables("nǐ hǎo ma?")==["nǐ","hǎo","ma"]
han_chars("你好嗎？")==["你","好","嗎"]
apply_sandhi("要不要辣？","yào bù yào là?")=="yào bú yào là?"
apply_sandhi("我不喜歡","wǒ bù xǐ-huān")=="wǒ bù xǐ-huān"
apply_sandhi("一點點","yī diǎn-diǎn")=="yì diǎn-diǎn"
apply_sandhi("一個","yī gè")=="yí gè"
apply_sandhi("第一","dì yī")=="dì yī"
apply_sandhi("一二","yī èr", no_yi=True)=="yī èr"
apply_sandhi("你好","nǐ hǎo hǎo")  -> raises ValueError (alignment)
```
Run: `uv run --with opencc-python-reimplemented python -m unittest tests.test_pinyin -v` → FAIL, implement, → PASS. Commit `Add pinyin utilities with tone sandhi`.

### Task 2: Build script (Python)

**Files:** Create `tools/build.py`, `tests/test_build.py`

PEP 723 header so `uv run tools/build.py` installs `edge-tts` and `opencc-python-reimplemented`.

API:
```python
ALLOWED_TRAD_VARIANTS = set("台")
def simplified_chars(zh, allow="") -> list[str]   # chars changed by OpenCC s2twp, minus allowed
def validate(items) -> list[str]                    # error messages; empty = ok
def expand(items) -> list[dict]                     # phrases.json items (sandhi applied, fills, audio paths)
def audio_jobs(out_items) -> list[(path, text, rate)]
def generate_audio(jobs, root, synth, force_ids=()) -> list[path]   # skips existing files
def main(argv)                                       # --no-audio, --force ID
```
Validation errors: duplicate/invalid id (`^[a-z0-9-]+$`), bad kind, missing zh/pinyin/en, Simplified chars, syllable/Han mismatch (checked after expanding patterns with every filler), pattern category with no fillers, unknown `{cat:field}`.

Expansion: word/phrase → `{id, kind, week, zh, pinyin(sandhi), en, note?, cat?, audio, audioSlow}`. Pattern → same with `zh`/`pinyin`/`en` placeholders replaced by `___`, plus `fills: [{fillId, zh, pinyin, en, audio, audioSlow}]`. Audio path `audio/<id>.mp3`, `audio/<id>-slow.mp3`, fills `audio/<pid>--<fid>.mp3`; if `audio/coach/<id>.mp3` exists, `audio` points there.

Tests (with an injected fake `synth` and a temp dir):
- `simplified_chars("我是老师")==["师"]`, `simplified_chars("我是台灣人")==[]`, `simplified_chars("我喜歡吃辣")==[]`
- `validate` reports duplicate id, Simplified char, alignment mismatch, empty category
- `expand` on a drink pattern with two drinks gives two fills with correct zh/pinyin/en and demonym field lookup
- `expand` applies sandhi inside fills (`我不要{x}` style)
- `generate_audio` calls synth only for missing files; `force_ids` regenerates
- coach override path used when file exists

Commit `Add build script: validation, patterns, audio`.

### Task 3: Week-1 content

**Files:** Create `data/items.json`. Content from the coach notes (Traditional, coach's pinyin). Patterns: 我來自{country}, 我是{country}人 (`{country:demonym}`), 你喜歡{country}嗎？, 我喜歡吃{food}, 我不喜歡吃{food}, 我喜歡喝{drink}, 我不喜歡喝{drink}. Run `uv run tools/build.py`; must print 0 errors and generate audio. Spot-check listen to 2 files' sizes > 0. Commit `Add week 1 content and audio`.

### Task 4: JS core libs

**Files:** `vendor/ts-fsrs.js` (downloaded 5.4.2 `dist/index.mjs`), `lib/tones.js`, `lib/srs.js`, `lib/cards.js`, `lib/session.js`, `lib/store.js`, `tests/*.test.mjs`

APIs:
```js
// tones.js
toneOf(syl) -> 1..5
pinyinWords("wǒ xǐ-huān ma?") -> [[{text:"wǒ",tone:3}],[{text:"xǐ",tone:3},{text:"huān",tone:1}],[{text:"ma?",tone:5}]]
// srs.js
grade(state|null, rating 1-4, now: Date) -> state (plain JSON: ISO date strings)
isDue(state, now) -> bool
// cards.js
UNLOCK_GOOD = 2
cardKey(id, type) -> "id:type"
unlocked(id, progress) -> bool   // goodCounts[id] >= 2
pickFill(item, progress, rand=Math.random) -> fill  // prefers fills whose word has a say card
// session.js
buildQueue(items, progress, now, newLimit) -> [{key,id,type}]
   // 1) due cards (by due asc) whose item still exists; 2) unlocked listen/read without state;
   // 3) say cards without state, source order, up to newLimit - newToday
shouldRequeue(state, now) -> bool  // due within 20 minutes
// store.js
defaults() ; load(storage) ; save(storage, p) ; exportJSON(p) ; importJSON(str) (throws on bad shape)
applyReview(p, {id, type}, rating, newState, now) -> p  // sets cards[key], goodCounts for say+rating>=3,
   // newCount {date,n} when state was new, streak/lastStudyDate by local date
localDate(now) -> "YYYY-MM-DD"
```
Tests cover each bullet (tone rendering, grade round-trip through JSON, unlock threshold, fill preference, queue ordering + new limit + removed items, requeue threshold, streak continue/reset, import rejects garbage, export/import round-trip). Run `/opt/homebrew/opt/node@18/bin/node --test tests/` → FAIL first, then PASS. Commit `Add JS core: scheduling, cards, session, store`.

### Task 5: UI, service worker, manifest, icon

**Files:** `index.html`, `styles.css`, `app.js`, `sw.js`, `manifest.webmanifest`, `icons/icon-192.png`, `icons/icon-512.png`, `icons/apple-touch-icon.png`

- Home: due count, Start, streak, learned count, export reminder banner.
- Study: prompt per type (say: English; listen: 🔊 auto-plays; read: characters), Reveal button, answer (characters `lang="zh-Hant-TW"`, coloured pinyin, English, note), auto-play audio on reveal, 🔊 and 🐢 buttons, four grade buttons. Requeue short-interval cards. Done screen.
- Browse: items grouped by week; tap row plays audio; patterns show their fills.
- Settings: new/day, export (download JSON), import (file input), reset warning.
- `sw.js`: `VERSION` stamped by build; precache shell; network-first `phrases.json`; cache-first everything else (adds to cache on fetch); on activate delete old caches; after load, app posts all audio URLs for background caching.
- Icon generated with Pillow + PingFang font (說 on red).
- build.py stamps `sw.js` VERSION with a hash of shell files + phrases.json version.

Verify in browser pane at mobile size: study flow, reveal, audio element src correct, grade, browse, export. Commit `Add app UI, service worker, manifest`.

### Task 6: Deploy

- `gh repo create mandarin-drill --public --source . --push`
- `gh api repos/{owner}/mandarin-drill/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'`
- Wait for Pages build; load URL in browser pane; confirm phrases.json and an mp3 return 200.
- Add `README.md` with weekly workflow. Commit + push.
