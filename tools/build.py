# /// script
# requires-python = ">=3.9"
# dependencies = ["edge-tts", "opencc-python-reimplemented"]
# ///
"""Build phrases.json and audio from data/items.json (Mandarin) and data/cantonese.json.

Usage:
    uv run tools/build.py                # validate, generate missing audio, write phrases.json
    uv run tools/build.py --no-audio     # skip audio generation
    uv run tools/build.py --force ID     # regenerate audio for item ID (repeatable)
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import re
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.pinyin import apply_sandhi, word_groups

ROOT = Path(__file__).resolve().parent.parent
# Every phrase is recorded by every voice of its deck; the app rotates between them.
VOICES = {
    "tw-yunjhe": {"tts": "zh-TW-YunJheNeural", "flag": "🇹🇼", "name": "YunJhe"},
    "tw-hsiaochen": {"tts": "zh-TW-HsiaoChenNeural", "flag": "🇹🇼", "name": "HsiaoChen"},
    "tw-hsiaoyu": {"tts": "zh-TW-HsiaoYuNeural", "flag": "🇹🇼", "name": "HsiaoYu"},
    "cn-yunyang": {"tts": "zh-CN-YunyangNeural", "flag": "🇨🇳", "name": "Yunyang"},
    "cn-xiaoxiao": {"tts": "zh-CN-XiaoxiaoNeural", "flag": "🇨🇳", "name": "Xiaoxiao"},
    "hk-wanlung": {"tts": "zh-HK-WanLungNeural", "flag": "🇭🇰", "name": "WanLung"},
    "hk-hiumaan": {"tts": "zh-HK-HiuMaanNeural", "flag": "🇭🇰", "name": "HiuMaan"},
    "hk-hiugaai": {"tts": "zh-HK-HiuGaaiNeural", "flag": "🇭🇰", "name": "HiuGaai"},
}
COACH = {"flag": "🎓", "name": "Coach"}
DECKS = {
    "mandarin": {
        "label": "普通話", "file": "items.json", "roman": "pinyin",
        "voices": ["tw-yunjhe", "tw-hsiaochen", "tw-hsiaoyu", "cn-yunyang", "cn-xiaoxiao"],
    },
    "cantonese": {
        "label": "廣東話", "file": "cantonese.json", "roman": "jyutping",
        "voices": ["hk-wanlung", "hk-hiumaan", "hk-hiugaai"],
    },
}
SLOW_RATE = "-30%"
NORMAL_RATE = "+0%"
KINDS = {"word", "phrase", "pattern"}
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SLOT_RE = re.compile(r"\{(\w+)(?::(\w+))?\}")
# Characters OpenCC "corrects" that are standard everyday Traditional in Taiwan.
ALLOWED_TRAD_VARIANTS = set("台")
SHELL_FILES = ["index.html", "styles.css", "app.js", "book.js", "manifest.webmanifest", "phrases.json"]
SHELL_GLOBS = ["lib/*.js", "vendor/*.js"]

_cc = None


def simplified_chars(zh, allow=""):
    global _cc
    if _cc is None:
        from opencc import OpenCC
        _cc = OpenCC("s2twp")
    converted = _cc.convert(zh)
    ok = ALLOWED_TRAD_VARIANTS | set(allow)
    if len(converted) != len(zh):
        return [c for c in zh if c not in converted and c not in ok]
    return [a for a, b in zip(zh, converted) if a != b and a not in ok]


def _slots(text):
    return SLOT_RE.findall(text)


def _fillers(items, cat):
    return [i for i in items if i.get("kind") != "pattern" and cat in i.get("cat", [])]


def _fill_text(template, filler, field):
    def sub(m):
        return str(filler.get(m.group(2))) if m.group(2) else filler[field]
    return SLOT_RE.sub(sub, template)


def _fill_en(template, filler):
    def sub(m):
        if m.group(2):
            return str(filler.get(m.group(2), ""))
        return filler.get("fillEn", filler["en"])
    return SLOT_RE.sub(sub, template)


def validate(items, deck="mandarin"):
    roman = DECKS[deck]["roman"]
    errs = []
    seen = set()
    for it in items:
        iid = it.get("id", "?")
        if not isinstance(it.get("id"), str) or not ID_RE.match(it["id"]):
            errs.append(f"{iid}: invalid id (use lowercase letters, digits, hyphens)")
        if iid in seen:
            errs.append(f"{iid}: duplicate id")
        seen.add(iid)
        if it.get("kind") not in KINDS:
            errs.append(f"{iid}: kind must be one of {sorted(KINDS)}")
        missing = [k for k in ("zh", roman, "en") if not it.get(k)]
        if not it.get("week") and not it.get("set"):
            missing.append("week (or set)")
        if it.get("kind") in ("phrase", "pattern") and not it.get("topic"):
            missing.append("topic (the situation, e.g. 'Food & drink')")
        if missing:
            errs.append(f"{iid}: missing {', '.join(missing)}")
            continue
        bad = simplified_chars(SLOT_RE.sub("", it["zh"]), it.get("allowChars", ""))
        if bad:
            errs.append(f"{iid}: Simplified characters {''.join(bad)} in {it['zh']!r}")
        no_yi = it.get("noYiSandhi", False)
        if it["kind"] != "pattern":
            try:
                _romanize(deck, it["zh"], it[roman], no_yi)
            except ValueError as e:
                errs.append(f"{iid}: {e}")
            continue
        cats = {c for c, _ in _slots(it["zh"])}
        if len(cats) != 1:
            errs.append(f"{iid}: pattern must use exactly one slot category, found {sorted(cats)}")
            continue
        cat = cats.pop()
        fillers = _fillers(items, cat)
        if not fillers:
            errs.append(f"{iid}: category {cat!r} has no fillers")
            continue
        for f in fillers:
            for c, field in _slots(it["en"]):
                if field and field not in f:
                    errs.append(f"{iid}: filler {f.get('id')} has no field {field!r}")
            try:
                _romanize(deck, _fill_text(it["zh"], f, "zh"), _fill_text(it[roman], f, roman), no_yi)
            except ValueError as e:
                errs.append(f"{iid} + {f.get('id')}: {e}")
    return errs


def _romanize(deck, zh, roman, no_yi=False):
    """Checks syllable/character alignment; Mandarin also gets 不/一 tone sandhi."""
    return apply_sandhi(zh, roman, no_yi or deck != "mandarin")


def _audio(key, deck, root):
    """{voice_id: [normal_path, slow_path]}; a coach recording is added as an extra voice."""
    voices = DECKS[deck]["voices"]
    audio = {v: [f"audio/{v}/{key}.mp3", f"audio/{v}/{key}-slow.mp3"] for v in voices}
    coach = f"audio/coach/{key}.mp3"
    if (root / coach).exists():
        audio["coach"] = [coach, audio[voices[0]][1]]
    return audio


def _words(zh, roman, en, known, glossary, overrides):
    """Word-by-word breakdown [{zh, roman, gloss}] for tap-to-translate; gloss is None when unknown."""
    groups = word_groups(zh, roman)
    if len(groups) == 1:
        return [{"zh": groups[0][0], "roman": groups[0][1].rstrip("?!.,…"), "gloss": en}]
    return [
        {"zh": z, "roman": r.rstrip("?!.,…"), "gloss": overrides.get(z) or known.get(z) or glossary.get(z)}
        for z, r in groups
    ]


def missing_glosses(out_items):
    """[(item_id, characters, roman)] for words with no meaning, one per distinct word."""
    seen, missing = set(), []
    for o in out_items:
        for entry in o["fills"] if o["kind"] == "pattern" else [o]:
            for w in entry["words"]:
                if w["gloss"] is None and w["zh"] not in seen:
                    seen.add(w["zh"])
                    missing.append((o["id"], w["zh"], w["roman"]))
    return missing


def expand(items, root=ROOT, deck="mandarin", glossary=None):
    roman = DECKS[deck]["roman"]
    glossary = glossary or {}
    known = {i["zh"]: i["en"] for i in items if i["kind"] == "word"}
    out = []
    for it in items:
        no_yi = it.get("noYiSandhi", False)
        o = {"id": it["id"], "kind": it["kind"], "deck": deck}
        for k in ("week", "set"):
            if k in it:
                o[k] = it[k]
        if it["kind"] == "pattern":
            o["zh"] = SLOT_RE.sub("___", it["zh"])
            o["roman"] = SLOT_RE.sub("___", it[roman])
            o["en"] = SLOT_RE.sub("___", it["en"])
            cat = _slots(it["zh"])[0][0]
            o["fills"] = []
            for f in _fillers(items, cat):
                zh = _fill_text(it["zh"], f, "zh")
                fill_roman = _romanize(deck, zh, _fill_text(it[roman], f, roman), no_yi)
                fill_en = _fill_en(it["en"], f)
                o["fills"].append({
                    "fillId": f["id"],
                    "zh": zh,
                    "roman": fill_roman,
                    "en": fill_en,
                    "words": _words(zh, fill_roman, fill_en, known, glossary, it.get("gloss", {})),
                    "audio": _audio(f"{it['id']}--{f['id']}", deck, root),
                })
        else:
            o["zh"] = it["zh"]
            o["roman"] = _romanize(deck, it["zh"], it[roman], no_yi)
            o["en"] = it["en"]
            o["words"] = _words(it["zh"], o["roman"], it["en"], known, glossary, it.get("gloss", {}))
            o["audio"] = _audio(it["id"], deck, root)
        for k in ("note", "cat", "topic", "mission"):
            if k in it:
                o[k] = it[k]
        out.append(o)
    return out


def audio_jobs(out_items):
    """(path, text, rate, item_id, tts_voice) for every TTS file the output references."""
    jobs = []
    for o in out_items:
        for entry in o["fills"] if o["kind"] == "pattern" else [o]:
            for vid, (normal, slow) in entry["audio"].items():
                if vid == "coach":
                    continue
                tts = VOICES[vid]["tts"]
                jobs.append((normal, entry["zh"], NORMAL_RATE, o["id"], tts))
                jobs.append((slow, entry["zh"], SLOW_RATE, o["id"], tts))
    return jobs


def edge_synth(text, rate, path, voice):
    import edge_tts
    asyncio.run(edge_tts.Communicate(text, voice, rate=rate).save(str(path)))


def _synth_one(job, root, synth, retries, sleep):
    rel, text, rate, _, voice = job
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        try:
            synth(text, rate, path, voice)
            return True
        except Exception:
            if path.exists():
                path.unlink()
            sleep(2 * (attempt + 1))
    return False


def generate_audio(jobs, root, synth=edge_synth, force_ids=(), retries=4, sleep=time.sleep, workers=4):
    """Synthesize missing files. Returns (made, failed); the TTS service fails intermittently."""
    todo = [j for j in jobs if j[3] in force_ids or not ((root / j[0]).exists() and (root / j[0]).stat().st_size > 0)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        ok = list(pool.map(lambda j: _synth_one(j, root, synth, retries, sleep), todo))
    made = [j[0] for j, good in zip(todo, ok) if good]
    failed = [j[0] for j, good in zip(todo, ok) if not good]
    return made, failed


def stamp_service_worker(root):
    sw = root / "sw.js"
    if not sw.exists():
        return
    h = hashlib.sha256()
    files = [root / f for f in SHELL_FILES] + sorted(p for g in SHELL_GLOBS for p in root.glob(g))
    for p in files:
        if p.exists():
            h.update(p.read_bytes())
    text = sw.read_text()
    new = re.sub(r"const VERSION = '[^']*';", f"const VERSION = '{h.hexdigest()[:12]}';", text, count=1)
    if new != text:
        sw.write_text(new)


def main(argv):
    no_audio = "--no-audio" in argv
    force = {argv[i + 1] for i, a in enumerate(argv) if a == "--force" and i + 1 < len(argv)}
    out, errs = [], []
    glossary_file = ROOT / "data" / "glossary.json"
    glossary = json.loads(glossary_file.read_text()) if glossary_file.exists() else {}
    for deck, cfg in DECKS.items():
        src = ROOT / "data" / cfg["file"]
        if not src.exists():
            continue
        items = json.loads(src.read_text())["items"]
        errs += [f"[{deck}] {e}" for e in validate(items, deck)]
        if not errs:
            expanded = expand(items, deck=deck, glossary=glossary.get(deck, {}))
            errs += [f"[{deck}] {iid}: no meaning for {zh} ({r}); add it to data/glossary.json"
                     for iid, zh, r in missing_glosses(expanded)]
            out += expanded
    ids = [o["id"] for o in out]
    errs += [f"id {i!r} used in more than one deck" for i in sorted({i for i in ids if ids.count(i) > 1})]
    if errs:
        print(f"{len(errs)} error(s):")
        for e in errs:
            print("  -", e)
        return 1
    used = {v for o in out for e in (o.get("fills") or [o]) for v in e["audio"]}
    voices = {v: {k: VOICES[v][k] for k in ("flag", "name")} for v in VOICES if v in used}
    if "coach" in used:
        voices["coach"] = COACH
    decks = {d: {"label": c["label"], "voices": c["voices"]} for d, c in DECKS.items()}
    body = json.dumps([out, voices], ensure_ascii=False, sort_keys=True)
    doc = {"version": hashlib.sha256(body.encode()).hexdigest()[:12], "voices": voices, "decks": decks, "items": out}
    (ROOT / "phrases.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    made, failed = ([], []) if no_audio else generate_audio(audio_jobs(out), ROOT, force_ids=force)
    stamp_service_worker(ROOT)
    for deck in DECKS:
        mine = [o for o in out if o["deck"] == deck]
        fills = sum(len(o.get("fills", [])) for o in mine)
        print(f"{deck}: {len(mine)} items ({fills} pattern sentences)")
    print(f"{len(made)} audio files generated")
    if failed:
        print(f"{len(failed)} audio file(s) failed (re-run to retry): {', '.join(failed[:10])}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
