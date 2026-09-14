import assert from 'node:assert/strict';
import {ISSUE_TYPES, SAFETY_TYPES, fingerprint, createAcceptancePackage} from './release-reconciliation.mjs';

// Native v56/v57 property shape: postSync belongs to the enclosing generation.
// Do not invent a completion flag when the persisted timestamps do not agree.
export function compileCompletedSync(raw, {version, sourceTreeSha256}) {
  assert.equal(version, 57, 'post-activation source must be verified v57');
  assert.match(sourceTreeSha256, /^[a-f0-9]{64}$/);
  assert.equal(raw.status, 'succeeded');
  assert.ok(Number.isSafeInteger(raw.syncGeneration) && raw.syncGeneration > 0);
  assert.equal(new Date(raw.lastSyncStarted).toISOString(), raw.lastSyncStarted);
  assert.equal(new Date(raw.lastSyncCompleted).toISOString(), raw.lastSyncCompleted);
  assert.ok(Date.parse(raw.lastSyncCompleted) >= Date.parse(raw.lastSyncStarted));
  assert.equal(raw.postSync?.checkedAt, raw.lastSyncCompleted, 'completed post-sync revision missing');
  for (const key of ['issueCount', 'driftCount', 'pendingCount', 'immediateCount']) {
    assert.ok(Number.isSafeInteger(raw.postSync[key]) && raw.postSync[key] >= 0);
  }
  assert.equal(typeof raw.postSync.overflow, 'boolean');
  return {version, sourceTreeSha256, generation: raw.syncGeneration, status: raw.status,
    startedAt: raw.lastSyncStarted, completedAt: raw.lastSyncCompleted,
    postSync: {completed: true, generation: raw.syncGeneration, checkedAt: raw.postSync.checkedAt,
      issues: raw.postSync.issueCount, drift: raw.postSync.driftCount,
      pending: raw.postSync.pendingCount, immediate: raw.postSync.immediateCount,
      overflow: raw.postSync.overflow}};
}

// Compile raw, private owner-reader receipts. No network or production writes.
// The collector supplies all Calendar pages (including deleted events), actual
// bundle reports/plans and independently checked financial/durable evidence.
export function compileCalendarAcceptance({capture, safetyReport, identities, businessRevision, observedAt}) {
  assert.equal(capture.productionMutations, 0);
  assert.equal(capture.baselineWrites.length, 0, 'baseline has an unreviewed write set');
  assert.deepEqual(capture.candidateWrites, capture.v56WideWrites, 'v56 wide equivalence differs');
  assert.equal(capture.after.issueCount, 0);
  assert.equal(capture.financial.issues.length, 0);
  assert.equal(capture.financial.numeric.length, 0);
  assert.equal(capture.financial.businessFindings.length, 0);
  assert.deepEqual(Object.keys(safetyReport).sort(), [...SAFETY_TYPES].sort());
  assert.match(businessRevision, /^[a-f0-9]{64}$/);
  assert.ok(capture.requests.some(q => q.updatedMin), 'incremental evidence missing');
  assert.ok(capture.requests.some(q => q.timeMin), 'wide evidence missing');
  // The collector must prove pagination completion; a page count alone is insufficient.
  assert.equal(capture.paginationComplete, true);
  assert.equal(capture.showDeleted, true);
  const times = [capture.checkedAt, capture.sheetCheckedAt, observedAt.source,
    observedAt.safety, observedAt.cursor].map(value => {
      assert.equal(typeof value, 'string', 'every evidence source needs a timestamp');
      assert.equal(new Date(value).toISOString(), value); return Date.parse(value);
    });
  assert.ok(Math.max(...times) - Math.min(...times) <= 300_000, 'mixed-age evidence; recollect');
  const capturedAt = new Date(Math.min(...times)).toISOString();
  const raw = capture.before.issues;
  assert.deepEqual(Object.keys(raw).sort(), [...ISSUE_TYPES].sort());
  const identity = eventId => fingerprint({calendarId: capture.calendarId, eventId});
  const normalize = report => Object.fromEntries(ISSUE_TYPES.map(type => [type,
    report[type].map(issue => ({identitySha256: identity(issue.eventId || fingerprint(issue)),
      semanticSha256: fingerprint({issue, event: capture.events.find(e => e.id === issue.eventId) || null})}))]));
  const report = normalize(raw);
  assert.equal(capture.before.issueCount, Object.values(raw).reduce((n, items) => n + items.length, 0));
  const incremental = capture.requests.find(q => q.updatedMin).updatedMin;
  const horizonProof = raw.calendarTrainingMissingQueue.map(issue => {
    const event = capture.events.find(e => e.id === issue.eventId);
    assert.ok(event && event.status !== 'cancelled');
    return {identitySha256: identity(issue.eventId), updatedAt: new Date(event.updated).toISOString(),
      incrementalUpdatedMin: new Date(incremental).toISOString(),
      eventStart: new Date(issue.start).toISOString(), horizonStart: capture.window.start,
      horizonEnd: capture.window.end,
      queueMatches: capture.queue.filter(x => x.values[3] === issue.eventId).length,
      journalMatches: capture.journal.filter(x => x.values[13] === issue.eventId).length};
  });
  const rowWrite = write => {
    const old = capture.queue.find(row => row.row === write.row);
    return {row: write.row, before: old ? Array.from({length: 17}, (_, i) => old.values[i] ?? '') : null,
      after: write.values,
      issueIdentitySha256: old ? null : identity(write.values[3])};
  };
  const evidence = {capturedAt,
    expiresAt: new Date(Date.parse(capturedAt) + 300_000).toISOString(),
    ...identities, baselineGeneration: capture.baselineGeneration,
    revision: fingerprint({businessRevision, scan: capture.scan, generation: capture.baselineGeneration,
      events: [...capture.events].sort((a, b) => a.id.localeCompare(b.id))}),
    report, safety: safetyReport, writeSet: capture.candidateWrites.map(rowWrite),
    v56WideWriteSet: capture.v56WideWrites.map(rowWrite), horizonProof,
    projectedReport: normalize(capture.after.issues)};
  return {evidence, package: createAcceptancePackage(evidence)};
}
