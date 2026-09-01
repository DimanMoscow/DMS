function myFunctionTelegramUpcoming_() {
  
}


// DMS Telegram upcoming-calendar preview extension v16.

function buildTelegramClientCardText_(card) {
  const lines = [
    '<b>' + escapeTelegramHtml_(card.name) + '</b>',
    'Статус: ' + escapeTelegramHtml_(card.status)
  ];

  if (card.blockId) {
    lines.push(
      'Блок: <b>' + escapeTelegramHtml_(card.blockId) + '</b> · ' +
        escapeTelegramHtml_(card.format || 'формат не указан'),
      'Статус блока: ' + escapeTelegramHtml_(card.blockStatus || 'не указан'),
      'Тренировки: ' + escapeTelegramHtml_(card.completed || '0') +
        ' учтено · <b>' + escapeTelegramHtml_(card.remaining || '0') + '</b> осталось'
    );
    if (card.trainingDates.length)
      lines.push('Даты: ' + escapeTelegramHtml_(card.trainingDates.join(', ')));
    if (card.undatedTrainings) lines.push('Без указанной даты: ' + card.undatedTrainings);
    if (card.undatedCharged) lines.push('Без даты (списано): ' + card.undatedCharged);
    lines.push(
      'Стоимость: ' + escapeTelegramHtml_(card.blockPrice || '—'),
      'Оплачено: ' + escapeTelegramHtml_(card.paid || '0 ₽'),
      'Долг: <b>' + escapeTelegramHtml_(card.debt || '0 ₽') + '</b>'
    );
  } else if (card.singlePrice) {
    lines.push(
      'Формат: разовые тренировки',
      'Стоимость: ' + escapeTelegramHtml_(formatTelegramMoney_(card.singlePrice))
    );
  } else {
    lines.push('Активного блока нет.');
  }

  if (card.status !== 'Архив') appendTelegramUpcomingTrainings_(lines, card);
  if (card.conditions) lines.push('', 'Условия и заметки: ' + escapeTelegramHtml_(card.conditions));
  return lines.join('\n');
}

function appendTelegramUpcomingTrainings_(lines, card) {
  try {
    const result = getTelegramUpcomingClientTrainings_(card.id, new Date(), 5, {
      mainTitle: card.calendarTitle,
      aliases: card.calendarAliases
    });
    lines.push('', '<b>Ближайшие записи</b>');
    if (!result.items.length) {
      lines.push('• Нет записей на ближайшие 45 дней.');
      return;
    }
    result.items.forEach(function(item) {
      lines.push('• ' + escapeTelegramHtml_(item.label));
    });
    if (result.more) lines.push('• Ещё записей: ' + result.more);
  } catch (error) {
    console.error('Upcoming calendar error: ' + (error.message || String(error)));
    lines.push('', '⚠️ Ближайшие записи временно не загрузились.');
  }
}

function getTelegramUpcomingClientTrainingsLegacyV16_(clientId, now, limit) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_TELEGRAM_FINAL.CLIENTS);
  const row = findRowByValue_(clients, 1, clientId, DMS_TELEGRAM.CLIENT_FIRST_ROW);
  if (!row) throw new Error('Клиент не найден.');
  const values = clients.getRange(row, 1, 1, DMS_TELEGRAM_CLIENTS.CLIENT_COLUMNS)
    .getDisplayValues()[0];
  const titles = buildTelegramClientCalendarTitleSet_(values[12], values[13]);
  if (!Object.keys(titles).length) return {items: [], more: 0};

  const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
  const config = getCalendarSyncSettings_(settings);
  const from = now instanceof Date ? new Date(now.getTime()) : new Date();
  const to = new Date(from.getTime());
  to.setDate(to.getDate() + 45);
  const max = Math.max(1, Number(limit) || 5);
  const response = Calendar.Events.list(config.calendarId, {
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    singleEvents: true,
    showDeleted: false,
    orderBy: 'startTime',
    maxResults: 250,
    timeZone: config.timeZone
  });
  const matched = (response.items || []).filter(function(event) {
    if (event.status === 'cancelled' || !event.start || !event.start.dateTime) return false;
    return !!titles[normalizeCalendarTitle_(event.summary)];
  });
  return {
    items: matched.slice(0, max).map(function(event) {
      return {
        id: String(event.id || ''),
        label: formatTelegramUpcomingTraining_(event, config.timeZone)
      };
    }),
    more: Math.max(0, matched.length - max)
  };
}

function buildTelegramClientCalendarTitleSet_(mainTitle, aliases) {
  const result = {};
  [mainTitle].concat(String(aliases || '').split(/[\n,;|]+/)).forEach(function(title) {
    const normalized = normalizeCalendarTitle_(title);
    if (normalized) result[normalized] = true;
  });
  return result;
}

function formatTelegramUpcomingTraining_(event, timeZone) {
  const start = new Date(event.start.dateTime);
  if (isNaN(start.getTime())) return 'дата не распознана';
  const end = event.end && event.end.dateTime ? new Date(event.end.dateTime) : null;
  const startText = Utilities.formatDate(start, timeZone, 'dd.MM.yyyy HH:mm');
  const endText = end && !isNaN(end.getTime()) ? Utilities.formatDate(end, timeZone, 'HH:mm') : '';
  return startText + (endText ? '–' + endText : '');
}
