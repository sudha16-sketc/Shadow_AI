import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const extensionRoot = fileURLToPath(new URL('.', import.meta.url));
const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalHost(hostname) {
  const normalizedHost = hostname.toLowerCase();
  return localHosts.has(normalizedHost) ||
    normalizedHost.endsWith('.localhost') ||
    /^127(?:\.\d{1,3}){3}$/.test(normalizedHost);
}

function isLocalPermission(permission) {
  try {
    return isLocalHost(new URL(permission.replace(/\*$/, '')).hostname);
  } catch {
    return false;
  }
}

export function resolveApiOrigin(mode, configuredUrl) {
  if (!['development', 'staging', 'production'].includes(mode)) {
    throw new Error('Use the development, staging, or production extension build mode.');
  }

  const value = configuredUrl || (mode === 'development' ? 'http://localhost:3001' : '');
  if (!value) throw new Error(`VITE_API_URL is required for the ${mode} extension build.`);

  let apiUrl;
  try {
    apiUrl = new URL(value);
  } catch {
    throw new Error('VITE_API_URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash) {
    throw new Error('VITE_API_URL must be an origin-only HTTP(S) URL without credentials, path, query, or fragment.');
  }
  if (mode !== 'development' && (apiUrl.protocol !== 'https:' || isLocalHost(apiUrl.hostname))) {
    throw new Error(`${mode} extension builds require a non-local HTTPS API origin.`);
  }

  return apiUrl.origin;
}

export function resolveDashboardOrigin(configuredUrl) {
  if (!configuredUrl) return 'http://localhost:5173';
  let url;
  try {
    url = new URL(configuredUrl);
  } catch {
    throw new Error('VITE_DASHBOARD_URL must be an absolute HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_DASHBOARD_URL must be an origin-only HTTP(S) URL without credentials, path, query, or fragment.');
  }
  return url.origin;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, extensionRoot, 'VITE_');
  const apiOrigin = resolveApiOrigin(mode, env.VITE_API_URL);
  const manifestPath = resolve(extensionRoot, 'dist', 'manifest.json');

  return {
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(apiOrigin),
      'import.meta.env.VITE_DASHBOARD_URL': JSON.stringify(resolveDashboardOrigin(env.VITE_DASHBOARD_URL)),
    },
    plugins: [{
      name: 'configure-extension-api-origin',
      closeBundle() {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.host_permissions = [
          ...manifest.host_permissions.filter(permission => !isLocalPermission(permission)),
          `${apiOrigin}/*`,
        ];
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
      },
    }],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          content: './src/content.js',
          popup: './src/popup.html',
          background: './src/background.js',
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]',
        },
      },
    },
    publicDir: 'public',
  };
});