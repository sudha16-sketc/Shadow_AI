import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'public', 'manifest.json'), 'utf8'));
const contentScript = readFileSync(join(root, 'src', 'content.js'), 'utf8');
const backgroundScript = readFileSync(join(root, 'src', 'background.js'), 'utf8');

const WILDCARD_HOSTS = ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*', 'file:///*'];

test('popup entry point resolves to a real file (packaging regression)', () => {
  const popup = manifest.action?.default_popup;
  assert.equal(popup, 'src/popup.html');
  // `public/manifest.json` is copied verbatim, so the popup must be resolved
  // from the extension source tree (it is a Vite HTML entry, not a static file).
  assert.ok(existsSync(join(root, popup)), `${popup} missing from source tree`);
  assert.ok(!existsSync(join(root, 'public', popup)), 'popup must be a build entry, not a static public file');

  // The build must emit that exact path, otherwise the toolbar button opens a
  // blank page in Chrome.
  const viteConfig = readFileSync(join(root, 'vite.config.js'), 'utf8');
  assert.match(viteConfig, /popup:\s*'\.\/src\/popup\.html'/);
});

test('built popup (when present) loads an external, same-origin script', () => {
  const built = join(root, 'dist', 'src', 'popup.html');
  if (!existsSync(built)) return; // build not run in this environment
  const html = readFileSync(built, 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/gi)];
  assert.equal(inlineScripts.length, 0, 'MV3 CSP forbids inline scripts');
  const src = html.match(/<script[^>]*\ssrc="([^"]+)"/i)?.[1];
  assert.ok(src, 'popup must reference an external script');
  const target = src.startsWith('/')
    ? join(root, 'dist', src.slice(1))
    : join(root, 'dist', 'src', src);
  assert.ok(existsSync(target), `script ${src} missing from dist`);
});

test('host permissions stay scoped to supported AI sites', () => {
  for (const permission of [...manifest.host_permissions, ...(manifest.content_scripts?.[0]?.matches ?? [])]) {
    assert.ok(!WILDCARD_HOSTS.includes(permission), `over-broad permission: ${permission}`);
    assert.doesNotThrow(() => new URL(permission.replace(/\*$/, '')));
    assert.ok(/^https:/.test(permission), `expected HTTPS-only match pattern: ${permission}`);
  }
});

test('requested API permissions are minimal', () => {
  const allowed = new Set(['tabs', 'scripting', 'storage', 'alarms']);
  for (const permission of manifest.permissions ?? []) {
    assert.ok(allowed.has(permission), `unexpected permission requested: ${permission}`);
  }
});

test('content script never writes pasted or typed text to the console', () => {
  assert.ok(!contentScript.includes('sample:'), 'raw text samples must not be logged');
  assert.ok(!/console\.(log|info|debug|warn|error)\([^)]*\b(text|value|textContent|innerText|content)\s*[,)]/.test(contentScript),
    'raw page content must not be logged');
  // Metadata-only logging (length, tag, id) is allowed.
  assert.match(contentScript, /textLength/);
});

test('background worker takes its API origin from build configuration', () => {
  assert.match(backgroundScript, /import\.meta\.env\.VITE_API_URL/);
  assert.ok(!/https?:\/\/localhost/.test(backgroundScript), 'hardcoded localhost API origin');
  assert.ok(!/https?:\/\/127\.0\.0\.1/.test(backgroundScript), 'hardcoded loopback API origin');
});
