// backend/src/models/index.js
/**
 * Shadow AI Auditor — Database Models (Mongoose)
 *
 * Security note: We NEVER store raw sensitive content.
 * Only masked previews are persisted.
 */
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

// ─── User ─────────────────────────────────────────────────────────────────────
const UserSchema = new Schema({
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:  { type: String, required: true },
  name:          { type: String, required: true },
  orgId:         { type: Schema.Types.ObjectId, ref: 'Org', index: true, default: null },
  role:          { type: String, enum: ['admin', 'manager', 'viewer'], default: 'viewer' },
  authVersion:   { type: Number, default: 0 },
  department:    { type: String, default: '' },
  teamId:        { type: Schema.Types.ObjectId, ref: 'Team' },
  extensionUserId: { type: String, index: true }, // maps to extension's userId
  optedOut:      { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// ─── Team ─────────────────────────────────────────────────────────────────────
const TeamSchema = new Schema({
  name:       { type: String, required: true },
  orgId:      { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  members:    [{ type: Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

// ─── Organization ─────────────────────────────────────────────────────────────
const OrgSchema = new Schema({
  name:           { type: String, required: true },
  lifecycleStatus: { type: String, enum: ['pending_admin', 'active', 'suspended'], required: true, default: 'pending_admin', index: true },
  activatedAt:    { type: Date, default: null },
  domain:         { type: String }, // e.g. "acmecorp.com" for SSO
  securityScore:  { type: Number, default: 100, min: 0, max: 100 },
  slackWebhookUrl:{ type: String },
  alertEmail:     { type: String },
  monitoredDomains: { type: [String], default: ['chat.openai.com', 'claude.ai', 'gemini.google.com'] },
  settings: {
    blockOnHigh:       { type: Boolean, default: true },
    requireJustification: { type: Boolean, default: true },
    alertOnMedium:     { type: Boolean, default: true },
    retentionDays:     { type: Number, default: 90 },
    defaultAction:     { type: String, enum: ['ALLOW', 'WARN', 'BLOCK'], default: 'BLOCK' },
  },
  policyVersion:  { type: Number, default: 1 },
}, { timestamps: true });

// ─── Platform administrator ──────────────────────────────────────────────────
const PlatformAdminSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  authVersion: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// ─── Tenant admin invitation ─────────────────────────────────────────────────
const TenantInvitationSchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  name: { type: String, required: true, maxlength: 100 },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true, index: true },
  usedAt: { type: Date, default: null },
  status: { type: String, enum: ['pending', 'accepted', 'revoked'], default: 'pending', required: true },
  issuedByAdminId: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin', required: true },
}, { timestamps: true });
TenantInvitationSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } });

// ─── Policy ──────────────────────────────────────────────────────────────────
const PolicySchema = new Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
  name:         { type: String, required: true },
  status:       { type: String, enum: ['DRAFT', 'ACTIVE', 'DISABLED'], default: 'DRAFT', required: true },
  version:      { type: Number, required: true, default: 1 },
  precedence:   { type: Number, required: true, default: 100 },
  scope:        { type: String, enum: ['TENANT', 'GROUP', 'USER'], default: 'TENANT', required: true },
  targetId:     { type: Schema.Types.ObjectId }, // Can be Team ID or User ID if scope is GROUP/USER
  action:       { type: String, enum: ['ALLOW', 'WARN', 'SANITIZE', 'BLOCK'], required: true },
  rules: [{
    category: { type: String, required: true }, // e.g., 'API_KEY', 'PII', 'PASSWORD', 'PROPRIETARY'
    severityThreshold: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }, // Trigger if >= this severity
    riskThreshold: { type: Number }, // Trigger if >= this score
  }],
}, { timestamps: true });
PolicySchema.index({ orgId: 1, status: 1, precedence: -1 });

// ─── Platform audit trail ────────────────────────────────────────────────────
const PlatformAuditLogSchema = new Schema({
  actorAdminId: { type: Schema.Types.ObjectId, ref: 'PlatformAdmin', required: true },
  action: { type: String, required: true },
  tenantId: { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
  targetId: { type: String },
  changes: { type: Schema.Types.Mixed },
  ip: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// ─── Device ───────────────────────────────────────────────────────────────────
const DeviceSchema = new Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  deviceId:     { type: String, required: true, index: true },
  label:        { type: String, default: 'Browser Extension' },
  tokenHash:    { type: String, required: true },
  enrollmentExpiresAt: { type: Date, default: null },
  isActive:     { type: Boolean, default: true },
  revokedAt:    { type: Date, default: null },
  lastSeenAt:   { type: Date, default: Date.now },
}, { timestamps: true });

DeviceSchema.index({ orgId: 1, deviceId: 1 }, { unique: true });

// ─── Event ────────────────────────────────────────────────────────────────────
const EventSchema = new Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Org', index: true, default: null },
  userId:       { type: String, index: true },       // extensionUserId (may be unresolved)
  deviceId:     { type: String, index: true },
  userRef:      { type: Schema.Types.ObjectId, ref: 'User' }, // resolved after lookup
  idempotencyKey:{ type: String, index: true, sparse: true },
  clientTelemetry: {
    riskScore: { type: Number, min: 0, max: 100 },
    severity: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
    findingLabels: [{ type: String, maxlength: 60 }],
    maskedPreview: { type: String, maxlength: 200 },
  },
  policyDecision: { type: String, enum: ['ALLOW', 'WARN', 'SANITIZE', 'BLOCK'], required: true },
  policyReason: { type: String, required: true },
  policyVersion: { type: Number, required: true },
  enforcementStatus: { type: String, enum: ['NOT_ATTEMPTED', 'FORWARDED', 'PREVENTED', 'FAILED', 'SANITIZED'], default: 'NOT_ATTEMPTED' },
  requestForwarded: { type: Boolean, default: false },
  upstreamStatus: { type: Number },
  sanitizedRedactions: { type: Number, min: 0, default: 0 },
  responseFindingLabels: { type: [String], default: [] },
  domain:       { type: String, required: true },    // e.g. "chat.openai.com"
  eventType:    { type: String, enum: ['paste','typing','modal_cancel','modal_proceed','api_gateway'], default: 'api_gateway', required: true },
  riskScore:    { type: Number, required: true, min: 0, max: 100 },
  severity:     { type: String, enum: ['LOW','MEDIUM','HIGH','CRITICAL'], required: true },
  maskedPreview:{ type: String, maxlength: 200 },   // masked, never full content
  findingLabels:{ type: [String] },                  // e.g. ["AWS Access Key", "Email"]
  alerted:      { type: Boolean, default: false },   // was Slack/email sent?
  justificationId: { type: Schema.Types.ObjectId, ref: 'Justification' }, // if user justified
  timestamp:    { type: Date, default: Date.now, index: true, expires: 2592000 }, // 30d TTL
}, { timestamps: false });

// ─── Bounded semantic replay records ─────────────────────────────────────────
const EventReplaySchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Org', required: true },
  deviceId: { type: String, required: true },
  fingerprint: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

EventReplaySchema.index({ orgId: 1, deviceId: 1, fingerprint: 1 }, { unique: true });
EventReplaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ─── Justification ────────────────────────────────────────────────────────────
const JustificationSchema = new Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Org', index: true, default: null },
  eventId:      { type: Schema.Types.ObjectId, ref: 'Event', required: true },
  userId:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reason:       { type: String, required: true, maxlength: 500 },
  approved:     { type: Boolean, default: null }, // null = pending, true/false = decided
  approvedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  approvalReason: { type: String, maxlength: 500 },
  timestamp:    { type: Date, default: Date.now },
  expiresAt:    { type: Date, default: () => new Date(Date.now() + 30*24*60*60*1000) }, // 30 days
}, { timestamps: true });

// ─── Audit Log ────────────────────────────────────────────────────────────────
const AuditLogSchema = new Schema({
  orgId:        { type: Schema.Types.ObjectId, ref: 'Org', index: true, required: true },
  action:       { type: String, required: true }, // 'user_created', 'event_blocked', 'policy_changed', etc.
  actor:        { type: Schema.Types.ObjectId, ref: 'User' }, // who performed the action
  target:       { type: String }, // what was affected (user ID, event ID, etc.)
  changes:      { type: Schema.Types.Mixed }, // what changed { old: {}, new: {} }
  ip:           { type: String },
  userAgent:    { type: String },
  timestamp:    { type: Date, default: Date.now, index: true, expires: 7776000 }, // 90d TTL
}, { timestamps: false });

// Compound index for common queries
EventSchema.index({ severity: 1, timestamp: -1 });
EventSchema.index({ userRef: 1, timestamp: -1 });
EventSchema.index(
  { orgId: 1, deviceId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
JustificationSchema.index({ eventId: 1 });
JustificationSchema.index({ userId: 1, approved: 1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });
AuditLogSchema.index({ actor: 1, timestamp: -1 });

export const User = model('User', UserSchema);
export const Team = model('Team', TeamSchema);
export const Org  = model('Org',  OrgSchema);
export const Device = model('Device', DeviceSchema);
export const PlatformAdmin = model('PlatformAdmin', PlatformAdminSchema);
export const TenantInvitation = model('TenantInvitation', TenantInvitationSchema);
export const Policy = model('Policy', PolicySchema);
export const PlatformAuditLog = model('PlatformAuditLog', PlatformAuditLogSchema);
export const Event = model('Event', EventSchema);
export const EventReplay = model('EventReplay', EventReplaySchema);
export const Justification = model('Justification', JustificationSchema);
export const AuditLog = model('AuditLog', AuditLogSchema);