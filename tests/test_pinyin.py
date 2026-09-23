import unittest

from tools.pinyin import apply_sandhi, han_chars, syllables, tone_of


class ToneOf(unittest.TestCase):
    def test_marked_tones(self):
        self.assertEqual([tone_of(s) for s in ["mā", "má", "mǎ", "mà"]], [1, 2, 3, 4])

    def test_neutral(self):
        self.assertEqual(tone_of("ma"), 5)
        self.assertEqual(tone_of("ma?"), 5)

    def test_capitals_and_u_umlaut(self):
        self.assertEqual(tone_of("Xiāng"), 1)
        self.assertEqual(tone_of("lǜ"), 4)


class Syllables(unittest.TestCase):
    def test_words_and_hyphens(self):
        self.assertEqual(syllables("wǒ xǐ-huān hē kā-fēi"), ["wǒ", "xǐ", "huān", "hē", "kā", "fēi"])

    def test_drops_punctuation_tokens(self):
        self.assertEqual(syllables("wǒ jiào …"), ["wǒ", "jiào"])

    def test_strips_trailing_punctuation(self):
        self.assertEqual(syllables("nǐ hǎo ma?"), ["nǐ", "hǎo", "ma"])


class HanChars(unittest.TestCase):
    def test_ignores_punctuation(self):
        self.assertEqual(han_chars("你好嗎？"), ["你", "好", "嗎"])
        self.assertEqual(han_chars("我叫……"), ["我", "叫"])


class Sandhi(unittest.TestCase):
    def test_bu_before_fourth(self):
        self.assertEqual(apply_sandhi("要不要辣？", "yào bù yào là?"), "yào bú yào là?")

    def test_bu_before_third_unchanged(self):
        self.assertEqual(apply_sandhi("我不喜歡", "wǒ bù xǐ-huān"), "wǒ bù xǐ-huān")

    def test_yi_before_third(self):
        self.assertEqual(apply_sandhi("一點點", "yī diǎn-diǎn"), "yì diǎn-diǎn")

    def test_yi_before_fourth(self):
        self.assertEqual(apply_sandhi("一個", "yī gè"), "yí gè")

    def test_yi_final_unchanged(self):
        self.assertEqual(apply_sandhi("第一", "dì yī"), "dì yī")

    def test_no_yi_flag(self):
        self.assertEqual(apply_sandhi("一二", "yī èr", no_yi=True), "yī èr")

    def test_capitalised_syllable_kept(self):
        self.assertEqual(apply_sandhi("香港", "Xiāng-gǎng"), "Xiāng-gǎng")

    def test_alignment_mismatch_raises(self):
        with self.assertRaises(ValueError):
            apply_sandhi("你好", "nǐ hǎo hǎo")


if __name__ == "__main__":
    unittest.main()
