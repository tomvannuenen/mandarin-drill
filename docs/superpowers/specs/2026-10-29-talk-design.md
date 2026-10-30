# Talk: a short spoken conversation after the daily round

Date: 2026-10-29. Status: design, awaiting review.

## Goal

After the day's first Mandarin round, offer a three-minute spoken conversation with an AI partner. The partner stays
inside the learner's vocabulary, uses the phrases from that round, and adds at most two or three new words. When the
learner makes a mistake, the partner echoes the sentence back correctly without stopping the conversation. A short
recap at the end lists the fixes and new words. Those become cards in a later round.

## Scope

In:
- The turn-taking engine. The learner holds the mic and speaks. OpenAI transcribes. Claude replies in Chinese with
  pinyin and English. The phone speaks the reply.
- Mandarin only.
- An entry on the end-of-round screen and an entry in Explore.
- API keys, the Claude model, the voice and a monthly cost cap, all set in Settings.

Out (each gets its own design later):
- The live OpenAI voice engine.
- The redesign of the card screens ("quiet + a little game", the Why drawer, swipes).
- Cantonese conversations. At the learner's level they come after the café and restaurant basics.

## How it works

1. The daily round ends. The done screen shows **Talk (3 min)** and **Skip**. Explore has a **Talk** row that opens
   the same flow at any time.
2. The app picks a scene (see Scenes) and shows its one-line setting, for example "Coffee with a new colleague at
   CUHK". **Another scene** swaps it.
3. The partner opens with one short line, which is spoken aloud. Its bubble shows the characters. A tap shows the
   pinyin and English.
4. The learner holds the mic, speaks and lets go. The audio is transcribed and shown as the learner's bubble.
5. Claude answers. If the learner's sentence had a mistake, the answer weaves in the correct version, for example
   你去过香港！什么时候去的？ after 我去过了香港. The correction is also recorded for the recap.
6. The conversation ends at whichever comes first: the learner taps **Done**, 12 learner turns, about 4 minutes, or
   the monthly cap.
7. Recap screen: up to three fixes ("you said … → better …"), each tappable to hear it, then the new words the partner
   used, then **Finish**.

## Scenes

`data/scenes.json` holds a short list of scenes:

```json
{ "id": "new-colleague", "deck": "mandarin", "title": "A new colleague",
  "setting": "Coffee with a new colleague at CUHK",
  "partner": "a friendly colleague in your department, Taiwanese, in their thirties",
  "phrases": ["ni-hao", "wo-shi-cong-helan-lai-de", "wo-zai-xue-zhongwen-hai-bu-tai-hui-shuo"] }
```

The first scenes are: a new colleague, a student after class, ordering at a café, lunch at a cha chaan teng, asking
the way and taking the MTR, and talking about AI tools with colleagues.

Picking a scene (pure function, in `lib/talk.js`):
1. Score each scene by how many of its `phrases` were said in today's round.
2. Prefer the scene used least recently.
3. **Another scene** moves on to the next-best one.

## What the partner is told

The system prompt is built by `lib/talk.js` from the learner's progress. It has two parts.

The fixed part:
- The role and the scene.
- The rules:
  - Speak only Mandarin.
  - Use Traditional or Simplified characters, following the learner's script setting.
  - Keep sentences to 4–12 characters.
  - Ask one thing at a time.
  - Introduce at most three words outside the list over the whole conversation.
  - Never explain grammar.
  - Echo mistakes back correctly inside the reply.
  - Keep a Taiwanese register (the coach is Taiwanese).

The vocabulary block:
- Every phrase and word the learner has met, as Chinese with English, strongest first.
- Today's round phrases marked **use these**.
- It is identical for every turn of a conversation, so it is cached with Anthropic prompt caching.

Each reply is returned through a tool, so it is always structured:

```json
{ "zh": "你去过香港！什么时候去的？", "pinyin": "nǐ qù-guò Xiāng-gǎng! shén-me shí-hou qù de?",
  "en": "You've been to Hong Kong! When did you go?",
  "fix": { "said": "我去过了香港", "better": "我去过香港", "why": "过 already says it happened; no 了" },
  "new_words": [ { "zh": "什么时候", "pinyin": "shén-me shí-hou", "en": "when" } ] }
```

The recap is assembled from the `fix` and `new_words` fields across turns, so it needs no extra API call.

## Settings

- **Anthropic key** and **OpenAI key**.
  - Stored in a separate `localStorage` entry, `shuo.keys`, outside the progress object.
  - Never exported and never synced.
- **Partner**: Claude Sonnet 5.5 (default) or Haiku 4.5 (cheaper and faster).
- **Voice**: the phone's voice (default) or OpenAI's text-to-speech.
- **Monthly cap**: default $5.
  - Spending is estimated from each response's token usage multiplied by a price table in `lib/talk.js`.
  - The month so far is shown in Settings.

The Anthropic API is called from the browser with the `anthropic-dangerous-direct-browser-access` header. OpenAI is
called directly with the key, both for transcription and for the optional text-to-speech.

## What gets saved

- `progress.talks`: the last 30 conversations. Each holds:
  - `{t, scene, model, turns: [{you, zh, en}], fixes, newWords, cost}`
  - Text only, no audio.
  - Synced like the rest of progress to the private repo.
- Each fix and each new word becomes a wish, `addWish(…, 'From a conversation', 'mandarin')`. The evening Mac task
  turns wishes into cards with recordings, as it does today.
- Phrases from the vocabulary list that the learner said correctly are logged as a `talk` activity for that phrase.
  `talk` is registered in `lib/methods.js`, so its effect on next-day recall appears in "What works for you".

## Failure handling

- **No key set**: the Talk button opens Settings at the keys section, with one line saying what is needed.
- **Microphone denied or unavailable**: a text box replaces the mic. The learner can type characters or pinyin.
- **Transcription is empty or fails**: "Didn't catch that". The learner tries again, and the turn is not counted.
- **Claude error or network failure**: one silent retry. Then the conversation ends with whatever recap exists so far.
- **Monthly cap reached**: Talk is disabled and shows the month's spend.

## Files

- `lib/talk.js` (pure, tested): `pickScene`, `systemPrompt`, `vocabBlock`, `parseReply`, `recapOf`, `costOf`,
  `canTalk` (keys, cap).
- `talk.js` (browser): the conversation view, mic handling (reusing `rec.js`), the API calls, speaking replies, and
  the recap view.
- `data/scenes.json`, validated by `tools/build.py`: phrase ids must exist.
- `index.html` and `styles.css`: the Talk view and the recap view, in the quiet style (bubbles, one big mic, nothing
  else).
- `app.js`: the entries on the done screen and in Explore, the Settings fields, and saving `talks` and wishes.

## Testing

- **Unit tests** for `lib/talk.js`:
  - scene choice
  - prompt contents: the vocabulary is included and today's phrases are marked
  - reply parsing, including malformed tool output
  - recap assembly
  - cost and cap
- **Browser test** with `fetch` stubbed to return canned transcription and Claude replies: the full flow from the done
  screen to the recap, saving, and the wishes created. No real keys are used in testing.
- **The first real conversation** is done by the learner after entering the keys on their phone.
