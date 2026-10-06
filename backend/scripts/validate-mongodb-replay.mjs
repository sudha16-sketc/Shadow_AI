import assert from 'node:assert/strict';
import 'dotenv/config';
import mongoose from 'mongoose';
import { Event, EventReplay, TenantInvitation } from '../src/models/index.js';

const stagingUri = process.env.PHASE1_STAGING_MONGODB_URI;
const confirmation = process.env.PHASE1_STAGING_BACKUP_CONFIRMED;
if (!stagingUri || confirmation !== 'YES_BACKED_UP_STAGING_COPY') {
  throw new Error('Set PHASE1_STAGING_MONGODB_URI and confirm YES_BACKED_UP_STAGING_COPY.');
}

let databaseName;
try {
  databaseName = decodeURIComponent(new URL(stagingUri).pathname.split('/').filter(Boolean).at(-1) ?? '');
} catch {
  throw new Error('PHASE1_STAGING_MONGODB_URI must be a valid MongoDB URI.');
}
if (!/(staging|phase1-validation)$/i.test(databaseName)) {
  throw new Error('The MongoDB database name must end in staging or phase1-validation.');
}

const eventIds = [];
const replayIds = [];

try {
  await mongoose.connect(stagingUri, { autoIndex: false });

  const legacyDuplicates = await Event.aggregate([
    { $match: { idempotencyKey: { $type: 'string' }, orgId: { $exists: true } } },
    { $group: { _id: { orgId: '$orgId', deviceId: '$deviceId', idempotencyKey: '$idempotencyKey' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicateGroups' },
  ]);
  const duplicateGroups = legacyDuplicates[0]?.duplicateGroups ?? 0;
  assert.equal(duplicateGroups, 0, `Resolve ${duplicateGroups} duplicate idempotency groups on this staging copy before index migration.`);

  const duplicateInvitations = await TenantInvitation.aggregate([
    { $match: { status: 'pending' } },
    { $group: { _id: '$email', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicateGroups' },
  ]);
  const duplicateInvitationGroups = duplicateInvitations[0]?.duplicateGroups ?? 0;
  assert.equal(duplicateInvitationGroups, 0, `Resolve ${duplicateInvitationGroups} duplicate pending invitation groups on this staging copy before index migration.`);

  try {
    await Event.collection.dropIndex('orgId_1_idempotencyKey_1');
  } catch (error) {
    if (![26, 27].includes(error.code) && !['IndexNotFound', 'NamespaceNotFound'].includes(error.codeName)) throw error;
  }
  await Event.createIndexes();
  await EventReplay.createIndexes();
  await TenantInvitation.createIndexes();

  const eventIndexes = await Event.collection.indexes();
  const eventUniqueIndex = eventIndexes.find(index => index.name === 'orgId_1_deviceId_1_idempotencyKey_1');
  assert.equal(eventUniqueIndex?.unique, true, 'Tenant/device/idempotency unique index is missing.');
  assert.equal(eventUniqueIndex?.partialFilterExpression?.idempotencyKey?.$type, 'string');

  const replayIndexes = await EventReplay.collection.indexes();
  assert.ok(replayIndexes.some(index => index.unique && index.key.orgId === 1 && index.key.deviceId === 1 && index.key.fingerprint === 1));
  assert.ok(replayIndexes.some(index => index.expireAfterSeconds === 0 && index.key.expiresAt === 1));
  const invitationIndexes = await TenantInvitation.collection.indexes();
  assert.ok(invitationIndexes.some(index => index.unique && index.key.email === 1 && index.partialFilterExpression?.status === 'pending'));

  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();
  const deviceA = `phase1-${new mongoose.Types.ObjectId()}`;
  const deviceB = `phase1-${new mongoose.Types.ObjectId()}`;
  const idempotencyKey = `phase1-${new mongoose.Types.ObjectId()}`;
  const fingerprint = `phase1-${new mongoose.Types.ObjectId()}`;
  const makeEvent = (orgId, deviceId) => ({
    orgId,
    deviceId,
    idempotencyKey,
    domain: 'chat.openai.com',
    eventType: 'paste',
    riskScore: 10,
    severity: 'LOW',
    policyDecision: 'WARN',
    policyReason: 'staging_index_validation',
    policyVersion: 1,
    timestamp: new Date(),
  });

  const concurrentEvents = await Promise.allSettled(
    Array.from({ length: 12 }, () => Event.create(makeEvent(orgA, deviceA)))
  );
  const insertedEvents = concurrentEvents.filter(result => result.status === 'fulfilled');
  const rejectedEvents = concurrentEvents.filter(result => result.status === 'rejected');
  eventIds.push(...insertedEvents.map(result => result.value._id));
  assert.equal(insertedEvents.length, 1, 'Concurrent duplicate event submissions were not serialized by the unique index.');
  assert.equal(rejectedEvents.length, 11);
  assert.ok(rejectedEvents.every(result => result.reason.code === 11000));

  for (const [orgId, deviceId] of [[orgB, deviceA], [orgA, deviceB]]) {
    const event = await Event.create(makeEvent(orgId, deviceId));
    eventIds.push(event._id);
  }

  const replayRecord = { orgId: orgA, deviceId: deviceA, fingerprint, expiresAt: new Date(Date.now() + 120_000) };
  const concurrentReplays = await Promise.allSettled(
    Array.from({ length: 12 }, () => EventReplay.create(replayRecord))
  );
  const insertedReplays = concurrentReplays.filter(result => result.status === 'fulfilled');
  const rejectedReplays = concurrentReplays.filter(result => result.status === 'rejected');
  replayIds.push(...insertedReplays.map(result => result.value._id));
  assert.equal(insertedReplays.length, 1, 'Concurrent replay reservations were not serialized by the unique fingerprint index.');
  assert.equal(rejectedReplays.length, 11);
  assert.ok(rejectedReplays.every(result => result.reason.code === 11000));

  for (const [orgId, deviceId] of [[orgB, deviceA], [orgA, deviceB]]) {
    const record = await EventReplay.create({ ...replayRecord, orgId, deviceId });
    replayIds.push(record._id);
  }

  const expiredRecord = await EventReplay.create({
    ...replayRecord,
    fingerprint: `phase1-expired-${new mongoose.Types.ObjectId()}`,
    expiresAt: new Date(Date.now() - 1),
  });
  replayIds.push(expiredRecord._id);
  await EventReplay.deleteOne({ _id: expiredRecord._id, expiresAt: { $lte: new Date() } });
  const replacement = await EventReplay.create({ ...expiredRecord.toObject(), _id: undefined, expiresAt: new Date(Date.now() + 120_000) });
  replayIds.push(replacement._id);

  console.log('Staging MongoDB event/replay indexes and concurrent uniqueness checks passed.');
} finally {
  if (mongoose.connection.readyState !== 0) {
    if (eventIds.length) await Event.deleteMany({ _id: { $in: eventIds } });
    if (replayIds.length) await EventReplay.deleteMany({ _id: { $in: replayIds } });
    await mongoose.disconnect();
  }
}
