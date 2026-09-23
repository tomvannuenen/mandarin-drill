# 說 Mandarin

A personal spaced-repetition app for Mandarin phrases from weekly coaching sessions:
Traditional characters, Taiwan Mandarin audio, tuned for learning to *say* things.

## Using it

Open the site on your phone in Safari → Share → **Add to Home Screen**. It works offline once loaded.

- **Say it**: English is shown → say the Mandarin out loud → reveal → grade yourself honestly.
- **Listen** / **Read** cards unlock for a phrase once you've said it correctly on two different days.
- **Pattern** cards (我喜歡喝___) fill in a different word each time, preferring words you've already seen.
- 🐢 plays the slow version.
- Progress lives only on this device: **Settings → Export progress** now and then.

## Adding a week of material

1. Paste the coach's notes into a Claude Code session in this folder.
2. Claude adds entries to `data/items.json` (source of truth; see format below).
3. `uv run tools/build.py` checks the data, generates missing audio, and writes `phrases.json`.
4. Run the tests, then commit and push. The phone picks up the new cards next time the app opens.

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
- Optional: `note` (shown after reveal), `fillEn`, `allowChars` (to skip the Simplified check for specific characters).

### Audio

- Voice: `zh-TW-YunJheNeural` through [edge-tts](https://github.com/rany2/edge-tts), normal and 30% slower.
- Existing files are never regenerated. Use `uv run tools/build.py --force <id>` to redo one.
- If the TTS service fails, re-run the build: it only fills in missing files.
- **Coach recordings**: put `audio/coach/<id>.mp3` (or `<pattern-id>--<word-id>.mp3` for a pattern sentence)
  in place and rebuild. It replaces the generated normal-speed audio.

## Development

```bash
uv run --no-project --with opencc-python-reimplemented --with edge-tts python -m unittest discover -s tests -t .
/opt/homebrew/opt/node@18/bin/node --test tests/
python3 -m http.server 8765
```

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT), vendored in `vendor/`.
