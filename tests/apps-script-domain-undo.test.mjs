import assert from 'node:assert/strict';
import test from 'node:test';
import {undoFixture} from './helpers/undo-fixture.mjs';

function noDangling(f) {
  const clients = new Set(f.book.sheets.get('Клиенты').rows.slice(4).map(r => r[0]));
  const blocks = new Set(f.book.sheets.get('Блоки').rows.slice(3).map(r => r[0]));
  for (const [name, start, clientCol, blockCol] of [
    ['Блоки', 3, 1, null], ['Оплаты', 3, 2, 3], ['Журнал тренировок', 3, 2, 3], ['Очередь подтверждения', 3, 8, 10]]) {
    for (const row of f.book.sheets.get(name).rows.slice(start)) {
      if (row[clientCol]) assert.ok(clients.has(row[clientCol]), name + ' missing client');
      if (blockCol !== null && row[blockCol]) assert.ok(blocks.has(row[blockCol]), name + ' missing block');
    }
  }
}

for (const paid of [false, true]) test('P1.3 actual onboarding → immediate undo retains IDs and history; paid=' + paid, () => {
  const f = undoFixture({paid});
  f.undo();
  assert.equal(f.book.sheets.get('Клиенты').getRange(5, 3).getValue(), 'Архив');
  assert.equal(f.book.sheets.get('Блоки').getRange(4, 4).getValue(), 'Закрыт');
  if (paid) assert.equal(f.book.sheets.get('Оплаты').getRange(4, 8).getValue(), 'Отменён');
  assert.deepEqual(f.book.sheets.get('Очередь подтверждения').getRange(4, 1, 1, 17).getValues()[0], f.originalQueue);
  const writes = f.book.writes.length;
  assert.throws(() => f.undo(), /уже отменено/);
  assert.equal(f.book.writes.length, writes); noDangling(f);
});

for (const downstream of ['Journal', 'Payment', 'Block', 'changed original', 'portal']) {
  test('P1.3 onboarding → ' + downstream + ' → undo fails before any write', () => {
    const f = undoFixture(); const id = f.result.clientId;
    if (downstream === 'Journal') f.book.sheets.get('Журнал тренировок').appendRow(['TR-1', '', id, 'BL-001']);
    if (downstream === 'Payment') f.book.sheets.get('Оплаты').appendRow(['PAY-1', '', id, 'BL-001']);
    if (downstream === 'Block') f.book.sheets.get('Блоки').appendRow(['BL-002', id, 'Блок 10', 'Активен']);
    if (downstream === 'changed original') f.book.sheets.get('Клиенты').getRange(5, 2).setValue('Changed name');
    if (downstream === 'portal') f.book.sheets.get('Доступ клиентов').appendRow(['BND-1', '1001', id, 'active']);
    const writes = f.book.writes.length;
    assert.throws(() => f.undo(), /state changed|portal history/);
    assert.equal(f.book.writes.length, writes); noDangling(f);
  });
}

test('P1.3 competing execution cannot mutate while undo owns the shared lock', () => {
  const f = undoFixture(); const other = f.create(); let attempted = false;
  f.book.hooks.before = () => {
    if (attempted) return; attempted = true;
    assert.throws(() => other.withTelegramDocumentLock_(() => {
      f.book.sheets.get('Оплаты').appendRow(['PAY-race', '', f.result.clientId, 'BL-001']);
    }), /Другое действие/);
  };
  f.undo(); assert.ok(attempted); noDangling(f);
});

test('P1.3 legacy range payload and changed audit identity fail closed', () => {
  const f = undoFixture(); const audit = f.book.sheets.get('Журнал действий бота');
  const values = audit.getRange(2, 1, 1, 8).getValues()[0];
  audit.getRange(2, 3).setValue('different_action');
  assert.throws(() => f.undo(), /identity differs/);
  audit.getRange(2, 3).setValue(values[2]);
  audit.getRange(2, 6).setValue(JSON.stringify({type: 'clear_range', sheet: 'Клиенты', row: 5, column: 1, rows: 1, columns: 14}));
  const writes = f.book.writes.length;
  assert.throws(() => f.undo(), /Legacy/); assert.equal(f.book.writes.length, writes); noDangling(f);
});

for (const fault of [false, true]) test('P1.3 confirmed undo survives replay across VM restart; injected fault=' + fault, () => {
  const f = undoFixture({paid: true}); const c = f.context;
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'undo', {legacyData: 'ops:undoYes:' + f.result.auditId});
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  const query = {id: 'fixture-query', from: {id: '1001'}, message: {message_id: 7, chat: {id: '2002'}}};
  f.book.hooks.after = event => {if (fault && event.sheet === 'Оплаты') throw new Error('undo fault');};
  if (fault) assert.throws(() => c.processTelegramSecureCallback_(query, parsed), /undo fault/);
  else assert.equal(c.processTelegramSecureCallback_(query, parsed).code, 'undo_completed');
  f.book.hooks.after = null;
  const restarted = f.create(); const writes = f.book.writes.length;
  const result = restarted.processTelegramSecureCallback_(query, parsed);
  assert.equal(result.code, fault ? 'mutation_outcome_unknown' : 'undo_completed');
  if (!fault) assert.equal(f.book.writes.length, writes);
  noDangling(f);
});
