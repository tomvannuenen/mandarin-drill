// Coach audio: clips of the coach saying your phrases, cut from recorded lessons on the Mac and kept in the
// private sync repo (coach/manifest.json + coach/<key>.m4a). Downloaded once, then stored on this device.
import { getBase64 } from './lib/sync.js';

const DB_NAME = 'chinese-coach';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('clips');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('clips', mode);
    const request = fn(t.objectStore('clips'));
    t.oncomplete = () => resolve(request instanceof IDBRequest ? request.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

const bytesOf = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// Fetch clips that are new or changed since last time. Returns how many were downloaded.
export async function syncCoach(cfg) {
  const m = await getBase64(cfg, 'coach/manifest.json');
  if (!m) return 0;
  const manifest = JSON.parse(new TextDecoder().decode(bytesOf(m.base64)));
  const have = (await tx('readonly', (s) => s.get('_index'))) || {};
  let n = 0;
  for (const [key, clip] of Object.entries(manifest.clips || {})) {
    if (have[key] === clip.file + clip.lesson) continue;
    const f = await getBase64(cfg, `coach/${clip.file}`);
    if (!f) continue;
    const blob = new Blob([bytesOf(f.base64)], { type: 'audio/mp4' });
    await tx('readwrite', (s) => s.put(blob, key));
    have[key] = clip.file + clip.lesson;
    n += 1;
  }
  await tx('readwrite', (s) => s.put(have, '_index'));
  return n;
}

// {key: object URL} for every clip stored on this device.
export async function coachUrls() {
  const have = (await tx('readonly', (s) => s.get('_index')).catch(() => null)) || {};
  const out = {};
  for (const key of Object.keys(have)) {
    const blob = await tx('readonly', (s) => s.get(key));
    if (blob) out[key] = URL.createObjectURL(blob);
  }
  return out;
}
