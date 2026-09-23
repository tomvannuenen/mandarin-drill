"""Pinyin helpers: tone detection, syllable/character alignment, 不/一 tone sandhi.

Pinyin convention in data/items.json: words separated by spaces, syllables inside
a word joined by '-', one syllable per Han character, e.g. "wǒ xǐ-huān hē kā-fēi".
"""
import re
import unicodedata

_TONE_MARKS = {"̄": 1, "́": 2, "̌": 3, "̀": 4}
_SEP = re.compile(r"([ \-]+)")
_WORD = re.compile(r"^([^A-Za-zÀ-ɏ]*)([A-Za-zÀ-ɏ̀-ͯ]+)(.*)$")


def tone_of(syl: str) -> int:
    for ch in unicodedata.normalize("NFD", syl):
        if ch in _TONE_MARKS:
            return _TONE_MARKS[ch]
    return 5


def _core(token: str):
    """Split a token into (prefix, letters, suffix); letters is '' for punctuation-only."""
    m = _WORD.match(unicodedata.normalize("NFC", token))
    if not m:
        return token, "", ""
    return m.group(1), m.group(2), m.group(3)


def syllables(pinyin: str) -> list:
    out = []
    for tok in _SEP.split(pinyin):
        if not tok or _SEP.fullmatch(tok):
            continue
        letters = _core(tok)[1]
        if letters:
            out.append(letters)
    return out


def han_chars(zh: str) -> list:
    return [c for c in zh if "一" <= c <= "鿿" or "㐀" <= c <= "䶿"]


def apply_sandhi(zh: str, pinyin: str, no_yi: bool = False) -> str:
    chars = han_chars(zh)
    parts = _SEP.split(unicodedata.normalize("NFC", pinyin))
    idx = [i for i, p in enumerate(parts) if p and not _SEP.fullmatch(p) and _core(p)[1]]
    if len(idx) != len(chars):
        raise ValueError(f"{zh!r}: {len(chars)} characters but {len(idx)} pinyin syllables in {pinyin!r}")
    for n, (ch, i) in enumerate(zip(chars, idx)):
        if n + 1 >= len(chars):
            break
        pre, letters, suf = _core(parts[i])
        nxt = tone_of(_core(parts[idx[n + 1]])[1])
        if ch == "不" and letters.lower() == "bù" and nxt == 4:
            letters = "bú"
        elif ch == "一" and letters.lower() == "yī" and not no_yi:
            letters = "yí" if nxt in (4, 5) else "yì"
        parts[i] = pre + letters + suf
    return "".join(parts)
