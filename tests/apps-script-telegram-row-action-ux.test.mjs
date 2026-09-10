import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

const ledgerHeaders = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v1/schema.json'))
  .sheet.columns.map(column => column.name)
  .concat(['Protocol', 'Ticket JSON', 'Payload JSON', 'Result JSON']);

function queueRow(id, date) {
  return [id, date, '', '', '', date, new Date(date.getTime() + 3600000),
    'Fixture A ПТ', 'CL-A', 'Fixture A', '', 'Распознано', '', 'Ожидает', '', '', ''];
}

function fixture({date = new Date(), secondDate = date} = {}) {
  const book = memoryWorkbook({
    'Клиенты': [[], [], [], [], ['CL-A', 'Fixture A', 'Активен', '', '', 0, 0, 0, 0, 0, 'Разовые — 3500 ₽']],
    'Оплаты': [[], [], ['ID']],
    'Журнал действий бота': [['ID']],
    'Журнал операций Telegram': [ledgerHeaders],
    'Журнал тренировок': [[], [], ['ID']],
    'Блоки': [[], [], ['ID']],
    'Очередь подтверждения': [[], [], ['ID'], queueRow('Q-1', date), queueRow('Q-2', secondDate)],
    'Настройки': [['Key', 'Value']],
  });
  const shared = new Map([
    ['DMS_TG_WEBHOOK_SECRET', 'fixture-webhook'],
    ['DMS_TG_ADMIN_USER_IDS', '1001'],
    ['DMS_TG_CHAT_ID', '2002'],
    ['DMS_TG_BOT_TOKEN', 'fixture'],
  ]);
  const props = {
    getProperty: key => shared.get(key) ?? null,
    setProperty: (key, value) => shared.set(key, String(value)),
    getProperties: () => Object.fromEntries(shared),
    deleteProperty: key => shared.delete(key),
  };
  let locked = false;
  const ui = {answers: [], edits: [], refreshes: [], moves: []};
  const newExecution = () => {
    const context = loadBundle('stabilization', {
      SpreadsheetApp: book.service,
      PropertiesService: {getScriptProperties: () => props, getDocumentProperties: () => null},
      LockService: {getDocumentLock: () => null, getScriptLock: () => ({
        tryLock: () => {if (locked) return false; locked = true; return true;},
        releaseLock: () => {assert.equal(locked, true); locked = false;},
      })},
      UrlFetchApp: {fetch: () => ({getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})})},
    }).context;
    context.telegramAnswerCallback_ = (id, text, alert) => ui.answers.push({id, text, alert});
    context.telegramEditMessage_ = (chatId, messageId, text) => ui.edits.push({chatId, messageId, text});
    context.refreshTelegramQueueMessage_ = (chatId, messageId, rowDate) =>
      ui.refreshes.push({chatId, messageId, rowDate});
    context.startTelegramMove_ = (userId, chatId, messageId, item) =>
      ui.moves.push({userId, chatId, messageId, item});
    context.getDmsMiniAppBootstrap_ = () => ({fixture: true});
    return context;
  };
  const context = newExecution();
  const dayKey = context.makeDateKey_(secondDate, 'Europe/Moscow');
  const markup = context.sealDmsTelegramDayView_(dayKey, {inline_keyboard: [
    ['done','charge','free','move'].map(action=>({callback_data:'qd:Q-2:'+action}))
  ]});
  context.bindDmsTelegramDayView_(markup, '2002', '7');
  const query = action => ({id: 'callback-' + action, data: markup.inline_keyboard[0][['done','charge','free','move'].indexOf(action)].callback_data,
    from: {id: '1001'}, message: {message_id: 7, date: Math.floor(Date.now() / 1000),
      text: 'Вчера / Сегодня', chat: {id: '2002'}}});
  const queue = book.sheets.get('Очередь подтверждения');
  const semanticRevision = context.getDmsQueueSemanticRevision_(queue.getRange(5,1,1,17).getValues()[0], context.getDmsQueueSemanticContext_());
  return {book, context, newExecution, query, queue, ui, markup, semanticRevision, isLocked: () => locked};
}

const decisions = {
  done: 'Проведена',
  charge: 'Отмена со списанием',
  free: 'Отмена без списания',
  move: 'Перенос',
};

test('rendered callback has no editable row/action and a forged capability fails closed', () => {
  const f = fixture(); const query = f.query('free');
  assert.match(query.data, /^qv:[a-f0-9]{24}:[a-f0-9]{24}$/);
  assert.ok(Buffer.byteLength(query.data) <= 64);
  query.data = query.data.slice(0, -24) + '0'.repeat(24);
  f.context.handleTelegramCallback_(query);
  assert.equal(f.queue.getRange(5, 13).getValue(), '');
  assert.equal(f.book.sheets.get('Журнал операций Telegram').getLastRow(), 1);
});

test('Telegram refresh follows durable commit outside the lock and network retry does not repeat the effect', () => {
  const f = fixture(); const query = f.query('free'); let fail = true;
  f.context.refreshTelegramQueueMessage_ = () => {
    assert.equal(f.isLocked(), false);
    assert.equal(f.book.sheets.get('Журнал операций Telegram').rows.at(-1)[4], 'committed');
    if (fail) {fail = false; throw new Error('Telegram network unavailable');}
  };
  f.context.handleTelegramCallback_(query);
  const writes = f.book.writes.filter(w => w.sheet === 'Очередь подтверждения').length;
  f.context.handleTelegramCallback_(query);
  assert.equal(f.book.writes.filter(w => w.sheet === 'Очередь подтверждения').length, writes);
});

for (const [action, expected] of Object.entries(decisions)) {
  test(`Telegram qd:${action} accepts and applies the exact row in one click`, () => {
    const f = fixture();
    f.context.handleTelegramCallback_(f.query(action));
    assert.equal(f.queue.getRange(4, 13).getValue(), '');
    assert.equal(f.queue.getRange(5, 13).getValue(), expected);
    assert.match(f.queue.getRange(5, 17).getDisplayValue(), /^\[tgop:TGOP-/);
    assert.equal(f.ui.edits.some(item => /Защищённое одноразовое подтверждение/.test(item.text)), false);
    assert.equal(action === 'move' ? f.ui.moves.length : f.ui.refreshes.length, 1);
    assert.equal(f.ui.answers.at(-1).text, 'Готово');
  });
}

test('replay of the original row callback consumes its new ticket without a second queue effect', () => {
  const f = fixture(); const query = f.query('free');
  f.context.handleTelegramCallback_(query);
  const marker = f.queue.getRange(5, 17).getDisplayValue();
  const queueWrites = () => f.book.writes.filter(write => write.sheet === 'Очередь подтверждения').length;
  const before = queueWrites();
  f.context.handleTelegramCallback_({...query, id: 'callback-replay'});
  assert.equal(queueWrites(), before);
  assert.equal(f.queue.getRange(5, 13).getValue(), 'Отмена без списания');
  assert.equal(f.queue.getRange(5, 17).getDisplayValue(), marker);
  const lifecycle = f.book.sheets.get('Журнал операций Telegram').rows.slice(1).map(row => row[4]);
  assert.ok(lifecycle.includes('ticket_consumed'));
});

test('accepted row/action is immutable and bound to admin, chat and source message', () => {
  const f = fixture(); const c = f.context;
  const payload = {legacyData: 'qd:Q-2:free', sourceMessageId: '7',
    state: {secureFlowId: 'explicit_callback|7|qd:Q-2:free'}};
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'queue_decision', payload);
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  const changedDataQuery = f.query('done');
  assert.equal(c.processTelegramSecureCallback_(changedDataQuery, parsed).ref, 'Q-2');
  assert.equal(f.queue.getRange(4, 13).getValue(), '');
  assert.equal(f.queue.getRange(5, 13).getValue(), 'Отмена без списания');

  const other = fixture(); const otherTicket = other.context.createTelegramConfirmation_(
    '1001', '2002', '7', 'queue_decision', payload
  );
  const wrongMessage = other.query('free'); wrongMessage.message.message_id = 8;
  assert.throws(() => other.context.processTelegramSecureCallback_(wrongMessage,
    other.context.parseTelegramConfirmationCallback_(otherTicket.callbackData)), /identity differs/);
  assert.equal(other.queue.getRange(5, 13).getValue(), '');
});

test('expired secure acceptance and stale row callback both fail closed', () => {
  const f = fixture(); const c = f.context; const issuedAt = Date.now() - 3600000;
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'queue_decision', {
    legacyData: 'qd:Q-2:free', sourceMessageId: '7',
    state: {secureFlowId: 'explicit_callback|7|qd:Q-2:free'}
  }, issuedAt);
  assert.throws(() => c.processTelegramSecureCallback_(f.query('free'),
    c.parseTelegramConfirmationCallback_(ticket.callbackData), Date.now()), /истёк/);
  assert.equal(f.queue.getRange(5, 13).getValue(), '');

  const stale = fixture({secondDate: new Date(Date.now() - 3 * 86400000)});
  stale.context.handleTelegramCallback_(stale.query('free'));
  assert.equal(stale.queue.getRange(5, 13).getValue(), '');
  assert.match(stale.ui.answers.at(-1).text, /устарела/);

  const oldMessage = fixture(); const oldQuery = oldMessage.query('free');
  oldQuery.message.date = Math.floor((Date.now() - 3600000) / 1000);
  oldMessage.context.handleTelegramCallback_(oldQuery);
  assert.equal(oldMessage.queue.getRange(5, 13).getValue(), '');
  assert.match(oldMessage.ui.answers.at(-1).text, /устарела/);
});

test('concurrent row callbacks cannot create a double queue mutation', () => {
  const f = fixture(); const competing = f.newExecution(); let attempted = false;
  f.book.hooks.after = event => {
    if (!attempted && event.sheet === 'Очередь подтверждения' && event.col === 13) {
      attempted = true;
      assert.equal(f.isLocked(), true);
      competing.handleTelegramCallback_({...f.query('free'), id: 'callback-concurrent'});
    }
  };
  f.context.handleTelegramCallback_(f.query('free'));
  assert.equal(attempted, true);
  assert.equal(f.book.writes.filter(write => write.sheet === 'Очередь подтверждения' && write.col === 13).length, 1);
  assert.equal(f.queue.getRange(5, 13).getValue(), 'Отмена без списания');
});

test('changed underlying state after acceptance is rejected before the row mutation', () => {
  const f = fixture(); const c = f.context;
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'queue_decision', {
    legacyData: 'qd:Q-2:free', sourceMessageId: '7',
    state: {secureFlowId: 'explicit_callback|7|qd:Q-2:free'}
  });
  f.queue.getRange(4, 10).setValue('Externally changed');
  const before = f.book.writes.filter(write => write.sheet === 'Очередь подтверждения').length;
  const result = c.processTelegramSecureCallback_(f.query('free'),
    c.parseTelegramConfirmationCallback_(ticket.callbackData));
  assert.equal(result.code, 'underlying_state_changed');
  assert.equal(f.queue.getRange(5, 13).getValue(), '');
  assert.equal(f.book.writes.filter(write => write.sheet === 'Очередь подтверждения').length, before);
});

test('Telegram and MiniApp receive the same queue-decision domain result', () => {
  const telegram = fixture();
  const telegramResult = telegram.context.acceptTelegramMutationOnOriginalCallback_(
    telegram.query('charge'), telegram.context.describeTelegramLegacyMutation_('qd:Q-2:charge'), 'qd:Q-2:charge'
  );
  const miniApp = fixture();
  const miniAppResult = miniApp.context.setDmsMiniAppQueueDecision_({
    queueId: 'Q-2', decision: 'charge', expectedDecision: '', expectedStatus: 'Ожидает', semanticRevision: miniApp.semanticRevision,
    operationId: '11111111-1111-4111-8111-111111111111'
  }, '1001').mutation;
  const domainKeys = ['code', 'ref', 'changed', 'queueId', 'decision', 'notice'];
  assert.deepEqual(Object.fromEntries(domainKeys.map(key => [key, telegramResult[key]])),
    Object.fromEntries(domainKeys.map(key => [key, miniAppResult[key]])));
});

test('MiniApp queue retry returns its durable result without a second effect', () => {
  const f = fixture();
  const payload = {queueId: 'Q-2', decision: 'free', expectedDecision: '', expectedStatus: 'Ожидает', semanticRevision: f.semanticRevision,
    operationId: '22222222-2222-4222-8222-222222222222'};
  const first = f.context.setDmsMiniAppQueueDecision_(payload, '1001').mutation;
  const queueWrites = () => f.book.writes.filter(write => write.sheet === 'Очередь подтверждения').length;
  const before = queueWrites();
  const replay = f.context.setDmsMiniAppQueueDecision_(payload, '1001').mutation;
  assert.deepEqual(first, replay);
  assert.equal(queueWrites(), before);
  assert.throws(() => f.context.setDmsMiniAppQueueDecision_({...payload, decision: 'charge'}, '1001'),
    /another operation/);
});

test('MiniApp queue crash after its durable row marker recovers without replaying the write', () => {
  const f = fixture(); let crashed = false;
  const payload = {queueId: 'Q-2', decision: 'free', expectedDecision: '', expectedStatus: 'Ожидает', semanticRevision: f.semanticRevision,
    operationId: '33333333-3333-4333-8333-333333333333'};
  f.book.hooks.after = event => {
    if (!crashed && event.sheet === 'Очередь подтверждения' && event.col === 17) {
      crashed = true; throw new Error('injected process death');
    }
  };
  assert.throws(() => f.context.setDmsMiniAppQueueDecision_(payload, '1001'), /injected/);
  f.book.hooks.after = null;
  const decisionWrites = () => f.book.writes.filter(write =>
    write.sheet === 'Очередь подтверждения' && write.col === 13).length;
  const before = decisionWrites();
  const recovered = f.context.setDmsMiniAppQueueDecision_(payload, '1001').mutation;
  assert.equal(recovered.code, 'queue_decision_saved');
  assert.equal(decisionWrites(), before);
});

test('MiniApp queue accepted state change and concurrent delivery fail closed', () => {
  const changed = fixture();
  changed.queue.getRange(5, 13).setValue('Проведена');
  const changedPayload = {queueId: 'Q-2', decision: 'free', expectedDecision: '', expectedStatus: 'Ожидает', semanticRevision: changed.semanticRevision,
    operationId: '66666666-6666-4666-8666-666666666666'};
  assert.throws(() => changed.context.setDmsMiniAppQueueDecision_(changedPayload, '1001'),
    error => error.dmsCode === 'underlying_state_changed');
  assert.equal(changed.queue.getRange(5, 13).getValue(), 'Проведена');

  const concurrent = fixture(); const other = concurrent.newExecution(); let attempted = false;
  const payload = {queueId: 'Q-2', decision: 'free', expectedDecision: '', expectedStatus: 'Ожидает', semanticRevision: concurrent.semanticRevision,
    operationId: '77777777-7777-4777-8777-777777777777'};
  concurrent.book.hooks.after = event => {
    if (!attempted && event.sheet === 'Журнал операций Telegram' && event.values[0][4] === 'started') {
      attempted = true;
      assert.throws(() => other.setDmsMiniAppQueueDecision_(payload, '1001'),
        error => error.dmsCode === 'operation_busy');
    }
  };
  concurrent.context.setDmsMiniAppQueueDecision_(payload, '1001');
  assert.equal(attempted, true);
  assert.equal(concurrent.book.writes.filter(write =>
    write.sheet === 'Очередь подтверждения' && write.col === 13).length, 1);
});

test('only final explicit-intent callbacks bypass a visible second confirmation', () => {
  const f = fixture(); const describe = f.context.describeTelegramLegacyMutation_;
  for (const action of Object.keys(decisions)) {
    assert.equal(describe('qd:Q-2:' + action).acceptOnCallback, true);
  }
  for (const callback of ['mgc:CL-A:BL-A:10', 'mpc:CL-A:BL-A', 'mrc:CL-A:BL-A',
    'mclc:CL-A:BL-A', 'ops:undoYes:TGE-1', 'ops:archiveYes:CL-A', 'ops:restoreYes:CL-A',
    'ops:voidPaymentYes:OP-1']) {
    assert.equal(describe(callback).acceptOnCallback, true);
  }
  for (const callback of ['qp:2026-09-10', 'ops:toggle:morning', 'ops:backup']) {
    assert.equal(describe(callback).acceptOnCallback, false);
  }
});
