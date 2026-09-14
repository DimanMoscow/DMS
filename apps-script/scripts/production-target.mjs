import assert from 'node:assert/strict';
import {V57_POLICY} from './release-reconciliation.mjs';

// Version 2 is an immutable release target, never a claim of observed production.
// Live acceptance receipts stay outside Git and bind the final release commit SHA.
export function verifyPreparedTarget(target) {
  assert.deepEqual(Object.keys(target).sort(), ['baseline', 'candidate', 'formatVersion',
    'numberedVersion', 'releaseGate', 'runtimeIdentity', 'snapshot'].sort());
  assert.equal(target.formatVersion, 2);
  assert.equal(target.candidate, 'v57'); assert.equal(target.snapshot, 'v57');
  assert.equal(target.numberedVersion, 57);
  assert.deepEqual(target.releaseGate, V57_POLICY);
  assert.equal(target.baseline.formatVersion, 1);
  assert.equal(target.baseline.candidate, 'v56'); assert.equal(target.baseline.snapshot, 'v56');
  assert.equal(target.baseline.numberedVersion, 56);
  return true;
}
export function preflightBaseline(target) {
  if (target.formatVersion === 1) return target;
  verifyPreparedTarget(target);
  return target.baseline;
}
