import tempfile
import unittest
from pathlib import Path

from tools.build import audio_jobs, expand, generate_audio, simplified_chars, validate

DRINKS = [
    {"id": "kafei", "kind": "word", "week": 1, "zh": "咖啡", "pinyin": "kā-fēi", "en": "coffee", "cat": ["drink"]},
    {"id": "shui", "kind": "word", "week": 1, "zh": "水", "pinyin": "shuǐ", "en": "water", "cat": ["drink"]},
]
HE = {"id": "wo-xihuan-he-x", "kind": "pattern", "week": 1, "zh": "我喜歡喝{drink}",
      "pinyin": "wǒ xǐ-huān hē {drink}", "en": "I like drinking {drink}"}


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
        errs = validate([{"id": "a", "kind": "phrase", "week": 1, "zh": "老师", "pinyin": "lǎo-shī", "en": "teacher"}])
        self.assertTrue(any("Simplified" in e for e in errs), errs)

    def test_alignment(self):
        errs = validate([{"id": "a", "kind": "phrase", "week": 1, "zh": "老師", "pinyin": "lǎo", "en": "teacher"}])
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

    def test_bad_id(self):
        errs = validate([dict(DRINKS[0], id="Ka Fei")])
        self.assertTrue(any("id" in e for e in errs), errs)


class Expand(unittest.TestCase):
    def test_pattern_fills(self):
        out = {i["id"]: i for i in expand(DRINKS + [HE], root=Path("/nonexistent"))}
        p = out["wo-xihuan-he-x"]
        self.assertEqual(p["zh"], "我喜歡喝___")
        self.assertEqual(p["pinyin"], "wǒ xǐ-huān hē ___")
        self.assertEqual([f["fillId"] for f in p["fills"]], ["kafei", "shui"])
        f = p["fills"][0]
        self.assertEqual((f["zh"], f["pinyin"], f["en"]), ("我喜歡喝咖啡", "wǒ xǐ-huān hē kā-fēi", "I like drinking coffee"))
        self.assertEqual(f["audio"], "audio/wo-xihuan-he-x--kafei.mp3")
        self.assertEqual(f["audioSlow"], "audio/wo-xihuan-he-x--kafei-slow.mp3")

    def test_field_and_fill_en(self):
        items = [
            {"id": "helan", "kind": "word", "week": 1, "zh": "荷蘭", "pinyin": "hé-lán", "en": "the Netherlands",
             "demonym": "Dutch", "cat": ["country"]},
            {"id": "la", "kind": "word", "week": 1, "zh": "辣", "pinyin": "là", "en": "spicy", "fillEn": "spicy food",
             "cat": ["food"]},
            {"id": "ren", "kind": "pattern", "week": 1, "zh": "我是{country}人", "pinyin": "wǒ shì {country} rén",
             "en": "I am {country:demonym}"},
            {"id": "chi", "kind": "pattern", "week": 1, "zh": "我喜歡吃{food}", "pinyin": "wǒ xǐ-huān chī {food}",
             "en": "I like eating {food}"},
        ]
        out = {i["id"]: i for i in expand(items, root=Path("/nonexistent"))}
        self.assertEqual(out["ren"]["fills"][0]["en"], "I am Dutch")
        self.assertEqual(out["chi"]["fills"][0]["en"], "I like eating spicy food")

    def test_sandhi_in_fills(self):
        items = [
            {"id": "yao", "kind": "word", "week": 1, "zh": "要", "pinyin": "yào", "en": "want", "cat": ["v"]},
            {"id": "bu-x", "kind": "pattern", "week": 1, "zh": "不{v}", "pinyin": "bù {v}", "en": "not {v}"},
        ]
        out = {i["id"]: i for i in expand(items, root=Path("/nonexistent"))}
        self.assertEqual(out["bu-x"]["fills"][0]["pinyin"], "bú yào")

    def test_word_fields(self):
        out = expand(DRINKS, root=Path("/nonexistent"))[0]
        self.assertEqual(out["audio"], "audio/kafei.mp3")
        self.assertEqual(out["cat"], ["drink"])

    def test_coach_override(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "audio" / "coach").mkdir(parents=True)
            (Path(d) / "audio" / "coach" / "kafei.mp3").write_bytes(b"x")
            out = expand(DRINKS, root=Path(d))[0]
        self.assertEqual(out["audio"], "audio/coach/kafei.mp3")
        self.assertEqual(out["audioSlow"], "audio/kafei-slow.mp3")


class Audio(unittest.TestCase):
    def test_jobs_skip_coach_normal(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "audio" / "coach").mkdir(parents=True)
            (Path(d) / "audio" / "coach" / "kafei.mp3").write_bytes(b"x")
            jobs = audio_jobs(expand(DRINKS[:1], root=Path(d)))
        self.assertEqual(jobs, [("audio/kafei-slow.mp3", "咖啡", "-30%", "kafei")])

    def test_generates_only_missing(self):
        calls = []

        def synth(text, rate, path):
            calls.append(path.name)
            path.write_bytes(b"mp3")

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            jobs = audio_jobs(expand(DRINKS[:1], root=root))
            generate_audio(jobs, root, synth)
            self.assertEqual(sorted(calls), ["kafei-slow.mp3", "kafei.mp3"])
            calls.clear()
            generate_audio(jobs, root, synth)
            self.assertEqual(calls, [])
            generate_audio(jobs, root, synth, force_ids={"kafei"})
            self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
