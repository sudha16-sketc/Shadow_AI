/**
 * Schema ↔ API ↔ policy-engine contract.
 *
 * These are security properties, not implementation trivia: if the database
 * schema cannot store an action the API accepts, the control silently turns
 * into a 500 at the moment an operator tries to enable it (this is exactly how
 * SANITIZE became unreachable once).
 *
 * This file deliberately does NOT use tests/helpers/mock-app.js, which mocks
 * `src/models/index.js` for the request-level suites.
 */
import { describe, it, expect } from '@jest/globals';
import { Org, Event } from '../src/models/index.js';
import { POLICY_ACTIONS } from '../src/services/policy-engine.js';

describe('enforcement actions survive the whole stack', () => {
  const actions = ['ALLOW', 'WARN', 'SANITIZE', 'BLOCK'];

  it('stores every action the API can select', () => {
    const doc = new Org({ name: 'Enum Co', lifecycleStatus: 'active' });

    for (const action of actions) {
      doc.settings.defaultAction = action;
      const invalid = doc.validateSync()?.errors?.['settings.defaultAction'];
      expect(invalid).toBeUndefined();
    }
  });

  it('refuses an action that no layer understands', () => {
    const doc = new Org({ name: 'Enum Co', lifecycleStatus: 'active' });
    doc.settings.defaultAction = 'DROP_ALL';
    expect(doc.validateSync()?.errors?.['settings.defaultAction']).toBeTruthy();
  });

  it('the policy engine and the database agree on the action set', () => {
    const stored = new Org({ name: 'Enum Co', lifecycleStatus: 'active' })
      .schema.path('settings.defaultAction').enumValues;
    expect([...stored].sort()).toEqual([...actions].sort());
    expect([...POLICY_ACTIONS].sort()).toEqual([...actions].sort());
  });

  it('events can record the CRITICAL severity the detector emits', () => {
    const doc = new Event({
      orgId: '64b000000000000000000000',
      deviceId: 'dev',
      userRef: 'user',
      findingLabels: ['AWS Access Key'],
      riskScore: 90,
      severity: 'CRITICAL',
      policyDecision: 'BLOCK',
      enforcementStatus: 'PREVENTED',
      clientTelemetry: { textLength: 10, detectionLabels: ['AWS Access Key'] },
      timestamp: new Date(),
    });
    const err = doc.validateSync();
    expect(err?.errors?.severity).toBeUndefined();
    expect(err?.errors?.enforcementStatus).toBeUndefined();
  });
});
