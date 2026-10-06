const jwtSecret = process.env.JWT_SECRET;

if (
  typeof jwtSecret !== 'string' ||
  jwtSecret.trim() !== jwtSecret ||
  Buffer.byteLength(jwtSecret, 'utf8') < 48 ||
  new Set(jwtSecret).size < 16
) {
  throw new Error('JWT_SECRET must be configured with at least 48 bytes of non-trivial key material.');
}

export const JWT_SECRET = jwtSecret;
