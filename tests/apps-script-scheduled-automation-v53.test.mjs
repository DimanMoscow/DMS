import assert from 'node:assert/strict';
import test from 'node:test';

import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {runtimeSourceHashes} from '../apps-script/scripts/runtime-source-hashes.mjs';
import {verifyScheduledReleaseInventory} from '../apps-script/scripts/release-v53.mjs';

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

function scriptAppFixture(initial = []) {
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
      return {
        timeBased() { schedule.source = 'CLOCK'; return this; },
        atHour(hour) { schedule.hour = hour; return this; },
        everyDays(every) { schedule.cadence = 'daily'; schedule.every = every; return this; },
        everyHours(every) { schedule.cadence = 'hourly'; schedule.every = every; return this; },
        inTimezone(timeZone) { schedule.timeZone = timeZone; return this; },
        create() {
          const trigger = clockTrigger(handler, 'v53-' + nextId++, {...schedule});
          triggers.push(trigger);
          return trigger;
        },
      };
    },
    _triggers: triggers,
  };
}

function configuredV53(installedAt = '2026-09-08T17:52:00.000Z') {
  const previous = HANDLERS.map((handler, index) => clockTrigger(handler, 'old-' + index));
  const ScriptApp = scriptAppFixture(previous);
  const f = loadBundle('v53', {ScriptApp}, {releaseReady: false});
  f.properties.set('DMS_TG_FINAL_SETTINGS',
    JSON.stringify({morning: true, evening: true, lowBalance: true, debt: true}));
  f.context.installDmsScheduledAutomation();
  const manifest = JSON.parse(f.properties.get('DMS_SCHEDULED_AUTOMATION_MANIFEST_V1'));
  manifest.installedAt = installedAt;
  f.properties.set('DMS_SCHEDULED_AUTOMATION_MANIFEST_V1', JSON.stringify(manifest));
  return {f, ScriptApp, manifest};
}

function handler(report, name) {
  return report.handlers.find(item => item.handler === name);
}

function setExecutionRecord(f, manifest, name, values) {
  const records = JSON.parse(f.properties.get('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1') || '{}');
  const trigger = manifest.triggers.find(item => item.handler === name);
  records[name] = {triggerId: trigger.id, ...values};
  f.properties.set('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1', JSON.stringify(records));
}

test('v53 runtime identity fingerprints the stabilization candidate', () => {
  const f = loadBundle('v53');
  const identity = JSON.parse(JSON.stringify(f.context.getDmsRuntimeIdentity_()));
  assert.equal(identity.release, 'scheduled-automation-stabilization');
  assert.deepEqual({
    routerSha256: identity.routerSha256,
    clientPortalSha256: identity.clientPortalSha256,
    telegramConfirmationsSha256: identity.telegramConfirmationsSha256,
  }, runtimeSourceHashes('apps-script/candidates/v53'));
});

test('v53 does not mark the 08:00 morning job stale at 04:10 Moscow', () => {
  const {f} = configuredV53();
  const at0410 = new Date('2026-09-09T01:10:00.000Z');
  const report = f.context.getDmsScheduledAutomationHealth_({now: at0410});
  const morning = handler(report, 'sendTelegramMorningDigest');
  const backup = handler(report, 'createDmsAutomaticBackup');

  assert.equal(morning.state, 'not_due_yet');
  assert.deepEqual(JSON.parse(JSON.stringify(morning.expectedSchedule)), {
    handler: 'sendTelegramMorningDigest', cadence: 'daily', every: 1,
    timeZone: 'Europe/Moscow', hour: 8,
  });
  assert.equal(morning.fresh, true);
  assert.deepEqual(JSON.parse(JSON.stringify(morning.nextExpectedWindow)), {
    startAt: '2026-09-09T05:00:00.000Z',
    endAt: '2026-09-09T06:15:00.000Z',
  });
  assert.equal(backup.state, 'within_expected_window');
  assert.equal(backup.fresh, true);
});

test('v53 daily job becomes delayed after grace and stale only after the stale threshold', () => {
  const {f} = configuredV53();
  const delayed = handler(f.context.getDmsScheduledAutomationHealth_({
    now: new Date('2026-09-09T06:16:00.000Z'),
  }), 'sendTelegramMorningDigest');
  const stale = handler(f.context.getDmsScheduledAutomationHealth_({
    now: new Date('2026-09-09T12:16:00.000Z'),
  }), 'sendTelegramMorningDigest');

  assert.equal(delayed.state, 'delayed');
  assert.equal(delayed.fresh, false);
  assert.equal(stale.state, 'stale');
  assert.equal(stale.fresh, false);
});

test('v53 daily success makes the current window healthy with execution metadata', () => {
  const {f, manifest} = configuredV53();
  setExecutionRecord(f, manifest, 'sendTelegramMorningDigest', {
    lastStartedAt: '2026-09-09T05:33:00.000Z',
    lastSuccessAt: '2026-09-09T05:34:00.000Z',
    lastDurationMs: 60000,
    outcome: 'sent',
  });
  const morning = handler(f.context.getDmsScheduledAutomationHealth_({
    now: new Date('2026-09-09T07:00:00.000Z'),
  }), 'sendTelegramMorningDigest');

  assert.equal(morning.state, 'last_run_succeeded');
  assert.equal(morning.fresh, true);
  assert.equal(morning.lastStartedAt, '2026-09-09T05:33:00.000Z');
  assert.equal(morning.lastSuccessAt, '2026-09-09T05:34:00.000Z');
  assert.equal(morning.durationMs, 60000);
});

test('v53 records a redacted error class and exposes last_run_failed', () => {
  const {f, manifest} = configuredV53(new Date(Date.now() - 7200000).toISOString());
  f.properties.set('DMS_P1_RELEASE_READY', 'v53');
  const trigger = manifest.triggers.find(item => item.handler === 'syncCalendarToQueue');
  const event = {triggerUid: trigger.id};
  const execution = f.context.beginDmsScheduledAutomationExecution_(
    'syncCalendarToQueue', event);
  f.context.recordDmsScheduledAutomationFailure_(
    'syncCalendarToQueue', event,
    new Error('Authorization is required for a private client calendar'), execution);

  const record = JSON.parse(
    f.properties.get('DMS_SCHEDULED_AUTOMATION_SUCCESS_V1')).syncCalendarToQueue;
  const calendar = handler(f.context.getDmsScheduledAutomationHealth_({
    now: new Date(),
  }), 'syncCalendarToQueue');
  assert.equal(record.lastErrorClass, 'authorization');
  assert.match(record.lastStartedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(record.lastErrorAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof record.lastDurationMs, 'number');
  assert.equal(JSON.stringify(record).includes('private client'), false);
  assert.equal(calendar.state, 'last_run_failed');
  assert.equal(calendar.fresh, false);
});

test('v53 reports trigger missing separately from freshness', () => {
  const {f, ScriptApp} = configuredV53();
  const index = ScriptApp._triggers.findIndex(
    item => item.handler === 'sendTelegramDailyQueue');
  ScriptApp._triggers.splice(index, 1);
  const evening = handler(f.context.getDmsScheduledAutomationHealth_({
    now: new Date('2026-09-09T10:00:00.000Z'),
  }), 'sendTelegramDailyQueue');
  assert.equal(evening.state, 'trigger_missing');
  assert.equal(evening.configOk, false);
  assert.equal(evening.fresh, false);
});

test('v53 defers only the backup age warning while its execution window is open', () => {
  const {f} = configuredV53();
  const ageOnly = {ok: false, issues: ['Последняя копия старше 48 часов']};
  assert.equal(f.context.isDmsBackupAgeAwaitingExpectedWindow_(
    ageOnly, {state: 'not_due_yet'}), true);
  assert.equal(f.context.isDmsBackupAgeAwaitingExpectedWindow_(
    ageOnly, {state: 'within_expected_window'}), true);
  assert.equal(f.context.isDmsBackupAgeAwaitingExpectedWindow_(
    ageOnly, {state: 'delayed'}), false);
  assert.equal(f.context.isDmsBackupAgeAwaitingExpectedWindow_(
    {ok: false, issues: ['Нет данных листа']}, {state: 'within_expected_window'}), false);
});

test('v53 administrator health text is compact and contains no trigger identifiers', () => {
  const {f} = configuredV53();
  const text = f.context.buildTelegramSystemHealthText_(
    {ok: true, checks: []},
    {queueWaiting: 0, queueErrors: 0, exhaustedOpenBlocks: [], triggers: HANDLERS},
  );
  assert.match(text, /Утро 08:00/);
  assert.match(text, /Вечер 22:00/);
  assert.match(text, /Backup 03:00/);
  assert.match(text, /Calendar каждый час/);
  assert.equal(text.includes('v53-'), false);
});

test('v53 release inventory requires the existing owner-bound trigger set', () => {
  const now = Date.now();
  const handlers = HANDLERS.map(name => ({
    handler: name,
    configOk: true,
    state: 'last_run_succeeded',
  }));
  const inventory = {
    checkedAt: new Date(now - 1000).toISOString(),
    originalDocumentContext: true,
    mutationReady: false,
    scriptLockAvailable: true,
    documentLockAvailable: true,
    scheduledAutomation: {
      configOk: true,
      settingsOk: true,
      ownerVerified: true,
      handlers,
    },
    legacyStates: {malformed: 0},
    drainStartedAt: new Date(now - 421000).toISOString(),
  };
  assert.equal(verifyScheduledReleaseInventory(inventory, {now}), true);
  assert.throws(() => verifyScheduledReleaseInventory({
    ...inventory,
    scheduledAutomation: {...inventory.scheduledAutomation, ownerVerified: false},
  }, {now}), /owner/);
  assert.throws(() => verifyScheduledReleaseInventory({
    ...inventory,
    scheduledAutomation: {...inventory.scheduledAutomation,
      handlers: handlers.map((item, index) => index ? item : {handler: item.handler,
        state: item.state})},
  }, {now}), /missing or misconfigured/);
  assert.throws(() => verifyScheduledReleaseInventory({
    ...inventory,
    scheduledAutomation: {...inventory.scheduledAutomation,
      handlers: handlers.map((item, index) => index
        ? item
        : {...item, state: 'trigger_missing'})},
  }, {now}), /missing or misconfigured/);
});
test('v53 deduplicates one state but surfaces a new scheduled error class', () => {
  const {f} = configuredV53();
  const authorization = [{
    name: 'scheduled-trigger-freshness',
    details: 'syncCalendarToQueue=last_run_failed:authorization',
  }];
  const quota = [{
    name: 'scheduled-trigger-freshness',
    details: 'syncCalendarToQueue=last_run_failed:quota',
  }];
  assert.equal(
    f.context.getDmsWatchdogAlertSignature_(authorization),
    f.context.getDmsWatchdogAlertSignature_(structuredClone(authorization)),
  );
  assert.notEqual(
    f.context.getDmsWatchdogAlertSignature_(authorization),
    f.context.getDmsWatchdogAlertSignature_(quota),
  );
});