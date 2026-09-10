import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

const ledgerHeaders = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v1/schema.json'))
  .sheet.columns.map(column => column.name)
  .concat(['Protocol', 'Ticket JSON', 'Payload JSON', 'Result JSON']);

function fixture() {
  const now = new Date();
  const moscow = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]));
  const date = new Date(`${moscow.year}-${moscow.month}-${moscow.day}T10:00:00+03:00`);
  const row = ['Q-DAY', date, '', '', '', date, new Date(date.getTime() + 3600000),
    'Fixture A ПТ', 'CL-A', 'Fixture A', '', 'Распознано', 'Проведена', 'Ожидает', '', '', ''];
  const book = memoryWorkbook({
    'Клиенты': [[], [], [], [], ['CL-A', 'Fixture A', 'Активен', '', '', 0, 0, 0, 0, 0, 'Разовые — 3500 ₽']],
    'Блоки': [[], [], ['ID']], 'Оплаты': [[], [], ['ID']],
    'Журнал тренировок': [[], [], ['ID']], 'Очередь подтверждения': [[], [], ['ID'], row],
    'Настройки': [['Key', 'Value']], 'Журнал действий бота': [['ID']],
    'Журнал операций Telegram': [ledgerHeaders],
  });
  const shared = new Map([
    ['DMS_TG_WEBHOOK_SECRET', 'fixture-webhook'], ['DMS_TG_ADMIN_USER_IDS', '1001'],
    ['DMS_TG_CHAT_ID', '2002'], ['DMS_TG_BOT_TOKEN', 'fixture'],
  ]);
  const props = {getProperty: key => shared.get(key) ?? null,
    setProperty: (key, value) => shared.set(key, String(value)),
    getProperties: () => Object.fromEntries(shared), deleteProperty: key => shared.delete(key)};
  let locked = false;
  const context = loadBundle('stabilization', {
    SpreadsheetApp: book.service,
    PropertiesService: {getScriptProperties: () => props, getDocumentProperties: () => null},
    LockService: {getDocumentLock: () => null, getScriptLock: () => ({
      tryLock: () => {if (locked) return false; locked = true; return true;},
      releaseLock: () => {locked = false;},
    })},
    UrlFetchApp: {fetch: () => ({getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})})},
  }).context;
  const calls = [];
  const processQueueDate = context.processQueueDate_;
  const cancelCalendar = context.applyTelegramCalendarCancellationsForDate_;
  const calendarTargets = context.getDmsConfirmationCalendarTargets_;
  const calendarPrecondition = context.assertDmsConfirmedCalendarCurrent_;
  context.processQueueDate_ = (day, source, dryRun, options) => {
    calls.push({kind: dryRun ? 'preflight' : 'process', source, lockHeld: options.lockHeld});
    return dryRun
      ? {total: 1, blocked: 0, blockers: [], alreadyLogged: 0}
      : {total: 1, added: 1, skipped: 0, alreadyLogged: 0, blocked: 0, blockers: []};
  };
  context.applyTelegramCalendarCancellationsForDate_ = () => {
    calls.push({kind: 'calendar'});
    return {deleted: 1, alreadyMissing: 0, failed: 0, errors: []};
  };
  context.assertDmsConfirmedCalendarCurrent_ = () => calls.push({kind: 'calendar-precondition'});
  const dateKey = context.makeDateKey_(date, 'Europe/Moscow');
  const acceptedRows = context.getDmsDayAcceptanceRows_(dateKey);
  return {book, context, calls, dateKey, acceptedRows, processQueueDate, cancelCalendar, calendarTargets, calendarPrecondition};
}

function domain(result) {
  const keys = ['code', 'ref', 'dateKey', 'changed', 'total', 'added', 'skipped',
    'alreadyLogged', 'blocked', 'calendarDeleted', 'calendarAlreadyMissing', 'calendarFailed'];
  return Object.fromEntries(keys.map(key => [key, result[key]]));
}

test('confirm day accepts the revision produced by the real bootstrap serializer', () => {
  const f = fixture();
  f.context.getDmsMiniAppReport_ = () => ({});
  f.context.getDmsConfirmationCalendarTargets_ = () => [];
  const bootstrap = f.context.getDmsMiniAppBootstrap_();
  assert.match(bootstrap.today.revision, /^[A-Za-z0-9_-]{43}$/);
  const result = f.context.confirmDmsMiniAppDay_({dateKey: f.dateKey,
    revision: bootstrap.today.revision, acceptedRows: f.acceptedRows,
    operationId: '99999999-9999-4999-8999-999999999999'}, '1001');
  assert.equal(result.confirmation.code, 'day_confirmed');
});

function realDayFixture(count = 10) {
  const f = fixture(); const c = f.context;
  c.processQueueDate_ = f.processQueueDate;
  c.applyTelegramCalendarCancellationsForDate_ = f.cancelCalendar;
  c.getDmsMiniAppReport_ = () => ({});
  c.getDmsConfirmationCalendarTargets_ = () => [];
  const queue = f.book.sheets.get('Очередь подтверждения');
  const row = queue.getRange(4, 1, 1, 17).getValues()[0];
  for (let i = 0; i < count; i++) {
    const values = [...row]; values[0] = 'Q-' + (i + 1); values[12] = 'Отмена без списания';
    queue.getRange(4 + i, 1, 1, 17).setValues([values]);
  }
  const b = c.getDmsMiniAppBootstrap_();
  const payload = {dateKey:f.dateKey, revision:b.today.revision,
    acceptedRows:c.getDmsDayAcceptanceRows_(f.dateKey),operationId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
  return {...f, queue, payload, row};
}

for (const scale of [1, 10]) test(`production-volume ${scale}x fixture retains the accepted ten and bounds storage scans`, t => {
  const f = realDayFixture(); const old = new Date(Date.now() - 7 * 86400000);
  const fill = (name, first, rows) => {
    const sheet=f.book.sheets.get(name);
    if (first + rows.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),first + rows.length);
    sheet.getRange(first,1,rows.length,rows[0].length).setValues(rows);
  };
  fill('Клиенты',6,Array.from({length:20*scale-1},(_,i)=>['CL-X'+i,'Fixture','Активен','','',0,0,0,0,0,'Разовые — 3500 ₽']));
  fill('Блоки',4,Array.from({length:18*scale},(_,i)=>['BL-X'+i,'CL-X'+i,'Блок 10','Закрыт',old,'','',10,10,0,30000,3000]));
  fill('Оплаты',4,Array.from({length:27*scale},(_,i)=>['OP-X'+i,old,'CL-X0','','Оплата','Перевод',3500,'Подтверждён',old,'']));
  fill('Журнал тренировок',4,Array.from({length:131*scale},(_,i)=>['TR-X'+i,old,'CL-X0','','Разовая','Фактически проведена','Проведена',3500,'','','','','','','','','','','Q-H'+i]));
  fill('Очередь подтверждения',14,Array.from({length:117*scale-10},(_,i)=>['Q-H'+i,old,'','','',old,old,'Fixture ПТ','CL-X0','Fixture','','Распознано','Проведена','Обработано','','','']));
  f.book.reads.length=0;
  f.context.getDmsConfirmedBusinessHash_();
  const wholeWorkbookCells=f.book.reads.reduce((n,r)=>n+r.height*r.width,0);
  f.book.reads.length=0;
  f.payload.acceptedRows=f.context.getDmsDayAcceptanceRows_(f.dateKey);
  const semanticCells=f.book.reads.reduce((n,r)=>n+r.height*r.width,0);
  assert.ok(semanticCells < wholeWorkbookCells * 0.65);
  f.book.reads.length=0;
  const result=f.context.confirmDmsMiniAppDay_(f.payload,'1001').confirmation;
  assert.equal(result.skipped,10);
  assert.equal(result.code,'day_confirmed');
  assert.ok(f.book.reads.length < 160);
  t.diagnostic(JSON.stringify({scale,wholeWorkbookCells,semanticCells,confirmationReadCalls:f.book.reads.length,
    confirmationReadCells:f.book.reads.reduce((n,r)=>n+r.height*r.width,0)}));
});

test('real day engine processes ten unchanged selected rows exactly once', () => {
  const f = realDayFixture();
  const result = f.context.confirmDmsMiniAppDay_(f.payload, '1001');
  assert.equal(result.confirmation.skipped, 10);
  assert.equal(f.queue.rows.slice(3).filter(r=>r[13]==='Обработано').length, 10);
  const writes = f.book.writes.length;
  assert.equal(f.context.confirmDmsMiniAppDay_(f.payload, '1001').confirmation.skipped, 10);
  assert.equal(f.book.writes.length, writes);
});

test('technical metadata and unrelated client changes preserve selected training intent', () => {
  const f = realDayFixture();
  f.queue.getRange(4, 15).setValue(new Date());
  f.queue.getRange(4, 16, 1, 2).setValues([['Calendar', 'health/sync metadata']]);
  f.book.sheets.get('Клиенты').getRange(6, 1, 1, 3).setValues([['CL-B','Unrelated','Активен']]);
  const result = f.context.confirmDmsMiniAppDay_(f.payload, '1001');
  assert.equal(result.confirmation.skipped, 10);
});

test('a new Q11 is a pending delta and never included in the accepted ten mutations', () => {
  const f = realDayFixture(); const added=[...f.row];
  added[0]='Q-11';added[12]='Отмена без списания';
  f.queue.getRange(14,1,1,17).setValues([added]);
  const result=f.context.confirmDmsMiniAppDay_(f.payload,'1001').confirmation;
  assert.equal(result.skipped,10);
  assert.deepEqual(Array.from(result.pendingQueueIds),['Q-11']);
  assert.equal(f.queue.getRange(14,14).getValue(),'Ожидает');
});

test('a changed Q5 blocks only that training while nine unchanged selections complete', () => {
  const f=realDayFixture();
  f.queue.getRange(8,9).setValue('CL-B');
  const result=f.context.confirmDmsMiniAppDay_(f.payload,'1001').confirmation;
  assert.equal(result.skipped,9);
  assert.deepEqual(Array.from(result.conflictQueueIds),['Q-5']);
  assert.equal(f.queue.getRange(8,14).getValue(),'Ожидает');
});

test('a pre-existing business blocker in Q5 does not prevent nine valid selected rows', () => {
  const f = realDayFixture();
  f.queue.getRange(8,13).setValue('');
  f.payload.acceptedRows = f.context.getDmsDayAcceptanceRows_(f.dateKey);
  const result = f.context.confirmDmsMiniAppDay_(f.payload, '1001').confirmation;
  assert.equal(result.code, 'day_partial');
  assert.equal(result.skipped, 9);
  assert.deepEqual(Array.from(result.conflictQueueIds), ['Q-5']);
  assert.equal(f.queue.getRange(8,14).getValue(), 'Ожидает');
});

test('real Telegram confirm-day button accepts and commits ten rows on its first click', () => {
  const f = realDayFixture(); const c = f.context; const edits = [];
  c.telegramEditMessage_ = (chat, message, text) => edits.push(text);
  c.telegramAnswerCallback_ = () => {};
  const markup = c.sealDmsTelegramDayView_(f.dateKey, {inline_keyboard:[[{callback_data:'qp:' + f.dateKey}]]});
  c.bindDmsTelegramDayView_(markup, '2002', '7');
  const query = {id:'day-click',data:markup.inline_keyboard[0][0].callback_data,from:{id:'1001'},
    message:{message_id:7,date:Math.floor(Date.now()/1000),chat:{id:'2002'}}};
  const result = c.acceptDmsTelegramDayView_(query);
  assert.equal(result.skipped, 10);
  assert.equal(edits.length, 1);
  assert.doesNotMatch(edits[0], /Защищённое одноразовое подтверждение/);
  const writes = f.book.writes.filter(w=>w.sheet==='Очередь подтверждения').length;
  assert.equal(c.acceptDmsTelegramDayView_(query).skipped, 10);
  assert.equal(f.book.writes.filter(w=>w.sheet==='Очередь подтверждения').length, writes);
});

for (const change of ['moved', 'cancelled', 'resized', 'reassigned', 'unchanged']) {
  test(`Calendar ${change} state is classified before accounting the selected rows`, () => {
    const f = realDayFixture(); const c = f.context;
    f.queue.getRange(8,3,1,2).setValues([['fixture-calendar','fixture-event']]);
    f.payload.acceptedRows = c.getDmsDayAcceptanceRows_(f.dateKey);
    c.getDmsConfirmationCalendarTargets_ = f.calendarTargets;
    c.assertDmsConfirmedCalendarCurrent_ = f.calendarPrecondition;
    const values = f.queue.getRange(8,1,1,17).getValues()[0];
    c.ScriptApp = {getOAuthToken:()=> 'fixture-token'};
    c.Calendar = {Events:{get:()=>({etag:'etag-2',status:change==='cancelled'?'cancelled':'confirmed',
      summary:change==='reassigned'?'Different client ПТ':values[7],
      start:{dateTime:new Date(values[5].getTime()+(change==='moved'?3600000:0)).toISOString()},
      end:{dateTime:new Date(values[6].getTime()+(change==='resized'?3600000:0)).toISOString()}})}};
    const result = c.confirmDmsMiniAppDay_(f.payload,'1001').confirmation;
    assert.equal(result.skipped,change==='unchanged'?10:9);
    assert.deepEqual(Array.from(result.conflictQueueIds),change==='unchanged'?[]:['Q-5']);
    assert.equal(f.queue.getRange(8,14).getValue(),change==='unchanged'?'Обработано':'Ожидает');
  });
}

test('confirming selected rows does not activate or close an unrelated block', () => {
  const f = realDayFixture();
  f.book.sheets.get('Блоки').getRange(4,1,1,12).setValues([
    ['BL-OTHER','CL-OTHER','Блок 5','Активен','','','',1,1,0,16000,3200]]);
  f.book.sheets.get('Журнал тренировок').getRange(4,1,1,8).setValues([
    ['TR-OTHER',new Date(),'CL-OTHER','BL-OTHER','Блок 5','Фактически проведена','Проведена',3200]]);
  f.book.sheets.get('Клиенты').getRange(6,1,1,4).setValues([
    ['CL-OTHER','Other','Активен','BL-OTHER']]);
  f.context.confirmDmsMiniAppDay_(f.payload,'1001');
  assert.equal(f.book.sheets.get('Блоки').getRange(4,4).getValue(),'Активен');
  assert.equal(f.book.sheets.get('Клиенты').getRange(6,4).getValue(),'BL-OTHER');
});

test('canonical day operation validates the accepted rows and owns one result shape', () => {
  const f = fixture(); const metrics = f.context.beginDmsOperationMetrics_('miniapp_confirm_day');
  const result = f.context.withTelegramDocumentLock_(() => f.context.executeDmsDayConfirmation_({
    dateKey: f.dateKey, source: 'MiniApp', acceptedRows: f.acceptedRows,
    calendarTargets: [], operationId: 'MOP-fixture'
  }, metrics));
  assert.deepEqual(domain(result), {
    code: 'day_confirmed', ref: f.dateKey, dateKey: f.dateKey, changed: true,
    total: 1, added: 1, skipped: 0, alreadyLogged: 0, blocked: 0,
    calendarDeleted: 1, calendarAlreadyMissing: 0, calendarFailed: 0,
  });
  assert.deepEqual(f.calls.map(call => call.kind),
    ['calendar-precondition', 'preflight', 'process', 'calendar']);
});

test('canonical day operation rejects a changed accepted set before preflight or mutation', () => {
  const f = fixture(); const metrics = f.context.beginDmsOperationMetrics_('miniapp_confirm_day');
  f.book.sheets.get('Очередь подтверждения').getRange(4, 13).setValue('Отмена без списания');
  const result = f.context.withTelegramDocumentLock_(() => f.context.executeDmsDayConfirmation_({
    dateKey: f.dateKey, source: 'MiniApp', acceptedRows: f.acceptedRows
  }, metrics));
  assert.equal(result.code, 'underlying_state_changed');
  assert.deepEqual(f.calls, []);
});

test('Telegram and MiniApp day transports expose the same canonical domain result', () => {
  const telegram = fixture(); const tc = telegram.context;
  tc.telegramAnswerCallback_ = () => {};
  tc.telegramEditMessage_ = () => {};
  tc.telegramAuditAction_ = () => {};
  const ticket = tc.createTelegramConfirmation_('1001', '2002', '7', 'confirm_day', {
    legacyData: 'qp:' + telegram.dateKey, sourceMessageId: '7', acceptedRows: telegram.acceptedRows
  });
  const telegramResult = tc.processTelegramSecureCallback_(
    {id: 'callback', from: {id: '1001'}, message: {message_id: 7, chat: {id: '2002'}}},
    tc.parseTelegramConfirmationCallback_(ticket.callbackData)
  );

  const miniApp = fixture(); const mc = miniApp.context; const revision = 'a'.repeat(43);
  mc.getDmsMiniAppBootstrap_ = () => ({today: {revision}});
  mc.getDmsConfirmationCalendarTargets_ = () => [];
  const miniAppResult = mc.confirmDmsMiniAppDay_({dateKey: miniApp.dateKey,
    revision, acceptedRows: miniApp.acceptedRows,
    operationId: '44444444-4444-4444-8444-444444444444'}, '1001').confirmation;
  assert.deepEqual(domain(telegramResult), domain(miniAppResult));
});

test('MiniApp day retry returns the exact durable result and changed request payload is rejected', () => {
  const f = fixture(); const c = f.context; const revision = 'b'.repeat(43);
  c.getDmsMiniAppBootstrap_ = () => ({today: {revision}});
  c.getDmsConfirmationCalendarTargets_ = () => [];
  const payload = {dateKey: f.dateKey, revision, acceptedRows: f.acceptedRows,
    operationId: '55555555-5555-4555-8555-555555555555'};
  const first = c.confirmDmsMiniAppDay_(payload, '1001').confirmation;
  const calls = f.calls.length;
  const replay = c.confirmDmsMiniAppDay_(payload, '1001').confirmation;
  assert.deepEqual(first, replay);
  assert.equal(f.calls.length, calls);
  assert.throws(() => c.confirmDmsMiniAppDay_({...payload, revision: 'c'.repeat(43)}, '1001'),
    /another operation/);
});

test('MiniApp day process death after durable start becomes manual review without execution replay', () => {
  const f = fixture(); const c = f.context; const revision = 'd'.repeat(43); let crashed = false;
  c.getDmsMiniAppBootstrap_ = () => ({today: {revision}});
  c.getDmsConfirmationCalendarTargets_ = () => [];
  const payload = {dateKey: f.dateKey, revision, acceptedRows: f.acceptedRows,
    operationId: '88888888-8888-4888-8888-888888888888'};
  f.book.hooks.after = event => {
    if (!crashed && event.sheet === 'Журнал операций Telegram' && event.values[0][4] === 'started') {
      crashed = true; throw new Error('injected process death');
    }
  };
  assert.throws(() => c.confirmDmsMiniAppDay_(payload, '1001'), /injected/);
  f.book.hooks.after = null;
  assert.throws(() => c.confirmDmsMiniAppDay_(payload, '1001'),
    error => error.dmsCode === 'operation_manual_review');
  assert.deepEqual(f.calls, []);
});
