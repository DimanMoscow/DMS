import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

const handlers = ['sendTelegramMorningDigest', 'sendTelegramDailyQueue', 'syncCalendarToQueue',
  'runDmsWatchdog', 'createDmsAutomaticBackup'];
for (const handler of handlers) {
  test(`${handler} records maintenance failure without permitting business writes`, () => {
    let locks = 0;
    const f = loadBundle('stabilization', {
      LockService: {getScriptLock: () => ({tryLock: () => {locks++; return true;}, releaseLock: () => {locks--;}})},
    }, {releaseReady: false});
    f.properties.set('DMS_SCHEDULED_AUTOMATION_MANIFEST_V1', JSON.stringify({
      version: 1, ownerKey: f.context.getDmsScheduledAutomationOwnerKey_(),
      triggers: [{id: 'fixture-trigger', handler}],
    }));
    assert.throws(() => f.context[handler]({triggerUid: 'fixture-trigger'}), /maintenance/);
    const record = JSON.parse(f.properties.get('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1'))[handler];
    assert.equal(record.lastErrorClass, 'release_maintenance');
    assert.ok(record.lastStartedAt && record.lastCompletedAt);
    assert.equal(record.lastSuccessAt, undefined);
    assert.equal(f.writes.length, 0);
    assert.equal(locks, 0);
    assert.throws(() => f.context.getDmsMutationLock_().tryLock(1), /maintenance/);
  });
}

test('morning success stays current all evening and becomes stale after the next missed window', () => {
  const c = loadBundle('stabilization').context;
  const spec = {hour: 8, cadence: 'daily', every: 1};
  const manifest = {installedAt: '2026-09-01T00:00:00Z'};
  const record = {lastSuccessAt: '2026-09-10T05:11:00Z'};
  for (const time of ['2026-09-10T05:12:00Z', '2026-09-10T15:00:00Z', '2026-09-10T20:59:00Z']) {
    assert.equal(c.getDmsDailyScheduledState_(spec, record, manifest, new Date(time)).state, 'last_run_succeeded');
  }
  assert.equal(c.getDmsDailyScheduledState_(spec, record, manifest, new Date('2026-09-11T04:59:00Z')).state, 'not_due_yet');
  assert.equal(c.getDmsDailyScheduledState_(spec, record, manifest, new Date('2026-09-11T05:30:00Z')).state, 'within_expected_window');
  assert.equal(c.getDmsDailyScheduledState_(spec, record, manifest, new Date('2026-09-11T15:00:00Z')).state, 'stale');
});

test('a killed hourly execution cannot stay within the expected window forever', () => {
  const c = loadBundle('stabilization').context;
  const result = c.getDmsHourlyScheduledState_({every:1,maxAgeMinutes:105},
    {outcome:'started',lastStartedAt:'2026-09-10T05:00:00Z'},
    {installedAt:'2026-09-09T00:00:00Z'},new Date('2026-09-10T12:00:00Z'));
  assert.equal(result.state, 'stale');
});
