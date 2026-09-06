function myFunctionTelegramBlockEdit_() {
  
}
// DMS Telegram active-block editor extension v15.

function handleTelegramOpsCallbackV15_(query, data, userId, chatId, messageId) {
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

function sendTelegramClientCardV15_(chatId, clientId, messageId) {
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
  const markup = {inline_keyboard: keyboard};
  const text = buildTelegramClientCardText_(card);
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function sendTelegramBlockEditMenu_(chatId, clientId, messageId) {
  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) throw new Error('У клиента нет действующего блока.');
  const block = getTelegramBlockRecord_(card.blockId);
  if (!block) throw new Error('Действующий блок не найден.');
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const date = block.startDate instanceof Date
    ? Utilities.formatDate(block.startDate, timeZone, 'dd.MM.yyyy')
    : 'не указана';
  const text = '<b>Параметры блока — ' + escapeTelegramHtml_(card.name) + '</b>\n' +
    'Блок: <b>' + escapeTelegramHtml_(block.id) + '</b>\n' +
    'Количество: <b>' + block.total + '</b> · проведено ' + block.completed +
      ' · осталось ' + block.remaining + '\n' +
    'Стоимость: <b>' + escapeTelegramHtml_(formatTelegramMoney_(block.price)) + '</b>\n' +
    'Дата начала: <b>' + escapeTelegramHtml_(date) + '</b>\n\n' +
    'Что изменить?';
  const markup = {inline_keyboard: [
    [{text: '🔢 Количество тренировок', callback_data: 'ops:blockTotal:' + clientId}],
    [{text: '💰 Стоимость блока', callback_data: 'ops:blockPrice:' + clientId}],
    [{text: '📅 Дата начала', callback_data: 'ops:blockDate:' + clientId}],
    [{text: '🔙 Карточка', callback_data: 'cl:' + clientId}]
  ]};
  if (messageId) telegramEditMessage_(chatId, messageId, text, markup);
  else telegramSendMessage_(chatId, text, markup);
}

function startTelegramBlockEdit_(userId, chatId, clientId, field) {
  const card = getTelegramClientCard_(clientId);
  if (!card.blockId) throw new Error('У клиента нет действующего блока.');
  const block = getTelegramBlockRecord_(card.blockId);
  if (!block) throw new Error('Действующий блок не найден.');
  const prompts = {
    total: '<b>Количество тренировок в блоке</b>\nСейчас: ' + block.total +
      '. Проведено: ' + block.completed + '.\nПришли новое общее количество целым числом.',
    price: '<b>Стоимость блока</b>\nСейчас: ' + escapeTelegramHtml_(formatTelegramMoney_(block.price)) +
      '.\nПришли новую общую стоимость числом. Для бесплатного блока можно указать 0.',
    date: '<b>Дата начала блока</b>\nПришли дату в формате 25.08 или 25.08.2026.'
  };
  if (!prompts[field]) throw new Error('Неизвестный параметр блока.');
  putTelegramOpsState_(userId, chatId, {
    action: 'block_edit', phase: 'input', field: field,
    clientId: clientId, blockId: block.id
  });
  telegramSendMessage_(chatId, prompts[field], buildTelegramCancelKeyboard_());
}

function handleTelegramOpsInputV15_(state, userId, chatId, text) {
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
    }
  } catch (error) {
    telegramSendMessage_(chatId, '<b>Не удалось принять данные</b>\n' +
      escapeTelegramHtml_(error.message || String(error)), buildTelegramCancelKeyboard_());
  }
}

function prepareTelegramBlockEditConfirmation_(state, userId, chatId, text) {
  const card = getTelegramClientCard_(state.clientId);
  if (!card.blockId || card.blockId !== state.blockId)
    throw new Error('Действующий блок изменился. Открой карточку заново.');
  const block = getTelegramBlockRecord_(state.blockId);
  if (!block) throw new Error('Блок не найден.');
  const ss = SpreadsheetApp.getActive();
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  let title;
  let before;
  let after;
  if (state.field === 'total') {
    state.value = validateTelegramPositiveInteger_(text, 1, 100, 'Количество');
    if (state.value < block.completed)
      throw new Error('Нельзя указать меньше проведённых тренировок: ' + block.completed + '.');
    title = 'Количество тренировок';
    before = String(block.total);
    after = String(state.value) + ' (остаток станет ' + (state.value - block.completed) + ')';
  } else if (state.field === 'price') {
    state.value = validateTelegramBlockPrice_(text);
    title = 'Стоимость блока';
    before = formatTelegramMoney_(block.price);
    after = formatTelegramMoney_(state.value);
  } else if (state.field === 'date') {
    const parsed = parseTelegramBlockDate_(text, timeZone, new Date());
    const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
    const dateKey = Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd');
    if (block.completed > 0 && dateKey > todayKey)
      throw new Error('Нельзя перенести начатый блок в будущее.');
    state.value = parsed.getTime();
    title = 'Дата начала';
    before = block.startDate instanceof Date
      ? Utilities.formatDate(block.startDate, timeZone, 'dd.MM.yyyy') : 'не указана';
    after = Utilities.formatDate(parsed, timeZone, 'dd.MM.yyyy');
  } else throw new Error('Неизвестный параметр блока.');
  state.phase = 'confirm';
  putTelegramOpsState_(userId, chatId, state);
  telegramSendMessage_(chatId, '<b>Сохранить изменение?</b>\n' +
    escapeTelegramHtml_(title) + ':\n' + escapeTelegramHtml_(before) + ' → <b>' +
    escapeTelegramHtml_(after) + '</b>',
    {inline_keyboard: [[
      {text: '✅ Сохранить', callback_data: 'ops:blockEditYes'},
      {text: '❌ Отмена', callback_data: 'ops:blockEdit:' + state.clientId}
    ]]});
}

function confirmTelegramBlockEdit_(userId, chatId, messageId) {
  const state = getTelegramOpsState_(userId, chatId);
  if (!state || state.action !== 'block_edit' || state.phase !== 'confirm')
    throw new Error('Сценарий устарел. Открой параметры блока заново.');
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  try {
    const card = getTelegramClientCard_(state.clientId);
    if (!card.blockId || card.blockId !== state.blockId)
      throw new Error('Действующий блок изменился. Открой карточку заново.');
    const block = getTelegramBlockRecord_(state.blockId);
    if (!block) throw new Error('Блок не найден.');
    const ss = SpreadsheetApp.getActive();
    const blocks = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.BLOCKS);
    const clients = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
    const clientRow = findRowByValue_(clients, 1, state.clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
    if (!clientRow) throw new Error('Клиент не найден.');
    const undoItems = [];
    let description;
    if (state.field === 'total') {
      const value = Number(state.value);
      if (value < block.completed) throw new Error('После ввода появились новые тренировки. Укажи количество заново.');
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 3, blocks.getRange(block.row, 3).getValues()));
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 8, blocks.getRange(block.row, 8).getValues()));
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 16, blocks.getRange(block.row, 16).getValues()));
      undoItems.push(makeTelegramRestoreRangeUndo_(clients, clientRow, 5, clients.getRange(clientRow, 5).getValues()));
      blocks.getRange(block.row, 3).setValue('Блок ' + value);
      blocks.getRange(block.row, 8).setValue(value);
      clients.getRange(clientRow, 5).setValue('Блок ' + value);
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions,
        'Количество изменено: ' + block.total + ' → ' + value));
      description = 'Количество в ' + block.id + ': ' + block.total + ' → ' + value;
    } else if (state.field === 'price') {
      const value = Number(state.value);
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 11, blocks.getRange(block.row, 11).getValues()));
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 16, blocks.getRange(block.row, 16).getValues()));
      blocks.getRange(block.row, 11).setValue(value);
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions,
        'Стоимость изменена: ' + formatTelegramMoney_(block.price) + ' → ' + formatTelegramMoney_(value)));
      description = 'Стоимость ' + block.id + ': ' + formatTelegramMoney_(block.price) +
        ' → ' + formatTelegramMoney_(value);
    } else if (state.field === 'date') {
      const date = new Date(Number(state.value));
      if (isNaN(date.getTime())) throw new Error('Дата устарела. Введи её заново.');
      const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
      const todayKey = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
      const dateKey = Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
      if (block.completed > 0 && dateKey > todayKey)
        throw new Error('После ввода блок был начат. Нельзя перенести его в будущее.');
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 4, blocks.getRange(block.row, 4, 1, 2).getValues()));
      undoItems.push(makeTelegramRestoreRangeUndo_(blocks, block.row, 16, blocks.getRange(block.row, 16).getValues()));
      blocks.getRange(block.row, 5).setValue(date);
      if (block.status !== 'Приостановлен')
        setTelegramBlockStatus_(blocks, block.row, dateKey > todayKey ? 'Запланирован' : 'Активен');
      const oldDate = block.startDate instanceof Date
        ? Utilities.formatDate(block.startDate, timeZone, 'dd.MM.yyyy') : 'не указана';
      const newDate = Utilities.formatDate(date, timeZone, 'dd.MM.yyyy');
      blocks.getRange(block.row, 16).setValue(appendTelegramAuditNote_(block.conditions,
        'Дата начала изменена: ' + oldDate + ' → ' + newDate));
      description = 'Дата начала ' + block.id + ': ' + oldDate + ' → ' + newDate;
    } else throw new Error('Неизвестный параметр блока.');
    telegramAuditAction_('edit_block', block.id, description,
      {type: 'compound', items: undoItems});
    SpreadsheetApp.flush();
    clearTelegramOpsState_(userId, chatId);
    telegramEditMessage_(chatId, messageId,
      '<b>Параметр блока обновлён</b>\n' + escapeTelegramHtml_(description),
      {inline_keyboard: [[
        {text: '🧰 Параметры блока', callback_data: 'ops:blockEdit:' + state.clientId},
        {text: '👤 Карточка', callback_data: 'cl:' + state.clientId}
      ]]});
  } finally {
    lock.releaseLock();
  }
}

function validateTelegramBlockPrice_(value) {
  if (!/\d/.test(String(value || '')))
    throw new Error('Пришли сумму числом от 0 до 1 000 000 ₽.');
  const amount = parseTelegramMoney_(value);
  if (amount < 0 || amount > 1000000)
    throw new Error('Сумма должна быть от 0 до 1 000 000 ₽.');
  return amount;
}

function parseTelegramBlockDate_(text, timeZone, now) {
  const match = String(text || '').trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/);
  if (!match) throw new Error('Пришли дату в формате 25.08 или 25.08.2026.');
  const year = Number(match[3] || Utilities.formatDate(now, timeZone, 'yyyy'));
  if (year < 2000 || year > 2100) throw new Error('Год должен быть от 2000 до 2100.');
  const canonical = year + '-' + String(Number(match[2])).padStart(2, '0') + '-' +
    String(Number(match[1])).padStart(2, '0');
  const parsed = Utilities.parseDate(canonical + ' 12:00', timeZone, 'yyyy-MM-dd HH:mm');
  if (Utilities.formatDate(parsed, timeZone, 'yyyy-MM-dd') !== canonical)
    throw new Error('Такой даты не существует.');
  return parsed;
}
