// Read-only admin views. Authorization remains in the existing transport router.
function getDmsClientTrainingHistory_(clientId) {
  const ss = SpreadsheetApp.getActive();
  const sheet = getRequiredSheet_(ss, DMS_TELEGRAM_SCHEDULING.LOG);
  const first = DMS_TELEGRAM_SCHEDULING.LOG_FIRST_ROW;
  if (sheet.getLastRow() < first) return [];
  const zone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  return sheet.getRange(first, 1, sheet.getLastRow() - first + 1,
    DMS_TELEGRAM_SCHEDULING.LOG_COLUMNS).getValues().filter(function(row) {
      return row[0] && String(row[2]) === String(clientId);
    }).map(function(row) {
      const dated = row[1] instanceof Date && !isNaN(row[1].getTime());
      return {id: String(row[0]), timestamp: dated ? row[1].getTime() : 0,
        date: dated ? Utilities.formatDate(row[1], zone, 'dd.MM.yyyy') : 'Дата не указана',
        type: String(row[5] || 'Тип не указан'), status: String(row[6] || ''),
        blockId: String(row[3] || '')};
    }).sort(function(a, b) { return b.timestamp - a.timestamp || b.id.localeCompare(a.id); });
}

function sendTelegramClientTrainingHistory_(chatId, clientId, messageId, requestedPage) {
  const card = getTelegramClientCard_(clientId);
  const rows = getDmsClientTrainingHistory_(clientId);
  const pages = Math.max(1, Math.ceil(rows.length / 10));
  const page = Math.max(0, Math.min(Math.floor(Number(requestedPage) || 0), pages - 1));
  const lines = ['<b>История тренировок — ' + escapeTelegramHtml_(card.name) + '</b>'];
  rows.slice(page * 10, page * 10 + 10).forEach(function(row) {
    lines.push('• ' + escapeTelegramHtml_(row.date + ' · ' + row.type + ' · ' + row.status +
      (row.blockId ? ' · ' + row.blockId : '')));
  });
  if (!rows.length) lines.push('Записей пока нет.');
  const buttons = [];
  if (page > 0) buttons.push({text: '◀️', callback_data: 'ops:trainings:' + clientId + ':' + (page - 1)});
  if (page + 1 < pages) buttons.push({text: '▶️', callback_data: 'ops:trainings:' + clientId + ':' + (page + 1)});
  lines.push('', (page + 1) + '/' + pages + ' · Всего записей: ' + rows.length);
  const keyboard = buttons.length ? [buttons] : [];
  keyboard.push([{text: '🔙 Карточка', callback_data: 'cl:' + clientId}]);
  telegramEditMessage_(chatId, messageId, lines.join('\n'), {inline_keyboard: keyboard});
}

function getDmsTelegramOnboardingNextAction_() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_SYNC.QUEUE);
  const first = DMS_SYNC.QUEUE_FIRST_ROW;
  const count = queue.getLastRow() < first ? 0 : queue.getRange(first, 1,
    queue.getLastRow() - first + 1, DMS_SYNC.QUEUE_COLUMNS).getValues().filter(function(row) {
      return row[0] && row[13] !== 'Обработано' &&
        (row[13] === DMS_UNKNOWN_CLIENT_STATUS || row[11] === DMS_UNKNOWN_CLIENT_STATUS);
    }).length;
  if (!count) return {text: '', replyMarkup: null};
  return {text: '\n\n<b>Требуется регистрация: ' + count + '</b>\nОткрой MiniApp → Сегодня: создай клиента, свяжи с существующим или игнорируй только это событие.',
    replyMarkup: {inline_keyboard: [[{text: 'Создать / связать / игнорировать',
      web_app: {url: DMS_MINI_APP_TELEGRAM.PRODUCTION_URL}}]]}};
}
