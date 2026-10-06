import { createHash, randomBytes, randomUUID } from 'node:crypto';

export function hashDeviceCredential(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createDeviceCredential() {
  return `dvc_${randomBytes(32).toString('base64url')}`;
}

export function createDeviceId() {
  return randomUUID();
}

export function createEnrollmentCode() {
  return randomBytes(24).toString('base64url');
}
