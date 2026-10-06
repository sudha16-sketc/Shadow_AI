/**
 * SSRF guard for operator-supplied callback URLs (Slack webhooks today).
 *
 * The server performs an outbound request to whatever URL the tenant admin
 * stores, so the URL is untrusted input. This guard blocks scheme abuse and
 * obvious internal targets. It does NOT perform DNS resolution, so a hostname
 * that resolves to a private address is still a residual risk — a production
 * deployment must additionally restrict outbound traffic at the network layer.
 */

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog', 'instance-data']);

function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateOrReservedIpv4(host) {
  if (!isIpv4(host)) return false;
  const [a, b] = host.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;                      // this-host / private / loopback
  if (a === 169 && b === 254) return true;                                // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;                       // RFC1918
  if (a === 192 && b === 168) return true;                                // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;                      // carrier-grade NAT
  if (a === 192 && b === 0) return true;                                  // IETF protocol assignments
  if (a >= 224) return true;                                              // multicast / reserved
  return false;
}

export function isSafeCallbackUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return false;
  }

  if (url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
  if (isPrivateOrReservedIpv4(hostname.replace(/^\[|\]$/g, ''))) return false;

  // Callbacks are only ever delivered over TLS; plain HTTP would put the
  // webhook body (which carries alert detail) on the wire in the clear.
  return url.protocol === 'https:';
}
