import unittest

import numpy as np

from tools.lesson import char_timeline, find_clips, loudness, merge, pauses, snaps, targets, unheard


def seg(text, start, end, words):
    return {"text": text, "start": start, "end": end, "words": [{"w": w, "start": s, "end": e} for w, s, e in words]}


TRANSCRIPT = {"segments": [
    seg("大家好，我們今天學", 0.0, 3.0, [("大家", 0.0, 0.6), ("好，", 0.6, 1.0), ("我們", 1.5, 1.9), ("今天", 1.9, 2.4), ("學", 2.4, 3.0)]),
    seg("你們好", 5.0, 6.2, [("你們", 5.0, 5.6), ("好", 5.6, 6.2)]),
    seg("所以你們好就是", 10.0, 12.0, [("所以", 10.0, 10.5), ("你們", 10.5, 10.9), ("好", 10.9, 11.2), ("就是", 11.2, 12.0)]),
    seg("我", 20.0, 20.4, [("我", 20.0, 20.4)]),
]}

ITEMS = [
    {"id": "dajia-hao", "kind": "phrase", "deck": "mandarin", "zh": "大家好"},
    {"id": "nimen-hao", "kind": "phrase", "deck": "mandarin", "zh": "你們好"},
    {"id": "wo", "kind": "word", "deck": "mandarin", "zh": "我"},
    {"id": "ta", "kind": "word", "deck": "mandarin", "zh": "他"},
    {"id": "x-jian", "kind": "pattern", "deck": "mandarin", "zh": "___見", "fills": [{"fillId": "mingtian", "zh": "明天見"}]},
    {"id": "yue-nei-hou", "kind": "phrase", "deck": "cantonese", "zh": "你好"},
]


class Lesson(unittest.TestCase):
    def test_char_timeline_spreads_word_times_over_characters(self):
        tl = char_timeline(TRANSCRIPT)
        self.assertEqual("".join(c for c, *_ in tl[:3]), "大家好")
        self.assertAlmostEqual(tl[0][1], 0.0)
        self.assertAlmostEqual(tl[1][1], 0.3)

    def test_targets_are_mandarin_cards_and_pattern_sentences(self):
        keys = {k for k, _ in targets(ITEMS)}
        self.assertEqual(keys, {"dajia-hao", "nimen-hao", "wo", "ta", "x-jian--mingtian"})

    def test_prefers_the_phrase_said_on_its_own(self):
        clips = find_clips(TRANSCRIPT, ITEMS)
        self.assertEqual(clips["nimen-hao"]["seg"], 1)  # the standalone "你們好", not the one mid-sentence
        self.assertLess(clips["nimen-hao"]["start"], 5.0)
        self.assertGreater(clips["nimen-hao"]["end"], 6.2)

    def test_single_characters_only_when_said_alone(self):
        clips = find_clips(TRANSCRIPT, ITEMS)
        self.assertIn("wo", clips)  # "我" alone in its own segment
        self.assertNotIn("ta", clips)

    def test_clip_does_not_reach_far_into_the_next_word(self):
        clips = find_clips(TRANSCRIPT, ITEMS)
        self.assertLessEqual(clips["dajia-hao"]["end"], 1.3)


    def test_implausible_timings_are_dropped(self):
        t = {"segments": [
            seg("香港", 0.0, 0.2, [("香港", 0.0, 0.2)]),        # 2 syllables in 0.2 s: too fast
            seg("之後", 5.0, 13.0, [("之後", 5.0, 13.0)]),      # 2 syllables in 8 s: too slow
        ]}
        items = [{"id": "xg", "kind": "word", "deck": "mandarin", "zh": "香港"}, {"id": "zh", "kind": "word", "deck": "mandarin", "zh": "之後"}]
        self.assertEqual(find_clips(t, items), {})

    def test_pauses_are_long_quiet_stretches(self):
        tone = np.sin(np.arange(16000) / 16000 * 2 * np.pi * 200).astype(np.float32) * 0.3
        silence = np.zeros(1600 * 3, dtype=np.float32)          # 0.3 s: a real pause
        blip = np.zeros(800, dtype=np.float32)                    # 0.05 s: a consonant, not a pause
        audio = np.concatenate([silence, tone, blip, tone, silence])
        gaps = pauses(loudness(audio))
        self.assertEqual(len(gaps), 2)
        self.assertAlmostEqual(gaps[0][1], 0.3, places=2)

    def test_cuts_run_from_pause_to_pause_closest_to_whisper_first(self):
        gaps = [(0.0, 1.0), (1.6, 1.75), (2.2, 2.8)]
        cuts = snaps({"t0": 1.2, "t1": 2.0}, gaps, 3)
        self.assertEqual((cuts[0]["start"], cuts[0]["end"]), (0.9, 2.35))
        self.assertIn((0.9, 1.75), [(c["start"], c["end"]) for c in cuts])   # in case Whisper ran long

    def test_no_cuts_for_a_phrase_said_mid_sentence(self):
        self.assertEqual(snaps({"t0": 1.2, "t1": 2.0}, [(0.0, 1.0)], 3), [])

    def test_speech_outside_the_recognised_words_is_measured(self):
        tone = np.sin(np.arange(8000) / 16000 * 2 * np.pi * 200).astype(np.float32) * 0.3   # 0.5 s of speech
        gap = np.zeros(8000, dtype=np.float32)
        clip = np.concatenate([tone, gap, tone])            # a word, a pause, then "means like"
        self.assertAlmostEqual(unheard(clip, [(0.0, 0.5)]), 0.5, places=2)
        self.assertEqual(unheard(clip, [(0.0, 0.5), (1.0, 1.5)]), 0)

    def test_merge_recuts_this_lesson_and_keeps_better_clips_from_others(self):
        remote = {"clips": {
            "a": {"file": "a.m4a", "lesson": "L1", "text": "", "score": 0.1, "v": "x"},
            "b": {"file": "b.m4a", "lesson": "L0", "text": "", "score": 1.5, "v": "y"},
            "gone": {"file": "gone.m4a", "lesson": "L1", "text": ""},
        }}
        local = {"lesson": "L1", "clips": {
            "a": {"file": "a.m4a", "text": "", "score": 0.9, "v": "z"},
            "b": {"file": "b.m4a", "text": "", "score": 0.4, "v": "w"},
        }}
        merged, uploads, removals = merge(remote, local)
        self.assertEqual(uploads, ["a"])
        self.assertEqual(removals, ["gone"])
        self.assertEqual(merged["clips"]["b"]["lesson"], "L0")
        self.assertNotIn("gone", merged["clips"])


if __name__ == "__main__":
    unittest.main()
