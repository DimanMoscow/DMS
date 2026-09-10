import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

function clockFixture() {
  let now = Date.parse('2026-09-10T10:00:00.000Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const fixture = loadBundle('stabilization', {Date: Clock});
  return {fixture, advance: milliseconds => { now += milliseconds; }};
}

test('Calendar scan state uses an overlap cursor and a bounded wide verification window', () => {
  const {fixture, advance} = clockFixture();
  const context = fixture.context;
  const config = {calendarId: 'private-calendar@example.test', startDate: new Date('2020-01-01T00:00:00Z')};
  const initial = context.getDmsCalendarScanPlan_(config, new context.Date());
  assert.equal(initial.includeWide, true);
  assert.equal(initial.updatedMin.toISOString(), '2026-09-03T10:00:00.000Z');
  assert.equal(initial.wideStart.toISOString(), '2026-05-13T10:00:00.000Z');

  context.completeDmsCalendarScanState_(initial, '2026-09-10T09:59:00.000Z');
  advance(60 * 60 * 1000);
  const next = context.getDmsCalendarScanPlan_(config, new context.Date());
  assert.equal(next.includeWide, false);
  assert.equal(next.updatedMin.toISOString(), '2026-09-09T09:59:00.000Z');
  const stored = fixture.properties.get('DMS_CALENDAR_BOUNDED_SCAN_V1');
  assert.doesNotMatch(stored, /private-calendar/);
});

test('incremental Calendar listing includes deletes and keeps pagination parameters stable', () => {
  const calls = [];
  const {context} = loadBundle('stabilization', {Calendar: {Events: {list(calendarId, params) {
    calls.push({calendarId, params: {...params}});
    return calls.length === 1
      ? {items: [{id: 'old-event', status: 'cancelled'}], nextPageToken: 'page-2'}
      : {items: [{id: 'new-event', status: 'confirmed'}]};
  }}}});
  const updatedMin = new Date('2026-09-09T00:00:00Z');
  const events = context.listCalendarEventsUpdated_(
    'calendar', updatedMin, 'Europe/Moscow');
  assert.deepEqual(JSON.parse(JSON.stringify(events.map(event => event.id))),
    ['old-event', 'new-event']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.updatedMin, updatedMin.toISOString());
  assert.equal(calls[0].params.showDeleted, true);
  assert.equal('timeMin' in calls[0].params, false);
  assert.equal('timeMax' in calls[0].params, false);
  assert.equal(calls[1].params.updatedMin, calls[0].params.updatedMin);
  assert.equal(calls[1].params.pageToken, 'page-2');
});

function planFixture() {
  const {context} = loadBundle('stabilization');
  const config = {calendarId: 'calendar', startDate: new Date('2020-01-01T00:00:00Z'),
    timeZone: 'Europe/Moscow'};
  const row = {row: 4, values: Array(17).fill('')};
  row.values[0] = 'Q-OLD'; row.values[3] = 'EVENT-OLD';
  row.values[5] = new Date('2026-09-01T10:00:00Z'); row.values[13] = 'Ожидает';
  row.values[15] = 'Calendar';
  context.SpreadsheetApp = {getActive: () => ({})};
  context.getRequiredSheet_ = () => ({});
  context.getCalendarSyncSettings_ = () => config;
  context.buildCalendarClientMap_ = () => ({});
  context.readQueueIndex_ = () => ({allRows: [row.values], byEventId: {'EVENT-OLD': row}, rows: [row]});
  return {context, config};
}

test('absence from an incremental response never cancels an existing Queue row', () => {
  const {context} = planFixture();
  let missingReconciliations = 0;
  context.getDmsCalendarScanPlan_ = () => ({updatedMin: new Date(), includeWide: false,
    wideStart: new Date(), recoveryFull: false});
  context.listCalendarEventsUpdated_ = () => [];
  context.listCalendarEvents_ = () => { throw new Error('wide scan must not run'); };
  context.reconcileMissingQueueEventsInPlan_ = () => { missingReconciliations++; };
  const plan = context.buildCalendarQueueSyncPlan_();
  assert.equal(plan.writes.length, 0);
  assert.equal(missingReconciliations, 0);
});

test('incremental changes update an existing event moved beyond the horizon but do not enqueue new far-future events', () => {
  const {context} = planFixture();
  context.getDmsCalendarScanPlan_ = () => ({updatedMin: new Date(), includeWide: false,
    wideStart: new Date(), recoveryFull: false});
  const event = id => ({id, summary: 'ПТ Fixture', start: {dateTime: '2027-01-01T10:00:00Z'},
    end: {dateTime: '2027-01-01T11:00:00Z'}, status: 'confirmed'});
  context.listCalendarEventsUpdated_ = () => [event('EVENT-OLD'), event('EVENT-NEW')];
  const plan = context.buildCalendarQueueSyncPlan_();
  assert.equal(plan.writes.length, 1);
  assert.equal(plan.writes[0].values[3], 'EVENT-OLD');
  assert.equal(plan.updated, 1);
  assert.equal(plan.ignored, 1);
});

test('expired incremental cursor falls back to an exceptional full recovery scan', () => {
  const {context, config} = planFixture();
  let fullStart = null;
  let missingReconciliations = 0;
  context.getDmsCalendarScanPlan_ = () => ({calendarFingerprint: 'safe', updatedMin: new Date(),
    includeWide: false, wideStart: new Date('2026-01-01T00:00:00Z'), recoveryFull: false});
  context.listCalendarEventsUpdated_ = () => { const error = new Error('fullSyncRequired'); error.code = 410; throw error; };
  context.listCalendarEvents_ = (calendarId, start) => { fullStart = start; return []; };
  context.reconcileMissingQueueEventsInPlan_ = () => { missingReconciliations++; };
  const plan = context.buildCalendarQueueSyncPlan_();
  assert.equal(plan.scan.recoveryFull, true);
  assert.equal(fullStart.toISOString(), config.startDate.toISOString());
  assert.equal(missingReconciliations, 1);
});

test('read-only reconciliation uses the bounded verification window', () => {
  const {fixture} = clockFixture();
  const context = fixture.context;
  let observedStart = null;
  context.SpreadsheetApp = {getActive: () => ({})};
  context.getRequiredSheet_ = () => ({});
  context.getCalendarSyncSettings_ = () => ({calendarId: 'calendar',
    startDate: new Date('2020-01-01T00:00:00Z'), timeZone: 'Europe/Moscow'});
  context.readDmsReconciliationRows_ = () => [];
  context.listCalendarEvents_ = (calendarId, start) => { observedStart = start; return []; };
  context.buildDmsCalendarQueueReconciliationReport_ = () => ({ok: true, checkedAt: new Date(),
    issueCount: 0, safeRepairCount: 0});
  context.runDmsCalendarQueueReconciliation();
  assert.equal(observedStart.toISOString(), '2026-05-13T10:00:00.000Z');
});
