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
                found.append((score, {"start": round(start, 2), "end": round(end, 2), "t0": first[1], "t1": last[2],
                                     "alone": alone, "seg": seg, "text": transcript["segments"][seg]["text"]}))
            pos = text.find(target, pos + 1)
        if found:
            out[key] = [c for _, c in sorted(found, key=lambda x: x[0], reverse=True)]
    return out


def find_clips(transcript, items):
    """{key: clip}: the clearest moment the coach said each card."""
    return {k: v[0] for k, v in find_candidates(transcript, items).items()}


FRAME = 0.01        # loudness is measured in 10 ms frames
MIN_PAUSE = 0.12    # a gap this long is a real pause, not a consonant closure inside a word


def loudness(samples16k):
    """Loudness in dB for every 10 ms frame."""
    import numpy as np
    n = int(16000 * FRAME)
    f = samples16k[: len(samples16k) // n * n].reshape(-1, n)
    return 10 * np.log10((f.astype("float64") ** 2).mean(1) + 1e-10)


def pauses(db, threshold=None):
    """[(start, end)] in seconds of every stretch of silence at least MIN_PAUSE long."""
    import numpy as np
    if threshold is None:
        threshold = np.percentile(db, 90) - 30   # well below the coach's speaking level
    quiet = np.concatenate([[False], db < threshold, [False]])
    edges = np.flatnonzero(quiet[1:] != quiet[:-1])
    return [(a * FRAME, b * FRAME) for a, b in zip(edges[::2], edges[1::2]) if (b - a) * FRAME >= MIN_PAUSE]


def snaps(clip, gaps, n_chars):
    """Cuts that run from one pause to another around where Whisper placed the phrase, closest first. Whisper's
    timings drift by a syllable or so, so every run of speech stretches near it is a candidate; the listening check
    picks the right one. Empty if the phrase was said mid-sentence with no pauses around it."""
    t0, t1 = clip["t0"], clip["t1"]
    near = [i for i in range(len(gaps) - 1) if gaps[i][1] < t1 + 0.4 and gaps[i + 1][0] > t0 - 0.4]
    out = []
    for i in near:
        for j in near:
            if j < i:
                continue
            b, a = gaps[i], gaps[j + 1]       # the pauses before and after this run of speech
            spoken = a[0] - b[1]
            if not 0.15 * n_chars <= spoken <= 0.7 * n_chars + 0.6:
                continue
            drift = abs(b[1] - t0) + abs(a[0] - t1)
            out.append((drift, {**clip, "start": round(max(b[0], b[1] - 0.1), 2), "end": round(min(a[1], a[0] + 0.15), 2),
                                "quiet": round(min(b[1] - b[0], 0.5) + min(a[1] - a[0], 0.5), 2)}))
    return [c for _, c in sorted(out, key=lambda x: x[0])]


def _heard(samples16k, cc):
    """What Whisper hears in a short clip when told it's Chinese: (Han characters in Traditional, confidence,
    word times)."""
    import mlx_whisper
    r = mlx_whisper.transcribe(samples16k, path_or_hf_repo=MODEL, language="zh", word_timestamps=True,
                               condition_on_previous_text=False)
    conf = min((s["avg_logprob"] for s in r["segments"]), default=-9.0)
    words = [(w["start"], w["end"]) for s in r["segments"] for w in s.get("words", [])]
    return "".join(c for c in cc.convert(r["text"]) if HAN(c)), conf, words


MAX_UNHEARD = 0.4   # seconds of speech in a clip that no recognised word accounts for


def unheard(samples16k, words):
    """Seconds of loud audio in a clip that lie outside every recognised word (e.g. English Whisper left out)."""
    import numpy as np
    db = loudness(samples16k)
    loud = np.flatnonzero(db > np.percentile(db, 95) - 30) * FRAME
    return sum(FRAME for t in loud if not any(a - 0.15 <= t <= b + 0.15 for a, b in words))


def only_the_phrase(samples16k, target, cc):
    """Told to pick the language itself, Whisper still hears just the phrase: no English around it, no doubt."""
    import mlx_whisper
    text = mlx_whisper.transcribe(samples16k, path_or_hf_repo=MODEL, condition_on_previous_text=False)["text"]
    if any(c.isalpha() and not HAN(c) for c in text):
        return False
    return "".join(c for c in cc.convert(text) if HAN(c)) == target


def score(clip, conf):
    """Higher is better: clear pauses around it, said on its own, Whisper sure of what it heard."""
    return clip["quiet"] + (0.5 if clip.get("alone") else 0) + conf


def best_clip(target, options, s16, gaps, cc):
    """Try the places the coach said a phrase and keep the cleanest cut; (clip, why-not) if none passes."""
    passed, tried, why = [], set(), "never set off by pauses"
    for option in options[:6]:
        for c in snaps(option, gaps, len(target))[:4]:
            if (c["start"], c["end"]) in tried:
                continue
            tried.add((c["start"], c["end"]))
            x = s16[int(c["start"] * 16000):int(c["end"] * 16000)]
            heard, conf, words = _heard(x, cc)
            if heard != target:   # anything more is a neighbouring word, anything less is cut off
                why = f"heard {heard!r}"
                continue
            if unheard(x, words) > MAX_UNHEARD or not only_the_phrase(x, target, cc):
                why = "other speech in the clip"
                continue
            passed.append((score(c, conf), c))
            break
        if len(passed) >= 2:
            break
    if not passed:
        return None, why
    s, c = max(passed, key=lambda x: x[0])
    return {**c, "score": round(s, 2)}, None


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
    if out.exists():
        for old in out.glob("*.m4a"):
            old.unlink()
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
        gaps = pauses(loudness(s16))
        bps = 2  # 16-bit mono
        for key, options in candidates.items():
            c, why = best_clip(want[key], options, s16, gaps, cc)
            if not c:
                rejected.append((key, why))
                continue
            found[key] = {k: c[k] for k in ("start", "end", "seg", "text", "score")}
            a, b = int(c["start"] * rate) * bps, int(c["end"] * rate) * bps
            piece = Path(d) / f"{key}.wav"
            with wave.open(str(piece), "wb") as o:
                o.setnchannels(1)
                o.setsampwidth(2)
                o.setframerate(rate)
                o.writeframes(frames[a:b])
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "96000", str(piece), str(out / f"{key}.m4a")], check=True)
            found[key]["file"] = f"{key}.m4a"
    (out / "manifest.json").write_text(json.dumps({"lesson": src.stem, "clips": found}, ensure_ascii=False, indent=1))
    print(f"{len(found)} clips kept, {len(rejected)} rejected -> {out}")
    for key, why in rejected:
        print(f"  rejected {key}: {why}")


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


def _delete(path, message):
    code, sha = _gh(f"repos/{PRIVATE_REPO}/contents/{path}", "--jq", ".sha")
    if code == 0 and sha.strip():
        _gh("-X", "DELETE", f"repos/{PRIVATE_REPO}/contents/{path}", "-f", f"message={message}", "-f", f"sha={sha.strip()}")


def merge(remote, local):
    """New manifest plus (uploads, removals). This lesson's clips replace its earlier cut; a clip from another
    lesson is replaced only by a better-scoring one; this lesson's clips that no longer pass are removed."""
    lesson, clips = local["lesson"], dict(remote.get("clips", {}))
    removals = [k for k, c in clips.items() if c["lesson"] == lesson and k not in local["clips"]]
    for k in removals:
        del clips[k]
    uploads = []
    for key, c in local["clips"].items():
        old = clips.get(key)
        if old and old["lesson"] != lesson and old.get("score", -99) >= c["score"]:
            continue
        entry = {"file": c["file"], "lesson": lesson, "text": c["text"], "score": c["score"], "v": c["v"]}
        if old != entry:
            clips[key] = entry
            uploads.append(key)
    return {"clips": clips}, uploads, removals


def publish(src: Path):
    """Upload clips to the private sync repo (never the public app)."""
    import base64
    import hashlib
    code, out = _gh(f"repos/{PRIVATE_REPO}", "--jq", ".private")
    if out.strip() != "true":
        raise SystemExit(f"{PRIVATE_REPO} is not private; refusing to upload coach audio.")
    folder = src.with_suffix(".clips")
    local = json.loads((folder / "manifest.json").read_text())
    for c in local["clips"].values():
        c["v"] = hashlib.sha1((folder / c["file"]).read_bytes()).hexdigest()[:10]
    code, out = _gh(f"repos/{PRIVATE_REPO}/contents/coach/manifest.json", "--jq", ".content")
    remote = json.loads(base64.b64decode(out)) if code == 0 and out.strip() else {"clips": {}}
    merged, uploads, removals = merge(remote, local)
    for key in uploads:
        c = local["clips"][key]
        _put(f"coach/{c['file']}", (folder / c["file"]).read_bytes(), f"Coach clip {key}")
    for key in removals:
        _delete(f"coach/{remote['clips'][key]['file']}", f"Drop coach clip {key}")
    _put("coach/manifest.json", json.dumps(merged, ensure_ascii=False, indent=1).encode(), f"Coach clips from {local['lesson']}")
    print(f"{len(uploads)} uploaded, {len(removals)} removed ({len(merged['clips'])} total)")


if __name__ == "__main__":
    cmd, path = sys.argv[1], Path(sys.argv[2])
    {"transcribe": transcribe, "clips": clips, "publish": publish}[cmd](path)
