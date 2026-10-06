import { normalizeDetections, calculateRiskAndSeverity, evaluatePolicy } from '../src/services/policy-engine.js';
import { Policy, Org, User } from '../src/models/index.js';
import { jest } from '@jest/globals';
import mongoose from 'mongoose';

describe('Server-Side Policy Engine', () => {
  describe('normalizeDetections', () => {
    it('normalizes known labels correctly', () => {
      const result = normalizeDetections(['AWS Access Key', 'Social Security Number']);
      expect(result).toHaveLength(2);
      expect(result[0].category).toBe('API_KEY');
      expect(result[0].baseScore).toBe(90);
      expect(result[1].category).toBe('PII');
      expect(result[1].baseScore).toBe(95);
    });

    it('assigns UNKNOWN category to unknown labels', () => {
      const result = normalizeDetections(['Weird Unknown Secret']);
      expect(result[0].category).toBe('UNKNOWN');
      expect(result[0].baseScore).toBe(20);
    });
  });

  describe('calculateRiskAndSeverity', () => {
    it('calculates 0 risk for no detections', () => {
      const { riskScore, severity } = calculateRiskAndSeverity([]);
      expect(riskScore).toBe(0);
      expect(severity).toBe('LOW');
    });

    it('adds 2 points for multiple findings', () => {
      const { riskScore, severity } = calculateRiskAndSeverity([
        { baseScore: 90 },
        { baseScore: 40 },
        { baseScore: 40 }
      ]);
      expect(riskScore).toBe(94); // 90 + 2*2
      expect(severity).toBe('CRITICAL');
    });

    it('caps risk at 100', () => {
      const { riskScore, severity } = calculateRiskAndSeverity(Array(10).fill({ baseScore: 95 }));
      expect(riskScore).toBe(100);
      expect(severity).toBe('CRITICAL');
    });

    it('maps correctly to severity thresholds', () => {
      expect(calculateRiskAndSeverity([{ baseScore: 30 }]).severity).toBe('LOW');
      expect(calculateRiskAndSeverity([{ baseScore: 40 }]).severity).toBe('MEDIUM');
      expect(calculateRiskAndSeverity([{ baseScore: 70 }]).severity).toBe('HIGH');
      expect(calculateRiskAndSeverity([{ baseScore: 90 }]).severity).toBe('CRITICAL');
    });
  });

  // Mongoose tests would require a test DB setup. We mock Policy.find.
  describe('evaluatePolicy', () => {
    let mockUser;
    
    beforeAll(() => {
      mockUser = { _id: new mongoose.Types.ObjectId() };
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns tenant default when no finding labels', async () => {
      const result = await evaluatePolicy({
        orgId: new mongoose.Types.ObjectId(),
        userRef: mockUser,
        findingLabels: [],
        orgSettings: { defaultAction: 'BLOCK' }
      });
      expect(result.decision).toBe('BLOCK');
      expect(result.riskScore).toBe(0);
      expect(result.reason).toBe('tenant_default_action');
    });

    it('falls back to tenant default if no policies exist and no high risk defaults apply', async () => {
      jest.spyOn(Policy, 'find').mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
      const result = await evaluatePolicy({
        orgId: new mongoose.Types.ObjectId(),
        userRef: mockUser,
        findingLabels: ['Email Address'],
        orgSettings: { defaultAction: 'WARN', blockOnHigh: true }
      });
      expect(result.decision).toBe('WARN');
      expect(result.riskScore).toBe(40);
    });

    it('applies blockOnHigh org default correctly', async () => {
      jest.spyOn(Policy, 'find').mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([]) }) });
      const result = await evaluatePolicy({
        orgId: new mongoose.Types.ObjectId(),
        userRef: mockUser,
        findingLabels: ['Social Security Number'], // score 95 -> CRITICAL -> overrides default WARN
        orgSettings: { defaultAction: 'WARN', blockOnHigh: true }
      });
      expect(result.decision).toBe('BLOCK');
      expect(result.reason).toBe('org_default_block_on_high');
    });

    it('applies matching custom policy rule', async () => {
      const mockPolicies = [{
        _id: 'policy_1',
        version: 2,
        action: 'BLOCK',
        rules: [{ category: 'API_KEY', severityThreshold: 'HIGH' }]
      }];
      jest.spyOn(Policy, 'find').mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(mockPolicies) }) });
      
      const result = await evaluatePolicy({
        orgId: new mongoose.Types.ObjectId(),
        userRef: mockUser,
        findingLabels: ['AWS Access Key'], // score 90 -> API_KEY, CRITICAL
        orgSettings: { defaultAction: 'ALLOW' }
      });

      expect(result.decision).toBe('BLOCK');
      expect(result.policyId).toBe('policy_1');
      expect(result.policyVersion).toBe(2);
      expect(result.reason).toBe('matched_policy_rule_API_KEY');
    });
  });
});
