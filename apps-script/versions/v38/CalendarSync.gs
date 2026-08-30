const DMS_SYNC = {
  CLIENTS: 'Клиенты',
  QUEUE: 'Очередь подтверждения',
  SETTINGS: 'Настройки',
  CLIENT_FIRST_ROW: 5,
  QUEUE_FIRST_ROW: 4,
  QUEUE_COLUMNS: 17,
  CLIENT_CALENDAR_COL: 13,
  CLIENT_CALENDAR_ALIASES_COL: 14
};

function syncCalendarToQueue() {
  const lock = LockService.getDocumentLock();

  if (!lock.tryLock(10000)) {
    throw new Error('Синхронизация уже выполняется. Повтори через несколько секунд.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const clients = getRequiredSheet_(ss, DMS_SYNC.CLIENTS);
    const queue = getRequiredSheet_(ss, DMS_SYNC.QUEUE);
    const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
    const config = getCalendarSyncSettings_(settings);
    const clientMap = buildCalendarClientMap_(clients);
    const existing = readQueueIndex_(queue);
    const windowEnd = new Date();

    windowEnd.setDate(windowEnd.getDate() + 1);

    const events = listCalendarEvents_(
      config.calendarId,
      config.startDate,
      windowEnd,
      config.timeZone
    );

    const seen = {};
    let added = 0;
    let updated = 0;
    let cancelled = 0;
    let ignored = 0;
    let errors = 0;

    events.forEach(function(event) {
      const eventId = String(event.id || '').trim();

      if (!eventId) return;
      seen[eventId] = true;

      const existingRow = existing.byEventId[eventId] || null;

      if (event.status === 'cancelled') {
        if (existingRow && markQueueEventCancelled_(queue, existingRow)) {
          cancelled++;
        }
        return;
      }

      const title = String(event.summary || '').trim();

      if (!isTrainingEventTitle_(title)) {
        if (existingRow && markQueueEventNotTraining_(queue, existingRow)) {
          updated++;
        } else {
          ignored++;
        }
        return;
      }

      const times = getCalendarEventTimes_(event);

      if (!times) {
        ignored++;
        return;
      }

      const client = clientMap[normalizeCalendarTitle_(title)] || null;
      const rowValues = buildQueueRow_(
        existingRow ? existingRow.values[0] : makeNextQueueId_(queue),
        config.calendarId,
        event,
        times,
        client
      );

      if (existingRow) {
        if (updateQueueEvent_(queue, existingRow, rowValues)) {
          updated++;
        }
      } else {
        const row = findFirstEmptyRow_(
          queue,
          1,
          DMS_SYNC.QUEUE_FIRST_ROW
        );

        copyQueueTemplate_(queue, row);
        queue
          .getRange(row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
          .setValues([rowValues]);

        existing.byEventId[eventId] = {
          row: row,
          values: rowValues
        };
        added++;
      }
    });

    const reconciliation = reconcileMissingQueueEvents_(
      queue,
      existing.rows,
      seen,
      config.calendarId,
      config.startDate,
      windowEnd,
      clientMap
    );

    cancelled += reconciliation.cancelled;
    updated += reconciliation.updated;
    errors += reconciliation.errors;

    const summary =
      'Добавлено: ' + added +
      '; обновлено: ' + updated +
      '; отменено: ' + cancelled +
      '; пропущено: ' + ignored +
      '; ошибок: ' + errors + '.';

    setCalendarAutomationStatus_(
      settings,
      config.timeZone,
      hasCalendarSyncTrigger_(),
      summary
    );

    ss.toast(summary, 'Синхронизация календаря', 10);
    return summary;
  } finally {
    lock.releaseLock();
  }
}

function installCalendarSyncTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(trigger) {
      return trigger.getHandlerFunction() === 'syncCalendarToQueue';
    })
    .forEach(function(trigger) {
      ScriptApp.deleteTrigger(trigger);
    });

  ScriptApp.newTrigger('syncCalendarToQueue')
    .timeBased()
    .everyHours(1)
    .create();

  const result = syncCalendarToQueue();

  SpreadsheetApp.getActive().toast(
    'Фоновая синхронизация включена: каждый час.',
    'DMS Fitness',
    8
  );

  return result;
}

function getCalendarSyncSettings_(settings) {
  const lastRow = Math.max(settings.getLastRow(), 19);
  const rows = settings
    .getRange(11, 1, lastRow - 10, 2)
    .getValues();
  const values = {};

  rows.forEach(function(row) {
    if (row[0]) {
      values[String(row[0]).trim()] = row[1];
    }
  });

  const calendarId = String(
    values['Календарь для учёта'] || ''
  ).trim();
  const startDate = values['Начало автоматического учёта'];
  const timeZone = String(
    values['Часовой пояс учёта'] || 'Europe/Moscow'
  ).trim();

  if (!calendarId) {
    throw new Error('В Настройки!B14 не указан календарь для учёта.');
  }

  if (!(startDate instanceof Date) || isNaN(startDate.getTime())) {
    throw new Error(
      'В Настройки!B15 не указана корректная дата начала учёта.'
    );
  }

  return {
    calendarId: calendarId,
    startDate: startDate,
    timeZone: timeZone
  };
}

function listCalendarEvents_(calendarId, startDate, endDate, timeZone) {
  const items = [];
  let pageToken = null;

  do {
    const params = {
      timeMin: startDate.toISOString(),
      timeMax: endDate.toISOString(),
      singleEvents: true,
      showDeleted: true,
      maxResults: 2500,
      timeZone: timeZone
    };

    if (pageToken) params.pageToken = pageToken;

    const response = Calendar.Events.list(calendarId, params);

    Array.prototype.push.apply(items, response.items || []);
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return items;
}

function buildCalendarClientMap_(clients) {
  const map = {};
  const lastRow = clients.getLastRow();

  if (lastRow < DMS_SYNC.CLIENT_FIRST_ROW) return map;

  const rows = clients
    .getRange(
      DMS_SYNC.CLIENT_FIRST_ROW,
      1,
      lastRow - DMS_SYNC.CLIENT_FIRST_ROW + 1,
      DMS_SYNC.CLIENT_CALENDAR_ALIASES_COL
    )
    .getValues();

  rows.forEach(function(row) {
    const clientId = row[0];
    const clientName = row[1];
    const clientStatus = row[2];
    const blockId = row[3];
    const conditions = row[10];
    const mainTitle = row[DMS_SYNC.CLIENT_CALENDAR_COL - 1];
    const aliases = row[DMS_SYNC.CLIENT_CALENDAR_ALIASES_COL - 1];

    if (!clientId || !clientName || clientStatus !== 'Активен') return;

    const titles = [mainTitle].concat(
      String(aliases || '')
        .split(/[\n,;|]+/)
        .map(function(value) {
          return value.trim();
        })
    );

    titles.forEach(function(title) {
      const key = normalizeCalendarTitle_(title);

      if (key) {
        map[key] = {
          id: clientId,
          name: clientName,
          blockId: blockId || '',
          singlePrice: getSingleTrainingPrice_(conditions) || 0
        };
      }
    });
  });

  return map;
}

function readQueueIndex_(queue) {
  const result = {
    byEventId: {},
    rows: []
  };
  const lastRow = queue.getLastRow();

  if (lastRow < DMS_SYNC.QUEUE_FIRST_ROW) return result;

  const values = queue
    .getRange(
      DMS_SYNC.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_SYNC.QUEUE_FIRST_ROW + 1,
      DMS_SYNC.QUEUE_COLUMNS
    )
    .getValues();

  values.forEach(function(rowValues, index) {
    const row = DMS_SYNC.QUEUE_FIRST_ROW + index;
    const eventId = String(rowValues[3] || '').trim();
    const item = {
      row: row,
      values: rowValues
    };

    if (eventId && !result.byEventId[eventId]) {
      result.byEventId[eventId] = item;
    }

    if (eventId) result.rows.push(item);
  });

  return result;
}

function buildQueueRow_(queueId, calendarId, event, times, client) {
  const comment = client
    ? (client.blockId || client.singlePrice ? '' : 'Активный блок не указан')
    : 'Нет точного совпадения в Клиенты!M:N';

  return [
    queueId,
    times.start,
    calendarId,
    String(event.id || ''),
    String(event.recurringEventId || ''),
    times.start,
    times.end,
    String(event.summary || '').trim(),
    client ? client.id : '',
    client ? client.name : '',
    client ? client.blockId : '',
    client ? 'Распознано' : 'Не распознано',
    client ? 'Проведена' : '',
    'Ожидает',
    '',
    'Calendar',
    comment
  ];
}

function updateQueueEvent_(queue, existingRow, rowValues) {
  const current = existingRow.values;

  if (current[13] === 'Обработано') return false;

  const moved =
    !sameCalendarMoment_(current[5], rowValues[5]) ||
    !sameCalendarMoment_(current[6], rowValues[6]);

  rowValues[0] = current[0];

  if (
    !moved &&
    [
      'Отмена со списанием',
      'Отмена без списания',
      'Не учитывать'
    ].indexOf(current[12]) !== -1
  ) {
    rowValues[12] = current[12];
  }

  if (moved) {
    rowValues[12] = rowValues[11] === 'Распознано' ? 'Проведена' : '';
    rowValues[13] = 'Ожидает';
    rowValues[14] = '';
  } else {
    const resolved =
      rowValues[11] === 'Распознано' &&
      (rowValues[10] || !rowValues[16]);

    rowValues[13] =
      current[13] === 'Ошибка' && resolved
        ? 'Ожидает'
        : (current[13] || 'Ожидает');
    rowValues[14] = current[14] || '';
  }

  rowValues[15] = current[15] || 'Calendar';
  rowValues[16] = mergeQueueComment_(
    current[16],
    rowValues[16]
  );

  if (moved) {
    rowValues[16] = mergeQueueComment_(
      rowValues[16],
      'Событие перенесено в Google Calendar'
    );
  }

  queue
    .getRange(existingRow.row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
    .setValues([rowValues]);

  existingRow.values = rowValues;
  return true;
}

function markQueueEventCancelled_(queue, existingRow) {
  const values = existingRow.values.slice();

  if (values[13] === 'Обработано') return false;

  if (
    !values[12] ||
    values[12] === 'Проведена' ||
    values[12] === 'Перенос'
  ) {
    values[12] = 'Отмена без списания';
  }

  values[13] = values[13] || 'Ожидает';
  values[16] = mergeQueueComment_(
    values[16],
    'Событие удалено из Google Calendar'
  );

  queue
    .getRange(existingRow.row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
    .setValues([values]);

  existingRow.values = values;
  return true;
}

function markQueueEventNotTraining_(queue, existingRow) {
  const values = existingRow.values.slice();

  if (values[13] === 'Обработано') return false;

  values[11] = 'Не тренировка';
  values[12] = 'Не учитывать';
  values[13] = values[13] || 'Ожидает';
  values[16] = mergeQueueComment_(
    values[16],
    'Пометка ПТ удалена из названия события'
  );

  queue
    .getRange(existingRow.row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
    .setValues([values]);

  existingRow.values = values;
  return true;
}

function reconcileMissingQueueEvents_(
  queue,
  existingRows,
  seen,
  calendarId,
  startDate,
  endDate,
  clientMap
) {
  const result = {
    cancelled: 0,
    updated: 0,
    errors: 0
  };

  existingRows.forEach(function(item) {
    const values = item.values;
    const eventId = String(values[3] || '').trim();
    const eventStart = values[5];

    if (
      !eventId ||
      seen[eventId] ||
      values[15] !== 'Calendar' ||
      values[13] === 'Обработано' ||
      !(eventStart instanceof Date) ||
      eventStart < startDate ||
      eventStart >= endDate
    ) {
      return;
    }

    let event;

    try {
      event = Calendar.Events.get(calendarId, eventId);
    } catch (error) {
      if (isCalendarEventMissingError_(error)) {
        if (markQueueEventCancelled_(queue, item)) {
          result.cancelled++;
        }
      } else {
        markQueueLookupError_(queue, item, error);
        result.errors++;
      }
      return;
    }

    if (!event || event.status === 'cancelled') {
      if (markQueueEventCancelled_(queue, item)) {
        result.cancelled++;
      }
      return;
    }

    const title = String(event.summary || '').trim();

    if (!isTrainingEventTitle_(title)) {
      if (markQueueEventNotTraining_(queue, item)) {
        result.updated++;
      }
      return;
    }

    const times = getCalendarEventTimes_(event);

    if (!times) {
      markQueueLookupError_(
        queue,
        item,
        new Error('У события отсутствуют дата и время.')
      );
      result.errors++;
      return;
    }

    const client = clientMap[normalizeCalendarTitle_(title)] || null;
    const rowValues = buildQueueRow_(
      values[0],
      calendarId,
      event,
      times,
      client
    );

    if (updateQueueEvent_(queue, item, rowValues)) {
      result.updated++;
    }
  });

  return result;
}

function getCalendarEventTimes_(event) {
  if (
    !event.start ||
    !event.end ||
    !event.start.dateTime ||
    !event.end.dateTime
  ) {
    return null;
  }

  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }

  return {
    start: start,
    end: end
  };
}

function isTrainingEventTitle_(title) {
  return /(^|\s)ПТ(?=$|\s|\[|\()/i.test(
    String(title || '').trim()
  );
}

function normalizeCalendarTitle_(title) {
  return String(title || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ru-RU');
}

function makeNextQueueId_(queue) {
  const lastRow = queue.getLastRow();

  if (lastRow < DMS_SYNC.QUEUE_FIRST_ROW) {
    return 'Q-0001';
  }

  const values = queue
    .getRange(
      DMS_SYNC.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_SYNC.QUEUE_FIRST_ROW + 1,
      1
    )
    .getValues()
    .flat();

  const maxNumber = values.reduce(function(max, value) {
    const match = String(value).match(/^Q-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return 'Q-' + String(maxNumber + 1).padStart(4, '0');
}

function copyQueueTemplate_(queue, row) {
  const template = queue.getRange(
    DMS_SYNC.QUEUE_FIRST_ROW,
    1,
    1,
    DMS_SYNC.QUEUE_COLUMNS
  );
  const target = queue.getRange(
    row,
    1,
    1,
    DMS_SYNC.QUEUE_COLUMNS
  );

  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_FORMAT,
    false
  );

  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
    false
  );
}

function mergeQueueComment_(current, next) {
  const oldText = String(current || '').trim();
  const newText = String(next || '').trim();

  if (!newText) return oldText;
  if (!oldText || oldText === newText) return newText;

  const systemComments = [
    'Активный блок не указан',
    'Нет точного совпадения в Клиенты!M:N',
    'Событие удалено из Google Calendar',
    'Пометка ПТ удалена из названия события',
    'Событие перенесено в Google Calendar'
  ];

  if (systemComments.indexOf(oldText) !== -1) {
    return newText;
  }

  return oldText.indexOf(newText) !== -1
    ? oldText
    : oldText + ' | ' + newText;
}

function sameCalendarMoment_(left, right) {
  return left instanceof Date &&
    right instanceof Date &&
    left.getTime() === right.getTime();
}

function isCalendarEventMissingError_(error) {
  const text = String(
    error && (error.message || error)
      ? (error.message || error)
      : ''
  );

  return /(?:404|410|not found|gone|не найден)/i.test(text);
}

function markQueueLookupError_(queue, existingRow, error) {
  const values = existingRow.values.slice();
  const message = String(
    error && (error.message || error)
      ? (error.message || error)
      : 'Неизвестная ошибка Calendar API'
  );

  values[13] = 'Ошибка';
  values[16] = mergeQueueComment_(
    values[16],
    'Не удалось проверить событие: ' + message.slice(0, 180)
  );

  queue
    .getRange(existingRow.row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
    .setValues([values]);

  existingRow.values = values;
}

function hasCalendarSyncTrigger_() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === 'syncCalendarToQueue';
  });
}
function setCalendarAutomationStatus_(
  settings,
  timeZone,
  triggerEnabled,
  summary
) {
  const timestamp = Utilities.formatDate(
    new Date(),
    timeZone,
    'dd.MM.yyyy HH:mm'
  );

  const status = triggerEnabled
    ? 'Фоновая синхронизация включена; каждый час.'
    : 'Ручная синхронизация выполнена; фоновая синхронизация не включена.';

  settings.getRange('B19').setValue(
    status +
    ' Последняя проверка: ' +
    timestamp +
    '. ' +
    summary
  );
}
