function myFunctionTelegramRuntime_() {
}

// DMS Telegram calendar-permission and cancellation-retry extension v18.

function applyTelegramCalendarCancellationsForDate_(date) {
  const lock = getDmsMutationLock_();

  if (!lock.tryLock(10000)) {
    return {
      deleted: 0,
      alreadyMissing: 0,
      failed: 1,
      errors: ['Не удалось обновить календарь: другое действие ещё выполняется.']
    };
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
    const dateKey = makeDateKey_(date, timeZone);
    const result = {deleted: 0, alreadyMissing: 0, failed: 0, errors: []};
    const lastRow = queue.getLastRow();

    if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return result;

    const rows = queue.getRange(
      DMS_TELEGRAM.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues();

    rows.forEach(function(values, index) {
      if (!(values[1] instanceof Date) ||
          makeDateKey_(values[1], timeZone) !== dateKey ||
          ['Обработано', 'Ошибка'].indexOf(String(values[13] || '')) === -1 ||
          ['Telegram', 'MiniApp'].indexOf(String(values[15] || '')) === -1 ||
          ['Отмена со списанием', 'Отмена без списания'].indexOf(values[12]) === -1) {
        return;
      }

      const calendarId = String(values[2] || '').trim();
      const eventId = String(values[3] || '').trim();
      const queueId = String(values[0] || '').trim();
      const rowNumber = DMS_TELEGRAM.QUEUE_FIRST_ROW + index;
      const comment = String(values[16] || '');

      if (!calendarId || !eventId ||
          comment.indexOf('Событие удалено через Telegram') !== -1 ||
          comment.indexOf('Событие уже отсутствует в Google Calendar') !== -1) {
        return;
      }

      try {
        dmsCalendarRemove_(calendarId, eventId, {sendUpdates: 'none'});
        result.deleted++;
        values[13] = 'Обработано';
        values[16] = mergeQueueComment_(
          removeTelegramCalendarPermissionError_(values[16]),
          'Событие удалено через Telegram'
        );
      } catch (error) {
        if (isCalendarEventMissingError_(error) || /resource has been deleted/i.test(String(error && (error.message || error) ? (error.message || error) : error || ''))) {
          
          result.alreadyMissing++;
          values[13] = 'Обработано';
          values[16] = mergeQueueComment_(
            removeTelegramCalendarPermissionError_(values[16]),
            'Событие уже отсутствует в Google Calendar'
          );
        } else {
          const friendly = formatTelegramCalendarPermissionError_(error);
          result.failed++;
          result.errors.push(queueId + ': ' + friendly);
          values[13] = 'Ошибка';
          values[16] = mergeQueueComment_(
            removeTelegramCalendarPermissionError_(values[16]),
            'Учёт выполнен, но событие не удалено из Google Calendar: ' + friendly
          );
        }
      }

      queue.getRange(rowNumber, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS)
        .setValues([values]);
    });

    return result;
  } finally {
    lock.releaseLock();
  }
}

function formatTelegramCalendarPermissionError_(error) {
  const text = String(error && (error.message || error) ? (error.message || error) : error || '');
  if (/permission to call calendar\.events\.(?:delete|remove)|required permissions|authorization is required/i.test(text)) {
    return 'нет разрешения на удаление событий. Нужно один раз заново подтвердить доступ Google Calendar.';
  }
  return text.slice(0, 240) || 'неизвестная ошибка Google Calendar';
}

function removeTelegramCalendarPermissionError_(comment) {
  return String(comment || '')
    .split(/\s*\|\s*/)
    .filter(function(part) {
      return part && part.indexOf('Учёт выполнен, но событие не удалено из Google Calendar:') !== 0;
    })
    .join(' | ');
}

// Run once from the Apps Script editor after a Calendar permission change.
// Apps Script requests the complete current project scope set before execution.
function authorizeDmsCalendarWrite() {
  const ss = SpreadsheetApp.getActive();
  const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
  const config = getCalendarSyncSettings_(settings);
  const response = Calendar.CalendarList.list({maxResults: 1});
  return 'Доступ подтверждён для календаря ' + config.calendarId +
    '. Найдено календарей: ' + ((response.items || []).length) + '.';
}

function repairDmsCalendarCancellations() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
  const timeZone = ss.getSpreadsheetTimeZone() || 'Europe/Moscow';
  const lastRow = queue.getLastRow();
  if (lastRow < DMS_TELEGRAM.QUEUE_FIRST_ROW) return 'Ошибок удаления нет.';
  const rows = queue.getRange(DMS_TELEGRAM.QUEUE_FIRST_ROW, 1,
    lastRow - DMS_TELEGRAM.QUEUE_FIRST_ROW + 1, DMS_TELEGRAM.QUEUE_COLUMNS).getValues();
  const dates = {};
  rows.forEach(function(row) {
    if (row[1] instanceof Date && row[13] === 'Ошибка' && row[15] === 'Telegram' &&
        ['Отмена со списанием', 'Отмена без списания'].indexOf(row[12]) !== -1) {
      dates[makeDateKey_(row[1], timeZone)] = row[1];
    }
  });
  let deleted = 0;
  let missing = 0;
  let failed = 0;
  Object.keys(dates).forEach(function(key) {
    const result = applyTelegramCalendarCancellationsForDate_(dates[key]);
    deleted += result.deleted;
    missing += result.alreadyMissing;
    failed += result.failed;
  });
  return 'Удалено: ' + deleted + '; уже отсутствовало: ' + missing + '; ошибок: ' + failed + '.';
}

// Canonical runtime overrides for block lifecycle and maintenance.

function processQueueDate_(date, confirmationSource, dryRun, options) {
  const settings = options || {};
  const lock = settings.lockHeld ? null : getDmsMutationLock_();

  if (lock && !lock.tryLock(10000)) {
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
      blockers: [],
      autoClosedBlocks: []
    };
    const projectedRows = dryRun && Array.isArray(settings.queueRows)
      ? settings.queueRows.map(function(values) { return values.slice(); })
      : null;
    const queueLastRow = projectedRows
      ? DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + projectedRows.length - 1
      : queue.getLastRow();

    if (!dryRun && typeof activateStartedPlannedBlocksForDate_ === 'function') {
      activateStartedPlannedBlocksForDate_(date);
    }

    const context = buildQueueProcessingContext_(clients, blocks, log);

    // Repair stale active links even when the day has no queue rows.
    if (!dryRun) {
      result.autoClosedBlocks = autoCloseAllExhaustedBlocks_(
        clients,
        blocks,
        context,
        date
      );
    }

    if (queueLastRow < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
      if (!dryRun) SpreadsheetApp.flush();
      return result;
    }

    const queueRows = projectedRows || queue.getRange(
      DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
      1,
      queueLastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
      DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
    ).getValues();

    if (dryRun && settings.projectPlannedActivations) {
      projectStartedPlannedBlocksForDate_(
        dateKey,
        queueRows,
        context,
        timeZone,
        now
      );
    }

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
          markQueueProcessed_(queue, rowNumber, values, confirmationSource, '');
        }
        return;
      }

      const exhausted = getExhaustedQueueBlock_(values, context);
      if (exhausted) {
        const message = 'Нужен новый блок: ' + exhausted.blockId +
          ' закрыт автоматически, все ' + exhausted.total +
          ' тренировок уже использованы.';
        result.blocked++;
        result.blockers.push(queueId + ': ' + message);

        if (!dryRun) {
          autoCloseExhaustedBlock_(
            clients,
            blocks,
            context,
            exhausted.blockId,
            date
          );
          markQueueNeedsNewBlock_(queue, rowNumber, values, message);
        }
        return;
      }

      const validation = validateQueueTrainingFast_(values, decision, now, context);

      if (!validation.ok) {
        result.blocked++;
        result.blockers.push(queueId + ': ' + validation.error);

        if (!dryRun) markQueueError_(queue, rowNumber, values, validation.error);
        return;
      }

      result.added++;

      if (dryRun) {
        if (validation.blockId) {
          context.completedByBlock[validation.blockId] =
            (context.completedByBlock[validation.blockId] || 0) + 1;
        }
        return;
      }

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

      if (validation.blockId) {
        context.completedByBlock[validation.blockId] =
          (context.completedByBlock[validation.blockId] || 0) + 1;
      }

      markQueueProcessed_(
        queue,
        rowNumber,
        values,
        confirmationSource,
        'Запись журнала: ' + recordId
      );

      if (validation.blockId && autoCloseExhaustedBlock_(
        clients,
        blocks,
        context,
        validation.blockId,
        values[5] || date
      )) {
        result.autoClosedBlocks.push(validation.blockId);
      }
    });

    if (!dryRun) SpreadsheetApp.flush();
    return result;
  } finally {
    if (lock) lock.releaseLock();
  }
}

function projectStartedPlannedBlocksForDate_(
  dateKey,
  queueRows,
  context,
  timeZone,
  now
) {
  queueRows.forEach(function(values) {
    if (!(values[1] instanceof Date) || makeDateKey_(values[1], timeZone) !== dateKey) {
      return;
    }
    if (values[13] === 'Обработано') return;
    if (['Проведена', 'Отмена со списанием'].indexOf(String(values[12] || '')) === -1) {
      return;
    }
    if (!(values[6] instanceof Date) || values[6] > now) return;

    const blockId = String(values[10] || '').trim();
    const block = context.blocksById[blockId];
    if (block && block[3] === 'Запланирован') block[3] = 'Активен';
  });
}

function getExhaustedQueueBlock_(values, context) {
  const clientId = String(values[8] || '').trim();
  const client = context.clientsById[clientId] || [];
  const blockId = String(values[10] || client[3] || '').trim();
  if (!blockId) return null;

  const block = context.blocksById[blockId];
  if (!block) return null;

  const total = Number(block[7]) || 0;
  const completed = context.completedByBlock[blockId] || 0;
  if (total <= 0 || completed < total) return null;

  return {blockId: blockId, total: total, completed: completed};
}

function markQueueNeedsNewBlock_(queue, rowNumber, values, message) {
  const next = values.slice();
  next[13] = 'Ожидает';
  next[14] = '';
  next[15] = '';
  next[16] = replaceQueueLifecycleError_(next[16], message);
  queue.getRange(
    rowNumber,
    1,
    1,
    DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
  ).setValues([next]);
}

function replaceQueueLifecycleError_(comment, message) {
  const stale = [
    /В блоке [^|]+ закончились тренировки\.?/g,
    /Блок [^|]+ имеет статус «Закрыт»\.?/g,
    /Блок в очереди не совпадает с активным блоком клиента\.?/g
  ];
  let parts = String(comment || '').split(' | ').map(function(item) {
    return item.trim();
  }).filter(Boolean);

  parts = parts.filter(function(item) {
    return !stale.some(function(pattern) {
      pattern.lastIndex = 0;
      return pattern.test(item);
    });
  });

  if (parts.indexOf(message) === -1) parts.push(message);
  return parts.join(' | ');
}

function autoCloseAllExhaustedBlocks_(clients, blocks, context, closedAt) {
  const closed = [];
  Object.keys(context.blocksById).forEach(function(blockId) {
    if (autoCloseExhaustedBlock_(
      clients,
      blocks,
      context,
      blockId,
      closedAt
    )) closed.push(blockId);
  });
  return closed;
}

function autoCloseExhaustedBlock_(clients, blocks, context, blockId, closedAt) {
  const block = context.blocksById[blockId];
  if (!block) return false;

  const total = Number(block[7]) || 0;
  const completed = context.completedByBlock[blockId] || 0;
  if (total <= 0 || completed < total) return false;

  const status = String(block[3] || '').trim();
  const clientId = String(block[1] || '').trim();
  const blockRow = findRowByValue_(
    blocks,
    1,
    blockId,
    DMS_QUEUE_PROCESSING.BLOCK_FIRST_ROW
  );
  let changed = false;

  if (blockRow && status !== 'Закрыт') {
    if (['Активен', 'Приостановлен'].indexOf(status) === -1) return false;
    setTelegramBlockStatus_(blocks, blockRow, 'Закрыт');
    blocks.getRange(blockRow, 6).setValue(
      closedAt instanceof Date ? closedAt : new Date()
    );
    blocks.getRange(blockRow, 7).setValue(
      'Закрыт автоматически: использованы все тренировки'
    );
    const conditions = blocks.getRange(blockRow, 16).getValue();
    blocks.getRange(blockRow, 16).setValue(
      appendTelegramAuditNote_(conditions, 'Блок закрыт автоматически: ' +
        completed + ' из ' + total)
    );
    block[3] = 'Закрыт';
    changed = true;
  }

  const client = context.clientsById[clientId];
  if (client && String(client[3] || '').trim() === blockId) {
    const clientRow = findRowByValue_(
      clients,
      1,
      clientId,
      DMS_QUEUE_PROCESSING.CLIENT_FIRST_ROW
    );
    if (clientRow) {
      clients.getRange(clientRow, 4, 1, 2).clearContent();
      client[3] = '';
      client[4] = '';
      changed = true;
    }
  }

  return changed;
}

function closeAllExhaustedBlocks() {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const ss = SpreadsheetApp.getActive();
    const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const context = buildQueueProcessingContext_(clients, blocks, log);
    const closed = autoCloseAllExhaustedBlocks_(
      clients,
      blocks,
      context,
      new Date()
    );
    SpreadsheetApp.flush();
    console.log('Автоматически закрыты блоки: ' + (closed.join(', ') || 'нет'));
    return closed;
  } finally {
    lock.releaseLock();
  }
}

function runDmsMaintenance() {
  const closed = closeAllExhaustedBlocks();
  const calendar = typeof repairDmsCalendarCancellations === 'function'
    ? repairDmsCalendarCancellations()
    : {retried: 0, deleted: 0, missing: 0, failed: 0, errors: []};
  const result = {closedBlocks: closed, calendar: calendar};
  console.log(JSON.stringify(result));
  return result;
}

// One-off and scheduled maintenance entry points.

function repairDmsExhaustedQueueRows() {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
    const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const context = buildQueueProcessingContext_(clients, blocks, log);
    const repaired = [];
    const lastRow = queue.getLastRow();

    if (lastRow < DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) return repaired;

    const rows = queue.getRange(
      DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
      DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
    ).getValues();

    rows.forEach(function(values, index) {
      if (!values[0] || values[13] === 'Обработано') return;

      const exhausted = getExhaustedQueueBlock_(values, context);
      if (!exhausted) return;

      autoCloseExhaustedBlock_(
        clients,
        blocks,
        context,
        exhausted.blockId,
        values[5] instanceof Date ? values[5] : new Date()
      );

      const message = 'Нужен новый блок: ' + exhausted.blockId +
        ' закрыт автоматически, все ' + exhausted.total +
        ' тренировок уже использованы.';
      markQueueNeedsNewBlock_(
        queue,
        DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + index,
        values,
        message
      );
      repaired.push(String(values[0]));
    });

    SpreadsheetApp.flush();
    console.log('Исправлены строки очереди: ' + (repaired.join(', ') || 'нет'));
    return repaired;
  } finally {
    lock.releaseLock();
  }
}

function getDmsSystemHealth() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
  const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
  const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
  const context = buildQueueProcessingContext_(clients, blocks, log);
  const health = {
    exhaustedOpenBlocks: [],
    queueWaiting: 0,
    queueErrors: 0,
    queueRegistrations: 0,
    triggers: ScriptApp.getProjectTriggers().map(function(trigger) {
      return trigger.getHandlerFunction();
    })
  };

  Object.keys(context.blocksById).forEach(function(blockId) {
    const block = context.blocksById[blockId];
    const total = Number(block[7]) || 0;
    const completed = context.completedByBlock[blockId] || 0;
    if (total > 0 && completed >= total && block[3] !== 'Закрыт') {
      health.exhaustedOpenBlocks.push(blockId);
    }
  });

  const lastRow = queue.getLastRow();
  if (lastRow >= DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW) {
    queue.getRange(
      DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
      14,
      lastRow - DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW + 1,
      1
    ).getDisplayValues().forEach(function(row) {
      if (row[0] === 'Ожидает') health.queueWaiting++;
      if (row[0] === 'Ошибка') health.queueErrors++;
      if (row[0] === DMS_UNKNOWN_CLIENT_STATUS) health.queueRegistrations++;
    });
  }

  console.log(JSON.stringify(health));
  return health;
}

function runDmsReadOnlySelfTests() {
  const startedAt = new Date();
  const report = {
    ok: true,
    checkedAt: startedAt,
    durationMs: 0,
    checks: []
  };

  try {
    const ss = SpreadsheetApp.getActive();
    const timeZone = ss.getSpreadsheetTimeZone() || '';
    addDmsSelfTestCheck_(
      report,
      'timezone',
      timeZone === 'Europe/Moscow',
      timeZone || 'не указан'
    );

    const requiredSheets = [
      [DMS_QUEUE_PROCESSING.QUEUE, DMS_QUEUE_PROCESSING.QUEUE_COLUMNS],
      [DMS_QUEUE_PROCESSING.CLIENTS, 14],
      [DMS_QUEUE_PROCESSING.BLOCKS, 17],
      [DMS_QUEUE_PROCESSING.LOG, DMS_QUEUE_PROCESSING.LOG_COLUMNS],
      [DMS_SYNC.SETTINGS, 2]
    ];

    requiredSheets.forEach(function(spec) {
      const sheet = getRequiredSheet_(ss, spec[0]);
      const columns = sheet.getMaxColumns();
      addDmsSelfTestCheck_(
        report,
        'sheet:' + spec[0],
        columns >= spec[1],
        columns + ' столбцов; требуется не меньше ' + spec[1]
      );
    });

    const health = getDmsSystemHealth();
    addDmsSelfTestCheck_(
      report,
      'queue-errors',
      health.queueErrors === 0,
      String(health.queueErrors)
    );
    const debtFormula = getDmsDebtFormulaHealth_();
    const queueSourceValidation = getDmsQueueSourceValidationHealth_();
    addDmsSelfTestCheck_(
      report,
      'queue-source-validation',
      queueSourceValidation.ok,
      queueSourceValidation.summary
    );
    addDmsSelfTestCheck_(
      report,
      'debt-formula-integrity',
      debtFormula.ok,
      debtFormula.summary
    );
    addDmsSelfTestCheck_(
      report,
      'exhausted-open-blocks',
      health.exhaustedOpenBlocks.length === 0,
      health.exhaustedOpenBlocks.join(', ') || 'нет'
    );

    const requiredTriggers = [
      'sendTelegramDailyQueue',
      'sendTelegramMorningDigest',
      'syncCalendarToQueue',
      'createDmsAutomaticBackup',
      'runDmsWatchdog'
    ];
    const missingTriggers = requiredTriggers.filter(function(name) {
      return health.triggers.indexOf(name) === -1;
    });
    addDmsSelfTestCheck_(
      report,
      'required-triggers',
      missingTriggers.length === 0,
      missingTriggers.length ? 'нет: ' + missingTriggers.join(', ') : 'все активны'
    );

    const clients = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.CLIENTS);
    const blocks = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.BLOCKS);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const context = buildQueueProcessingContext_(clients, blocks, log);
    const brokenLinks = findDmsBrokenActiveBlockLinks_(context);
    addDmsSelfTestCheck_(
      report,
      'active-block-links',
      brokenLinks.length === 0,
      brokenLinks.join('; ') || 'ошибок нет'
    );

    const duplicateKeys = findDmsDuplicateAccountingKeys_(log);
    addDmsSelfTestCheck_(
      report,
      'duplicate-accounting-keys',
      duplicateKeys.length === 0,
      duplicateKeys.join('; ') || 'дублей нет'
    );

    const reconciliation = runDmsCalendarQueueReconciliation();
    addDmsSelfTestCheck_(
      report,
      'calendar-queue-journal-reconciliation',
      reconciliation.ok,
      reconciliation.summary
    );

    const backup = validateLatestDmsBackup();
    addDmsSelfTestCheck_(
      report,
      'latest-backup-integrity',
      backup.ok,
      backup.summary
    );

    const setup = getTelegramSetupStatus();
    addDmsSelfTestCheck_(
      report,
      'telegram-configuration',
      Boolean(setup.configured),
      setup.configured ? 'настроено' : 'не хватает: ' + setup.missing.join(', ')
    );

    addDmsSelfTestCheck_(
      report,
      'calendar-read-access',
      true,
      'доступ подтверждён'
    );
  } catch (error) {
    addDmsSelfTestCheck_(
      report,
      'self-test-runtime',
      false,
      error && error.message ? error.message : String(error)
    );
  }

  report.durationMs = new Date().getTime() - startedAt.getTime();
  report.summary = report.ok
    ? 'Все проверки пройдены: ' + report.checks.length
    : 'Есть ошибки: ' + report.checks.filter(function(check) {
      return !check.ok;
    }).length + ' из ' + report.checks.length;
  console.log(JSON.stringify(report));
  return report;
}

function getDmsDebtFormulaHealth_() {
  const health = getDmsFinancialHealth_();
  return {ok: health.ok, anchor: 'Клиенты!J5', extraFormulaRows: [], errorRows: [],
    issues: health.issues, numericMismatches: health.mismatches, summary: health.summary};
}

function addDmsSelfTestCheck_(report, name, ok, details) {
  const check = {
    name: String(name || ''),
    ok: Boolean(ok),
    details: String(details || '')
  };
  report.checks.push(check);
  if (!check.ok) report.ok = false;
}

function findDmsBrokenActiveBlockLinks_(context) {
  const broken = [];
  Object.keys(context.clientsById).forEach(function(clientId) {
    const client = context.clientsById[clientId];
    const blockId = String(client[3] || '').trim();
    if (!blockId) return;

    const block = context.blocksById[blockId];
    if (!block) {
      broken.push(clientId + ' -> отсутствует ' + blockId);
      return;
    }
    if (String(block[1] || '').trim() !== clientId) {
      broken.push(clientId + ' -> чужой блок ' + blockId);
    }
    if (String(block[3] || '').trim() === 'Закрыт') {
      broken.push(clientId + ' -> закрытый блок ' + blockId);
    }
  });
  return broken;
}

function findDmsDuplicateAccountingKeys_(log) {
  const duplicates = [];
  const lastRow = log.getLastRow();
  if (lastRow < DMS_QUEUE_PROCESSING.LOG_FIRST_ROW) return duplicates;

  const rows = log.getRange(
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    1,
    lastRow - DMS_QUEUE_PROCESSING.LOG_FIRST_ROW + 1,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  ).getValues();
  const byEventId = {};
  const byQueueId = {};

  rows.forEach(function(row) {
    const recordId = String(row[0] || '').trim();
    if (!recordId) return;
    const eventId = String(row[13] || '').trim();
    const queueId = String(row[18] || '').trim();
    collectDmsDuplicateKey_(byEventId, eventId, recordId);
    collectDmsDuplicateKey_(byQueueId, queueId, recordId);
  });

  Object.keys(byEventId).forEach(function(eventId) {
    if (byEventId[eventId].length > 1) {
      duplicates.push('event ' + eventId + ': ' + byEventId[eventId].join(', '));
    }
  });
  Object.keys(byQueueId).forEach(function(queueId) {
    if (byQueueId[queueId].length > 1) {
      duplicates.push('queue ' + queueId + ': ' + byQueueId[queueId].join(', '));
    }
  });
  return duplicates;
}

function collectDmsDuplicateKey_(index, key, recordId) {
  if (!key) return;
  if (!index[key]) index[key] = [];
  index[key].push(recordId);
}

function runDmsCalendarQueueReconciliation() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
  const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
  const config = getCalendarSyncSettings_(settings);
  const now = new Date();
  const windowEnd = new Date(now.getTime());
  windowEnd.setDate(windowEnd.getDate() + 1);

  const queueRows = readDmsReconciliationRows_(
    queue,
    DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW,
    DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
  );
  const logRows = readDmsReconciliationRows_(
    log,
    DMS_QUEUE_PROCESSING.LOG_FIRST_ROW,
    DMS_QUEUE_PROCESSING.LOG_COLUMNS
  );
  const events = listCalendarEvents_(
    config.calendarId,
    config.startDate,
    windowEnd,
    config.timeZone
  );
  const report = buildDmsCalendarQueueReconciliationReport_(
    queueRows,
    logRows,
    events,
    {
      calendarId: config.calendarId,
      startDate: config.startDate,
      endDate: windowEnd
    }
  );

  console.log(JSON.stringify(report));
  return report;
}

function readDmsReconciliationRows_(sheet, firstRow, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow < firstRow) return [];

  return sheet.getRange(
    firstRow,
    1,
    lastRow - firstRow + 1,
    columns
  ).getValues().map(function(values, index) {
    return {row: firstRow + index, values: values};
  });
}

function buildDmsCalendarQueueReconciliationReport_(
  queueRows,
  logRows,
  calendarEvents,
  config
) {
  const issues = {
    duplicateQueueIds: [],
    duplicateQueueEventIds: [],
    pendingAlreadyLogged: [],
    processedMissingJournal: [],
    nonChargeHasJournal: [],
    orphanJournalRows: [],
    queueJournalMismatch: [],
    pendingMissingCalendar: [],
    calendarQueueTimeMismatch: [],
    queuePointsToNonTraining: [],
    calendarTrainingMissingQueue: []
  };
  const queueById = {};
  const queueByEventId = {};
  const logByQueueId = {};
  const logByEventId = {};
  const eventById = {};
  const safeRepairs = [];

  (queueRows || []).forEach(function(item) {
    const values = item.values || [];
    const queueId = String(values[0] || '').trim();
    const eventId = String(values[3] || '').trim();
    if (!queueId) return;
    collectDmsReconciliationItem_(queueById, queueId, item);
    if (eventId) collectDmsReconciliationItem_(queueByEventId, eventId, item);
  });

  (logRows || []).forEach(function(item) {
    const values = item.values || [];
    const recordId = String(values[0] || '').trim();
    const eventId = String(values[13] || '').trim();
    const queueId = String(values[18] || '').trim();
    if (!recordId) return;
    if (queueId) collectDmsReconciliationItem_(logByQueueId, queueId, item);
    if (eventId) collectDmsReconciliationItem_(logByEventId, eventId, item);
  });

  (calendarEvents || []).forEach(function(event) {
    const eventId = String(event && event.id || '').trim();
    if (eventId) eventById[eventId] = event;
  });

  collectDmsDuplicateReconciliationKeys_(
    queueById,
    issues.duplicateQueueIds,
    'queueId'
  );
  collectDmsDuplicateReconciliationKeys_(
    queueByEventId,
    issues.duplicateQueueEventIds,
    'eventId'
  );

  (queueRows || []).forEach(function(item) {
    const values = item.values || [];
    const queueId = String(values[0] || '').trim();
    if (!queueId) return;

    const eventId = String(values[3] || '').trim();
    const status = String(values[13] || '').trim();
    const decision = String(values[12] || '').trim();
    const source = String(values[15] || '').trim();
    const matchingLogs = (logByQueueId[queueId] || []).concat(
      eventId ? (logByEventId[eventId] || []) : []
    );
    const uniqueLogs = uniqueDmsReconciliationItems_(matchingLogs);
    const recordId = uniqueLogs.length
      ? String(uniqueLogs[0].values[0] || '').trim()
      : '';
    const chargesTraining =
      decision === 'Проведена' || decision === 'Отмена со списанием';
    const skipsTraining =
      decision === 'Отмена без списания' || decision === 'Не учитывать';

    if (status === 'Обработано') {
      if (chargesTraining && !uniqueLogs.length) {
        issues.processedMissingJournal.push({
          queueId: queueId,
          row: item.row,
          decision: decision
        });
      }
      if (skipsTraining && uniqueLogs.length) {
        issues.nonChargeHasJournal.push({
          queueId: queueId,
          row: item.row,
          recordId: recordId,
          decision: decision
        });
      }
    } else if (uniqueLogs.length) {
      const issue = {
        queueId: queueId,
        row: item.row,
        recordId: recordId
      };
      issues.pendingAlreadyLogged.push(issue);
      safeRepairs.push({
        type: 'mark_queue_processed',
        queueId: queueId,
        row: item.row,
        recordId: recordId
      });
    }

    uniqueLogs.forEach(function(logItem) {
      const logEventId = String(logItem.values[13] || '').trim();
      const logQueueId = String(logItem.values[18] || '').trim();
      if (
        (logQueueId && logQueueId !== queueId) ||
        (eventId && logEventId && logEventId !== eventId)
      ) {
        issues.queueJournalMismatch.push({
          queueId: queueId,
          recordId: String(logItem.values[0] || '').trim()
        });
      }
    });

    const eventStart = values[5];
    const inCalendarWindow =
      eventStart instanceof Date &&
      config && config.startDate instanceof Date &&
      config.endDate instanceof Date &&
      eventStart >= config.startDate &&
      eventStart < config.endDate;

    if (
      status !== 'Обработано' &&
      source === 'Calendar' &&
      ['Отмена со списанием', 'Отмена без списания'].indexOf(decision) === -1 &&
      eventId &&
      inCalendarWindow
    ) {
      const event = eventById[eventId];
      if (!event || event.status === 'cancelled') {
        issues.pendingMissingCalendar.push({queueId: queueId, row: item.row});
      } else if (!isTrainingEventTitle_(event.summary || '')) {
        issues.queuePointsToNonTraining.push({queueId: queueId, row: item.row});
      } else {
        const times = getCalendarEventTimes_(event);
        if (
          times &&
          (!sameCalendarMoment_(values[5], times.start) ||
            !sameCalendarMoment_(values[6], times.end))
        ) {
          issues.calendarQueueTimeMismatch.push({queueId: queueId, row: item.row});
        }
      }
    }
  });

  (logRows || []).forEach(function(item) {
    const values = item.values || [];
    const recordId = String(values[0] || '').trim();
    const queueId = String(values[18] || '').trim();
    if (recordId && queueId && !queueById[queueId]) {
      issues.orphanJournalRows.push({recordId: recordId, queueId: queueId});
    }
  });

  (calendarEvents || []).forEach(function(event) {
    const eventId = String(event && event.id || '').trim();
    if (
      !eventId ||
      event.status === 'cancelled' ||
      !isTrainingEventTitle_(event.summary || '') ||
      queueByEventId[eventId]
    ) {
      return;
    }
    const times = getCalendarEventTimes_(event);
    if (
      times &&
      config && config.startDate instanceof Date &&
      config.endDate instanceof Date &&
      times.start >= config.startDate &&
      times.start < config.endDate
    ) {
      issues.calendarTrainingMissingQueue.push({
        eventId: eventId,
        start: times.start,
        title: String(event.summary || '').trim()
      });
    }
  });

  const issueCount = Object.keys(issues).reduce(function(total, name) {
    return total + issues[name].length;
  }, 0);
  const report = {
    ok: issueCount === 0,
    checkedAt: new Date(),
    issueCount: issueCount,
    safeRepairCount: safeRepairs.length,
    counts: {
      queueRows: (queueRows || []).filter(function(item) {
        return String(item.values && item.values[0] || '').trim();
      }).length,
      journalRows: (logRows || []).filter(function(item) {
        return String(item.values && item.values[0] || '').trim();
      }).length,
      calendarEvents: (calendarEvents || []).length
    },
    issues: issues,
    safeRepairs: safeRepairs
  };
  report.summary = report.ok
    ? 'Calendar ↔ Queue ↔ Journal: расхождений нет'
    : 'Calendar ↔ Queue ↔ Journal: ' + issueCount +
      ' расхождений; безопасно исправимых: ' + safeRepairs.length;
  return report;
}

function collectDmsReconciliationItem_(index, key, item) {
  if (!index[key]) index[key] = [];
  index[key].push(item);
}

function collectDmsDuplicateReconciliationKeys_(index, target, type) {
  Object.keys(index).forEach(function(key) {
    if (index[key].length > 1) {
      target.push({
        type: type,
        key: key,
        rows: index[key].map(function(item) { return item.row; })
      });
    }
  });
}

function uniqueDmsReconciliationItems_(items) {
  const seen = {};
  return (items || []).filter(function(item) {
    const key = String(item.row) + ':' + String(item.values && item.values[0] || '');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function previewDmsCalendarQueueRepair() {
  return runDmsCalendarQueueReconciliation();
}

function repairDmsCalendarQueueReconciliation() {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const report = runDmsCalendarQueueReconciliation();
    if (!report.safeRepairs.length) {
      console.log('Безопасных исправлений не требуется.');
      return {repaired: [], report: report};
    }

    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
    const log = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.LOG);
    const logIndex = buildQueueLogIndex_(log);
    const prepared = report.safeRepairs.map(function(repair) {
      const values = queue.getRange(
        repair.row,
        1,
        1,
        DMS_QUEUE_PROCESSING.QUEUE_COLUMNS
      ).getValues()[0];
      const queueId = String(values[0] || '').trim();
      const eventId = String(values[3] || '').trim();
      const recordId = logIndex.byQueueId[queueId] ||
        (eventId ? logIndex.byEventId[eventId] : '') || '';

      if (queueId !== repair.queueId) {
        throw new Error(repair.queueId + ': строка очереди изменилась после проверки.');
      }
      if (String(values[13] || '').trim() === 'Обработано') {
        return null;
      }
      if (!recordId || recordId !== repair.recordId) {
        throw new Error(repair.queueId + ': журнальная запись изменилась после проверки.');
      }
      return {
        row: repair.row,
        values: values,
        queueId: queueId,
        recordId: recordId
      };
    }).filter(Boolean);

    prepared.forEach(function(item) {
      markQueueProcessed_(
        queue,
        item.row,
        item.values,
        'Автовосстановление',
        'Запись уже существует в журнале: ' + item.recordId
      );
    });
    SpreadsheetApp.flush();

    const repaired = prepared.map(function(item) { return item.queueId; });
    console.log('Безопасно исправлены строки очереди: ' + repaired.join(', '));
    return {repaired: repaired, report: report};
  } finally {
    lock.releaseLock();
  }
}

function repairDmsCalendarCancellationQ0038() {
  return repairDmsCalendarCancellationByQueueId_('Q-0038');
}

function repairDmsCalendarCancellationByQueueId_(queueId) {
  const lock = getDmsMutationLock_();
  if (!lock.tryLock(10000)) throw new Error('Другое действие ещё выполняется.');

  try {
    const ss = SpreadsheetApp.getActive();
    const queue = getRequiredSheet_(ss, DMS_TELEGRAM.QUEUE);
    const rowNumber = findRowByValue_(
      queue,
      1,
      queueId,
      DMS_TELEGRAM.QUEUE_FIRST_ROW
    );
    if (!rowNumber) throw new Error('Строка ' + queueId + ' не найдена.');

    const values = queue.getRange(
      rowNumber,
      1,
      1,
      DMS_TELEGRAM.QUEUE_COLUMNS
    ).getValues()[0];
    const decision = String(values[12] || '');
    if (['Отмена со списанием', 'Отмена без списания'].indexOf(decision) === -1) {
      throw new Error(queueId + ': это не отмена через Telegram.');
    }

    const calendarId = String(values[2] || '').trim();
    const eventId = String(values[3] || '').trim();
    if (!calendarId || !eventId) {
      throw new Error(queueId + ': не указан идентификатор события.');
    }

    let result;
    try {
      dmsCalendarRemove_(calendarId, eventId, {sendUpdates: 'none'});
      result = 'Событие удалено через Telegram';
    } catch (error) {
      if (!isCalendarEventMissingError_(error)) throw error;
      result = 'Событие уже отсутствует в Google Calendar';
    }

    values[13] = 'Обработано';
    values[16] = mergeQueueComment_(
      removeTelegramCalendarPermissionError_(values[16]),
      result
    );
    queue.getRange(rowNumber, 1, 1, DMS_TELEGRAM.QUEUE_COLUMNS)
      .setValues([values]);
    SpreadsheetApp.flush();
    console.log(queueId + ': ' + result);
    return queueId + ': ' + result;
  } finally {
    lock.releaseLock();
  }
}

function runDmsBackupSetupV31() {
  const trigger = installDmsBackupTrigger();
  const backupId = createDmsAutomaticBackup();
  const validation = validateLatestDmsBackup();
  if (!validation.ok) {
    throw new Error('Созданная копия не прошла проверку: ' + validation.summary);
  }
  const result = {
    trigger: trigger,
    backupId: backupId,
    validation: validation.summary
  };
  console.log(JSON.stringify(result));
  return result;
}

function runDmsWatchdog() {
  const report = runDmsReadOnlySelfTests();
  const props = PropertiesService.getScriptProperties();
  const signatureKey = 'DMS_WATCHDOG_ALERT_SIGNATURE';
  const sentAtKey = 'DMS_WATCHDOG_LAST_ALERT_AT';

  if (report.ok) {
    props.deleteProperty(signatureKey);
    props.deleteProperty(sentAtKey);
    return {ok: true, notified: false, summary: report.summary};
  }

  const failed = report.checks.filter(function(check) { return !check.ok; });
  const signature = JSON.stringify(failed.map(function(check) {
    return [check.name, check.details];
  }));
  const previousSignature = props.getProperty(signatureKey) || '';
  const previousSentAt = Number(props.getProperty(sentAtKey) || 0);
  const now = new Date().getTime();
  const repeatAfterMs = 12 * 60 * 60 * 1000;

  if (signature === previousSignature && previousSentAt && now - previousSentAt < repeatAfterMs) {
    return {ok: false, notified: false, deduplicated: true, summary: report.summary};
  }

  const chatId = getTelegramProperty_(DMS_TELEGRAM.PROP_CHAT_ID);
  if (!chatId) throw new Error('Не задан Telegram Chat ID для системного уведомления.');

  telegramSendMessage_(chatId, formatDmsWatchdogAlert_(failed), null);
  props.setProperty(signatureKey, signature);
  props.setProperty(sentAtKey, String(now));
  return {ok: false, notified: true, summary: report.summary};
}

function formatDmsWatchdogAlert_(failedChecks) {
  const lines = ['<b>⚠️ DMS Fitness — системная проверка</b>'];
  (failedChecks || []).forEach(function(check) {
    const details = String(check.details || '').slice(0, 240);
    lines.push(
      '• <b>' + escapeTelegramHtml_(check.name) + '</b>: ' +
      escapeTelegramHtml_(details)
    );
  });
  lines.push('', 'Повторное одинаковое уведомление будет не чаще одного раза в 12 часов.');
  return lines.join('\n');
}

function installDmsWatchdogTrigger() {
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'runDmsWatchdog';
  }).forEach(function(trigger) {
    ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger('runDmsWatchdog')
    .timeBased()
    .everyHours(2)
    .create();
  return 'Watchdog установлен: проверка каждые 2 часа.';
}

function runDmsMonitoringSetupV32() {
  const trigger = installDmsWatchdogTrigger();
  const check = runDmsWatchdog();
  const result = {trigger: trigger, check: check};
  console.log(JSON.stringify(result));
  return result;
}



function getDmsQueueSourceValidationHealth_() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const firstRow = DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW;
  const rowCount = queue.getMaxRows() - firstRow + 1;
  const required = ['Calendar', 'Telegram', 'Вручную', 'Система', 'MiniApp'];
  const invalidRows = [];
  const validations = queue.getRange(firstRow, 16, rowCount, 1).getDataValidations();

  validations.forEach(function(row, index) {
    const rule = row[0];
    if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      invalidRows.push(firstRow + index);
      return;
    }
    const criteria = rule.getCriteriaValues();
    const allowed = Array.isArray(criteria[0])
      ? criteria[0].map(function(value) { return String(value); })
      : [];
    if (required.some(function(value) { return allowed.indexOf(value) === -1; })) {
      invalidRows.push(firstRow + index);
    }
  });

  return {
    ok: invalidRows.length === 0,
    invalidRows: invalidRows.slice(0, 20),
    summary: invalidRows.length
      ? 'Очередь подтверждения!P: несовместимая validation в строках ' +
        invalidRows.slice(0, 20).join(', ')
      : 'Очередь подтверждения!P: MiniApp разрешён во всём рабочем диапазоне'
  };
}

function repairDmsQueueSourceValidation() {
  const ss = SpreadsheetApp.getActive();
  const queue = getRequiredSheet_(ss, DMS_QUEUE_PROCESSING.QUEUE);
  const firstRow = DMS_QUEUE_PROCESSING.QUEUE_FIRST_ROW;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['Calendar', 'Telegram', 'Вручную', 'Система', 'MiniApp'], true)
    .setAllowInvalid(false)
    .build();
  queue.getRange(firstRow, 16, queue.getMaxRows() - firstRow + 1, 1)
    .setDataValidation(rule);
  SpreadsheetApp.flush();
  return getDmsQueueSourceValidationHealth_();
}
