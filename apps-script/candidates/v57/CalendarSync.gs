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

const DMS_UNKNOWN_CLIENT_STATUS = 'Требует регистрации';

const DMS_CALENDAR_SCAN = {
  VERSION: 1,
  STATE_KEY: 'DMS_CALENDAR_BOUNDED_SCAN_V1',
  OVERLAP_MS: 24 * 60 * 60 * 1000,
  BOOTSTRAP_UPDATED_LOOKBACK_MS: 7 * 24 * 60 * 60 * 1000,
  WIDE_LOOKBACK_DAYS: 120,
  WIDE_INTERVAL_MS: 24 * 60 * 60 * 1000
};

function syncCalendarToQueue(event) {
  const metrics = beginDmsOperationMetrics_(
    event && event.triggerUid ? 'calendar_sync_scheduled' : 'calendar_sync_inline'
  );
  let execution = null;
  const lock = getDmsMutationLock_();
  try {
    execution = beginDmsScheduledAutomationExecution_('syncCalendarToQueue', event);
    const lockStartedAt = Date.now();
    if (!lock.tryLock(10000)) {
      addDmsOperationDuration_(metrics, 'lockWaitMs', Date.now() - lockStartedAt);
      throw new Error('Синхронизация уже выполняется. Повтори через несколько секунд.');
    }
    addDmsOperationDuration_(metrics, 'lockWaitMs', Date.now() - lockStartedAt);
    try {
      const syncState = beginDmsCalendarSyncGeneration_();
      try {
      const observation = {now: new Date()};
      const before = getDmsCalendarIngestionEvidence_(measureDmsOperationPhase_(
        metrics,
        'reconciliationMs',
        function() { return runDmsCalendarQueueReconciliation(metrics, observation); }
      ));
      const plan = buildCalendarQueueSyncPlan_(metrics, observation);
      if (plan.errors) throw new Error('Calendar sync plan incomplete.');
      const result = measureDmsOperationPhase_(metrics, 'sheetsWriteMs', function() {
        const applied = applyCalendarQueueSyncPlan_(plan, metrics);
        SpreadsheetApp.flush();
        return applied;
      });
      const after = measureDmsOperationPhase_(
        metrics,
        'reconciliationMs',
        function() { return runDmsCalendarQueueReconciliation(metrics, {now: observation.now}); }
      );
      completeDmsCalendarScanState_(plan.scan, syncState.lastSyncStarted);
      completeDmsCalendarSyncGeneration_(syncState, before, after);
      recordDmsScheduledAutomationSuccess_(
        'syncCalendarToQueue', event, 'completed', execution);
      finishDmsOperationMetricsSafely_(metrics, 'success');
      return result;
      } catch (error) {
        failDmsCalendarSyncGeneration_(syncState);
        throw error;
      }
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    finishDmsOperationMetricsSafely_(metrics, 'failed', error);
    finishDmsScheduledAutomationFailure_('syncCalendarToQueue', event, error, execution);
    throw error;
  }
}

// Read-only rollout evidence. It intentionally omits Calendar titles, client
// identities, event IDs, and all row payloads from both the return value and logs.
function previewDmsCalendarQueueSync() {
  const plan = buildCalendarQueueSyncPlan_();
  const result = {
    ok: plan.errors === 0,
    added: plan.added,
    updated: plan.updated,
    cancelled: plan.cancelled,
    ignored: plan.ignored,
    errors: plan.errors,
    writes: plan.writes.map(function(write) {
      return {
        queueId: String(write.values[0] || ''),
        matchingStatus: String(write.values[11] || ''),
        processingStatus: String(write.values[13] || '')
      };
    })
  };
  console.log(JSON.stringify(result));
  return result;
}

function buildCalendarQueueSyncPlan_(metrics, observation) {
  const ss = SpreadsheetApp.getActive();
  const clients = getRequiredSheet_(ss, DMS_SYNC.CLIENTS);
  const queue = getRequiredSheet_(ss, DMS_SYNC.QUEUE);
  const settings = getRequiredSheet_(ss, DMS_SYNC.SETTINGS);
  let config;
  let clientMap;
  let existing;
  const readSheets = function() {
    config = getCalendarSyncSettings_(settings, metrics);
    clientMap = buildCalendarClientMap_(clients, metrics);
    existing = readQueueIndex_(queue, metrics);
  };
  if (metrics) measureDmsOperationPhase_(metrics, 'sheetsReadMs', readSheets);
  else readSheets();
  const now = observation && observation.now || new Date();
  const window = getDmsCalendarWideWindow_(config, now);
  const windowEnd = window.end;
  const scan = getDmsCalendarScanPlan_(config, now);
  let incrementalEvents;
  let wideEvents = [];
  try {
    incrementalEvents = listCalendarEventsUpdated_(
      config.calendarId, scan.updatedMin, config.timeZone, metrics);
  } catch (error) {
    if (!isDmsCalendarIncrementalResetError_(error)) throw error;
    if (metrics) addDmsOperationCount_(metrics, 'retryCount', 1);
    scan.recoveryFull = true;
    scan.includeWide = true;
    scan.wideStart = config.startDate;
    incrementalEvents = [];
  }
  // Reuse this execution's pre-reconciliation observation. Events created long
  // ago can enter the moving horizon without appearing in updatedMin results.
  // Standalone preview takes the same bounded observation. Never infer deletion
  // from absence in an incremental response.
  const coverageStart = scan.recoveryFull ? config.startDate : window.start;
  if (observation && observation.calendarId === config.calendarId &&
      observation.start.getTime() === coverageStart.getTime() &&
      observation.end.getTime() === windowEnd.getTime()) {
    wideEvents = observation.events;
  } else {
    wideEvents = listCalendarEvents_(
      config.calendarId, coverageStart, windowEnd, config.timeZone, metrics);
  }
  const events = mergeDmsCalendarEventSets_(wideEvents, incrementalEvents);
  const plan = {
    ss: ss,
    queue: queue,
    settings: settings,
    timeZone: config.timeZone,
    writes: [],
    queueRows: existing.allRows,
    seen: {},
    added: 0,
    updated: 0,
    cancelled: 0,
    ignored: 0,
    errors: 0,
    summary: ''
  };
  plan.scan = scan;

  events.forEach(function(event) {
    const eventId = String(event.id || '').trim();

    if (!eventId) return;
    plan.seen[eventId] = true;

    const existingRow = existing.byEventId[eventId] || null;

    if (event.status === 'cancelled') {
      const cancelledValues = existingRow
        ? makeQueueEventCancelledValues_(existingRow.values)
        : null;
      if (cancelledValues) {
        addCalendarQueuePlanWrite_(plan, existingRow, cancelledValues, false);
        plan.cancelled++;
      }
      return;
    }

    const title = String(event.summary || '').trim();

    if (!isTrainingEventTitle_(title)) {
      const ignoredValues = existingRow
        ? makeQueueEventNotTrainingValues_(existingRow.values)
        : null;
      if (ignoredValues) {
        addCalendarQueuePlanWrite_(plan, existingRow, ignoredValues, false);
        plan.updated++;
      } else {
        plan.ignored++;
      }
      return;
    }

    const times = getCalendarEventTimes_(event);

    if (!times) {
      plan.ignored++;
      return;
    }
    if (!existingRow && (times.start < config.startDate || times.start >= windowEnd)) {
      plan.ignored++;
      return;
    }

    const client = clientMap[normalizeCalendarTitle_(title)] || null;
    const rowValues = buildQueueRow_(
      existingRow
        ? existingRow.values[0]
        : makeNextQueueIdFromRows_(plan.queueRows),
      config.calendarId,
      event,
      times,
      client
    );

    if (existingRow) {
      const updatedValues = makeUpdatedQueueEventValues_(
        existingRow.values,
        rowValues
      );
      if (updatedValues) {
        addCalendarQueuePlanWrite_(plan, existingRow, updatedValues, false);
        plan.updated++;
      }
    } else {
      const row = findFirstEmptyProjectedQueueRow_(plan.queueRows);
      const newRow = {row: row, values: rowValues};
      addCalendarQueuePlanWrite_(plan, newRow, rowValues, true);
      existing.byEventId[eventId] = newRow;
      existing.rows.push(newRow);
      plan.added++;
    }
  });

  if (scan.includeWide) {
    reconcileMissingQueueEventsInPlan_(
      plan,
      existing.rows,
      config.calendarId,
      scan.wideStart,
      windowEnd,
      clientMap
    );
  }

  plan.summary =
    'Добавлено: ' + plan.added +
    '; обновлено: ' + plan.updated +
    '; отменено: ' + plan.cancelled +
    '; пропущено: ' + plan.ignored +
    '; ошибок: ' + plan.errors + '.';
  return plan;
}

function applyCalendarQueueSyncPlan_(plan, metrics) {
  if (metrics) addDmsOperationCount_(metrics, 'rowsWritten', plan.writes.length);
  plan.writes.forEach(function(write) {
    ensureDmsSheetRowCapacity_(plan.queue, write.row);
    if (write.copyTemplate) copyQueueTemplate_(plan.queue, write.row);
    plan.queue
      .getRange(write.row, 1, 1, DMS_SYNC.QUEUE_COLUMNS)
      .setValues([write.values]);
  });

  setCalendarAutomationStatus_(
    plan.settings,
    plan.timeZone,
    hasCalendarSyncTrigger_(),
    plan.summary
  );
  plan.ss.toast(plan.summary, 'Синхронизация календаря', 10);
  return plan.summary;
}

function installCalendarSyncTrigger() {
  return installDmsScheduledAutomation();
}

function getCalendarSyncSettings_(settings, metrics) {
  const lastRow = Math.max(settings.getLastRow(), 19);
  if (metrics) addDmsOperationCount_(metrics, 'rowsRead', lastRow - 10);
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

function listCalendarEvents_(calendarId, startDate, endDate, timeZone, metrics) {
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

    const response = metrics
      ? measureDmsOperationPhase_(metrics, 'calendarMs', function() {
        return Calendar.Events.list(calendarId, params);
      })
      : Calendar.Events.list(calendarId, params);

    Array.prototype.push.apply(items, response.items || []);
    if (metrics) addDmsOperationCount_(metrics, 'eventsRead', (response.items || []).length);
    pageToken = response.nextPageToken || null;
  } while (pageToken);

  return items;
}

function listCalendarEventsUpdated_(calendarId, updatedMin, timeZone, metrics) {
  // updatedMin includes recently deleted entries. Deliberately omit timeMin and
  // timeMax so an existing event moved far outside the normal horizon is still
  // returned; the planner filters only previously unseen far-future events.
  const items = [];
  let pageToken = null;
  do {
    const params = {
      updatedMin: updatedMin.toISOString(),
      singleEvents: true,
      showDeleted: true,
      maxResults: 2500,
      timeZone: timeZone
    };
    if (pageToken) params.pageToken = pageToken;
    const response = metrics
      ? measureDmsOperationPhase_(metrics, 'calendarMs', function() {
        return Calendar.Events.list(calendarId, params);
      })
      : Calendar.Events.list(calendarId, params);
    Array.prototype.push.apply(items, response.items || []);
    if (metrics) addDmsOperationCount_(metrics, 'eventsRead', (response.items || []).length);
    pageToken = response.nextPageToken || null;
  } while (pageToken);
  return items;
}

function getDmsCalendarFingerprint_(calendarId) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(calendarId || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(bytes).substring(0, 22);
}

function readDmsCalendarScanState_(calendarId, now) {
  const raw = PropertiesService.getScriptProperties().getProperty(DMS_CALENDAR_SCAN.STATE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    const lastSuccess = Date.parse(value.lastSuccessfulAt || '');
    const lastWide = Date.parse(value.lastWideVerificationAt || '');
    if (value.version !== DMS_CALENDAR_SCAN.VERSION ||
        value.calendarFingerprint !== getDmsCalendarFingerprint_(calendarId) ||
        !isFinite(lastSuccess) || lastSuccess > now.getTime() + 5 * 60 * 1000 ||
        value.lastWideVerificationAt && !isFinite(lastWide)) return null;
    return value;
  } catch (ignore) {
    return null;
  }
}

function getDmsCalendarWideWindow_(config, now) {
  const bounded = new Date(now.getTime());
  bounded.setDate(bounded.getDate() - DMS_CALENDAR_SCAN.WIDE_LOOKBACK_DAYS);
  return {
    start: config.startDate > bounded ? new Date(config.startDate.getTime()) : bounded,
    end: new Date(now.getTime() + 24 * 60 * 60 * 1000)
  };
}

function getDmsCalendarScanPlan_(config, now) {
  const state = readDmsCalendarScanState_(config.calendarId, now);
  const window = getDmsCalendarWideWindow_(config, now);
  const anchor = state
    ? new Date(Date.parse(state.lastSuccessfulAt) - DMS_CALENDAR_SCAN.OVERLAP_MS)
    : new Date(now.getTime() - DMS_CALENDAR_SCAN.BOOTSTRAP_UPDATED_LOOKBACK_MS);
  return {
    calendarFingerprint: getDmsCalendarFingerprint_(config.calendarId),
    updatedMin: anchor < config.startDate ? new Date(config.startDate.getTime()) : anchor,
    includeWide: !state || !state.lastWideVerificationAt ||
      now.getTime() - Date.parse(state.lastWideVerificationAt) >= DMS_CALENDAR_SCAN.WIDE_INTERVAL_MS,
    wideStart: window.start,
    recoveryFull: false
  };
}

function completeDmsCalendarScanState_(scan, successfulStartAt) {
  const completedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(DMS_CALENDAR_SCAN.STATE_KEY, JSON.stringify({
    version: DMS_CALENDAR_SCAN.VERSION,
    calendarFingerprint: scan.calendarFingerprint,
    lastSuccessfulAt: successfulStartAt,
    lastWideVerificationAt: scan.includeWide ? completedAt :
      (readDmsCalendarScanStateByFingerprint_(scan.calendarFingerprint) || {}).lastWideVerificationAt || ''
  }));
}

function readDmsCalendarScanStateByFingerprint_(fingerprint) {
  const raw = PropertiesService.getScriptProperties().getProperty(DMS_CALENDAR_SCAN.STATE_KEY);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value.version === DMS_CALENDAR_SCAN.VERSION &&
      value.calendarFingerprint === fingerprint ? value : null;
  } catch (ignore) {
    return null;
  }
}

function mergeDmsCalendarEventSets_(wide, incremental) {
  const byId = {};
  (wide || []).concat(incremental || []).forEach(function(event) {
    const id = String(event && event.id || '').trim();
    if (id) byId[id] = event;
  });
  return Object.keys(byId).map(function(id) { return byId[id]; });
}

function isDmsCalendarIncrementalResetError_(error) {
  const code = Number(error && (error.code || error.status || error.responseCode));
  const message = String(error && error.message || error || '');
  return code === 410 || /\b410\b|fullSyncRequired|updatedMinTooLongAgo/i.test(message);
}

function buildCalendarClientMap_(clients, metrics) {
  const map = {};
  const lastRow = clients.getLastRow();

  if (lastRow < DMS_SYNC.CLIENT_FIRST_ROW) return map;
  if (metrics) addDmsOperationCount_(
    metrics,
    'rowsRead',
    lastRow - DMS_SYNC.CLIENT_FIRST_ROW + 1
  );

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

function readQueueIndex_(queue, metrics) {
  const result = {
    byEventId: {},
    rows: [],
    allRows: []
  };
  const lastRow = queue.getLastRow();

  if (lastRow < DMS_SYNC.QUEUE_FIRST_ROW) return result;
  if (metrics) addDmsOperationCount_(
    metrics,
    'rowsRead',
    lastRow - DMS_SYNC.QUEUE_FIRST_ROW + 1
  );

  const values = queue
    .getRange(
      DMS_SYNC.QUEUE_FIRST_ROW,
      1,
      lastRow - DMS_SYNC.QUEUE_FIRST_ROW + 1,
      DMS_SYNC.QUEUE_COLUMNS
    )
    .getValues();

  values.forEach(function(sourceValues, index) {
    const rowValues = sourceValues.slice();
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
    result.allRows.push(rowValues);
  });

  return result;
}

function buildQueueRow_(queueId, calendarId, event, times, client) {
  const comment = client
    ? (client.blockId || client.singlePrice ? '' : 'Активный блок не указан')
    : 'Требуется регистрация клиента';

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
    client ? 'Распознано' : DMS_UNKNOWN_CLIENT_STATUS,
    client ? 'Проведена' : '',
    client ? 'Ожидает' : DMS_UNKNOWN_CLIENT_STATUS,
    '',
    'Calendar',
    comment
  ];
}

function makeUpdatedQueueEventValues_(current, nextValues) {
  if (current[13] === 'Обработано') return null;

  const rowValues = nextValues.slice();

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

    if (rowValues[11] === DMS_UNKNOWN_CLIENT_STATUS) {
      rowValues[13] = DMS_UNKNOWN_CLIENT_STATUS;
      rowValues[12] = '';
    } else {
      rowValues[13] =
        [DMS_UNKNOWN_CLIENT_STATUS, 'Ошибка'].indexOf(current[13]) !== -1 && resolved
          ? 'Ожидает'
          : (current[13] || 'Ожидает');
    }
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

  return rowValues;
}

function makeQueueEventCancelledValues_(current) {
  const values = current.slice();

  if (values[13] === 'Обработано') return null;

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

  return values;
}

function makeQueueEventNotTrainingValues_(current) {
  const values = current.slice();

  if (values[13] === 'Обработано') return null;

  values[11] = 'Не тренировка';
  values[12] = 'Не учитывать';
  values[13] = values[13] || 'Ожидает';
  values[16] = mergeQueueComment_(
    values[16],
    'Пометка ПТ удалена из названия события'
  );

  return values;
}

function addCalendarQueuePlanWrite_(plan, item, values, copyTemplate) {
  const stored = values.slice();
  const index = item.row - DMS_SYNC.QUEUE_FIRST_ROW;

  while (plan.queueRows.length <= index) {
    plan.queueRows.push(new Array(DMS_SYNC.QUEUE_COLUMNS).fill(''));
  }
  plan.queueRows[index] = stored;
  item.values = stored;
  plan.writes.push({
    row: item.row,
    values: stored,
    copyTemplate: Boolean(copyTemplate)
  });
}

function reconcileMissingQueueEventsInPlan_(
  plan,
  existingRows,
  calendarId,
  startDate,
  endDate,
  clientMap
) {
  existingRows.forEach(function(item) {
    const values = item.values;
    const eventId = String(values[3] || '').trim();
    const eventStart = values[5];

    if (
      !eventId ||
      plan.seen[eventId] ||
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
        const cancelledValues = makeQueueEventCancelledValues_(item.values);
        if (cancelledValues) {
          addCalendarQueuePlanWrite_(plan, item, cancelledValues, false);
          plan.cancelled++;
        }
      } else {
        addCalendarQueuePlanWrite_(
          plan,
          item,
          makeQueueLookupErrorValues_(item.values, error),
          false
        );
        plan.errors++;
      }
      return;
    }

    if (!event || event.status === 'cancelled') {
      const cancelledValues = makeQueueEventCancelledValues_(item.values);
      if (cancelledValues) {
        addCalendarQueuePlanWrite_(plan, item, cancelledValues, false);
        plan.cancelled++;
      }
      return;
    }

    const title = String(event.summary || '').trim();

    if (!isTrainingEventTitle_(title)) {
      const ignoredValues = makeQueueEventNotTrainingValues_(item.values);
      if (ignoredValues) {
        addCalendarQueuePlanWrite_(plan, item, ignoredValues, false);
        plan.updated++;
      }
      return;
    }

    const times = getCalendarEventTimes_(event);

    if (!times) {
      addCalendarQueuePlanWrite_(
        plan,
        item,
        makeQueueLookupErrorValues_(
          item.values,
          new Error('У события отсутствуют дата и время.')
        ),
        false
      );
      plan.errors++;
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

    const updatedValues = makeUpdatedQueueEventValues_(item.values, rowValues);
    if (updatedValues) {
      addCalendarQueuePlanWrite_(plan, item, updatedValues, false);
      plan.updated++;
    }
  });
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

function makeNextQueueIdFromRows_(rows) {
  const maxNumber = rows.reduce(function(max, values) {
    const match = String(values[0] || '').match(/^Q-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return 'Q-' + String(maxNumber + 1).padStart(4, '0');
}

function findFirstEmptyProjectedQueueRow_(rows) {
  const index = rows.findIndex(function(values) {
    return !String(values[0] || '').trim();
  });
  return DMS_SYNC.QUEUE_FIRST_ROW + (index === -1 ? rows.length : index);
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
    'Событие перенесено в Google Calendar',
    'Требуется регистрация клиента'
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

function makeQueueLookupErrorValues_(current, error) {
  const values = current.slice();
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

  return values;
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
