import { Router } from 'express';
import { z } from 'zod';
import { Policy, AuditLog } from '../models/index.js';
import { authMiddleware, requireUserAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

// Middleware to require admin role for policy changes
const requireOrgAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Tenant admin required' });
  }
  next();
};

const RuleSchema = z.object({
  category: z.string().min(1).max(50),
  severityThreshold: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  riskThreshold: z.number().min(0).max(100).optional(),
}).refine(data => data.severityThreshold || data.riskThreshold, {
  message: 'Rule must have either severityThreshold or riskThreshold'
});

const PolicySchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(['DRAFT', 'ACTIVE', 'DISABLED']),
  precedence: z.number().min(1).max(1000),
  scope: z.enum(['TENANT', 'GROUP', 'USER']),
  targetId: z.string().optional(),
  action: z.enum(['ALLOW', 'WARN', 'SANITIZE', 'BLOCK']),
  rules: z.array(RuleSchema).min(1).max(20),
});

// GET all policies for the tenant
router.get('/', authMiddleware, requireUserAuth, async (req, res) => {
  try {
    const policies = await Policy.find({ orgId: req.user.orgId }).sort({ precedence: -1 });
    res.json(policies);
  } catch (err) {
    logger.error('Error fetching policies', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET a specific policy
router.get('/:id', authMiddleware, requireUserAuth, async (req, res) => {
  try {
    const policy = await Policy.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    res.json(policy);
  } catch (err) {
    logger.error('Error fetching policy', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST create a new policy
router.post('/', authMiddleware, requireUserAuth, requireOrgAdmin, async (req, res) => {
  try {
    const data = PolicySchema.parse(req.body);
    const policy = await Policy.create({
      ...data,
      orgId: req.user.orgId,
      version: 1
    });

    await AuditLog.create({
      orgId: req.user.orgId,
      action: 'policy_created',
      actor: req.user.userId,
      target: policy._id.toString(),
      changes: { new: policy.toObject() },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json(policy);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    logger.error('Error creating policy', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT update a policy (creates a new version)
router.put('/:id', authMiddleware, requireUserAuth, requireOrgAdmin, async (req, res) => {
  try {
    const data = PolicySchema.parse(req.body);
    const existing = await Policy.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!existing) return res.status(404).json({ error: 'Policy not found' });

    const updated = await Policy.findOneAndUpdate(
      { _id: existing._id },
      { $set: data, $inc: { version: 1 } },
      { new: true }
    );

    await AuditLog.create({
      orgId: req.user.orgId,
      action: 'policy_updated',
      actor: req.user.userId,
      target: updated._id.toString(),
      changes: { oldVersion: existing.version, newVersion: updated.version, changes: data },
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(updated);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
    logger.error('Error updating policy', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE (disable) a policy
router.delete('/:id', authMiddleware, requireUserAuth, requireOrgAdmin, async (req, res) => {
  try {
    const existing = await Policy.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!existing) return res.status(404).json({ error: 'Policy not found' });

    existing.status = 'DISABLED';
    await existing.save();

    await AuditLog.create({
      orgId: req.user.orgId,
      action: 'policy_disabled',
      actor: req.user.userId,
      target: existing._id.toString(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  } catch (err) {
    logger.error('Error disabling policy', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
