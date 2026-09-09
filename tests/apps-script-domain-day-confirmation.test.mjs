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
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10);
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
  return {book, context, calls, dateKey, acceptedRows};
}

function domain(result) {
  const keys = ['code', 'ref', 'dateKey', 'changed', 'total', 'added', 'skipped',
    'alreadyLogged', 'blocked', 'calendarDeleted', 'calendarAlreadyMissing', 'calendarFailed'];
  return Object.fromEntries(keys.map(key => [key, result[key]]));
}

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

  const miniApp = fixture(); const mc = miniApp.context; const revision = 'a'.repeat(64);
  mc.getDmsMiniAppBootstrap_ = () => ({today: {revision}});
  mc.getDmsConfirmationCalendarTargets_ = () => [];
  const miniAppResult = mc.confirmDmsMiniAppDay_({dateKey: miniApp.dateKey,
    revision, acceptedRows: miniApp.acceptedRows,
    operationId: '44444444-4444-4444-8444-444444444444'}, '1001').confirmation;
  assert.deepEqual(domain(telegramResult), domain(miniAppResult));
});

test('MiniApp day retry returns the exact durable result and changed request payload is rejected', () => {
  const f = fixture(); const c = f.context; const revision = 'b'.repeat(64);
  c.getDmsMiniAppBootstrap_ = () => ({today: {revision}});
  c.getDmsConfirmationCalendarTargets_ = () => [];
  const payload = {dateKey: f.dateKey, revision, acceptedRows: f.acceptedRows,
    operationId: '55555555-5555-4555-8555-555555555555'};
  const first = c.confirmDmsMiniAppDay_(payload, '1001').confirmation;
  const calls = f.calls.length;
  const replay = c.confirmDmsMiniAppDay_(payload, '1001').confirmation;
  assert.deepEqual(first, replay);
  assert.equal(f.calls.length, calls);
  assert.throws(() => c.confirmDmsMiniAppDay_({...payload, revision: 'c'.repeat(64)}, '1001'),
    /another operation/);
});

test('MiniApp day process death after durable start becomes manual review without execution replay', () => {
  const f = fixture(); const c = f.context; const revision = 'd'.repeat(64); let crashed = false;
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
