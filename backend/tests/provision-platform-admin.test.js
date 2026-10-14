/**
 * Provisioning-script regression tests.
 *
 * The script is the only way to bootstrap a platform administrator, so these
 * tests pin the safety properties: configuration is validated before any
 * database connection, the password is stored only as a bcrypt hash, and an
 * existing identity is never overwritten or its password silently reset.
 *
 * These are unit tests around the exported helpers; they require no MongoDB.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { readProvisionConfig, provisionPlatformAdmin } from '../scripts/provision-platform-admin.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/provision-platform-admin.mjs', import.meta.url));

describe('readProvisionConfig', () => {
  it('rejects missing or malformed configuration before any connection', () => {
    expect(() => readProvisionConfig({})).toThrow(/PLATFORM_ADMIN_EMAIL/);
    expect(() => readProvisionConfig({ PLATFORM_ADMIN_EMAIL: 'not-an-email' })).toThrow(/PLATFORM_ADMIN_EMAIL/);
    expect(() => readProvisionConfig({ PLATFORM_ADMIN_EMAIL: 'a@b.test' })).toThrow(/PLATFORM_ADMIN_PASSWORD/);
    expect(() => readProvisionConfig({ PLATFORM_ADMIN_EMAIL: 'a@b.test', PLATFORM_ADMIN_PASSWORD: 'short' }))
      .toThrow(/at least 16 characters/);
    expect(() => readProvisionConfig({
      PLATFORM_ADMIN_EMAIL: 'a@b.test',
      PLATFORM_ADMIN_PASSWORD: 'x'.repeat(16),
    })).toThrow(/MONGODB_URI/);
  });

  it('normalises the email and accepts valid configuration', () => {
    const config = readProvisionConfig({
      PLATFORM_ADMIN_EMAIL: '  Bootstrap@Example.test ',
      PLATFORM_ADMIN_PASSWORD: 'x'.repeat(20),
      MONGODB_URI: 'mongodb://localhost:27017/test',
    });
    expect(config.email).toBe('bootstrap@example.test');
    expect(config.mongoUri).toBe('mongodb://localhost:27017/test');
  });
});

describe('provisionPlatformAdmin', () => {
  it('creates an administrator with a bcrypt hash and no plaintext password', async () => {
    const create = jest.fn(async doc => doc);
    const models = {
      PlatformAdmin: { findOne: jest.fn(async () => null), create },
      User: { findOne: jest.fn(async () => null) },
    };
    const password = 'bootstrap-password-0001';

    await provisionPlatformAdmin({ email: 'Boot@Example.test', password }, { models, log: () => {} });

    expect(create).toHaveBeenCalledTimes(1);
    const doc = create.mock.calls[0][0];
    expect(doc.email).toBe('boot@example.test');
    expect(doc.passwordHash).toMatch(/^\$2/);
    expect(doc.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, doc.passwordHash)).toBe(true);
  });

  it('never resets an existing administrator and never creates a duplicate', async () => {
    const create = jest.fn();
    const models = {
      PlatformAdmin: { findOne: jest.fn(async () => ({ email: 'admin@example.test' })), create },
      User: { findOne: jest.fn(async () => null) },
    };

    await expect(
      provisionPlatformAdmin(
        { email: 'Admin@Example.test', password: 'bootstrap-password-0001' },
        { models, log: () => {} },
      ),
    ).rejects.toThrow(/already assigned/);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an email already used by a tenant user', async () => {
    const create = jest.fn();
    const models = {
      PlatformAdmin: { findOne: jest.fn(async () => null) },
      User: { findOne: jest.fn(async () => ({ email: 'admin@example.test', orgId: 'org-1' })), create },
    };

    await expect(
      provisionPlatformAdmin(
        { email: 'admin@example.test', password: 'bootstrap-password-0001' },
        { models, log: () => {} },
      ),
    ).rejects.toThrow(/already assigned/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('provision-platform-admin CLI', () => {
  it('fails safely with a non-zero exit and no stack trace when configuration is missing', () => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PLATFORM_ADMIN_EMAIL: '',
        PLATFORM_ADMIN_PASSWORD: '',
        MONGODB_URI: '',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain('Provisioning failed:');
    expect(result.stdout + result.stderr).not.toContain('at Object.');
  });
});
