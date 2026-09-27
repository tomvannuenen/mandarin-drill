"""Pack a folder of book MP3s into one file for loading into the app's Book tab.

The pack stays private: copy it to the phone (e.g. AirDrop) and load it in the app. Never commit it.

Usage: python3 tools/pack_book.py book-audio book-audio/hsk1.chinesepack
Track files are named like 01-3.mp3 (lesson 1, track 3); 00-*.mp3 is lesson 0.
The folder may contain titles.json: {"title": ..., "lessons": {"1": "你好", ...}}.
"""
import json
import struct
import sys
from pathlib import Path


def pack(folder: Path, out: Path):
    meta = {"title": folder.name, "lessons": {}}
    if (folder / "titles.json").exists():
        meta.update(json.loads((folder / "titles.json").read_text()))
    files = sorted(folder.glob("*.mp3"))
    tracks, offset = [], 0
    for f in files:
        size = f.stat().st_size
        tracks.append({"name": f.stem, "lesson": int(f.stem.split("-")[0]), "offset": offset, "size": size})
        offset += size
    header = json.dumps({**meta, "tracks": tracks}, ensure_ascii=False).encode()
    with out.open("wb") as fh:
        fh.write(b"CPK1" + struct.pack("<I", len(header)) + header)
        for f in files:
            fh.write(f.read_bytes())
    return len(tracks), out.stat().st_size


if __name__ == "__main__":
    n, size = pack(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"{n} tracks, {size / 1e6:.1f} MB -> {sys.argv[2]}")
