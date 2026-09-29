// Sync with a private GitHub repo: progress.json goes up after study, plan.json (Claude's daily note) comes down.
// The access token lives in its own localStorage key, never inside the progress export.
const CONFIG_KEY = 'mandarin.sync.v1';
export const DEFAULT_REPO = 'tomvannuenen/mandarin-progress';

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function loadConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null;
  } catch {
    return null;
  }
}

export function saveConfig(cfg) {
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch {}
}

function call(cfg, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    ...opts,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function getFile(cfg, name) {
  const res = await call(cfg, `/contents/${name}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const json = await res.json();
  return { text: fromBase64(json.content), sha: json.sha };
}

async function putFile(cfg, name, text, sha, message) {
  return call(cfg, `/contents/${name}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), ...(sha ? { sha } : {}) }),
  });
}

// Checks the token can write to the repo.
export async function testConnection(cfg) {
  const res = await call(cfg, '');
  if (res.status === 401) throw new Error('The key was not accepted');
  if (res.status === 404) throw new Error('Repository not found (does the key include mandarin-progress?)');
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const repo = await res.json();
  if (!repo.private) throw new Error('The repository is public; make it private first');
  if (repo.permissions && !repo.permissions.push) throw new Error('The key can read but not write');
  return true;
}

export async function pushProgress(cfg, json) {
  let sha = cfg.sha;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await putFile(cfg, 'progress.json', json, sha, `Sync ${new Date().toISOString()}`);
    if (res.ok) {
      cfg.sha = (await res.json()).content.sha;
      cfg.lastSync = new Date().toISOString();
      saveConfig(cfg);
      return;
    }
    if (res.status !== 409 && res.status !== 422) throw new Error(`GitHub said ${res.status}`);
    sha = (await getFile(cfg, 'progress.json'))?.sha; // someone else wrote it; take the latest version's id
  }
  throw new Error('Could not save progress');
}

export async function pullProgress(cfg) {
  const f = await getFile(cfg, 'progress.json');
  if (f) {
    cfg.sha = f.sha;
    saveConfig(cfg);
  }
  return f?.text || null;
}

// Raw file content as base64 (for binary files such as coach audio clips), or null if missing.
export async function getBase64(cfg, name) {
  const res = await call(cfg, `/contents/${encodeURI(name)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  const json = await res.json();
  return { base64: json.content.replace(/\s/g, ''), sha: json.sha };
}

export async function pullPlan(cfg) {
  const f = await getFile(cfg, 'plan.json');
  return f ? JSON.parse(f.text) : null;
}
