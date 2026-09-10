import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBundle} from './helpers/apps-script-bundle.mjs';

function fixture() {
  const loaded = loadBundle('stabilization');
  const calls = [];
  const context = loaded.context;
  context.isTelegramAdmin_ = () => true;
  for (const name of [
    'getTelegramOpsState_', 'getTelegramMoveState_', 'getTelegramPaymentState_',
    'getTelegramScheduleState_', 'getTelegramManagementState_',
  ]) context[name] = () => null;
  context.clearTelegramPendingStates_ = () => calls.push(['clear']);
  context.syncCalendarToQueue = () => calls.push(['sync']);
  context.sendTelegramMainMenu_ = chatId => calls.push(['menu', String(chatId)]);
  context.sendTelegramQueueDashboard_ = chatId => calls.push(['queue', String(chatId)]);
  context.sendTelegramAttentionCenter_ = chatId => calls.push(['attention', String(chatId)]);
  context.sendTelegramScheduleClientList_ = (chatId, page, messageId) =>
    calls.push(['schedule', String(chatId), page, messageId]);
  context.sendTelegramClientList_ = (chatId, page, messageId) =>
    calls.push(['clients', String(chatId), page, messageId]);
  context.sendTelegramClientSearch_ = (chatId, query) => calls.push(['client_search', String(chatId), query]);
  context.sendTelegramReportMenu_ = (chatId, messageId) => calls.push(['report', String(chatId), messageId]);
  context.sendTelegramMoreMenu_ = (chatId, messageId) => calls.push(['more', String(chatId), messageId]);
  context.showTelegramUndoConfirmation_ = (chatId, messageId) => calls.push(['undo', String(chatId), messageId]);
  context.buildTelegramBalancesText_ = () => 'fixture balances';
  context.buildTelegramDebtText_ = () => 'fixture debt';
  context.telegramSendMessage_ = (chatId, text) => calls.push(['message', String(chatId), text]);
  context.telegramAnswerCallback_ = (id, text, alert) => calls.push(['answer', id, text, alert]);
  return {context, calls};
}

function dispatch(text) {
  const result = fixture();
  result.context.handleTelegramMessage_({
    text,
    from: {id: '1001'},
    chat: {id: '2002'},
  });
  return result.calls;
}

test('Telegram admin navigation and read commands route to the current handlers', () => {
  const cases = [
    ['/start', ['menu', '2002']],
    ['/menu@fixture_bot', ['menu', '2002']],
    ['🏠 Меню', ['menu', '2002']],
    ['/today', ['queue', '2002']],
    ['/day@fixture_bot', ['queue', '2002']],
    ['📅 Сегодня', ['queue', '2002']],
    ['/yesterday', ['queue', '2002']],
    ['⏮ Вчера', ['queue', '2002']],
    ['/attention', ['attention', '2002']],
    ['⚠️ Внимание', ['attention', '2002']],
    ['/schedule', ['schedule', '2002', 0, null]],
    ['➕ Записать', ['schedule', '2002', 0, null]],
    ['/balances', ['message', '2002', 'fixture balances']],
    ['📦 Остатки', ['message', '2002', 'fixture balances']],
    ['/clients', ['clients', '2002', 0, null]],
    ['👥 Клиенты', ['clients', '2002', 0, null]],
    ['/client Fixture Name', ['client_search', '2002', 'Fixture Name']],
    ['/debt', ['message', '2002', 'fixture debt']],
    ['💳 Долги', ['message', '2002', 'fixture debt']],
    ['/report', ['report', '2002', null]],
    ['📊 Отчёт', ['report', '2002', null]],
    ['/more', ['more', '2002', null]],
    ['/settings', ['more', '2002', null]],
    ['⚙️ Ещё', ['more', '2002', null]],
    ['/undo', ['undo', '2002', null]],
  ];
  for (const [input, expected] of cases) {
    const calls = dispatch(input);
    assert.equal(calls.some(call => expected.every((value, index) => call[index] === value)), true, input);
  }
  assert.deepEqual(dispatch('/today').map(call => call[0]), ['sync', 'queue']);
  assert.deepEqual(dispatch('/attention').map(call => call[0]), ['sync', 'attention']);
});

test('Telegram callback navigation returns to the menu and clears pending state', () => {
  const {context, calls} = fixture();
  context.handleTelegramCallback_({
    id: 'callback-nav', data: 'nav:menu', from: {id: '1001'},
    message: {message_id: 7, chat: {id: '2002'}},
  });
  assert.deepEqual(calls.map(call => call[0]), ['clear', 'answer', 'menu']);
});

test('Telegram navigation remains closed to a non-admin identity', () => {
  const {context, calls} = fixture();
  context.isTelegramAdmin_ = () => false;
  context.handleTelegramMessage_({text: '/clients', from: {id: '9999'}, chat: {id: '2002'}});
  assert.deepEqual(calls, []);
});
