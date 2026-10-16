/**
 * Shadow AI Auditor — Interception Workflow
 *
 * Pure, dependency-free state machine for the paste/submit interception
 * workflow. Kept free of DOM and `chrome.*` references so it can be unit
 * tested directly (see tests/interception-workflow.test.js) and bundled into
 * the content script by Vite.
 *
 * Guarantees modelled here:
 *   - every paste is inspected as its own operation (no de-duplication)
 *   - each operation has a unique id and isolated state
 *   - a submission is only authorised after a fresh rescan, or for the exact
 *     text an operation was approved/masked for
 *   - no raw text is ever logged or persisted by this module
 */

export const OPERATION_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  MASKED: 'masked',
  CANCELLED: 'cancelled',
});

export const INTERCEPT_REASON = Object.freeze({
  PENDING_DECISION: 'pending_decision',
  APPROVED: 'approved',
  CLEAN: 'clean',
  HIGH_RISK: 'high_risk',
});

let fallbackCounter = 0;

/**
 * Generate a unique operation id. Prefers crypto.randomUUID when available and
 * always appends a monotonic suffix so ids stay unique even in odd runtimes.
 */
export function generateOperationId(cryptoRef = globalThis.crypto) {
  fallbackCounter += 1;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') {
    return `${cryptoRef.randomUUID()}-${fallbackCounter}`;
  }
  return `op-${Date.now().toString(36)}-${fallbackCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Decide whether an analysis result should be intercepted at the given
 * threshold. Only results with a positive score at or above the threshold are
 * intercepted; clean content is allowed through untouched.
 */
export function shouldIntercept(result, threshold) {
  if (!result || typeof result.score !== 'number') return false;
  return result.score > 0 && result.score >= threshold;
}

/**
 * Create a controller that tracks interception operations independently.
 * @param {{ idFactory?: () => string }} [options]
 */
export function createInterceptionController({ idFactory = generateOperationId } = {}) {
  const operations = new Map();

  function begin(text, result, meta = {}) {
    const operation = {
      id: idFactory(),
      text: typeof text === 'string' ? text : '',
      result: result ?? null,
      status: OPERATION_STATUS.PENDING,
      trigger: meta.trigger ?? 'unknown',
      createdAt: Date.now(),
      revisions: [typeof text === 'string' ? text : ''],
    };
    operations.set(operation.id, operation);
    return operation;
  }

  function get(id) {
    return operations.get(id) ?? null;
  }

  function markApproved(id) {
    const operation = get(id);
    if (!operation) return null;
    operation.status = OPERATION_STATUS.APPROVED;
    return operation;
  }

  function markCancelled(id) {
    const operation = get(id);
    if (!operation) return null;
    operation.status = OPERATION_STATUS.CANCELLED;
    return operation;
  }

  function markMasked(id, newText, result = null) {
    const operation = get(id);
    if (!operation) return null;
    operation.status = OPERATION_STATUS.MASKED;
    operation.text = typeof newText === 'string' ? newText : operation.text;
    operation.revisions.push(operation.text);
    if (result) operation.result = result;
    return operation;
  }

  /**
   * Atomically take an approved/masked operation whose current text exactly
   * matches the text being submitted. Removes it so a single approval can only
   * authorise one submission.
   */
  function consumeApproved(text) {
    for (const operation of operations.values()) {
      const approved = operation.status === OPERATION_STATUS.APPROVED
        || operation.status === OPERATION_STATUS.MASKED;
      if (approved && operation.text === text) {
        operations.delete(operation.id);
        return operation;
      }
    }
    return null;
  }

  /**
   * Take an approval for a submission from a specific input. Exact text match
   * wins; otherwise a paste-originated approval is honoured when its pasted
   * text is still contained in the field and the input element is the same.
   * This prevents a "Proceed" acknowledgement on a paste from re-prompting on
   * the very next send, while still requiring a rescan for any other content.
   */
  function consumeApprovedForInput(text, target) {
    for (const operation of operations.values()) {
      const approved = operation.status === OPERATION_STATUS.APPROVED
        || operation.status === OPERATION_STATUS.MASKED;
      if (!approved) continue;
      if (target && operation.inputTarget && operation.inputTarget !== target) continue;
      if (operation.text === text) {
        operations.delete(operation.id);
        return operation;
      }
      if (operation.trigger === 'paste' && operation.text && text.includes(operation.text)) {
        operations.delete(operation.id);
        return operation;
      }
    }
    return null;
  }

  function getBlockingOperation() {
    for (const operation of operations.values()) {
      if (operation.status === OPERATION_STATUS.PENDING) return operation;
    }
    return null;
  }

  function hasBlockingOperation() {
    return getBlockingOperation() !== null;
  }

  function clear(id) {
    return operations.delete(id);
  }

  function size() {
    return operations.size;
  }

  return {
    begin,
    get,
    markApproved,
    markCancelled,
    markMasked,
    consumeApproved,
    consumeApprovedForInput,
    getBlockingOperation,
    hasBlockingOperation,
    clear,
    size,
  };
}

/**
 * Gate every submission attempt. A fresh analysis is always performed for
 * non-approved text, which is what makes the rescan mandatory: a stale
 * approval can never authorise a different (or edited) payload.
 *
 * @returns {{ allowed: boolean, reason: string, operation: object|null, result: object|null }}
 */
export function authorizeSubmission(controller, text, { analyse, threshold, trigger = 'submit', approved = undefined } = {}) {
  const blocking = controller.getBlockingOperation();
  if (blocking) {
    return { allowed: false, reason: INTERCEPT_REASON.PENDING_DECISION, operation: blocking, result: blocking.result };
  }

  const approval = approved !== undefined ? approved : controller.consumeApproved(text);
  if (approval) {
    return { allowed: true, reason: INTERCEPT_REASON.APPROVED, operation: approval, result: approval.result };
  }

  const result = analyse(text);
  if (!shouldIntercept(result, threshold)) {
    return { allowed: true, reason: INTERCEPT_REASON.CLEAN, operation: null, result };
  }

  const operation = controller.begin(text, result, { trigger });
  return { allowed: false, reason: INTERCEPT_REASON.HIGH_RISK, operation, result };
}
