import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SW = new URL('../sw.js', import.meta.url);

// A service worker that fails to parse never installs: phones silently stay on the old app.
test('sw.js parses and has no merge conflict markers', () => {
  assert.doesNotMatch(readFileSync(SW, 'utf8'), /^(<{7}|={7}|>{7})( |$)/m);
  execFileSync(process.execPath, ['--check', SW.pathname]);
});
