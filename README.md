# 說 Chinese

A personal spaced-repetition app for learning to *say* things, in Traditional characters:

- **普通話 Mandarin**: weekly coaching material plus a verbs set, with Taiwan and Beijing voices.
- **廣東話 Cantonese**: a Hong Kong starter deck with Jyutping and Hong Kong voices.

Switch languages at the top of the Study and Browse screens. Each language has its own daily new-card limit.

## Using it

Open the site on your phone in Safari → Share → **Add to Home Screen**. It works offline once loaded.

- **Say it**: English is shown → say the Mandarin out loud → reveal → grade yourself honestly.
- **Listen** / **Read** cards unlock for a phrase once you've said it correctly on two different days.
- **Pattern** cards (我喜歡喝___) fill in a different word each time, preferring words you've already seen.
- Every card rotates between voices (🇹🇼 Taiwan / 🇨🇳 Beijing for Mandarin, 🇭🇰 for Cantonese).
  Each tap on 🔊 plays the next speaker; the flag shows where they're from. 🐢 plays the last speaker slowly.
- The answer is shown word by word: tap a word to see what it means. If you got that word wrong, tap
  **I missed this** before grading. Missed words become **trouble spots**: practised on their own
  ("come from" → 來自) and as a gap in other sentences (我＿＿荷蘭), until you get them right on two later days.
- The home screen shows how ready you are for this week's coach lesson (set the lesson day in Settings),
  a daily **real-life mission** for a phrase you know well, your trouble spots, and **What I can say** by situation.
  A phrase counts as *solid* once you've said it right on two different days.
- **Tones** (Mandarin): a 10-question tone check that quizzes your weakest tones and tone pairs more.
- **Conversations**: short dialogues from `data/conversations.json`. You hear their lines, then say yours.
- **Weekly check-in** (on the coach card): a summary of the week to paste into Claude with the coach's notes.
  Claude uses it to write the next cards around what keeps slipping.
- Progress lives only on this device: **Settings → Export progress** now and then.

## Adding a week of material

1. Paste the coach's notes into a Claude Code session in this folder.
2. Claude adds entries to `data/items.json` (source of truth; see format below).
3. `uv run tools/build.py` checks the data, generates missing audio, and writes `phrases.json`.
4. Run the tests, then commit and push. The phone picks up the new cards next time the app opens.

Cantonese phrases go in `data/cantonese.json` in the same format, with `jyutping` instead of `pinyin`
(tone digits, e.g. `m4-goi1`), ids starting with `yue-`, and `set` instead of `week`.

### `data/items.json` format

```json
{"id": "kafei", "kind": "word", "week": 1, "zh": "咖啡", "pinyin": "kā-fēi", "en": "coffee", "cat": ["drink"]}
{"id": "wo-xihuan-he-x", "kind": "pattern", "week": 1, "zh": "我喜歡喝{drink}", "pinyin": "wǒ xǐ-huān hē {drink}", "en": "I like drinking {drink}"}
```

- `id` is permanent: progress is keyed by it. Never rename a published id.
- `kind`: `word`, `phrase`, or `pattern`.
- `pinyin`: words separated by spaces, syllables joined by `-`, one syllable per character, **dictionary tones**.
  The build writes the 不/一 tone changes itself (不要 → bú yào). Put `"noYiSandhi": true` on counting uses of 一.
- Traditional characters only. The build rejects Simplified characters (台 is allowed).
- Pattern slots: `{cat}` is filled by every word tagged with that `cat`. In `en`, `{cat}` uses the word's
  `fillEn` or `en`, and `{cat:field}` uses another field (e.g. `{country:demonym}` → "Dutch").
- Every word inside a phrase needs a meaning: either it has its own `word` card, or it is listed in
  `data/glossary.json`, or the item has a `gloss` override (`{"好": "well"}`). The build fails otherwise.
  Pinyin word boundaries (spaces) decide how a phrase is split into words.
- Phrases and patterns need a `topic` (the situation: Introducing yourself, Small talk, Food & drink,
  Getting by, Work & study) and can have a `mission`: a concrete thing to do with the phrase in real life.
- Patterns about the learner can set `mine` to their own answer (e.g. `"mine": "helan"`), used in missions.
- Optional: `note` (shown after reveal), `fillEn`, `allowChars` (to skip the Simplified check for specific characters).

### Audio

- Voices are listed in `VOICES` / `DECKS` in `tools/build.py` and generated through
  [edge-tts](https://github.com/rany2/edge-tts), normal and 30% slower, into `audio/<voice>/`.
  Mandarin: YunJhe, HsiaoChen, HsiaoYu (Taiwan), Yunyang, Xiaoxiao (Beijing). Cantonese: WanLung, HiuMaan, HiuGaai.
- Existing files are never regenerated. Use `uv run tools/build.py --force <id>` to redo one.
- If the TTS service fails, re-run the build: it only fills in missing files.
- **Coach recordings**: put `audio/coach/<id>.mp3` (or `<pattern-id>--<word-id>.mp3` for a pattern sentence)
  in place and rebuild. It appears as an extra 🎓 Coach voice.

## Development

```bash
uv run --no-project --with opencc-python-reimplemented --with edge-tts python -m unittest discover -s tests -t .
/opt/homebrew/opt/node@18/bin/node --test tests/
python3 -m http.server 8765
```

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT), vendored in `vendor/`.
