import test from 'node:test';
import assert from 'node:assert/strict';
import {ISSUE_TYPES, SAFETY_TYPES, fingerprint, createAcceptancePackage,
  openActivation, evaluateActivation} from '../apps-script/scripts/release-reconciliation.mjs';
import {compileCalendarAcceptance, compileCompletedSync, compileSyncObservation} from '../apps-script/scripts/calendar-acceptance-evidence.mjs';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

const at = '2026-09-14T09:30:00.000Z';
const later = '2026-09-14T09:40:00.000Z';
const hash = x => fingerprint(x);
const empty = types => Object.fromEntries(types.map(x => [x, []]));
function fixture() {
  const report = empty(ISSUE_TYPES);
  report.calendarTrainingMissingQueue = [1, 2, 3].map(x => ({identitySha256: hash(x), semanticSha256: hash([x])}));
  const writeSet = report.calendarTrainingMissingQueue.map((issue, index) => {
    const after = Array(17).fill(''); after[0] = 'Q-' + index; after[13] = 'Ожидает';
    return {row: 20 + index, before: null, after, issueIdentitySha256: issue.identitySha256};
  });
  const evidence = {capturedAt: at, expiresAt: '2026-09-14T09:35:00.000Z',
    releaseCommitSha: 'a'.repeat(40), candidateTreeSha256: hash('candidate'),
    baselineTreeSha256: hash('baseline'), numberedSourceSha256: hash('candidate'),
    baselineGeneration: 112, revision: hash('revision'), report, safety: empty(SAFETY_TYPES),
    writeSet, v56WideWriteSet: structuredClone(writeSet), projectedReport: empty(ISSUE_TYPES),
    horizonProof: report.calendarTrainingMissingQueue.map(issue => ({identitySha256: issue.identitySha256,
      updatedAt: '2026-09-10T00:00:00.000Z', incrementalUpdatedMin: '2026-09-13T09:21:00.000Z',
      eventStart: '2026-09-15T04:00:00.000Z', horizonStart: at,
      horizonEnd: '2026-09-15T09:30:00.000Z', queueMatches: 0, journalMatches: 0}))};
  const approved = createAcceptancePackage(evidence);
  const state = openActivation(approved, approved.fingerprint, at);
  const observation = {...evidence, checkedAt: later, generation: 112, sync: null,
    writeSetFingerprint: approved.writeSetFingerprint};
  const evaluate = (o = observation, s = state, a = approved, pin = approved.fingerprint) =>
    evaluateActivation(a, pin, s, o, o.checkedAt);
  return {evidence, approved, state, observation, evaluate};
}
test('exact known three are provisional, including after the mandatory drain', () => {
  assert.equal(fixture().evaluate().verdict, 'PROVISIONAL_PASS');
});
test('same three plus a new issue fail', () => {
  const f = fixture(); f.observation.report.calendarTrainingMissingQueue.push({identitySha256: hash(4), semanticSha256: hash([4])});
  assert.equal(f.evaluate().ok, false);
});
test('three of another type fail', () => {
  const f = fixture(); f.observation.report.pendingMissingCalendar = f.observation.report.calendarTrainingMissingQueue;
  f.observation.report.calendarTrainingMissingQueue = []; assert.equal(f.evaluate().ok, false);
});
test('changed identity, semantic fingerprint, revision, write set or approval each fail', () => {
  for (const mutate of [
    f => { f.observation.report.calendarTrainingMissingQueue[0].identitySha256 = hash('different'); },
    f => { f.observation.report.calendarTrainingMissingQueue[0].semanticSha256 = hash('different'); },
    f => { f.observation.revision = hash('different'); },
    f => { f.observation.writeSetFingerprint = hash('different'); },
    f => { f.approved.revision = hash('different'); },
  ]) { const f = fixture(); mutate(f); assert.equal(f.evaluate().ok, false); }
});
function successful(f) {
  f.observation.generation = 113; f.observation.report = empty(ISSUE_TYPES);
  f.observation.sync = {version: 57, status: 'succeeded', generation: 113,
    sourceTreeSha256: f.approved.candidateTreeSha256, startedAt: at,
    completedAt: '2026-09-14T09:39:00.000Z', postSync: {completed: true, generation: 113,
      checkedAt: later, issues: 0, drift: 0, pending: 0, immediate: 0, overflow: false}};
}
test('completed v57 sync requires zero and consumes the exception', () => {
  const f = fixture(); successful(f); const result = f.evaluate();
  assert.equal(result.verdict, 'POST_SYNC_PASS'); assert.equal(result.state.phase, 'post');
  f.observation.report.calendarTrainingMissingQueue = f.evidence.report.calendarTrainingMissingQueue.slice(0, 1);
  assert.equal(f.evaluate(f.observation, result.state).ok, false);
});
test('even a failed/partial candidate generation consumes the exception; no rewind', () => {
  const f = fixture(); f.observation.generation = 113;
  const result = f.evaluate(); assert.equal(result.ok, false); assert.equal(result.state.phase, 'post');
  f.observation.generation = 112; assert.equal(f.evaluate(f.observation, result.state).ok, false);
});

test('actual native start/failure retains generation and permanently consumes provisional admission', () => {
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [later])); } static now() { return Date.parse(later); } }
  const f = fixture(); const bundle = loadBundle('v57', {Date: FixedDate});
  bundle.properties.set('DMS_CALENDAR_SYNC_GENERATION_V1', JSON.stringify({version: 1,
    syncGeneration: 112, driftKeys: [], status: 'succeeded', lastSyncStarted: at, lastSyncCompleted: at}));
  const native = bundle.context.beginDmsCalendarSyncGeneration_();
  assert.equal(native.syncGeneration, 112);
  for (const failed of [false, true]) {
    if (failed) bundle.context.failDmsCalendarSyncGeneration_(native);
    f.observation.checkedAt = later;
    f.observation.sync = compileSyncObservation(native, {version: 57,
      sourceTreeSha256: f.approved.candidateTreeSha256});
    const result = f.evaluate();
    assert.equal(result.ok, false); assert.equal(result.state.phase, 'post');
    f.observation.sync = null;
    assert.equal(f.evaluate(f.observation, result.state).ok, false);
  }
});
test('raw zero without completed matching post-sync evidence fails', () => {
  for (const mutate of [
    f => { f.observation.sync = null; },
    f => { f.observation.sync.postSync.completed = false; },
    f => { f.observation.sync.postSync.generation = 112; },
    f => { f.observation.sync.postSync.issues = 1; },
    f => { f.observation.sync.postSync.overflow = true; },
    f => { f.observation.sync.version = 56; },
    f => { f.observation.sync.status = 'failed'; },
  ]) { const f = fixture(); successful(f); mutate(f); assert.equal(f.evaluate().ok, false); }
});
test('every financial/link/duplicate/operational safety issue always fails both phases', () => {
  for (const key of SAFETY_TYPES) for (const post of [false, true]) {
    const f = fixture(); if (post) successful(f); f.observation.safety[key] = [{id: 'fixture'}];
    assert.equal(f.evaluate().ok, false, key);
  }
  for (const type of ISSUE_TYPES.filter(x => x !== 'calendarTrainingMissingQueue')) {
    const f = fixture(); f.evidence.report[type] = [{identitySha256: hash(type), semanticSha256: hash(type)}];
    assert.throws(() => createAcceptancePackage(f.evidence), /never exempt/);
  }
});
test('fresh admission, bounded activation, fresh observation and exact release binding', () => {
  const f = fixture(); assert.throws(() => openActivation(f.approved, f.approved.fingerprint, later), /stale/);
  assert.equal(evaluateActivation(f.approved, f.approved.fingerprint, f.state, f.observation,
    '2026-09-14T09:42:00.000Z').ok, false);
  f.observation.checkedAt = '2026-09-14T10:01:00.000Z'; assert.equal(f.evaluate().ok, false);
  const g = fixture(); g.observation.releaseCommitSha = 'b'.repeat(40); assert.equal(g.evaluate().ok, false);
});
test('approval requires exact 17-cell wide equivalence, pending only and omission proof', () => {
  for (const mutate of [
    f => { f.evidence.writeSet[0].after[13] = 'Обработана'; },
    f => { f.evidence.writeSet[0].after[14] = at; },
    f => { f.evidence.horizonProof[0].queueMatches = 1; },
    f => { f.evidence.horizonProof[0].updatedAt = later; },
    f => { f.evidence.projectedReport.calendarTrainingMissingQueue = f.evidence.report.calendarTrainingMissingQueue; },
    f => { f.evidence.safety.finance = 0; },
    f => { delete f.evidence.report.queueJournalMismatch; },
    f => { f.evidence.report.calendarTrainingMissingQueue = 3; },
  ]) { const f = fixture(); mutate(f); assert.throws(() => createAcceptancePackage(f.evidence)); }
});

test('fingerprints preserve dates and distinguish a changed Calendar revision', () => {
  assert.notEqual(fingerprint(new Date(at)), fingerprint(new Date(later)));
  assert.equal(fingerprint(new Date(at)), fingerprint(at));
});

test('native post-sync adapter requires matching persisted completion and preserves residual drift', () => {
  const source = {version: 57, sourceTreeSha256: hash('candidate')};
  const raw = {status: 'succeeded', syncGeneration: 113, lastSyncStarted: at, lastSyncCompleted: later,
    postSync: {checkedAt: later, issueCount: 1, driftCount: 1, pendingCount: 0, immediateCount: 0, overflow: false}};
  assert.equal(compileCompletedSync(raw, source).postSync.issues, 1);
  assert.throws(() => compileCompletedSync(raw, {...source, version: 56}));
  assert.throws(() => compileCompletedSync({...raw, postSync: null}, source));
  assert.throws(() => compileCompletedSync({...raw, postSync: {...raw.postSync, checkedAt: at}}, source));
});

test('raw receipt compiler derives identities and expiry; rejects incomplete or mixed-age captures', () => {
  const f = fixture();
  const issues = [1, 2, 3].map(i => ({eventId: 'fixture-event-' + i,
    revision: 'rev1', start: '2026-09-15T04:00:00.000Z', title: 'Fixture'}));
  const rawReport = empty(ISSUE_TYPES); rawReport.calendarTrainingMissingQueue = issues;
  const writes = f.evidence.writeSet.map((w, i) => {
    const values = [...w.after]; values[3] = issues[i].eventId;
    return {row: w.row, values, copyTemplate: true};
  });
  const capture = {productionMutations: 0, baselineWrites: [], candidateWrites: writes,
    v56WideWrites: structuredClone(writes), financial: {issues: [], numeric: [], businessFindings: []},
    before: {issueCount: 3, issues: rawReport}, after: {issueCount: 0, issues: empty(ISSUE_TYPES)},
    calendarId: 'fixture-calendar', checkedAt: at, sheetCheckedAt: at, scan: {revision: 'fixture'},
    requests: [{updatedMin: '2026-09-13T09:21:00.000Z'}, {timeMin: at}],
    paginationComplete: true, showDeleted: true, baselineGeneration: 112,
    queue: [], journal: [], window: {start: at, end: '2026-09-15T09:30:00.000Z'},
    events: issues.map(i => ({id: i.eventId, updated: '2026-09-10T00:00:00.000Z'}))};
  const envelope = {capture, safetyReport: empty(SAFETY_TYPES), businessRevision: hash('business'),
    observedAt: {source: at, safety: at, cursor: at}, identities: {
      releaseCommitSha: f.approved.releaseCommitSha, candidateTreeSha256: f.approved.candidateTreeSha256,
      baselineTreeSha256: f.approved.baselineTreeSha256, numberedSourceSha256: f.approved.numberedSourceSha256}};
  const compiled = compileCalendarAcceptance(envelope);
  assert.equal(compiled.package.issues.length, 3);
  assert.equal(compiled.package.expiresAt, '2026-09-14T09:35:00.000Z');
  envelope.capture.paginationComplete = false;
  assert.throws(() => compileCalendarAcceptance(envelope));
  envelope.capture.paginationComplete = true; envelope.observedAt.safety = '2026-09-14T09:20:00.000Z';
  assert.throws(() => compileCalendarAcceptance(envelope), /mixed-age/);
});
