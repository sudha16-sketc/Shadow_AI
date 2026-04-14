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
  role:          { type: String, enum: ['admin', 'manager', 'viewer'], default: 'viewer' },
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
  domain:         { type: String }, // e.g. "acmecorp.com" for SSO
  securityScore:  { type: Number, default: 100, min: 0, max: 100 },
  slackWebhookUrl:{ type: String },
  alertEmail:     { type: String },
  settings: {
    blockOnHigh:       { type: Boolean, default: false },
    requireJustification: { type: Boolean, default: false },
    alertOnMedium:     { type: Boolean, default: false },
  },
}, { timestamps: true });

// ─── Event ────────────────────────────────────────────────────────────────────
const EventSchema = new Schema({
  userId:       { type: String, index: true },       // extensionUserId (may be unresolved)
  userRef:      { type: Schema.Types.ObjectId, ref: 'User' }, // resolved after lookup
  domain:       { type: String, required: true },    // e.g. "chat.openai.com"
  eventType:    { type: String, enum: ['paste','typing','modal_cancel','modal_proceed'], required: true },
  riskScore:    { type: Number, required: true, min: 0, max: 100 },
  severity:     { type: String, enum: ['LOW','MEDIUM','HIGH'], required: true },
  maskedPreview:{ type: String, maxlength: 200 },   // masked, never full content
  findingLabels:{ type: [String] },                  // e.g. ["AWS Access Key", "Email"]
  alerted:      { type: Boolean, default: false },   // was Slack/email sent?
  timestamp:    { type: Date, default: Date.now, index: true },
}, { timestamps: false });

// Compound index for common queries
EventSchema.index({ severity: 1, timestamp: -1 });
EventSchema.index({ userRef: 1, timestamp: -1 });

export const User = model('User', UserSchema);
export const Team = model('Team', TeamSchema);
export const Org  = model('Org',  OrgSchema);
export const Event = model('Event', EventSchema);