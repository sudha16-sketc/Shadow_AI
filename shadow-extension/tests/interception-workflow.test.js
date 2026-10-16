/**
 * Extension interception workflow tests (Phases 4–5).
 *
 * Two layers:
 *  1. Unit tests against the pure state machine in src/interceptionWorkflow.js
 *     (operation isolation, unique ids, approval/rescan gating).
 *  2. Static assertions that src/content.js wires the workflow correctly:
 *     every paste inspected, cancel removes text, mask opens an editor, and
 *     submissions are rescanned.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createInterceptionController,
  authorizeSubmission,
  shouldIntercept,
  generateOperationId,
  OPERATION_STATUS,
  INTERCEPT_REASON,
} from '../src/interceptionWorkflow.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const contentScript = readFileSync(join(root, 'src', 'content.js'), 'utf8');

const HIGH = { score: 90, severity: 'HIGH', findings: [{ label: 'AWS Access Key', score: 90 }] };
const LOW = { score: 0, severity: 'LOW', findings: [], maskedPreview: '' };
const analyse = (text) => (text.includes('AKIA') ? HIGH : LOW);
const THRESHOLD = 40;

test('operation ids are unique across many operations', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(generateOperationId());
  assert.equal(ids.size, 500);
});

test('each operation keeps isolated state', () => {
  const controller = createInterceptionController();
  const a = controller.begin('AKIA1', HIGH, { trigger: 'paste' });
  const b = controller.begin('AKIA2', HIGH, { trigger: 'submit' });

  assert.notEqual(a.id, b.id);
  controller.markApproved(a.id);

  assert.equal(controller.get(a.id).status, OPERATION_STATUS.APPROVED);
  assert.equal(controller.get(b.id).status, OPERATION_STATUS.PENDING);
  assert.equal(controller.getBlockingOperation().id, b.id);
});

test('cancelling an operation releases the blocking state without approving it', () => {
  const controller = createInterceptionController();
  const op = controller.begin('AKIA-secret', HIGH, { trigger: 'paste' });
  assert.equal(controller.hasBlockingOperation(), true);

  controller.markCancelled(op.id);

  assert.equal(controller.hasBlockingOperation(), false);
  assert.equal(controller.consumeApproved('AKIA-secret'), null);
});

test('consumeApproved only matches the exact approved text and is single-use', () => {
  const controller = createInterceptionController();
  const op = controller.begin('AKIA-secret', HIGH, { trigger: 'submit' });
  controller.markApproved(op.id);

  assert.equal(controller.consumeApproved('AKIA-secret-plus-more'), null);
  const consumed = controller.consumeApproved('AKIA-secret');
  assert.equal(consumed.id, op.id);
  assert.equal(controller.consumeApproved('AKIA-secret'), null, 'approval must be single-use');
});

test('masked operations authorise the edited text, not the original', () => {
  const controller = createInterceptionController();
  const op = controller.begin('AKIA-secret', HIGH, { trigger: 'submit' });
  controller.markMasked(op.id, 'AKIA****cret', LOW);

  assert.equal(controller.consumeApproved('AKIA-secret'), null, 'original must no longer pass');
  assert.equal(controller.consumeApproved('AKIA****cret').id, op.id);
});

test('paste approval is honoured for the same input when its text is still contained', () => {
  const controller = createInterceptionController();
  const target = { id: 'input-1' };
  const op = controller.begin('AKIA-secret', HIGH, { trigger: 'paste' });
  op.inputTarget = target;
  controller.markApproved(op.id);

  assert.equal(controller.consumeApprovedForInput('prefix AKIA-secret suffix', target).id, op.id);
});

test('paste approval does not leak to a different input element', () => {
  const controller = createInterceptionController();
  const op = controller.begin('AKIA-secret', HIGH, { trigger: 'paste' });
  op.inputTarget = { id: 'input-1' };
  controller.markApproved(op.id);

  assert.equal(controller.consumeApprovedForInput('AKIA-secret', { id: 'input-2' }), null);
});

test('shouldIntercept ignores clean results and respects the threshold', () => {
  assert.equal(shouldIntercept(LOW, THRESHOLD), false);
  assert.equal(shouldIntercept({ score: 39 }, THRESHOLD), false);
  assert.equal(shouldIntercept({ score: 40 }, THRESHOLD), true);
  assert.equal(shouldIntercept(null, THRESHOLD), false);
});

test('authorizeSubmission rescans every submission and blocks high-risk content', () => {
  const controller = createInterceptionController();

  const clean = authorizeSubmission(controller, 'hello world', { analyse, threshold: THRESHOLD });
  assert.equal(clean.allowed, true);
  assert.equal(clean.reason, INTERCEPT_REASON.CLEAN);

  const risky = authorizeSubmission(controller, 'my key AKIA1234567890ABCDEF', { analyse, threshold: THRESHOLD });
  assert.equal(risky.allowed, false);
  assert.equal(risky.reason, INTERCEPT_REASON.HIGH_RISK);
  assert.ok(risky.operation);
});

test('authorizeSubmission refuses to resubmit while a decision is pending', () => {
  const controller = createInterceptionController();
  controller.begin('AKIA-secret', HIGH, { trigger: 'paste' });

  const decision = authorizeSubmission(controller, 'AKIA-secret', { analyse, threshold: THRESHOLD });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, INTERCEPT_REASON.PENDING_DECISION);
});

test('repeated pastes are inspected independently and never de-duplicated', () => {
  const controller = createInterceptionController();
  const first = authorizeSubmission(controller, 'AKIA-secret', { analyse, threshold: THRESHOLD });
  controller.markCancelled(first.operation.id);

  const second = authorizeSubmission(controller, 'AKIA-secret', { analyse, threshold: THRESHOLD });
  assert.equal(second.allowed, false);
  assert.notEqual(second.operation.id, first.operation.id, 'each paste is a new operation');
});

test('content script inspects every paste and clears text on cancel', () => {
  assert.match(contentScript, /addEventListener\(\s*["']paste["']/);
  assert.match(contentScript, /handleCancel/);
  assert.match(contentScript, /writeInput\(operation\.inputTarget,\s*""\)/);
});

test('content script offers a mask editor that rescans before releasing', () => {
  assert.match(contentScript, /showMaskEditor/);
  assert.match(contentScript, /sam-mask-text/);
  assert.match(contentScript, /handleMaskApply/);
  assert.match(contentScript, /const rescan = analyse\(edited\)/);
});

test('content script gates submissions on click and Enter with a fresh rescan', () => {
  assert.match(contentScript, /authorizeSubmission/);
  assert.match(contentScript, /interceptSubmit/);
  assert.match(contentScript, /addEventListener\(\s*["']click["']/);
  assert.match(contentScript, /addEventListener\(\s*["']keydown["']/);
});

test('content script uses unique per-operation ids and never logs raw content', () => {
  assert.match(contentScript, /createInterceptionController/);
  assert.match(contentScript, /controller\.begin\(/);
  assert.ok(!contentScript.includes('sample:'), 'raw samples must not be logged');
  assert.ok(!/console\.(log|info|debug|warn|error)\([^)]*\b(text|value|textContent|innerText|content)\s*[,)]/.test(contentScript));
});
