// DMS Telegram reliability, operations and settings extension v13.
const DMS_TELEGRAM_FINAL = {
  AUDIT: 'Журнал действий бота',
  AUDIT_HEADERS: ['ID', 'Дата', 'Действие', 'Объект', 'Описание', 'Откат JSON', 'Отменено', 'Источник'],
  PAYMENTS: 'Оплаты',
  LOG: 'Журнал тренировок',
  BLOCKS: 'Блоки',
  CLIENTS: 'Клиенты',
  BACKUPS: 'Резервные копии бота',
  SETTINGS_PROPERTY: 'DMS_TG_FINAL_SETTINGS',
  OPS_CACHE_PREFIX: 'DMS_TG_OPS_',
  UPDATE_CACHE_PREFIX: 'DMS_TG_UPDATE_',
  CACHE_TTL_SECONDS: 1800,
  UPDATE_TTL_SECONDS: 21600,
  MAX_AUDIT_SCAN: 200,
  MORNING_HANDLER: 'sendTelegramMorningDigest',
  EVENING_HANDLER: 'sendTelegramDailyQueue'
};

function doPost(e) {
  try {
    // Parsing is necessarily before route-specific authentication. This entire
    // ingress boundary must therefore have no persistent error side effects.
    const raw = e && e.postData && e.postData.contents;
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 65536) {
      return telegramTextResponse_('invalid_request');
    }
    const update = JSON.parse(raw);
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      return telegramTextResponse_('invalid_request');
    }
    if (typeof isDmsMiniAppRequest_ === 'function' && isDmsMiniAppRequest_(update)) {
      return handleDmsMiniAppRequest_(update);
    }
    if (!isValidTelegramWebhook_(e)) return telegramTextResponse_('forbidden');
    const updateId = update.update_id === undefined ? '' : String(update.update_id);
    const cache = CacheService.getScriptCache();
    const cacheKey = updateId ? DMS_TELEGRAM_FINAL.UPDATE_CACHE_PREFIX + updateId : '';
    if (cacheKey && cache.get(cacheKey)) return telegramTextResponse_('ok');

    if (update.callback_query) handleTelegramCallback_(update.callback_query);
    else if (update.message) handleTelegramMessage_(update.message);
    if (cacheKey) cache.put(cacheKey, '1', DMS_TELEGRAM_FINAL.UPDATE_TTL_SECONDS);
  } catch (error) {
    // Never log parser/handler exception text: it can contain body, initData,
    // personal data or a credential. Authenticated domain actions audit themselves.
    console.error('DMS ingress request failed');
  }
  return telegramTextResponse_('ok');
}

function handleTelegramMessage_(message) {
  const chatId = message.chat && message.chat.id;
  const userId = message.from && message.from.id;
  if (!isTelegramAdmin_(userId, chatId)) return;

  const text = String(message.text || '').trim();
  const command = text.split(/\s+/)[0].split('@')[0].toLowerCase();
  const pendingOps = getTelegramOpsState_(userId, chatId);
  const pendingMove = getTelegramMoveState_(userId, chatId);
  const pendingPayment = getTelegramPaymentState_(userId, chatId);
  const pendingSchedule = getTelegramScheduleState_(userId, chatId);
  const pendingManagement = getTelegramManagementState_(userId, chatId);
  const mainButtons = [
    '📅 Сегодня', '⏮ Вчера', '➕ Записать', '⚠️ Внимание',
    '👥 Клиенты', '📦 Остатки', '💳 Долги', '📊 Отчёт', '⚙️ Ещё'
  ];
  const hasPendingState =
    pendingOps || pendingMove || pendingPayment || pendingSchedule || pendingManagement;
  const isMainNavigation = mainButtons.indexOf(text) !== -1;

  if (command === '/start' || command === '/menu' || text === '🏠 Меню') {
    clearTelegramPendingStates_(userId, chatId);
    sendTelegramMainMenu_(chatId);
    return;
  }
  if (command === '/cancel' || text === '❌ Отменить действие') {
    if (pendingMove) cancelTelegramMove_(pendingMove, userId, chatId);
    else {
      clearTelegramPendingStates_(userId, chatId);
      telegramSendMessage_(chatId, 'Текущее действие отменено.', buildTelegramMainKeyboard_());
    }
    return;
  }

  if (hasPendingState && isMainNavigation)
    clearTelegramPendingStates_(userId, chatId);
  if (!isMainNavigation && pendingOps && command.charAt(0) !== '/') {
    handleTelegramOpsInput_(pendingOps, userId, chatId, text);
    return;
  }
  if (!isMainNavigation && pendingManagement && command.charAt(0) !== '/') {
    handleTelegramManagementInput_(pendingManagement, userId, chatId, text);
    return;
  }
  if (!isMainNavigation && pendingSchedule && command.charAt(0) !== '/') {
    handleTelegramScheduleInput_(pendingSchedule, userId, chatId, text);
    return;
  }
  if (!isMainNavigation && pendingPayment && command.charAt(0) !== '/') {
    handleTelegramPaymentAmount_(pendingPayment, userId, chatId, text);
    return;
  }
  if (!isMainNavigation && pendingMove && command.charAt(0) !== '/') {
    handleTelegramMoveInput_(pendingMove, userId, chatId, text);
    return;
  }

  if (command === '/today' || command === '/day' || text === '📅 Сегодня') {
    syncCalendarToQueue();
    sendTelegramQueueDashboard_(chatId, new Date());
  } else if (command === '/yesterday' || text === '⏮ Вчера') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    sendTelegramQueueDashboard_(chatId, date);
  } else if (command === '/attention' || text === '⚠️ Внимание') {
    syncCalendarToQueue();
    sendTelegramAttentionCenter_(chatId);
  } else if (command === '/schedule' || text === '➕ Записать') {
    sendTelegramScheduleClientList_(chatId, 0, null);
  } else if (command === '/balances' || text === '📦 Остатки') {
    telegramSendMessage_(chatId, buildTelegramBalancesText_(), null);
  } else if (command === '/clients' || text === '👥 Клиенты') {
    sendTelegramClientList_(chatId, 0, null);
  } else if (command === '/client') {
    const query = text.substring(text.indexOf(' ') + 1).trim();
    if (!query || query === text) sendTelegramClientList_(chatId, 0, null);
    else sendTelegramClientSearch_(chatId, query);
  } else if (command === '/debt' || text === '💳 Долги') {
    telegramSendMessage_(chatId, buildTelegramDebtText_(), null);
  } else if (command === '/report' || text === '📊 Отчёт') {
    sendTelegramReportMenu_(chatId, null);
  } else if (command === '/more' || command === '/settings' || text === '⚙️ Ещё') {
    sendTelegramMoreMenu_(chatId, null);
  } else if (command === '/undo') {
    showTelegramUndoConfirmation_(chatId, null);
  } else if (command === '/chatid') {
    telegramSendMessage_(chatId,
      'User ID: <code>' + escapeTelegramHtml_(userId) + '</code>\n' +
      'Chat ID: <code>' + escapeTelegramHtml_(chatId) + '</code>', null);
  } else {
    telegramSendMessage_(chatId, telegramHelpText_(), buildTelegramMainKeyboard_());
  }
}

function clearTelegramPendingStates_(userId, chatId) {
  clearTelegramPaymentState_(userId, chatId);
  clearTelegramScheduleState_(userId, chatId);
  clearTelegramManagementState_(userId, chatId);
  clearTelegramOpsState_(userId, chatId);
  clearTelegramMoveState_(userId, chatId);
}

function handleTelegramCallbackV49_(query) {
  const message = query.message || {};
  const chatId = message.chat && message.chat.id;
  const userId = query.from && query.from.id;
  if (!isTelegramAdmin_(userId, chatId)) {
    telegramAnswerCallback_(query.id, 'Нет доступа', true);
    return;
  }
  const data = String(query.data || '');
  if (data === 'nav:menu') {
    clearTelegramPendingStates_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Открываю меню', false);
    sendTelegramMainMenu_(chatId);
    return;
  }
  if (data.indexOf('ops:') === 0) {
    handleTelegramOpsCallback_(query, data, userId, chatId, message.message_id);
    return;
  }
  if (isTelegramManagementCallback_(data)) {
    handleTelegramManagementCallback_(query, data, userId, chatId, message.message_id);
    return;
  }
  if (data.indexOf('slp:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramScheduleClientList_(chatId, Number(data.substring(4)) || 0, message.message_id);
  } else if (data.indexOf('sc:') === 0) {
    clearTelegramPaymentState_(userId, chatId);
    clearTelegramMoveState_(userId, chatId);
    clearTelegramManagementState_(userId, chatId);
    clearTelegramOpsState_(userId, chatId);
    startTelegramSchedule_(userId, chatId, data.substring(3), message.message_id);
    telegramAnswerCallback_(query.id, 'Выбери дату', false);
  } else if (data.indexOf('sdt:') === 0) {
    telegramAnswerCallback_(query.id, 'Дата выбрана', false);
    setTelegramScheduleDate_(userId, chatId, data.substring(4), message.message_id);
  } else if (data.indexOf('sdu:') === 0) {
    telegramAnswerCallback_(query.id, 'Длительность выбрана', false);
    setTelegramScheduleDuration_(userId, chatId, Number(data.substring(4)), message.message_id);
  } else if (data === 'scc:no') {
    clearTelegramScheduleState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Запись отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Создание тренировки отменено.', null);
  } else if (data === 'scc:yes' || data === 'scc:force') {
    telegramAnswerCallback_(query.id, 'Создаю событие…', false);
    confirmTelegramSchedule_(userId, chatId, message.message_id, data === 'scc:force');
  } else if (data.indexOf('clp:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю список', false);
    sendTelegramClientList_(chatId, Number(data.substring(4)) || 0, message.message_id);
  } else if (data.indexOf('cl:') === 0) {
    telegramAnswerCallback_(query.id, 'Открываю карточку', false);
    sendTelegramClientCard_(chatId, data.substring(3), message.message_id);
  } else if (data.indexOf('pm:') === 0) {
    const parts = data.split(':');
    clearTelegramScheduleState_(userId, chatId);
    clearTelegramManagementState_(userId, chatId);
    clearTelegramOpsState_(userId, chatId);
    beginTelegramPayment_(userId, chatId, parts[1], parts[2]);
    telegramAnswerCallback_(query.id, 'Жду сумму', false);
  } else if (data === 'pc:no') {
    clearTelegramPaymentState_(userId, chatId);
    telegramAnswerCallback_(query.id, 'Оплата отменена', false);
    telegramEditMessage_(chatId, message.message_id, 'Внесение оплаты отменено.', null);
  } else if (data === 'pc:yes') {
    telegramAnswerCallback_(query.id, 'Записываю…', false);
    confirmTelegramPayment_(userId, chatId, message.message_id);
  } else if (data.indexOf('qd:') === 0) {
    const parts = data.split(':');
    const result = setTelegramQueueDecision_(parts[1], parts[2]);
    if (parts[2] === 'move') {
      startTelegramMove_(userId, chatId, message.message_id, result);
      telegramAnswerCallback_(query.id, 'Жду новую дату и время', false);
    } else {
      clearTelegramMoveState_(userId, chatId);
      telegramAnswerCallback_(query.id, result.notice, false);
    }
    refreshTelegramQueueMessage_(chatId, message.message_id, result.date);
  } else if (data.indexOf('qp:') === 0) {
    telegramAnswerCallback_(query.id, 'Обрабатываю день…', false);
    try {
      syncCalendarToQueue();
      const date = parseTelegramDateKey_(data.substring(3));
      activateStartedPlannedBlocksForDate_(date);
      const result = processQueueDate_(date, 'Telegram', false);
      const calendarResult = applyTelegramCalendarCancellationsForDate_(date);
      telegramAuditAction_('confirm_day', data.substring(3), 'День подтверждён через Telegram', null);
      telegramEditMessage_(chatId, message.message_id,
        buildTelegramDayConfirmationText_(date, result, calendarResult) + buildTelegramWarningsText_(), null);
    } catch (error) {
      telegramSendMessage_(chatId, '<b>Не удалось подтвердить день</b>\n' +
        escapeTelegramHtml_(error.message || String(error)), null);
    }
  } else if (data.indexOf('qr:') === 0) {
    const date = parseTelegramDateKey_(data.substring(3));
    telegramAnswerCallback_(query.id, 'Обновляю…', false);
    syncCalendarToQueue();
    refreshTelegramQueueMessage_(chatId, message.message_id, date);
  } else {
    telegramAnswerCallback_(query.id, 'Команда устарела', false);
  }
}

function buildTelegramMainKeyboard_() {
  return {
    keyboard: [
      [{text: '📅 Сегодня'}, {text: '⏮ Вчера'}],
      [{text: '➕ Записать'}, {text: '⚠️ Внимание'}],
      [{text: '👥 Клиенты'}, {text: '📦 Остатки'}],
      [{text: '💳 Долги'}, {text: '📊 Отчёт'}],
      [{text: '⚙️ Ещё'}]
    ],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Выбери действие'
  };
}

function handleTelegramMoveInputWithAudit_(state, userId, chatId, text) {
  let snapshot = null;
  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const row = findRowByValue_(queue, 1, state.queueId, DMS_TELEGRAM.QUEUE_FIRST_ROW);
    if (row) {
      const values = queue.getRange(row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues()[0];
      snapshot = {queue: queue, row: row, values: values.slice(), calendarId: String(values[2] || ''),
        eventId: String(values[3] || ''), start: values[5], end: values[6],
        timeZone: ss.getSpreadsheetTimeZone() || 'Europe/Moscow',
        client: String(values[9] || values[7] || state.queueId)};
    }
  } catch (ignore) {}
  handleTelegramMoveInput_(state, userId, chatId, text);
  if (snapshot && !getTelegramMoveState_(userId, chatId) &&
      snapshot.start instanceof Date && snapshot.end instanceof Date) {
    telegramAuditAction_('move_training', state.queueId, snapshot.client + ': тренировка перенесена',
      {type: 'compound', items: [
        makeTelegramRestoreRangeUndo_(snapshot.queue, snapshot.row, 1, [snapshot.values]),
        {type: 'move_calendar_event', calendarId: snapshot.calendarId, eventId: snapshot.eventId,
          start: snapshot.start.toISOString(), end: snapshot.end.toISOString(), timeZone: snapshot.timeZone}
      ]});
  }
}

function handleTelegramManagementCallbackWithAudit_(query, data, userId, chatId, messageId) {
  const capture = captureTelegramManagementAudit_(data, userId, chatId);
  handleTelegramManagementCallback_(query, data, userId, chatId, messageId);
  if (!capture) return;
  if (capture.kind === 'state' && getTelegramManagementState_(userId, chatId)) return;
  finalizeTelegramManagementAudit_(capture);
}

function captureTelegramManagementAudit_(data, userId, chatId) {
  try {
    const ss = SpreadsheetApp.getActive();
    const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
    if (data === 'mc:yes') {
      const state = getTelegramManagementState_(userId, chatId);
      if (!state) return null;
      const capture = {kind: 'state', state: JSON.parse(JSON.stringify(state)), items: []};
      if (state.action === 'new_block') {
        const clientRow = findRowByValue_(clients, 1, state.clientId, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
        capture.clientRow = clientRow;
        capture.items.push(makeTelegramRestoreRangeUndo_(clients, clientRow, 4,
          clients.getRange(clientRow, 4, 1, 2).getValues()));
      } else if (state.action === 'adjust_remaining') {
        const block = getTelegramBlockRecord_(state.blockId);
        capture.items.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 8,
          [[blocks.getRange(block.row, 8).getValue()]]));
        capture.items.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 16,
          [[blocks.getRange(block.row, 16).getValue()]]));
      } else if (state.action === 'client_note') {
        const clientRow = findRowByValue_(clients, 1, state.clientId, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
        capture.items.push(makeTelegramRestoreRangeUndo_(clients, clientRow, 11,
          [[clients.getRange(clientRow, 11).getValue()]]));
      }
      return capture;
    }
    if (data.indexOf('mgc:') === 0) {
      const parts = data.substring(4).split(':');
      const block = getTelegramBlockRecord_(parts[1]);
      return {kind: 'gift', entity: parts[1], description: 'Подарена тренировка: ' + parts[1], items: [
        makeTelegramRestoreRangeUndo_(blocks, block.row, 8, [[blocks.getRange(block.row, 8).getValue()]]),
        makeTelegramRestoreRangeUndo_(blocks, block.row, 16, [[blocks.getRange(block.row, 16).getValue()]])
      ]};
    }
    const statusPrefixes = {'mpc:': 'pause', 'mrc:': 'resume', 'mclc:': 'close'};
    const prefix = Object.keys(statusPrefixes).find(function(key) { return data.indexOf(key) === 0; });
    if (prefix) {
      const parts = data.substring(prefix.length).split(':');
      const clientId = parts[0];
      const blockId = parts[1];
      const block = getTelegramBlockRecord_(blockId);
      const clientRow = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
      return {kind: 'status', entity: blockId,
        description: 'Изменён статус блока ' + blockId + ': ' + statusPrefixes[prefix], items: [
          makeTelegramRestoreRangeUndo_(blocks, block.row, 4, [[blocks.getRange(block.row, 4).getValue()]]),
          makeTelegramRestoreRangeUndo_(blocks, block.row, 6, blocks.getRange(block.row, 6, 1, 2).getValues()),
          makeTelegramRestoreRangeUndo_(blocks, block.row, 16, [[blocks.getRange(block.row, 16).getValue()]]),
          makeTelegramRestoreRangeUndo_(clients, clientRow, 4, clients.getRange(clientRow, 4, 1, 2).getValues())
        ]};
    }
  } catch (ignore) {}
  return null;
}

function finalizeTelegramManagementAudit_(capture) {
  try {
    const ss = SpreadsheetApp.getActive();
    const clients = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_MANAGEMENT.BLOCKS);
    if (capture.kind === 'state') {
      const state = capture.state;
      if (state.action === 'new_client') {
        const match = getTelegramActiveClients_().find(function(client) {
          return normalizeTelegramClientSearch_(client.name) === normalizeTelegramClientSearch_(state.clientName);
        });
        if (!match) return;
        const clientRow = findRowByValue_(clients, 1, match.id, DMS_TELEGRAM_MANAGEMENT.CLIENT_FIRST_ROW);
        capture.items.push({type: 'clear_range', sheet: clients.getName(), row: clientRow,
          column: 1, rows: 1, columns: DMS_TELEGRAM_MANAGEMENT.CLIENT_COLUMNS});
        const card = getTelegramClientCard_(match.id);
        if (card.blockId) {
          const blockRow = findRowByValue_(blocks, 1, card.blockId, DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW);
          capture.items.push({type: 'clear_range', sheet: blocks.getName(), row: blockRow,
            column: 1, rows: 1, columns: DMS_TELEGRAM_MANAGEMENT.BLOCK_COLUMNS});
        }
        telegramAuditAction_('create_client', match.id, 'Создан клиент ' + state.clientName,
          {type: 'compound', items: capture.items});
      } else if (state.action === 'new_block') {
        const card = getTelegramClientCard_(state.clientId);
        const blockRow = findRowByValue_(blocks, 1, card.blockId, DMS_TELEGRAM_MANAGEMENT.BLOCK_FIRST_ROW);
        capture.items.push({type: 'clear_range', sheet: blocks.getName(), row: blockRow,
          column: 1, rows: 1, columns: DMS_TELEGRAM_MANAGEMENT.BLOCK_COLUMNS});
        telegramAuditAction_('create_block', card.blockId, 'Создан блок ' + card.blockId,
          {type: 'compound', items: capture.items});
      } else {
        telegramAuditAction_(state.action, state.blockId || state.clientId,
          'Изменены данные: ' + (state.clientName || state.clientId),
          {type: 'compound', items: capture.items});
      }
    } else {
      telegramAuditAction_(capture.kind, capture.entity, capture.description,
        {type: 'compound', items: capture.items});
    }
  } catch (error) {
    console.error('Management audit error: ' + (error.message || String(error)));
  }
}

function sendTelegramMoreMenu_(chatId, messageId) {
  const text = '<b>Дополнительные функции</b>\n' +
    'Настройки, история изменений и безопасный откат последнего действия.';
  const markup = {inline_keyboard: [
    [{text: '🩺 Состояние системы', callback_data: 'ops:health'}],
    [{text: '⚙️ Настройки уведомлений', callback_data: 'ops:settings'}],
    [{text: '↩️ Отменить последнее действие', callback_data: 'ops:undo'}],
    [{text: '🧾 Последние действия', callback_data: 'ops:audit'}],
    [{text: '🛡 Создать резервную копию', callback_data: 'ops:backup'}],
    [{text: '📊 Отчёты по периодам', callback_data: 'ops:reports'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramSystemHealth_(chatId, messageId) {
  const report = runDmsReadOnlySelfTests();
  const health = getDmsSystemHealth();
  const text = buildTelegramSystemHealthText_(report, health);
  const markup = {inline_keyboard: [
    [{text: '🔄 Проверить ещё раз', callback_data: 'ops:health'}],
    [{text: '🔙 Назад', callback_data: 'ops:more'}],
    [{text: '🏠 Меню', callback_data: 'nav:menu'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function buildTelegramSystemHealthText_(report, health) {
  const checks = report && report.checks ? report.checks : [];
  const passed = checks.filter(function(check) { return check.ok; }).length;
  const failed = checks.filter(function(check) { return !check.ok; });
  const reconciliation = checks.find(function(check) {
    return check.name === 'calendar-queue-journal-reconciliation';
  });
  const backup = checks.find(function(check) {
    return check.name === 'latest-backup-integrity';
  });
  const lines = [
    '<b>🩺 Состояние DMS Fitness</b>',
    (report && report.ok ? '✅' : '⚠️') + ' Проверки: <b>' + passed +
      '/' + checks.length + '</b>',
    'Очередь: ожидает <b>' + Number(health && health.queueWaiting || 0) +
      '</b>; ошибок <b>' + Number(health && health.queueErrors || 0) + '</b>',
    'Исчерпанные открытые блоки: <b>' +
      Number(health && health.exhaustedOpenBlocks
        ? health.exhaustedOpenBlocks.length
        : 0) + '</b>',
    'Триггеры: <b>' + Number(health && health.triggers ? health.triggers.length : 0) +
      '</b> активны'
  ];

  if (reconciliation) {
    lines.push('Сверка учёта: ' + (reconciliation.ok ? '✅ ' : '⚠️ ') +
      escapeTelegramHtml_(reconciliation.details));
  }
  if (backup) {
    lines.push('Резервная копия: ' + (backup.ok ? '✅ ' : '⚠️ ') +
      escapeTelegramHtml_(backup.details));
  }
  if (failed.length) {
    lines.push('', '<b>Требуют внимания:</b>');
    failed.forEach(function(check) {
      lines.push('• ' + escapeTelegramHtml_(check.name) + ': ' +
        escapeTelegramHtml_(String(check.details || '').slice(0, 180)));
    });
  }
  return lines.join('\n');
}

function handleTelegramOpsCallbackV13_(query, data, userId, chatId, messageId) {
  try {
    if (data === 'ops:more') sendTelegramMoreMenu_(chatId, messageId);
    else if (data === 'ops:settings') sendTelegramSettings_(chatId, messageId);
    else if (data.indexOf('ops:toggle:') === 0) {
      toggleTelegramSetting_(data.substring(11));
      sendTelegramSettings_(chatId, messageId);
    } else if (data === 'ops:undo') showTelegramUndoConfirmation_(chatId, messageId);
    else if (data.indexOf('ops:undoYes:') === 0) {
      performTelegramUndo_(data.substring(12));
      telegramEditMessage_(chatId, messageId, '<b>Последнее действие отменено</b>\nДанные восстановлены.',
        {inline_keyboard: [[{text: '🧾 История действий', callback_data: 'ops:audit'}]]});
    } else if (data === 'ops:audit') sendTelegramAuditHistory_(chatId, messageId);
    else if (data === 'ops:backup') {
      const backupId = createTelegramDataBackup();
      telegramEditMessage_(chatId, messageId,
        '<b>Резервная копия создана</b>\n' + escapeTelegramHtml_(backupId),
        {inline_keyboard: [[{text: '🔙 Назад', callback_data: 'ops:more'}]]});
    }
    else if (data === 'ops:reports') sendTelegramReportMenu_(chatId, messageId);
    else if (data.indexOf('ops:report:') === 0) {
      const days = Number(data.substring(11));
      telegramEditMessage_(chatId, messageId, buildTelegramPeriodReport_(days),
        {inline_keyboard: [[{text: '🔙 Периоды', callback_data: 'ops:reports'}]]});
    } else if (data.indexOf('ops:payments:') === 0) {
      sendTelegramClientPaymentHistory_(chatId, data.substring(13), messageId);
    } else if (data.indexOf('ops:blocks:') === 0) {
      sendTelegramClientBlockHistory_(chatId, data.substring(11), messageId);
    } else if (data.indexOf('ops:rename:') === 0) {
      startTelegramRenameClient_(userId, chatId, data.substring(11));
    } else if (data === 'ops:renameYes') {
      confirmTelegramRenameClient_(userId, chatId, messageId);
    } else if (data.indexOf('ops:singlePrice:') === 0) {
      startTelegramSinglePrice_(userId, chatId, data.substring(16));
    } else if (data === 'ops:singlePriceYes') {
      confirmTelegramSinglePrice_(userId, chatId, messageId);
    } else if (data.indexOf('ops:archive:') === 0) {
      showTelegramArchiveClient_(chatId, data.substring(12), messageId);
    } else if (data.indexOf('ops:archiveYes:') === 0) {
      confirmTelegramArchiveClient_(chatId, data.substring(15), messageId);
    } else if (data.indexOf('ops:voidPayment:') === 0) {
      showTelegramVoidPayment_(chatId, data.substring(16), messageId);
    } else if (data.indexOf('ops:voidPaymentYes:') === 0) {
      confirmTelegramVoidPayment_(chatId, data.substring(19), messageId);
    } else if (data === 'ops:search') {
      putTelegramOpsState_(userId, chatId, {action: 'search', phase: 'input'});
      telegramSendMessage_(chatId, '<b>Поиск клиента</b>\nПришли имя или его часть.',
        buildTelegramCancelKeyboard_());
    } else throw new Error('Команда устарела.');
    telegramAnswerCallback_(query.id, 'Готово', false);
  } catch (error) {
    telegramAnswerCallback_(query.id, 'Не удалось выполнить', true);
    telegramSendMessage_(chatId, '<b>Действие не выполнено</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), null);
  }
}

function sendTelegramSettings_(chatId, messageId) {
  const settings = getTelegramFinalSettings_();
  const mark = function(value) { return value ? '✅' : '⚪️'; };
  const text = '<b>Настройки уведомлений</b>\n\n' +
    mark(settings.morning) + ' Утренняя сводка\n' +
    mark(settings.evening) + ' Вечерняя проверка незакрытых тренировок\n' +
    mark(settings.lowBalance) + ' Предупреждать об остатке 0–2\n' +
    mark(settings.debt) + ' Показывать долги в предупреждениях\n\n' +
    'Автоматические рассылки начнут работать после установки расписания.';
  const markup = {inline_keyboard: [
    [{text: mark(settings.morning) + ' Утро', callback_data: 'ops:toggle:morning'},
     {text: mark(settings.evening) + ' Вечер', callback_data: 'ops:toggle:evening'}],
    [{text: mark(settings.lowBalance) + ' Остатки', callback_data: 'ops:toggle:lowBalance'},
     {text: mark(settings.debt) + ' Долги', callback_data: 'ops:toggle:debt'}],
    [{text: '🔙 Назад', callback_data: 'ops:more'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function getTelegramFinalSettings_() {
  const defaults = {morning: false, evening: false, lowBalance: true, debt: true};
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(DMS_TELEGRAM_FINAL.SETTINGS_PROPERTY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    Object.keys(defaults).forEach(function(key) {
      if (saved[key] === undefined) saved[key] = defaults[key];
    });
    return saved;
  } catch (ignore) {
    return defaults;
  }
}

function toggleTelegramSetting_(key) {
  const allowed = {morning: true, evening: true, lowBalance: true, debt: true};
  if (!allowed[key]) throw new Error('Неизвестная настройка.');
  const settings = getTelegramFinalSettings_();
  settings[key] = !settings[key];
  PropertiesService.getScriptProperties().setProperty(
    DMS_TELEGRAM_FINAL.SETTINGS_PROPERTY, JSON.stringify(settings));
  telegramAuditAction_('settings', key, 'Настройка изменена: ' + key + ' = ' + settings[key], null);
}

function sendTelegramMorningDigest() {
  const settings = getTelegramFinalSettings_();
  if (!settings.morning) return 'Утренняя сводка отключена.';
  validateTelegramConfiguration_();
  syncCalendarToQueue();
  const chatId = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);
  const dashboard = buildTelegramQueueDashboard_(new Date());
  const attention = buildTelegramAttentionReport_();
  telegramSendMessage_(chatId,
    '<b>Доброе утро</b>\n\n' + dashboard.text + '\n\n' + attention.text,
    dashboard.replyMarkup);
  return 'Утренняя сводка отправлена.';
}

function sendTelegramDailyQueue() {
  const settings = getTelegramFinalSettings_();
  if (!settings.evening) return 'Вечерняя проверка отключена.';
  validateTelegramConfiguration_();
  syncCalendarToQueue();
  const dashboard = buildTelegramQueueDashboard_(new Date());
  if (!dashboard.items.length) return 'Необработанных тренировок нет.';
  telegramSendMessage_(getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID),
    '<b>Остались необработанные тренировки</b>\n\n' + dashboard.text,
    dashboard.replyMarkup);
  return 'Отправлено событий: ' + dashboard.items.length + '.';
}

function installTelegramNotificationTriggers() {
  const handlers = [DMS_TELEGRAM_FINAL.MORNING_HANDLER, DMS_TELEGRAM_FINAL.EVENING_HANDLER];
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return handlers.indexOf(trigger.getHandlerFunction()) !== -1;
  }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger(DMS_TELEGRAM_FINAL.MORNING_HANDLER).timeBased().atHour(8).everyDays(1).create();
  ScriptApp.newTrigger(DMS_TELEGRAM_FINAL.EVENING_HANDLER).timeBased().atHour(22).everyDays(1).create();
  return 'Расписание уведомлений установлено: 08:00 и 22:00.';
}

function sendTelegramReportMenu_(chatId, messageId) {
  const markup = {inline_keyboard: [
    [{text: 'Сегодня', callback_data: 'ops:report:1'},
     {text: '7 дней', callback_data: 'ops:report:7'},
     {text: '30 дней', callback_data: 'ops:report:30'}],
    [{text: 'Текущий месяц подробно', callback_data: 'ops:report:0'}],
    [{text: '🔙 Назад', callback_data: 'ops:more'}]
  ]};
  const text = '<b>Отчёты</b>\nВыбери период.';
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function buildTelegramPeriodReport_(days) {
  if (!days) return buildTelegramReportText_();
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - days + 1);
  let done = 0;
  let charged = 0;
  let received = 0;
  let transfer = 0;
  let cash = 0;
  const log = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.LOG);
  if (log.getLastRow() >= 4) {
    log.getRange(4, 1, log.getLastRow() - 3, 19).getValues().forEach(function(row) {
      if (!(row[1] instanceof Date) || row[1] < from) return;
      const kind = String(row[5] || '');
      if (kind === 'Списание без проведения') charged++;
      else if (String(row[6] || '') === 'Проведена') done++;
    });
  }
  const payments = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.PAYMENTS);
  if (payments.getLastRow() >= 4) {
    payments.getRange(4, 1, payments.getLastRow() - 3, 10).getValues().forEach(function(row) {
      if (!(row[1] instanceof Date) || row[1] < from || String(row[7] || '') !== 'Подтверждён') return;
      const amount = Number(row[6]) || 0;
      received += amount;
      if (String(row[5] || '').toLowerCase().indexOf('нал') !== -1) cash += amount;
      else transfer += amount;
    });
  }
  const title = days === 1 ? 'сегодня' : 'последние ' + days + ' дней';
  return [
    '<b>Отчёт — ' + title + '</b>',
    'Период с ' + Utilities.formatDate(from, timeZone, 'dd.MM.yyyy'),
    '',
    '• Проведено: <b>' + done + '</b>',
    '• Списано без проведения: <b>' + charged + '</b>',
    '• Получено: <b>' + escapeTelegramHtml_(formatTelegramMoney_(received)) + '</b>',
    '• Переводы: <b>' + escapeTelegramHtml_(formatTelegramMoney_(transfer)) + '</b>',
    '• Наличные: <b>' + escapeTelegramHtml_(formatTelegramMoney_(cash)) + '</b>'
  ].join('\n');
}

function sendTelegramClientCardV13_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const keyboard = [[{text: '➕ Записать тренировку', callback_data: 'sc:' + card.id}]];
  if (card.blockId) {
    keyboard.push([
      {text: '💳 Перевод', callback_data: 'pm:' + card.id + ':transfer'},
      {text: '💵 Наличные', callback_data: 'pm:' + card.id + ':cash'}
    ]);
    keyboard.push([
      {text: '🎁 Подарить', callback_data: 'mg:' + card.id},
      {text: '✏️ Остаток', callback_data: 'ma:' + card.id}
    ]);
    if (card.blockStatus === 'Приостановлен')
      keyboard.push([{text: '▶️ Возобновить блок', callback_data: 'mr:' + card.id}]);
    else if (card.blockStatus === 'Активен')
      keyboard.push([{text: '⏸ Приостановить блок', callback_data: 'mp:' + card.id}]);
    keyboard.push([{text: '✅ Закрыть блок', callback_data: 'mcl:' + card.id}]);
  } else {
    keyboard.push([{text: '📦 Новый блок', callback_data: 'nb:' + card.id}]);
    if (getSingleTrainingPrice_(card.conditions)) {
      keyboard.push([{text: '💵 Изменить цену разовой', callback_data: 'ops:singlePrice:' + card.id}]);
    }
  }
  keyboard.push([
    {text: '💰 Оплаты', callback_data: 'ops:payments:' + card.id},
    {text: '📦 История блоков', callback_data: 'ops:blocks:' + card.id}
  ]);
  keyboard.push([
    {text: '✏️ Имя', callback_data: 'ops:rename:' + card.id},
    {text: '📝 Заметка', callback_data: 'mn:' + card.id}
  ]);
  if (!card.blockId) keyboard.push([{text: '🗄 В архив', callback_data: 'ops:archive:' + card.id}]);
  keyboard.push([
    {text: '🔄 Обновить', callback_data: 'cl:' + card.id},
    {text: '🔙 Клиенты', callback_data: 'clp:0'}
  ]);
  const markup = {inline_keyboard: keyboard};
  const text = buildTelegramClientCardText_(card);
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramClientListV13_(chatId, requestedPage, messageId) {
  const clients = getTelegramActiveClients_();
  const pageCount = Math.max(1, Math.ceil(clients.length / DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE;
  const visible = clients.slice(start, start + DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE);
  const keyboard = visible.map(function(client) {
    const singlePrice = getSingleTrainingPrice_(client.values[10]);
    const rest = client.values[3] ? client.values[6] + ' тр.' : singlePrice ? 'разовые' : 'без блока';
    return [{text: client.name + ' · ' + rest, callback_data: 'cl:' + client.id}];
  });
  if (pageCount > 1) {
    const navigation = [];
    if (page > 0) navigation.push({text: '◀️', callback_data: 'clp:' + (page - 1)});
    navigation.push({text: (page + 1) + '/' + pageCount, callback_data: 'clp:' + page});
    if (page < pageCount - 1) navigation.push({text: '▶️', callback_data: 'clp:' + (page + 1)});
    keyboard.push(navigation);
  }
  keyboard.push([
    {text: '➕ Новый клиент', callback_data: 'nc:start'},
    {text: '🔎 Поиск', callback_data: 'ops:search'}
  ]);
  const text = '<b>Клиенты</b>\n' +
    (clients.length ? 'Выбери клиента для открытия карточки.' : 'Активных клиентов пока нет.');
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramClientPaymentHistory_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.PAYMENTS);
  const rows = [];
  if (sheet.getLastRow() >= 4) {
    sheet.getRange(4, 1, sheet.getLastRow() - 3, 10).getDisplayValues().forEach(function(row) {
      if (row[2] === clientId && row[0]) rows.push(row);
    });
  }
  const lines = ['<b>Оплаты — ' + escapeTelegramHtml_(card.name) + '</b>'];
  rows.slice(-10).reverse().forEach(function(row) {
    lines.push('• ' + escapeTelegramHtml_(row[1]) + ' · ' + escapeTelegramHtml_(row[5]) +
      ' · <b>' + escapeTelegramHtml_(row[6]) + '</b> · ' + escapeTelegramHtml_(row[7]));
  });
  if (!rows.length) lines.push('• Записей пока нет.');
  const keyboard = [];
  const lastConfirmed = rows.slice().reverse().find(function(row) {
    return row[7] === 'Подтверждён';
  });
  if (lastConfirmed) keyboard.push([{text: '↩️ Отменить оплату ' + lastConfirmed[0],
    callback_data: 'ops:voidPayment:' + lastConfirmed[0]}]);
  keyboard.push([{text: '🔙 Карточка', callback_data: 'cl:' + clientId}]);
  telegramEditMessage_(chatId, messageId, lines.join('\n'), {inline_keyboard: keyboard});
}

function sendTelegramClientBlockHistory_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.BLOCKS);
  const rows = [];
  if (sheet.getLastRow() >= 4) {
    sheet.getRange(4, 1, sheet.getLastRow() - 3, 17).getDisplayValues().forEach(function(row) {
      if (row[1] === clientId && row[0]) rows.push(row);
    });
  }
  const lines = ['<b>Блоки — ' + escapeTelegramHtml_(card.name) + '</b>'];
  rows.slice(-10).reverse().forEach(function(row) {
    lines.push('• <b>' + escapeTelegramHtml_(row[0]) + '</b> · ' + escapeTelegramHtml_(row[3]) +
      ' · ' + escapeTelegramHtml_(row[4] || 'без даты') + ' · ' +
      escapeTelegramHtml_(row[8] || '0') + '/' + escapeTelegramHtml_(row[7] || '0') +
      ' · ' + escapeTelegramHtml_(row[10] || '0 ₽'));
  });
  if (!rows.length) lines.push('• Блоков пока нет.');
  telegramEditMessage_(chatId, messageId, lines.join('\n'),
    {inline_keyboard: [[{text: '🔙 Карточка', callback_data: 'cl:' + clientId}]]});
}

function startTelegramRenameClient_(userId, chatId, clientId) {
  const card = getTelegramClientCard_(clientId);
  putTelegramOpsState_(userId, chatId, {action: 'rename', phase: 'input', clientId: clientId, oldName: card.name});
  telegramSendMessage_(chatId, '<b>Переименование клиента</b>\nСейчас: ' +
    escapeTelegramHtml_(card.name) + '\nПришли новое имя.', buildTelegramCancelKeyboard_());
}

function startTelegramSinglePrice_(userId, chatId, clientId) {
  const card = getTelegramClientCard_(clientId);
  putTelegramOpsState_(userId, chatId, {action: 'single_price', phase: 'input', clientId: clientId});
  telegramSendMessage_(chatId, '<b>Цена разовой тренировки — ' + escapeTelegramHtml_(card.name) +
    '</b>\nПришли новую сумму числом.', buildTelegramCancelKeyboard_());
}

function handleTelegramOpsInputV13_(state, userId, chatId, text) {
  try {
    if (state.action === 'search') {
      clearTelegramOpsState_(userId, chatId);
      sendTelegramClientSearch_(chatId, text);
    } else if (state.action === 'rename') {
      state.newName = validateTelegramClientName_(text);
      assertTelegramClientNameAvailable_(state.newName);
      state.phase = 'confirm';
      putTelegramOpsState_(userId, chatId, state);
      telegramSendMessage_(chatId, '<b>Переименовать клиента?</b>\n' +
        escapeTelegramHtml_(state.oldName) + ' → <b>' + escapeTelegramHtml_(state.newName) + '</b>',
        {inline_keyboard: [[{text: '✅ Сохранить', callback_data: 'ops:renameYes'},
          {text: '❌ Отмена', callback_data: 'cl:' + state.clientId}]]});
    } else if (state.action === 'single_price') {
      state.price = validateTelegramMoney_(text);
      state.phase = 'confirm';
      putTelegramOpsState_(userId, chatId, state);
      telegramSendMessage_(chatId, '<b>Сохранить цену?</b>\nНовая цена: <b>' +
        escapeTelegramHtml_(formatTelegramMoney_(state.price)) + '</b>',
        {inline_keyboard: [[{text: '✅ Сохранить', callback_data: 'ops:singlePriceYes'},
          {text: '❌ Отмена', callback_data: 'cl:' + state.clientId}]]});
    }
  } catch (error) {
    telegramSendMessage_(chatId, '<b>Не удалось принять данные</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), buildTelegramCancelKeyboard_());
  }
}

function confirmTelegramRenameClient_(userId, chatId, messageId) {
  const state = getTelegramOpsState_(userId, chatId);
  if (!state || state.action !== 'rename' || state.phase !== 'confirm') throw new Error('Сценарий устарел.');
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
  const row = findRowByValue_(sheet, 1, state.clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  if (!row) throw new Error('Клиент не найден.');
  const beforeName = sheet.getRange(row, 2).getValue();
  const beforeCalendar = sheet.getRange(row, 13, 1, 2).getValues();
  const before = sheet.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS).getValues()[0];
  const oldTitle = String(before[12] || '').trim();
  const aliases = String(before[13] || '').split(/[,;\n]+/).map(function(v) { return v.trim(); }).filter(Boolean);
  if (oldTitle && aliases.indexOf(oldTitle) === -1) aliases.push(oldTitle);
  sheet.getRange(row, 2).setValue(state.newName);
  sheet.getRange(row, 13).setValue(makeTelegramClientCalendarTitle_(state.newName));
  sheet.getRange(row, 14).setValue(aliases.join(', '));
  telegramAuditAction_('rename_client', state.clientId,
    state.oldName + ' → ' + state.newName,
    {type: 'compound', items: [
      makeTelegramRestoreRangeUndo_(sheet, row, 2, [[beforeName]]),
      makeTelegramRestoreRangeUndo_(sheet, row, 13, beforeCalendar)
    ]});
  clearTelegramOpsState_(userId, chatId);
  telegramEditMessage_(chatId, messageId, '<b>Клиент переименован</b>\nСтарое название добавлено в календарные псевдонимы.',
    {inline_keyboard: [[{text: '👤 Карточка', callback_data: 'cl:' + state.clientId}]]});
}

function confirmTelegramSinglePrice_(userId, chatId, messageId) {
  const state = getTelegramOpsState_(userId, chatId);
  if (!state || state.action !== 'single_price' || state.phase !== 'confirm') throw new Error('Сценарий устарел.');
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
  const row = findRowByValue_(sheet, 1, state.clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  if (!row) throw new Error('Клиент не найден.');
  const before = sheet.getRange(row, 11).getValue();
  const cleaned = String(before || '').replace(/Разовая тренировка\s*[—-]\s*[\d\s ]+(?:₽|р\.?)/i, '').trim();
  const next = 'Разовая тренировка — ' + formatTelegramMoney_(state.price) + (cleaned ? '\n' + cleaned : '');
  sheet.getRange(row, 11).setValue(next);
  telegramAuditAction_('single_price', state.clientId, 'Цена разовой: ' + formatTelegramMoney_(state.price),
    makeTelegramRestoreRangeUndo_(sheet, row, 11, [[before]]));
  clearTelegramOpsState_(userId, chatId);
  telegramEditMessage_(chatId, messageId, '<b>Цена обновлена</b>\n' + escapeTelegramHtml_(formatTelegramMoney_(state.price)),
    {inline_keyboard: [[{text: '👤 Карточка', callback_data: 'cl:' + state.clientId}]]});
}

function showTelegramArchiveClient_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.blockId) throw new Error('Сначала закрой активный блок.');
  telegramEditMessage_(chatId, messageId, '<b>Перенести клиента в архив?</b>\n' +
    escapeTelegramHtml_(card.name) + '\nИстория тренировок, блоков и оплат сохранится.',
    {inline_keyboard: [[{text: '🗄 В архив', callback_data: 'ops:archiveYes:' + clientId},
      {text: '❌ Отмена', callback_data: 'cl:' + clientId}]]});
}

function confirmTelegramArchiveClient_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.blockId) throw new Error('У клиента появился активный блок.');
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.CLIENTS);
  const row = findRowByValue_(sheet, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  const before = sheet.getRange(row, 3).getValue();
  sheet.getRange(row, 3).setValue('Архив');
  telegramAuditAction_('archive_client', clientId, 'Клиент перенесён в архив',
    makeTelegramRestoreRangeUndo_(sheet, row, 3, [[before]]));
  telegramEditMessage_(chatId, messageId, '<b>Клиент перенесён в архив</b>\nИстория сохранена.',
    {inline_keyboard: [[{text: '🔙 Клиенты', callback_data: 'clp:0'}]]});
}

function showTelegramVoidPayment_(chatId, operationId, messageId) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.PAYMENTS);
  const row = findRowByValue_(sheet, 1, operationId, 4);
  if (!row) throw new Error('Оплата не найдена.');
  const values = sheet.getRange(row, 1, 1, 10).getDisplayValues()[0];
  if (values[7] !== 'Подтверждён') throw new Error('Оплата уже не подтверждена.');
  telegramEditMessage_(chatId, messageId,
    '<b>Отменить ошибочную оплату?</b>\n' + escapeTelegramHtml_(values[0]) +
    ' · <b>' + escapeTelegramHtml_(values[6]) + '</b>\n' +
    'Запись сохранится в истории со статусом «Отменён».',
    {inline_keyboard: [[
      {text: '↩️ Отменить оплату', callback_data: 'ops:voidPaymentYes:' + operationId},
      {text: '❌ Назад', callback_data: 'ops:payments:' + values[2]}
    ]]});
}

function confirmTelegramVoidPayment_(chatId, operationId, messageId) {
  const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.PAYMENTS);
  const row = findRowByValue_(sheet, 1, operationId, 4);
  if (!row) throw new Error('Оплата не найдена.');
  const before = sheet.getRange(row, 1, 1, 10).getValues();
  if (String(before[0][7]) !== 'Подтверждён') throw new Error('Оплата уже отменена или изменена.');
  sheet.getRange(row, 8).setValue('Отменён');
  sheet.getRange(row, 10).setValue(appendTelegramAuditNote_(before[0][9], 'Отменено через Telegram'));
  telegramAuditAction_('void_payment', operationId, 'Отменена ошибочная оплата ' + operationId,
    makeTelegramRestoreRangeUndo_(sheet, row, 1, before));
  telegramEditMessage_(chatId, messageId, '<b>Оплата отменена</b>\n' + escapeTelegramHtml_(operationId),
    {inline_keyboard: [[{text: '👥 Клиенты', callback_data: 'clp:0'}]]});
}

function createTelegramDataBackup() {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const createdAt = new Date();
    const backupId = 'BK-' + Utilities.formatDate(
      createdAt,
      timeZone,
      'yyyyMMdd-HHmmss'
    ) + '-' + String(createdAt.getMilliseconds()).padStart(3, '0');
    const target = getOrCreateDmsBackupSheet_(ss);
    const rows = buildDmsBackupRows_(ss, backupId, createdAt);
    const firstRow = Math.max(target.getLastRow() + 1, 2);

    target.getRange(firstRow, 1, rows.length, 5).setValues(rows);
    SpreadsheetApp.flush();

    const validation = validateDmsBackupById_(target, backupId, createdAt);
    if (!validation.ok) {
      throw new Error('Резервная копия не прошла проверку: ' + validation.issues.join('; '));
    }

    telegramAuditAction_('backup', backupId, 'Создана и проверена резервная копия данных', null);
    return backupId;
  } finally {
    lock.releaseLock();
  }
}

function getDmsBackupSheetNames_() {
  return [
    DMS_TELEGRAM_FINAL.CLIENTS,
    DMS_TELEGRAM_FINAL.BLOCKS,
    DMS_TELEGRAM_FINAL.PAYMENTS,
    DMS_TELEGRAM_FINAL.LOG,
    DMS_TELEGRAM.QUEUE
  ];
}

function getOrCreateDmsBackupSheet_(ss) {
  let target = ss.getSheetByName(DMS_TELEGRAM_FINAL.BACKUPS);
  if (target) return target;

  target = ss.insertSheet(DMS_TELEGRAM_FINAL.BACKUPS);
  target.getRange(1, 1, 1, 5).setValues([
    ['ID', 'Дата', 'Лист', 'Часть', 'JSON']
  ]);
  target.setFrozenRows(1);
  return target;
}

function buildDmsBackupRows_(ss, backupId, createdAt) {
  const rows = [];
  const chunkSize = 40000;

  getDmsBackupSheetNames_().forEach(function(name) {
    const sheet = getRequiredSheet_(ss, name);
    const json = JSON.stringify(
      serializeTelegramUndoValues_(sheet.getDataRange().getValues())
    );

    for (let offset = 0, part = 1; offset < json.length; offset += chunkSize, part++) {
      rows.push([
        backupId,
        createdAt,
        name,
        part,
        json.substring(offset, offset + chunkSize)
      ]);
    }
  });
  return rows;
}

function validateLatestDmsBackup() {
  const ss = SpreadsheetApp.getActive();
  const target = ss.getSheetByName(DMS_TELEGRAM_FINAL.BACKUPS);
  if (!target || target.getLastRow() < 2) {
    return {
      ok: false,
      backupId: '',
      ageHours: null,
      issues: ['Резервные копии отсутствуют'],
      sheets: {},
      summary: 'Резервные копии отсутствуют'
    };
  }

  const rows = target.getRange(2, 1, target.getLastRow() - 1, 5).getValues();
  let latestId = '';
  let latestDate = null;

  rows.forEach(function(row) {
    const backupId = String(row[0] || '').trim();
    const createdAt = row[1];
    if (!backupId || !(createdAt instanceof Date) || isNaN(createdAt.getTime())) return;
    if (!latestDate || createdAt > latestDate) {
      latestDate = createdAt;
      latestId = backupId;
    }
  });

  if (!latestId) {
    return {
      ok: false,
      backupId: '',
      ageHours: null,
      issues: ['Не найдена копия с корректной датой'],
      sheets: {},
      summary: 'Не найдена копия с корректной датой'
    };
  }

  return validateDmsBackupRows_(rows, latestId, new Date());
}

function validateDmsBackupById_(target, backupId, now) {
  const lastRow = target.getLastRow();
  const rows = lastRow < 2
    ? []
    : target.getRange(2, 1, lastRow - 1, 5).getValues();
  return validateDmsBackupRows_(rows, backupId, now || new Date());
}

function validateDmsBackupRows_(rows, backupId, now) {
  const issues = [];
  const grouped = {};
  let createdAt = null;

  (rows || []).forEach(function(row) {
    if (String(row[0] || '').trim() !== String(backupId || '').trim()) return;
    const name = String(row[2] || '').trim();
    const part = Number(row[3]);
    if (!name) return;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push({part: part, json: String(row[4] || '')});
    if (!createdAt && row[1] instanceof Date && !isNaN(row[1].getTime())) {
      createdAt = row[1];
    }
  });

  const sheets = {};
  getDmsBackupSheetNames_().forEach(function(name) {
    const chunks = grouped[name] || [];
    if (!chunks.length) {
      issues.push('Нет данных листа «' + name + '»');
      return;
    }

    chunks.sort(function(left, right) { return left.part - right.part; });
    chunks.forEach(function(chunk, index) {
      if (chunk.part !== index + 1) {
        issues.push('Нарушен порядок частей листа «' + name + '»');
      }
    });

    try {
      const serialized = JSON.parse(chunks.map(function(chunk) {
        return chunk.json;
      }).join(''));
      if (!Array.isArray(serialized) || serialized.some(function(row) {
        return !Array.isArray(row);
      })) {
        throw new Error('данные не являются двумерным массивом');
      }

      const restored = deserializeTelegramUndoValues_(serialized);
      const roundTrip = JSON.stringify(serializeTelegramUndoValues_(restored));
      if (roundTrip !== JSON.stringify(serialized)) {
        throw new Error('контрольное восстановление изменило данные');
      }
      sheets[name] = {
        parts: chunks.length,
        rows: serialized.length,
        columns: serialized.length && serialized[0] ? serialized[0].length : 0
      };
    } catch (error) {
      issues.push('Лист «' + name + '»: ' + (error.message || String(error)));
    }
  });

  const ageHours = createdAt && now instanceof Date
    ? Math.max(0, (now.getTime() - createdAt.getTime()) / 3600000)
    : null;
  if (!createdAt) issues.push('Не указана корректная дата копии');
  if (ageHours !== null && ageHours > 48) {
    issues.push('Последняя копия старше 48 часов');
  }

  const report = {
    ok: issues.length === 0,
    backupId: String(backupId || ''),
    createdAt: createdAt,
    ageHours: ageHours,
    issues: issues,
    sheets: sheets
  };
  report.summary = report.ok
    ? 'Копия ' + report.backupId + ' проверена; листов: ' + Object.keys(sheets).length
    : 'Копия ' + (report.backupId || 'не определена') + ': ' + issues.join('; ');
  return report;
}

function runDmsBackupRestoreDryRun() {
  const report = validateLatestDmsBackup();
  console.log(JSON.stringify(report));
  return report;
}

function createDmsAutomaticBackup() {
  const backupId = createTelegramDataBackup();
  console.log('Автоматическая резервная копия создана: ' + backupId);
  return backupId;
}

function installDmsBackupTrigger() {
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'createDmsAutomaticBackup';
  }).forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('createDmsAutomaticBackup')
    .timeBased()
    .atHour(3)
    .everyDays(1)
    .inTimezone('Europe/Moscow')
    .create();

  return 'Ежедневная резервная копия назначена на 03:00 Europe/Moscow.';
}

function telegramAuditAction_(action, entity, description, undoPayload) {
  try {
    const sheet = getOrCreateTelegramAuditSheet_();
    const id = 'AU-' + Utilities.formatDate(new Date(),
      SpreadsheetApp.getActive().getSpreadsheetTimeZone() || 'Europe/Moscow', 'yyyyMMddHHmmss') +
      '-' + Utilities.getUuid();
    const compensation = sealDmsDomainUndo_(undoPayload, id, action, entity);
    sheet.appendRow([id, new Date(), action, entity || '', description || '',
      compensation ? JSON.stringify(compensation) : '', false, 'Telegram']);
    return id;
  } catch (error) {
    console.error('Audit error: ' + (error.message || String(error)));
    return '';
  }
}

function getOrCreateTelegramAuditSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(DMS_TELEGRAM_FINAL.AUDIT);
  if (!sheet) {
    sheet = ss.insertSheet(DMS_TELEGRAM_FINAL.AUDIT);
    sheet.getRange(1, 1, 1, DMS_TELEGRAM_FINAL.AUDIT_HEADERS.length)
      .setValues([DMS_TELEGRAM_FINAL.AUDIT_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function makeTelegramRestoreRangeUndo_(sheet, row, column, values) {
  return {type: 'restore_range', sheet: sheet.getName(), row: row, column: column,
    values: serializeTelegramUndoValues_(values),
    expected: serializeTelegramUndoValues_(sheet.getRange(row, column, values.length, values[0].length).getValues())};
}

function serializeTelegramUndoValues_(values) {
  return values.map(function(row) {
    return row.map(function(value) {
      return value instanceof Date ? {__date: value.toISOString()} : value;
    });
  });
}

function deserializeTelegramUndoValues_(values) {
  return values.map(function(row) {
    return row.map(function(value) {
      return value && value.__date ? new Date(value.__date) : value;
    });
  });
}

function showTelegramUndoConfirmation_(chatId, messageId) {
  const item = getTelegramLastUndoableAudit_();
  if (!item) {
    const text = '<b>Откатывать нечего</b>\nПоследних безопасно отменяемых действий нет.';
    if (messageId) telegramEditMessage_(chatId, messageId, text,
      {inline_keyboard: [[{text: '🔙 Назад', callback_data: 'ops:more'}]]});
    else telegramSendMessage_(chatId, text, null);
    return;
  }
  let plan;
  try { plan = JSON.parse(item.payload); } catch (ignore) {}
  if (!plan || plan.type !== 'domain_compensation' || plan.version !== 1) {
    telegramSendMessage_(chatId, 'Для этого старого действия автоматическая отмена недоступна. Требуется ручная сверка.', null);
    return;
  }
  const descriptions = {
    restore_fields: 'Будут восстановлены предыдущие значения.',
    retire_client: 'Клиент будет перенесён в архив; история сохранится.',
    retire_block: 'Блок будет закрыт; запись и исходные условия сохранятся в истории.',
    void_payment: 'Оплата будет помечена отменённой.',
    move_calendar_event: 'Событие будет возвращено на прежнее время.',
    delete_calendar_event: 'Созданное событие будет удалено.'
  };
  const effects = plan.steps.map(function(step) { return descriptions[step.kind]; })
    .filter(function(value, index, items) { return value && items.indexOf(value) === index; });
  const text = '<b>Отменить последнее действие?</b>\n' +
    escapeTelegramHtml_(item.description) + '\n\n' + effects.join('\n') +
    '\nЕсли появились зависимые записи, отмена будет отклонена.';
  const markup = {inline_keyboard: [[
    {text: '↩️ Отменить', callback_data: 'ops:undoYes:' + item.id},
    {text: '❌ Назад', callback_data: 'ops:more'}
  ]]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function getTelegramLastUndoableAudit_() {
  const sheet = getOrCreateTelegramAuditSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const first = Math.max(2, last - DMS_TELEGRAM_FINAL.MAX_AUDIT_SCAN + 1);
  const rows = sheet.getRange(first, 1, last - first + 1, 8).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i][0] && rows[i][5] && rows[i][6] !== true) {
      return {row: first + i, id: String(rows[i][0]), description: String(rows[i][4]), payload: String(rows[i][5])};
    }
  }
  return null;
}

function performTelegramUndo_(auditId) {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const sheet = getOrCreateTelegramAuditSheet_();
    const row = findRowByValue_(sheet, 1, auditId, 2);
    if (!row) throw new Error('Запись отката не найдена.');
    const values = sheet.getRange(row, 1, 1, 8).getValues()[0];
    if (values[6] === true) throw new Error('Это действие уже отменено.');
    if (!values[5]) throw new Error('Это действие нельзя отменить автоматически.');
    const latest = getTelegramLastUndoableAudit_();
    if (!latest || latest.id !== auditId) {
      throw new Error('Появилось более новое действие. Открой откат заново.');
    }
    const payload = JSON.parse(values[5]);
    validateDmsDomainUndo_(payload, values);
    applyDmsDomainUndo_(payload);
    sheet.getRange(row, 7).setValue(true);
    telegramAuditAction_('undo', auditId,
      'Отменено: ' + String(values[4] || ''), null);
  } finally {
    lock.releaseLock();
  }
}

function applyTelegramUndoPayload_(payload, validated) {
  // Generic historical clear/restore payloads are never an execution authority.
  validateDmsDomainUndo_(payload);
  applyDmsDomainUndo_(payload);
}

function validateTelegramUndoRange_(sheet, row, column, values) {
  const startRow = Number(row);
  const startColumn = Number(column);
  if (!Array.isArray(values) || !values.length || !Array.isArray(values[0]) ||
      !values[0].length) {
    throw new Error('В откате указан пустой диапазон.');
  }
  const width = values[0].length;
  if (values.some(function(item) {
    return !Array.isArray(item) || item.length !== width;
  })) {
    throw new Error('В откате указан неровный диапазон.');
  }
  if (!Number.isInteger(startRow) || startRow < 1 ||
      !Number.isInteger(startColumn) || startColumn < 1 ||
      startRow + values.length - 1 > sheet.getMaxRows() ||
      startColumn + width - 1 > sheet.getMaxColumns()) {
    throw new Error('Диапазон отката выходит за границы листа «' +
      sheet.getName() + '».');
  }
}

function makeTelegramUndoValidationMatrix_(rows, columns) {
  const height = Number(rows);
  const width = Number(columns);
  if (!Number.isInteger(height) || height < 1 ||
      !Number.isInteger(width) || width < 1) {
    throw new Error('В откате указан некорректный размер диапазона.');
  }
  return Array.from({length: height}, function() {
    return Array(width).fill(null);
  });
}

function sendTelegramAuditHistory_(chatId, messageId) {
  const sheet = getOrCreateTelegramAuditSheet_();
  const last = sheet.getLastRow();
  const lines = ['<b>Последние действия</b>'];
  if (last >= 2) {
    const first = Math.max(2, last - 9);
    sheet.getRange(first, 1, last - first + 1, 8).getDisplayValues().reverse().forEach(function(row) {
      lines.push('• ' + escapeTelegramHtml_(row[1]) + ' · ' + escapeTelegramHtml_(row[4]) +
        (row[6] === 'TRUE' ? ' <i>(отменено)</i>' : ''));
    });
  } else lines.push('• История пока пуста.');
  const markup = {inline_keyboard: [
    [{text: '↩️ Отменить последнее', callback_data: 'ops:undo'}],
    [{text: '🔙 Назад', callback_data: 'ops:more'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, lines.join('\n'), markup);
  else telegramSendMessage_(chatId, lines.join('\n'), markup);
}

function makeTelegramOpsCacheKey_(userId, chatId) {
  return DMS_TELEGRAM_FINAL.OPS_CACHE_PREFIX + String(userId) + '_' + String(chatId);
}

function putTelegramOpsState_(userId, chatId, state) {
  ensureTelegramSecureFlowId_(state);
  CacheService.getScriptCache().put(makeTelegramOpsCacheKey_(userId, chatId),
    JSON.stringify(state), DMS_TELEGRAM_FINAL.CACHE_TTL_SECONDS);
}

function getTelegramOpsState_(userId, chatId) {
  const confirmed = getDmsConfirmedState_('ops', userId, chatId);
  if (confirmed !== undefined) return confirmed;
  const raw = CacheService.getScriptCache().get(makeTelegramOpsCacheKey_(userId, chatId));
  if (!raw) return null;
  try { return JSON.parse(raw); }
  catch (ignore) { clearTelegramOpsState_(userId, chatId); return null; }
}

function clearTelegramOpsState_(userId, chatId) {
  CacheService.getScriptCache().remove(makeTelegramOpsCacheKey_(userId, chatId));
}

function appendTelegramPayment_(state) {
  const ss = SpreadsheetApp.getActive();
  const payments = getRequiredSheet_(ss, DMS_TELEGRAM_CLIENTS.PAYMENTS);
  const row = findTelegramEmptyPaymentRow_(payments);
  ensureDmsSheetRowCapacity_(payments, row);
  const operationId = makeNextTelegramPaymentId_(payments);
  const now = new Date();
  if (payments.getLastRow() >= DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW) {
    const template = payments.getRange(DMS_TELEGRAM_CLIENTS.PAYMENT_FIRST_ROW, 1, 1,
      DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS);
    const target = payments.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS);
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  }
  payments.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS).setValues([[
    operationId, now, state.clientId, state.blockId, 'Оплата', state.method,
    Number(state.amount), 'Подтверждён', now, 'Внесено через Telegram' +
      (state.secureOperationId ? ' [tgop:' + state.secureOperationId + ']' : '')
  ]]);
  telegramAuditAction_('payment', operationId,
    'Оплата ' + state.clientId + ': ' + formatTelegramMoney_(Number(state.amount)),
    {type: 'clear_range', sheet: payments.getName(), row: row, column: 1,
      rows: 1, columns: DMS_TELEGRAM_CLIENTS.PAYMENT_COLUMNS});
  SpreadsheetApp.flush();
  return operationId;
}

function telegramHelpText_() {
  return [
    '<b>DMS Fitness — управление</b>',
    'Основные действия доступны кнопками.',
    '',
    '/today — сегодняшний день',
    '/yesterday — вчерашний день',
    '/clients — клиенты',
    '/report — отчёты',
    '/settings — настройки и история',
    '/undo — отменить последнее действие',
    '/cancel — отменить текущий сценарий'
  ].join('\n');
}

function myFunctionTelegramFinal_() {
}
