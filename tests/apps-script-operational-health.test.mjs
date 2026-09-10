import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

const headers = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v1/schema.json'))
  .sheet.columns.map(column => column.name)
  .concat(['Protocol', 'Ticket JSON', 'Payload JSON', 'Result JSON']);

function fixture(rows = []) {
  const book = memoryWorkbook({'Журнал операций Telegram': [headers, ...rows]});
  return loadBundle('stabilization', {SpreadsheetApp: book.service}).context;
}

function event({id, at = new Date(), status, protocol, code = ''}) {
  return ['event', at, id, 'ticket', status, 'action', '', '', '', '', code, '', '', protocol, '', '',
    JSON.stringify({status, code})];
}

test('operational health summarizes durable protocols without exposing operation identities', () => {
  const context = fixture([
    event({id: 'TGOP-private-one', status: 'committed', protocol: 'cf2'}),
    event({id: 'DOP-private-two', status: 'pending', protocol: 'dop1'}),
    event({id: 'DOP-private-three', status: 'manual_review', protocol: 'dop1', code: 'mutation_outcome_unknown'}),
    event({id: 'DOP-private-four', status: 'failed', protocol: 'dop1', code: 'underlying_state_changed'}),
  ]);
  const health = context.getDmsDurableOperationHealth_();
  assert.deepEqual(JSON.parse(JSON.stringify(health)), {
    state: 'manual_review', total: 4, pending: 1, stale: 0, manualReview: 1,
    failed: 1, committed: 1, protocols: {cf2: 1, dop1: 3},
    latestErrorClasses: {manual_review: 1, validation: 1},
  });
  const serialized = JSON.stringify(health);
  assert.doesNotMatch(serialized, /private|TGOP|DOP-/);
});

test('abandoned pending lifecycle becomes stale while a recent operation remains normal', () => {
  const context = fixture([
    event({id: 'old', at: new Date(Date.now() - 300000), status: 'started', protocol: 'dop1'}),
    event({id: 'new', at: new Date(), status: 'result', protocol: 'cf2'}),
  ]);
  const health = context.getDmsDurableOperationHealth_();
  assert.equal(health.state, 'stale');
  assert.equal(health.stale, 1);
  assert.equal(health.pending, 1);
});

test('unified operational health preserves semantic component states', () => {
  const context = fixture();
  context.runDmsReadOnlySelfTests = () => ({ok: true, checkedAt: new Date(), durationMs: 12,
    calendarIngestion: {state: 'awaiting_sync'},
    scheduledAutomation: {ok: true, configOk: true, settingsOk: true, handlers: [
      {handler: 'morning', state: 'within_expected_window'},
      {handler: 'calendar', state: 'last_run_succeeded'},
    ]},
    reconciliation: {state: 'awaiting_sync', issueCount: 1},
    backup: {state: 'not_due_yet'}, durableOperations: {state: 'healthy'},
    operationMetrics: {state: 'healthy', latestErrorClasses: {contention: 1}},
    system: {queueWaiting: 1}, checks: []});
  context.getDmsRuntimeIdentity_ = () => ({release: 'fixture'});
  const health = context.getDmsOperationalHealth_();
  assert.equal(health.state, 'healthy');
  assert.equal(health.calendarIngestion.state, 'awaiting_sync');
  assert.equal(health.reconciliation.state, 'awaiting_sync');
  assert.equal(health.scheduledAutomation.state, 'healthy');
  assert.deepEqual(health.scheduledAutomation.handlers.map(item => item.state),
    ['within_window', 'healthy']);
  assert.equal(health.backup.state, 'not_due_yet');
  assert.equal(health.runtime.release, 'fixture');
  assert.deepEqual(JSON.parse(JSON.stringify(health.latestErrorClasses)), {contention: 1});
});

test('scheduled timing lag stays delayed instead of becoming a generic failure', () => {
  const context = fixture();
  context.runDmsReadOnlySelfTests = () => ({ok: false, checkedAt: new Date(), durationMs: 4,
    calendarIngestion: {state: 'healthy'},
    scheduledAutomation: {ok: false, configOk: true, settingsOk: true, handlers: [
      {handler: 'calendar', state: 'delayed'},
    ]},
    reconciliation: {state: 'healthy'}, backup: {state: 'healthy'},
    durableOperations: {state: 'healthy'}, operationMetrics: {state: 'healthy'},
    system: {}, checks: [{name: 'scheduled-trigger-freshness', ok: false}]});
  context.getDmsRuntimeIdentity_ = () => ({release: 'fixture'});
  const health = context.getDmsOperationalHealth_();
  assert.equal(health.state, 'delayed');
  assert.equal(health.scheduledAutomation.state, 'delayed');
});
