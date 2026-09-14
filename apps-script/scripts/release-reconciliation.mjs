import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const ISSUE_TYPES = Object.freeze([
  'duplicateQueueIds', 'duplicateQueueEventIds', 'pendingAlreadyLogged',
  'processedMissingJournal', 'nonChargeHasJournal', 'orphanJournalRows',
  'queueJournalMismatch', 'pendingMissingCalendar', 'calendarQueueTimeMismatch',
  'queuePointsToNonTraining', 'calendarTrainingMissingQueue',
]);
export const SAFETY_TYPES = Object.freeze([
  'duplicateJournalIds', 'duplicateClientIds', 'duplicateBlockIds', 'duplicatePaymentIds',
  'finance', 'payment', 'clientBlockLink', 'aliases', 'blockJournalCounts', 'queueErrors',
  'durablePending', 'durableStale', 'manualReview',
]);
export const V57_POLICY = Object.freeze({
  contractVersion: 1, state: 'prepared', allowedIssueType: 'calendarTrainingMissingQueue',
  maxPreflightAgeSeconds: 300, maxActivationSeconds: 1800,
  successfulSyncRequiresCompletedEvidence: true, postSyncReconciliationIssues: 0,
});

function canonical(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    assert.ok(Number.isFinite(value.getTime()), 'invalid Date evidence');
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  assert.ok(value !== undefined && (typeof value !== 'number' || Number.isFinite(value)),
    'non-JSON evidence');
  return JSON.stringify(value);
}
export function fingerprint(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function hash(value) { assert.match(value, /^[a-f0-9]{64}$/, 'invalid fingerprint'); }
function time(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'UTC timestamp required');
  const result = Date.parse(value);
  assert.ok(Number.isFinite(result), 'invalid time');
  assert.equal(new Date(result).toISOString(), value, 'invalid calendar date');
  return result;
}
function generation(value) { assert.ok(Number.isSafeInteger(value) && value >= 0, 'invalid generation'); }
function exactKeys(value, keys) { assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'evidence fields differ'); }

export function normalizedIssues(report) {
  exactKeys(report, ISSUE_TYPES);
  const issues = [];
  for (const type of ISSUE_TYPES) {
    assert.ok(Array.isArray(report[type]), 'full issue identities required, not counts');
    for (const issue of report[type]) {
      exactKeys(issue, ['identitySha256', 'semanticSha256']);
      hash(issue.identitySha256); hash(issue.semanticSha256);
      issues.push({type, ...issue});
    }
  }
  issues.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  assert.equal(new Set(issues.map(x => x.type + ':' + x.identitySha256)).size, issues.length,
    'duplicate issue identity');
  return issues;
}
function safety(report) {
  exactKeys(report, SAFETY_TYPES);
  for (const [key, findings] of Object.entries(report)) {
    assert.ok(Array.isArray(findings), `${key}: complete findings required`);
    assert.equal(findings.length, 0, `${key}: never exempt`);
  }
}
function knownOnly(issues) {
  assert.ok(issues.every(issue => issue.type === V57_POLICY.allowedIssueType), 'issue type never exempt');
}

// Input must be collected by the owner read-only collector using the actual bundles.
// A hash detects changed evidence; it does not confer approval or authenticate its producer.
// The approval hash is pinned separately, never taken from the package being checked.
export function createAcceptancePackage(evidence) {
  const {capturedAt, expiresAt, releaseCommitSha, candidateTreeSha256, baselineTreeSha256,
    numberedSourceSha256, baselineGeneration, revision, report, safety: safetyReport,
    writeSet, v56WideWriteSet, horizonProof, projectedReport} = evidence;
  assert.match(releaseCommitSha, /^[a-f0-9]{40}$/);
  for (const value of [candidateTreeSha256, baselineTreeSha256, numberedSourceSha256, revision]) hash(value);
  assert.equal(numberedSourceSha256, candidateTreeSha256, 'numbered source must equal candidate');
  generation(baselineGeneration);
  const age = time(expiresAt) - time(capturedAt);
  assert.ok(age > 0 && age <= V57_POLICY.maxPreflightAgeSeconds * 1000, 'preflight expiry exceeds policy');
  safety(safetyReport);
  const issues = normalizedIssues(report);
  knownOnly(issues);
  assert.equal(normalizedIssues(projectedReport).length, 0, 'projected reconciliation must be zero');
  assert.deepEqual(writeSet, v56WideWriteSet, 'candidate differs from normal v56 wide ingestion');
  assert.ok(Array.isArray(writeSet) && Array.isArray(horizonProof));
  const additions = [];
  const rows = new Set();
  for (const write of writeSet) {
    exactKeys(write, ['row', 'before', 'after', 'issueIdentitySha256']);
    assert.ok(Number.isSafeInteger(write.row) && write.row >= 4 && !rows.has(write.row), 'invalid/duplicate row');
    rows.add(write.row);
    assert.ok(Array.isArray(write.after) && write.after.length === 17, 'all 17 values required');
    if (write.before === null) {
      hash(write.issueIdentitySha256);
      assert.equal(write.after[13], 'Ожидает', 'addition must remain pending');
      assert.ok(write.after[14] === '' || write.after[14] === null, 'no processed timestamp');
      additions.push(write.issueIdentitySha256);
    } else {
      assert.equal(write.issueIdentitySha256, null);
      assert.deepEqual(write.before, write.after, 'existing row semantic change');
    }
  }
  assert.deepEqual(additions.sort(), issues.map(x => x.identitySha256).sort(), 'missing issue/addition bijection');
  const proofs = horizonProof.map(proof => {
    exactKeys(proof, ['identitySha256', 'updatedAt', 'incrementalUpdatedMin',
      'eventStart', 'horizonStart', 'horizonEnd', 'queueMatches', 'journalMatches']);
    hash(proof.identitySha256);
    assert.ok(time(proof.updatedAt) < time(proof.incrementalUpdatedMin), 'not a v56 horizon omission');
    assert.ok(time(proof.eventStart) >= time(proof.horizonStart) &&
      time(proof.eventStart) < time(proof.horizonEnd), 'event outside reconciliation horizon');
    assert.equal(proof.queueMatches, 0); assert.equal(proof.journalMatches, 0);
    return proof.identitySha256;
  }).sort();
  assert.deepEqual(proofs, additions, 'horizon proof must cover exact issue set');
  const body = {formatVersion: 1, baselineVersion: 56, candidateVersion: 57, capturedAt, expiresAt,
    releaseCommitSha, candidateTreeSha256, baselineTreeSha256, numberedSourceSha256,
    baselineGeneration, revision, issues, issuesFingerprint: fingerprint(issues),
    writeSetFingerprint: fingerprint(writeSet), evidenceFingerprint: fingerprint(evidence),
    expectedPostSyncIssues: 0};
  return {...body, fingerprint: fingerprint(body)};
}

export function openActivation(approved, pinnedFingerprint, now) {
  verifyPackage(approved, pinnedFingerprint);
  assert.ok(time(now) >= time(approved.capturedAt) && time(now) <= time(approved.expiresAt), 'stale preflight');
  return {formatVersion: 1, approval: pinnedFingerprint, openedAt: now, phase: 'pre',
    highestGeneration: approved.baselineGeneration};
}
function verifyPackage(approved, pinnedFingerprint) {
  exactKeys(approved, ['formatVersion', 'baselineVersion', 'candidateVersion', 'capturedAt', 'expiresAt',
    'releaseCommitSha', 'candidateTreeSha256', 'baselineTreeSha256', 'numberedSourceSha256',
    'baselineGeneration', 'revision', 'issues', 'issuesFingerprint', 'writeSetFingerprint',
    'evidenceFingerprint', 'expectedPostSyncIssues', 'fingerprint']);
  hash(pinnedFingerprint);
  const {fingerprint: supplied, ...body} = approved;
  assert.equal(fingerprint(body), supplied, 'package fingerprint changed');
  assert.equal(supplied, pinnedFingerprint, 'unapproved package');
  assert.equal(approved.formatVersion, 1);
  assert.equal(approved.baselineVersion, 56); assert.equal(approved.candidateVersion, 57);
  assert.equal(approved.expectedPostSyncIssues, 0);
  assert.match(approved.releaseCommitSha, /^[a-f0-9]{40}$/);
  for (const key of ['candidateTreeSha256', 'baselineTreeSha256', 'numberedSourceSha256',
    'revision', 'issuesFingerprint', 'writeSetFingerprint', 'evidenceFingerprint']) hash(approved[key]);
  assert.equal(approved.numberedSourceSha256, approved.candidateTreeSha256);
  generation(approved.baselineGeneration);
  assert.ok(time(approved.expiresAt) > time(approved.capturedAt) &&
    time(approved.expiresAt) - time(approved.capturedAt) <= V57_POLICY.maxPreflightAgeSeconds * 1000);
  assert.equal(fingerprint(approved.issues), approved.issuesFingerprint);
  knownOnly(approved.issues);
}

// Returns the state even on rejection. Persist it BEFORE using the verdict.
// Once a candidate generation has started, the pre-activation exception is consumed,
// including on failed/partial sync. Callers must never recreate a missing state file.
export function evaluateActivation(approved, pinnedFingerprint, previousState, observation, now = new Date().toISOString()) {
  const state = structuredClone(previousState);
  try {
    verifyPackage(approved, pinnedFingerprint);
    exactKeys(state, ['formatVersion', 'approval', 'openedAt', 'phase', 'highestGeneration']);
    assert.equal(state.formatVersion, 1); assert.equal(state.approval, pinnedFingerprint);
    assert.ok(time(state.openedAt) >= time(approved.capturedAt) &&
      time(state.openedAt) <= time(approved.expiresAt), 'invalid activation admission');
    assert.ok(['pre', 'post'].includes(state.phase));
    generation(state.highestGeneration); generation(observation.generation);
    assert.ok(state.highestGeneration >= approved.baselineGeneration);
    assert.ok(observation.generation >= state.highestGeneration, 'generation went backwards');
    if (observation.generation > approved.baselineGeneration) state.phase = 'post';
    // Native generation advances at completion, not at start. A source-bound
    // running/failed observation must burn the exception before any later check.
    if (observation.sync && observation.sync.version === 57 &&
        observation.sync.sourceTreeSha256 === approved.candidateTreeSha256 &&
        time(observation.sync.startedAt) >= time(state.openedAt)) state.phase = 'post';
    state.highestGeneration = observation.generation;
    assert.equal(observation.releaseCommitSha, approved.releaseCommitSha, 'release commit changed');
    assert.equal(observation.candidateTreeSha256, approved.candidateTreeSha256, 'candidate changed');
    assert.equal(observation.numberedSourceSha256, approved.numberedSourceSha256, 'numbered source changed');
    safety(observation.safety);
    const issues = normalizedIssues(observation.report);
    const at = time(observation.checkedAt);
    assert.ok(time(now) >= at && time(now) - at <= 60_000, 'observation is not fresh');
    assert.ok(at >= time(state.openedAt), 'observation precedes activation');
    if (state.phase === 'pre') {
      // Admission must occur before package expiry; the sealed activation then has
      // its own bounded lifetime, long enough for the mandatory seven-minute drain.
      assert.ok(time(state.openedAt) <= time(approved.expiresAt), 'activation admitted after expiry');
      assert.ok(at - time(state.openedAt) <= V57_POLICY.maxActivationSeconds * 1000, 'activation expired');
      assert.deepEqual(issues, approved.issues, 'exact issue set changed');
      assert.equal(observation.revision, approved.revision, 'revision changed');
      assert.equal(observation.writeSetFingerprint, approved.writeSetFingerprint, 'write set changed');
      assert.equal(observation.sync, null, 'unexpected sync evidence before generation change');
      return {ok: true, verdict: 'PROVISIONAL_PASS', state};
    }
    assert.equal(issues.length, 0, 'post-sync reconciliation must be zero');
    const sync = observation.sync;
    assert.ok(sync, 'completed post-sync evidence required');
    assert.equal(sync.version, 57); assert.equal(sync.status, 'succeeded');
    assert.equal(sync.generation, observation.generation);
    assert.ok(sync.generation > approved.baselineGeneration, 'completed candidate generation must advance');
    assert.equal(sync.sourceTreeSha256, approved.candidateTreeSha256);
    assert.ok(time(sync.startedAt) >= time(state.openedAt));
    assert.ok(time(sync.completedAt) >= time(sync.startedAt) && time(sync.completedAt) <= at);
    assert.equal(sync.postSync.completed, true);
    assert.equal(sync.postSync.generation, sync.generation);
    assert.ok(time(sync.postSync.checkedAt) >= time(sync.completedAt) && time(sync.postSync.checkedAt) <= at);
    for (const key of ['issues', 'drift', 'pending', 'immediate']) assert.equal(sync.postSync[key], 0);
    assert.equal(sync.postSync.overflow, false);
    return {ok: true, verdict: 'POST_SYNC_PASS', state};
  } catch (error) {
    return {ok: false, verdict: 'NO_GO', reason: error.message, state};
  }
}
