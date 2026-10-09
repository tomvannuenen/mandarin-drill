import tempfile
import unittest
from pathlib import Path

from tools.build import (DECKS, audio_jobs, expand, generate_audio, missing_glosses, simplified_chars, validate,
                         validate_conversations)

DRINKS = [
    {"id": "kafei", "kind": "word", "week": 1, "zh": "咖啡", "pinyin": "kā-fēi", "en": "coffee", "cat": ["drink"]},
    {"id": "shui", "kind": "word", "week": 1, "zh": "水", "pinyin": "shuǐ", "en": "water", "cat": ["drink"]},
]
HE = {"id": "wo-xihuan-he-x", "kind": "pattern", "week": 1, "zh": "我喜歡喝{drink}",
      "pinyin": "wǒ xǐ-huān hē {drink}", "en": "I like drinking {drink}", "topic": "Food & drink",
      "mission": "Order a drink"}


class Traditional(unittest.TestCase):
    def test_flags_simplified(self):
        self.assertEqual(simplified_chars("我是老师"), ["师"])

    def test_accepts_taiwan_variant_tai(self):
        self.assertEqual(simplified_chars("我是台灣人"), [])

    def test_accepts_common_traditional(self):
        self.assertEqual(simplified_chars("我喜歡吃辣"), [])

    def test_allow_override(self):
        self.assertEqual(simplified_chars("我是老师", allow="师"), [])


class Validate(unittest.TestCase):
    def test_valid(self):
        self.assertEqual(validate(DRINKS + [HE]), [])

    def test_duplicate_id(self):
        errs = validate(DRINKS + [dict(DRINKS[0])])
        self.assertTrue(any("duplicate" in e for e in errs), errs)

    def test_simplified(self):
        errs = validate([{"id": "a", "kind": "word", "week": 1, "zh": "老师", "pinyin": "lǎo-shī", "en": "teacher"}])
        self.assertTrue(any("Simplified" in e for e in errs), errs)

    def test_alignment(self):
        errs = validate([{"id": "a", "kind": "word", "week": 1, "zh": "老師", "pinyin": "lǎo", "en": "teacher"}])
        self.assertTrue(any("syllables" in e for e in errs), errs)

    def test_alignment_checked_inside_fills(self):
        bad = [{"id": "b", "kind": "word", "week": 1, "zh": "啤酒", "pinyin": "pí", "en": "beer", "cat": ["drink"]}]
        errs = validate(bad + [HE])
        self.assertTrue(any("wo-xihuan-he-x" in e for e in errs), errs)

    def test_empty_category(self):
        errs = validate([HE])
        self.assertTrue(any("no fillers" in e for e in errs), errs)

    def test_unknown_field(self):
        p = dict(HE, id="p2", en="I like {drink:demonym}")
        errs = validate(DRINKS + [p])
        self.assertTrue(any("demonym" in e for e in errs), errs)

    def test_set_instead_of_week(self):
        item = {"id": "qu", "kind": "word", "set": "Verbs", "zh": "去", "pinyin": "qù", "en": "to go"}
        self.assertEqual(validate([item]), [])
        self.assertEqual(expand([item], root=Path("/nonexistent"))[0]["set"], "Verbs")

    def test_needs_week_or_set(self):
        errs = validate([{"id": "qu", "kind": "word", "zh": "去", "pinyin": "qù", "en": "to go"}])
        self.assertTrue(any("week" in e for e in errs), errs)

    def test_phrase_needs_topic(self):
        errs = validate([{"id": "a", "kind": "phrase", "week": 1, "zh": "謝謝", "pinyin": "xiè-xie", "en": "thanks"}])
        self.assertTrue(any("topic" in e for e in errs), errs)

    def test_bad_id(self):
        errs = validate([dict(DRINKS[0], id="Ka Fei")])
        self.assertTrue(any("id" in e for e in errs), errs)


class Expand(unittest.TestCase):
    def test_pattern_fills(self):
        out = {i["id"]: i for i in expand(DRINKS + [HE], root=Path("/nonexistent"))}
        p = out["wo-xihuan-he-x"]
        self.assertEqual(p["zh"], "我喜歡喝___")
        self.assertEqual(p["roman"], "wǒ xǐ-huān hē ___")
        self.assertEqual(p["deck"], "mandarin")
        self.assertEqual([f["fillId"] for f in p["fills"]], ["kafei", "shui"])
        f = p["fills"][0]
        self.assertEqual((f["zh"], f["roman"], f["en"]), ("我喜歡喝咖啡", "wǒ xǐ-huān hē kā-fēi", "I like drinking coffee"))
        self.assertEqual(f["audio"]["tw-yunjhe"],
                         ["audio/tw-yunjhe/wo-xihuan-he-x--kafei.mp3", "audio/tw-yunjhe/wo-xihuan-he-x--kafei-slow.mp3"])

    def test_field_and_fill_en(self):
        items = [
            {"id": "helan", "kind": "word", "week": 1, "zh": "荷蘭", "pinyin": "hé-lán", "en": "the Netherlands",
             "demonym": "Dutch", "cat": ["country"]},
            {"id": "la", "kind": "word", "week": 1, "zh": "辣", "pinyin": "là", "en": "spicy", "fillEn": "spicy food",
             "cat": ["food"]},
            {"id": "ren", "kind": "pattern", "week": 1, "zh": "我是{country}人", "pinyin": "wǒ shì {country} rén",
             "en": "I am {country:demonym}", "topic": "Intro"},
            {"id": "chi", "kind": "pattern", "week": 1, "zh": "我喜歡吃{food}", "pinyin": "wǒ xǐ-huān chī {food}",
             "en": "I like eating {food}", "topic": "Food"},
        ]
        out = {i["id"]: i for i in expand(items, root=Path("/nonexistent"))}
        self.assertEqual(out["ren"]["fills"][0]["en"], "I am Dutch")
        self.assertEqual(out["chi"]["fills"][0]["en"], "I like eating spicy food")

    def test_sandhi_in_fills(self):
        items = [
            {"id": "yao", "kind": "word", "week": 1, "zh": "要", "pinyin": "yào", "en": "want", "cat": ["v"]},
            {"id": "bu-x", "kind": "pattern", "week": 1, "zh": "不{v}", "pinyin": "bù {v}", "en": "not {v}", "topic": "T"},
        ]
        out = {i["id"]: i for i in expand(items, root=Path("/nonexistent"))}
        self.assertEqual(out["bu-x"]["fills"][0]["roman"], "bú yào")

    def test_situation_filled_per_fill(self):
        he = dict(HE, situation="Someone asks what you like. ({drink})")
        p = {o["id"]: o for o in expand(DRINKS + [he], root=Path("/nonexistent"))}["wo-xihuan-he-x"]
        self.assertEqual(p["fills"][0]["situation"], "Someone asks what you like. (coffee)")

    def test_topic_and_mission_passed_through(self):
        p = {o["id"]: o for o in expand(DRINKS + [HE], root=Path("/nonexistent"))}["wo-xihuan-he-x"]
        self.assertEqual((p["topic"], p["mission"]), ("Food & drink", "Order a drink"))

    def test_word_fields(self):
        out = expand(DRINKS, root=Path("/nonexistent"))[0]
        self.assertEqual(sorted(out["audio"]), sorted(DECKS["mandarin"]["voices"]))
        self.assertEqual(out["audio"]["cn-yunyang"], ["audio/cn-yunyang/kafei.mp3", "audio/cn-yunyang/kafei-slow.mp3"])
        self.assertEqual(out["cat"], ["drink"])

    def test_coach_override(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "audio" / "coach").mkdir(parents=True)
            (Path(d) / "audio" / "coach" / "kafei.mp3").write_bytes(b"x")
            out = expand(DRINKS, root=Path(d))[0]
        self.assertEqual(out["audio"]["coach"], ["audio/coach/kafei.mp3", "audio/tw-yunjhe/kafei-slow.mp3"])


class Glosses(unittest.TestCase):
    ITEMS = DRINKS + [
        HE,
        {"id": "hen-hao", "kind": "phrase", "week": 1, "zh": "很好嗎？", "pinyin": "hěn hǎo ma?", "en": "Very good?",
         "topic": "Small talk", "gloss": {"好": "good (here: well)"}},
    ]
    GLOSSARY = {"很": "very", "喜歡": "to like", "我": "I", "喝": "to drink", "嗎": "(question)"}

    def words(self, iid, fill=None):
        out = {o["id"]: o for o in expand(self.ITEMS, root=Path("/nonexistent"), glossary=self.GLOSSARY)}
        entry = out[iid]["fills"][fill] if fill is not None else out[iid]
        return [(w["zh"], w["roman"], w["gloss"]) for w in entry["words"]]

    def test_word_items_then_glossary(self):
        self.assertEqual(self.words("wo-xihuan-he-x", 0),
                         [("我", "wǒ", "I"), ("喜歡", "xǐ-huān", "to like"), ("喝", "hē", "to drink"), ("咖啡", "kā-fēi", "coffee")])

    def test_item_override_and_punctuation_stripped(self):
        self.assertEqual(self.words("hen-hao"), [("很", "hěn", "very"), ("好", "hǎo", "good (here: well)"), ("嗎", "ma", "(question)")])

    def test_single_word_entry_uses_its_own_meaning(self):
        self.assertEqual(self.words("kafei"), [("咖啡", "kā-fēi", "coffee")])

    def test_missing_glosses_reported(self):
        out = expand(self.ITEMS, root=Path("/nonexistent"), glossary={})
        missing = missing_glosses(out)
        self.assertIn(("hen-hao", "很", "hěn"), missing)
        self.assertNotIn(("wo-xihuan-he-x", "咖啡", "kā-fēi"), missing)


class Conversations(unittest.TestCase):
    OUT = expand(DRINKS + [HE], root=Path("/nonexistent"))

    def convo(self, turns, deck="mandarin"):
        return [{"id": "c1", "title": "Coffee", "deck": deck, "turns": turns}]

    def test_valid(self):
        turns = [{"who": "them", "ref": "kafei"}, {"who": "you", "ref": "wo-xihuan-he-x", "fill": "shui"}]
        self.assertEqual(validate_conversations(self.convo(turns), self.OUT), [])

    def test_unknown_ref_and_fill(self):
        turns = [{"who": "them", "ref": "nope"}, {"who": "you", "ref": "wo-xihuan-he-x", "fill": "beer"}]
        errs = validate_conversations(self.convo(turns), self.OUT)
        self.assertTrue(any("nope" in e for e in errs) and any("beer" in e for e in errs), errs)

    def test_pattern_needs_fill_and_who_checked(self):
        turns = [{"who": "me", "ref": "kafei"}, {"who": "you", "ref": "wo-xihuan-he-x"}]
        errs = validate_conversations(self.convo(turns), self.OUT)
        self.assertTrue(any("who" in e for e in errs) and any("fill" in e for e in errs), errs)

    def test_ref_must_be_in_same_deck(self):
        errs = validate_conversations(self.convo([{"who": "you", "ref": "kafei"}], deck="cantonese"), self.OUT)
        self.assertTrue(any("kafei" in e for e in errs), errs)


class Cantonese(unittest.TestCase):
    ITEMS = [
        {"id": "yue-naicha", "kind": "word", "set": "Drinks", "zh": "奶茶", "jyutping": "naai5-caa4", "en": "milk tea",
         "cat": ["drink"]},
        {"id": "yue-ngo-jiu-x", "kind": "pattern", "set": "Drinks", "zh": "我要{drink}", "jyutping": "ngo5 jiu3 {drink}",
         "en": "I'd like {drink}", "topic": "Food & drink"},
    ]

    def test_validates_with_jyutping(self):
        self.assertEqual(validate(self.ITEMS, "cantonese"), [])

    def test_alignment_uses_jyutping(self):
        bad = [dict(self.ITEMS[0], jyutping="naai5")]
        self.assertTrue(any("syllables" in e for e in validate(bad, "cantonese")))

    def test_expand_uses_hk_voices(self):
        out = {o["id"]: o for o in expand(self.ITEMS, root=Path("/nonexistent"), deck="cantonese")}
        fill = out["yue-ngo-jiu-x"]["fills"][0]
        self.assertEqual((fill["zh"], fill["roman"], fill["en"]), ("我要奶茶", "ngo5 jiu3 naai5-caa4", "I'd like milk tea"))
        self.assertEqual(sorted(fill["audio"]), sorted(DECKS["cantonese"]["voices"]))
        self.assertEqual(out["yue-naicha"]["deck"], "cantonese")


def one_voice(items, root):
    """Expanded items trimmed to the first voice, to keep audio tests small."""
    out = expand(items, root=root)
    for o in out:
        o["audio"] = {k: v for k, v in o["audio"].items() if k in ("tw-yunjhe", "coach")}
    return out


class Audio(unittest.TestCase):
    def test_jobs_cover_every_voice_normal_and_slow(self):
        jobs = audio_jobs(expand(DRINKS[:1], root=Path("/nonexistent")))
        self.assertEqual(len(jobs), 2 * len(DECKS["mandarin"]["voices"]))
        self.assertIn(("audio/tw-hsiaoyu/kafei-slow.mp3", "咖啡", "-30%", "kafei", "zh-TW-HsiaoYuNeural"), jobs)

    def test_jobs_skip_coach(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "audio" / "coach").mkdir(parents=True)
            (Path(d) / "audio" / "coach" / "kafei.mp3").write_bytes(b"x")
            jobs = audio_jobs(one_voice(DRINKS[:1], Path(d)))
        self.assertEqual([j[0] for j in jobs], ["audio/tw-yunjhe/kafei.mp3", "audio/tw-yunjhe/kafei-slow.mp3"])

    def test_generates_only_missing(self):
        calls = []

        def synth(text, rate, path, voice):
            calls.append(path.name)
            path.write_bytes(b"mp3")

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            jobs = audio_jobs(one_voice(DRINKS[:1], root))
            made, failed = generate_audio(jobs, root, synth)
            self.assertEqual(sorted(calls), ["kafei-slow.mp3", "kafei.mp3"])
            self.assertEqual((len(made), failed), (2, []))
            calls.clear()
            generate_audio(jobs, root, synth)
            self.assertEqual(calls, [])
            generate_audio(jobs, root, synth, force_ids={"kafei"})
            self.assertEqual(len(calls), 2)


class AudioRetry(unittest.TestCase):
    def test_retries_then_reports_failure(self):
        attempts = []

        def flaky(text, rate, path, voice):
            attempts.append(path.name)
            if path.name == "kafei.mp3" and attempts.count("kafei.mp3") < 3:
                raise RuntimeError("NoAudioReceived")
            if path.name == "kafei-slow.mp3":
                raise RuntimeError("always fails")
            path.write_bytes(b"mp3")

        with tempfile.TemporaryDirectory() as d:
            jobs = audio_jobs(one_voice(DRINKS[:1], Path(d)))
            made, failed = generate_audio(jobs, Path(d), flaky, sleep=lambda s: None, workers=1)
        self.assertEqual(made, ["audio/tw-yunjhe/kafei.mp3"])
        self.assertEqual(failed, ["audio/tw-yunjhe/kafei-slow.mp3"])


if __name__ == "__main__":
    unittest.main()


class RegisterAndSwap(unittest.TestCase):
    ITEM = {"id": "wo-yao-zhege", "kind": "phrase", "set": "Essentials", "tier": 0, "register": "everyday",
            "zh": "我要這個", "pinyin": "wǒ yào zhè-ge", "en": "I'll have this one", "topic": "Food & drink",
            "swap": {"word": "這個", "with": [["一杯水", "yī bēi shuǐ", "a glass of water"]]}}

    def test_passes_through_with_sandhi_on_the_alternatives(self):
        self.assertEqual(validate([self.ITEM]), [])
        out = expand([self.ITEM], root=Path("/nonexistent"), glossary={"我": "I", "要": "want", "這個": "this"})[0]
        self.assertEqual((out["register"], out["tier"]), ("everyday", 0))
        self.assertEqual(out["swap"], {"word": "這個", "with": [{"zh": "一杯水", "roman": "yì bēi shuǐ", "en": "a glass of water"}]})

    def test_rejects_unknown_register_tier_and_swap_word(self):
        bad = {**self.ITEM, "register": "rude", "tier": 5, "swap": {"word": "那個", "with": [["水", "shuǐ", "water"]]}}
        errs = " ".join(validate([bad]))
        for part in ("register", "tier", "swap word"):
            self.assertIn(part, errs)

    def test_simplified_map_covers_phrases_notes_and_alternatives(self):
        from tools.build import simplified_map
        out = expand([{**self.ITEM, "note": "可以給我這個嗎"}], root=Path("/nonexistent"), glossary={"我": "I", "要": "want", "這個": "this"})
        m = simplified_map(out)
        self.assertEqual((m["這"], m["個"], m["給"], m["嗎"]), ("这", "个", "给", "吗"))
        self.assertNotIn("我", m)
