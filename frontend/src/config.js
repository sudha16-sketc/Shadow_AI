// Single source of truth for the backend API base URL.
//
// Resolution order:
//   1. VITE_API_URL — build-time env var; wins when set to a non-empty value.
//   2. Local dev server when the app is running on localhost / 127.0.0.1.
//   3. The hosted backend in production builds.
//
// The production fallback exists so a deployed build never silently targets
// http://localhost:3001 (which browsers block as a loopback address) when the
// build environment fails to inject VITE_API_URL. Setting VITE_API_URL in the
// hosting dashboard still takes precedence over this fallback.

const configured = import.meta.env.VITE_API_URL;

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isLocalhost =
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

export const API_BASE =
  configured || (isLocalhost ? 'http://localhost:3001' : 'https://shadow-ai-fh54.onrender.com');
