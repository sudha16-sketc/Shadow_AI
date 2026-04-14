/**
 * Shadow AI Auditor — Detection Engine
 * Modular detection system for sensitive data patterns.
 * Never logs or stores raw sensitive content.
 */

// ─── Regex Pattern Library ───────────────────────────────────────────────────

// shadow-extension/src/detectionEngine.js

const PATTERNS = {
  // API Keys & Secrets
  AWS_ACCESS_KEY:    { re: /\bAKIA[0-9A-Z]{16}\b/g,                    score: 90, label: 'AWS Access Key' },
  AWS_SECRET_KEY:    { re: /\b[0-9a-zA-Z+/]{40}\b/g,                   score: 75, label: 'AWS Secret Key (possible)' },
  STRIPE_SECRET:     { re: /\bsk_(live|test)_[0-9a-zA-Z]{24,}\b/g,     score: 95, label: 'Stripe Secret Key' },
  STRIPE_PUBLISHABLE:{ re: /\bpk_(live|test)_[0-9a-zA-Z]{24,}\b/g,     score: 60, label: 'Stripe Publishable Key' },
  GITHUB_TOKEN:      { re: /\bghp_[0-9a-zA-Z]{36}\b/g,                 score: 90, label: 'GitHub Personal Token' },
  GITHUB_OAUTH:      { re: /\bgho_[0-9a-zA-Z]{36}\b/g,                 score: 90, label: 'GitHub OAuth Token' },
  NPM_TOKEN:         { re: /\bnpm_[0-9a-zA-Z]{36}\b/g,                 score: 85, label: 'NPM Token' },
  JWT_TOKEN:         { re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, score: 70, label: 'JWT Token' },
  RSA_PRIVATE_KEY:   { re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g, score: 99, label: 'Private Key' },
  GENERIC_SECRET:    { re: /\b(secret|password|passwd|pwd)\s*[:=]\s*["']?[^\s"',;]{8,}/gi, score: 65, label: 'Secret/Password' },

  // PII
  EMAIL:             { re: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g, score: 40, label: 'Email Address' },
  SSN:               { re: /\b\d{3}-\d{2}-\d{4}\b/g,                   score: 95, label: 'Social Security Number' },
  CREDIT_CARD:       { re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g, score: 98, label: 'Credit Card Number' },
  PHONE_US:          { re: /\b(\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, score: 35, label: 'US Phone Number' },
  IP_INTERNAL:       { re: /\b(10\.\d{1,3}|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, score: 50, label: 'Internal IP Address' },
  DB_CONNECTION:     { re: /(mongodb|postgres|mysql|redis):\/\/[^\s"']+/gi, score: 85, label: 'Database Connection String' },
};

// ─── Keyword Library ─────────────────────────────────────────────────────────

const KEYWORDS = [
  // Confidentiality markers
  { word: 'confidential',          score: 40, label: 'Confidential marker' },
  { word: 'internal only',         score: 50, label: 'Internal marker' },
  { word: 'do not share',          score: 60, label: 'Do not share marker' },
  { word: 'not for distribution',  score: 55, label: 'Distribution restricted' },
  { word: 'proprietary',           score: 35, label: 'Proprietary content' },
  { word: 'trade secret',          score: 70, label: 'Trade secret' },
  { word: 'nda',                   score: 45, label: 'NDA referenced' },
  { word: 'attorney-client',       score: 80, label: 'Legal privilege' },
  { word: 'draft - not final',     score: 30, label: 'Draft document' },
  { word: 'classified',            score: 75, label: 'Classified marker' },
  { word: 'private key',           score: 85, label: 'Private key reference' },
  { word: 'access token',          score: 65, label: 'Access token reference' },
  { word: 'bearer token',          score: 65, label: 'Bearer token reference' },
];

// ─── Risk Scoring ─────────────────────────────────────────────────────────────

/**
 * Convert numeric risk score → severity label
 * @param {number} score 0–100
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
function scoreToseverity(score) {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

// ─── Masking Utility ──────────────────────────────────────────────────────────

/**
 * Mask a sensitive token, showing only first 4 and last 4 chars.
 * @param {string} match
 * @returns {string}
 */
function maskToken(match) {
  if (match.length <= 8) return '****';
  return match.slice(0, 4) + '****' + match.slice(-4);
}

// ─── Main Detection Function ──────────────────────────────────────────────────

/**
 * Analyse text for sensitive content.
 * Returns findings and an aggregate risk score.
 * NEVER returns raw sensitive values.
 *
 * @param {string} text
 * @returns {{ score: number, severity: string, findings: Array, maskedPreview: string }}
 */
function analyse(text) {
  if (!text || text.trim().length === 0) {
    return { score: 0, severity: 'LOW', findings: [], maskedPreview: '' };
  }

  const findings = [];
  let maxScore = 0;
  let maskedText = text;

  // ── Regex scan ────────────────────────────────────────────────────────────
  for (const [key, { re, score, label }] of Object.entries(PATTERNS)) {
    // Reset regex state (global flag)
    re.lastIndex = 0;
    const matches = [...text.matchAll(re)];

    if (matches.length > 0) {
      findings.push({
        type: 'regex',
        patternKey: key,
        label,
        count: matches.length,
        score,
        // Only store masked previews — never raw values
        maskedSamples: matches.slice(0, 3).map(m => maskToken(m[0])),
      });

      // Replace in maskedText for preview generation
      matches.forEach(m => {
        maskedText = maskedText.replace(m[0], maskToken(m[0]));
      });

      maxScore = Math.max(maxScore, score);
    }
  }

  // ── Keyword scan ──────────────────────────────────────────────────────────
  const lowerText = text.toLowerCase();
  for (const { word, score, label } of KEYWORDS) {
    if (lowerText.includes(word)) {
      findings.push({ type: 'keyword', label, score });
      maxScore = Math.max(maxScore, score);
    }
  }

  // ── Bonus: multiple PII types = higher risk ───────────────────────────────
  const piiCount = findings.filter(f =>
    ['EMAIL', 'SSN', 'CREDIT_CARD', 'PHONE_US'].includes(f.patternKey)
  ).length;
  if (piiCount >= 2) maxScore = Math.min(100, maxScore + 20);

  // Generate a safe preview (first 120 chars of masked text)
  const maskedPreview = maskedText.slice(0, 120).replace(/\n/g, ' ');

  return {
    score: maxScore,
    severity: scoreToseverity(maxScore),
    findings,
    maskedPreview,
  };
}

export { analyse, scoreToseverity, maskToken };