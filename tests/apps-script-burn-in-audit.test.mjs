import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

function calendarFixture(candidate) {
  let now = Date.parse('2026-09-13T08:00:00Z');
  class Clock extends Date { constructor(...args) {super(...(args.length ? args : [now]));} static now(){return now;} }
  const f=loadBundle(candidate,{Date:Clock}); const c=f.context;
  const originalReadQueueIndex=c.readQueueIndex_;
  const config={calendarId:'fixture',startDate:new Clock('2026-08-01T00:00:00Z'),timeZone:'Europe/Moscow'};
  const event={id:'long-existing',summary:'Fixture ПТ',status:'confirmed',
    updated:'2026-08-15T00:00:00Z',start:{dateTime:'2026-09-14T09:00:00Z'},end:{dateTime:'2026-09-14T10:00:00Z'}};
  c.getRequiredSheet_=()=>({});c.getCalendarSyncSettings_=()=>config;c.buildCalendarClientMap_=()=>({});
  c.readQueueIndex_=()=>({allRows:[],byEventId:{},rows:[]});
  const calls=[];
  c.listCalendarEventsUpdated_=()=>[];
  c.listCalendarEvents_=(id,start,end)=>{calls.push([start,end]);return new Clock(event.start.dateTime)<end?[event]:[];};
  c.reconcileMissingQueueEventsInPlan_=()=>{};
  const initial=c.getDmsCalendarScanPlan_(config,new Clock());
  c.completeDmsCalendarScanState_(initial,new Clock().toISOString());
  return {...f,config,event,calls,originalReadQueueIndex,advance:ms=>{now+=ms;}};
}

test('complete sync adds horizon event then performs fresh reconciliation at the original boundary',()=>{
  const f=calendarFixture('v57'); const c=f.context; f.advance(2*3600000);
  const book=memoryWorkbook({'Клиенты':[[],[],[],['ID']],
    'Очередь подтверждения':[[],[],['ID']], 'Журнал тренировок':[[],[],['ID']],
    'Настройки':[['setting']]});
  book.workbook.toast=()=>{}; c.SpreadsheetApp=book.service;
  c.getRequiredSheet_=(ss,name)=>ss.getSheetByName(name);
  c.readQueueIndex_=f.originalReadQueueIndex;
  c.setCalendarAutomationStatus_=()=>{}; c.hasCalendarSyncTrigger_=()=>true;
  c.beginDmsScheduledAutomationExecution_=()=>({});
  c.recordDmsScheduledAutomationSuccess_=()=>{};
  c.finishDmsScheduledAutomationFailure_=()=>{};
  c.finishDmsOperationMetricsSafely_=()=>{};
  const realApply=c.applyCalendarQueueSyncPlan_;
  c.applyCalendarQueueSyncPlan_=(plan,metrics)=>{
    const result=realApply(plan,metrics); f.advance(5*60000); return result;
  };
  c.syncCalendarToQueue({triggerUid:'fixture'});
  assert.equal(book.sheets.get('Очередь подтверждения').rows[3][3],f.event.id);
  assert.equal(f.calls.length,2,'pre-read is reused but post-read must be fresh');
  assert.equal(f.calls[0][1].getTime(),f.calls[1][1].getTime(),'execution time must not move the horizon');
  const reconciliation=c.runDmsCalendarQueueReconciliation();
  assert.equal(reconciliation.issueCount,0);
  assert.equal(book.writes.filter(w=>w.sheet==='Журнал тренировок').length,0);
});

test('baseline reproduces horizon drift; candidate ingests an unchanged event entering the window',()=>{
  for(const candidate of ['v56','v57']) {
    const f=calendarFixture(candidate);const c=f.context;
    assert.equal(c.buildCalendarQueueSyncPlan_().added,0);
    f.advance(2*3600000);
    const plan=c.buildCalendarQueueSyncPlan_();
    assert.equal(plan.scan.includeWide,false);
    assert.equal(plan.added,candidate==='v56'?0:1);
    assert.equal(f.writes.length,0,'preview must stay read-only');
  }
});

test('planner consumes the exact pre-reconciliation horizon and reuses its Calendar response',()=>{
  const f=calendarFixture('v57');const c=f.context;f.advance(2*3600000);
  const now=new c.Date();const window=c.getDmsCalendarWideWindow_(f.config,now);
  const observation={now,calendarId:'fixture',start:window.start,end:window.end,events:[f.event]};
  f.advance(5*60000);
  const plan=c.buildCalendarQueueSyncPlan_(undefined,observation);
  assert.equal(plan.added,1);assert.equal(f.calls.length,0);
});

test('horizon boundary is exclusive and a long outage still covers the full reconciliation window',()=>{
  const f=calendarFixture('v57');const c=f.context;
  f.advance(3600000);assert.equal(c.buildCalendarQueueSyncPlan_().added,0);
  f.advance(1);assert.equal(c.buildCalendarQueueSyncPlan_().added,1);
  f.advance(3*86400000);assert.equal(c.buildCalendarQueueSyncPlan_().added,1);
});

test('incremental pagination failure remains fail-closed; deletion wins over a pre-read event',()=>{
  const f=calendarFixture('v57');const c=f.context;f.advance(2*3600000);
  c.listCalendarEventsUpdated_=()=>{throw new Error('injected page failure');};
  assert.throws(()=>c.buildCalendarQueueSyncPlan_(),/page failure/);assert.equal(f.writes.length,0);
  c.listCalendarEventsUpdated_=()=>[{id:f.event.id,status:'cancelled'}];
  assert.equal(c.buildCalendarQueueSyncPlan_().added,0);
});

function readFixture(candidate='v57') {
  const row=(id,client,block,date,type='Фактически проведена',status='Проведена')=>[id,date,client,block,'',type,status];
  const book=memoryWorkbook({'Журнал тренировок':[[],[],['ID'],
    row('TR-A','CL-A','',new Date('2026-09-10T10:00:00Z')),
    row('TR-B','CL-B','',new Date('2026-09-11T10:00:00Z')),
    row('TR-C','CL-A','BL-OLD',null),
    row('TR-D','CL-A','BL-NEW',new Date('2026-09-12T10:00:00Z'),'Списание без проведения'),
    row('TR-E','CL-A','',new Date('2026-09-13T10:00:00Z'),'Фактически проведена','Отменена')],
    'Очередь подтверждения':[[],[],['ID']], 'Клиенты':[[],[],[],[],['CL-A','Fixture <A>','Активен']],
    'Блоки':[[],[],['ID']], 'Оплаты':[[],[],['ID']]});
  const messages=[];
  const f=loadBundle(candidate,{SpreadsheetApp:{getActive:()=>book.workbook,flush(){} }});const c=f.context;
  c.telegramEditMessage_=(...args)=>messages.push(args); c.telegramSendMessage_=(...args)=>messages.push(args);
  return {...f,book,messages};
}

test('one-off history is client-scoped and retains old blocks, undated, charged and cancelled records',()=>{
  const f=readFixture();const c=f.context;const rows=c.getDmsClientTrainingHistory_('CL-A');
  assert.deepEqual(Array.from(rows,r=>r.id),['TR-E','TR-D','TR-A','TR-C']);
  assert.equal(rows.at(-1).date,'Дата не указана');assert.equal(f.book.writes.length,0);
  c.sendTelegramClientTrainingHistory_('2002','CL-A',7,0);
  assert.match(f.messages.at(-1)[2],/Fixture &lt;A&gt;/);assert.doesNotMatch(f.messages.at(-1)[2],/TR-B/);
  assert.equal(f.book.writes.length,0);
});

test('history pagination and empty-state remain read-only and return to the correct card',()=>{
  const f=readFixture();const c=f.context;
  c.getDmsClientTrainingHistory_=()=>Array.from({length:23},(_,i)=>({id:'T'+i,date:'10.09.2026',type:'Фактически проведена',status:'Проведена',blockId:''}));
  c.sendTelegramClientTrainingHistory_('2002','CL-A',7,1);
  const message=f.messages.at(-1);assert.match(message[2],/2\/3/);
  assert.equal(message[3].inline_keyboard[0].length,2);
  c.getDmsClientTrainingHistory_=()=>[];c.sendTelegramClientTrainingHistory_('2002','CL-A',7,100);
  assert.match(f.messages.at(-1)[2],/Записей пока нет/);assert.equal(f.book.writes.length,0);
});

test('unknown onboarding next action covers older dates and does not resolve anything',()=>{
  const f=readFixture(); const row=Array(17).fill('');row[0]='Q-OLD';row[1]=new Date('2026-08-01');row[11]='Требует регистрации';row[13]='Требует регистрации';
  f.book.sheets.get('Очередь подтверждения').rows.push(row);
  const next=f.context.getDmsTelegramOnboardingNextAction_();
  assert.match(next.text,/регистрация: 1/);assert.match(next.text,/создай клиента, свяжи/);
  assert.ok(next.replyMarkup.inline_keyboard[0][0].web_app);assert.equal(f.book.writes.length,0);
  row[13]='Обработано';assert.equal(f.context.getDmsTelegramOnboardingNextAction_().replyMarkup,null);
});

test('today and attention commands do not perform inline Calendar ingestion',()=>{
  const f=readFixture();const c=f.context;let reads=0;
  c.syncCalendarToQueue=()=>{throw new Error('unexpected mutation');};
  c.sendTelegramQueueDashboard_=()=>{reads++;};c.sendTelegramAttentionCenter_=()=>{reads++;};
  for(const text of ['/today','/attention'])c.handleTelegramMessage_({text,from:{id:1001},chat:{id:2002}});
  assert.equal(reads,2);assert.equal(f.book.writes.length,0);
});

test('health phase profiling preserves return values and exceptions without reporting data',()=>{
  const logs=[];const c=loadBundle('v57',{console:{log:v=>logs.push(JSON.parse(v)),error(){}}}).context;
  assert.equal(c.profileDmsHealthPhase_('financial',()=>42),42);
  assert.throws(()=>c.profileDmsHealthPhase_('backup',()=>{throw new Error('private payload');}),/private payload/);
  assert.equal(logs.length,2);assert.doesNotMatch(JSON.stringify(logs),/private payload/);
  assert.ok(logs.every(r=>r.durationMs>=0));
});

test('MiniApp exposes unresolved registrations from other days without broadening day acceptance',()=>{
  const f=readFixture();const c=f.context;
  const make=(id,date,status,matching)=>{const row=Array(17).fill('');row[0]=id;row[1]=new Date(date);row[5]=row[1];row[6]=row[1];row[13]=status;row[11]=matching;return row;};
  f.book.sheets.get('Очередь подтверждения').rows.push(
    make('Q-OLD','2026-09-09T10:00:00Z','Требует регистрации','Требует регистрации'),
    make('Q-DONE','2026-09-09T10:00:00Z','Обработано','Требует регистрации'),
    make('Q-TODAY','2026-09-14T10:00:00Z','Ожидает','Распознано'));
  c.getDmsQueueSemanticContext_=()=>({});c.getDmsQueueSemanticRevision_=()=> 'fixture-semantic';
  const result=c.getDmsMiniAppQueueSnapshot_(new Date('2026-09-14T10:00:00Z'),f.book.workbook,'Europe/Moscow');
  assert.deepEqual(Array.from(result.items,r=>r.queueId),['Q-TODAY']);
  assert.deepEqual(Array.from(result.registrations,r=>r.queueId),['Q-OLD']);
  assert.equal(result.registrations[0].dateLabel,'09.09.2026');assert.equal(f.book.writes.length,0);
});

test('candidate keeps core security/locking/undo/financial module bytes unchanged',()=>{
  for(const file of ['ZZZZZZZZZZZZZOperationSafety.gs','ZZZZZZZZZZZZZZUndoSafety.gs',
    'ZZZZZZZZZZZZZZZFinancialSafety.gs','ZZZZZZZZZZZZZZZZReleaseSafety.gs','ZZZZZZZZZZZZZZZZZZDomainOperations.gs'])
    assert.deepEqual(fs.readFileSync('apps-script/candidates/v57/'+file),fs.readFileSync('apps-script/versions/v56/'+file));
});

test('monthly report never adds another month or year to the current Calendar forecast',()=>{
  for (const [candidate,month,hasTotal] of [
    ['v56',new Date('2026-08-01T00:00:00Z'),true],
    ['v57',new Date('2026-08-01T00:00:00Z'),false],
    ['v57',new Date('2025-09-01T00:00:00Z'),false],
    ['v57','unverified month',false],
    ['v57',new Date('2026-09-01T00:00:00Z'),true],
  ]) {
    const f=loadBundle(candidate);const c=f.context;
    c.getRequiredSheet_=()=>({getRange:()=>({getValue:()=>month,
      getDisplayValue:()=> 'Selected month',
      getDisplayValues:()=>[['Всего заработано работой','1000']]})});
    c.getTelegramOperationalMetrics_=()=>({activeClients:1,openBlocks:1,lowBlocks:0,debtClients:0});
    c.getTelegramCalendarForecast_=()=>({monthName:'09.2026',trainingCount:1,workValue:200,unrecognizedCount:0});
    const text=c.buildTelegramReportText_();
    assert.equal(text.includes('Работа за месяц с учётом расписания'),hasTotal);
    assert.match(text,/Прогноз до конца 09.2026/);
    if(hasTotal) assert.match(text,/1.200/);
    else assert.match(text,/Прогноз показан отдельно/);
    assert.equal(f.writes.length,0);
  }
});
