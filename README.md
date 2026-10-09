# 說 Chinese

A personal spaced-repetition app for learning to *say* things, in Traditional characters:

- **普通話 Mandarin**: weekly coaching material plus a verbs set, with Taiwan and Beijing voices.
- **廣東話 Cantonese**: a Hong Kong starter deck with Jyutping and Hong Kong voices.

Switch languages at the top of the Study and Browse screens. Each language has its own daily new-card limit.

## Using it

Open the site on your phone in Safari → Share → **Add to Home Screen**. It works offline once loaded.

Three tabs:
- **Today**: Claude's note for the day, one seal button that runs the whole day's practice (trouble spots and
  focus first, then reviews mixed with new cards, then a conversation), and a real-life mission.
- **Explore**: conversations, tone check, all phrases, the HSK book audio, and "I wish I could say…".
- **Me**: what you can say by situation, lesson readiness and notes for the coach, trouble spots, tones, settings.

Practice:
- **Say it**: English is shown → say it out loud → reveal → *Didn't know / Almost / Got it*. After a miss on a
  multi-word phrase, pick the part that tripped you up; it becomes a trouble spot.
- **Characters, a little a day** (about 3 word cards and 2 sentence builds in the daily session):
  *Read it* cards show a word from phrases you've met (most frequent first): say it, then check. Once you can
  say a phrase, *Build the sentence* asks you to tap word tiles into order (with two decoys). Tiles show pinyin
  under words you can't read yet; it disappears once you've recognised a word on two different days.
- The daily session has a fixed shape (40 cards at most): a short warm-up (the 5 weakest trouble spots, the 3
  hardest-to-read words, today's focus), then reviews with the day's new material mixed in. The new speaking
  cards, 3 new word cards and 3 sentence builds always get their place; reviews give way when the day is full.
- **繁 / 简** at the top of every Mandarin card switches all characters (answers, tiles, notes) between
  Traditional and Simplified, from that card on. Settings → *Characters* also offers *Mixed*: Traditional,
  except *Read it* cards for words you won't see written in Hong Kong.
- A card can show how the phrase sounds (*Everyday*, *Casual*, *Polite*, *Formal*), and which part can be
  swapped: that word is underlined, with a few things to put in its place.
- **The mix** (`MIX` in `lib/today.js`, about 40 cards): speaking a sentence from its meaning is the centre (11,
  topped up with phrases due in the next three days); 5 listening tasks on phrases not otherwise tested that day
  (rebuild by ear twice, missing word, pick by ear, right or wrong) plus match the pairs; 2 tone picks; listen and
  repeat or build-up for new and shaky phrases; 4 word-order builds; 4 word cards and 2 read-aloud sentences;
  3 trouble words, asked inside a sentence; 1 old-style listening card. It closes on a passage: five of the day's
  sentences played in a row, then "how much did you catch?".
- **The daily session is the lesson**; Explore is extra. A session holds about 40 cards, and cannot
  run away: a card comes back once at most, nothing comes back after 60 cards, and fewer new phrases are added
  while earlier ones are still shaky (none once twelve are open).
- **Learn before being tested.** A new phrase is first heard and repeated, a long one built up from its end
  (一下嗎 → 解釋一下嗎 → …), and only tested a few cards later. A phrase that went wrong is practised another
  way before it is asked again, in the session and at its next review.
- **Ways of practising**, besides the say-it card: *Listen and repeat*, *Build it up*, *Pick by ear* (hear it,
  pick the meaning), *Missing word by ear*, *Right or wrong* (hear it: is this what it means?), *Pick the tones*
  (also feeds the tone statistics), *Rebuild by ear* (hear it, tap the pinyin back into order), *Match the pairs*
  (four sounds, four meanings) and *Word tiles*. A short listening round (*Pick by ear*, *Right or wrong* or
  *Match the pairs*) sits in the middle of the session. To add a way: register it in `lib/methods.js`
  (`ACTIVITIES`, `METHOD_NAME`, `applicable`) and give it content and a prompt in `app.js`.
- **You are told when the mix changes**: one line on the session's end screen and on Today for the rest of that
  day, e.g. "Dropped Pick by ear: 40% stuck, against 85% for Build it up." or "More Rebuild by ear from now on".
- **What works for you** (Me): for each way of practising, how often the phrase was then said right *on a later
  day*. The session leans on the ways with the best record, keeps trying the untried, and drops a way once it
  has eight results and trails the best by 25 points (`lib/methods.js`).
- **Word order** (Explore): ten sentence builds from phrases you've met, never-built ones first. After a build
  the card shows the English words in Chinese order (you · like · drink · what) and, where there is one, the
  rule behind it (items with `"order": "Place before the verb: 在 + place + verb"`). Patterns are built with a
  different word each time. The daily session mixes in 3 new builds.
- Simple before complex: within a lesson week or a set, single words come first, then phrases from short to
  long. When a short phrase does the job (這個中文怎麼說？), the longer one gets `"tier": 2`.
- Useful before polite: essentials come first, then your wishes and the lesson weeks; the politer, more formal
  or rarer way to say something waits until the everyday phrases are in.
- Letter colours are tones (Mandarin 1 red, 2 amber, 3 green, 4 blue, neutral grey; Cantonese adds 6 purple).
  How a phrase is going for you is the dot: green solid, amber learning, red hard right now, hollow not met.
  It sits before each phrase in All phrases and before the card's title; a red dot on a word in an answer
  marks a current trouble spot.
- Tap any word (in answers, on tiles, in "Which part?") to hear just that word.
- Tap a word in an answer to see its characters; tap a character to see what it means and what it is made of;
  tap a part to go deeper. Dashed green marks the part that gives the meaning, dashed purple the sound.
- Missing a *Read it* card marks a **reading** problem (Me → "Hard to read"), kept apart from speaking trouble
  spots ("Hard to say"): the word's pinyin returns on tiles and its Read it card comes first in the next sessions,
  until you read it right on later days (four at most, however often it was missed). "Almost" changes nothing.
- **Listen** cards unlock for a phrase once you've said it correctly on two different days. **Read** cards (characters → sound) only appear when *Practise reading characters* is on in Settings; with it off, pinyin is shown large and characters small.
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
- **Difficulty ladder**: phrases that keep slipping show first-letter hints (w_ l_z_ H_l_); solid phrases are
  prompted with a *situation* instead of English; mastered ones become speed rounds. 💡 gives a hint any time.
- **🎙 Record yourself** after revealing: hear yourself, then the native voice. Share a recording with the coach.
- **I wish I could say…**: phrases you needed in real life become cards (items with `"wish": "<wish id>"`,
  set "My phrases"), introduced before anything else.
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
- Phrases can have a `situation` (a prompt used once the phrase is solid). In patterns, `{cat}` is filled in.
- `register` (`everyday`, `casual`, `polite`, `formal`) is shown on the card; set it wherever there is a contrast.
  `tier` decides when a card is introduced: `0` essentials (first), `1` default, `2` later (the politer, more
  formal or less common variant of something that has an everyday card). Always add the everyday phrasing first.
- `swap` marks the replaceable part of a phrase: `{"word": "這個", "with": [["那個", "nà-ge", "that one"]]}`.
  `word` must be one of the phrase's words. Prefer it to describing the swap in a `note`.
- Chinese inside a `note` can be tapped for its pinyin and meaning. The build takes those from the deck when the
  piece is one of its phrases or words; anything else must be listed in `data/note-glosses.json`
  (`"不要": ["bù yào", "don't want"]`), or the build fails.
- Optional: `note` (shown after reveal), `fillEn`, `allowChars` (to skip the Simplified check for specific characters).

### Audio

- Voices are listed in `VOICES` / `DECKS` in `tools/build.py` and generated through
  [edge-tts](https://github.com/rany2/edge-tts), normal and 30% slower, into `audio/<voice>/`.
  Mandarin: YunJhe, HsiaoChen, HsiaoYu (Taiwan), Yunyang, Xiaoxiao (Beijing). Cantonese: WanLung, HiuMaan, HiuGaai.
- Existing files are never regenerated. Use `uv run tools/build.py --force <id>` to redo one.
- If the TTS service fails, re-run the build: it only fills in missing files.
- **Coach recordings**: put `audio/coach/<id>.mp3` (or `<pattern-id>--<word-id>.mp3` for a pattern sentence)
  in place and rebuild. It appears as an extra 🎓 Coach voice.

## Lesson recordings → coach audio

Recordings live in a private folder next to this repo (`../chinese-italki/`), never in it. For a lesson that only
has the coach's voice:

```bash
uv run tools/lesson.py transcribe "../chinese-italki/<lesson>.mp4"   # Whisper (large-v3-turbo) on this Mac
uv run tools/lesson.py clips "../chinese-italki/<lesson>.mp4"        # cut + self-verify clips for your cards
uv run tools/lesson.py publish "../chinese-italki/<lesson>.mp4"      # upload to the PRIVATE sync repo only
```

A clip is kept only if the phrase has a real pause on both sides (its edges are cut inside those pauses, so no
word is clipped) and Whisper, listening to the clip alone, hears exactly the phrase: nothing cut off and nothing
extra. Whisper's language detector must also hear Chinese at both ends, which catches English it would otherwise
swallow ("yeah, we did" before 最近怎麼樣). When the coach said a phrase several times, the cleanest take wins. Re-running `clips` + `publish` replaces
that lesson's clips; a later lesson only replaces a clip with a better-scoring one. The app downloads changes
when it syncs and adds them as a **Coach** voice on those cards (slow playback slows the clip down).

## Development

```bash
uv run --no-project --with opencc-python-reimplemented --with edge-tts --with numpy python -m unittest discover -s tests -t .
/opt/homebrew/opt/node@18/bin/node --test tests/
python3 -m http.server 8765
```

Character meanings and breakdowns (`data/hanzi.json`) come from [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)'s
`dictionary.txt` (derived from Unihan and cjk-decomp; LGPL). The build refreshes the table when that file is at
`.local/mmah-dictionary.txt`; corrections and Cantonese-only characters go in `data/hanzi-extra.json`.

Scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 (MIT), vendored in `vendor/`.
