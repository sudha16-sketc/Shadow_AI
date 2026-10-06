/**
 * Server-Authoritative Policy Engine (Phase 2B)
 */
import { Policy } from '../models/index.js';
import logger from '../utils/logger.js';

// ─── 1. Detection Normalization ───────────────────────────────────────────────

const LABEL_TO_CATEGORY_MAPPING = {
  'AWS Access Key': { category: 'API_KEY', score: 90 },
  'Stripe Secret Key': { category: 'API_KEY', score: 95 },
  'Stripe Publishable Key': { category: 'API_KEY', score: 60 },
  'GitHub Personal Token': { category: 'API_KEY', score: 90 },
  'GitHub OAuth Token': { category: 'API_KEY', score: 90 },
  'NPM Token': { category: 'API_KEY', score: 85 },
  'JWT Token': { category: 'API_KEY', score: 70 },
  'Private Key': { category: 'PASSWORD', score: 99 },
  'Database Connection String': { category: 'PASSWORD', score: 85 },
  'Social Security Number': { category: 'PII', score: 95 },
  'Credit Card Number': { category: 'PII', score: 98 },
  'Email Address': { category: 'PII', score: 40 },
  'Password/Secret': { category: 'PASSWORD', score: 65 },
  'confidential': { category: 'PROPRIETARY', score: 40 },
  'internal only': { category: 'PROPRIETARY', score: 50 },
  'do not share': { category: 'PROPRIETARY', score: 60 },
  'not for distribution': { category: 'PROPRIETARY', score: 55 },
  'trade secret': { category: 'PROPRIETARY', score: 70 },
  'attorney-client': { category: 'PROPRIETARY', score: 80 },
  'private key': { category: 'PASSWORD', score: 85 },
  'access token': { category: 'API_KEY', score: 65 },
  'bearer token': { category: 'API_KEY', score: 65 },
  'classified': { category: 'PROPRIETARY', score: 75 },
};

export function normalizeDetections(findingLabels = []) {
  const normalized = [];
  for (const label of findingLabels) {
    const mapping = LABEL_TO_CATEGORY_MAPPING[label];
    if (mapping) {
      normalized.push({
        label,
        category: mapping.category,
        baseScore: mapping.score,
      });
    } else {
      normalized.push({
        label,
        category: 'UNKNOWN',
        baseScore: 20, // Default low score for unknown labels
      });
    }
  }
  return normalized;
}

// ─── 2. Risk & Severity Calculation ───────────────────────────────────────────

export function calculateRiskAndSeverity(normalizedDetections) {
  if (normalizedDetections.length === 0) {
    return { riskScore: 0, severity: 'LOW' };
  }

  // Risk score is the maximum base score plus a small modifier for multiple findings
  let maxScore = 0;
  for (const detection of normalizedDetections) {
    if (detection.baseScore > maxScore) {
      maxScore = detection.baseScore;
    }
  }

  // Add 2 points per additional finding, capped at 100
  let totalScore = maxScore + ((normalizedDetections.length - 1) * 2);
  if (totalScore > 100) totalScore = 100;

  // Determine Severity
  let severity = 'LOW';
  if (totalScore >= 90) {
    severity = 'CRITICAL';
  } else if (totalScore >= 70) {
    severity = 'HIGH';
  } else if (totalScore >= 40) {
    severity = 'MEDIUM';
  }

  return { riskScore: totalScore, severity };
}

const SEVERITY_LEVELS = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3, 'CRITICAL': 4 };

// ─── 3. Policy Evaluation ─────────────────────────────────────────────────────

const POLICY_ACTIONS = new Set(['ALLOW', 'WARN', 'SANITIZE', 'BLOCK']);

export async function evaluatePolicy({ orgId, userRef, findingLabels, orgSettings }) {
  const normalized = normalizeDetections(findingLabels);
  const { riskScore, severity } = calculateRiskAndSeverity(normalized);
  
  let defaultAction = orgSettings?.defaultAction;
  let invalidPolicy = false;
  
  if (!POLICY_ACTIONS.has(defaultAction)) {
    defaultAction = 'BLOCK';
    invalidPolicy = true;
  }

  let finalDecision = {
    decision: defaultAction,
    reason: invalidPolicy ? 'invalid_or_missing_policy' : 'tenant_default_action',
    policyId: null,
    policyVersion: orgSettings?.policyVersion || 1,
    riskScore,
    severity
  };

  if (invalidPolicy) {
    return finalDecision; // Fast fail
  }

  if (riskScore === 0) {
    // If there are no findings, the Phase 1 behavior was to apply the tenant default action
    // but typically we would ALLOW if default was BLOCK on high. We just return the tenant default.
    return finalDecision;
  }

  try {
    // Load active policies for the tenant (sorted by precedence descending, handled by index/query)
    // For Phase 2B, we fetch TENANT policies. If GROUP/USER added, fetch those too.
    const query = {
      orgId,
      status: 'ACTIVE',
      $or: [
        { scope: 'TENANT' },
        { scope: 'USER', targetId: userRef._id },
        ...(userRef.teamId ? [{ scope: 'GROUP', targetId: userRef.teamId }] : [])
      ]
    };

    const policies = await Policy.find(query).sort({ precedence: -1 }).lean();
    
    // Find the first policy that matches any of our normalized detections
    let matchedPolicy = null;
    let matchedRule = null;

    for (const policy of policies) {
      for (const rule of policy.rules) {
        for (const detection of normalized) {
          // Category match
          if (rule.category === '*' || rule.category === detection.category) {
            // Check severity/risk thresholds
            let triggersSeverity = false;
            let triggersRisk = false;

            if (rule.severityThreshold && SEVERITY_LEVELS[severity] >= SEVERITY_LEVELS[rule.severityThreshold]) {
               triggersSeverity = true;
            }
            if (rule.riskThreshold && riskScore >= rule.riskThreshold) {
               triggersRisk = true;
            }

            // If rule has both, both must match? No, usually OR. We treat either as sufficient.
            // If neither threshold is defined, the category match is sufficient.
            if ((!rule.severityThreshold && !rule.riskThreshold) || triggersSeverity || triggersRisk) {
               matchedPolicy = policy;
               matchedRule = rule;
               break;
            }
          }
        }
        if (matchedPolicy) break;
      }
      if (matchedPolicy) break;
    }

    if (matchedPolicy) {
      finalDecision.decision = matchedPolicy.action;
      finalDecision.reason = `matched_policy_rule_${matchedRule.category}`;
      finalDecision.policyId = matchedPolicy._id;
      finalDecision.policyVersion = matchedPolicy.version;
    } else {
      // Apply org defaults if no specific policy overrides
      if (orgSettings?.blockOnHigh && SEVERITY_LEVELS[severity] >= SEVERITY_LEVELS['HIGH']) {
        finalDecision.decision = 'BLOCK';
        finalDecision.reason = 'org_default_block_on_high';
      }
    }

  } catch (error) {
    logger.error('Policy evaluation failed, falling back to safe default', error);
    finalDecision.decision = 'BLOCK'; // Fail-closed
    finalDecision.reason = 'policy_evaluation_error';
  }

  return finalDecision;
}
