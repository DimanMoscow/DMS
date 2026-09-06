// DMS Telegram upcoming-calendar actions extension v17.

function handleTelegramOpsCallback_(query, data, userId, chatId, messageId) {
  if (data === 'ops:health') {
    try {
      telegramAnswerCallback_(query.id, 'Проверяю систему', false);
      sendTelegramSystemHealth_(chatId, messageId);
    } catch (error) {
      telegramSendMessage_(chatId, '<b>Проверка не выполнена</b>\n' +
        escapeTelegramHtml_(error.message || String(error)), null);
    }
    return;
  }

  try {
    if (data === 'ops:more') sendTelegramMoreMenu_(chatId, messageId);
    else if (data === 'ops:settings') sendTelegramSettings_(chatId, messageId);
    else if (data.indexOf('ops:toggle:') === 0) {
      toggleTelegramSetting_(data.substring(11));
      sendTelegramSettings_(chatId, messageId);
    } else if (data === 'ops:undo') showTelegramUndoConfirmation_(chatId, messageId);
    else if (data.indexOf('ops:undoYes:') === 0) {
      performTelegramUndo_(data.substring(12));
      telegramEditMessage_(chatId, messageId,
        '<b>Последнее действие отменено</b>\nДанные восстановлены.',
        {inline_keyboard: [[{text: '🧾 История действий', callback_data: 'ops:audit'}]]});
    } else if (data === 'ops:audit') sendTelegramAuditHistory_(chatId, messageId);
    else if (data === 'ops:backup') {
      const backupId = createTelegramDataBackup();
      telegramEditMessage_(chatId, messageId,
        '<b>Резервная копия создана</b>\n' + escapeTelegramHtml_(backupId),
        {inline_keyboard: [[{text: '🔙 Назад', callback_data: 'ops:more'}]]});
    } else if (data === 'ops:reports') sendTelegramReportMenu_(chatId, messageId);
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
    } else if (data.indexOf('ops:blockEdit:') === 0) {
      sendTelegramBlockEditMenu_(chatId, data.substring(14), messageId);
    } else if (data.indexOf('ops:blockTotal:') === 0) {
      startTelegramBlockEdit_(userId, chatId, data.substring(15), 'total');
    } else if (data.indexOf('ops:blockPrice:') === 0) {
      startTelegramBlockEdit_(userId, chatId, data.substring(15), 'price');
    } else if (data.indexOf('ops:blockDate:') === 0) {
      startTelegramBlockEdit_(userId, chatId, data.substring(14), 'date');
    } else if (data === 'ops:blockEditYes') {
      confirmTelegramBlockEdit_(userId, chatId, messageId);
    } else if (data.indexOf('ops:up:') === 0) {
      sendTelegramUpcomingMenu_(userId, chatId, data.substring(7), messageId);
    } else if (data.indexOf('ops:ue:') === 0) {
      sendTelegramUpcomingEventMenu_(userId, chatId, Number(data.substring(7)), messageId);
    } else if (data.indexOf('ops:um:') === 0) {
      startTelegramUpcomingMove_(userId, chatId, Number(data.substring(7)));
    } else if (data === 'ops:umYes') {
      confirmTelegramUpcomingMove_(userId, chatId, messageId);
    } else if (data.indexOf('ops:uc:') === 0) {
      showTelegramUpcomingCancelConfirmation_(userId, chatId,
        Number(data.substring(7)), messageId);
    } else if (data === 'ops:ucYes') {
      confirmTelegramUpcomingCancellation_(userId, chatId, messageId);
    } else if (data.indexOf('ops:archive:') === 0) {
      showTelegramArchiveClient_(chatId, data.substring(12), messageId);
    } else if (data.indexOf('ops:archiveYes:') === 0) {
      confirmTelegramArchiveClient_(chatId, data.substring(15), messageId);
    } else if (data.indexOf('ops:archiveList:') === 0) {
      sendTelegramArchivedClientList_(chatId, Number(data.substring(16)) || 0, messageId);
    } else if (data.indexOf('ops:restoreYes:') === 0) {
      confirmTelegramRestoreClient_(chatId, data.substring(15), messageId);
    } else if (data.indexOf('ops:restore:') === 0) {
      showTelegramRestoreClient_(chatId, data.substring(12), messageId);
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

function sendTelegramClientCard_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.status === 'Архив') {
    sendTelegramArchivedClientCard_(chatId, card, messageId);
    return;
  }
  const keyboard = [
    [{text: '➕ Записать тренировку', callback_data: 'sc:' + card.id}],
    [{text: '🗓 Управление записями', callback_data: 'ops:up:' + card.id}]
  ];
  if (card.blockId) {
    keyboard.push([
      {text: '💳 Перевод', callback_data: 'pm:' + card.id + ':transfer'},
      {text: '💵 Наличные', callback_data: 'pm:' + card.id + ':cash'}
    ]);
    keyboard.push([
      {text: '🎁 Подарить', callback_data: 'mg:' + card.id},
      {text: '✏️ Остаток', callback_data: 'ma:' + card.id}
    ]);
    keyboard.push([{text: '🧰 Параметры блока', callback_data: 'ops:blockEdit:' + card.id}]);
    if (card.blockStatus === 'Приостановлен')
      keyboard.push([{text: '▶️ Возобновить блок', callback_data: 'mr:' + card.id}]);
    else if (card.blockStatus === 'Активен')
      keyboard.push([{text: '⏸ Приостановить блок', callback_data: 'mp:' + card.id}]);
    keyboard.push([{text: '✅ Закрыть блок', callback_data: 'mcl:' + card.id}]);
  } else {
    keyboard.push([{text: '📦 Новый блок', callback_data: 'nb:' + card.id}]);
    if (getSingleTrainingPrice_(card.conditions))
      keyboard.push([{text: '💵 Изменить цену разовой', callback_data: 'ops:singlePrice:' + card.id}]);
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
  keyboard.push([{text: '🏠 Меню', callback_data: 'nav:menu'}]);
  const markup = {inline_keyboard: keyboard};
  const text = buildTelegramClientCardText_(card);
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function handleTelegramOpsInput_(state, userId, chatId, text) {
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
    } else if (state.action === 'block_edit') {
      prepareTelegramBlockEditConfirmation_(state, userId, chatId, text);
    } else if (state.action === 'upcoming' && state.phase === 'move_input') {
      prepareTelegramUpcomingMoveConfirmation_(state, userId, chatId, text);
    }
  } catch (error) {
    telegramSendMessage_(chatId, '<b>Не удалось принять данные</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), buildTelegramCancelKeyboard_());
  }
}

function sendTelegramUpcomingMenu_(userId, chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.status === 'Архив') throw new Error('Клиент находится в архиве.');
  const result = getTelegramUpcomingClientTrainings_(clientId, new Date(), 12);
  const items = result.items.map(function(item) {
    return {
      id: item.id,
      label: item.label,
      startMs: item.startMs,
      endMs: item.endMs
    };
  });
  putTelegramOpsState_(userId, chatId, {
    action: 'upcoming', phase: 'list', clientId: clientId,
    clientName: card.name, calendarId: result.calendarId, items: items
  });
  const lines = ['<b>Записи — ' + escapeTelegramHtml_(card.name) + '</b>'];
  const keyboard = [];
  if (!items.length) lines.push('На ближайшие 45 дней записей нет.');
  else {
    lines.push('Выбери тренировку:');
    items.forEach(function(item, index) {
      keyboard.push([{text: (index + 1) + '. ' + item.label,
        callback_data: 'ops:ue:' + index}]);
    });
    if (result.more) lines.push('', 'Показаны ближайшие 12. Ещё записей: ' + result.more + '.');
  }
  keyboard.push([
    {text: '🔄 Обновить', callback_data: 'ops:up:' + clientId},
    {text: '🔙 Карточка', callback_data: 'cl:' + clientId}
  ]);
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, lines.join('\n'), markup);
  else telegramSendMessage_(chatId, lines.join('\n'), markup);
}

function sendTelegramUpcomingEventMenu_(userId, chatId, index, messageId) {
  const state = getTelegramUpcomingState_(userId, chatId);
  const item = getTelegramUpcomingStateItem_(state, index);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  const text = '<b>' + escapeTelegramHtml_(state.clientName) + '</b>\n' +
    '<b>' + escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + '</b>\n\n' +
    'Что сделать с записью?';
  telegramEditMessage_(chatId, messageId, text, {inline_keyboard: [
    [{text: '↔️ Перенести', callback_data: 'ops:um:' + index}],
    [{text: '🚫 Отменить без списания', callback_data: 'ops:uc:' + index}],
    [{text: '🔙 К списку', callback_data: 'ops:up:' + state.clientId}]
  ]});
}

function startTelegramUpcomingMove_(userId, chatId, index) {
  const state = getTelegramUpcomingState_(userId, chatId);
  const item = getTelegramUpcomingStateItem_(state, index);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  state.phase = 'move_input';
  state.selectedIndex = index;
  putTelegramOpsState_(userId, chatId, state);
  telegramSendMessage_(chatId,
    '<b>Перенос тренировки</b>\n' + escapeTelegramHtml_(state.clientName) + '\n' +
    'Сейчас: <b>' + escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + '</b>\n\n' +
    'Пришли новые дату и время, например: <code>29.08 19:30</code>.',
    buildTelegramCancelKeyboard_());
}

function prepareTelegramUpcomingMoveConfirmation_(state, userId, chatId, text) {
  const item = getTelegramUpcomingStateItem_(state, state.selectedIndex);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  const oldStart = new Date(event.start.dateTime);
  const oldEnd = new Date(event.end.dateTime);
  const duration = Math.max(oldEnd.getTime() - oldStart.getTime(), 5 * 60 * 1000);
  const newStart = parseTelegramMoveDate_(text, timeZone, new Date());
  const newEnd = new Date(newStart.getTime() + duration);
  const conflicts = listTelegramUpcomingMoveConflicts_(
    state.calendarId, item.id, newStart, newEnd, timeZone);
  state.phase = 'move_confirm';
  state.newStartMs = newStart.getTime();
  putTelegramOpsState_(userId, chatId, state);
  const lines = [
    '<b>Перенести тренировку?</b>',
    escapeTelegramHtml_(state.clientName),
    escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + ' →',
    '<b>' + escapeTelegramHtml_(Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm') +
      '–' + Utilities.formatDate(newEnd, timeZone, 'HH:mm')) + '</b>'
  ];
  if (conflicts.length) {
    lines.push('', '<b>⚠️ Есть пересечения:</b>');
    conflicts.slice(0, 5).forEach(function(conflict) {
      lines.push('• ' + escapeTelegramHtml_(conflict));
    });
  }
  telegramSendMessage_(chatId, lines.join('\n'), {inline_keyboard: [[
    {text: '✅ Перенести', callback_data: 'ops:umYes'},
    {text: '❌ Отмена', callback_data: 'ops:ue:' + state.selectedIndex}
  ]]});
}

function confirmTelegramUpcomingMove_(userId, chatId, messageId) {
  const state = getTelegramUpcomingState_(userId, chatId, 'move_confirm');
  const item = getTelegramUpcomingStateItem_(state, state.selectedIndex);
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  try {
    const event = getTelegramUpcomingLiveEvent_(state, item);
    const timeZone = getTelegramUpcomingTimeZone_();
    const oldStart = new Date(event.start.dateTime);
    const oldEnd = new Date(event.end.dateTime);
    const newStart = new Date(Number(state.newStartMs));
    if (isNaN(newStart.getTime()) || newStart.getTime() <= Date.now())
      throw new Error('Новое время уже прошло. Введи его заново.');
    const duration = Math.max(oldEnd.getTime() - oldStart.getTime(), 5 * 60 * 1000);
    const newEnd = new Date(newStart.getTime() + duration);
    assertTelegramUpcomingQueueEditable_(state.calendarId, item.id);
    dmsCalendarPatch_({
      start: {dateTime: newStart.toISOString(), timeZone: timeZone},
      end: {dateTime: newEnd.toISOString(), timeZone: timeZone}
    }, state.calendarId, item.id, {sendUpdates: 'none'});
    let queueUndo;
    try {
      queueUndo = updateTelegramQueueForUpcomingMove_(
        state.calendarId, item.id, newStart, newEnd);
    } catch (error) {
      dmsCalendarPatch_({
        start: {dateTime: oldStart.toISOString(), timeZone: timeZone},
        end: {dateTime: oldEnd.toISOString(), timeZone: timeZone}
      }, state.calendarId, item.id, {sendUpdates: 'none'});
      throw error;
    }
    const undoItems = queueUndo ? [queueUndo] : [];
    undoItems.push({type: 'move_calendar_event', calendarId: state.calendarId,
      eventId: item.id, start: oldStart.toISOString(), end: oldEnd.toISOString(),
      timeZone: timeZone});
    telegramAuditAction_('move_future_training', item.id,
      state.clientName + ': перенос на ' +
        Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm'),
      {type: 'compound', items: undoItems});
    clearTelegramOpsState_(userId, chatId);
    telegramEditMessage_(chatId, messageId,
      '<b>Тренировка перенесена</b>\n' + escapeTelegramHtml_(state.clientName) + '\n' +
      '<b>' + escapeTelegramHtml_(Utilities.formatDate(newStart, timeZone, 'dd.MM.yyyy HH:mm') +
        '–' + Utilities.formatDate(newEnd, timeZone, 'HH:mm')) + '</b>\n\n' +
      'Google Calendar обновлён; Apple Calendar подтянет изменение при синхронизации.',
      {inline_keyboard: [[
        {text: '🗓 Записи', callback_data: 'ops:up:' + state.clientId},
        {text: '👤 Карточка', callback_data: 'cl:' + state.clientId}
      ]]});
  } finally {
    lock.releaseLock();
  }
}

function showTelegramUpcomingCancelConfirmation_(userId, chatId, index, messageId) {
  const state = getTelegramUpcomingState_(userId, chatId);
  const item = getTelegramUpcomingStateItem_(state, index);
  const event = getTelegramUpcomingLiveEvent_(state, item);
  const timeZone = getTelegramUpcomingTimeZone_();
  state.phase = 'cancel_confirm';
  state.selectedIndex = index;
  putTelegramOpsState_(userId, chatId, state);
  telegramEditMessage_(chatId, messageId,
    '<b>Отменить тренировку без списания?</b>\n' +
    escapeTelegramHtml_(state.clientName) + '\n' +
    '<b>' + escapeTelegramHtml_(formatTelegramUpcomingTraining_(event, timeZone)) + '</b>\n\n' +
    'Событие будет удалено из Google Calendar и затем исчезнет из Apple Calendar.',
    {inline_keyboard: [[
      {text: '🚫 Да, отменить', callback_data: 'ops:ucYes'},
      {text: '❌ Назад', callback_data: 'ops:ue:' + index}
    ]]});
}

function confirmTelegramUpcomingCancellation_(userId, chatId, messageId) {
  const state = getTelegramUpcomingState_(userId, chatId, 'cancel_confirm');
  const item = getTelegramUpcomingStateItem_(state, state.selectedIndex);
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  try {
    const event = getTelegramUpcomingLiveEvent_(state, item);
    const timeZone = getTelegramUpcomingTimeZone_();
    const label = formatTelegramUpcomingTraining_(event, timeZone);
    assertTelegramUpcomingQueueEditable_(state.calendarId, item.id);
    const queueUndo = updateTelegramQueueForUpcomingCancellation_(state.calendarId, item.id);
    try {
      dmsCalendarRemove_(state.calendarId, item.id, {sendUpdates: 'none'});
    } catch (error) {
      if (queueUndo) restoreDmsImmediateQueueCompensation_(queueUndo);
      throw error;
    }
    telegramAuditAction_('cancel_future_training', item.id,
      state.clientName + ': отмена без списания ' + label, null);
    clearTelegramOpsState_(userId, chatId);
    telegramEditMessage_(chatId, messageId,
      '<b>Тренировка отменена без списания</b>\n' +
      escapeTelegramHtml_(state.clientName) + '\n' +
      '<b>' + escapeTelegramHtml_(label) + '</b>\n\n' +
      'Событие удалено из Google Calendar; Apple Calendar подтянет отмену при синхронизации.',
      {inline_keyboard: [[
        {text: '🗓 Записи', callback_data: 'ops:up:' + state.clientId},
        {text: '👤 Карточка', callback_data: 'cl:' + state.clientId}
      ]]});
  } finally {
    lock.releaseLock();
  }
}

function assertTelegramUpcomingQueueEditable_(calendarId, eventId) {
  const found = findTelegramUpcomingQueueEvent_(calendarId, eventId);
  if (found && String(found.values[13] || '') === 'Обработано')
    throw new Error('Эта тренировка уже учтена. Сначала исправь учёт, затем меняй событие.');
}

function getTelegramUpcomingState_(userId, chatId, requiredPhase) {
  const state = getTelegramOpsState_(userId, chatId);
  if (!state || state.action !== 'upcoming')
    throw new Error('Список записей устарел. Открой его из карточки клиента заново.');
  if (requiredPhase && state.phase !== requiredPhase)
    throw new Error('Действие устарело. Открой запись заново.');
  return state;
}

function getTelegramUpcomingStateItem_(state, index) {
  const item = state.items && state.items[index];
  if (!item || !item.id) throw new Error('Запись устарела. Обнови список.');
  return item;
}

function getTelegramUpcomingLiveEvent_(state, item) {
  let event;
  try {
    event = Calendar.Events.get(state.calendarId, item.id);
  } catch (error) {
    if (isCalendarEventMissingError_(error))
      throw new Error('Событие уже удалено из календаря. Обнови список.');
    throw error;
  }
  if (!event || event.status === 'cancelled' || !event.start || !event.start.dateTime ||
      !event.end || !event.end.dateTime)
    throw new Error('Событие уже отменено или не содержит времени.');
  if (new Date(event.start.dateTime).getTime() <= Date.now())
    throw new Error('Управлять можно только ещё не начавшимися тренировками.');
  assertTelegramUpcomingEventClient_(state.clientId, event);
  return event;
}

function assertTelegramUpcomingEventClient_(clientId, event) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
  const row = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  if (!row) throw new Error('Клиент не найден.');
  const values = clients.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS)
    .getDisplayValues()[0];
  const titles = buildTelegramClientCalendarTitleSet_(values[12], values[13]);
  if (!titles[normalizeCalendarTitle_(event.summary)])
    throw new Error('Название события больше не соответствует этому клиенту. Обнови список.');
}

function getTelegramUpcomingTimeZone_() {
  const ss = SpreadsheetApp.getActive();
  return getCalendarSyncSettings_(getRequiredSheet_(ss, DMS_SYNC.SETTINGS)).timeZone;
}

function listTelegramUpcomingMoveConflicts_(calendarId, eventId, start, end, timeZone) {
  const response = Calendar.Events.list(calendarId, {
    timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: true,
    showDeleted: false, orderBy: 'startTime', maxResults: 20, timeZone: timeZone
  });
  return (response.items || []).filter(function(event) {
    return event.status !== 'cancelled' && String(event.id || '') !== String(eventId || '');
  }).map(function(event) {
    if (!event.start || !event.start.dateTime) return 'весь день · ' + String(event.summary || 'Событие');
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = event.end && event.end.dateTime ? new Date(event.end.dateTime) : null;
    return Utilities.formatDate(eventStart, timeZone, 'HH:mm') +
      (eventEnd ? '–' + Utilities.formatDate(eventEnd, timeZone, 'HH:mm') : '') +
      ' · ' + String(event.summary || 'Событие');
  });
}

function updateTelegramQueueForUpcomingMove_(calendarId, eventId, newStart, newEnd) {
  const found = findTelegramUpcomingQueueEvent_(calendarId, eventId);
  if (!found) return null;
  if (String(found.values[13] || '') === 'Обработано')
    throw new Error('Эта тренировка уже учтена. Сначала исправь учёт, затем переноси событие.');
  const before = found.values.slice();
  found.values[1] = newStart;
  found.values[5] = newStart;
  found.values[6] = newEnd;
  found.values[12] = found.values[11] === 'Распознано' ? 'Проведена' : '';
  found.values[13] = 'Ожидает';
  found.values[14] = '';
  found.values[15] = 'Telegram';
  found.values[16] = mergeQueueComment_(found.values[16], 'Событие перенесено через Telegram');
  found.sheet.getRange(found.row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).setValues([found.values]);
  return makeTelegramRestoreRangeUndo_(found.sheet, found.row, 1, [before]);
}

function updateTelegramQueueForUpcomingCancellation_(calendarId, eventId) {
  const found = findTelegramUpcomingQueueEvent_(calendarId, eventId);
  if (!found) return null;
  if (String(found.values[13] || '') === 'Обработано')
    throw new Error('Эта тренировка уже учтена. Сначала исправь учёт, затем отменяй событие.');
  const before = found.values.slice();
  found.values[12] = 'Отмена без списания';
  found.values[13] = 'Обработано';
  found.values[14] = new Date();
  found.values[15] = 'Telegram';
  found.values[16] = mergeQueueComment_(found.values[16],
    'Событие отменено без списания и удалено через Telegram');
  found.sheet.getRange(found.row, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS).setValues([found.values]);
  return makeTelegramRestoreRangeUndo_(found.sheet, found.row, 1, [before]);
}

function findTelegramUpcomingQueueEvent_(calendarId, eventId) {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const lastRow = queue.getLastRow();
  if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return null;
  const rows = queue.getRange(DMS_TELEGRAM.QUEUE_FIRST_ROW, 1,
    lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues();
  for (let index = 0; index < rows.length; index++) {
    if (String(rows[index][2] || '') === String(calendarId || '') &&
        String(rows[index][3] || '') === String(eventId || '')) {
      return {sheet: queue, row: DMS_TELEGRAM.QUEUE_FIRST_ROW + index,
        values: rows[index].slice()};
    }
  }
  return null;
}

function getTelegramUpcomingClientTrainings_(clientId, now, limit, titleSource) {
  const ss = SpreadsheetApp.getActive();
  let titles;
  if (titleSource) {
    titles = buildTelegramClientCalendarTitleSet_(
      titleSource.mainTitle,
      titleSource.aliases
    );
  } else {
    const clients = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
    const row = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
    if (!row) throw new Error('Клиент не найден.');
    const values = clients.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS)
      .getDisplayValues()[0];
    titles = buildTelegramClientCalendarTitleSet_(values[12], values[13]);
  }
  const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
  const config = getCalendarSyncSettings_(settings);
  if (!Object.keys(titles).length)
    return {items: [], more: 0, calendarId: config.calendarId};
  const from = now instanceof Date ? new Date(now.getTime()) : new Date();
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 45);
  const max = Math.max(1, Number(limit) || 5);
  const response = Calendar.Events.list(config.calendarId, {
    timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true,
    showDeleted: false, orderBy: 'startTime', maxResults: 250, timeZone: config.timeZone
  });
  const matched = (response.items || []).filter(function(event) {
    return event.status !== 'cancelled' && event.start && event.start.dateTime &&
      titles[normalizeCalendarTitle_(event.summary)];
  });
  return {
    items: matched.slice(0, max).map(function(event) {
      const start = new Date(event.start.dateTime);
      const end = event.end && event.end.dateTime ? new Date(event.end.dateTime) : null;
      return {id: String(event.id || ''), label: formatTelegramUpcomingTraining_(event, config.timeZone),
        startMs: start.getTime(), endMs: end && !isNaN(end.getTime()) ? end.getTime() : null};
    }),
    more: Math.max(0, matched.length - max),
    calendarId: config.calendarId
  };
}
