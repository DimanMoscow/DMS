import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

const key = 'DMS_CALENDAR_SYNC_GENERATION_V1';
function fixture() {
  let now = Date.parse('2026-09-09T19:21:00+03:00');
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const f = loadBundle('v54', {Date: Clock});
  const c = f.context;
  const job = {configOk:true, fresh:true, state:'last_run_succeeded', nextExpectedWindow:{startAt:'next'}};
  let current = report();
  c.beginDmsScheduledAutomationExecution_ = () => ({});
  c.recordDmsScheduledAutomationSuccess_ = () => {};
  c.finishDmsScheduledAutomationFailure_ = () => {};
  c.runDmsCalendarQueueReconciliation = () => current;
  c.buildCalendarQueueSyncPlan_ = () => ({errors:0});
  c.applyCalendarQueueSyncPlan_ = () => 'completed';
  const at = time => { now = Date.parse('2026-09-09T'+time+':00+03:00'); };
  const health = () => c.classifyDmsCalendarIngestion_(c.readDmsCalendarSyncGeneration_(), current, job);
  const sync = (before, after=before) => {
    current=before;
    c.applyCalendarQueueSyncPlan_ = () => { now+=1000; current=after; return 'completed'; };
    c.syncCalendarToQueue();
  };
  return {f,c,job,at,health,sync,set: value=>{current=value;}};
}
function report(...ids) {
  return {ok:ids.length===0,issueCount:ids.length, issues:{calendarTrainingMissingQueue:ids.map(id=>({eventId:id,revision:'r1'}))}};
}

test('19:21 sync, 19:30 new event, 20:10 watchdog awaits ingestion without writes or alerts', () => {
  const x=fixture(); x.sync(report()); x.at('19:30'); x.set(report('event-a')); x.at('20:10');
  const properties = JSON.stringify([...x.f.properties]);
  const h=x.health(); assert.equal(h.state,'awaiting_sync'); assert.equal(h.ok,true); assert.equal(h.pendingCount,1);
  assert.equal(JSON.stringify([...x.f.properties]),properties); assert.deepEqual(x.f.writes,[]);
});
test('next successful 20:21 sync ingests event and clears pending state', () => {
  const x=fixture(); x.sync(report()); x.set(report('a')); x.at('20:10'); assert.equal(x.health().state,'awaiting_sync');
  x.at('20:21'); x.sync(report('a'),report()); assert.equal(x.health().state,'healthy');
  assert.equal(x.health().pendingCount,0); assert.equal(x.health().syncGeneration,2);
  assert.equal(JSON.parse(x.f.properties.get(key)).postSync.issueCount,0);
});
test('same revision surviving next successful sync is actionable drift', () => {
  const x=fixture(); x.sync(report()); x.at('20:21'); x.sync(report('a'));
  assert.equal(x.health().state,'drift_after_successful_sync'); assert.equal(x.health().ok,false);
  assert.equal(x.health().driftCount,1);
});
test('missing, delayed and failed sync take precedence over reconciliation lag', () => {
  const x=fixture(); x.sync(report()); x.set(report('a')); x.at('21:10');
  x.job.fresh=false; x.job.state='stale'; assert.equal(x.health().state,'sync_delayed');
  x.job.state='last_run_failed'; assert.equal(x.health().state,'sync_failed');
  x.job.configOk=false; assert.equal(x.health().state,'sync_trigger_missing');
});
test('trigger jitter cannot promote an observation without a completed ingestion generation', () => {
  for (const time of ['19:59','20:10','20:20','20:22','20:40']) {
    const x=fixture(); x.sync(report()); x.at(time); x.set(report('a'));
    assert.equal(x.health().state,'awaiting_sync',time);
    x.sync(report('a'),report()); assert.equal(x.health().state,'healthy',time);
  }
});
test('multiple temporary mismatches cause no watchdog Telegram/repair writes and no durable growth', () => {
  const x=fixture(); x.sync(report());
  let alerts=0; x.c.telegramSendMessage_=()=>{alerts++;};
  x.c.runDmsReadOnlySelfTests=options=>{assert.equal(options.watchdog,true);return {ok:x.health().ok,checks:[],summary:x.health().state};};
  const stored=x.f.properties.get(key);
  for (let count=1; count<=30; count++) {
    x.set(report(...Array.from({length:count},(_,i)=>'event-'+i)));
    assert.equal(x.c.runDmsWatchdog().notified,false);
  }
  assert.equal(alerts,0); assert.equal(x.f.properties.get(key),stored); assert.deepEqual(x.f.writes,[]);
});
test('real drift deduplicates, resolved observation suppresses warning, new error class is not hidden', () => {
  const x=fixture(); let alerts=0; x.c.telegramSendMessage_=()=>{alerts++;};
  x.c.runDmsReadOnlySelfTests=()=>{const h=x.health();return {ok:h.ok,checks:[{name:'calendar',ok:h.ok,details:h.summary}],summary:h.state};};
  x.sync(report('a')); x.c.runDmsWatchdog(); x.c.runDmsWatchdog(); assert.equal(alerts,1);
  x.job.state='last_run_failed'; x.c.runDmsWatchdog(); assert.equal(alerts,2);
  x.job.state='last_run_succeeded'; x.sync(report('a'),report()); x.c.runDmsWatchdog(); assert.equal(alerts,2);
  assert.equal(x.f.properties.has('DMS_WATCHDOG_ALERT_SIGNATURE'),false);
});
test('event arriving or changing revision during sync awaits the next generation', () => {
  const x=fixture(); x.sync(report(),report('new')); assert.equal(x.health().state,'awaiting_sync');
  const revised=report('new'); revised.issues.calendarTrainingMissingQueue[0].revision='r2';
  x.sync(report('new'),revised); assert.equal(x.health().state,'awaiting_sync');
  x.sync(revised); assert.equal(x.health().state,'drift_after_successful_sync');
});
test('in-progress and aborted sync cannot publish successful post-sync evidence', () => {
  const x=fixture(); x.sync(report());
  x.c.buildCalendarQueueSyncPlan_=()=>{ assert.equal(x.health().state,'awaiting_sync');throw new Error('fixture failure');};
  assert.throws(()=>x.c.syncCalendarToQueue(),/fixture failure/);
  assert.equal(x.health().state,'sync_failed'); assert.equal(x.health().syncGeneration,1);
  assert.equal(x.health().lastError,'sync_execution_failed');
});
test('partial plan errors fail closed before ingestion writes', () => {
  const x=fixture(); x.c.buildCalendarQueueSyncPlan_=()=>({errors:1});
  x.c.applyCalendarQueueSyncPlan_=()=>{throw new Error('must not write');};
  assert.throws(()=>x.c.syncCalendarToQueue(),/plan incomplete/); assert.equal(x.health().state,'sync_failed');
});
test('durable issue evidence is capped, contains no payload, overflow stays blocking', () => {
  const x=fixture(); x.sync(report(...Array.from({length:100},(_,i)=>'private-event-'+i)));
  const stored=x.f.properties.get(key); assert.ok(stored.length<9000); assert.equal(stored.includes('private-event'),false);
  assert.equal(JSON.parse(stored).driftKeys.length,64); assert.equal(x.health().ok,false);
});
test('accounting defects remain actionable while unrelated Calendar ingestion is pending', () => {
  const x=fixture(); x.sync(report()); const r=report('a'); r.issues.queueJournalMismatch=[{queueId:'q'}];
  x.set(r); assert.equal(x.health().state,'accounting_drift'); assert.equal(x.health().ok,false);
});
