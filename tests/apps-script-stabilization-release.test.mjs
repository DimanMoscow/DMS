import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {runtimeSourceHashes} from '../apps-script/scripts/runtime-source-hashes.mjs';
import {
  resolveStabilizationVersion,
  verifyStabilizationReleaseInventory,
} from '../apps-script/scripts/release-stabilization.mjs';

test('stabilization HEAD rejects the old v54 readiness marker', () => {
  const f = loadBundle('stabilization', {}, {releaseReady: false});
  f.properties.set('DMS_P1_RELEASE_READY', 'v54');
  assert.throws(() => f.context.assertDmsP1ReleaseReady_(), /maintenance/);
  f.properties.set('DMS_P1_RELEASE_READY', 'system-stabilization-2026-09');
  assert.doesNotThrow(() => f.context.assertDmsP1ReleaseReady_());
});

test('stabilization runtime identity fingerprints its exact candidate modules', () => {
  const f = loadBundle('stabilization');
  const identity = JSON.parse(JSON.stringify(f.context.getDmsRuntimeIdentity_()));
  const hashes = runtimeSourceHashes('apps-script/candidates/stabilization');
  assert.equal(identity.release, 'system-stabilization');
  for (const [key, value] of Object.entries(hashes)) assert.equal(identity[key], value);
});

test('stabilization drain converts only the active v54 marker to a closed state', () => {
  const f = loadBundle('stabilization', {}, {releaseReady: false});
  f.properties.set('DMS_P1_RELEASE_READY', 'v54');
  f.context.startDmsP1ExecutionDrain();
  assert.equal(f.properties.has('DMS_P1_RELEASE_READY'), false);
  assert.match(f.properties.get('DMS_P1_DRAIN_STARTED_AT'), /^\d{4}-\d{2}-\d{2}T/);

  const unexpected = loadBundle('stabilization', {}, {releaseReady: false});
  unexpected.properties.set('DMS_P1_RELEASE_READY', 'v53');
  assert.throws(() => unexpected.context.startDmsP1ExecutionDrain(), /Unexpected/);
});

test('stabilization activation writes only the new readiness marker after its gates', () => {
  const f = loadBundle('stabilization', {}, {releaseReady: false});
  f.properties.set('DMS_P1_DRAIN_STARTED_AT', '2020-01-01T00:00:00Z');
  f.context.getTelegramOperationLedger_ = () => ({});
  f.context.getDmsFinancialHealth_ = () => ({ok: true});
  f.context.getDmsScheduledAutomationHealth_ = () => ({
    configOk: true, settingsOk: true, freshnessOk: true,
  });
  f.context.inspectDmsP1ReleaseState = () => ({legacyStates: {malformed: 0}});
  f.context.activateDmsP1Release();
  assert.equal(f.properties.get('DMS_P1_RELEASE_READY'), 'system-stabilization-2026-09');
});

test('release accepts the version number returned by Google without assuming v55', async () => {
  const materialized = new Map([['appsscript.json', '{}\n'], ['Код.gs', 'function x() {}\n']]);
  const reads = [];
  const assigned = await resolveStabilizationVersion({
    versions: [{versionNumber: 54}], materialized,
    createVersion: async () => ({versionNumber: 57}),
    readVersion: async number => {reads.push(number); return materialized;},
  });
  assert.equal(assigned, 57);
  assert.deepEqual(reads, [57]);
});

test('release resumes only from the latest exact candidate snapshot', async () => {
  const materialized = new Map([['appsscript.json', '{}\n']]);
  let created = false;
  const existing = await resolveStabilizationVersion({
    versions: [{versionNumber: 54}, {versionNumber: 58}], materialized,
    createVersion: async () => {created = true; return {versionNumber: 59};},
    readVersion: async number => number === 58 ? materialized : new Map(),
  });
  assert.equal(existing, 58);
  assert.equal(created, false);
  await assert.rejects(() => resolveStabilizationVersion({
    versions: [{versionNumber: 54}, {versionNumber: 59}], materialized,
    createVersion: async () => ({versionNumber: 60}),
    readVersion: async () => new Map([['appsscript.json', '{"other":true}\n']]),
  }), /unrelated source/);
});

test('release inventory requires a fresh, drained, owner-bound paused state', () => {
  const now = Date.now();
  const handlers = ['backup', 'morning', 'evening', 'calendar', 'watchdog'].map(handler => ({
    handler, configOk: true, state: 'last_run_succeeded',
  }));
  const inventory = {
    checkedAt: new Date(now - 1000).toISOString(), originalDocumentContext: true,
    mutationReady: false, scriptLockAvailable: true, documentLockAvailable: true,
    scheduledAutomation: {configOk: true, settingsOk: true, ownerVerified: true, handlers},
    legacyStates: {malformed: 0}, drainStartedAt: new Date(now - 421000).toISOString(),
  };
  assert.equal(verifyStabilizationReleaseInventory(inventory, {now}), true);
  assert.throws(() => verifyStabilizationReleaseInventory({...inventory, mutationReady: true}, {now}),
    /paused/);
  assert.throws(() => verifyStabilizationReleaseInventory({...inventory,
    drainStartedAt: new Date(now - 419999).toISOString()}, {now}), /incomplete/);
});
