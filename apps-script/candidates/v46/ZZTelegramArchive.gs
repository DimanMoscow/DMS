function myFunctionTelegramArchive_() {
  
}


// DMS Telegram archived clients extension v14.

function handleTelegramOpsCallbackV14_(query, data, userId, chatId, messageId) {
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

function sendTelegramClientCardV14_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.status === 'Архив') {
    sendTelegramArchivedClientCard_(chatId, card, messageId);
    return;
  }
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
  const markup = {inline_keyboard: keyboard};
  const text = buildTelegramClientCardText_(card);
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramClientList_(chatId, requestedPage, messageId) {
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
  const archivedCount = getTelegramArchivedClients_().length;
  keyboard.push([{text: '🗄 Архив' + (archivedCount ? ' · ' + archivedCount : ''),
    callback_data: 'ops:archiveList:0'}]);
    keyboard.push([{text: '🏠 Меню', callback_data: 'nav:menu'}]);
const text = '<b>Клиенты</b>\n' +
    (clients.length ? 'Выбери клиента для открытия карточки.' : 'Активных клиентов пока нет.');
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function getTelegramArchivedClients_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
  const lastRow = sheet.getLastRow();
  const result = [];
  if (lastRow < DMS_TELEGRAM.CLIENT_FIRST_ROW) return result;
  sheet.getRange(DMS_TELEGRAM.CLIENT_FIRST_ROW, 1,
    lastRow - DMS_TELEGRAM.CLIENT_FIRST_ROW + 1,
    DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS).getDisplayValues().forEach(function(row) {
      if (!row[0] || row[2] !== 'Архив') return;
      result.push({id: row[0], name: row[1], values: row});
    });
  result.sort(function(a, b) { return a.name.localeCompare(b.name, 'ru'); });
  return result;
}

function sendTelegramArchivedClientList_(chatId, requestedPage, messageId) {
  const clients = getTelegramArchivedClients_();
  const pageCount = Math.max(1, Math.ceil(clients.length / DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE));
  const page = Math.max(0, Math.min(Number(requestedPage) || 0, pageCount - 1));
  const start = page * DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE;
  const keyboard = clients.slice(start, start + DMS_TELEGRAM_CLIENTS.CLIENTS_PER_PAGE)
    .map(function(client) { return [{text: client.name, callback_data: 'cl:' + client.id}]; });
  if (pageCount > 1) {
    const navigation = [];
    if (page > 0) navigation.push({text: '◀️', callback_data: 'ops:archiveList:' + (page - 1)});
    navigation.push({text: (page + 1) + '/' + pageCount, callback_data: 'ops:archiveList:' + page});
    if (page < pageCount - 1)
      navigation.push({text: '▶️', callback_data: 'ops:archiveList:' + (page + 1)});
    keyboard.push(navigation);
  }
  keyboard.push([{text: '🔙 Клиенты', callback_data: 'clp:0'}]);
  const text = '<b>Архив клиентов</b>\n' +
    (clients.length ? 'Выбери клиента для просмотра или восстановления.' : 'Архив пока пуст.');
  const markup = {inline_keyboard: keyboard};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramArchivedClientCard_(chatId, card, messageId) {
  const text = buildTelegramClientCardText_(card) +
    '\n\nИстория тренировок, блоков и оплат сохранена.';
  const markup = {inline_keyboard: [
    [
      {text: '💰 Оплаты', callback_data: 'ops:payments:' + card.id},
      {text: '📦 История блоков', callback_data: 'ops:blocks:' + card.id}
    ],
    [{text: '♻️ Вернуть в активные', callback_data: 'ops:restore:' + card.id}],
    [{text: '🔙 Архив', callback_data: 'ops:archiveList:0'}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function showTelegramRestoreClient_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (card.status !== 'Архив') throw new Error('Клиент уже находится в активном списке.');
  if (card.blockId) throw new Error('У архивного клиента неожиданно найден активный блок. Проверь данные.');
  telegramEditMessage_(chatId, messageId,
    '<b>Вернуть клиента в активные?</b>\n' + escapeTelegramHtml_(card.name),
    {inline_keyboard: [[
      {text: '♻️ Восстановить', callback_data: 'ops:restoreYes:' + clientId},
      {text: '❌ Отмена', callback_data: 'cl:' + clientId}
    ]]});
}

function confirmTelegramRestoreClient_(chatId, clientId, messageId) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  try {
    const card = getTelegramClientCard_(clientId);
    if (card.status !== 'Архив') throw new Error('Клиент уже восстановлен.');
    if (card.blockId) throw new Error('Сначала проверь активный блок клиента.');
    const sheet = getRequiredSheet_(SpreadsheetApp.getActive(), DMS_TELEGRAM_FINAL.CLIENTS);
    const row = findRowByValue_(sheet, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
    if (!row) throw new Error('Клиент не найден.');
    const before = sheet.getRange(row, 3).getValue();
    sheet.getRange(row, 3).setValue('Активен');
    telegramAuditAction_('restore_client', clientId, 'Клиент возвращён из архива',
      makeTelegramRestoreRangeUndo_(sheet, row, 3, [[before]]));
    SpreadsheetApp.flush();
    telegramEditMessage_(chatId, messageId,
      '<b>Клиент возвращён в активные</b>\n' + escapeTelegramHtml_(card.name),
      {inline_keyboard: [[
        {text: '👤 Карточка', callback_data: 'cl:' + clientId},
        {text: '👥 Клиенты', callback_data: 'clp:0'}
      ]]});
  } finally {
    lock.releaseLock();
  }
}
