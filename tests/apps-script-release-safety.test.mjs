import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';
import {runtimeSourceHashes, P1_RUNTIME_MODULES} from '../apps-script/scripts/runtime-source-hashes.mjs';
import {matchesAppsScriptRuntime, EXPECTED_APPS_SCRIPT_RUNTIME, CANDIDATE_APPS_SCRIPT_RUNTIME}
  from '../lib/apps-script-runtime-identity.ts';
import {verifyP1Inventory} from '../apps-script/scripts/release-v51.mjs';

test('v51 fresh HEAD denies entry points and domain writes without deployment activation', () => {
  const f = loadBundle('v51', {}, {releaseReady: false});
  for (const run of [() => f.context.getDmsMutationLock_().tryLock(0),
    () => f.context.onEdit({value: 'TRUE'}), () => f.context.setupDmsFitness(),
    () => f.context.syncCalendarToQueue(), () => f.context.runDmsWatchdog(),
    () => f.context.sendTelegramDailyQueue(), () => f.context.sendTelegramMorningDigest()]) {
    assert.throws(run, /release maintenance/);
  }
  f.context.doPost({postData: {contents: JSON.stringify({message: {text: '/today'}})}});
  assert.equal(f.writes.length, 0);
  assert.equal(JSON.parse(f.context.doGet({parameter: {dms_runtime_identity: '1'}}).text).ok, true);
});

test('v51 identity fingerprints all five safety modules and rejects missing handlers', () => {
  const f = loadBundle(); const identity = JSON.parse(JSON.stringify(f.context.getDmsRuntimeIdentity_()));
  assert.equal(P1_RUNTIME_MODULES.length, 5);
  const hashes = runtimeSourceHashes('apps-script/candidates/v51');
  for (const [key, hash] of Object.entries(hashes)) assert.equal(identity[key], hash);
  assert.equal(matchesAppsScriptRuntime(identity), true);
  for (const name of ['processTelegramSecureCallback_', 'getDmsMutationLock_',
    'assertDmsP1ReleaseReady_', 'getDmsFinancialHealth_', 'sealDmsDomainUndo_']) {
    const original = f.context[name]; f.context[name] = undefined;
    assert.equal(matchesAppsScriptRuntime(f.context.getDmsRuntimeIdentity_()), false);
    f.context[name] = original;
  }
});

test('transition verifier accepts exact v50/v51 only, never mixed fingerprints', () => {
  const markers = {ok: true, clientPortalHandlerLoaded: true, telegramConfirmationsHandlerLoaded: true};
  for (const expected of [EXPECTED_APPS_SCRIPT_RUNTIME, CANDIDATE_APPS_SCRIPT_RUNTIME]) {
    assert.equal(matchesAppsScriptRuntime({...expected, ...markers}), true);
    assert.equal(matchesAppsScriptRuntime({...expected, ...markers, routerSha256: '0'.repeat(64)}), false);
  }
  assert.equal(matchesAppsScriptRuntime({...EXPECTED_APPS_SCRIPT_RUNTIME, ...markers,
    clientPortalSha256: CANDIDATE_APPS_SCRIPT_RUNTIME.clientPortalSha256}), false);
});

test('legacy inventory classifies expired/malformed states without any persistent write', () => {
  const book = memoryWorkbook({'Журнал операций Telegram': [['headers'], ['', '', '', '', 'pending']]});
  const f = loadBundle('v51', {SpreadsheetApp: book.service,
    LockService: {getScriptLock: () => ({}), getDocumentLock: () => ({})}}, {releaseReady: false});
  const id = 'a'.repeat(16);
  f.properties.set('DMS_TG_CF_' + id, JSON.stringify({id, operationId: 'test', status: 'pending', expiresAt: '2020-01-01T00:00:00Z'}));
  f.properties.set('DMS_TG_CF_' + 'b'.repeat(16), 'broken');
  const before = [...f.properties]; let writes = 0; book.hooks.before = () => {writes++;};
  const result = f.context.inspectDmsP1ReleaseState();
  assert.equal(result.legacyStates.expired, 1); assert.equal(result.legacyStates.malformed, 1);
  assert.equal(result.ledgerEvents.pending, 1); assert.equal(result.mutationReady, false);
  assert.equal(writes, 0); assert.deepEqual([...f.properties], before);
  assert.ok(!JSON.stringify(result).includes(id));
});

test('activation refuses missing drain and incomplete schema without enabling writes', () => {
  let released = 0;
  const f = loadBundle('v51', {LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock: () => released++})}}, {releaseReady: false});
  assert.throws(() => f.context.activateDmsP1Release(), /not drained/);
  f.context.startDmsP1ExecutionDrain();
  assert.throws(() => f.context.activateDmsP1Release(), /not drained/);
  f.properties.set('DMS_P1_DRAIN_STARTED_AT', '2020-01-01T00:00:00Z');
  // Deliberately no ledger schema in the real service fixture: fail before activation.
  assert.throws(() => f.context.activateDmsP1Release());
  assert.equal(f.properties.get('DMS_P1_RELEASE_READY'), undefined);
  assert.equal(released, 3);
});

test('release runner requires fresh original-context evidence and completed drain', () => {
  const now = Date.now();
  const good = {originalDocumentContext: true, mutationReady: false,
    scriptLockAvailable: true, documentLockAvailable: true, usage: {document: {available: true}},
    legacyStates: {pending: 2, consumed: 1, expired: 0, revoked: 0, unknown: 1, malformed: 0},
    checkedAt: new Date(now).toISOString(), drainStartedAt: new Date(now - 420000).toISOString()};
  assert.equal(verifyP1Inventory(good, {now, requireDrained: true}), true);
  for (const changed of [{mutationReady: true}, {originalDocumentContext: false},
    {documentLockAvailable: false}, {checkedAt: new Date(now - 600001).toISOString()},
    {drainStartedAt: new Date(now - 419999).toISOString()},
    {legacyStates: {...good.legacyStates, malformed: 1}}]) {
    assert.throws(() => verifyP1Inventory({...good, ...changed}, {now, requireDrained: true}));
  }
});
