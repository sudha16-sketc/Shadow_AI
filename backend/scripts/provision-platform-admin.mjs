import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { PlatformAdmin, User } from '../src/models/index.js';

const BCRYPT_COST = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Read and validate the one-time bootstrap configuration.
 *
 * Fails before any database connection is attempted so that a misconfigured
 * run can never partially provision an administrator. The returned object is
 * intentionally free of defaults — there is no fallback password or secret.
 */
export function readProvisionConfig(env = process.env) {
  const email = env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.PLATFORM_ADMIN_PASSWORD;
  const mongoUri = env.MONGODB_URI?.trim();

  if (!email || !EMAIL_RE.test(email)) {
    throw new Error('PLATFORM_ADMIN_EMAIL must be a valid email address.');
  }
  if (typeof password !== 'string' || password.length < 16) {
    throw new Error('PLATFORM_ADMIN_PASSWORD must be at least 16 characters.');
  }
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required.');
  }
  return { email, password, mongoUri };
}

/**
 * Create the platform administrator, or fail if the identity is already taken.
 *
 * The password is hashed with the same bcrypt scheme the login routes verify
 * against. An existing platform administrator or tenant user with the same
 * email is never overwritten and its password is never reset.
 */
export async function provisionPlatformAdmin(
  { email, password },
  { models = { PlatformAdmin, User }, log = console.log } = {},
) {
  const normalizedEmail = email.trim().toLowerCase();
  const [existingPlatformAdmin, existingTenantUser] = await Promise.all([
    models.PlatformAdmin.findOne({ email: normalizedEmail }),
    models.User.findOne({ email: normalizedEmail }),
  ]);
  if (existingPlatformAdmin || existingTenantUser) {
    throw new Error(
      'This email is already assigned to an administrator or tenant user; no changes were made.',
    );
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await models.PlatformAdmin.create({
    email: normalizedEmail,
    passwordHash,
    isActive: true,
    authVersion: 0,
  });
  log('Platform administrator provisioned.');
}

async function runCli() {
  let config;
  try {
    config = readProvisionConfig();
  } catch (err) {
    console.error(`Provisioning failed: ${err.message}`);
    process.exit(1);
  }

  try {
    await mongoose.connect(config.mongoUri);
    await provisionPlatformAdmin(config);
  } catch (err) {
    console.error(`Provisioning failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runCli();
}
