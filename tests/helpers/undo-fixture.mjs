import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadBundle} from './apps-script-bundle.mjs';
import {memoryWorkbook} from './memory-workbook.mjs';

export function undoFixture({paid = false, block = true, onWrite} = {}) {
  const initial = {'Клиенты': [[], [], [], ['ID']], 'Блоки': [[], [], ['ID']],
    'Оплаты': [[], [], ['ID']], 'Журнал тренировок': [[], [], ['ID']],
    'Очередь подтверждения': [[], [], ['ID']], 'Настройки': [['Key', 'Value']],
    'Журнал действий бота': [['ID']], 'Доступ клиентов': [['ID']], 'Замеры': [['ID']],
    'Приглашения Client Portal': [['ID']],
    'Журнал операций Telegram': [JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v2/schema.json')).sheet.columns.map(c => c.name)]};
  const book = memoryWorkbook(initial);
  if (onWrite) book.hooks.before = onWrite;
  let locked = false;
  const shared = new Map([['DMS_TG_ADMIN_USER_IDS', '1001'], ['DMS_TG_CHAT_ID', '2002'], ['DMS_TG_BOT_TOKEN', 'fixture']]);
  const props = {getProperty: k => shared.get(k) ?? null, setProperty: (k, v) => shared.set(k, String(v)),
    getProperties: () => Object.fromEntries(shared), deleteProperty: k => shared.delete(k)};
  const create = () => loadBundle('v51', {SpreadsheetApp: book.service,
    PropertiesService: {getScriptProperties: () => props, getDocumentProperties: () => null},
    UrlFetchApp: {fetch: () => ({getResponseCode: () => 200, getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})})},
    LockService: {getDocumentLock: () => null, getScriptLock: () => ({
      tryLock: () => {if (locked) return false; locked = true; return true;},
      releaseLock: () => {assert.ok(locked); locked = false;},
    })}}).context;
  const c = create(); const queue = book.sheets.get('Очередь подтверждения');
  const start = new Date('2026-09-05T08:00:00Z');
  const values = ['Q-1', start, '', '', '', start, new Date(start.getTime() + 3600000),
    'Fixture New ПТ', '', '', '', 'Требует регистрации', '', 'Требует регистрации', '', '', ''];
  queue.appendRow(values);
  const preview = {client: {name: 'Fixture New'}, product: block
    ? {code: 'block10', count: 10, price: 30000, format: 'Блок 10', support: 0}
    : {code: 'single', count: 0, price: 3500, format: 'Разовая'},
    payment: {paid, amount: 30000, method: 'Перевод', dateKey: '2026-09-05'}};
  const result = c.withTelegramDocumentLock_(() => c.applyDmsCalendarOnboardingNewClient_(book.workbook,
    {sheet: queue, row: 4, queueId: 'Q-1', values}, preview, 'fixture-admin'));
  return {book, context: c, result, initial, create, originalQueue: values,
    undo: () => c.performTelegramUndo_(result.auditId)};
}
