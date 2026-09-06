import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

const headers = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v1/schema.json'))
  .sheet.columns.map(c => c.name);

export function paymentFixture(candidate = 'v50') {
  const book = memoryWorkbook({
    'Клиенты': [[], [], [], [], ['CL-A', 'Fixture A', 'Активен', '', '', 0, 0, 0, 0, 0, 'Разовые — 3500']],
    'Оплаты': [[], [], ['ID']], 'Журнал действий бота': [['ID']],
    'Журнал операций Telegram': [headers], 'Журнал тренировок': [[], [], ['ID']],
  });
  // Explicitly model the document-bound context to expose the latent race beyond
  // the separately reproduced web-app null lock. This is not a production lock.
  const fixture = loadBundle(candidate, {SpreadsheetApp: book.service,
    LockService: {getDocumentLock: () => ({tryLock: () => true, releaseLock() {}})},
    UrlFetchApp: {fetch: () => ({getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})})},
  });
  fixture.properties.set('DMS_TG_BOT_TOKEN', 'fixture');
  const c = fixture.context;
  const state = {phase: 'confirm', clientId: 'CL-A', clientName: 'Fixture A', blockId: '', amount: 100, method: 'Перевод'};
  c.putTelegramPaymentState_('1001', '2002', state);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'payment',
    c.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', state));
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  const query = {id: 'query', from: {id: '1001'}, message: {message_id: 7, chat: {id: '2002'}}};
  return {...fixture, book, state, ticket, parsed, query};
}

test('P1 lock reproduction: full web-app bundle receives null DocumentLock', () => {
  const f = loadBundle('v50');
  let executed = false;
  assert.throws(() => f.context.withTelegramDocumentLock_(() => {executed = true;}), /null/);
  assert.equal(executed, false);
});

test('P1.2 reproduction: accept payment A, session B replaces actual business amount', () => {
  const f = paymentFixture();
  const accepted = f.context.withTelegramDocumentLock_(() =>
    f.context.beginTelegramSecureOperation_(f.parsed, f.query));
  f.context.putTelegramPaymentState_('1001', '2002', {...f.state, amount: 999});
  f.context.executeTelegramSecureMutation_(accepted.validated);
  assert.equal(f.book.sheets.get('Оплаты').rows[3][6], 999);
});

test('P1.4 reproduction: crash after pending leaves replay permanently in progress', () => {
  const f = paymentFixture();
  f.context.beginTelegramSecureOperation_(f.parsed, f.query);
  const retry = f.context.processTelegramSecureCallback_(f.query, f.parsed);
  assert.equal(retry.pending, true);
  assert.equal(f.book.sheets.get('Оплаты').getLastRow(), 3);
  assert.equal(f.context.findTelegramOperationResult_(f.context.getTelegramConfirmationState_(f.ticket.id).operationId).status, 'pending');
});

test('P1.3 reproduction: undo clears a Client already referenced by Journal', () => {
  const f = paymentFixture();
  f.book.sheets.get('Журнал тренировок').getRange(4, 1, 1, 4).setValues([['J-1', new Date(), 'CL-A', '']]);
  f.context.applyTelegramUndoPayload_({type: 'clear_range', sheet: 'Клиенты', row: 5, column: 1, rows: 1, columns: 14});
  assert.equal(f.book.sheets.get('Клиенты').getRange(5, 1).getValue(), '');
  assert.equal(f.book.sheets.get('Журнал тренировок').getRange(4, 3).getValue(), 'CL-A');
});

test('P1.5 reproduction: revoked ticket lifecycles retain every property', () => {
  const f = paymentFixture();
  for (let i = 0; i < 2000; i++) {
    const ticket = f.context.createTelegramConfirmation_('1001', '2002', '7', 'payment', {index: i});
    f.context.revokeTelegramConfirmationById_(ticket.id, 'cancel');
  }
  const tickets = [...f.properties.entries()].filter(([key]) => key.startsWith('DMS_TG_CF_'));
  assert.equal(tickets.length, 2001);
  assert.ok(tickets.reduce((bytes, [k, v]) => bytes + Buffer.byteLength(k + v), 0) > 500000);
});
