# /// script
# requires-python = ">=3.9"
# dependencies = ["edge-tts", "opencc-python-reimplemented"]
# ///
"""Build phrases.json and audio from data/items.json.

Usage:
    uv run tools/build.py                # validate, generate missing audio, write phrases.json
    uv run tools/build.py --no-audio     # skip audio generation
    uv run tools/build.py --force ID     # regenerate audio for item ID (repeatable)
"""
import asyncio
import hashlib
import json
import re
import sys
import time
from pathlib import Path

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tools.pinyin import apply_sandhi

ROOT = Path(__file__).resolve().parent.parent
VOICE = "zh-TW-YunJheNeural"
SLOW_RATE = "-30%"
NORMAL_RATE = "+0%"
KINDS = {"word", "phrase", "pattern"}
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SLOT_RE = re.compile(r"\{(\w+)(?::(\w+))?\}")
# Characters OpenCC "corrects" that are standard everyday Traditional in Taiwan.
ALLOWED_TRAD_VARIANTS = set("台")
SHELL_FILES = ["index.html", "styles.css", "app.js", "manifest.webmanifest", "phrases.json"]
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


def validate(items):
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
        missing = [k for k in ("zh", "pinyin", "en") if not it.get(k)]
        if not it.get("week") and not it.get("set"):
            missing.append("week (or set)")
        if missing:
            errs.append(f"{iid}: missing {', '.join(missing)}")
            continue
        bad = simplified_chars(SLOT_RE.sub("", it["zh"]), it.get("allowChars", ""))
        if bad:
            errs.append(f"{iid}: Simplified characters {''.join(bad)} in {it['zh']!r}")
        no_yi = it.get("noYiSandhi", False)
        if it["kind"] != "pattern":
            try:
                apply_sandhi(it["zh"], it["pinyin"], no_yi)
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
                apply_sandhi(_fill_text(it["zh"], f, "zh"), _fill_text(it["pinyin"], f, "pinyin"), no_yi)
            except ValueError as e:
                errs.append(f"{iid} + {f.get('id')}: {e}")
    return errs


def _audio_paths(key, root):
    coach = Path("audio/coach") / f"{key}.mp3"
    normal = coach if (root / coach).exists() else Path("audio") / f"{key}.mp3"
    return normal.as_posix(), f"audio/{key}-slow.mp3"


def expand(items, root=ROOT):
    out = []
    for it in items:
        no_yi = it.get("noYiSandhi", False)
        o = {"id": it["id"], "kind": it["kind"]}
        for k in ("week", "set"):
            if k in it:
                o[k] = it[k]
        if it["kind"] == "pattern":
            blank = SLOT_RE.sub("___", it["zh"])
            o["zh"] = blank
            o["pinyin"] = SLOT_RE.sub("___", it["pinyin"])
            o["en"] = SLOT_RE.sub("___", it["en"])
            cat = _slots(it["zh"])[0][0]
            o["fills"] = []
            for f in _fillers(items, cat):
                zh = _fill_text(it["zh"], f, "zh")
                a, s = _audio_paths(f"{it['id']}--{f['id']}", root)
                o["fills"].append({
                    "fillId": f["id"],
                    "zh": zh,
                    "pinyin": apply_sandhi(zh, _fill_text(it["pinyin"], f, "pinyin"), no_yi),
                    "en": _fill_en(it["en"], f),
                    "audio": a,
                    "audioSlow": s,
                })
        else:
            o["zh"] = it["zh"]
            o["pinyin"] = apply_sandhi(it["zh"], it["pinyin"], no_yi)
            o["en"] = it["en"]
            o["audio"], o["audioSlow"] = _audio_paths(it["id"], root)
        for k in ("note", "cat"):
            if k in it:
                o[k] = it[k]
        out.append(o)
    return out


def audio_jobs(out_items):
    """(path, text, rate, item_id) for every TTS file the output references."""
    jobs = []
    for o in out_items:
        for entry in o.get("fills", [o]) if o["kind"] == "pattern" else [o]:
            if not entry["audio"].startswith("audio/coach/"):
                jobs.append((entry["audio"], entry["zh"], NORMAL_RATE, o["id"]))
            jobs.append((entry["audioSlow"], entry["zh"], SLOW_RATE, o["id"]))
    return jobs


def edge_synth(text, rate, path):
    import edge_tts
    asyncio.run(edge_tts.Communicate(text, VOICE, rate=rate).save(str(path)))


def generate_audio(jobs, root, synth=edge_synth, force_ids=(), retries=4, sleep=time.sleep):
    """Synthesize missing files. Returns (made, failed); the TTS service fails intermittently."""
    made, failed = [], []
    for rel, text, rate, iid in jobs:
        path = root / rel
        if path.exists() and path.stat().st_size > 0 and iid not in force_ids:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(retries):
            try:
                synth(text, rate, path)
                made.append(rel)
                break
            except Exception:
                if path.exists():
                    path.unlink()
                sleep(2 * (attempt + 1))
        else:
            failed.append(rel)
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
    items = json.loads((ROOT / "data" / "items.json").read_text())["items"]
    errs = validate(items)
    if errs:
        print(f"{len(errs)} error(s):")
        for e in errs:
            print("  -", e)
        return 1
    out = expand(items)
    body = json.dumps(out, ensure_ascii=False, sort_keys=True)
    doc = {"version": hashlib.sha256(body.encode()).hexdigest()[:12], "items": out}
    (ROOT / "phrases.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    made, failed = ([], []) if no_audio else generate_audio(audio_jobs(out), ROOT, force_ids=force)
    stamp_service_worker(ROOT)
    fills = sum(len(o.get("fills", [])) for o in out)
    print(f"{len(out)} items ({fills} pattern sentences), {len(made)} audio files generated")
    if failed:
        print(f"{len(failed)} audio file(s) failed (re-run to retry): {', '.join(failed)}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
