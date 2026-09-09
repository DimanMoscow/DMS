const DMS_QUEUE_PROCESSING = {
  QUEUE: 'Очередь подтверждения',
  CLIENTS: 'Клиенты',
  BLOCKS: 'Блоки',
  LOG: 'Журнал тренировок',
  QUEUE_FIRST_ROW: 4,
  QUEUE_COLUMNS: 17,
  LOG_FIRST_ROW: 4,
  LOG_COLUMNS: 19,
  CLIENT_FIRST_ROW: 5,
  BLOCK_FIRST_ROW: 4
};

function setupQueueProcessing() {
  const ss = SpreadsheetApp.getActive();
  const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
  const methodRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(
      ['Кнопка', 'Вручную', 'Тест', 'Calendar', 'Telegram'],
      true
    )
    .setAllowInvalid(false)
    .build();

  log.getRange(4, 9, log.getMaxRows() - 3, 1).setDataValidation(methodRule);
  ss.toast(
    'Обработка очереди настроена. Значения и остатки не изменены.',
    'DMS Fitness',
    8
  );
}

function previewSelectedQueueDay() {
  const selection = getSelectedQueueItem_();
  const result = processQueueDate_(selection.date, 'Таблица', true);
  const summary = formatQueueProcessingSummary_(result);

  console.log(summary);

  SpreadsheetApp.getActive().toast(
    summary,
    'Предпросмотр дня',
    12
  );

  return result;
}

function previewOldestQueueDay() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const lastRow = queue.getLastRow();

  if (lastRow < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
    throw new Error('Очередь пуста.');
  }

  const rows = queue.getRange(
    DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
    1,
    lastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
    DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
  ).getValues();
  const pending = rows.find(function(row) {
    return row[0] && row[1] instanceof Date && row[13] !== 'Обработано';
  });

  if (!pending) {
    throw new Error('В очереди нет необработанных дней.');
  }

  const result = processQueueDate_(pending[1], 'Таблица', true);
  const summary = formatQueueProcessingSummary_(result);

  console.log(summary);

  ss.toast(
    summary,
    'Предпросмотр дня',
    12
  );

  return result;
}

function processSelectedQueueDay() {
  const selection = getSelectedQueueItem_();

  syncCalendarToQueue();

  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const currentRow = findRowByValue_(
    queue,
    1,
    selection.queueId,
    DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW
  );

  if (!currentRow) {
    throw new Error('Строка очереди после синхронизации не найдена.');
  }

  const currentDate = queue.getRange(currentRow, 2).getValue();

  if (!(currentDate instanceof Date) || isNaN(currentDate.getTime())) {
    throw new Error('В строке очереди не указана корректная дата учёта.');
  }

  const result = processQueueDate_(currentDate, 'Таблица', false);

  ss.toast(
    formatQueueProcessingSummary_(result),
    'Подтверждение дня',
    12
  );

  return result;
}

function processQueueDateLegacy_(date, confirmationSource, dryRun) {
  const lock = getDmsMutationLock_();

  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
    const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const dateKey = makeDateKey_(date, timeZone);
    const now = new Date();
    const lastRow = queue.getLastRow();
    const result = {
      dateKey: dateKey,
      dryRun: Boolean(dryRun),
      total: 0,
      added: 0,
      skipped: 0,
      alreadyLogged: 0,
      blocked: 0,
      blockers: []
    };

    if (lastRow < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
      return result;
    }

    const rows = queue.getRange(
      DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
      DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
    ).getValues();
    const logIndex = buildQueueLogIndex_(log);
    const completedByBlock = {};

    rows.forEach(function(values, index) {
      const rowNumber = DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + index;

      if (!values[0] || !(values[1] instanceof Date)) return;
      if (makeDateKey_(values[1], timeZone) !== dateKey) return;
      if (values[13] === 'Обработано') return;

      result.total++;

      const decision = String(values[12] || '').trim();
      const queueId = String(values[0] || '').trim();
      const eventId = String(values[3] || '').trim();
      const existingRecord = logIndex.byQueueId[queueId] ||
        logIndex.byEventId[eventId] || null;

      if (existingRecord) {
        result.alreadyLogged++;

        if (!dryRun) {
          markQueueProcessed_(
            queue,
            rowNumber,
            values,
            confirmationSource,
            'Запись уже существует в журнале: ' + existingRecord
          );
        }
        return;
      }

      if (decision === 'Отмена без списания' || decision === 'Не учитывать') {
        result.skipped++;

        if (!dryRun) {
          markQueueProcessed_(
            queue,
            rowNumber,
            values,
            confirmationSource,
            ''
          );
        }
        return;
      }

      const validation = validateQueueTraining_(
        values,
        decision,
        now,
        clients,
        blocks,
        log,
        completedByBlock
      );

      if (!validation.ok) {
        result.blocked++;
        result.blockers.push(queueId + ': ' + validation.error);

        if (!dryRun) {
          markQueueError_(queue, rowNumber, values, validation.error);
        }
        return;
      }

      result.added++;

      if (validation.blockId) {
        completedByBlock[validation.blockId] =
          (completedByBlock[validation.blockId] || 0) + 1;
      }

      if (dryRun) return;

      const recordId = writeQueueTrainingLogRow_(log, {
        start: values[5],
        clientId: values[8],
        blockId: validation.blockId,
        format: validation.format,
        accountingType: decision === 'Отмена со списанием'
          ? 'Списание без проведения'
          : 'Фактически проведена',
        trainingPrice: validation.trainingPrice,
        calendarId: values[2],
        eventId: values[3],
        recurringEventId: values[4],
        confirmedAt: now,
        confirmationSource: confirmationSource,
        queueId: queueId
      });

      logIndex.byQueueId[queueId] = recordId;
      if (eventId) logIndex.byEventId[eventId] = recordId;

      markQueueProcessed_(
        queue,
        rowNumber,
        values,
        confirmationSource,
        'Запись журнала: ' + recordId
      );
    });

    if (!dryRun) SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function validateQueueTraining_(
  values,
  decision,
  now,
  clients,
  blocks,
  log,
  completedByBlock
) {
  if (['Проведена', 'Отмена со списанием'].indexOf(decision) === -1) {
    return {
      ok: false,
      error: decision === 'Перенос'
        ? 'Сначала перенеси событие в календаре и дождись синхронизации.'
        : 'Не выбрано допустимое решение.'
    };
  }

  if (values[11] !== 'Распознано' || !values[8]) {
    return {
      ok: false,
      error: values[11] === DMS_UNKNOWN_CLIENT_STATUS
        ? 'Сначала зарегистрируй или свяжи клиента.'
        : 'Клиент не распознан.'
    };
  }

  if (!(values[6] instanceof Date) || values[6] > now) {
    return {ok: false, error: 'Тренировка ещё не завершилась.'};
  }

  const clientRow = findRowByValue_(
    clients,
    1,
    values[8],
    DMS_QUEUE_PROCESSING.CLIENT_FIRST_ROW
  );

  if (!clientRow) {
    return {ok: false, error: 'Клиент отсутствует на листе «Клиенты».'};
  }

  const client = clients.getRange(clientRow, 1, 1, 12).getValues()[0];

  if (client[2] !== 'Активен') {
    return {ok: false, error: 'Статус клиента не «Активен».'};
  }

  const blockId = String(values[10] || client[3] || '').trim();

  if (!blockId) {
    const singlePrice = getSingleTrainingPrice_(client[10]);

    if (!singlePrice) {
      return {ok: false, error: 'Активный блок не указан.'};
    }

    return {
      ok: true,
      blockId: '',
      format: 'Разовая',
      trainingPrice: singlePrice
    };
  }

  if (String(client[3] || '') !== blockId) {
    return {ok: false, error: 'Блок в очереди не совпадает с активным блоком клиента.'};
  }

  const blockRow = findRowByValue_(
    blocks,
    1,
    blockId,
    DMS_QUEUE_PROCESSING.BLOCK_FIRST_ROW
  );

  if (!blockRow) {
    return {ok: false, error: 'Блок ' + blockId + ' не найден.'};
  }

  const block = blocks.getRange(blockRow, 1, 1, 17).getValues()[0];

  if (String(block[1] || '') !== String(values[8] || '')) {
    return {ok: false, error: 'Блок принадлежит другому клиенту.'};
  }

  if (block[3] !== 'Активен') {
    return {ok: false, error: 'Блок ' + blockId + ' имеет статус «' + (block[3] || 'не указан') + '».'};
  }

  const eventStart = values[5];

  if (block[4] instanceof Date && eventStart < block[4]) {
    return {ok: false, error: 'Тренировка раньше даты открытия блока.'};
  }

  if (block[5] instanceof Date) {
    const endOfBlockDate = new Date(block[5]);
    endOfBlockDate.setHours(23, 59, 59, 999);

    if (eventStart > endOfBlockDate) {
      return {ok: false, error: 'Тренировка позже даты окончания блока.'};
    }
  }

  const total = Number(block[7]) || 0;

  if (completedByBlock[blockId] === undefined) {
    completedByBlock[blockId] = countCompletedTrainings_(log, blockId);
  }

  if (completedByBlock[blockId] >= total) {
    return {ok: false, error: 'В блоке ' + blockId + ' закончились тренировки.'};
  }

  return {
    ok: true,
    blockId: blockId,
    format: block[2],
    trainingPrice: Number(block[11]) || 0
  };
}

function writeQueueTrainingLogRow_(log, data) {
  const newRow = findFirstEmptyRow_(
    log,
    1,
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW
  );
  const recordId = makeNextId_(log, 1, 'TR');
  const template = log.getRange(
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    1,
    1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  );
  const target = log.getRange(
    newRow,
    1,
    1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  );

  template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
    false
  );

  target.setValues([[
    recordId,
    data.start,
    data.clientId,
    data.blockId,
    data.format,
    data.accountingType,
    'Проведена',
    data.trainingPrice,
    'Calendar',
    '',
    '',
    false,
    data.calendarId,
    data.eventId,
    data.recurringEventId,
    data.start,
    data.confirmedAt,
    data.confirmationSource,
    data.queueId
  ]]);

  log.getRange(newRow, 12).insertCheckboxes().setValue(false);
  return recordId;
}

function buildQueueLogIndex_(log) {
  const result = {byEventId: {}, byQueueId: {}};
  const lastRow = log.getLastRow();

  if (lastRow < DMS_QUEUE_PROCESSING.LOG_FIRST_ROW) return result;

  const rows = log.getRange(
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    1,
    lastRow - DMS_QUEUE_PROCESSING.LOG_FIRST_ROW + 1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  ).getValues();

  rows.forEach(function(row) {
    const recordId = String(row[0] || '').trim();
    const eventId = String(row[13] || '').trim();
    const queueId = String(row[18] || '').trim();

    if (recordId && eventId && !result.byEventId[eventId]) {
      result.byEventId[eventId] = recordId;
    }

    if (recordId && queueId && !result.byQueueId[queueId]) {
      result.byQueueId[queueId] = recordId;
    }
  });

  return result;
}

function markQueueProcessed_(
  queue,
  rowNumber,
  values,
  confirmationSource,
  comment
) {
  const next = values.slice();

  next[13] = 'Обработано';
  next[14] = new Date();
  next[15] = next[15] || confirmationSource;
  next[16] = mergeQueueComment_(next[16], comment);

  queue.getRange(
    rowNumber,
    1,
    1,
    DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
  ).setValues([next]);
}

function markQueueError_(queue, rowNumber, values, error) {
  const next = values.slice();

  next[13] = next[11] === DMS_UNKNOWN_CLIENT_STATUS
    ? DMS_UNKNOWN_CLIENT_STATUS
    : 'Ошибка';
  next[16] = mergeQueueComment_(next[16], error);

  queue.getRange(
    rowNumber,
    1,
    1,
    DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
  ).setValues([next]);
}

function getSelectedQueueItem_() {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getActiveSheet();

  if (sheet.getName() !== DMS_QUEUE_PROCESSING.QUEUE) {
    throw new Error('Сначала выбери строку на листе «Очередь подтверждения».');
  }

  const row = sheet.getActiveRange().getRow();

  if (row < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
    throw new Error('Выбери строку события, а не заголовок.');
  }

  const values = sheet.getRange(row, 1, 1, 2).getValues()[0];

  if (!values[0] || !(values[1] instanceof Date)) {
    throw new Error('В выбранной строке нет события с корректной датой.');
  }

  return {queueId: String(values[0]), date: values[1]};
}

function makeDateKey_(date, timeZone) {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new Error('Некорректная дата очереди.');
  }

  return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function formatQueueProcessingSummary_(result) {
  const prefix = result.dryRun ? 'Без записи. ' : '';
  const text = prefix + result.dateKey +
    ': в журнал — ' + result.added +
    '; без списания — ' + result.skipped +
    '; уже учтено — ' + result.alreadyLogged +
    '; требует проверки — ' + result.blocked + '.';

  return result.blockers.length
    ? text + ' ' + result.blockers.join(' | ')
    : text;
}

function selfTestQueueProcessing() {
  const allowed = ['Проведена', 'Отмена со списанием'];
  const ignored = ['Отмена без списания', 'Не учитывать'];

  if (allowed.length !== 2 || ignored.length !== 2) {
    throw new Error('Ошибка классификации решений очереди.');
  }

  if (String('Q-0010').match(/^Q-\d{4}$/)[0] !== 'Q-0010') {
    throw new Error('Ошибка формата ID очереди.');
  }

  return 'OK: базовые проверки обработки очереди пройдены.';
}

function processQueueDateLegacyV2_(date, confirmationSource, dryRun) {
  const lock = getDmsMutationLock_();

  if (!lock.tryLock(10000)) {
    throw new Error('Другое действие ещё выполняется. Повтори через несколько секунд.');
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
    const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const dateKey = makeDateKey_(date, timeZone);
    const now = new Date();
    const result = {
      dateKey: dateKey,
      dryRun: Boolean(dryRun),
      total: 0,
      added: 0,
      skipped: 0,
      alreadyLogged: 0,
      blocked: 0,
      blockers: []
    };
    const queueLastRow = queue.getLastRow();

    if (queueLastRow < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
      return result;
    }

    const queueRows = queue.getRange(
      DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
      1,
      queueLastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
      DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
    ).getValues();

    // A planned block becomes active only when its first ended training is
    // actually being counted. Payment data is not changed, so any debt stays.
    if (!dryRun && typeof activateStartedPlannedBlocksForDate_ === 'function') {
      activateStartedPlannedBlocksForDate_(date);
    }

    const context = buildQueueProcessingContext_(clients, blocks, log);

    queueRows.forEach(function(values, index) {
      const rowNumber = DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + index;

      if (!values[0] || !(values[1] instanceof Date)) return;
      if (makeDateKey_(values[1], timeZone) !== dateKey) return;
      if (values[13] === 'Обработано') return;

      result.total++;

      const decision = String(values[12] || '').trim();
      const queueId = String(values[0] || '').trim();
      const eventId = String(values[3] || '').trim();
      const existingRecord = context.logByQueueId[queueId] ||
        context.logByEventId[eventId] || null;

      if (existingRecord) {
        result.alreadyLogged++;

        if (!dryRun) {
          markQueueProcessed_(
            queue,
            rowNumber,
            values,
            confirmationSource,
            'Запись уже существует в журнале: ' + existingRecord
          );
        }
        return;
      }

      if (decision === 'Отмена без списания' || decision === 'Не учитывать') {
        result.skipped++;

        if (!dryRun) {
          markQueueProcessed_(
            queue,
            rowNumber,
            values,
            confirmationSource,
            ''
          );
        }
        return;
      }

      const validation = validateQueueTrainingFast_(
        values,
        decision,
        now,
        context
      );

      if (!validation.ok) {
        result.blocked++;
        result.blockers.push(queueId + ': ' + validation.error);

        if (!dryRun) {
          markQueueError_(queue, rowNumber, values, validation.error);
        }
        return;
      }

      result.added++;

      if (validation.blockId) {
        context.completedByBlock[validation.blockId] =
          (context.completedByBlock[validation.blockId] || 0) + 1;
      }

      if (dryRun) return;

      const recordId = writeQueueTrainingLogRowFast_(log, {
        start: values[5],
        clientId: values[8],
        blockId: validation.blockId,
        format: validation.format,
        accountingType: decision === 'Отмена со списанием'
          ? 'Списание без проведения'
          : 'Фактически проведена',
        trainingPrice: validation.trainingPrice,
        calendarId: values[2],
        eventId: values[3],
        recurringEventId: values[4],
        confirmedAt: now,
        confirmationSource: confirmationSource,
        queueId: queueId
      }, context);

      context.logByQueueId[queueId] = recordId;
      if (eventId) context.logByEventId[eventId] = recordId;

      markQueueProcessed_(
        queue,
        rowNumber,
        values,
        confirmationSource,
        'Запись журнала: ' + recordId
      );
    });

    if (!dryRun) SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function buildQueueProcessingContext_(clients, blocks, log) {
  const context = {
    clientsById: {},
    blocksById: {},
    completedByBlock: {},
    logByEventId: {},
    logByQueueId: {},
    emptyLogRows: [],
    nextLogRow: Math.max(log.getLastRow() + 1, DMS_QUEUE_PROCESSING.LOG_FIRST_ROW),
    nextRecordNumber: 1
  };
  const clientLastRow = clients.getLastRow();
  const blockLastRow = blocks.getLastRow();
  const logLastRow = log.getLastRow();

  if (clientLastRow >= DMS_QUEUE_PROCESSING.CLIENT_FIRST_ROW) {
    clients.getRange(
      DMS_QUEUE_PROCESSING.CLIENT_FIRST_ROW,
      1,
      clientLastRow - DMS_QUEUE_PROCESSING.CLIENT_FIRST_ROW + 1,
      12
    ).getValues().forEach(function(row) {
      const id = String(row[0] || '').trim();
      if (id) context.clientsById[id] = row;
    });
  }

  if (blockLastRow >= DMS_QUEUE_PROCESSING.BLOCK_FIRST_ROW) {
    blocks.getRange(
      DMS_QUEUE_PROCESSING.BLOCK_FIRST_ROW,
      1,
      blockLastRow - DMS_QUEUE_PROCESSING.BLOCK_FIRST_ROW + 1,
      17
    ).getValues().forEach(function(row) {
      const id = String(row[0] || '').trim();
      if (id) context.blocksById[id] = row;
    });
  }

  if (logLastRow >= DMS_QUEUE_PROCESSING.LOG_FIRST_ROW) {
    log.getRange(
      DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
      1,
      logLastRow - DMS_QUEUE_PROCESSING.LOG_FIRST_ROW + 1,
      DMS_QUEUE_PROCESSING.LOG_COLUMNS
    ).getValues().forEach(function(row, index) {
      const sheetRow = DMS_QUEUE_PROCESSING.LOG_FIRST_ROW + index;
      const recordId = String(row[0] || '').trim();
      const blockId = String(row[3] || '').trim();
      const eventId = String(row[13] || '').trim();
      const queueId = String(row[18] || '').trim();

      if (!recordId) {
        context.emptyLogRows.push(sheetRow);
        return;
      }

      const match = recordId.match(/^TR-(\d+)$/);
      if (match) {
        context.nextRecordNumber = Math.max(
          context.nextRecordNumber,
          Number(match[1]) + 1
        );
      }

      if (blockId && row[6] === 'Проведена') {
        context.completedByBlock[blockId] =
          (context.completedByBlock[blockId] || 0) + 1;
      }

      if (eventId && !context.logByEventId[eventId]) {
        context.logByEventId[eventId] = recordId;
      }

      if (queueId && !context.logByQueueId[queueId]) {
        context.logByQueueId[queueId] = recordId;
      }
    });
  }

  return context;
}

function validateQueueTrainingFast_(values, decision, now, context) {
  const clientId = String(values[8] || '').trim();

  if (values[11] !== 'Распознано' || !clientId) {
    return {
      ok: false,
      error: values[11] === DMS_UNKNOWN_CLIENT_STATUS
        ? 'Сначала зарегистрируй или свяжи клиента.'
        : 'Клиент не распознан.'
    };
  }

  if (['Проведена', 'Отмена со списанием'].indexOf(decision) === -1) {
    return {
      ok: false,
      error: decision === 'Перенос'
        ? 'Сначала перенеси событие в календаре и дождись синхронизации.'
        : 'Не выбрано допустимое решение.'
    };
  }

  if (!(values[6] instanceof Date) || values[6] > now) {
    return {ok: false, error: 'Тренировка ещё не завершилась.'};
  }

  const client = context.clientsById[clientId];

  if (!client) {
    return {ok: false, error: 'Клиент отсутствует на листе «Клиенты».'};
  }

  if (client[2] !== 'Активен') {
    return {ok: false, error: 'Статус клиента не «Активен».'};
  }

  const blockId = String(values[10] || client[3] || '').trim();

  if (!blockId) {
    const singlePrice = getSingleTrainingPrice_(client[10]);

    if (!singlePrice) {
      return {ok: false, error: 'Активный блок не указан.'};
    }

    return {
      ok: true,
      blockId: '',
      format: 'Разовая',
      trainingPrice: singlePrice
    };
  }

  if (String(client[3] || '') !== blockId) {
    return {ok: false, error: 'Блок в очереди не совпадает с активным блоком клиента.'};
  }

  const block = context.blocksById[blockId];

  if (!block) {
    return {ok: false, error: 'Блок ' + blockId + ' не найден.'};
  }

  if (String(block[1] || '') !== clientId) {
    return {ok: false, error: 'Блок принадлежит другому клиенту.'};
  }

  if (block[3] !== 'Активен') {
    return {ok: false, error: 'Блок ' + blockId + ' имеет статус «' + (block[3] || 'не указан') + '».'};
  }

  const eventStart = values[5];

  if (block[4] instanceof Date && eventStart < block[4]) {
    return {ok: false, error: 'Тренировка раньше даты открытия блока.'};
  }

  if (block[5] instanceof Date) {
    const endOfBlockDate = new Date(block[5]);
    endOfBlockDate.setHours(23, 59, 59, 999);

    if (eventStart > endOfBlockDate) {
      return {ok: false, error: 'Тренировка позже даты окончания блока.'};
    }
  }

  const total = Number(block[7]) || 0;
  const completed = context.completedByBlock[blockId] || 0;

  if (completed >= total) {
    return {ok: false, error: 'В блоке ' + blockId + ' закончились тренировки.'};
  }

  return {
    ok: true,
    blockId: blockId,
    format: block[2],
    trainingPrice: Number(block[11]) || 0
  };
}

function writeQueueTrainingLogRowFast_(log, data, context) {
  const newRow = context.emptyLogRows.length
    ? context.emptyLogRows.shift()
    : context.nextLogRow++;
  ensureDmsSheetRowCapacity_(log, newRow);
  const recordId = 'TR-' + String(
    context.nextRecordNumber++
  ).padStart(3, '0');
  const template = log.getRange(
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    1,
    1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  );
  const target = log.getRange(
    newRow,
    1,
    1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  );

  template.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  template.copyTo(
    target,
    SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION,
    false
  );

  target.setValues([[
    recordId,
    data.start,
    data.clientId,
    data.blockId,
    data.format,
    data.accountingType,
    'Проведена',
    data.trainingPrice,
    'Calendar',
    '',
    '',
    false,
    data.calendarId,
    data.eventId,
    data.recurringEventId,
    data.start,
    data.confirmedAt,
    data.confirmationSource,
    data.queueId
  ]]);

  log.getRange(newRow, 12).insertCheckboxes().setValue(false);
  return recordId;
}
