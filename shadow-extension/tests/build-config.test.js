import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveApiOrigin, resolveDashboardOrigin } from '../vite.config.js';

test('development has an explicit localhost default and allows an overridden API origin', () => {
  assert.equal(resolveApiOrigin('development'), 'http://localhost:3001');
  assert.equal(resolveApiOrigin('development', 'https://dev-api.example.test'), 'https://dev-api.example.test');
});

test('staging and production require non-local HTTPS origins', () => {
  assert.equal(resolveApiOrigin('staging', 'https://staging-api.example.test'), 'https://staging-api.example.test');
  assert.equal(resolveApiOrigin('production', 'https://api.example.test'), 'https://api.example.test');
  assert.throws(() => resolveApiOrigin('staging'), /VITE_API_URL is required/);
  assert.throws(() => resolveApiOrigin('production', 'http://api.example.test'), /require a non-local HTTPS/);
  assert.throws(() => resolveApiOrigin('production', 'https://localhost:3001'), /require a non-local HTTPS/);
  assert.throws(() => resolveApiOrigin('production', 'https://127.0.0.1:3001'), /require a non-local HTTPS/);
  assert.throws(() => resolveApiOrigin('production', 'https://127.0.0.2:3001'), /require a non-local HTTPS/);
  assert.throws(() => resolveApiOrigin('production', 'https://[::1]:3001'), /require a non-local HTTPS/);
  assert.throws(() => resolveApiOrigin('production', 'https://api.localhost'), /require a non-local HTTPS/);
});

test('API configuration rejects credentials and non-origin URLs', () => {
  assert.throws(() => resolveApiOrigin('development', 'https://user:pass@api.example.test'), /origin-only/);
  assert.throws(() => resolveApiOrigin('development', 'https://api.example.test/path'), /origin-only/);
});

test('dashboard origin defaults to the local dev server and rejects malformed values', () => {
  assert.equal(resolveDashboardOrigin(), 'http://localhost:5173');
  assert.equal(resolveDashboardOrigin('https://app.example.test'), 'https://app.example.test');
  assert.throws(() => resolveDashboardOrigin('not a url'), /absolute HTTP\(S\) URL/);
  assert.throws(() => resolveDashboardOrigin('https://user:pass@app.example.test'), /origin-only/);
  assert.throws(() => resolveDashboardOrigin('https://app.example.test/path'), /origin-only/);
});
