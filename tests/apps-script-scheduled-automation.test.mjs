import assert from 'node:assert/strict';
import test from 'node:test';

import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {runtimeSourceHashes} from '../apps-script/scripts/runtime-source-hashes.mjs';
import {verifyScheduledReleaseInventory} from '../apps-script/scripts/release-v52.mjs';

const HANDLERS = [
  'createDmsAutomaticBackup',
  'sendTelegramMorningDigest',
  'sendTelegramDailyQueue',
  'syncCalendarToQueue',
  'runDmsWatchdog',
];

function clockTrigger(handler, id, schedule = {}) {
  return {
    handler,
    id,
    schedule,
    getHandlerFunction: () => handler,
    getEventType: () => 'CLOCK',
    getTriggerSource: () => 'CLOCK',
    getUniqueId: () => id,
  };
}

function scriptAppFixture(initial = [], {failHandler = ''} = {}) {
  const triggers = [...initial];
  let nextId = 1;
  return {
    EventType: {CLOCK: 'CLOCK'},
    TriggerSource: {CLOCK: 'CLOCK'},
    getProjectTriggers: () => [...triggers],
    deleteTrigger: trigger => {
      const index = triggers.indexOf(trigger);
      if (index !== -1) triggers.splice(index, 1);
    },
    newTrigger: handler => {
      const schedule = {};
      const builder = {
        timeBased() { schedule.source = 'CLOCK'; return this; },
        atHour(hour) { schedule.hour = hour; return this; },
        everyDays(every) { schedule.cadence = 'daily'; schedule.every = every; return this; },
        everyHours(every) { schedule.cadence = 'hourly'; schedule.every = every; return this; },
        inTimezone(timeZone) { schedule.timeZone = timeZone; return this; },
        create() {
          if (handler === failHandler) throw new Error('fixture create failed');
          const trigger = clockTrigger(handler, 'new-' + nextId++, {...schedule});
          triggers.push(trigger);
          return trigger;
        },
      };
      return builder;
    },
    _triggers: triggers,
  };
}

function configuredFixture() {
  const old = HANDLERS.map((handler, index) => clockTrigger(handler, 'old-' + index));
  const ScriptApp = scriptAppFixture(old);
  const f = loadBundle('v52', {ScriptApp}, {releaseReady: false});
  f.properties.set('DMS_TG_FINAL_SETTINGS',
    JSON.stringify({morning: true, evening: true, lowBalance: true, debt: true}));
  return {f, ScriptApp};
}

test('v52 public runtime identity fingerprints the scheduled-health source', () => {
  const f = loadBundle('v52');
  const identity = JSON.parse(JSON.stringify(f.context.getDmsRuntimeIdentity_()));
  assert.equal(identity.release, 'p1-scheduled-automation-health');
  assert.deepEqual({
    routerSha256: identity.routerSha256,
    clientPortalSha256: identity.clientPortalSha256,
    telegramConfirmationsSha256: identity.telegramConfirmationsSha256,
  }, runtimeSourceHashes('apps-script/candidates/v52'));
});

test('v52 installs one owner-bound managed clock trigger for every expected handler', () => {
  const {f, ScriptApp} = configuredFixture();
  const installed = f.context.installDmsScheduledAutomation();
  assert.equal(installed.configured, true);
  assert.equal(installed.ownerVerified, true);
  assert.equal(installed.freshnessPending, true);
  assert.deepEqual(ScriptApp._triggers.map(trigger => trigger.handler), HANDLERS);

  const schedules = Object.fromEntries(
    ScriptApp._triggers.map(trigger => [trigger.handler, trigger.schedule]),
  );
  assert.deepEqual(schedules.createDmsAutomaticBackup,
    {source: 'CLOCK', hour: 3, cadence: 'daily', every: 1, timeZone: 'Europe/Moscow'});
  assert.deepEqual(schedules.sendTelegramMorningDigest,
    {source: 'CLOCK', hour: 8, cadence: 'daily', every: 1, timeZone: 'Europe/Moscow'});
  assert.deepEqual(schedules.sendTelegramDailyQueue,
    {source: 'CLOCK', hour: 22, cadence: 'daily', every: 1, timeZone: 'Europe/Moscow'});
  assert.deepEqual(schedules.syncCalendarToQueue,
    {source: 'CLOCK', cadence: 'hourly', every: 1});
  assert.deepEqual(schedules.runDmsWatchdog,
    {source: 'CLOCK', cadence: 'hourly', every: 2});

  const beforeSuccess = f.context.getDmsScheduledAutomationHealth_({
    requireFreshness: true,
    now: new Date(),
  });
  assert.equal(beforeSuccess.configOk, true);
  assert.equal(beforeSuccess.settingsOk, true);
  assert.equal(beforeSuccess.freshnessOk, false);
  assert.equal(beforeSuccess.ok, false);
  assert.equal(JSON.stringify(beforeSuccess).includes('new-'), false);

  f.properties.set('DMS_P1_RELEASE_READY', 'v52');
  for (const trigger of ScriptApp._triggers) {
    f.context.recordDmsScheduledAutomationSuccess_(
      trigger.handler,
      {triggerUid: trigger.id},
      trigger.handler === 'runDmsWatchdog' ? 'healthy' : 'completed',
    );
  }
  const afterSuccess = f.context.getDmsScheduledAutomationHealth_({
    requireFreshness: true,
    now: new Date(),
  });
  assert.equal(afterSuccess.configOk, true);
  assert.equal(afterSuccess.settingsOk, true);
  assert.equal(afterSuccess.freshnessOk, true);
  assert.equal(afterSuccess.ok, true);
});

test('v52 health gate fails closed for duplicate, stale, disabled or unbound triggers', () => {
  const {f, ScriptApp} = configuredFixture();
  f.context.installDmsScheduledAutomation();
  const triggers = ScriptApp._triggers;
  f.properties.set('DMS_P1_RELEASE_READY', 'v52');
  for (const trigger of triggers) {
    f.context.recordDmsScheduledAutomationSuccess_(
      trigger.handler,
      {triggerUid: trigger.id},
      trigger.handler === 'runDmsWatchdog' ? 'healthy' : 'completed',
    );
  }

  ScriptApp._triggers.push(clockTrigger('syncCalendarToQueue', 'duplicate'));
  assert.equal(f.context.getDmsScheduledAutomationHealth_({now: new Date()}).configOk, false);
  ScriptApp._triggers.pop();

  f.properties.set('DMS_TG_FINAL_SETTINGS',
    JSON.stringify({morning: false, evening: true, lowBalance: true, debt: true}));
  assert.equal(f.context.getDmsScheduledAutomationHealth_({now: new Date()}).settingsOk, false);
  f.properties.set('DMS_TG_FINAL_SETTINGS',
    JSON.stringify({morning: true, evening: true, lowBalance: true, debt: true}));

  const records = JSON.parse(f.properties.get('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1'));
  records.syncCalendarToQueue.lastSuccessAt = '2020-01-01T00:00:00.000Z';
  f.properties.set('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1', JSON.stringify(records));
  assert.equal(f.context.getDmsScheduledAutomationHealth_({now: new Date()}).freshnessOk, false);

  assert.throws(
    () => f.context.assertDmsScheduledInvocation_(
      'sendTelegramMorningDigest',
      {triggerUid: 'unmanaged-trigger'},
    ),
    /identity mismatch/,
  );
});

test('v52 trigger replacement preserves the previous set when creation fails', () => {
  const old = HANDLERS.map((handler, index) => clockTrigger(handler, 'old-' + index));
  const ScriptApp = scriptAppFixture(old, {failHandler: 'sendTelegramDailyQueue'});
  const f = loadBundle('v52', {ScriptApp}, {releaseReady: false});
  f.properties.set('DMS_TG_FINAL_SETTINGS',
    JSON.stringify({morning: true, evening: true, lowBalance: true, debt: true}));
  assert.throws(() => f.context.installDmsScheduledAutomation(), /fixture create failed/);
  assert.deepEqual(ScriptApp._triggers.map(trigger => trigger.id), old.map(trigger => trigger.id));
  assert.equal(f.properties.has('DMS_SCHEDULED_AUTOMATION_MANIFEST_V1'), false);
});

test('v52 does not count manual calls as scheduled successes and keeps paused entry points write-free', () => {
  const {f} = configuredFixture();
  f.context.installDmsScheduledAutomation();
  f.context.recordDmsScheduledAutomationSuccess_(
    'sendTelegramMorningDigest',
    null,
    'completed',
  );
  assert.equal(f.properties.has('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1'), false);

  f.properties.delete('DMS_P1_RELEASE_READY');
  assert.throws(() => f.context.sendTelegramMorningDigest({triggerUid: 'anything'}),
    /release maintenance/);
  assert.equal(f.writes.length, 0);
});

test('v52 release runner requires a fresh paused inventory with drained executions and trigger config', () => {
  const now = Date.now();
  const good = {
    checkedAt: new Date(now - 1000).toISOString(),
    originalDocumentContext: true,
    mutationReady: false,
    scriptLockAvailable: true,
    documentLockAvailable: true,
    scheduledAutomation: {configOk: true, settingsOk: true, freshnessOk: false},
    legacyStates: {malformed: 0},
    drainStartedAt: new Date(now - 421000).toISOString(),
  };
  assert.equal(verifyScheduledReleaseInventory(good, {now}), true);
  for (const change of [
    {mutationReady: true},
    {scheduledAutomation: {...good.scheduledAutomation, configOk: false}},
    {scheduledAutomation: {...good.scheduledAutomation, settingsOk: false}},
    {drainStartedAt: new Date(now - 419000).toISOString()},
    {checkedAt: new Date(now - 601000).toISOString()},
  ]) {
    assert.throws(() => verifyScheduledReleaseInventory({...good, ...change}, {now}));
  }
});
