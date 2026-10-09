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
        # Starting from zero: a few new phrases a day and none while earlier ones are still shaky, only the
        # three weakest flagged words as warm-up, and no character cards yet.
        "newPerDay": 3, "maxShaky": 5, "maxDrills": 3, "characters": False,
    },
}
SLOW_RATE = "-30%"
NORMAL_RATE = "+0%"
KINDS = {"word", "phrase", "pattern"}
# How a phrase sounds, shown on its card. Leave it out when there is nothing to contrast it with.
REGISTERS = {"everyday", "casual", "polite", "formal"}
# When an item is introduced: 0 = essentials (before everything), 1 = the default, 2 = later (the politer,
# more formal or less common way to say something that already has an everyday card).
TIERS = {0, 1, 2}
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SLOT_RE = re.compile(r"\{(\w+)(?::(\w+))?\}")
# Characters OpenCC "corrects" that are standard everyday Traditional in Taiwan.
ALLOWED_TRAD_VARIANTS = set("台")

# Words shown in Traditional for the :char recognition drill because Tom will actually see them
# written around Hong Kong (menus, signage, campus, his own bio). Everything else in the Mandarin
# deck defaults to Simplified for that drill, so reading practice doesn't spend effort on glyphs he
# won't encounter printed here. This is a judgement call, not a fixed rule -- edit the set freely.
HK_SCRIPT_WORDS = {
    # food & drink (menus, cha chaan teng signage)
    "咖啡", "水", "奶茶", "葡萄酒", "啤酒", "辣", "麻婆豆腐", "三明治", "雞肉", "肉",
    "茶餐廳", "菠蘿包", "油", "蛋塔", "粥",
    # places & campus
    "香港", "中文大學", "大學", "教授", "老師", "學生", "辦公室", "荷蘭",
    # everyday courtesy / signage
    "謝謝", "請", "可以", "問題", "沒問題",
    # numbers & measure words (menus, receipts, signs)
    "一", "二", "兩", "杯", "個",
}
SHELL_FILES = ["index.html", "styles.css", "app.js", "ui.js", "icons.js", "fonts/fonts.css", "book.js", "tonecheck.js", "convo.js", "rec.js", "coach.js", "manifest.webmanifest", "phrases.json"]
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


_cc_t2s = None


def to_simplified(zh):
    global _cc_t2s
    if _cc_t2s is None:
        from opencc import OpenCC
        _cc_t2s = OpenCC("t2s")
    return _cc_t2s.convert(zh)


def word_script(zh, deck):
    """'hk' (Traditional) or 'cn' (Simplified) for the :char recognition drill. Only the Mandarin
    deck splits by script; Cantonese is inherently Hong Kong Traditional."""
    return "hk" if deck != "mandarin" or zh in HK_SCRIPT_WORDS else "cn"


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
        if "register" in it and it["register"] not in REGISTERS:
            errs.append(f"{iid}: register must be one of {sorted(REGISTERS)}")
        if "tier" in it and it["tier"] not in TIERS:
            errs.append(f"{iid}: tier must be 0 (essentials), 1 or 2 (later)")
        if "swap" in it:
            errs += [f"{iid}: {e}" for e in _swap_errors(it, deck, roman)]
        if it["kind"] != "pattern":
            try:
                _romanize(deck, it["zh"], it[roman], no_yi)
            except ValueError as e:
                errs.append(f"{iid}: {e}")
            continue
        if it.get("mine") and it["mine"] not in {f["id"] for f in _fillers(items, _slots(it["zh"])[0][0] if _slots(it["zh"]) else "")}:
            errs.append(f"{iid}: 'mine' must be one of the pattern's fill words")
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


def _swap_errors(it, deck, roman):
    """swap = {"word": <a word of the phrase>, "with": [[zh, roman, en], ...]}: the part you can replace."""
    sw = it["swap"]
    if it.get("kind") != "phrase" or not isinstance(sw, dict) or not sw.get("word") or not sw.get("with"):
        return ["swap needs a phrase, a 'word' and a 'with' list of [characters, romanisation, English]"]
    errs = []
    try:
        if sw["word"] not in [z for z, _ in word_groups(it["zh"], it[roman])]:
            errs.append(f"swap word {sw['word']!r} is not one of the phrase's words")
    except ValueError:
        pass
    for alt in sw["with"]:
        if not (isinstance(alt, list) and len(alt) == 3 and all(alt)):
            errs.append(f"swap alternative {alt!r} must be [characters, romanisation, English]")
            continue
        bad = simplified_chars(alt[0], it.get("allowChars", ""))
        if bad:
            errs.append(f"Simplified characters {''.join(bad)} in swap alternative {alt[0]!r}")
        try:
            _romanize(deck, alt[0], alt[1])
        except ValueError as e:
            errs.append(f"swap alternative {alt[0]}: {e}")
    return errs


def simplified_map(out_items):
    """{Traditional: Simplified} for every character the Mandarin deck shows, so the app can switch script."""
    text = []
    for o in out_items:
        if o["deck"] != "mandarin":
            continue
        text.append(o.get("note", "") + o.get("order", ""))
        for alt in o.get("swap", {}).get("with", []):
            text.append(alt["zh"])
        for entry in o.get("fills") or [o]:
            text.append(entry["zh"])
    chars = sorted({c for c in "".join(text) if "\u3400" <= c <= "\u9fff"})
    return {c: to_simplified(c) for c in chars if to_simplified(c) != c}


NOTE_RUN = re.compile(r"[\u3400-\u9fff]+(?:…[\u3400-\u9fff]+)*")
_PUNCT = re.compile(r"[？！，。?!,.\s]")


def note_glosses(out_items, manual=None):
    """({deck: {chinese: {r, e, k?}}}, errors): pinyin and meaning for every piece of Chinese inside a note.
    Taken from the deck when the piece is one of its phrases or words, else from data/note-glosses.json."""
    manual = manual or {}
    table, errs = {}, []
    for deck in DECKS:
        mine = [o for o in out_items if o["deck"] == deck]
        known = {}
        for o in mine:
            for e in o.get("fills") or [o]:
                known.setdefault(_PUNCT.sub("", e["zh"]), (e["roman"], e["en"]))
        for o in mine:
            for e in o.get("fills") or [o]:
                for w in e["words"]:
                    if w["gloss"]:
                        known.setdefault(w["zh"], (w["roman"], w["gloss"]))
        for o in mine:
            for run in NOTE_RUN.findall(o.get("note", "")):
                if run in table.get(deck, {}):
                    continue
                if run in manual.get(deck, {}):
                    r, e, *kind = manual[deck][run]
                    han = [c for c in run if c != "…"]
                    if len(re.split(r"[-\s]+", r.replace("…", "").strip())) != len(han):
                        errs.append(f"[{deck}] note-glosses.json: {run} needs one syllable per character, got {r!r}")
                        continue
                    pinyin = deck == "mandarin" or kind == ["mandarin"]
                    g = {"r": apply_sandhi(run, r, False) if pinyin and "…" not in run else r, "e": e}
                    if kind:
                        g["k"] = kind[0]
                elif run in known:
                    g = {"r": known[run][0], "e": known[run][1]}
                else:
                    errs.append(f"[{deck}] {o['id']}: the note uses {run} with no meaning; add it to data/note-glosses.json")
                    continue
                table.setdefault(deck, {})[run] = g
    return table, errs


IDS_OPERATORS = set("⿰⿱⿲⿳⿴⿵⿶⿷⿸⿹⿺⿻？")
HANZI_SOURCE = ROOT / ".local" / "mmah-dictionary.txt"  # Make Me a Hanzi dictionary.txt (not in the repo)


def _short(definition, limit=48):
    """The first sense or two of a dictionary definition."""
    senses = [s.strip() for s in (definition or "").split(";") if s.strip()]
    text = senses[0] if senses else ""
    if len(senses) > 1 and len(text) + len(senses[1]) + 2 <= limit:
        text += "; " + senses[1]
    return text


def hanzi_entry(rec):
    """One Make Me a Hanzi record as {d meaning, p pinyin, c components, s meaning part, ph sound part, h hint}."""
    ety = rec.get("etymology") or {}
    parts = "".join(ch for ch in rec.get("decomposition", "") if ch not in IDS_OPERATORS and ch != rec["character"])
    e = {"d": _short(rec.get("definition")), "p": (rec.get("pinyin") or [""])[0], "c": parts}
    if ety.get("type") == "pictophonetic":
        e.update({k: v for k, v in (("s", ety.get("semantic")), ("ph", ety.get("phonetic"))) if v and v in parts})
    elif ety.get("hint"):
        e["h"] = ety["hint"].replace("\xa0", " ")
    return e


def hanzi_table(chars, source, extra=None):
    """Breakdowns for these characters and, so every part can be tapped too, for the parts inside them."""
    extra = extra or {}
    table, todo = {}, sorted(chars)
    while todo:
        ch = todo.pop()
        if ch in table or (ch not in source and ch not in extra):
            continue
        e = {**(hanzi_entry(source[ch]) if ch in source else {"d": "", "p": "", "c": ""}), **extra.get(ch, {})}
        table[ch] = {k: v for k, v in e.items() if v}
        todo += list(e.get("c") or "")
    return dict(sorted(table.items()))


def load_hanzi(out_items, t2s, root=ROOT):
    """data/hanzi.json is the committed table; it is refreshed whenever the dictionary file is on this machine."""
    file = root / "data" / "hanzi.json"
    table = json.loads(file.read_text()) if file.exists() else {}
    text = "".join(e["zh"] for o in out_items for e in (o.get("fills") or [o]))
    text += "".join(a["zh"] for o in out_items for a in o.get("swap", {}).get("with", []))
    chars = {c for c in text if "\u3400" <= c <= "\u9fff"}
    chars |= {t2s[c] for c in chars if c in t2s}
    if HANZI_SOURCE.exists():
        source = {}
        for line in HANZI_SOURCE.read_text().splitlines():
            rec = json.loads(line)
            source[rec["character"]] = rec
        extra_file = root / "data" / "hanzi-extra.json"
        extra = {k: v for k, v in json.loads(extra_file.read_text()).items() if not k.startswith("_")} if extra_file.exists() else {}
        fresh = hanzi_table(chars, source, extra)
        if fresh != table:
            file.write_text(json.dumps(fresh, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
        table = fresh
    return table, sorted(c for c in chars if c not in table)


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


def _word(z, r, gloss, deck):
    """A single word entry, tagged with the script its :char recognition card should show."""
    w = {"zh": z, "roman": r.rstrip("?!.,…"), "gloss": gloss, "script": word_script(z, deck)}
    if w["script"] == "cn":
        w["zhDisp"] = to_simplified(z)
    # The Simplified form, when it differs, so the learner can switch script on any word.
    if deck == "mandarin" and to_simplified(z) != z:
        w["zhS"] = to_simplified(z)
    return w


def _words(zh, roman, en, known, glossary, overrides, deck="mandarin"):
    """Word-by-word breakdown [{zh, roman, gloss, script, zhDisp?}] for tap-to-translate and the
    :char drill; gloss is None when unknown."""
    groups = word_groups(zh, roman)
    if len(groups) == 1:
        return [_word(groups[0][0], groups[0][1], en, deck)]
    return [
        _word(z, r, overrides.get(z) or known.get(z) or glossary.get(z), deck)
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
                    "words": _words(zh, fill_roman, fill_en, known, glossary, it.get("gloss", {}), deck),
                    **({"situation": _fill_en(it["situation"], f)} if it.get("situation") else {}),
                    "audio": _audio(f"{it['id']}--{f['id']}", deck, root),
                })
        else:
            o["zh"] = it["zh"]
            o["roman"] = _romanize(deck, it["zh"], it[roman], no_yi)
            o["en"] = it["en"]
            o["words"] = _words(it["zh"], o["roman"], it["en"], known, glossary, it.get("gloss", {}), deck)
            o["audio"] = _audio(it["id"], deck, root)
            if it["kind"] == "phrase" and len(o["words"]) >= 3:
                # Recordings of the sentence's tail, growing a word at a time: for building it up from the end.
                o["chunks"] = {str(k): f"audio/chunks/{it['id']}--{k}.mp3" for k in range(1, len(o["words"]))}
        if it["kind"] == "pattern" and "situation" in it:
            o["situation"] = SLOT_RE.sub("___", it["situation"])
        elif "situation" in it:
            o["situation"] = it["situation"]
        for k in ("note", "cat", "topic", "mission", "mine", "wish", "register", "tier", "order"):
            if k in it:
                o[k] = it[k]
        if "swap" in it:
            o["swap"] = {"word": it["swap"]["word"],
                         "with": [{"zh": z, "roman": _romanize(deck, z, r), "en": e} for z, r, e in it["swap"]["with"]]}
        out.append(o)
    return out


def validate_conversations(convos, out_items):
    """Conversations are scripts over existing items: [{id, title, deck, turns: [{who, ref, fill?}]}]."""
    by_key = {(o["deck"], o["id"]): o for o in out_items}
    errs, seen = [], set()
    for c in convos:
        cid = c.get("id", "?")
        if cid in seen:
            errs.append(f"conversation {cid}: duplicate id")
        seen.add(cid)
        if c.get("deck") not in DECKS or not c.get("title") or not c.get("turns"):
            errs.append(f"conversation {cid}: needs a title, a deck ({'/'.join(DECKS)}) and turns")
            continue
        for n, t in enumerate(c["turns"], 1):
            where = f"conversation {cid} turn {n}"
            if t.get("who") not in ("them", "you"):
                errs.append(f"{where}: who must be 'them' or 'you'")
            item = by_key.get((c["deck"], t.get("ref")))
            if not item:
                errs.append(f"{where}: no {c['deck']} item {t.get('ref')!r}")
            elif item["kind"] == "pattern":
                if t.get("fill") not in {f["fillId"] for f in item["fills"]}:
                    errs.append(f"{where}: pattern {item['id']} needs a valid fill (got {t.get('fill')!r})")
    return errs


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
        if "chunks" in o:
            tts = VOICES[DECKS[o["deck"]]["voices"][1]]["tts"]
            for k, path in o["chunks"].items():
                jobs.append((path, "".join(w["zh"] for w in o["words"][-int(k):]), NORMAL_RATE, o["id"], tts))
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
    # A service worker that doesn't parse never installs, and phones then stay on the old app for good.
    if re.search(r"^(<{7}|={7}|>{7})( |$)", text, re.M):
        raise SystemExit("sw.js contains merge conflict markers; resolve them before building")
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
    convo_file = ROOT / "data" / "conversations.json"
    convos = json.loads(convo_file.read_text())["conversations"] if convo_file.exists() else []
    errs = validate_conversations(convos, out)
    if errs:
        print(f"{len(errs)} error(s):")
        for e in errs:
            print("  -", e)
        return 1
    gloss_file = ROOT / "data" / "note-glosses.json"
    notes, errs = note_glosses(out, json.loads(gloss_file.read_text()) if gloss_file.exists() else {})
    if errs:
        print(f"{len(errs)} error(s):")
        for e in errs:
            print("  -", e)
        return 1
    used = {v for o in out for e in (o.get("fills") or [o]) for v in e["audio"]}
    voices = {v: {k: VOICES[v][k] for k in ("flag", "name")} for v in VOICES if v in used}
    if "coach" in used:
        voices["coach"] = COACH
    decks = {d: {k: c[k] for k in ("label", "voices", "newPerDay", "maxShaky", "maxDrills", "characters") if k in c} for d, c in DECKS.items()}
    body = json.dumps([out, voices], ensure_ascii=False, sort_keys=True)
    body += json.dumps(convos, ensure_ascii=False, sort_keys=True)
    t2s = simplified_map(out)
    body += json.dumps(t2s, ensure_ascii=False, sort_keys=True)
    hanzi, no_breakdown = load_hanzi(out, t2s)
    body += json.dumps([hanzi, notes], ensure_ascii=False, sort_keys=True)
    doc = {"version": hashlib.sha256(body.encode()).hexdigest()[:12], "voices": voices, "decks": decks, "items": out,
           "conversations": convos, "t2s": t2s, "hanzi": hanzi, "notes": notes}
    (ROOT / "phrases.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    made, failed = ([], []) if no_audio else generate_audio(audio_jobs(out), ROOT, force_ids=force)
    stamp_service_worker(ROOT)
    for deck in DECKS:
        mine = [o for o in out if o["deck"] == deck]
        fills = sum(len(o.get("fills", [])) for o in mine)
        print(f"{deck}: {len(mine)} items ({fills} pattern sentences)")
    if no_breakdown:
        print(f"no character breakdown for: {''.join(no_breakdown)} (add them to data/hanzi-extra.json)")
    print(f"{len(made)} audio files generated")
    if failed:
        print(f"{len(failed)} audio file(s) failed (re-run to retry): {', '.join(failed[:10])}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
