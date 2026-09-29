# /// script
# requires-python = ">=3.10"
# dependencies = ["mlx-whisper", "opencc-python-reimplemented", "numpy"]
# ///
"""Turn a recorded lesson into coach audio for the app.

Everything this writes stays next to the recording (a private folder outside the public app repo):
    <recording>.transcript.json   Whisper transcript with word timestamps (Traditional characters)
    <recording>.clips/            one clip per card the coach said, plus manifest.json

Usage:
    uv run tools/lesson.py transcribe "/path/to/lesson.mp4"
    uv run tools/lesson.py clips "/path/to/lesson.mp4"
    uv run tools/lesson.py publish "/path/to/lesson.mp4"   # upload clips to the PRIVATE sync repo
"""
import json
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

MODEL = "mlx-community/whisper-large-v3-turbo"
ROOT = Path(__file__).resolve().parent.parent


def to_wav(src: Path, dst: Path, rate: int):
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", str(src), str(dst)], check=True)


def transcribe(src: Path):
    import mlx_whisper
    from opencc import OpenCC

    import numpy as np

    out = src.with_suffix(".transcript.json")
    with tempfile.TemporaryDirectory() as d:
        wav = Path(d) / "lesson16k.wav"
        to_wav(src, wav, 16000)
        with wave.open(str(wav)) as w:
            # Whisper takes raw 16 kHz samples, so it doesn't need ffmpeg to read the file.
            samples = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        result = mlx_whisper.transcribe(
            samples,
            path_or_hf_repo=MODEL,
            language="zh",
            word_timestamps=True,
            initial_prompt="這是台灣華語老師的中文課。大家好，你們好，我叫……",
            condition_on_previous_text=False,
        )
    cc = OpenCC("s2twp")
    segments = []
    for seg in result["segments"]:
        words = [{"w": cc.convert(w["word"]), "start": w["start"], "end": w["end"]} for w in seg.get("words", [])]
        segments.append({"start": seg["start"], "end": seg["end"], "text": cc.convert(seg["text"]), "words": words})
    out.write_text(json.dumps({"model": MODEL, "segments": segments}, ensure_ascii=False, indent=1))
    print(f"{len(segments)} segments -> {out}")


HAN = lambda c: "\u3400" <= c <= "\u9fff"
PAD_BEFORE, PAD_AFTER = 0.15, 0.25


def char_timeline(transcript):
    """[(char, start, end, segment_index)] for every Han character, spreading each word's time evenly."""
    out = []
    for si, seg in enumerate(transcript["segments"]):
        for w in seg["words"]:
            chars = [c for c in w["w"] if HAN(c)]
            if not chars:
                continue
            step = (w["end"] - w["start"]) / len(chars)
            for i, c in enumerate(chars):
                out.append((c, w["start"] + i * step, w["start"] + (i + 1) * step, si))
    return out


def targets(items):
    """(key, characters) for every Mandarin card with audio: words, phrases and each pattern sentence."""
    for it in items:
        if it.get("deck", "mandarin") != "mandarin":
            continue
        entries = [(f"{it['id']}--{f['fillId']}", f["zh"]) for f in it["fills"]] if it["kind"] == "pattern" else [(it["id"], it["zh"])]
        for key, zh in entries:
            chars = "".join(c for c in zh if HAN(c))
            if chars:
                yield key, chars


def find_candidates(transcript, items):
    """{key: [clip, ...]}: every plausible moment the coach said each card, clearest first."""
    tl = char_timeline(transcript)
    text = "".join(c for c, *_ in tl)
    seg_han = ["".join(c for c in s["text"] if HAN(c)) for s in transcript["segments"]]
    out = {}
    for key, target in targets(items):
        found = []
        pos = text.find(target)
        while pos != -1:
            first, last = tl[pos], tl[pos + len(target) - 1]
            seg = first[3]
            alone = seg == last[3] and seg_han[seg] == target
            spoken = last[2] - first[1]
            plausible = 0.18 * len(target) <= spoken <= 0.9 * len(target) + 0.8
            if (len(target) > 1 or alone) and plausible:
                gap_before = first[1] - (tl[pos - 1][2] if pos > 0 else 0)
                gap_after = (tl[pos + len(target)][1] if pos + len(target) < len(tl) else 1e9) - last[2]
                score = (alone, min(gap_before, 1) + min(gap_after, 1), spoken)
                # Pad, but stop halfway into a neighbouring word so the clip doesn't pick it up.
                start = max(first[1] - PAD_BEFORE, first[1] - gap_before / 2 if pos > 0 else 0)
                end = min(last[2] + PAD_AFTER, last[2] + gap_after / 2)
                found.append((score, {"start": round(start, 2), "end": round(end, 2), "seg": seg, "text": transcript["segments"][seg]["text"]}))
            pos = text.find(target, pos + 1)
        if found:
            out[key] = [c for _, c in sorted(found, key=lambda x: x[0], reverse=True)]
    return out


def find_clips(transcript, items):
    """{key: clip}: the clearest moment the coach said each card."""
    return {k: v[0] for k, v in find_candidates(transcript, items).items()}


def _realign(s16, transcript, clip, target, cc):
    """Re-transcribe just the sentence around a candidate for precise timings; return a new clip or None."""
    import mlx_whisper
    seg = transcript["segments"][clip["seg"]]
    w0 = max(0.0, min(seg["start"], clip["start"]) - 0.4)
    w1 = max(seg["end"], clip["end"]) + 0.4
    r = mlx_whisper.transcribe(s16[int(w0 * 16000):int(w1 * 16000)], path_or_hf_repo=MODEL, language="zh",
                               word_timestamps=True, condition_on_previous_text=False)
    local = {"segments": [{"text": cc.convert(x["text"]), "start": x["start"] + w0, "end": x["end"] + w0,
                           "words": [{"w": cc.convert(w["word"]), "start": w["start"] + w0, "end": w["end"] + w0} for w in x.get("words", [])]}
                          for x in r["segments"]]}
    c = find_clips(local, [{"id": "t", "kind": "word", "deck": "mandarin", "zh": target}]).get("t")
    if c:
        c["text"] = seg["text"]
    return c


def _heard(samples16k, cc):
    """What Whisper hears in a short clip, as Han characters (Traditional)."""
    import mlx_whisper
    r = mlx_whisper.transcribe(samples16k, path_or_hf_repo=MODEL, language="zh", condition_on_previous_text=False)
    return "".join(c for c in cc.convert(r["text"]) if HAN(c))


def clips(src: Path):
    import numpy as np
    from opencc import OpenCC

    cc = OpenCC("s2twp")
    transcript = json.loads(src.with_suffix(".transcript.json").read_text())
    items = json.loads((ROOT / "phrases.json").read_text())["items"]
    want = dict(targets(items))
    candidates = find_candidates(transcript, items)
    found = {}
    out = src.with_suffix(".clips")
    out.mkdir(exist_ok=True)
    rejected = []
    with tempfile.TemporaryDirectory() as d:
        wav, wav16 = Path(d) / "lesson.wav", Path(d) / "lesson16.wav"
        to_wav(src, wav, 44100)
        to_wav(src, wav16, 16000)
        with wave.open(str(wav)) as w:
            rate, frames = w.getframerate(), w.readframes(w.getnframes())
        with wave.open(str(wav16)) as w:
            s16 = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        bps = 2  # 16-bit mono
        for key, options in candidates.items():
            # Keep a clip only if Whisper, listening to just that clip, hears the phrase in it. If the first cut
            # misses, re-time it from its own sentence; try up to four places the coach said it.
            c, heard = None, ""
            for option in options[:4]:
                for attempt in (option, _realign(s16, transcript, option, want[key], cc)):
                    if attempt is None:
                        continue
                    heard = _heard(s16[int(attempt["start"] * 16000):int(attempt["end"] * 16000)], cc)
                    if want[key] in heard:
                        c = attempt
                        break
                if c:
                    break
            if not c:
                rejected.append((key, heard))
                continue
            found[key] = c
            a, b = int(c["start"] * rate) * bps, int(c["end"] * rate) * bps
            piece = Path(d) / f"{key}.wav"
            with wave.open(str(piece), "wb") as o:
                o.setnchannels(1)
                o.setsampwidth(2)
                o.setframerate(rate)
                o.writeframes(frames[a:b])
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "96000", str(piece), str(out / f"{key}.m4a")], check=True)
            c["file"] = f"{key}.m4a"
    (out / "manifest.json").write_text(json.dumps({"lesson": src.stem, "clips": found}, ensure_ascii=False, indent=1))
    print(f"{len(found)} clips kept, {len(rejected)} rejected -> {out}")
    for key, heard in rejected:
        print(f"  rejected {key}: heard {heard!r}")


PRIVATE_REPO = "tomvannuenen/mandarin-progress"


def _gh(*args, input_text=None):
    r = subprocess.run(["gh", "api", *args], input=input_text, capture_output=True, text=True)
    return r.returncode, r.stdout


def _put(path, data: bytes, message):
    import base64
    code, out = _gh(f"repos/{PRIVATE_REPO}/contents/{path}", "--jq", ".sha")
    body = {"message": message, "content": base64.b64encode(data).decode()}
    if code == 0 and out.strip():
        body["sha"] = out.strip()
    code, out = _gh("-X", "PUT", f"repos/{PRIVATE_REPO}/contents/{path}", "--input", "-", input_text=json.dumps(body))
    if code != 0:
        raise RuntimeError(f"upload failed for {path}: {out}")


def publish(src: Path):
    """Upload clips to the private sync repo (never the public app). Earlier lessons' clips are kept."""
    import base64
    code, out = _gh(f"repos/{PRIVATE_REPO}", "--jq", ".private")
    if out.strip() != "true":
        raise SystemExit(f"{PRIVATE_REPO} is not private; refusing to upload coach audio.")
    local = json.loads((src.with_suffix(".clips") / "manifest.json").read_text())
    code, out = _gh(f"repos/{PRIVATE_REPO}/contents/coach/manifest.json", "--jq", ".content")
    merged = json.loads(base64.b64decode(out)) if code == 0 and out.strip() else {"clips": {}}
    added = 0
    for key, c in local["clips"].items():
        if key in merged["clips"]:
            continue  # keep the clip from the earlier lesson
        _put(f"coach/{c['file']}", (src.with_suffix(".clips") / c["file"]).read_bytes(), f"Coach clip {key}")
        merged["clips"][key] = {"file": c["file"], "lesson": local["lesson"], "text": c["text"]}
        added += 1
    _put("coach/manifest.json", json.dumps(merged, ensure_ascii=False, indent=1).encode(), f"Coach clips from {local['lesson']}")
    print(f"{added} new clips uploaded ({len(merged['clips'])} total)")


if __name__ == "__main__":
    cmd, path = sys.argv[1], Path(sys.argv[2])
    {"transcribe": transcribe, "clips": clips, "publish": publish}[cmd](path)
