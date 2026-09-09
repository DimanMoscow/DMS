import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const candidateRoot = 'apps-script/candidates/stabilization';
const metricsSource = fs.readFileSync(
  `${candidateRoot}/ZZZZZZZZZZZZZZZZZOperationMetrics.gs`,
  'utf8',
);
const calendarSource = fs.readFileSync(`${candidateRoot}/CalendarSync.gs`, 'utf8');
const runtimeSource = fs.readFileSync(`${candidateRoot}/ZZZZZZZRuntime.gs`, 'utf8');

function makeContext() {
  let now = Date.parse('2026-09-10T00:00:00.000Z');
  const values = new Map();
  const logs = [];
  class FakeDate extends Date {
    constructor(value) {
      super(value === undefined ? now : value);
    }
    static now() {
      return now;
    }
  }
  const context = vm.createContext({
    Date: FakeDate,
    Math,
    JSON,
    console: {
      log(value) { logs.push(String(value)); },
      error(value) { logs.push(String(value)); },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return values.get(key) ?? null; },
          setProperty(key, value) { values.set(key, String(value)); },
        };
      },
    },
    advance(ms) { now += ms; },
  });
  vm.runInContext(metricsSource, context, {
    filename: 'ZZZZZZZZZZZZZZZZZOperationMetrics.gs',
  });
  return {context, values, logs};
}

test('operation metrics persist only bounded allow-listed fields', () => {
  const {context, values, logs} = makeContext();
  const result = vm.runInContext(`(() => {
    const metric = beginDmsOperationMetrics_('calendar_sync_scheduled');
    measureDmsOperationPhase_(metric, 'sheetsReadMs', function() { advance(17); });
    measureDmsOperationPhase_(metric, 'calendarMs', function() { advance(31); });
    addDmsOperationDuration_(metric, 'lockWaitMs', 4);
    addDmsOperationCount_(metric, 'rowsRead', 85);
    addDmsOperationCount_(metric, 'eventsRead', 21);
    advance(3);
    return finishDmsOperationMetrics_(metric, 'success');
  })()`, context);

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    version: 1,
    operation: 'calendar_sync_scheduled',
    startedAt: '2026-09-10T00:00:00.000Z',
    finishedAt: '2026-09-10T00:00:00.051Z',
    outcome: 'success',
    totalMs: 51,
    lockWaitMs: 4,
    sheetsReadMs: 17,
    sheetsWriteMs: 0,
    calendarMs: 31,
    telegramMs: 0,
    reconciliationMs: 0,
    calendarSyncMs: 0,
    healthCheckMs: 0,
    driveMs: 0,
    rowsRead: 85,
    rowsWritten: 0,
    eventsRead: 21,
    eventsWritten: 0,
    retryCount: 0,
    errorClass: null,
  });
  assert.equal(values.size, 1);
  assert.ok(values.has('DMS_OP_METRIC_V1_CALENDAR_SYNC_SCHEDULED'));
  assert.match(logs[0], /"event":"dms_operation_metric"/);
});

test('metric dimensions reject dynamic labels and never persist raw errors', () => {
  const {context, values} = makeContext();
  assert.throws(
    () => vm.runInContext("beginDmsOperationMetrics_('client-CL-SECRET')", context),
    /Unsupported operation metric/,
  );
  const result = vm.runInContext(`(() => {
    const metric = beginDmsOperationMetrics_('calendar_sync_inline');
    addDmsOperationCount_(metric, 'rowsRead', 999999999);
    return finishDmsOperationMetrics_(
      metric,
      'failed',
      new Error('client@example.test quota exceeded for CL-SECRET')
    );
  })()`, context);
  assert.equal(result.rowsRead, 10000000);
  assert.equal(result.errorClass, 'quota');
  assert.doesNotMatch([...values.values()][0], /example|SECRET/);
});

test('telemetry persistence failure cannot change the operation outcome', () => {
  const {context, logs} = makeContext();
  vm.runInContext(`PropertiesService = {
    getScriptProperties: function() {
      return {setProperty: function() { throw new Error('private payload'); }};
    }
  }`, context);
  const result = vm.runInContext(`(() => {
    const metric = beginDmsOperationMetrics_('calendar_sync_inline');
    return finishDmsOperationMetricsSafely_(metric, 'success');
  })()`, context);
  assert.equal(result, null);
  assert.match(logs[0], /dms_operation_metric_failure/);
  assert.doesNotMatch(logs[0], /private payload/);
});

test('Calendar sync instruments lock, Sheets, Calendar, reconciliation and volumes', () => {
  assert.match(calendarSource, /calendar_sync_scheduled/);
  assert.match(calendarSource, /calendar_sync_inline/);
  for (const field of [
    'lockWaitMs',
    'sheetsReadMs',
    'sheetsWriteMs',
    'calendarMs',
    'reconciliationMs',
    'rowsRead',
    'rowsWritten',
    'eventsRead',
  ]) {
    assert.ok(calendarSource.includes(`'${field}'`) || runtimeSource.includes(`'${field}'`),
      `Calendar instrumentation is missing ${field}`);
  }
  assert.match(runtimeSource, /runDmsCalendarQueueReconciliation\(metrics\)/);
  assert.match(calendarSource, /finishDmsOperationMetricsSafely_\(metrics, 'success'\)/);
  assert.match(calendarSource, /finishDmsOperationMetricsSafely_\(metrics, 'failed', error\)/);
});

test('instrumented Calendar sync preserves orchestration and records a scheduled sample', () => {
  const {context, values} = makeContext();
  vm.runInContext(calendarSource, context, {filename: 'CalendarSync.gs'});
  vm.runInContext(`
    var calls = [];
    beginDmsScheduledAutomationExecution_ = function() { calls.push('scheduled-start'); return {}; };
    getDmsMutationLock_ = function() { return {
      tryLock: function() { advance(5); calls.push('lock'); return true; },
      releaseLock: function() { calls.push('unlock'); }
    }; };
    beginDmsCalendarSyncGeneration_ = function() { calls.push('generation-start'); return {}; };
    getDmsCalendarIngestionEvidence_ = function(report) { return report; };
    runDmsCalendarQueueReconciliation = function() { advance(11); calls.push('reconcile'); return {ok: true}; };
    buildCalendarQueueSyncPlan_ = function(metric) {
      measureDmsOperationPhase_(metric, 'calendarMs', function() { advance(7); });
      addDmsOperationCount_(metric, 'eventsRead', 3);
      calls.push('plan');
      return {errors: 0, writes: [{}, {}]};
    };
    applyCalendarQueueSyncPlan_ = function(plan, metric) {
      advance(3); addDmsOperationCount_(metric, 'rowsWritten', plan.writes.length);
      calls.push('apply'); return 'applied';
    };
    SpreadsheetApp = {flush: function() { advance(2); calls.push('flush'); }};
    completeDmsCalendarSyncGeneration_ = function() { calls.push('generation-complete'); };
    failDmsCalendarSyncGeneration_ = function() { calls.push('generation-failed'); };
    recordDmsScheduledAutomationSuccess_ = function() { calls.push('scheduled-success'); };
    finishDmsScheduledAutomationFailure_ = function() { calls.push('scheduled-failed'); };
  `, context);
  const result = vm.runInContext("syncCalendarToQueue({triggerUid: 'redacted'})", context);
  assert.equal(result, 'applied');
  assert.deepEqual(JSON.parse(JSON.stringify(context.calls)), [
    'scheduled-start', 'lock', 'generation-start', 'reconcile', 'plan', 'apply',
    'flush', 'reconcile', 'generation-complete', 'scheduled-success', 'unlock',
  ]);
  const sample = JSON.parse(values.get('DMS_OP_METRIC_V1_CALENDAR_SYNC_SCHEDULED'));
  assert.equal(sample.outcome, 'success');
  assert.equal(sample.lockWaitMs, 5);
  assert.equal(sample.calendarMs, 7);
  assert.equal(sample.reconciliationMs, 22);
  assert.equal(sample.sheetsWriteMs, 5);
  assert.equal(sample.eventsRead, 3);
  assert.equal(sample.rowsWritten, 2);
});

test('scheduled and critical operation entry points use the safe metric scope', () => {
  const telegram = fs.readFileSync(`${candidateRoot}/TelegramFinal.gs`, 'utf8');
  const telegramApi = fs.readFileSync(`${candidateRoot}/TelegramBot.gs`, 'utf8');
  const safety = fs.readFileSync(`${candidateRoot}/ZZZZZZZZZZZZZOperationSafety.gs`, 'utf8');
  const miniApp = fs.readFileSync(`${candidateRoot}/ZZZZZZZZZZMiniAppAdmin.gs`, 'utf8');
  for (const operation of [
    'morning_digest',
    'evening_queue',
    'automatic_backup',
  ]) assert.ok(telegram.includes(`beginDmsOperationMetrics_('${operation}')`));
  assert.ok(runtimeSource.includes("beginDmsOperationMetrics_('watchdog')"));
  assert.ok(safety.includes("beginDmsOperationMetrics_('telegram_secure_mutation')"));
  assert.ok(miniApp.includes("beginDmsOperationMetrics_('miniapp_queue_decision')"));
  assert.ok(miniApp.includes("beginDmsOperationMetrics_('miniapp_confirm_day')"));
  assert.match(telegramApi, /measureActiveDmsOperationPhase_\('telegramMs'/);
  assert.match(safety, /measureActiveDmsOperationPhase_\('calendarMs'/);
});
