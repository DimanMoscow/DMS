import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';
import {memoryWorkbook} from './helpers/memory-workbook.mjs';

const headers = JSON.parse(fs.readFileSync('apps-script/migrations/telegram-confirmations-v1/schema.json'))
  .sheet.columns.map(c => c.name).concat(['Protocol', 'Ticket JSON', 'Payload JSON', 'Result JSON']);

function fixture() {
  const book = memoryWorkbook({
    'Клиенты': [[], [], [], [], ['CL-A', 'Fixture A', 'Активен', '', '', 0, 0, 0, 0, 0, 'Разовые — 3500 ₽']],
    'Оплаты': [[], [], ['ID']], 'Журнал действий бота': [['ID']],
    'Журнал операций Telegram': [headers], 'Журнал тренировок': [[], [], ['ID']],
    'Блоки': [[], [], ['ID']], 'Очередь подтверждения': [[], [], ['ID']], 'Настройки': [['Key', 'Value']],
  });
  const shared = new Map([
    ['DMS_TG_WEBHOOK_SECRET', 'fixture-webhook'], ['DMS_TG_ADMIN_USER_IDS', '1001'],
    ['DMS_TG_CHAT_ID', '2002'], ['DMS_TG_BOT_TOKEN', 'fixture'],
  ]);
  const props = {getProperty: k => shared.get(k) ?? null, setProperty: (k, v) => shared.set(k, String(v)),
    getProperties: () => Object.fromEntries(shared), deleteProperty: k => shared.delete(k)};
  let locked = false; let acquisitions = 0; let releases = 0;
  const telegram = {fail: false};
  const extras = {};
  const newExecution = () => loadBundle('v51', {
    SpreadsheetApp: book.service,
    PropertiesService: {getScriptProperties: () => props, getDocumentProperties: () => null},
    LockService: {getDocumentLock: () => null, getScriptLock: () => ({
      tryLock: () => {if (locked) return false; locked = true; acquisitions++; return true;},
      releaseLock: () => {assert.equal(locked, true); locked = false; releases++;},
    })},
    UrlFetchApp: {fetch: () => {
      if (telegram.fail) throw new Error('transport failure');
      return {getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})};
    }},
    ...extras,
  }).context;
  let c = newExecution();
  const state = {phase: 'confirm', clientId: 'CL-A', clientName: 'Fixture A', blockId: '', amount: 100, method: 'Перевод'};
  c.putTelegramPaymentState_('1001', '2002', state);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'payment',
    c.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', state));
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  const query = {id: 'query', from: {id: '1001'}, message: {message_id: 7, chat: {id: '2002'}}};
  return {book, state, ticket, parsed, query, shared, props, telegram, extras, newExecution,
    get context() {return c;}, restart: () => {c = newExecution(); return c;},
    locks: () => ({locked, acquisitions, releases}),
    pay: () => c.processTelegramSecureCallback_(query, parsed),
    payments: () => book.sheets.get('Оплаты').rows.slice(3).filter(r => r[0]),
  };
}

test('P1.2 full bundle executes immutable A after session becomes B', () => {
  const f = fixture();
  f.context.putTelegramPaymentState_('1001', '2002', {...f.state, amount: 999});
  assert.equal(f.pay().code, 'payment_recorded');
  assert.equal(f.payments()[0][6], 100);
  assert.ok(f.pay().ref);
  assert.equal(f.payments().length, 1);
});

function addCalendar(f) {
  const events = new Map(); const calls = [];
  const faults = {afterInsert: false, racePatch: false};
  f.book.sheets.get('Настройки').getRange(14, 1, 2, 2).setValues([
    ['Календарь для учёта', 'fixture-calendar'], ['Начало автоматического учёта', new Date('2026-01-01')],
  ]);
  f.book.sheets.get('Клиенты').getRange(5, 13).setValue('Fixture A ПТ');
  const Calendar = {Events: {
    get: (_, id) => {if (!events.has(id)) throw new Error('Not Found'); return structuredClone(events.get(id));},
    list: (_, params) => ({items: params.privateExtendedProperty
      ? [...events.values()].filter(e => 'dmsOperationId=' + e.extendedProperties?.private?.dmsOperationId === params.privateExtendedProperty)
      : []}),
    insert: resource => {
      if (events.has(resource.id)) throw new Error('Already exists (409)');
      calls.push({method: 'insert', id: resource.id});
      events.set(resource.id, {...structuredClone(resource), etag: 'version-1'});
      if (faults.afterInsert) throw new Error('injected Calendar transport failure');
      return structuredClone(events.get(resource.id));
    },
    patch: () => {throw new Error('Unconditional Calendar mutation forbidden');},
    remove: () => {throw new Error('Unconditional Calendar mutation forbidden');},
  }};
  const UrlFetchApp = {fetch: (url, options) => {
    if (url.startsWith('https://api.telegram.org/')) return {getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ok: true, result: {message_id: 7}})};
    const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const event = events.get(id);
    if (faults.racePatch) {event.etag = 'external-version'; event.summary = 'External update';}
    if (!event || options.headers['If-Match'] !== event.etag) {
      return {getResponseCode: () => 412, getContentText: () => '{}'};
    }
    calls.push({method: options.method, id, etag: options.headers['If-Match']});
    if (options.method === 'delete') events.delete(id);
    else events.set(id, {...event, ...JSON.parse(options.payload), etag: 'version-2'});
    return {getResponseCode: () => 200, getContentText: () => options.method === 'delete' ? '' : JSON.stringify(events.get(id))};
  }};
  Object.assign(f.extras, {Calendar, UrlFetchApp, ScriptApp: {getOAuthToken: () => 'fixture-access'}});
  Object.assign(f.context, f.extras);
  return {events, calls, faults};
}

test('P1.2/P1.4 full Calendar-create bundle recovers durable event across fresh execution', () => {
  const f = fixture(); const calendar = addCalendar(f); const c = f.context;
  const state = {phase: 'confirm', clientId: 'CL-A', clientName: 'Fixture A',
    calendarTitle: 'Fixture A ПТ', startMs: Date.now() + 86400000, duration: 60};
  c.putTelegramScheduleState_('1001', '2002', state);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'calendar_create',
    c.makeTelegramStateConfirmationPayload_('scc:yes', 'schedule', state));
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  c.putTelegramScheduleState_('1001', '2002', {...state, duration: 120});
  calendar.faults.afterInsert = true;
  assert.throws(() => c.processTelegramSecureCallback_(f.query, parsed), /injected/);
  calendar.faults.afterInsert = false; f.restart();
  const result = f.context.processTelegramSecureCallback_(f.query, parsed);
  assert.equal(result.code, 'calendar_created');
  assert.equal(calendar.calls.filter(x => x.method === 'insert').length, 1);
  const event = calendar.events.get(result.ref);
  assert.equal(new Date(event.end.dateTime) - new Date(event.start.dateTime), 3600000);
});

for (const race of [false, true]) {
  test(`P1.2 actual Calendar move uses immutable target and conditional write; race=${race}`, () => {
    const f = fixture(); const calendar = addCalendar(f); const c = f.context;
    const startMs = Date.now() + 86400000;
    calendar.events.set('event-one', {id: 'event-one', etag: 'version-1', summary: 'Fixture A ПТ',
      start: {dateTime: new Date(startMs).toISOString()}, end: {dateTime: new Date(startMs + 3600000).toISOString()}});
    const state = {action: 'upcoming', phase: 'move_confirm', clientId: 'CL-A', clientName: 'Fixture A',
      calendarId: 'fixture-calendar', items: [{id: 'event-one'}], selectedIndex: 0,
      newStartMs: startMs + 86400000, confirmedCalendarEtag: 'version-1'};
    c.putTelegramOpsState_('1001', '2002', state);
    const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'calendar_move',
      c.makeTelegramStateConfirmationPayload_('ops:umYes', 'ops', state));
    const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
    c.putTelegramOpsState_('1001', '2002', {...state, newStartMs: startMs + 172800000});
    calendar.faults.racePatch = race;
    if (race) {
      assert.throws(() => c.processTelegramSecureCallback_(f.query, parsed), /412/);
      assert.equal(calendar.events.get('event-one').summary, 'External update');
      assert.equal(calendar.calls.length, 0);
    } else {
      assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'calendar_moved');
      assert.equal(new Date(calendar.events.get('event-one').start.dateTime).getTime(), state.newStartMs);
      assert.equal(calendar.calls[0].etag, 'version-1');
    }
  });
}

test('P1 lock serializes independent executions and nested helpers retain outer lease', () => {
  const f = fixture(); const other = f.newExecution();
  let checked = false;
  f.book.hooks.after = event => {
    if (event.sheet === 'Оплаты' && !checked) {
      checked = true;
      assert.equal(f.locks().locked, true);
      assert.throws(() => other.processTelegramSecureCallback_(f.query, f.parsed), /выполняется/);
    }
  };
  f.pay();
  assert.equal(checked, true);
  assert.deepEqual(f.locks(), {locked: false, acquisitions: 2, releases: 2});
  assert.equal(f.payments().length, 1);
});

for (const eventName of ['pending', 'started', 'result', 'committed']) {
  test(`P1.4 crash after durable ${eventName}, fresh execution never duplicates`, () => {
    const f = fixture(); let crashed = false;
    f.book.hooks.after = event => {
      if (!crashed && event.sheet === 'Журнал операций Telegram' && event.values[0][4] === eventName) {
        crashed = true; throw new Error('injected process death');
      }
    };
    assert.throws(() => f.pay(), /injected/);
    f.book.hooks.after = null;
    f.restart();
    const result = f.pay();
    if (eventName === 'started') assert.equal(result.status, 'manual_review');
    else {
      assert.equal(result.code, 'payment_recorded');
      assert.equal(f.payments().length, 1);
    }
    f.pay(); assert.ok(f.payments().length <= 1);
  });
}

test('P1.4 crash after payment durable, recovery reads actual marker and returns result', () => {
  const f = fixture();
  f.book.hooks.after = event => {if (event.sheet === 'Оплаты') throw new Error('injected process death');};
  assert.throws(() => f.pay(), /injected/);
  f.book.hooks.after = null; f.restart();
  assert.equal(f.pay().code, 'payment_recorded');
  assert.equal(f.payments().length, 1);
  assert.equal(f.pay().code, 'payment_recorded');
});

test('P1.4 durable ticket survives cache loss and a process restart before acceptance', () => {
  const f = fixture(); f.restart(); f.pay(); assert.equal(f.payments().length, 1);
});

test('P1.2 changed underlying values fail closed before any business mutation', () => {
  const f = fixture();
  f.book.sheets.get('Клиенты').getRange(5, 11).setValue('changed');
  assert.equal(f.pay().code, 'underlying_state_changed');
  assert.equal(f.payments().length, 0);
});

test('P1.4 Telegram transport failure after commit cannot repeat payment', () => {
  const f = fixture(); f.telegram.fail = true;
  assert.throws(() => f.pay(), /transport/);
  f.telegram.fail = false; f.restart();
  assert.equal(f.pay().code, 'payment_recorded');
  assert.equal(f.payments().length, 1);
});

test('P1.5 2000 consumed/expired/revoked lifecycles keep Properties bounded and preserve results', () => {
  const f = fixture();
  const initialBytes = f.context.getDmsPropertyUsage_().script.bytes;
  for (let i = 0; i < 2000; i++) {
    const state = {...f.state, secureFlowId: 'retention-' + i};
    const ticket = f.context.createTelegramConfirmation_('1001', '2002', '7', 'payment',
      f.context.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', state));
    const parsed = f.context.parseTelegramConfirmationCallback_(ticket.callbackData);
    if (i % 10 === 0) {
      assert.equal(f.context.processTelegramSecureCallback_(f.query, parsed).code, 'payment_recorded');
      assert.equal(f.context.processTelegramSecureCallback_(f.query, parsed).code, 'payment_recorded');
    } else if (i % 2) {
      assert.throws(() => f.context.validateTelegramConfirmation_(parsed, f.query, Date.now() + 3600000), /истёк/);
    } else f.context.revokeTelegramConfirmationById_(ticket.id, 'cancel');
  }
  assert.equal(f.context.getDmsPropertyUsage_().script.bytes, initialBytes);
  assert.equal([...f.shared.keys()].filter(k => k.startsWith('DMS_TG_CF_')).length, 0);
  f.restart();
  assert.equal(f.context.getTelegramConfirmationState_(f.ticket.id).status, 'pending');
  assert.equal(f.payments().length, 200);
  const final = f.context.createTelegramConfirmation_('1001', '2002', '7', 'payment',
    f.context.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', {...f.state, secureFlowId: 'after-load'}));
  assert.equal(f.context.processTelegramSecureCallback_(f.query,
    f.context.parseTelegramConfirmationCallback_(final.callbackData)).code, 'payment_recorded');
  assert.equal(f.payments().length, 201);
});

test('P1.5 quota warning and fail-safe precede any new confirmation write', () => {
  const f = fixture();
  for (let i = 0; i < 55; i++) f.shared.set('unrelated-' + i, 'x'.repeat(8000));
  assert.equal(f.context.getDmsPropertyUsage_().script.warning, true);
  f.shared.set('unrelated-extra-1', 'x'.repeat(8000));
  f.shared.set('unrelated-extra-2', 'x'.repeat(8000));
  const before = f.book.writes.length;
  assert.throws(() => f.context.createTelegramConfirmation_('1001', '2002', '7', 'payment', {}), /cleanup/);
  assert.equal(f.book.writes.length, before);
});

test('P1.2 session replacement at the pending durable boundary cannot change mutation', () => {
  const f = fixture();
  f.book.hooks.after = event => {
    if (event.sheet === 'Журнал операций Telegram' && event.values[0][4] === 'pending') {
      f.context.putTelegramPaymentState_('1001', '2002', {...f.state, amount: 777});
    }
  };
  f.pay(); assert.equal(f.payments()[0][6], 100);
});

test('P1.2 shared primitive protects real rename mutation from changed ops session', () => {
  const f = fixture(); const c = f.context;
  const state = {action: 'rename', phase: 'confirm', clientId: 'CL-A', oldName: 'Fixture A', newName: 'Name A'};
  c.putTelegramOpsState_('1001', '2002', state);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'rename_client',
    c.makeTelegramStateConfirmationPayload_('ops:renameYes', 'ops', state));
  c.putTelegramOpsState_('1001', '2002', {...state, newName: 'Name B'});
  c.processTelegramSecureCallback_(f.query, c.parseTelegramConfirmationCallback_(ticket.callbackData));
  assert.equal(f.book.sheets.get('Клиенты').getRange(5, 2).getValue(), 'Name A');
});

test('P1.2 admin/chat/message/nonce mismatch cannot accept a ticket', () => {
  for (const part of ['admin', 'chat', 'message', 'nonce']) {
    const f = fixture(); const query = structuredClone(f.query); const parsed = {...f.parsed};
    if (part === 'admin') query.from.id = 'different';
    if (part === 'chat') query.message.chat.id = 'different';
    if (part === 'message') query.message.message_id = 8;
    if (part === 'nonce') parsed.nonce = 'f'.repeat(32);
    const before = f.book.writes.length;
    assert.throws(() => f.context.processTelegramSecureCallback_(query, parsed));
    assert.equal(f.book.writes.length, before);
  }
});

test('P1 lock missing ScriptLock fails closed without a substitute', () => {
  const f = fixture(); f.context.LockService.getScriptLock = () => null;
  const before = f.book.writes.length;
  assert.throws(() => f.pay(), /lock unavailable/);
  assert.equal(f.book.writes.length, before);
});

test('P1.2 management mutation reads the accepted note, not the replaced management session', () => {
  const f = fixture(); const c = f.context;
  const state = {action: 'client_note', phase: 'confirm', clientId: 'CL-A', clientName: 'Fixture A', note: 'NOTE_A'};
  c.putTelegramManagementState_('1001', '2002', state);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'management',
    c.makeTelegramStateConfirmationPayload_('mc:yes', 'management', state));
  c.putTelegramManagementState_('1001', '2002', {...state, note: 'NOTE_B'});
  c.processTelegramSecureCallback_(f.query, c.parseTelegramConfirmationCallback_(ticket.callbackData));
  const value = f.book.sheets.get('Клиенты').getRange(5, 11).getValue();
  assert.match(value, /NOTE_A/); assert.doesNotMatch(value, /NOTE_B/);
});

test('P1.2 revoke payment applies the exact operation and replay is durable', () => {
  const f = fixture(); const c = f.context;
  f.pay(); const paymentId = f.payments()[0][0];
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'void_payment',
    {legacyData: 'ops:voidPaymentYes:' + paymentId, sourceMessageId: '7'});
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'payment_voided');
  const writes = f.book.writes.length;
  assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'payment_voided');
  assert.equal(f.book.writes.length, writes);
  assert.equal(f.payments()[0][7], 'Отменён');
});

function addQueueRow(f, id = 'Q-1') {
  const date = new Date('2026-09-05T08:00:00Z');
  const row = [id, date, '', '', '', date, new Date(date.getTime() + 3600000),
    'Fixture A ПТ', 'CL-A', 'Fixture A', '', 'Распознано', 'Проведена', 'Ожидает', '', 'Telegram', ''];
  f.book.sheets.get('Очередь подтверждения').appendRow(row);
}

test('P1.2 full Queue decision flow is fixed to one row and replay does not rewrite it', () => {
  const f = fixture(); const c = f.context; addQueueRow(f);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'queue_decision',
    {legacyData: 'qd:Q-1:free', sourceMessageId: '7'});
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'queue_decision_saved');
  const before = f.book.writes.length;
  c.processTelegramSecureCallback_(f.query, parsed);
  assert.equal(f.book.writes.length, before);
  assert.equal(f.book.sheets.get('Очередь подтверждения').getRange(4, 13).getValue(), 'Отмена без списания');
});

test('P1.2 full confirm-day flow writes one Journal entry, no implicit Calendar sync, durable replay', () => {
  const f = fixture(); const c = f.context; addQueueRow(f);
  c.Calendar = {Events: {list: () => {throw new Error('Unexpected Calendar sync');}}};
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'confirm_day',
    {legacyData: 'qp:2026-09-05', sourceMessageId: '7'});
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'day_confirmed');
  assert.equal(f.book.sheets.get('Журнал тренировок').getLastRow(), 4);
  const before = f.book.writes.length;
  c.processTelegramSecureCallback_(f.query, parsed);
  assert.equal(f.book.writes.length, before);
});

test('P1.2 an added day row after preview cannot join the accepted operation', () => {
  const f = fixture(); const c = f.context; addQueueRow(f);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'confirm_day',
    {legacyData: 'qp:2026-09-05', sourceMessageId: '7'});
  addQueueRow(f, 'Q-2');
  const result = c.processTelegramSecureCallback_(f.query, c.parseTelegramConfirmationCallback_(ticket.callbackData));
  assert.equal(result.code, 'underlying_state_changed');
  assert.equal(f.book.sheets.get('Журнал тренировок').getLastRow(), 3);
});

test('P1.2 blocked day remains a durable partial outcome', () => {
  const f = fixture(); const c = f.context; addQueueRow(f);
  f.book.sheets.get('Клиенты').getRange(5, 11).setValue('');
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'confirm_day',
    {legacyData: 'qp:2026-09-05', sourceMessageId: '7'});
  const parsed = c.parseTelegramConfirmationCallback_(ticket.callbackData);
  const result = c.processTelegramSecureCallback_(f.query, parsed);
  assert.equal(result.code, 'day_partial'); assert.equal(result.blocked, 1);
  const writes = f.book.writes.length;
  assert.equal(c.processTelegramSecureCallback_(f.query, parsed).code, 'day_partial');
  assert.equal(f.book.writes.length, writes);
});

for (const corruption of ['amount', 'duplicate']) test('P1.4 recovery requires exact unique payment proof: ' + corruption, () => {
  const f = fixture();
  f.book.hooks.after = event => {if (event.sheet === 'Оплаты') throw new Error('durable payment fault');};
  assert.throws(() => f.pay()); f.book.hooks.after = null;
  if (corruption === 'amount') f.book.sheets.get('Оплаты').getRange(4, 7).setValue(999);
  else f.book.sheets.get('Оплаты').appendRow(f.payments()[0]);
  f.restart();
  assert.equal(f.pay().status, 'manual_review');
  assert.equal(f.payments().length, corruption === 'duplicate' ? 2 : 1);
});

test('P1.2 cancellation and expiry reject unaccepted tickets without business writes', () => {
  const f = fixture(); const c = f.context;
  c.handleTelegramSecureCancellation_(f.query, c.parseTelegramConfirmationCallback_(f.ticket.cancelData));
  assert.throws(() => f.pay()); assert.equal(f.payments().length, 0);
  const ticket = c.createTelegramConfirmation_('1001', '2002', '7', 'payment',
    c.makeTelegramStateConfirmationPayload_('pc:yes', 'payment', f.state), Date.now() - 3600000);
  assert.throws(() => c.processTelegramSecureCallback_(f.query, c.parseTelegramConfirmationCallback_(ticket.callbackData)), /истёк/);
  assert.equal(f.payments().length, 0);
});

test('P1.5 legacy cleanup preserves pending evidence, is bounded, and is idempotent', () => {
  const f = fixture();
  f.context.PropertiesService.getDocumentProperties = () => f.props;
  for (let i = 0; i < 60; i++) {
    const id = i.toString(16).padStart(16, '0');
    f.shared.set('DMS_TG_CF_' + id, JSON.stringify({id, operationId: 'TGOP-' + 'a'.repeat(24),
      action: 'payment', status: 'consumed', adminHash: '', chatHash: '', messageId: '7', payloadHash: ''}));
  }
  const result = f.context.cleanupDmsLegacyConfirmationTickets_({limit: 500, legacyExecutionsDrained: true});
  assert.equal(result.deletedEphemeralKeys, 50);
  assert.equal(result.manualReview, 50);
  assert.equal(result.remaining, 10);
  assert.equal(f.context.cleanupDmsLegacyConfirmationTickets_({legacyExecutionsDrained: true}).deletedEphemeralKeys, 10);
  assert.equal(f.context.cleanupDmsLegacyConfirmationTickets_({legacyExecutionsDrained: true}).deletedEphemeralKeys, 0);
  assert.equal(f.book.sheets.get('Журнал операций Telegram').rows.filter(r => r[4] === 'legacy_ticket_preserved').length, 60);
});
